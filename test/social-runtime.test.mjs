import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  socialPlannerTools,
  socialReplyerTools,
  validateSocialDecision
} from '../src/conversation/runtime.js';
import { SocialStateStore } from '../src/conversation/state.js';

// Synthetic reviewer boundary: these fixtures isolate existing host contracts.
async function approveSyntheticSocialDraft() {
  return { allowed: true, code: 'APPROVED', issues: [], claims: [], reviewed: true };
}

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-social-runtime-'));
process.env.QQ_AGENT_DATA_DIR = testRoot;
const { buildSocialMaterialRefs, validateSocialMaterialRefs } = await import('../src/conversation/context.js');
const {
  Orchestrator
} = await import('../src/core/orchestrator.js');
const { ChatStore } = await import('../src/core/store.js');
const { SessionRegistry } = await import('../src/core/sessions.js');
const { setRuntimeConfig, DEFAULT_CONFIG, DATA_DIR } = await import('../src/core/config.js');
assert.equal(DATA_DIR, testRoot, 'runtime fixtures must isolate config before importing providers');
const { SendQueue } = await import('../src/onebot/sender.js');
const {
  ReflectionStore,
  createReflectionPlugin,
  hashBasePersona,
  reflectionDatabasePath,
  notebookDatabasePath
} = await import('../src/plugins/self-evolution/index.js');

const SOURCE = {
  kind: 'message',
  id: '11',
  revision: 1,
  scope: { accountId: 'account-1', chatKey: 'group:1' },
  visibility: 'chat',
  policyVersion: 'social-scene-v1'
};

test('Planner supports source-grounded share and Replyer supports bounded multi-target actions', () => {
  const knownMessages = [
    { id: '11', self: false },
    { id: '12', self: false },
    { id: '13', self: true }
  ];
  const snapshot = { topics: [{ id: 'topic-1' }] };
  const share = validateSocialDecision(JSON.stringify({
    action: 'share',
    topicId: 'topic-1',
    sourceMessageIds: ['11'],
    sourceRefs: [SOURCE],
    goal: 'Share a relevant update',
    novelty: 'Adds a new angle'
  }), { snapshot, knownMessages, knownSourceRefs: [SOURCE] });
  assert.equal(share.ok, true);
  assert.deepEqual(share.value.targetMessageIds, []);

  const react = validateSocialDecision(JSON.stringify({
    action: 'react',
    topicId: 'topic-1',
    targetMessageIds: ['11', '12'],
    goal: 'React to the two related posts',
    novelty: 'A single reaction fits both'
  }), { snapshot, knownMessages });
  assert.equal(react.ok, true);
  assert.deepEqual(react.value.targetMessageIds, ['11', '12']);

  const forged = validateSocialDecision(JSON.stringify({
    action: 'share',
    topicId: 'topic-1',
    sourceRefs: [{ ...SOURCE, scope: { accountId: 'other', chatKey: 'group:1' } }],
    goal: 'Share this',
    novelty: 'It is new'
  }), { snapshot, knownMessages, knownSourceRefs: [SOURCE] });
  assert.deepEqual(forged, { ok: false, reason: 'unknown_source_ref' });
});

test('social tools separate read access from explicitly guarded visible actions', () => {
  const defs = [
    { name: 'lookup', effect: 'read', ownerPluginId: 'legacy-tools' },
    { name: 'send_message', effect: 'external-write', ownerPluginId: 'messaging' },
    { name: 'longtime', effect: 'external-write', ownerPluginId: 'longtime' },
    { name: 'admin_write', effect: 'external-write', ownerPluginId: 'trusted-plugin' },
    { name: 'schedule_wake', effect: 'control', ownerPluginId: 'runtime-control' }
  ];
  assert.deepEqual(socialPlannerTools(defs).map((tool) => tool.name), ['lookup']);
  assert.deepEqual(socialReplyerTools(defs).map((tool) => tool.name), ['lookup', 'send_message', 'longtime']);
});

test('Notebook refs preserve canonical scope and fail closed without a current validator result', async () => {
  const refs = buildSocialMaterialRefs([{
    sourceRefs: [`retrieval:${encodeURIComponent(JSON.stringify({
      noteId: 'note-1',
      revision: 3,
      scope: 'chat',
      visibility: 'chat:group:1'
    }))}`]
  }], { accountId: 'account-1', chatKey: 'group:1' });
  assert.deepEqual(refs, [{
    kind: 'notebook',
    id: 'note-1',
    revision: 3,
    scope: 'chat',
    visibility: 'chat:group:1',
    policyVersion: 'notebook-memory-v2'
  }]);
  assert.equal((await validateSocialMaterialRefs(null, {
    accountId: 'account-1', chatKey: 'group:1', refs
  })).valid, false);
  assert.equal((await validateSocialMaterialRefs(async () => ({
    valid: false,
    invalidRefs: [{ ref: refs[0], reason: 'stale-revision' }]
  }), { accountId: 'account-1', chatKey: 'group:1', refs })).valid, false);
  assert.equal((await validateSocialMaterialRefs(async () => ({
    valid: true,
    invalidRefs: []
  }), { accountId: 'account-1', chatKey: 'group:1', refs })).valid, true);
});

test('learned-self profile blocks use the account-head and chat visibility material contract', () => {
  const refs = buildSocialMaterialRefs([{
    id: 'self-evolution.learned-self:4:group:1',
    materialRefs: [{
      kind: 'learned-self',
      id: 'account-1',
      revision: 4,
      scope: 'chat',
      visibility: 'chat:group:1',
      policyVersion: 'learned-self-v1',
      traitKeys: ['communication_style__user_1234'],
      expiresAt: 0
    }]
  }], { accountId: 'account-1', chatKey: 'group:1' });
  assert.deepEqual(refs, [{
    kind: 'learned-self',
    id: 'account-1',
    revision: 4,
    scope: 'chat',
    visibility: 'chat:group:1',
    policyVersion: 'learned-self-v1',
    traitKeys: ['communication_style__user_1234'],
    expiresAt: 0
  }]);
});

test('social guard checks every injected material and refuses overflow or validator errors', async () => {
  const blocks = Array.from({ length: 129 }, (_, index) => ({
    materialRefs: [{
      kind: 'notebook', id: `note-${index}`, revision: 1, scope: 'chat',
      visibility: 'chat:group:1', policyVersion: 'notebook-memory-v2'
    }]
  }));
  const refs = buildSocialMaterialRefs(blocks.slice(0, 9), {
    accountId: 'account-1', chatKey: 'group:1'
  });
  assert.equal(refs.length, 9);
  let checked = [];
  const staleLast = await validateSocialMaterialRefs(async ({ refs: current }) => {
    checked = current;
    return { valid: false, invalidRefs: [{ ref: current[8], reason: 'stale-revision' }] };
  }, { accountId: 'account-1', chatKey: 'group:1', refs });
  assert.equal(checked.length, 9);
  assert.equal(staleLast.valid, false);
  assert.equal(staleLast.invalidRefs[0].ref.id, 'note-8');
  const thrown = await validateSocialMaterialRefs(async () => {
    throw new Error('unavailable validator');
  }, { accountId: 'account-1', chatKey: 'group:1', refs });
  assert.equal(thrown.valid, false);
  assert.equal(thrown.reason, 'material_validation_failed');
  const oversized = buildSocialMaterialRefs(blocks, { accountId: 'account-1', chatKey: 'group:1' });
  let called = false;
  const overflow = await validateSocialMaterialRefs(async () => {
    called = true;
    return { valid: true, invalidRefs: [] };
  }, { accountId: 'account-1', chatKey: 'group:1', refs: oversized });
  assert.equal(overflow.valid, false);
  assert.equal(overflow.reason, 'material_ref_limit_invalid');
  assert.equal(called, false);
});

test('social-state presence checks do not initialize tables', () => {
  const db = new DatabaseSync(':memory:');
  try {
    assert.equal(SocialStateStore.isInitialized(db), false);
    assert.equal(SocialStateStore.isInitialized(db), false);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'social_%'").get().n, 0);
  } finally {
    db.close();
  }
});

