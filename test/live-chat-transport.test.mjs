import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedChatTransport, LIVE_ENDPOINT, LIVE_MODEL } from './live/bounded-chat-transport.mjs';
const key = 'synthetic-fixture-key';
const request = () => ({ method: 'POST', body: JSON.stringify({ model: LIVE_MODEL, stream: false, messages: [{ role: 'user', content: '合成测试' }] }) });
function setup(options = {}) {
  const records = []; const calls = [];
  const transport = boundedChatTransport({ key, record: v => records.push(v), fetchImpl: async (url, req) => { calls.push({url, req}); return Response.json({ model: LIVE_MODEL, choices: [{message: {content: '测试回复'}}], usage: { total_tokens: 12 } }); }, ...options });
  return { ...transport, records, calls };
}
test('live boundary permits exact chat route/model only and forces finite output', async () => {
  const t = setup();
  assert.equal((await t.fetch(LIVE_ENDPOINT, request())).status, 200);
  assert.equal(JSON.parse(t.calls[0].req.body).max_tokens, 2048);
  assert.equal(t.calls[0].req.redirect, 'error');
  assert.equal(t.stats.tokens, 12);
  assert.equal(t.stats.reservedUnknownTokens, 0);
  assert.equal(JSON.stringify(t.records).includes(key), false);
  for (const url of ['https://nano-gpt.com/api/v1/embeddings', 'https://onebot.invalid/send_group_msg', LIVE_ENDPOINT+'?leak=1']) await assert.rejects(t.fetch(url, request()), /DESTINATION_BLOCKED/);
  const other = request(); other.body = other.body.replace(LIVE_MODEL, 'other/model');
  await assert.rejects(t.fetch(LIVE_ENDPOINT, other), /MODEL_OR_MODE_BLOCKED/);
  assert.equal(t.calls.length, 1);
});
test('live boundary refuses calls and token budget before outbound request', async () => {
  const t = setup({ maxCalls: 1 }); await t.fetch(LIVE_ENDPOINT, request());
  await assert.rejects(t.fetch(LIVE_ENDPOINT, request()), /BUDGET_EXHAUSTED/);
  assert.equal(t.calls.length, 1);
  const small = setup({maxTokens: 5});
  await assert.rejects(small.fetch(LIVE_ENDPOINT, request()), /BUDGET_EXHAUSTED/);
  assert.equal(small.calls.length, 0);
});
test('live boundary redacts provider errors and does not retry uncertain failure', async () => {
  let calls = 0;
  const t = setup({ fetchImpl: async () => { calls++; throw new Error(`failed ${key}`); } });
  await assert.rejects(t.fetch(LIVE_ENDPOINT, request()), /\[REDACTED\]/);
  await assert.rejects(t.fetch(LIVE_ENDPOINT, request()), /PREVIOUS_FAILURE_STOPPED/);
  assert.equal(calls, 1);
  assert.equal(t.stats.errors, 1);
  assert.ok(t.stats.reservedUnknownTokens > 0);
  assert.equal(JSON.stringify(t.records).includes(key), false);
});
test('live boundary disallows parallel HTTP and honors timeout', async () => {
  const t = setup({ timeoutMs: 20, fetchImpl: async (_url, {signal}) => new Promise((_,reject) => signal.addEventListener('abort', () => reject(signal.reason))) });
  const keepAlive = setTimeout(() => {}, 50);
  try {
    const first = t.fetch(LIVE_ENDPOINT, request());
    await assert.rejects(t.fetch(LIVE_ENDPOINT, request()), /PARALLEL_REQUEST_BLOCKED/);
    await assert.rejects(first, /aborted|timeout/i);
    assert.equal(t.stats.calls, 1);
  } finally { clearTimeout(keepAlive); }
});
