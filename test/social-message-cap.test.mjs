import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { socialReplyerTools } from '../src/conversation/runtime.js';

function fixture({ maxMessagesPerTurn = 3, socialSendActions = 0, countTextParts = null } = {}) {
  const calls = [];
  const original = {
    name: 'send_message', effect: 'external-write', ownerPluginId: 'messaging',
    parameters: { type: 'object', properties: { messages: {
      oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }]
    } }, required: ['messages'] },
    execute: async (ctx, args) => { calls.push({ ctx, args }); return { content: 'sent by fixture' }; }
  };
  const [tool] = socialReplyerTools([original], { maxMessagesPerTurn, countTextParts });
  return { original, tool, calls, ctx: { session: { socialSendActions } } };
}

test('five-message batch is rejected with zero executions; model-compressed three pass unchanged', async () => {
  const { tool, calls, ctx } = fixture();
  const rejected = await tool.execute(ctx, { messages: ['one', 'two', 'three', 'four', 'five'] });
  assert.equal(calls.length, 0);
  assert.equal(rejected.isError, true);
  assert.equal(rejected.skipped, true);
  assert.equal(rejected.errorCode, 'SOCIAL_MESSAGE_BATCH_LIMIT');
  assert.equal(rejected.reportIncident, false);
  const feedback = JSON.parse(rejected.content);
  assert.equal(feedback.requested, 5);
  assert.equal(feedback.remaining, 3);
  assert.equal(feedback.sent, 0);
  assert.equal(feedback.retryable, true);
  assert.match(feedback.error, /自行压缩/);
  assert.equal(ctx.session.socialSendActions, 0);
  assert.equal(ctx.session.socialGuardInvalidated, undefined);
  const compressed = { messages: ['one and two', 'three', 'four and five'], replyToMessageId: 9 };
  const result = await tool.execute(ctx, compressed);
  assert.equal(result.content, 'sent by fixture');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args, compressed, 'the wrapper must not normalize, merge or rewrite actual arguments');
  assert.equal(calls[0].ctx, ctx);
});

test('remaining budget is read at execution: two prior visible actions leave exactly one', async () => {
  const { tool, calls, ctx } = fixture();
  ctx.session.socialSendActions = 2;
  const denied = await tool.execute(ctx, { messages: ['two', 'messages'] });
  assert.equal(calls.length, 0);
  assert.equal(JSON.parse(denied.content).remaining, 1);
  const args = { messages: 'One final natural message.' };
  await tool.execute(ctx, args);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args, args);
  ctx.session.socialSendActions = 3;
  const exhausted = JSON.parse((await tool.execute(ctx, { messages: 'must not send' })).content);
  assert.equal(exhausted.sent, 0);
  assert.equal(exhausted.remaining, 0);
  assert.equal(exhausted.retryable, false);
  assert.equal(calls.length, 1);
});

test('counting uses the messaging normalization for strings, encoded arrays, blanks and legacy shapes', async () => {
  const { tool, calls, ctx } = fixture();
  await tool.execute(ctx, { messages: 'a single message' });
  assert.equal(calls.length, 1);
  const encoded = { messages: JSON.stringify(['one', 'two', 'three', 'four', 'five']) };
  assert.equal((await tool.execute(ctx, encoded)).errorCode, 'SOCIAL_MESSAGE_BATCH_LIMIT');
  assert.equal(calls.length, 1);
  const blanks = { messages: ['one', '', 'two', '   ', 'three'] };
  await tool.execute(ctx, blanks);
  assert.equal(calls.length, 2);
  assert.equal(calls.at(-1).args, blanks);
  const legacy = { messages: [{ text: 'one' }, { text: 'two' }, { text: 'three' }, { text: 'four' }] };
  assert.equal((await tool.execute(ctx, legacy)).errorCode, 'SOCIAL_MESSAGE_BATCH_LIMIT');
  assert.equal(calls.length, 2);
});