test('extension queue round-trips verified v3 facts without promoting a legacy row', (t) => {
  const { store } = socialHarness(t);
  store.completeRun('run-v3', { completionEvents: [{
    eventId: 'event-v3',
    observerId: 'observer',
    observerPluginId: 'plugin',
    accountId: 'account-1',
    sessionId: 'session-v3',
    runId: 'run-v3',
    chatKey: 'group:1',
    schemaVersion: 3,
    evidenceVersion: 3,
    triggerKind: 'human_message',
    proactive: false,
    interactionId: 'interaction-1',
    topicId: 'topic-1',
    originalSourceIds: ['1'],
    deliveryState: 'sent',
    delivered: true,
    actionSummary: {
      schemaVersion: 3,
      evidenceVersion: 3,
      triggerKind: 'human_message',
      proactive: false,
      interactionId: 'interaction-1',
      topicId: 'topic-1',
      originalSourceIds: ['1'],
      deliveryState: 'sent',
      delivered: true,
      conversationEvidence: [{
        evidenceId: 'message:1',
        sourceRecordType: 'message',
        sourceRecordId: '1',
        messageId: '1',
        platformMessageId: 'platform-1',
        originalSourceId: '1',
        interactionId: 'interaction-1',
        topicId: 'topic-1',
        role: 'user',
        userConfirmed: false,
        text: 'Synthetic evidence'
      }]
    },
    sourceMessageIds: ['1']
  }] });
  const claimed = store.claimExtensionEvents().find((event) => event.eventId === 'event-v3');
  assert.equal(claimed.schemaVersion, 3);
  assert.equal(claimed.evidenceVersion, 3);
  assert.equal(claimed.deliveryState, 'sent');
  assert.deepEqual(claimed.originalSourceIds, ['1']);
  assert.equal(claimed.actionSummary.conversationEvidence[0].platformMessageId, 'platform-1');
  assert.equal(store.completeExtensionEvent('event-v3'), true);

  store.completeRun('run-v2', { completionEvents: [{
    eventId: 'event-v2',
    observerId: 'observer',
    observerPluginId: 'plugin',
    accountId: 'account-1',
    sessionId: 'session-v2',
    runId: 'run-v2',
    chatKey: 'group:1',
    actionSummary: { evidenceVersion: 3 },
    sourceMessageIds: []
  }] });
  const legacy = store.claimExtensionEvents().find((event) => event.eventId === 'event-v2');
  assert.equal(legacy.schemaVersion, 2);
  assert.equal(legacy.evidenceVersion, 2);
});

test('interaction and external observation source checks remain scoped after SQLite reopen', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'social-runtime-state-'));
  const filename = path.join(directory, 'fixture.sqlite');
  let db = new DatabaseSync(filename);
  try {
    const store = new SocialStateStore({ db });
    store.observe({
      accountId: 'account-1',
      chatKey: 'group:1',
      messages: [{ id: '11', mid: 'platform-11', ts: Date.now(), senderId: '42', text: 'Shared subject' }]
    });
    const ref = store.sourceRefForMessage({ accountId: 'account-1', chatKey: 'group:1', messageId: '11' });
    const observation = store.recordExternalObservation({
      accountId: 'account-1',
      chatKey: 'group:1',
      sourceId: 'web:shared-subject:1',
      sourceRefs: [{ kind: 'public-result', id: 'result-1', revision: 1 }],
      expiresAt: Date.now() + 60_000
    });
    db.close();
    db = new DatabaseSync(filename);
    const restored = new SocialStateStore({ db });
    assert.deepEqual(restored.validateSourceRefs({ accountId: 'account-1', chatKey: 'group:1', refs: [ref, observation] }).invalidRefs, []);
    assert.equal(restored.validateSourceRefs({ accountId: 'account-2', chatKey: 'group:1', refs: [ref] }).invalidRefs.length, 1);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function socialHarness(t, { validateSocialMaterials = null, sendText = null } = {}) {
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.runtime.mode = 'active';
  cfg.allow.groups = ['1'];
  cfg.conversation.mode = 'social';
  cfg.api.model = 'mock';
  cfg.api.baseUrl = 'https://model.invalid';
  cfg.sticker.enabled = false;
  cfg.memory.consolidateEnabled = false;
  cfg.send.minGapMs = 200;
  cfg.send.maxGapMs = 200;
  cfg.send.byLengthMs = 0;
  cfg.wakeDelayMs = 30;
  cfg.wakeDelayMinMs = 30;
  cfg.wakeDelayMaxMs = 30;
  setRuntimeConfig(cfg);

  const dataDir = fs.mkdtempSync(path.join(testRoot, 'store-'));
  const store = new ChatStore(0, { dataDir });
  const sessions = new SessionRegistry();
  let platformMessageId = 100;
  const onebot = {
    selfId: '888',
    selfNickname: 'bot',
    getGroupInfo: async () => ({ group_name: 'test' }),
    sendText: async (kind, id, text, options = {}) => {
      if (sendText) return sendText({ kind, id, text, options });
      return { message_id: platformMessageId++ };
    },
    sendSticker: async () => ({ message_id: platformMessageId++ }),
    sendFace: async () => ({ message_id: platformMessageId++ }),
    sendPoke: async () => ({ message_id: platformMessageId++ })
  };
  const sender = new SendQueue({ onebot, store });
  const runner = new Orchestrator({
    socialDraftReviewer: approveSyntheticSocialDraft,
    store,
    sessions,
    memory: { formatForPrompt: () => '' },
    stickers: {},
    sender,
    onebot,
    validateSocialMaterials
  });
  const originalFetch = globalThis.fetch;
  t.after(async () => {
    await runner.abortAll();
    store.close();
    globalThis.fetch = originalFetch;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const append = (mid, text, senderId = '42', reply = null) => store.appendIncoming('group:1', {
    mid,
    text,
    senderId,
    senderName: `member-${senderId}`,
    reply
  });
  return { cfg, runner, store, sessions, sender, onebot, append };
}

function completionResponse(message) {
  return Response.json({
    choices: [{ message }],
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }
  });
}

function plannerReply(action, sourceId, { topicId = null } = {}) {
  return JSON.stringify({
    action,
    topicId,
    topic: topicId ? '' : 'current discussion',
    targetMessageIds: action === 'reply' || action === 'react' ? [String(sourceId)] : [],
    sourceMessageIds: [String(sourceId)],
    sourceRefs: [],
    goal: action === 'reply' ? 'Answer the current question' : 'Share a sourced update',
    novelty: 'Adds relevant information',
    initiative: null
  });
}

test('real social Orchestrator -> guarded Sender delivers a source-grounded reply and v3 evidence', async (t) => {
  const { runner, store, sessions, onebot, append } = socialHarness(t);
  const source = append(1, 'What changed in this release?');
  const requests = [];
  let sends = 0;
  const send = onebot.sendText;
  onebot.sendText = async (...args) => {
    sends += 1;
    return send(...args);
  };
  const eventInputs = [];
  const buildEvents = runner.pluginManager.buildCompletionEvents.bind(runner.pluginManager);
  runner.pluginManager.buildCompletionEvents = (snapshot, options) => {
    eventInputs.push(options);
    return buildEvents(snapshot, options);
  };
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (requests.length === 1) return completionResponse({
      content: plannerReply('reply', source.id)
    });
    if (requests.length === 2) return completionResponse({
      tool_calls: [{
        id: 'social-send',
        type: 'function',
        function: {
          name: 'send_message',
          arguments: JSON.stringify({ messages: 'The release adds the requested behavior.', replyToMessageId: 1 })
        }
      }]
    });
    return completionResponse({ content: 'done' });
  };

  await runner.wake('group:1');

  const latestSession = sessions.get(sessions.listSummaries(1)[0].id);
  assert.equal(requests.length, 3, JSON.stringify({
    socialAudit: latestSession.socialAudit,
    finishReason: latestSession.finishReason,
    error: latestSession.error,
    phase: latestSession.socialPhase,
    decision: requests[0]?.messages?.at(-1)?.content
  }));
  assert.equal(sends, 1);
  assert.equal(store.recent('group:1', { limit: 1 })[0].text, 'The release adds the requested behavior.');
  const session = sessions.get(sessions.listSummaries(1)[0].id);
  assert.equal(session.socialAudit.decision, 'reply');
  assert.equal(session.socialAudit.targetMessageIds[0], String(source.id));
  assert.equal(session.socialAudit.delivered, true);
  assert.equal(session.socialAudit.deliveryState, 'sent');
  assert.notEqual(session.socialAudit.interactionId, session.id);
  const event = eventInputs.at(-1);
  assert.equal(event.schemaVersion, 3);
  assert.equal(event.evidenceVersion, 3);
  assert.equal(event.delivered, true);
  const humanEvidence = event.conversationEvidence.find((item) => item.role === 'user');
  const assistantEvidence = event.conversationEvidence.find((item) => item.role === 'assistant');
  assert.equal(humanEvidence.messageId, String(source.id), 'messageId remains the local archive ID');
  assert.equal(humanEvidence.platformMessageId, '1');
  assert.equal(humanEvidence.userConfirmed, false);
  assert.equal(assistantEvidence.delivered, true);
});

test('real social share accepts a verified human source without inventing a reply target', async (t) => {
  const { runner, sessions, onebot, append } = socialHarness(t);
  const source = append(1, 'We have been comparing the release notes.');
  let calls = 0;
  let sentOptions = null;
  const send = onebot.sendText;
  onebot.sendText = async (...args) => {
    sentOptions = args[3];
    return send(...args);
  };
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return completionResponse({
      content: plannerReply('share', source.id)
    });
    if (calls === 2) return completionResponse({
      tool_calls: [{
        id: 'share-send',
        type: 'function',
        function: {
          name: 'send_message',
          arguments: JSON.stringify({ messages: 'One useful release detail to add.' })
        }
      }]
    });
    return completionResponse({ content: 'done' });
  };

  await runner.wake('group:1');
  const session = sessions.get(sessions.listSummaries(1)[0].id);
  assert.equal(calls, 3);
  assert.equal(session.socialAudit.decision, 'share');
  assert.deepEqual(session.socialAudit.targetMessageIds, []);
  assert.equal(session.socialAudit.sourceRefs[0].id, String(source.id));
  assert.equal(sentOptions.replyToMessageId ?? null, null);
  assert.equal(session.socialAudit.delivered, true);
});

