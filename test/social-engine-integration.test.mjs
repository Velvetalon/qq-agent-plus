import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-social-main-chain-'));
process.env.QQ_AGENT_DATA_DIR = root;

const { DEFAULT_CONFIG, setRuntimeConfig } = await import('../src/core/config.js');
const { Orchestrator } = await import('../src/core/orchestrator.js');
const { ChatStore } = await import('../src/core/store.js');
const { SessionRegistry } = await import('../src/core/sessions.js');
const { SendQueue } = await import('../src/onebot/sender.js');
const { createReflectionPlugin } = await import('../src/plugins/self-evolution/reflection-plugin.js');

test.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

test('real social producer accumulates independent candidate evidence through Manager and worker without window fixtures', async (t) => {
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.runtime.mode = 'active';
  cfg.allow.groups = ['10001'];
  cfg.conversation.mode = 'social';
  cfg.api.model = 'synthetic-boundary-model';
  cfg.api.baseUrl = 'https://synthetic-model.invalid';
  cfg.sticker.enabled = false;
  cfg.memory.consolidateEnabled = false;
  cfg.send.minGapMs = 0;
  cfg.send.maxGapMs = 0;
  cfg.send.byLengthMs = 0;
  cfg.selfEvolution = {
    enabled: true,
    reflection: { enabled: true, pollIntervalMs: 100000 }
  };
  setRuntimeConfig(cfg);
  const accountId = '10000001';
  const chatKey = 'group:10001';
  const senderId = '20000002';
  const dataDir = fs.mkdtempSync(path.join(root, 'candidate-chain-'));
  const chatStore = new ChatStore(0, { dataDir });
  const sessions = new SessionRegistry(0);
  const onebot = {
    selfId: accountId,
    selfNickname: 'test-bot',
    getGroupInfo: async () => ({ group_name: 'synthetic-group' }),
    sendText: async () => ({ message_id: 'sent-' + (++visibleSends) })
  };
  let visibleSends = 0;
  let activeSource = null;
  let phaseCalls = 0;
  let externalBoundaryCalls = 0;
  const requests = [];
  let reflection = null;
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let clock = originalNow();
  Date.now = () => clock;
  const runner = new Orchestrator({
    store: chatStore,
    sessions,
    onebot,
    sender: new SendQueue({ onebot, store: chatStore }),
    stickers: {},
    memory: { formatForPrompt: () => '' },
    validateSocialMaterials: ({ accountId: account, chatKey: chat, refs }) => (
      reflection?.validateMaterialRefs({
        accountId: account, currentChatKey: chat, refs, basePersona: cfg.persona
      }) || { valid: false, invalidRefs: refs }
    )
  });
  const reflected = [];
  const plugin = createReflectionPlugin({
    dataDir,
    getAccountId: () => accountId,
    getBasePersona: () => cfg.persona,
    reflector: async ({ evidence }) => {
      reflected.push(structuredClone(evidence));
      return {
        noteOperations: [{
          operation: 'append',
          scope: 'chat',
          chatKey,
          content: 'We compared concise explanations during a technical discussion.',
          tags: ['experience'],
          evidenceRefs: evidence.currentUserSourceRefs
        }],
        traitProposals: [{
          action: 'set',
          subject: `user:${senderId}`,
          key: 'communication_style',
          value: 'Prefers a concise conclusion before supporting detail.',
          scope: 'chat',
          chatKey,
          confidence: 0.99,
          supportRefs: evidence.traitEvidencePool.map((entry) => entry.sourceRef),
          counterRefs: []
        }],
        capabilityGapProposals: [],
        summary: 'Preserve an episode and evaluate a scoped tentative preference.'
      };
    }
  });
  runner.pluginManager.register(plugin);
  runner.pluginManager.setEnabled(plugin.id, true);
  t.after(async () => {
    await runner.abortAll();
    await runner.stopPlugins();
    chatStore.close();
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  });
  globalThis.fetch = async (_url, options) => {
    externalBoundaryCalls += 1;
    const body = JSON.parse(options.body);
    requests.push(structuredClone(body));
    const planner = String(body.messages[0]?.content || '').includes('【阶段：参与规划】');
    let message;
    if (planner) {
      phaseCalls = 0;
      message = { content: JSON.stringify({
        action: 'reply',
        topicId: null,
        topic: 'Concise explanations',
        targetMessageIds: [String(activeSource.id)],
        sourceMessageIds: [String(activeSource.id)],
        sourceRefs: [],
        goal: 'Answer the current concrete question.',
        novelty: 'Provide the newly requested conclusion.',
        initiative: null
      }) };
    } else if (++phaseCalls === 1) {
      message = { tool_calls: [{
        id: 'reply-' + activeSource.id,
        type: 'function',
        function: {
          name: 'send_message',
          arguments: JSON.stringify({ messages: 'A concise conclusion about this question.' })
        }
      }] };
    } else {
      message = { content: '' };
    }
    return Response.json({
      choices: [{ message }],
      usage: { prompt_tokens: 25, completion_tokens: 10, total_tokens: 35 }
    });
  };
  await runner.startPlugins();
  reflection = plugin.getStore();
  const worker = plugin.getWorker();
  for (let index = 1; index <= 3; index += 1) {
    if (index > 1) clock += 31 * 60 * 1000;
    activeSource = chatStore.appendIncoming(chatKey, {
      mid: 'platform-' + index,
      ts: clock,
      senderId,
      senderName: 'synthetic-member',
      text: `Question ${index}: please start with a concise conclusion and then explain the supporting detail.`
    });
    await runner.wake(chatKey);
    await runner.pluginManager.drainCompletionEvents();
    const result = await worker.runOnce();
    assert.equal(result.committed, true, JSON.stringify(result));
    assert.equal(result.appliedNoteCount, 1, JSON.stringify({
      result,
      evidence: reflected.at(-1),
      social: sessions.listSummaries(1)[0]?.socialAudit,
      proposals: reflection.listProposals({ accountId }).map((proposal) => ({
        type: proposal.type, status: proposal.status, errorCode: proposal.errorCode,
        errorMessage: proposal.errorMessage
      })),
      audit: reflection.listAudit({ accountId, limit: 3 })
    }));
    assert.equal(result.appliedTraitCount, 0);
    assert.equal(reflection.getLearnedSelfRevision({ accountId }), 0);
  }
  assert.equal(visibleSends, 3, JSON.stringify({
    externalBoundaryCalls,
    sessions: sessions.listSummaries().map((session) => ({
      social: session.socialAudit, outbound: session.outbound, status: session.status
    }))
  }));
  assert.equal(reflected.length, 3);
  assert.ok(reflected.every((evidence) => evidence.evidenceVersion === 3));
  assert.ok(reflected.every((evidence) =>
    evidence.conversationEvidence.filter((item) => item.role === 'user')
      .every((item) => item.userConfirmed === false && item.platformMessageId.startsWith('platform-'))
  ));
  const candidate = reflection.listCandidates({ accountId, chatKey })[0];
  assert.equal(candidate.eligible, true, JSON.stringify(candidate));
  assert.equal(candidate.independentRoots.length, 3);
  assert.equal(candidate.interactionIds.length, 3);
  const approved = reflection.reviewCandidate({
    proposalId: candidate.proposalId,
    decision: 'approve',
    actor: 'synthetic-admin',
    expectedProfileRevision: 0,
    basePersona: cfg.persona
  });
  assert.equal(approved.reviewed, true, JSON.stringify(approved));
  const learned = reflection.getLearnedSelfContext({
    accountId, chatKey, basePersona: cfg.persona
  });
  assert.equal(learned.revision, 1);
  const adoptedPreference = Object.values(learned.context)
    .find((entry) => entry.subject === `user:${senderId}` && entry.key === 'communication_style');
  assert.ok(adoptedPreference, JSON.stringify(learned.context));
  activeSource = chatStore.appendIncoming(chatKey, {
    mid: 'platform-4',
    ts: clock,
    senderId,
    senderName: 'synthetic-member',
    text: 'Please explain the next specific detail.'
  });
  const beforeNextPrompt = requests.length;
  await runner.wake(chatKey);
  const nextReplyerRequest = requests.slice(beforeNextPrompt).find((body) =>
    String(body.messages[0]?.content || '').includes('【阶段：自然回应】'));
  assert.ok(nextReplyerRequest);
  const nextPrompt = String(nextReplyerRequest.messages[1]?.content || '');
  assert.match(nextPrompt, /Prefers a concise conclusion before supporting detail/);
  assert.match(nextPrompt, new RegExp(`user:${senderId}`));
  assert.equal(visibleSends, 4, JSON.stringify(sessions.listSummaries(1)[0]?.socialAudit));
  const beforeEmptyTick = externalBoundaryCalls;
  assert.deepEqual(await runner.runSocialIntentTick(), { claimed: 0 });
  assert.equal(externalBoundaryCalls, beforeEmptyTick);
  const correction = reflection.correctProfileTrait({
    accountId, subject: `user:${senderId}`, key: 'communication_style', scope: 'chat', chatKey,
    action: 'remove', expectedCurrentRevision: learned.revision, basePersona: cfg.persona,
    actor: 'synthetic-admin', reason: 'The user corrected the earlier preference', confirm: true
  });
  assert.equal(correction.revision, 2);
  activeSource = chatStore.appendIncoming(chatKey, { mid: 'platform-5', ts: clock,
    senderId, senderName: 'synthetic-member', text: 'A new question after correcting that preference.' });
  const beforeCorrectedRun = requests.length;
  await runner.wake(chatKey);
  const correctedReply = requests.slice(beforeCorrectedRun).find((body) => String(body.messages[0]?.content || '').includes('【阶段：自然回应】'));
  assert.ok(correctedReply);
  assert.doesNotMatch(String(correctedReply.messages[1]?.content || ''), /Prefers a concise conclusion before supporting detail/);
  assert.equal(visibleSends, 5);
  // Drain the two preceding completions before isolating the split request.
  await runner.pluginManager.drainCompletionEvents();
  while ((await worker.runOnce()).committed) {}
  const splitStart = reflected.length;
  clock += 31 * 60 * 1000;
  for (let part = 0; part < 3; part += 1) {
    activeSource = chatStore.appendIncoming(chatKey, {
      mid: 'split-' + part, ts: clock + part, senderId, senderName: 'synthetic-member',
      text: 'One request, continued detail ' + part,
      ...(part ? { reply: { messageId: 'split-' + (part - 1) } } : {})
    });
    await runner.wake(chatKey);
    await runner.pluginManager.drainCompletionEvents();
    assert.equal((await worker.runOnce()).committed, true);
  }
  const splitEvidence = reflected.slice(splitStart).flatMap((e) => e.conversationEvidence)
    .filter((e) => e.role === 'user' && e.platformMessageId.startsWith('split-'));
  assert.equal(splitEvidence.length, 3);
  assert.equal(new Set(splitEvidence.map((e) => e.originalSourceId)).size, 1, 'three real completion batches share one human root');
  assert.equal(new Set(splitEvidence.map((e) => e.interactionId)).size, 1);
  assert.ok(reflected.slice(splitStart).every((e) => e.conversationEvidence.filter((item) => item.role === 'assistant').every((item) => !item.userEvidence)));
  const reflectedCount = reflected.length;
  await runner.pluginManager.drainCompletionEvents();
  assert.notEqual((await worker.runOnce()).committed, true);
  assert.equal(reflected.length, reflectedCount, 'draining again cannot create learning evidence');
});
