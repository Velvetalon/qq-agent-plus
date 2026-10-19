import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMessagingToolContext } from '../src/plugins/context.js';
import { SocialDraftReviewError } from '../src/conversation/draft-review.js';

// All provider/OneBot boundaries and identifiers are synthetic. No live entrypoint.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-social-face-review-'));
process.env.QQ_AGENT_DATA_DIR = root;
const { DEFAULT_CONFIG, setRuntimeConfig } = await import('../src/core/config.js');
const { ChatStore } = await import('../src/core/store.js');
const { SessionRegistry } = await import('../src/core/sessions.js');
const { Orchestrator } = await import('../src/core/orchestrator.js');
const { SendQueue } = await import('../src/onebot/sender.js');
const { OneBotClient } = await import('../src/onebot/onebot.js');
const { buildToolDefs, executeTool } = await import('../src/tools/tools.js');
const { recordOutboundObservation } = await import('../src/core/action-control.js');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function config() {
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.runtime.mode = 'active'; cfg.allow.groups = ['1']; cfg.conversation.mode = 'social';
  cfg.api = { ...cfg.api, model: 'synthetic-face-review', baseUrl: 'https://face-review.invalid', apiKey: 'synthetic-only', maxRunTokens: 100000 };
  cfg.sticker.enabled = false; cfg.memory.consolidateEnabled = false;
  cfg.send = { ...cfg.send, minGapMs: 1, maxGapMs: 1, byLengthMs: 0, hardSplitAt: 4 };
  setRuntimeConfig(cfg);
  return cfg;
}

function storeFixture(t) {
  config();
  const store = new ChatStore(0, { dataDir: fs.mkdtempSync(path.join(root, 'case-')) });
  t.after(() => store.close());
  return store;
}

function reviewRejected(error) {
  assert.ok(error instanceof SocialDraftReviewError);
  assert.equal(error.result.preflightRejected, true);
  return true;
}

test('face captions cannot bypass a rejecting host review or enter Sender/outbox', async t => {
  const store = storeFixture(t);
  let calls = 0, sends = 0;
  const sender = new SendQueue({ store, onebot: { sendFace: async () => { sends++; return { message_id: 1 }; } } });
  const facade = createMessagingToolContext({ chatKey: 'group:1', sender, store,
    session: { id: 'caption-rejected', leaseId: 'caption-rejected' },
    beforeTextBatch: async (texts, _options, metadata) => {
      calls++;
      assert.deepEqual(texts, ['我昨天亲自修好了生产服务器']);
      assert.equal(metadata.kind, 'face');
      throw new SocialDraftReviewError({ code: 'REVISION_REQUIRED' }, true);
    }
  }).sender;
  await assert.rejects(facade.sendFace('group:other', { id: 14 }, { text: '我昨天亲自修好了生产服务器' }), reviewRejected);
  assert.equal(calls, 1); assert.equal(sends, 0); assert.equal(sender.chains.size, 0);
  assert.deepEqual(store.listRunEffects('caption-rejected'), []);
});

test('send_face tool preserves zero-effect rejection metadata and revision feedback', async () => {
  config();
  const session = { id: 'tool-rejected', leaseId: 'tool-rejected', sent: [] };
  let sends = 0;
  const defs = buildToolDefs().filter(t => t.name === 'send_face').map(t => ({ ...t, ownerPluginId: 'messaging' }));
  const result = await executeTool(defs, { chatKey: 'group:1', kind: 'group', session,
    sender: { sendFace: async () => { sends++; return { message_id: 1 }; } },
    beforeTextBatch: async () => { throw new SocialDraftReviewError({ code: 'REVISION_REQUIRED' }, true); }
  }, 'send_face', JSON.stringify({ name: '14', text: '我昨天已经修复服务器了' }));
  assert.equal(result.preflightRejected, true); assert.equal(result.skipped, true);
  assert.equal(result.errorCode, 'SOCIAL_DRAFT_REVIEW'); assert.equal(result.reportIncident, false);
  assert.equal(JSON.parse(result.content).retryable, true);
  assert.equal(sends, 0); assert.deepEqual(session.sent, []);
  recordOutboundObservation(session, 'send_face', result);
  assert.equal(session.outbound, undefined);
});

test('facade snapshots caption before asynchronous review and adapts confirmed face receipt', async () => {
  const text = '  > **我觉得这是猫的工位** [CQ:literal]  ';
  const options = { text, runId: 'untrusted', beforeSend: () => assert.fail('untrusted guard') };
  const controller = new AbortController();
  const expectedGuard = () => {};
  let reviewed = 0, receipt;
  const data = { message_id: 7 };
  const facade = createMessagingToolContext({ chatKey: 'group:1', signal: controller.signal,
    session: { id: 'snapshot', leaseId: 'snapshot' }, deliveryGuard: expectedGuard,
    beforeTextBatch: async (texts, _options, metadata) => {
      reviewed++; assert.equal(metadata.kind, 'face'); assert.deepEqual(texts, [text]);
      options.text = 'unreviewed replacement';
      await Promise.resolve();
      return { parts: texts, afterDelivery: result => { receipt = result; } };
    }, sender: { sendFace: async (chatKey, _face, bound) => {
      assert.equal(chatKey, 'group:1'); assert.equal(bound.text, text);
      assert.deepEqual(bound.reviewedTextParts, [text]);
      assert.equal(bound.runId, 'snapshot'); assert.equal(bound.signal, controller.signal);
      assert.equal(bound.beforeSend, expectedGuard);
      return data;
    } }
  }).sender;
  assert.equal(await facade.sendFace('group:other', { id: 14 }, options), data);
  assert.equal(reviewed, 1); assert.equal(receipt.sent.length, 1);
});