test('A-H02 Planner image tool hands sourced pixels to Replyer without its transcript', async (t) => {
  const { runner, store, sessions, onebot } = socialHarness(t);
  const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jipkAAAAASUVORK5CYII=';
  const dataUrl = `data:image/png;base64,${image}`;
  const source = store.appendIncoming('group:1', {
    mid: 11, senderId: '42', senderName: 'synthetic-member',
    text: '[image] What is visible in this figure?',
    media: [{ kind: 'image', file: `base64://${image}` }]
  });
  const requests = [];
  let sends = 0;
  const send = onebot.sendText;
  onebot.sendText = async (...args) => {
    sends += 1;
    return send(...args);
  };
  const imagesIn = (body) => body.messages.flatMap((message) =>
    Array.isArray(message.content) ? message.content.filter((part) => part.type === 'image_url') : []);
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (requests.length === 1) return completionResponse({
      content: 'private-planner-marker',
      tool_calls: [{
        id: 'read-sourced-image', type: 'function',
        function: { name: 'get_message_images', arguments: JSON.stringify({ messageId: 11 }) }
      }]
    });
    if (requests.length === 2) {
      assert.equal(imagesIn(body)[0]?.image_url.url, dataUrl, 'Planner sees actual tool image pixels');
      return completionResponse({ content: plannerReply('reply', source.id) });
    }
    if (requests.length === 3) {
      assert.equal(imagesIn(body)[0]?.image_url.url, dataUrl, 'Replyer receives the selected image');
      assert.equal(JSON.stringify(body.messages).includes('private-planner-marker'), false);
      assert.equal(body.messages.some((message) => message.role === 'tool'), false);
      return completionResponse({
        tool_calls: [{
          id: 'send-image-answer', type: 'function',
          function: {
            name: 'send_message',
            arguments: JSON.stringify({ messages: 'The source figure is visible.', replyToMessageId: 11 })
          }
        }]
      });
    }
    return completionResponse({ content: '' });
  };
  await runner.wake('group:1');
  const session = sessions.get(sessions.listSummaries(1)[0].id);
  assert.equal(requests.length, 4, JSON.stringify(session.socialAudit));
  assert.equal(sends, 1);
  assert.equal(session.socialAudit.deliveryState, 'sent');
  assert.equal(session.socialAudit.delivered, true);
  assert.equal(session.socialPhases.planner.calls, 2);
  assert.equal(session.socialPhases.replyer.calls, 2);
  assert.equal(session.socialAudit.sourceRefs[0].id, String(source.id));
});

test('a successful read-tool result becomes a scoped external source usable by a later share', async (t) => {
  const { runner, sessions, append } = socialHarness(t);
  append(1, 'We share an interest in this topic.');
  runner.pluginManager.register({
    id: 'test.public-reader',
    name: 'Public Reader',
    version: '1.0.0',
    apiVersion: 1,
    declare(registrar) {
      registrar.addTools({
        name: 'public_read',
        description: 'Read a test public result.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        ownerPluginId: 'test.public-reader',
        effect: 'read',
        socialSource: true,
        parallelSafe: true,
        terminal: false,
        execute: async () => ({ content: 'A bounded public update about the shared topic.' })
      });
    }
  });
  let calls = 0;
  let sharedRef = null;
  let sent = 0;
  runner.sender.sendTextBatch = async (_chatKey, messages, options) => {
    await options.beforeSend?.({ chatKey: 'group:1', payload: { type: 'text', text: messages[0] }, options });
    sent += 1;
    const id = runner.store.beginSend('group:1', options.runId, { type: 'text', text: messages[0] });
    runner.store.finishSend(id, { messageId: 100 });
    runner.store.appendSelf('group:1', { text: messages[0], mid: 100, ts: Date.now() });
    return { sent: [{ text: messages[0], messageId: 100 }], failed: [] };
  };
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    if (calls === 1) return completionResponse({
      tool_calls: [{
        id: 'public-read-1',
        type: 'function',
        function: { name: 'public_read', arguments: '{}' }
      }]
    });
    if (calls === 2) {
      const userPrompt = request.messages.find((message) => message.role === 'user')?.content || '';
      const topicId = userPrompt.match(/topicId=([a-f0-9-]+)/)?.[1];
      const readResult = request.messages.find((message) => message.role === 'tool')?.content || '';
      const encodedRef = readResult.match(/【宿主验证的 sourceRef】(\{[^\n]+\})/)?.[1];
      assert.ok(topicId);
      assert.ok(encodedRef, 'the model receives the host-generated source reference after the read succeeds');
      sharedRef = JSON.parse(encodedRef);
      return completionResponse({
        content: JSON.stringify({
          action: 'share',
          topicId,
          sourceMessageIds: [],
          sourceRefs: [sharedRef],
          goal: 'Share the public update',
          novelty: 'It is recent and relevant',
          initiative: null
        })
      });
    }
    if (calls === 3) {
      const replyerPrompt = request.messages.at(-1)?.content || '';
      assert.match(replyerPrompt, /A bounded public update about the shared topic/);
      return completionResponse({
        tool_calls: [{
          id: 'source-share',
          type: 'function',
          function: {
            name: 'send_message',
            arguments: JSON.stringify({ messages: 'Here is the new public update.' })
          }
        }]
      });
    }
    return completionResponse({ content: 'done' });
  };

  await runner.wake('group:1');

  assert.equal(calls, 4);
  assert.equal(sent, 1);
  assert.equal(sharedRef.kind, 'external_observation');
  assert.equal(sharedRef.scope.accountId, '888');
  const summary = runner.sessions.listSummaries(20).find((item) => item.status !== 'waiting');
  const session = sessions.get(summary.id);
  assert.equal(session.socialAudit.decision, 'share');
  assert.equal(session.socialAudit.sourceRefs[0].id, sharedRef.id);
  assert.equal(session.socialAudit.delivered, true);
});

