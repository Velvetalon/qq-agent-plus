import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as reviewModule from '../src/conversation/draft-review.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-review-budget-'));
process.env.QQ_AGENT_DATA_DIR = root;
const { DEFAULT_CONFIG, CONFIG_FILE, loadConfig, updateConfig, setRuntimeConfig } = await import('../src/core/config.js');
const { Orchestrator } = await import('../src/core/orchestrator.js');
const { SessionRegistry } = await import('../src/core/sessions.js');
const { ChatStore } = await import('../src/core/store.js');
const { SendQueue } = await import('../src/onebot/sender.js');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const normalize = value => reviewModule.normalizeSocialDraftReviewLimits(value);
const verdict = { claimsComplete: true, novelty: { repeated: false, previousIds: [], reason: 'synthetic new fact' }, claims: [], issues: [] };

test('review limits preserve old defaults and normalize bounded finite numbers only', () => {
  assert.deepEqual(normalize(), { maxOutputTokens: 768, timeoutMs: 15000 });
  assert.deepEqual(normalize({ maxOutputTokens: '2048', timeoutMs: 45000.4 }), { maxOutputTokens: 2048, timeoutMs: 45000 });
  assert.deepEqual(normalize({ maxOutputTokens: -1, timeoutMs: -1 }), { maxOutputTokens: 128, timeoutMs: 1000 });
  assert.deepEqual(normalize({ maxOutputTokens: 1e12, timeoutMs: 1e12 }), { maxOutputTokens: 4096, timeoutMs: 60000 });
  for (const value of ['', ' ', NaN, Infinity, -Infinity, null, true, false, {}, [], 'bad']) {
    assert.deepEqual(normalize({ maxOutputTokens: value, timeoutMs: value }), { maxOutputTokens: 768, timeoutMs: 15000 });
  }
});

test('advanced review configuration persists and survives unrelated patches without changing mode', () => {
  assert.equal(DEFAULT_CONFIG.conversation.social.reviewMaxOutputTokens, 768);
  assert.equal(DEFAULT_CONFIG.conversation.social.reviewTimeoutMs, 15000);
  const configured = updateConfig({ conversation: { social: { reviewMaxOutputTokens: 2048, reviewTimeoutMs: 45000 } } });
  assert.equal(configured.conversation.mode, 'legacy');
  updateConfig({ ui: { refreshMs: 4000 } });
  const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  assert.equal(saved.conversation.social.reviewMaxOutputTokens, 2048);
  assert.equal(saved.conversation.social.reviewTimeoutMs, 45000);
  const clamped = updateConfig({ conversation: { social: { reviewMaxOutputTokens: 1e10, reviewTimeoutMs: 0 } } });
  assert.equal(clamped.conversation.social.reviewMaxOutputTokens, 4096);
  assert.equal(clamped.conversation.social.reviewTimeoutMs, 1000);
});

test('loadConfig normalizes review fields without rewriting source bytes or other configuration', () => {
  for (const [tokens, timeout, expected] of [
    [999999, 0, { maxOutputTokens: 4096, timeoutMs: 1000 }],
    [true, 'bad', { maxOutputTokens: 768, timeoutMs: 15000 }],
    ['2048', '45000', { maxOutputTokens: 2048, timeoutMs: 45000 }]
  ]) {
    const raw = JSON.stringify({ api: { apiKey: 'synthetic-preserved' }, conversation: { mode: 'social', social: { reviewMaxOutputTokens: tokens, reviewTimeoutMs: timeout } } });
    fs.writeFileSync(CONFIG_FILE, raw);
    const loaded = loadConfig();
    assert.equal(loaded.conversation.social.reviewMaxOutputTokens, expected.maxOutputTokens);
    assert.equal(loaded.conversation.social.reviewTimeoutMs, expected.timeoutMs);
    assert.equal(loaded.conversation.mode, 'social');
    assert.equal(loaded.api.apiKey, 'synthetic-preserved');
    assert.equal(fs.readFileSync(CONFIG_FILE, 'utf8'), raw);
  }
  for (const conversation of [null, 'invalid', { mode: 'social', social: [] }]) {
    const raw = JSON.stringify({ api: { apiKey: 'synthetic-preserved' }, conversation });
    fs.writeFileSync(CONFIG_FILE, raw);
    const loaded = loadConfig();
    assert.equal(loaded.conversation.social.reviewMaxOutputTokens, 768);
    assert.equal(loaded.conversation.social.reviewTimeoutMs, 15000);
    assert.equal(loaded.api.apiKey, 'synthetic-preserved');
    assert.equal(fs.readFileSync(CONFIG_FILE, 'utf8'), raw);
  }
});

test('review request uses the configured cap while preserving strict validation and single dispatch', async () => {
  let calls = 0;
  const result = await reviewModule.reviewSocialDraft({ drafts: ['新角度'], sources: [],
    limits: { maxOutputTokens: 2048, timeoutMs: 45000 }, complete: async args => {
      calls++; assert.equal(args.maxTokens, 2048); assert.deepEqual(args.tools, []);
      return { message: { content: JSON.stringify(verdict) }, finishReason: 'stop' };
    }
  });
  assert.equal(calls, 1); assert.equal(result.allowed, true);
});

test('a truncated or filtered verdict is not accepted even when its JSON looks complete', async () => {
  for (const finishReason of ['length', 'content_filter']) {
    const result = await reviewModule.reviewSocialDraft({ drafts: ['新角度'], sources: [], complete: async () => ({
      finishReason, message: { content: JSON.stringify(verdict) }
    }) });
    assert.equal(result.allowed, false); assert.equal(result.code, 'REVIEW_INCOMPLETE');
  }
  const malformed = await reviewModule.reviewSocialDraft({ drafts: ['新角度'], sources: [],
    limits: { maxOutputTokens: 4096 }, complete: async () => ({ message: { content: 'private reasoning then invalid JSON' } }) });
  assert.equal(malformed.code, 'REVIEW_INVALID');
});

