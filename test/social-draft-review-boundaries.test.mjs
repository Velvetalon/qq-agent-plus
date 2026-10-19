import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  socialDraftEvidence, validateSocialDraftReview, reviewSocialDraft, SocialDraftReviewError
} from '../src/conversation/draft-review.js';
import { createMessagingToolContext } from '../src/plugins/context.js';

// All model responses, QQ receipts, source text and account IDs below are synthetic.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-draft-review-boundaries-'));
process.env.QQ_AGENT_DATA_DIR = root;
const { DEFAULT_CONFIG, setRuntimeConfig } = await import('../src/core/config.js');
const { ChatStore } = await import('../src/core/store.js');
const { SendQueue, prepareTextParts } = await import('../src/onebot/sender.js');
const { Orchestrator } = await import('../src/core/orchestrator.js');
const { SessionRegistry, sessionSocialAuditView } = await import('../src/core/sessions.js');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const verdict = (claims = [], patch = {}) => ({
  claimsComplete: true,
  novelty: { repeated: false, previousIds: [], reason: 'A concrete new observation.' },
  claims, issues: [], ...patch
});
const claimVerdict = (text, kind, evidence) => verdict([{ text, kind, evidence }]);

function activeConfig() {
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.runtime.mode = 'active';
  cfg.allow.groups = ['1'];
  cfg.conversation.mode = 'social';
  cfg.api = { ...cfg.api, model: 'synthetic-boundaries', baseUrl: 'https://draft-boundaries.invalid', apiKey: 'synthetic-only', maxRunTokens: 100000 };
  cfg.sticker.enabled = false;
  cfg.memory.consolidateEnabled = false;
  cfg.send = { ...cfg.send, minGapMs: 1, maxGapMs: 1, byLengthMs: 0, hardSplitAt: 0 };
  setRuntimeConfig(cfg);
  return cfg;
}

test('a successful send receipt cannot launder its own first-person story into action evidence', () => {
  const text = '我上次多改一行注释直接炸了';
  const sources = socialDraftEvidence({
    messages: [{ id: 'old', self: true, text }],
    toolResults: [{ name: 'send_message', effect: 'external-write', args: { messages: text }, result: '{"sent":1}' }]
  });
  assert.equal(sources.some(s => s.kind === 'tool_receipt'), false);
  assert.equal(sources.some(s => s.id.startsWith('tool-data:')), false);
  assert.equal(validateSocialDraftReview(claimVerdict(text, 'action', [
    { sourceId: 'receipt:0', quote: text }
  ]), { drafts: [text], sources }).allowed, false);
  assert.equal(validateSocialDraftReview(claimVerdict(text, 'action', [
    { sourceId: 'message:old', quote: text }
  ]), { drafts: [text], sources }).code, 'REVIEW_EVIDENCE_ACTOR');
});

test('tool-returned stories stay reported data while a successful read has a narrow action witness', () => {
  const text = '我上次多改一行注释直接炸了';
  const sources = socialDraftEvidence({ toolResults: [
    { name: 'lookup', effect: 'read', args: { query: text }, result: text },
    { name: 'failed_lookup', effect: 'read', isError: true, result: text },
    { name: 'skipped_lookup', effect: 'read', skipped: true, result: text }
  ] });
  const witness = sources.find(s => s.kind === 'tool_receipt');
  const data = sources.find(s => s.kind === 'reported_tool_data');
  assert.ok(witness); assert.ok(data);
  assert.equal(witness.text.includes(text), false);
  assert.equal(sources.filter(s => s.kind === 'tool_receipt').length, 1);
  assert.equal(validateSocialDraftReview(claimVerdict(text, 'action', [
    { sourceId: data.id, quote: text }
  ]), { drafts: [text], sources }).code, 'REVIEW_EVIDENCE_ACTOR');
  const action = '我刚调用了lookup查询';
  assert.equal(validateSocialDraftReview(claimVerdict(action, 'action', [
    { sourceId: witness.id, quote: '成功调用工具 lookup' }
  ]), { drafts: [action], sources }).allowed, true);
});