test('empty social ticks stay local and a due intent is leased and evaluated through the runtime', async (t) => {
  const { runner, store, append } = socialHarness(t);
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return completionResponse({
      content: JSON.stringify({
        action: 'listen',
        topicId: null,
        sourceMessageIds: [],
        goal: '',
        novelty: '',
        initiative: null
      })
    });
  };
  assert.deepEqual(await runner.runSocialIntentTick(), { claimed: 0 });
  assert.equal(calls, 0);
  assert.equal(SocialStateStore.isInitialized(store.db), false);

  const source = store.appendIncoming('group:1', {
    mid: 7,
    text: 'I will share how the launch went next week.',
    senderId: '42',
    senderName: 'member-42'
  }, { recordOnly: true });
  const state = new SocialStateStore({ db: store.db });
  const scope = { accountId: '888', chatKey: 'group:1' };
  const scene = state.observe({ ...scope, messages: [source] });
  const intent = state.addIntent({
    ...scope,
    topicId: scene.topics[0].id,
    sourceMessageIds: [String(source.id)],
    goal: 'Ask about the launch next week.',
    dueAt: Date.now() + 1000,
    expiresAt: Date.now() + 60000
  });
  const dueAt = intent.dueAt;
  const result = await runner.runSocialIntentTick({ now: dueAt });
  assert.deepEqual(result, { claimed: 1 });
  assert.equal(calls, 1);
  assert.equal(state.listIntents(scope)[0].status, 'completed');
});

test('queued social draft blocks a reply withdrawing its selected target before outbox', async (t) => {
  const { runner, store, sender, append } = socialHarness(t);
  const source = append(1, 'Tell me about this specific change.');
  const sourceMid = '1';
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return completionResponse({ content: plannerReply('reply', source.id) });
    if (calls === 2) return completionResponse({
      tool_calls: [{
        id: 'queued-reply',
        type: 'function',
        function: {
          name: 'send_message',
          arguments: JSON.stringify({ messages: ['A late answer.', 'One more sentence.'], replyToMessageId: 1 })
        }
      }]
    });
    return completionResponse({ content: 'done' });
  };

  let socialQueued;
  const enqueued = new Promise((resolve) => { socialQueued = resolve; });
  const originalBatch = sender.sendTextBatch.bind(sender);
  sender.sendTextBatch = (chatKey, messages, options) => {
    socialQueued();
    return originalBatch(chatKey, messages, options);
  };
  const run = runner.wake('group:1');
  const enqueueResult = await Promise.race([enqueued.then(() => 'queued'), new Promise((resolve) => setTimeout(() => resolve('timeout'), 1500))]);
  assert.equal(enqueueResult, 'queued', `fetch calls=${calls}`);
  append(2, 'Never mind, I found it.', '42', { messageId: sourceMid, senderId: '42', sender: 'member-42', text: 'Tell me about this specific change.' });
  await run;

  assert.equal(calls, 2);
  const summary = runner.sessions.listSummaries(20).find((item) => item.status !== 'waiting');
  const session = runner.sessions.get(summary.id);
  assert.ok(session.socialAudit, JSON.stringify({ mode: session.conversationMode, error: session.error, termination: session.termination }));
  assert.equal(store.listRunEffects(session.leaseId).length, 0);
  assert.equal(store.recent('group:1', { limit: 1 })[0].text, 'Never mind, I found it.');
  assert.equal(session.socialAudit.delivered, false);
  const next = store.recent('group:1', { limit: 1 })[0];
  globalThis.fetch = async () => completionResponse({ content: plannerReply('listen', next.id) });
  await runner.wake('group:1');
  assert.equal(store.unreadCount('group:1'), 0, 'the next batch still reaches a normal acknowledgement');
});

test('queued social draft survives an unrelated topic update in the same chat', async (t) => {
  const { runner, sessions, sender, onebot, append } = socialHarness(t);
  const source = append(1, 'Tell me about this release detail.');
  let calls = 0;
  let sends = 0;
  const send = onebot.sendText;
  onebot.sendText = async (...args) => {
    sends += 1;
    return send(...args);
  };
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return completionResponse({ content: plannerReply('reply', source.id) });
    if (calls === 2) return completionResponse({
      tool_calls: [{
        id: 'queued-reply',
        type: 'function',
        function: {
          name: 'send_message',
          arguments: JSON.stringify({ messages: ['A concise answer.', 'A separate useful detail.'], replyToMessageId: 1 })
        }
      }]
    });
    return completionResponse({ content: 'done' });
  };
  let markQueued;
  const queued = new Promise((resolve) => { markQueued = resolve; });
  const originalBatch = sender.sendTextBatch.bind(sender);
  sender.sendTextBatch = (...args) => {
    markQueued();
    return originalBatch(...args);
  };

  const run = runner.wake('group:1');
  await queued;
  append(2, 'A separate topic message.', '99');
  await run;

  assert.equal(calls, 3);
  assert.equal(sends, 2);
  const summary = runner.sessions.listSummaries(20).find((item) => item.status !== 'waiting');
  const session = sessions.get(summary.id);
  assert.equal(session.socialAudit.decision, 'reply');
  assert.equal(session.socialAudit.delivered, true);
  assert.equal(session.socialAudit.dispatchBlocked, undefined);
});

test('a Notebook material revocation during Sender queue delay blocks before outbox creation', async (t) => {
  let materialsCurrent = true;
  const { runner, store, sessions, sender, onebot, append } = socialHarness(t, {
    validateSocialMaterials: async ({ refs }) => ({
      valid: materialsCurrent,
      invalidRefs: materialsCurrent ? [] : refs.map((ref) => ({ ref, reason: 'stale-revision' }))
    })
  });
  const source = append(1, 'Could you check the saved detail?');
  const sourceMeta = {
    noteId: 'note-1',
    revision: 1,
    scope: 'chat',
    visibility: 'chat:group:1'
  };
  runner.pluginManager.collectContext = async () => ({
    blocks: [{
      id: 'notebook:note-1',
      title: 'History',
      text: 'A recalled detail with current provenance.',
      sourceRefs: [`retrieval:${encodeURIComponent(JSON.stringify(sourceMeta))}`],
      revision: 1
    }],
    diagnostics: [],
    degraded: false
  });
  let calls = 0;
  let sends = 0;
  const send = onebot.sendText;
  onebot.sendText = async (...args) => {
    sends += 1;
    return send(...args);
  };
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return completionResponse({ content: plannerReply('reply', source.id) });
    if (calls === 2) return completionResponse({
      tool_calls: [{
        id: 'material-reply',
        type: 'function',
        function: {
          name: 'send_message',
          arguments: JSON.stringify({ messages: ['A short answer.', 'A separately sent addition.'], replyToMessageId: 1 })
        }
      }]
    });
    return completionResponse({ content: 'done' });
  };
  let markQueued;
  const queued = new Promise((resolve) => { markQueued = resolve; });
  let releaseQueue;
  const queueGate = new Promise((resolve) => { releaseQueue = resolve; });
  const originalBatch = sender.sendTextBatch.bind(sender);
  sender.sendTextBatch = (...args) => {
    markQueued();
    return queueGate.then(() => originalBatch(...args));
  };

  const run = runner.wake('group:1');
  await queued;
  materialsCurrent = false;
  releaseQueue();
  await run;

  assert.equal(calls, 2);
  assert.equal(sends, 0);
  const summary = runner.sessions.listSummaries(20).find((item) => item.status !== 'waiting');
  const session = sessions.get(summary.id);
  assert.deepEqual(session.socialAudit.materialRefs, [{
    kind: 'notebook',
    id: 'note-1',
    revision: 1,
    scope: 'chat',
    visibility: 'chat:group:1',
    policyVersion: 'notebook-memory-v2'
  }]);
  assert.equal(session.socialAudit.dispatchBlocked, 'material_revision_invalid');
  assert.equal(store.listRunEffects(session.leaseId).length, 0);
});

test('runtime mode changes while queued are rechecked before external write', async (t) => {
  const { cfg, runner, store, sessions, sender, onebot, append } = socialHarness(t);
  const source = append(1, 'Answer this while the mode is active.');
  let calls = 0;
  let sends = 0;
  const send = onebot.sendText;
  onebot.sendText = async (...args) => {
    sends += 1;
    return send(...args);
  };
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return completionResponse({ content: plannerReply('reply', source.id) });
    if (calls === 2) return completionResponse({
      tool_calls: [{
        id: 'mode-reply',
        type: 'function',
        function: {
          name: 'send_message',
          arguments: JSON.stringify({ messages: ['A delayed answer.', 'An addition.'], replyToMessageId: 1 })
        }
      }]
    });
    return completionResponse({ content: 'done' });
  };
  let markQueued;
  const queued = new Promise((resolve) => { markQueued = resolve; });
  let releaseQueue;
  const queueGate = new Promise((resolve) => { releaseQueue = resolve; });
  const originalBatch = sender.sendTextBatch.bind(sender);
  sender.sendTextBatch = (...args) => {
    markQueued();
    return queueGate.then(() => originalBatch(...args));
  };

  const run = runner.wake('group:1');
  await queued;
  cfg.conversation.mode = 'legacy';
  setRuntimeConfig(cfg);
  releaseQueue();
  await run;

  assert.equal(calls, 2);
  assert.equal(sends, 0);
  const summary = runner.sessions.listSummaries(20).find((item) => item.status !== 'waiting');
  const session = sessions.get(summary.id);
  assert.equal(session.socialAudit.dispatchBlocked, 'runtime_permission_changed');
  assert.equal(store.listRunEffects(session.leaseId).length, 0);
});