async function hostCase(t, mode) {
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.runtime.mode = 'active'; cfg.allow.groups = ['1']; cfg.conversation.mode = 'social';
  cfg.api = { ...cfg.api, model: 'synthetic-budget', baseUrl: 'https://review-budget.invalid', apiKey: 'synthetic-only', maxRunTokens: mode === 'budget' ? 20000 : 100000 };
  cfg.conversation.social.reviewMaxOutputTokens = mode === 'budget' ? 4096 : 2048;
  cfg.conversation.social.reviewTimeoutMs = mode === 'timeout' ? 1000 : 45000;
  const expectedLimits = { maxOutputTokens: cfg.conversation.social.reviewMaxOutputTokens, timeoutMs: cfg.conversation.social.reviewTimeoutMs };
  cfg.sticker.enabled = false; cfg.memory.consolidateEnabled = false;
  cfg.send = { ...cfg.send, minGapMs: 1, maxGapMs: 1, byLengthMs: 0 };
  setRuntimeConfig(cfg);
  const store = new ChatStore(0, { dataDir: fs.mkdtempSync(path.join(root, 'host-')) });
  const sessions = new SessionRegistry();
  const sent = [];
  const onebot = { selfId: '888', selfNickname: 'synthetic', getGroupInfo: async () => ({ group_name: 'synthetic' }),
    sendText: async (_kind, _id, text) => { sent.push(text); return { message_id: 101 }; } };
  const injected = ['budget', 'unknown'].includes(mode) ? { socialDraftReviewer: async ({ complete }) => {
    await complete({ messages: [{ role: 'user', content: 'x' }], tools: [], maxTokens: mode === 'budget' ? 1 : 999999 });
    return { allowed: true, code: 'APPROVED', issues: [], claims: [] };
  } } : {};
  const runner = new Orchestrator({ store, sessions, onebot, sender: new SendQueue({ store, onebot }), memory: { formatForPrompt: () => '' }, stickers: {}, ...injected });
  const originalFetch = globalThis.fetch;
  t.after(async () => { await runner.abortAll(); store.close(); globalThis.fetch = originalFetch; });
  const timeoutCalls = [];
  const timeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, 'timeout', ms => { timeoutCalls.push(ms); return timeout(ms); });
  const source = store.appendIncoming('group:1', { mid: '9001', senderId: '42', text: '请给一个新的观察。' });
  let ordinary = 0, reviews = 0;
  const response = (message, phase) => Response.json({ model: cfg.api.model, choices: [{ message, finish_reason: mode === 'truncated' && phase === 'review' ? 'length' : 'stop' }],
    ...(mode === 'unknown' && phase === 'review' ? {} : { usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: mode === 'budget' ? (phase === 'planner' ? 9500 : 9000) : 20 } }) });
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://review-budget.invalid/chat/completions');
    const body = JSON.parse(options.body);
    const isReview = body.messages[0].content === 'x' || String(body.messages[0].content).includes('【阶段：发送前语义审核】');
    if (isReview) {
      reviews++; assert.equal(body.max_tokens, expectedLimits.maxOutputTokens);
      if (mode === 'timeout') return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
      return response({ content: JSON.stringify(verdict) }, 'review');
    }
    ordinary++;
    if (ordinary === 1) {
      if (mode === 'mutate') {
        cfg.conversation.social.reviewMaxOutputTokens = 4096;
        cfg.conversation.social.reviewTimeoutMs = 60000;
      }
      return response({ content: JSON.stringify({ action: 'reply', topicId: null, topic: '新观察', targetMessageIds: [String(source.id)], sourceMessageIds: [String(source.id)], sourceRefs: [], goal: '回答', novelty: '新内容' }) }, 'planner');
    }
    if (ordinary === 2) return response({ tool_calls: [{ id: 'send', type: 'function', function: { name: 'send_message', arguments: JSON.stringify({ messages: '这是一个新角度。' }) } }] }, 'replyer');
    return response({ content: '' }, 'replyer');
  };
  await runner.wake('group:1');
  const session = sessions.listSummaries(20).map(s => sessions.get(s.id)).find(s => s.socialAudit?.draftReview);
  assert.ok(session);
  const audit = session.socialAudit.draftReview;
  assert.deepEqual(audit.limits, expectedLimits);
  if (mode === 'budget') {
    assert.equal(reviews, 0); assert.equal(audit.calls, 0); assert.equal(session.budgetStopReason, 'social-review-budget');
  } else {
    assert.equal(reviews, 1); assert.ok(timeoutCalls.includes(expectedLimits.timeoutMs));
  }
  if (['budget', 'timeout', 'truncated'].includes(mode)) {
    assert.deepEqual(sent, []); assert.deepEqual(store.listRunEffects(session.leaseId), []);
    assert.equal(audit.finalOutcome, 'no_acceptable_output');
    assert.equal(session.outbound.attempted, 0);
    if (mode === 'truncated') assert.equal(audit.batches[0].code, 'REVIEW_INCOMPLETE');
  } else {
    assert.deepEqual(sent, ['这是一个新角度。']);
    if (mode === 'unknown') assert.ok(audit.reservedTokens >= 2048, 'unknown usage keeps the full configured output reservation');
    else assert.equal(audit.reservedTokens, 0);
  }
}
for (const mode of ['configured', 'unknown', 'budget', 'truncated', 'timeout', 'mutate']) {
  test('host review budget: ' + mode, t => hostCase(t, mode));
}