test('array schema advertises current cap without changing the original schema or other tools', () => {
  const { tool, original } = fixture({ maxMessagesPerTurn: 2 });
  assert.equal(tool.parameters.properties.messages.oneOf[1].maxItems, 2);
  assert.equal(Object.hasOwn(original.parameters.properties.messages.oneOf[1], 'maxItems'), false);
  assert.notEqual(tool.parameters, original.parameters);
  tool.parameters.properties.messages.oneOf[1].items.type = 'changed';
  assert.equal(original.parameters.properties.messages.oneOf[1].items.type, 'string');
  const read = { name: 'lookup', effect: 'read', parameters: { type: 'object' }, execute: () => 'unchanged' };
  const [copy] = socialReplyerTools([read]);
  assert.equal(copy.execute, read.execute);
  assert.deepEqual(copy.parameters, read.parameters);
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-social-message-cap-'));
process.env.QQ_AGENT_DATA_DIR = root;
const { Orchestrator } = await import('../src/core/orchestrator.js');
const { ChatStore } = await import('../src/core/store.js');
const { SessionRegistry } = await import('../src/core/sessions.js');
const { SendQueue, prepareTextParts } = await import('../src/onebot/sender.js');
const { DEFAULT_CONFIG, setRuntimeConfig } = await import('../src/core/config.js');
process.on('exit', () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });

test('physical preparation preserves sender Markdown, code, filtering and Unicode split semantics', () => {
  const messages = ['**abcd**', '', '   ', '[object Object]', '😀😀😀'];
  assert.deepEqual(prepareTextParts(messages, { hardSplitAt: 4 }), ['abcd', '😀😀', '😀']);
  assert.deepEqual(prepareTextParts('`**123456789012**`', { hardSplitAt: 4 }), ['1234', '5678', '9012']);
  assert.deepEqual(prepareTextParts('`**123456789012**`', { hardSplitAt: 4, preserveCode: true }), ['**12', '3456', '7890', '12**']);
  assert.deepEqual(prepareTextParts('abc\ndef', { hardSplitAt: 3 }), ['abc\n', 'def']);
  assert.deepEqual(prepareTextParts('**abcdefgh**'), ['abcdefgh'], 'no configured split retains existing behavior');
  assert.deepEqual(messages, ['**abcd**', '', '   ', '[object Object]', '😀😀😀'], 'preparation is pure');
});

test('physical-part preflight counts normalized strings without changing original tool arguments', async () => {
  const normalized = [];
  const { tool, calls, ctx } = fixture({ countTextParts: (messages) => {
    normalized.push(messages);
    return prepareTextParts(messages, { hardSplitAt: 4, preserveCode: true }).length;
  } });
  const oversized = { messages: JSON.stringify([{ text: '`**123456789012**`' }, { text: '   ' }]) };
  const denied = JSON.parse((await tool.execute(ctx, oversized)).content);
  assert.deepEqual(normalized[0], ['`**123456789012**`']);
  assert.equal(denied.requested, 4);
  assert.equal(denied.sent, 0);
  assert.equal(calls.length, 0);
  assert.match(denied.error, /长度分片/);
  const shortened = { messages: '123456789012' };
  await tool.execute(ctx, shortened);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args, shortened);
});