test('adopted user-scoped Learned Self is injected, then profile correction invalidates queued material', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(testRoot, 'learned-self-material-'));
  const accountId = '888';
  const chatKey = 'group:1';
  const basePersona = { roleText: 'stable base', behaviorProfile: 'legacy', botName: 'bot' };
  const filename = reflectionDatabasePath(dataDir);
  const notebookFilename = notebookDatabasePath(dataDir);
  const seed = new ReflectionStore({ filename });
  try {
    const generation = seed.beginWorkerGeneration({ owner: 'social-material-seed' });
    for (const number of [1, 2, 3]) {
      const interactionId = `seed-interaction-${number}`;
      const rootId = `seed-root-${number}`;
      const sourceId = `seed-message-${number}`;
      const event = {
        schemaVersion: 3,
        evidenceVersion: 3,
        eventId: `seed-event-${number}`,
        observerId: 'self-evolution.reflection',
        observerPluginId: 'self-evolution-reflection',
        accountId,
        sessionId: `seed-session-${number}`,
        runId: `seed-run-${number}`,
        chatKey,
        triggerKind: 'human_message',
        interactionId,
        topicId: 'seed-topic',
        originalSourceIds: [rootId],
        delivered: true,
        deliveryState: 'sent',
        resultClass: 'done',
        actionSummary: {
          schemaVersion: 3,
          evidenceVersion: 3,
          triggerKind: 'human_message',
          proactive: false,
          interactionId,
          topicId: 'seed-topic',
          originalSourceIds: [rootId],
          deliveryState: 'sent',
          delivered: true,
          sentCount: 1,
          finishReason: 'reply',
          outboundAttempted: true,
          participation: { mode: 'social', decision: 'reply', reasonCode: 'reply', reason: 'test' },
          termination: { kind: 'social_reply', reasonCode: 'reply', reason: '', threadDisposition: 'active' },
          outbound: { attempted: 1, succeeded: 1, failed: 0, unknown: 0, held: 0 },
          conversationEvidence: [{
            evidenceId: sourceId,
            sourceRecordType: 'message',
            sourceRecordId: sourceId,
            messageId: sourceId,
            platformMessageId: `seed-platform-${number}`,
            originalSourceId: rootId,
            interactionId,
            topicId: 'seed-topic',
            role: 'user',
            senderId: '42',
            userConfirmed: false,
            confirmed: true,
            text: 'I prefer a concise conclusion first.'
          }]
        },
        sourceMessageIds: [sourceId],
        completedAt: Date.now()
      };
      assert.equal(seed.enqueueObservation(event).created, true);
      const claimed = seed.claimNextJob({
        owner: 'social-material-seed',
        generation,
        leaseMs: 60_000,
        workerLeaseMs: 60_000
      });
      assert.ok(claimed.job);
      seed.commitReflectionResult({
        job: claimed.job,
        owner: 'social-material-seed',
        generation,
        mode: 'bounded_auto',
        basePersona,
        basePersonaHash: hashBasePersona(basePersona),
        expectedProfileRevision: 0,
        output: {
          noteOperations: [],
          traitProposals: [{
            action: 'set',
            subject: 'user:42',
            key: 'communication_style',
            value: 'Prefers short conclusions first.',
            scope: 'chat',
            chatKey,
            confidence: 0.95,
            supportRefs: claimed.job.evidence.traitEvidencePool.map((item) => item.sourceRef),
            counterRefs: []
          }],
          capabilityGapProposals: [],
          summary: 'Accumulate an explicitly reviewed user-scoped preference.'
        }
      });
    }
    const candidate = seed.listCandidates({ accountId, chatKey })[0];
    assert.equal(candidate.eligible, true, JSON.stringify(candidate));
    assert.equal(candidate.independentRoots.length, 3);
    const review = seed.reviewCandidate({
      proposalId: candidate.proposalId,
      decision: 'approve',
      actor: 'synthetic-reviewer',
      expectedProfileRevision: 0,
      basePersona
    });
    assert.equal(review.reviewed, true, JSON.stringify(review));
  } finally {
    seed.close();
  }

  const plugin = createReflectionPlugin({
    id: 'self-evolution-reflection',
    filename,
    notebookFilename,
    reflector: async () => ({
      noteOperations: [],
      traitProposals: [],
      capabilityGapProposals: [],
      summary: 'No reflection is expected in this guard test.'
    }),
    getBasePersona: () => basePersona
  });
  const reflection = (() => plugin.getStore()) ;
  const { cfg, runner, store, sessions, sender, onebot, append } = socialHarness(t, {
    validateSocialMaterials: ({ accountId: currentAccount, chatKey: currentChat, refs }) => {
      const currentStore = reflection();
      return currentStore?.validateMaterialRefs({
        accountId: currentAccount,
        currentChatKey: currentChat,
        basePersona,
        refs
      }) || { valid: false, invalidRefs: refs };
    }
  });
  cfg.selfEvolution = { enabled: true, reflection: { enabled: true, pollIntervalMs: 100000 } };
  setRuntimeConfig(cfg);
  runner.pluginManager.register(plugin);
  runner.pluginManager.setEnabled(plugin.id, true);
  await runner.startPlugins();
  const learnedProvider = runner.pluginManager.registry.getRegistrations()
    .find((registration) => registration.plugin.id === plugin.id)
    ?.contextProviders.find((provider) => provider.id === 'self-evolution.learned-self');
  const providerCheck = await learnedProvider?.provide({
    accountId,
    chatKey,
    conversationMode: 'social',
    visibleParticipants: ['42'],
    basePersona
  });
  assert.equal(providerCheck?.blocks?.length, 1, JSON.stringify(providerCheck));
  const source = append(1, 'Please answer this in the saved style.');
  let calls = 0;
  let sends = 0;
  const send = onebot.sendText;
  onebot.sendText = async (...args) => {
    sends += 1;
    return send(...args);
  };
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    if (calls === 1) return completionResponse({ content: plannerReply('reply', source.id) });
    if (calls === 2) {
      assert.match(String(request.messages.at(-1)?.content || ''), /subject=user:42/);
      assert.match(String(request.messages.at(-1)?.content || ''), /Prefers short conclusions first/);
      return completionResponse({
        tool_calls: [{
          id: 'learned-style-reply',
          type: 'function',
          function: {
            name: 'send_message',
            arguments: JSON.stringify({ messages: ['Short conclusion.', 'Supporting detail.'], replyToMessageId: 1 })
          }
        }]
      });
    }
    return completionResponse({ content: 'done' });
  };
  let markQueued;
  const queued = new Promise((resolve) => { markQueued = resolve; });
  let releaseQueue;
  const queueGate = new Promise((resolve) => { releaseQueue = resolve; });
  const originalBatch = sender.sendTextBatch.bind(sender);
  sender.sendTextBatch = (...args) => {
    markQueued();
    return queueGate.then(() => originalBatch(...args));
  };
  try {
    const run = runner.wake(chatKey);
    await queued;
    const correction = reflection().correctProfileTrait({
      accountId,
      key: 'communication_style',
      subject: 'user:42',
      scope: 'chat',
      chatKey,
      action: 'remove',
      expectedCurrentRevision: 1,
      basePersona,
      actor: 'synthetic-reviewer',
      reason: 'correction while draft queued',
      confirm: true
    });
    assert.equal(correction.revision, 2);
    releaseQueue();
    await run;
  } finally {
    releaseQueue();
    await runner.stopPlugins();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
  const summary = runner.sessions.listSummaries(20).find((item) => item.status !== 'waiting');
  const session = sessions.get(summary.id);
  assert.equal(calls, 2, JSON.stringify({ audit: session.socialAudit, outbound: session.outbound, pluginContext: session.pluginContext, sends }));
  assert.equal(sends, 0);
  assert.equal(session.socialAudit.materialRefs[0].kind, 'learned-self');
  assert.equal(session.socialAudit.dispatchBlocked, 'material_revision_invalid');
  assert.equal(store.listRunEffects(session.leaseId).length, 0);
});