test('cancellation after caption review prevents Sender and reports no confirmed delivery', async () => {
  const controller = new AbortController();
  let sends = 0, delivered = 0;
  const facade = createMessagingToolContext({ chatKey: 'group:1', signal: controller.signal,
    beforeTextBatch: async texts => {
      controller.abort(new Error('synthetic cancellation'));
      return { parts: texts, afterDelivery: result => { delivered += result?.sent?.length || 0; } };
    }, sender: { sendFace: async () => { sends++; } }
  }).sender;
  await assert.rejects(facade.sendFace('group:1', { id: 14 }, { text: '我觉得很有趣' }), /synthetic cancellation/);
  assert.equal(sends, 0); assert.equal(delivered, 0);
});

test('pure faces and blank captions need no semantic request; legacy captions remain unchanged', async () => {
  let reviews = 0;
  const sent = [];
  const sender = { sendFace: async (_chatKey, _face, options) => { sent.push(options.text); return { message_id: sent.length }; } };
  const social = createMessagingToolContext({ chatKey: 'group:1', sender,
    beforeTextBatch: async () => { reviews++; assert.fail('pure reaction must not review'); }
  }).sender;
  for (const text of [undefined, null, '', ' \n ']) await social.sendFace('group:1', { id: 14 }, { text });
  const legacyText = '> **original legacy caption**';
  await createMessagingToolContext({ chatKey: 'group:1', sender }).sender.sendFace('group:1', { id: 14 }, { text: legacyText });
  assert.equal(reviews, 0); assert.deepEqual(sent, [undefined, null, '', ' \n ', legacyText]);
});

test('Sender rejects mismatching caption approval atomically before chain/outbox', async t => {
  const store = storeFixture(t);
  let sends = 0;
  const sender = new SendQueue({ store, onebot: { sendFace: async () => { sends++; } } });
  for (const [text, reviewedTextParts] of [
    ['not reviewed', ['approved text']],
    ['[CQ:literal]', ['[CQ:literal]']]
  ]) await assert.rejects(Promise.resolve().then(() => sender.sendFace('group:1', { id: 14 }, {
    runId: 'mismatch', text, reviewedTextParts
  })), reviewRejected);
  assert.equal(sends, 0); assert.equal(sender.chains.size, 0);
  assert.deepEqual(store.listRunEffects('mismatch'), []);
});

test('Sender keeps reviewed caption immutable while its queued guard awaits', async t => {
  const store = storeFixture(t);
  const received = [];
  const sender = new SendQueue({ store, onebot: { sendFace: async (_kind, _id, _face, options) => {
    received.push(options.text); return { message_id: 99 };
  } } });
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const options = { runId: 'queue-snapshot', text: '**reviewed literal caption**', reviewedTextParts: ['**reviewed literal caption**'],
    beforeSend: async () => { entered(); await gate; } };
  const pending = sender.sendFace('group:1', { id: 14 }, options);
  t.after(() => release());
  await ready;
  options.text = 'unreviewed queued replacement';
  release(); await pending;
  assert.deepEqual(received, ['**reviewed literal caption**']);
  assert.ok(store.recent('group:1', { limit: 1 })[0].text.startsWith('**reviewed literal caption**'));
  assert.equal(store.listRunEffects('queue-snapshot').length, 1);
});

const verdict = (text, rejected = false) => ({ claimsComplete: true,
  novelty: { repeated: false, previousIds: [], reason: 'synthetic new observation' },
  claims: rejected ? [{ text, kind: 'unsupported', evidence: [] }] : [], issues: [] });