test('identity and attributed memories need typed, quoted evidence; harmless first person remains legal', () => {
  const sources = socialDraftEvidence({
    selfName: '小鲸鱼', messages: [{ id: 7, senderId: '42', text: '我上次解决了503错误' }]
  });
  for (const [text, kind] of [['我是十年运维工程师', 'identity'], ['我记得你上次替我修了电脑', 'attributed']]) {
    assert.equal(validateSocialDraftReview(claimVerdict(text, kind, []), { drafts: [text], sources }).code, 'REVIEW_EVIDENCE_MISSING');
  }
  const identity = '我是AI聊天程序';
  assert.equal(validateSocialDraftReview(claimVerdict(identity, 'identity', [
    { sourceId: 'host:identity', quote: '本助手是AI聊天程序' }
  ]), { drafts: [identity], sources }).allowed, true);
  const attributed = '你说过自己解决了503错误';
  assert.equal(validateSocialDraftReview(claimVerdict(attributed, 'attributed', [
    { sourceId: 'message:7', quote: '我上次解决了503错误' }
  ]), { drafts: [attributed], sources }).allowed, true);
  for (const [text, kind] of [['我觉得这只猫很专业', 'opinion'], ['要是我就先备份', 'hypothetical'], ['这像我的工位', 'metaphor']]) {
    assert.equal(validateSocialDraftReview(claimVerdict(text, kind, []), { drafts: [text], sources }).allowed, true);
  }
});

test('old current targets and selected-topic self utterances survive busy cross-topic traffic', () => {
  const messages = [
    { id: 1, senderId: '42', text: '请记住这个当前回应目标' },
    { id: 20, self: true, text: '编译过了谁动谁死' },
    ...Array.from({ length: 60 }, (_, index) => ({ id: index + 41, senderId: '99', text: '另一话题背景'.repeat(100) }))
  ];
  const sources = socialDraftEvidence({ messages, targetIds: [1], topicSelfIds: [20] });
  assert.equal(sources.find(s => s.id === 'message:1')?.kind, 'human_statement');
  assert.equal(sources.find(s => s.id === 'message:20')?.kind, 'self_utterance');
  const chatSources = sources.filter(s => s.id.startsWith('message:'));
  assert.ok(chatSources.reduce((sum, s) => sum + s.text.length, 0) <= 8000);
  const drafts = ['能跑就别动这是祖训'];
  const reviewed = validateSocialDraftReview(verdict([], {
    novelty: { repeated: true, previousIds: ['message:20'], reason: '仍是不要修改已运行代码的同一包袱' }
  }), { drafts, sources });
  assert.equal(reviewed.code, 'REVISION_REQUIRED');
});

test('review examines actual QQ text after quote, strikeout and code formatting are removed', async () => {
  const rawDrafts = ['> 我已经修好了', '~~我昨天上班了~~', '`我测试过了`'];
  const drafts = prepareTextParts(rawDrafts);
  assert.deepEqual(drafts, ['我已经修好了', '我昨天上班了', '我测试过了']);
  let calls = 0;
  const result = await reviewSocialDraft({ drafts, rawDrafts, sources: socialDraftEvidence(), complete: async request => {
    calls++;
    assert.deepEqual(request.tools, []);
    const input = JSON.parse(request.messages[1].content);
    assert.deepEqual(input.drafts, drafts);
    assert.deepEqual(input.rawDrafts, rawDrafts);
    return { message: { content: JSON.stringify(verdict(drafts.map(text => ({ text, kind: 'unsupported', evidence: [] })))) } };
  } });
  assert.equal(calls, 1);
  assert.equal(result.code, 'REVISION_REQUIRED');
  assert.equal(result.issues.length, 3);
});

test('changing hardSplitAt while review waits rejects atomically before enqueue or outbox writes', async t => {
  const cfg = activeConfig();
  const store = new ChatStore(0, { dataDir: fs.mkdtempSync(path.join(root, 'split-')) });
  t.after(() => store.close());
  let sends = 0;
  const sender = new SendQueue({ store, onebot: { sendText: async () => { sends++; return { message_id: sends }; } } });
  const session = { id: 'review-split', leaseId: 'review-split', socialAudit: {}, socialDelivered: [] };
  let receipt;
  const facade = createMessagingToolContext({ chatKey: 'group:1', store, session, sender,
    beforeTextBatch: async messages => {
      const parts = prepareTextParts(messages, { hardSplitAt: 0 });
      assert.equal(parts.length, 1);
      setRuntimeConfig({ ...cfg, send: { ...cfg.send, hardSplitAt: 4 } });
      return { parts, afterDelivery: (result, error) => { receipt = { result, error }; } };
    }
  }).sender;
  await assert.rejects(facade.sendTextBatch('group:1', ['abcdefghijklmnopqrst']), error => {
    assert.ok(error instanceof SocialDraftReviewError);
    assert.equal(JSON.parse(error.result.content).code, 'REVIEW_PREPARATION_CHANGED');
    return true;
  });
  assert.equal(sends, 0);
  assert.equal(sender.chains.size, 0);
  assert.deepEqual(store.listRunEffects('review-split'), []);
  assert.equal(receipt.result, null);
  assert.ok(receipt.error instanceof SocialDraftReviewError);
});