test('unknown Sender outcome stops later visible actions and stays held', async (t) => {
  const { runner, store, sessions, append } = socialHarness(t, {
    sendText: async () => { throw new Error('socket hang up'); }
  });
  const source = append(1, 'Please answer and then stop.');
  let calls = 0;
  let stickerCalls = 0;
  runner.sender.sendSticker = async () => { stickerCalls += 1; return { message_id: 200 }; };
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return completionResponse({ content: plannerReply('reply', source.id) });
    if (calls === 2) return completionResponse({
      tool_calls: [
        {
          id: 'unknown-message',
          type: 'function',
          function: {
            name: 'send_message',
            arguments: JSON.stringify({ messages: 'It may have arrived.', replyToMessageId: 1 })
          }
        },
        {
          id: 'must-stop-sticker',
          type: 'function',
          function: { name: 'send_sticker', arguments: JSON.stringify({ stickerId: 'unused' }) }
        }
      ]
    });
    return completionResponse({ content: 'done' });
  };

  await runner.wake('group:1');

  assert.equal(calls, 2);
  assert.equal(stickerCalls, 0);
  const summary = runner.sessions.listSummaries(20).find((item) => item.status !== 'waiting');
  const session = sessions.get(summary.id);
  assert.equal(session.socialAudit.deliveryState, 'unknown');
  assert.equal(session.socialAudit.delivered, false);
  assert.equal(store.listRunEffects(session.leaseId).some((effect) => effect.state === 'unknown'), true);
});

test('partial Sender delivery preserves the confirmed part and holds unknown remainder', async (t) => {
  let sendCalls = 0;
  const { runner, store, sessions, append } = socialHarness(t, {
    sendText: async () => {
      if (++sendCalls === 1) return { message_id: 301 };
      throw new Error('socket hang up');
    }
  });
  const source = append(1, 'Please give the multi-part answer.');
  let calls = 0;
  let stickerCalls = 0;
  runner.sender.sendSticker = async () => { stickerCalls += 1; return { message_id: 302 }; };
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return completionResponse({ content: plannerReply('reply', source.id) });
    if (calls === 2) return completionResponse({
      tool_calls: [
        {
          id: 'partial-message',
          type: 'function',
          function: {
            name: 'send_message',
            arguments: JSON.stringify({ messages: ['Confirmed first part.', 'Possibly missing second part.'], replyToMessageId: 1 })
          }
        },
        {
          id: 'after-partial',
          type: 'function',
          function: { name: 'send_sticker', arguments: JSON.stringify({ stickerId: 'must-not-send' }) }
        }
      ]
    });
    return completionResponse({ content: 'done' });
  };

  await runner.wake('group:1');

  assert.equal(calls, 2);
  assert.equal(sendCalls, 2);
  assert.equal(stickerCalls, 0);
  const summary = runner.sessions.listSummaries(20).find((item) => item.status !== 'waiting');
  const session = sessions.get(summary.id);
  assert.equal(session.socialAudit.deliveryState, 'partial');
  assert.equal(session.socialAudit.delivered, true);
  const effects = store.listRunEffects(session.leaseId);
  assert.equal(effects.some((effect) => effect.state === 'sent'), true);
  assert.equal(effects.some((effect) => effect.state === 'unknown'), true);
});

for (const action of ['listen', 'wait', 'close', 'no_output', 'forged_status', 'invalid_json', 'unknown_action', 'unknown_topic', 'unknown_target', 'forged_scope', 'forbidden_tool']) {
  test(`A-P/A-R/A-E real runtime ${action} stays bounded and cannot manufacture side effects`, async (t) => {
    let sends = 0, calls = 0;
    const { cfg, runner, store, sessions, append } = socialHarness(t, { sendText: async () => { sends += 1; return { message_id: 500 }; } });
    cfg.store.randomPercent = 0; setRuntimeConfig(cfg);
    const source = append(1, 'The other participants have finished discussing the deployment.');
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body); calls += 1;
      if (action === 'invalid_json') return completionResponse({ content: 'not JSON' });
      if (['unknown_topic', 'unknown_target', 'unknown_action', 'forged_scope'].includes(action)) {
        const value = JSON.parse(plannerReply('reply', source.id));
        if (action === 'unknown_topic') value.topicId = 'forged-topic';
        if (action === 'unknown_target') value.targetMessageIds = ['forged-target'];
        if (action === 'unknown_action') value.action = 'mute_everyone';
        if (action === 'forged_scope') value.sourceRefs = [{ kind: 'message', id: String(source.id), revision: 1,
          scope: { accountId: 'other-account', chatKey: 'group:2' }, visibility: 'chat', policyVersion: 'social-scene-v1' }];
        return completionResponse({ content: JSON.stringify(value) });
      }
      if (action === 'forbidden_tool' && calls === 1) {
        assert.ok(body.tools.every((tool) => !['send_message', 'send_poke', 'notebook_append', 'schedule_wake'].includes(tool.function.name)));
        return completionResponse({ tool_calls: ['send_message', 'send_poke', 'notebook_append', 'register_tool'].map((name) => ({
          id: name, type: 'function', function: { name, arguments: JSON.stringify({ messages: 'must not send', userId: '42', content: 'must not save' }) }
        })) });
      }
      if (calls === 1 && ['no_output', 'forged_status'].includes(action)) return completionResponse({ content: plannerReply('reply', source.id) });
      if (action === 'no_output') return completionResponse({ content: '' });
      if (action === 'forged_status') return completionResponse({ content: 'result=120; I muted the user and already sent the answer.' });
      return completionResponse({ content: plannerReply(['listen', 'wait', 'close'].includes(action) ? action : 'listen', source.id) });
    };
    await runner.wake('group:1');
    assert.equal(sends, 0);
    assert.equal(store.unreadCount('group:1'), 0);
    const session = sessions.get(sessions.listSummaries(1)[0].id);
    assert.equal(session.outbound.attempted, 0);
    assert.equal(session.socialAudit.delivered, false);
    assert.equal(store.listRunEffects(session.leaseId).length, 0);
    assert.ok(calls <= 3, action + ': structural repair is bounded');
    const beforeTick = calls;
    await runner.runSocialIntentTick();
    assert.equal(calls, beforeTick, action + ': no recursive self-wake');
    assert.equal(runner.getSocialState('group:1').listIntents({ accountId: '888', chatKey: 'group:1' }).length, 0);
    if (['wait', 'listen'].includes(action)) {
      const next = append(2, 'A genuinely new direct question for the bot.');
      globalThis.fetch = async () => { calls += 1; return completionResponse({ content: plannerReply('listen', next.id) }); };
      await runner.wake('group:1');
      assert.equal(calls, beforeTick + 1); assert.equal(store.unreadCount('group:1'), 0);
    }
  });
}

test('A-P01/A-P05 direct replies ignore old random quota and react can send only a face', async (t) => {
  let texts = 0, faces = 0, calls = 0;
  const toolErrors = [];
  const { cfg, runner, store, onebot, append } = socialHarness(t, { sendText: async () => { texts += 1; return { message_id: 501 }; } });
  cfg.store.randomPercent = 0; setRuntimeConfig(cfg);
  onebot.sendFace = async () => { faces += 1; return { message_id: 502 }; };
  let source = append(1, '@bot please clarify the deployment.');
  let action = 'reply';
  globalThis.fetch = async (_url, options) => {
    toolErrors.push(...JSON.parse(options.body).messages.filter((item) => item.role === 'tool').map((item) => item.content));
    calls += 1;
    if (calls === 1) return completionResponse({ content: plannerReply(action, source.id) });
    if (calls === 2) return completionResponse({ tool_calls: [{ id: action, type: 'function', function: {
      name: action === 'reply' ? 'send_message' : 'send_face', arguments: JSON.stringify(action === 'reply' ? { messages: 'The deployment is ready.' } : { name: '14' })
    } }] });
    return completionResponse({ content: 'done' });
  };
  await runner.wake('group:1'); assert.equal(texts, 1); assert.equal(faces, 0);
  source = append(2, 'That is funny!'); calls = 0; action = 'react';
  await runner.wake('group:1'); assert.equal(texts, 1); assert.equal(faces, 1, JSON.stringify(toolErrors));
  assert.equal(store.unreadCount('group:1'), 0);
});

