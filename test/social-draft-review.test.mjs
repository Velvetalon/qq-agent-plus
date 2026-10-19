import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { socialDraftEvidence, validateSocialDraftReview, reviewSocialDraft, SocialDraftReviewError } from '../src/conversation/draft-review.js';
import { createMessagingToolContext } from '../src/plugins/context.js';
import { recordOutboundObservation } from '../src/core/action-control.js';

const verdict = (patch = {}) => ({ claimsComplete: true, novelty: { repeated: false, previousIds: [], reason: '具体新内容' }, claims: [], issues: [], ...patch });
const sources = socialDraftEvidence({ messages: [
  { id: 1, senderId: 'human', text: '我上次改注释把编译搞炸了' },
  { id: 2, self: true, text: '先检查配置，再重启。' },
  { id: 3, self: true, text: '我上次改注释把编译搞炸了' }
], memoryText: '小林上次解决了503', toolResults: [{ name: 'lookup', effect: 'read', args: {}, result: '查询成功：42' }] });

test('review requires complete structured analysis and exact quoted evidence, not an allowed flag', () => {
  assert.equal(validateSocialDraftReview({ allowed: true }, { drafts: ['hello'], sources }).allowed, false);
  for (const raw of ['bad', {}, verdict({ claimsComplete: false }), verdict({ novelty: {} }), verdict({ claims: [{ text: 'not in draft', kind: 'identity', evidence: [] }] })]) {
    assert.equal(validateSocialDraftReview(raw, { drafts: ['hello'], sources }).allowed, false);
  }
  assert.equal(validateSocialDraftReview(verdict(), { drafts: ['hello'], sources }).allowed, true);
});

test('host forbids human or circular assistant statements as proof of assistant actions', () => {
  const drafts = ['我上次改注释把编译搞炸了'];
  for (const sourceId of ['message:1', 'message:3']) {
    const result = validateSocialDraftReview(verdict({ claims: [{ text: drafts[0], kind: 'action', evidence: [{ sourceId, quote: drafts[0] }] }] }), { drafts, sources });
    assert.equal(result.code, 'REVIEW_EVIDENCE_ACTOR');
  }
  const missing = validateSocialDraftReview(verdict({ claims: [{ text: drafts[0], kind: 'action', evidence: [] }] }), { drafts, sources });
  assert.equal(missing.code, 'REVIEW_EVIDENCE_MISSING');
});

test('sourced speech and actual tool action, opinion, metaphor and hypothetical remain allowed', () => {
  for (const [text, kind, evidence] of [
    ['我刚才说先检查配置', 'utterance', [{ sourceId: 'message:2', quote: '先检查配置' }]],
    ['我刚查询到了42', 'action', [{ sourceId: 'receipt:0', quote: '成功调用工具 lookup' }]],
    ['我觉得这只猫很专业', 'opinion', []], ['这像我的工位', 'metaphor', []],
    ['要是我就先备份', 'hypothetical', []], ['你上次解决了503', 'attributed', [{ sourceId: 'memory:people', quote: '小林上次解决了503' }]]
  ]) assert.equal(validateSocialDraftReview(verdict({ claims: [{ text, kind, evidence }] }), { drafts: [text], sources }).allowed, true, text);
});

test('unknown source, mismatching quote, and semantic repeated verdict reject', () => {
  for (const evidence of [[{ sourceId: 'invented', quote: '42' }], [{ sourceId: 'receipt:0', quote: 'not there' }]]) {
    assert.equal(validateSocialDraftReview(verdict({ claims: [{ text: '我查到了42', kind: 'action', evidence }] }), { drafts: ['我查到了42'], sources }).allowed, false);
  }
  const repeated = validateSocialDraftReview(verdict({ novelty: { repeated: true, previousIds: ['message:2'], reason: '仍然是相同检查配置建议' } }), { drafts: ['先看配置再重新启动'], sources });
  assert.equal(repeated.code, 'REVISION_REQUIRED');
  assert.equal(repeated.issues[0].type, 'repeated_meaning');
});

test('review has no tools and passes raw/display view without accepting tool-call verdicts', async () => {
  let request;
  const result = await reviewSocialDraft({ drafts: ['我改过代码'], rawDrafts: ['> 我改过代码'], sources, complete: async args => {
    request = args; return { message: { content: JSON.stringify(verdict()), tool_calls: [{ id: 'bad' }] } };
  } });
  assert.deepEqual(request.tools, []); assert.equal(request.maxTokens, 768);
  const input = JSON.parse(request.messages[1].content);
  assert.deepEqual(input.rawDrafts, ['> 我改过代码']); assert.deepEqual(input.drafts, ['我改过代码']);
  assert.equal(result.code, 'REVIEW_INVALID');
});

test('all facade text routes reject before underlying Sender and preserve abort after review', async () => {
  let sends = 0;
  const controller = new AbortController();
  const host = { chatKey: 'group:1', signal: controller.signal, sender: { sendTextBatch: async () => { sends++; } },
    beforeTextBatch: async () => { throw new SocialDraftReviewError({ code: 'REVISION_REQUIRED' }, true); } };
  await assert.rejects(createMessagingToolContext(host).sender.sendTextBatch('other', ['invented']), SocialDraftReviewError);
  assert.equal(sends, 0);
  host.beforeTextBatch = async () => controller.abort();
  await assert.rejects(createMessagingToolContext(host).sender.sendTextBatch('other', ['allowed']));
  assert.equal(sends, 0);
});