async function integrated(t, mode) {
  const cfg = config();
  if (mode === 'mixed-reject') { cfg.send.hardSplitAt = 0; setRuntimeConfig(cfg); }
  const store = new ChatStore(0, { dataDir: fs.mkdtempSync(path.join(root, 'host-')) });
  const sessions = new SessionRegistry();
  const deliveries = [];
  const protocol = new OneBotClient({});
  protocol.call = async (action, params) => { deliveries.push({ action, params }); return { message_id: 100 + deliveries.length }; };
  const onebot = { selfId: '888', selfNickname: 'synthetic', getGroupInfo: async () => ({ group_name: 'synthetic' }),
    sendFace: protocol.sendFace.bind(protocol), sendText: protocol.sendText.bind(protocol) };
  const runner = new Orchestrator({ store, sessions, onebot, sender: new SendQueue({ store, onebot }),
    stickers: {}, memory: { formatForPrompt: () => '' } });
  const originalFetch = globalThis.fetch;
  t.after(async () => { await runner.abortAll(); store.close(); globalThis.fetch = originalFetch; });
  const source = store.appendIncoming('group:1', { mid: '1', senderId: '42', text: '你觉得这个笑话怎么样？' });
  const good = '  > **我觉得这个角度很新** [CQ:literal] [cq:face,id=14]  ';
  const wireGood = '  > **我觉得这个角度很新** [CQ：literal] [CQ：face,id=14]  ';
  const bad = '我昨天也亲自修复了服务器';
  let normal = 0, reviews = 0;
  const seen = [];
  const response = message => Response.json({ model: cfg.api.model, choices: [{ message }], usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 } });
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://face-review.invalid/chat/completions');
    const body = JSON.parse(options.body);
    if (String(body.messages[0].content).includes('【阶段：发送前语义审核】')) {
      reviews++; assert.equal(body.tools, undefined); assert.equal(body.max_tokens, 768);
      const texts = JSON.parse(body.messages[1].content).drafts;
      assert.equal(texts.length, 1); seen.push(texts[0]);
      if (mode === 'permission') setRuntimeConfig({ ...cfg, runtime: { ...cfg.runtime, mode: 'paused' } });
      if (mode === 'unavailable') return Response.json({ error: 'synthetic unavailable' }, { status: 503 });
      return response({ content: JSON.stringify(verdict(texts[0], mode === 'mixed-reject' || mode === 'revise' && reviews === 1)) });
    }
    normal++;
    if (normal === 1) return response({ content: JSON.stringify({ action: 'react', topicId: null, topic: '笑话',
      targetMessageIds: [String(source.id)], sourceMessageIds: [String(source.id)], sourceRefs: [], goal: '自然反应', novelty: '新角度' }) });
    const sendRound = normal === 2 || (['revise', 'mixed-reject'].includes(mode) && normal === 3);
    if (sendRound) {
      const text = normal === 2 && ['revise', 'mixed-reject'].includes(mode) ? bad : good;
      const useTextRoute = mode === 'mixed-reject' && normal === 2;
      return response({ tool_calls: [{ id: `send:${normal}`, type: 'function', function: {
        name: useTextRoute ? 'send_message' : 'send_face',
        arguments: JSON.stringify(useTextRoute ? { messages: bad } : { name: '14', ...(mode === 'pure' ? {} : { text }) })
      } }] });
    }
    return response({ content: '' });
  };
  await runner.wake('group:1');
  const session = sessions.listSummaries(20).map(s => sessions.get(s.id)).find(s => s.socialAudit?.draftReview);
  assert.ok(session);
  const audit = session.socialAudit.draftReview;
  assert.equal(audit.calls, reviews); assert.equal(session.socialUsage.review.calls, reviews);
  assert.equal(session.callUsage.filter(c => c.phase === 'review').length, reviews);
  if (['mixed-reject', 'permission', 'unavailable'].includes(mode)) {
    assert.deepEqual(deliveries, []); assert.deepEqual(store.listRunEffects(session.leaseId), []);
    if (mode !== 'permission') {
      assert.equal(session.outbound.attempted, 0); assert.equal(session.outbound.failed, 0);
      assert.equal(audit.finalOutcome, 'no_acceptable_output');
    }
    if (mode === 'mixed-reject') { assert.equal(reviews, 2); assert.equal(audit.rejected, 2); }
    if (mode === 'unavailable') { assert.equal(reviews, 1); assert.equal(audit.outcome, 'review_unavailable'); }
    return;
  }
  assert.equal(deliveries.length, 1); assert.equal(session.socialSendActions, 1);
  const segments = deliveries[0].params.message;
  assert.equal(deliveries[0].action, 'send_group_msg');
  assert.equal(segments.at(-1).type, 'face');
  if (mode === 'pure') { assert.equal(reviews, 0); assert.deepEqual(segments.map(s => s.type), ['face']); return; }
  assert.equal(segments[0].type, 'text'); assert.equal(segments[0].data.text, wireGood);
  assert.equal(reviews, mode === 'revise' ? 2 : 1);
  assert.equal(seen.at(-1), segments[0].data.text, 'review matches protocol text, preserving Markdown/whitespace with existing CQ escaping');
  assert.equal(audit.batches.at(-1).delivered, 1);
  assert.equal(audit.finalOutcome, mode === 'revise' ? 'delivered_after_revision' : 'delivered');
  assert.equal(session.outbound.succeeded, 1); assert.equal(audit.reservedTokens, 0);
}

for (const [mode, title] of [
  ['approved', 'approved literal caption is one physical face message with confirmed audit'],
  ['revise', 'rejected face caption must be revised and reviewed again before delivery'],
  ['mixed-reject', 'switching from rejected send_message to send_face cannot reset review budget'],
  ['permission', 'runtime pause during face review still blocks delivery'],
  ['unavailable', 'review HTTP failure stops face delivery without retry or fake external failure'],
  ['pure', 'pure reaction traverses real host without any review model request']
]) test('host integration: ' + title, t => integrated(t, mode));