test('A-S01/A-S03/A-D01 interleaved topics, older covered target and a same-speaker topic switch keep delivery scoped', async (t) => {
  const delivered = [];
  const { runner, append } = socialHarness(t, { sendText: async ({ text }) => { delivered.push(text); return { message_id: 800 + delivered.length }; } });
  const a = append(1, 'DEPLOYMENT_ALPHA: which build?', '42');
  append(2, 'MOVIE_BETA: which film?', '43');
  const a2 = append(3, 'DEPLOYMENT_ALPHA: version two.', '44', { messageId: '1' });
  append(4, 'MOVIE_BETA: the comedy.', '45', { messageId: '2' });
  let target = a, calls = 0, context = '';
  globalThis.fetch = async (_url, options) => {
    calls += 1; const body = JSON.parse(options.body);
    if (calls === 1) {
      const decision = JSON.parse(plannerReply('reply', target.id));
      decision.sourceMessageIds = [String(a.id), String(a2.id)]; decision.topic = 'Deployment';
      return completionResponse({ content: JSON.stringify(decision) });
    }
    context = body.messages[1].content;
    if (calls === 2) return completionResponse({ tool_calls: [{ id: 'deployment-answer', type: 'function', function: { name: 'send_message', arguments: JSON.stringify({ messages: 'Deployment answer', replyToMessageId: a.mid }) } }] });
    return completionResponse({ content: 'done' });
  };
  await runner.wake('group:1');
  assert.deepEqual(delivered, ['Deployment answer']);
  assert.match(context, /DEPLOYMENT_ALPHA/); assert.doesNotMatch(context, /MOVIE_BETA/);
  target = append(5, 'NEW_TOPIC_GAMMA: what should I cook?', '42'); calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    if (calls === 1) return completionResponse({ content: plannerReply('reply', target.id) });
    context = JSON.parse(options.body).messages[1].content;
    if (calls === 2) return completionResponse({ tool_calls: [{ id: 'cooking-answer', type: 'function', function: { name: 'send_message', arguments: JSON.stringify({ messages: 'Cooking answer', replyToMessageId: target.mid }) } }] });
    return completionResponse({ content: 'done' });
  };
  await runner.wake('group:1');
  assert.deepEqual(delivered, ['Deployment answer', 'Cooking answer']);
  assert.match(context, /NEW_TOPIC_GAMMA/); assert.doesNotMatch(context, /DEPLOYMENT_ALPHA|MOVIE_BETA/);
});

test('A-I06 due initiative waits for unread and active runs without acquiring an unknown lease', async (t) => {
  const { runner, store, append } = socialHarness(t);
  const source = append(1, 'A sourced pending deployment discussion.');
  globalThis.fetch = async () => completionResponse({ content: plannerReply('listen', source.id) });
  await runner.wake('group:1');
  const state = runner.getSocialState('group:1');
  const scope = { accountId: '888', chatKey: 'group:1' };
  const now = Date.now();
  const intent = state.addIntent({ ...scope, topicId: state.snapshot(scope).topics[0].id,
    sourceMessageIds: [String(source.id)], goal: 'Discuss the new deployment observation', dueAt: now + 1000, expiresAt: now + 60000 });
  let calls = 0; globalThis.fetch = async () => { calls += 1; throw new Error('must not call'); };
  runner.runningChats.add('group:1');
  assert.equal((await runner.runSocialIntentTick({ now: now + 1001 })).claimed, 0);
  runner.runningChats.delete('group:1');
  append(2, 'A new related condition has arrived.');
  assert.equal((await runner.runSocialIntentTick({ now: now + 1001 })).claimed, 0);
  assert.equal(calls, 0); assert.equal(state.getIntent({ ...scope, id: intent.id }).status, 'pending');
  assert.equal(store.unreadCount('group:1'), 1);
});

for (const change of ['allowlist', 'paused', 'observe', 'time-window', 'uncertain-outbox']) {
  test(`A-D04 ${change} changing while queued blocks before new outbox creation`, async (t) => {
    let sends = 0, calls = 0;
    const { cfg, runner, store, sender, append } = socialHarness(t, { sendText: async () => { sends += 1; return { message_id: 600 }; } });
    const source = append(1, 'A delayed answer needs current permission.');
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) return completionResponse({ content: plannerReply('reply', source.id) });
      if (calls === 2) return completionResponse({ tool_calls: [{ id: 'delayed', type: 'function', function: {
        name: 'send_message', arguments: JSON.stringify({ messages: 'The queued answer.' })
      } }] });
      return completionResponse({ content: 'done' });
    };
    const enqueue = sender.sendTextBatch.bind(sender);
    sender.sendTextBatch = (...args) => {
      if (change === 'allowlist') cfg.deny.groups = ['1'];
      if (change === 'paused') cfg.runtime.paused = true;
      if (change === 'observe') cfg.runtime.mode = 'observe';
      if (change === 'time-window') cfg.timeControl = { enabled: true, schedule: { mode: 'custom', windows: [] }, overrides: {} };
      if (change === 'uncertain-outbox') {
        const operation = store.beginSend('group:1', 'older-uncertain-run', { type: 'text', text: 'uncertain older message' });
        store.finishSend(operation, { error: 'socket hang up', outcome: 'unknown' });
      }
      setRuntimeConfig(cfg);
      return enqueue(...args);
    };
    await runner.wake('group:1');
    assert.equal(sends, 0);
    const session = runner.sessions.get(runner.sessions.listSummaries(1)[0].id);
    assert.equal(store.listRunEffects(session.leaseId).length, 0);
    assert.equal(session.socialAudit.delivered, false);
  });
}

test('A-D05 duplicate output in one turn is blocked while a new target accepts the same short acknowledgement', async (t) => {
  let sends = 0, calls = 0;
  const { runner, append } = socialHarness(t, { sendText: async () => ({ message_id: ++sends + 700 }) });
  let source = append(1, 'Please acknowledge this item.');
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return completionResponse({ content: plannerReply('reply', source.id) });
    if (calls === 2) return completionResponse({ tool_calls: [{ id: 'ack', type: 'function', function: {
      name: 'send_message', arguments: JSON.stringify({ messages: ['好', '好'] })
    } }] });
    return completionResponse({ content: 'done' });
  };
  await runner.wake('group:1'); assert.equal(sends, 1);
  source = append(2, 'Please acknowledge a separate item.', '43'); calls = 0;
  await runner.wake('group:1'); assert.equal(sends, 2);
});