test('only definite preflight rejection avoids external-effect audit, ordinary failure remains', () => {
  const session = {};
  recordOutboundObservation(session, 'send_message', new SocialDraftReviewError({ code: 'REVISION_REQUIRED' }).result);
  assert.equal(session.outbound, undefined);
  recordOutboundObservation(session, 'send_message', { isError: true, skipped: true, errorCode: 'arbitrary' });
  assert.equal(session.outbound.effects[0].state, 'failed');
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-draft-review-'));
process.env.QQ_AGENT_DATA_DIR = root;
const { DEFAULT_CONFIG, setRuntimeConfig } = await import('../src/core/config.js');
const { Orchestrator } = await import('../src/core/orchestrator.js');
const { ChatStore } = await import('../src/core/store.js');
const { SessionRegistry } = await import('../src/core/sessions.js');
const { SendQueue } = await import('../src/onebot/sender.js');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

async function integration(t, { malformed = false, cancel = false, rejectTwice = false } = {}) {
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.runtime.mode = 'active'; cfg.allow.groups = ['1']; cfg.conversation.mode = 'social';
  cfg.api = { ...cfg.api, model: 'synthetic-review', baseUrl: 'https://draft-review.invalid', apiKey: 'synthetic', maxRunTokens: 100000 };
  cfg.sticker.enabled = false; cfg.memory.consolidateEnabled = false;
  cfg.send = { ...cfg.send, minGapMs: 0, maxGapMs: 0, byLengthMs: 0 }; setRuntimeConfig(cfg);
  const store = new ChatStore(0, { dataDir: fs.mkdtempSync(path.join(root, 'case-')) });
  const sessions = new SessionRegistry(); const sent = [];
  const onebot = { selfId: '888', selfNickname: 'test', getGroupInfo: async () => ({ group_name: 'synthetic' }),
    sendText: async (_kind, _chat, text) => { sent.push(text); return { message_id: 100 + sent.length }; } };
  const runner = new Orchestrator({ store, sessions, onebot, sender: new SendQueue({ onebot, store }), memory: { formatForPrompt: () => '' }, stickers: {} });
  const originalFetch = globalThis.fetch;
  t.after(async () => { await runner.abortAll(); store.close(); globalThis.fetch = originalFetch; });
  const source = store.appendIncoming('group:1', { mid: '1', senderId: '42', text: '看这张猫图，你换个新角度说两句。' });
  const response = message => Response.json({ model: cfg.api.model, choices: [{ message }], usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 } });
  let normal = 0, reviews = 0;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body); assert.equal(body.model, 'synthetic-review');
    if (String(body.messages[0].content).includes('【阶段：发送前语义审核】')) {
      reviews++; assert.equal(body.tools, undefined); assert.equal(sent.length, 0);
      if (cancel) { setRuntimeConfig({ ...cfg, runtime: { ...cfg.runtime, mode: 'paused' } }); return response({ content: JSON.stringify(verdict()) }); }
      if (malformed) return response({ content: '{broken' });
      const text = JSON.parse(body.messages[1].content).drafts[0];
      if (reviews === 1 || rejectTwice) return response({ content: JSON.stringify(verdict({ claims: [{ text, kind: 'unsupported', evidence: [] }] })) });
      return response({ content: JSON.stringify(verdict()) });
    }
    normal++;
    if (normal === 1) return response({ content: JSON.stringify({ action: 'reply', topicId: null, topic: '猫图', targetMessageIds: [String(source.id)], sourceMessageIds: [String(source.id)], sourceRefs: [], goal: '合适回应', novelty: '新角度' }) });
    if (normal === 2 || normal === 3) return response({ tool_calls: [{ id: `send${normal}`, type: 'function', function: { name: 'send_message', arguments: JSON.stringify({ messages: normal === 2 ? '我上次改注释炸了' : rejectTwice ? '我昨天也遇到过' : '猫已经把键盘当成加热坐垫了' }) } }] });
    return response({ content: '' });
  };
  await runner.wake('group:1');
  const session = sessions.listSummaries(20).map(s => sessions.get(s.id)).find(s => s.socialAudit);
  const audit = session.socialAudit.draftReview;
  assert.equal(audit.calls, reviews); assert.equal(session.socialUsage.review.calls, reviews);
  assert.equal(session.callUsage.filter(c => c.phase === 'review').length, reviews);
  assert.equal(audit.reservedTokens, 0);
  if (malformed || cancel || rejectTwice) assert.deepEqual(sent, []);
  else { assert.deepEqual(sent, ['猫已经把键盘当成加热坐垫了']); assert.equal(audit.finalOutcome, 'delivered_after_revision'); }
  if (malformed || rejectTwice) {
    assert.equal(session.outbound.attempted, 0); assert.equal(session.outbound.failed, 0);
    assert.equal(audit.finalOutcome, 'no_acceptable_output');
  }
  if (rejectTwice) assert.equal(reviews, 2);
}

test('default real host path reviews then model revises before the first actual send', t => integration(t));
test('malformed review fails closed without fake external failure', t => integration(t, { malformed: true }));
test('two rejected drafts stop with no acceptable output, never natural-silence PASS', t => integration(t, { rejectTwice: true }));
test('permissions changed during review still block actual delivery', t => integration(t, { cancel: true }));