async function integration(t, { firstBatch = null, hardSplitAt = 0, behaviorProfile = 'legacy', rejectedBatch, compressedBatch } = {}) {
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.runtime.mode = 'active'; cfg.allow.groups = ['1']; cfg.conversation.mode = 'social';
  cfg.conversation.social.maxMessagesPerTurn = 3;
  cfg.persona.behaviorProfile = behaviorProfile;
  cfg.api = { ...cfg.api, model: 'synthetic-cap', baseUrl: 'https://message-cap.invalid', apiKey: 'synthetic-only' };
  cfg.sticker.enabled = false; cfg.memory.consolidateEnabled = false;
  cfg.send = { ...cfg.send, minGapMs: 1, maxGapMs: 1, byLengthMs: 0, hardSplitAt };
  setRuntimeConfig(cfg);
  const dataDir = fs.mkdtempSync(path.join(root, 'store-'));
  const store = new ChatStore(0, { dataDir });
  const sessions = new SessionRegistry();
  const sent = [];
  const onebot = { selfId: '888', selfNickname: 'synthetic',
    getGroupInfo: async () => ({ group_name: 'synthetic-cap' }),
    sendText: async (_kind, _chat, text) => { sent.push(text); return { message_id: 1000 + sent.length }; } };
  const sender = new SendQueue({ onebot, store });
  const runner = new Orchestrator({ store, sessions, memory: { formatForPrompt: () => '' }, stickers: {}, sender, onebot });
  const originalFetch = globalThis.fetch;
  t.after(async () => { await runner.abortAll(); store.close(); globalThis.fetch = originalFetch; fs.rmSync(dataDir, { recursive: true, force: true }); });
  const source = store.appendIncoming('group:1', { mid: 1, text: 'Please give a concise, useful answer.', senderId: '42', senderName: 'synthetic-member' });
  const response = (message) => Response.json({ choices: [{ message }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } });
  const sendCall = (id, messages) => response({ tool_calls: [{ id, type: 'function', function: { name: 'send_message', arguments: JSON.stringify({ messages, replyToMessageId: 1 }) } }] });
  let calls = 0;
  let feedback;
  const compressed = compressedBatch ?? (firstBatch ? ['Finally, ask for help if needed.'] : ['First, pause and assess the situation.', 'Next, focus on the immediate priority.', 'Finally, ask for help if needed.']);
  const rejected = rejectedBatch ?? (firstBatch ? ['Too', 'many'] : ['one', 'two', 'three', 'four', 'five']);
  const preparation = { hardSplitAt, preserveCode: behaviorProfile === 'grounded' };
  const firstParts = prepareTextParts(firstBatch || [], preparation);
  const compressedParts = prepareTextParts(compressed, preparation);
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(String(url)).hostname, 'message-cap.invalid');
    const request = JSON.parse(options.body);
    calls += 1;
    if (calls === 1) return response({ content: JSON.stringify({ action: 'reply', topicId: null, topic: 'current question',
      targetMessageIds: [String(source.id)], sourceMessageIds: [String(source.id)], sourceRefs: [], goal: 'Provide concise help', novelty: 'Practical next steps', initiative: null }) });
    const schema = request.tools.find((tool) => tool.function.name === 'send_message').function.parameters;
    assert.equal(schema.properties.messages.oneOf.find((variant) => variant.type === 'array').maxItems, 3);
    if (firstBatch && calls === 2) return sendCall('initial-two', firstBatch);
    const rejectionCall = firstBatch ? 3 : 2;
    if (calls === rejectionCall) return sendCall('oversized', rejected);
    if (calls === rejectionCall + 1) {
      assert.equal(sent.length, firstParts.length, 'rejected batch must deliver zero of its physical parts');
      const latest = sessions.get(sessions.listSummaries(1)[0].id);
      assert.equal(store.listRunEffects(latest.leaseId).length, firstParts.length, 'rejected batch must not enter the outbox');
      assert.notEqual(latest.socialGuardInvalidated, true, 'model must be allowed to supply a compressed call');
      feedback = JSON.parse(request.messages.findLast((message) => message.role === 'tool').content);
      assert.equal(feedback.code, 'SOCIAL_MESSAGE_BATCH_LIMIT');
      assert.equal(feedback.remaining, firstBatch ? 1 : 3);
      assert.equal(feedback.requested, prepareTextParts(rejected, preparation).length);
      assert.equal(feedback.sent, 0);
      return sendCall('compressed-retry', compressed);
    }
    return response({ content: 'done' });
  };
  await runner.wake('group:1');
  const session = sessions.get(sessions.listSummaries(1)[0].id);
  assert.equal(calls, firstBatch ? 5 : 4, JSON.stringify({ error: session.error, finish: session.finishReason, audit: session.socialAudit }));
  assert.deepEqual(sent, [...firstParts, ...compressedParts]);
  assert.equal(session.socialSendActions, 3);
  assert.equal(session.socialAudit.delivered, true);
  assert.notEqual(session.socialAudit.dispatchBlocked, 'partial_delivery');
  assert.equal(session.outbound.succeeded, 3);
  assert.equal(session.outbound.failed, 0);
  assert.equal(store.listRunEffects(session.leaseId).length, 0, 'completed run cleans its confirmed outbox entries');
  assert.equal(session.messages.filter((message) => message.toolCall?.errorCode === 'SOCIAL_MESSAGE_BATCH_LIMIT').length, 1);
}

test('real Orchestrator/SendQueue rejects five atomically, then delivers model-compressed three', async (t) => integration(t));
test('real Orchestrator/SendQueue preserves two prior sends, rejects two, then delivers only remaining one', async (t) => integration(t, {
  firstBatch: ['First, pause and assess the situation.', 'Next, focus on the immediate priority.']
}));

test('real Orchestrator/SendQueue rejects one string split into four before outbox, then sends model-shortened three parts', async (t) => integration(t, {
  hardSplitAt: 4, rejectedBatch: '1234567890123456', compressedBatch: '123456789012'
}));

test('real Orchestrator/SendQueue preflight matches grounded preserved-code physical parts', async (t) => integration(t, {
  hardSplitAt: 4, behaviorProfile: 'grounded', rejectedBatch: '`**123456789012**`', compressedBatch: '123456789012'
}));

test('real Orchestrator/SendQueue counts split text against remaining budget after prior sends', async (t) => integration(t, {
  hardSplitAt: 4, firstBatch: ['one', 'two'], rejectedBatch: '12345678', compressedBatch: 'last'
}));