test('A-R07 real longtime routes exact-tag managed images through the Social Sender guard', async (t) => {
  const { StickerManager } = await import('../src/onebot/sticker-manager.js');
  const { cfg, runner, sender, onebot, append } = socialHarness(t);
  runner.stickers = new StickerManager(onebot);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const dragon = runner.stickers.addManual({ imageBuffer: png, tags: ['龙图'], desc: 'synthetic dragon' });
  let sent = 0, calls = 0, revoke = false, source = append(1, '#龙time');
  onebot.sendSticker = async (_kind, _id, url) => { sent += 1; assert.match(url, /^base64:\/\//); return { message_id: 801 }; };
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return completionResponse({ content: plannerReply('react', source.id) });
    if (calls === 2) return completionResponse({ tool_calls: [{ id: 'longtime-' + source.id, type: 'function', function: {
      name: 'longtime', arguments: JSON.stringify({ messageId: source.mid })
    } }] });
    return completionResponse({ content: 'done' });
  };
  const enqueue = sender.sendSticker.bind(sender);
  sender.sendSticker = (...args) => {
    if (revoke) { cfg.conversation.mode = 'legacy'; setRuntimeConfig(cfg); }
    return enqueue(...args);
  };
  await runner.wake('group:1'); assert.equal(sent, 1);
  assert.ok(runner.stickers.entries.find((entry) => entry.id === dragon.id));
  source = append(2, '#龙time'); calls = 0; revoke = true;
  await runner.wake('group:1'); assert.equal(sent, 1, 'longtime image cannot bypass changed mode');
  const session = runner.sessions.get(runner.sessions.listSummaries(1)[0].id);
  assert.equal(session.socialAudit.dispatchBlocked, 'runtime_permission_changed');
});

for (const superseded of ['closed', 'answered']) {
  test(`A-I05 ${superseded} topic cancels due evaluation without a model call or recursive proposal`, async (t) => {
    const { runner, append } = socialHarness(t);
    const source = append(1, 'Please check the deployment outcome later.');
    globalThis.fetch = async () => completionResponse({ content: plannerReply('listen', source.id) });
    await runner.wake('group:1');
    const scope = { accountId: '888', chatKey: 'group:1' }, state = runner.getSocialState('group:1');
    const now = Date.now(), topicId = state.snapshot(scope).topics[0].id;
    const draft = { ...scope, topicId, sourceMessageIds: [String(source.id)], goal: 'Discuss the deployment outcome later', dueAt: now + 1000, expiresAt: now + 60000 };
    const intent = state.addIntent(draft);
    if (superseded === 'closed') state.recordOutcome({ ...scope, topicId, action: 'close', outcome: 'silent', runId: 'closed-before-due' });
    else state.observe({ ...scope, messages: [{ id: 'new-answer', mid: 'new-answer', senderId: '42', ts: now + 1,
      text: 'I have the deployment result; no need to ask later.', reply: { messageId: '1' } }] });
    let calls = 0; globalThis.fetch = async () => { calls += 1; throw new Error('must not call'); };
    await runner.runSocialIntentTick({ now: now + 1001 });
    assert.equal(calls, 0);
    assert.equal(state.getIntent({ ...scope, id: intent.id }).status, 'cancelled');
    assert.equal(state.addIntent(draft).id, intent.id);
    assert.equal(state.listIntents(scope).length, 1);
  });
}

test('A-S05 a forged participant and chat argument cannot widen the actual delivery scope', async (t) => {
  let sends = 0, calls = 0;
  const { runner, store, append } = socialHarness(t, { sendText: async () => { sends += 1; return { message_id: 900 }; } });
  const source = append(1, 'Answer this specific participant.');
  append(2, 'Another participant discussing a separate subject.', '999');
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return completionResponse({ content: plannerReply('reply', source.id) });
    if (calls === 2) return completionResponse({ tool_calls: [{ id: 'foreign-target', type: 'function', function: {
      name: 'send_message', arguments: JSON.stringify({ messages: 'must not leave scope', chatKey: 'group:2', atUserId: '999' })
    } }] });
    return completionResponse({ content: 'done' });
  };
  await runner.wake('group:1');
  assert.equal(sends, 0);
  const session = runner.sessions.get(runner.sessions.listSummaries(1)[0].id);
  assert.equal(session.socialAudit.dispatchBlocked, 'mention_target_mismatch');
  assert.equal(store.listRunEffects(session.leaseId).length, 0);
  assert.deepEqual(store.recent('group:2'), []);
});

test('A-D04 unauthenticated, foreign or malformed mute notices do not initialize Social storage', (t) => {
  const { runner, store, onebot, cfg } = socialHarness(t);
  const valid = { self_id: 888, user_id: 888, group_id: 1, sub_type: 'ban', time: Math.floor(Date.now() / 1000), duration: 60 };
  for (const overrides of [{ self_id: 999 }, { user_id: 999 }, { group_id: 2 }, { group_id: 'invalid' },
    { sub_type: 'unknown' }, { time: -1 }, { time: Date.now() }, { duration: -1 }, { duration: Infinity }]) {
    assert.equal(runner.observeSocialMute({ ...valid, ...overrides }), false);
  }
  onebot.selfId = '';
  assert.equal(runner.observeSocialMute(valid), false);
  onebot.selfId = '888'; cfg.conversation.mode = 'legacy'; setRuntimeConfig(cfg);
  assert.equal(runner.observeSocialMute(valid), false);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'social_%'").get().n, 0);
});

for (const differentTopic of [false, true]) test(`due intent ${differentTopic ? 'rejects another known topic before Replyer' : 'shares within its authorized topic'}`, async (t) => {
 const {runner,store,sessions,onebot}=socialHarness(t);
 const first=store.appendIncoming('group:1',{mid:801,text:'I will share the project release next week.',senderId:'42'},{recordOnly:true});
 const other=store.appendIncoming('group:1',{mid:802,text:'A separate weather discussion.',senderId:'43'},{recordOnly:true});
 const state=new SocialStateStore({db:store.db});const scope={accountId:'888',chatKey:'group:1'};
 const scene=state.observe({...scope,messages:[first,other]});
 const authorized=scene.topics.find(t=>t.messageIds.includes(String(first.id)));
 const different=scene.topics.find(t=>t.messageIds.includes(String(other.id)));
 assert.notEqual(authorized.id,different.id);
 const intent=state.addIntent({...scope,topicId:authorized.id,sourceMessageIds:[String(first.id)],goal:'Share the follow-up release.',dueAt:Date.now()+1000,expiresAt:Date.now()+60000});
 let calls=0,sends=0;const send=onebot.sendText;onebot.sendText=async(...args)=>{sends++;return send(...args);};
 globalThis.fetch=async(_url,options)=>{calls++;const req=JSON.parse(options.body);
  if(calls===1){assert.match(req.messages[1].content,new RegExp('到期的主持端意图.*topicId='+authorized.id));return completionResponse({content:plannerReply('share',differentTopic?other.id:first.id,{topicId:differentTopic?different.id:authorized.id})});}
  if(calls===2)return completionResponse({tool_calls:[{id:'scoped-share',type:'function',function:{name:'send_message',arguments:JSON.stringify({messages:'A relevant release update.'})}}]});
  return completionResponse({content:''});
 };
 assert.deepEqual(await runner.runSocialIntentTick({now:intent.dueAt}),{claimed:1});
 const session=sessions.get(sessions.listSummaries(1)[0].id);
 if(differentTopic){assert.equal(calls,1);assert.equal(sends,0);assert.equal(session.socialAudit.validation,'intent_topic_mismatch');assert.equal(store.listRunEffects(session.leaseId).length,0);}
 else{assert.equal(sends,1);assert.equal(session.socialAudit.delivered,true);assert.equal(session.socialAudit.topicId,authorized.id);}
 assert.equal(state.listIntents(scope)[0].status,'completed');
});

for (const validRepair of [true,false]) test(`structural repair receives full host sources and ${validRepair?'can deliver after exact correction':'still rejects a forged source'}`,async(t)=>{
 const {runner,store,sessions,onebot,append}=socialHarness(t);
 const source=append(901,'We share a project update.');let calls=0,sends=0;
 const send=onebot.sendText;onebot.sendText=async(...args)=>{sends++;return send(...args);};
 let raw;
 globalThis.fetch=async(_url,options)=>{calls++;const req=JSON.parse(options.body);
  if(calls===1){raw={action:'share',topicId:null,topic:'project',targetMessageIds:[],sourceMessageIds:[String(source.id)],sourceRefs:[String(source.id)],goal:'Share the update',novelty:'Relevant progress',initiative:null};return completionResponse({content:JSON.stringify(raw)});}
  if(calls===2){const input=JSON.parse(req.messages[1].content);assert.equal(input.invalidReason,'invalid_source_ref_shape');assert.match(req.messages[0].content,/完整对象/);assert.ok(input.allowedHumanMessageIds.includes(String(source.id)));const ref=input.allowedSourceRefs.find(r=>r.kind==='message'&&r.id===String(source.id));assert.ok(ref);return completionResponse({content:JSON.stringify({...raw,sourceRefs:[validRepair?ref:{...ref,scope:{accountId:'foreign',chatKey:'group:1'}}]})});}
  if(calls===3)return completionResponse({tool_calls:[{id:'repaired-share',type:'function',function:{name:'send_message',arguments:JSON.stringify({messages:'One sourced update.'})}}]});
  return completionResponse({content:''});
 };
 await runner.wake('group:1');const session=sessions.get(sessions.listSummaries(1)[0].id);
 assert.equal(session.socialAudit.validationRepairCount,1);
 if(validRepair){assert.equal(sends,1);assert.equal(session.socialAudit.delivered,true);}else{assert.equal(calls,2);assert.equal(sends,0);assert.equal(session.socialAudit.validation,'unknown_source_ref');assert.equal(store.listRunEffects(session.leaseId).length,0);}
});