test('a successful batch followed by a rejected unrevised batch is not a revision success', async t => {
  const cfg = activeConfig();
  const store = new ChatStore(0, { dataDir: fs.mkdtempSync(path.join(root, 'unresolved-')) });
  const sessions = new SessionRegistry();
  const sent = [];
  const onebot = { selfId: '888', selfNickname: 'synthetic', getGroupInfo: async () => ({ group_name: 'synthetic' }),
    sendText: async (_kind, _id, text) => { sent.push(text); return { message_id: 100 + sent.length }; } };
  const runner = new Orchestrator({ store, sessions, onebot, sender: new SendQueue({ store, onebot }),
    stickers: {}, memory: { formatForPrompt: () => '' } });
  const originalFetch = globalThis.fetch;
  t.after(async () => { await runner.abortAll(); store.close(); globalThis.fetch = originalFetch; });
  const source = store.appendIncoming('group:1', { mid: 1, senderId: '42', text: '这张猫图有新角度吗？' });
  const response = message => Response.json({ model: cfg.api.model, choices: [{ message }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } });
  let normal = 0, reviews = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://draft-boundaries.invalid/chat/completions');
    const body = JSON.parse(options.body);
    if (String(body.messages[0].content).includes('【阶段：发送前语义审核】')) {
      reviews++;
      const draft = JSON.parse(body.messages[1].content).drafts[0];
      return response({ content: JSON.stringify(reviews === 1 ? verdict() : claimVerdict(draft, 'unsupported', [])) });
    }
    normal++;
    if (normal === 1) return response({ content: JSON.stringify({ action: 'reply', topicId: null, topic: '猫图',
      targetMessageIds: [String(source.id)], sourceMessageIds: [String(source.id)], sourceRefs: [], goal: '观察图片', novelty: '猫把键盘当坐垫' }) });
    if (normal === 2 || normal === 3) return response({ tool_calls: [{ id: `send:${normal}`, type: 'function',
      function: { name: 'send_message', arguments: JSON.stringify({ messages: normal === 2 ? '猫把键盘当成了加热坐垫' : '我昨天也在工位上睡着了' }) } }] });
    return response({ content: '' });
  };
  await runner.wake('group:1');
  const session = sessions.listSummaries(20).map(s => sessions.get(s.id)).find(s => s.socialAudit?.draftReview);
  assert.ok(session);
  const audit = session.socialAudit.draftReview;
  assert.deepEqual(sent, ['猫把键盘当成了加热坐垫']);
  assert.equal(reviews, 2);
  assert.equal(audit.batches[0].delivered, 1);
  assert.equal(audit.batches[1].approved, false);
  assert.equal(audit.finalOutcome, 'delivered_with_unresolved_draft');
  assert.notEqual(audit.finalOutcome, 'delivered_after_revision');
  assert.equal(session.outbound.succeeded, 1);
  assert.equal(session.outbound.failed, 0);
});

test('session review summary exposes bounded counters but not drafts, quotes or arbitrary private fields', () => {
  const secret = 'SYNTHETIC_PRIVATE_SOURCE_TEXT';
  const source = { version: 1, decision: 'reply', draftReview: { calls: 100, approved: 2, rejected: 1, blocked: 0,
    latencyMs: 1200, reservedTokens: 900, outcome: 'x'.repeat(200), finalOutcome: 'delivered_with_unresolved_draft',
    arbitraryPrivateField: secret, batches: Array.from({ length: 30 }, (_, index) => ({ index, approved: true,
      drafts: [secret], claims: [{ evidence: [{ quote: secret }] }], issues: [{ reason: secret }],
      code: 'C'.repeat(200), delivery: 'D'.repeat(100), delivered: 1, revisionOf: null })) } };
  const view = sessionSocialAuditView(source).draftReview;
  assert.equal(view.calls, 4);
  assert.equal(view.batches.length, 8);
  assert.equal(view.latencyMs, 1200);
  assert.equal(view.finalOutcome, 'delivered_with_unresolved_draft');
  assert.ok(view.outcome.length <= 80);
  assert.ok(view.batches.every(b => b.code.length <= 80 && b.delivery.length <= 40));
  assert.equal(JSON.stringify(view).includes(secret), false);
  assert.equal(Object.hasOwn(view, 'arbitraryPrivateField'), false);
});
