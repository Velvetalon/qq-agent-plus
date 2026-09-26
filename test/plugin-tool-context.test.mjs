import assert from 'node:assert/strict';
import test from 'node:test';

import { createToolCallbackContext, snapshotPluginConfig } from '../src/plugins/context.js';
import { buildToolDefs as coreBuildToolDefs } from '../src/tools/tools-core.js';
import { buildToolDefs, executeTool } from '../src/tools/tools.js';

const SECRET = 'TOP-SECRET';

function hostContext() {
  const calls = {
    emits: [],
    identity: [],
    memory: [],
    sender: [],
    stickers: [],
    store: [],
    wakes: []
  };
  const controller = new AbortController();
  const session = {
    id: 'session-1',
    leaseId: 'run-1',
    triggerText: 'probe trigger',
    sent: [],
    feedbacks: []
  };
  const store = {
    activeMembers(chatKey, limit) {
      calls.store.push(['activeMembers', chatKey, limit]);
      return [{ userId: '42', name: 'Current member', lastTs: 1, count: 1 }];
    },
    hasParticipant(chatKey, userId) {
      calls.store.push(['hasParticipant', chatKey, userId]);
      return String(userId) === '42';
    },
    findByMid(chatKey, mid) {
      calls.store.push(['findByMid', chatKey, mid]);
      return String(mid) === '77'
        ? { mid: '77', media: [], senderId: '42', text: 'current message' }
        : null;
    }
  };
  const sender = {
    async sendTextBatch(chatKey, messages, options) {
      calls.sender.push(['text', chatKey, messages, options]);
      return { sent: [{ text: messages[0], messageId: 1 }], failed: [] };
    },
    async sendSticker(chatKey, sticker, options) {
      calls.sender.push(['sticker', chatKey, sticker, options]);
      return { message_id: 2 };
    },
    async sendFace(chatKey, face, options) {
      calls.sender.push(['face', chatKey, face, options]);
      return { message_id: 3 };
    },
    async poke(chatKey, targetUserId, options) {
      calls.sender.push(['poke', chatKey, targetUserId, options]);
      return {};
    }
  };
  const stickers = {
    async findForSend(id) {
      calls.stickers.push(['findForSend', id]);
      return id === 's1'
        ? {
            id: 's1',
            desc: 'sticker',
            localNote: 'probe',
            url: 'base64://AA==',
            source: 'manual',
            localFile: 'probe.png'
          }
        : null;
    },
    async list(query, limit) {
      calls.stickers.push(['list', query, limit]);
      return { stickers: [] };
    },
    markUsed(id, note) {
      calls.stickers.push(['markUsed', id, note]);
      return true;
    }
  };
  const memory = {
    append(chatKey, category, content, extra) {
      calls.memory.push(['append', chatKey, category, content, extra]);
      return { id: 'm1' };
    },
    query(chatKey, category) {
      calls.memory.push(['query', chatKey, category]);
      return { memberImpression: [] };
    },
    remove(chatKey, category, options) {
      calls.memory.push(['remove', chatKey, category, options]);
      return true;
    }
  };
  const identityPilot = {
    active: true,
    lookupPerson(userId, options) {
      calls.identity.push(['lookupPerson', userId, options]);
      return {
        userId,
        primaryName: 'Current member',
        globalMemories: [],
        currentContextMemories: []
      };
    }
  };
  const hostCtx = {
    chatKey: 'group:100',
    kind: 'group',
    chatId: '100',
    selfId: '999',
    selfNickname: 'Self',
    botName: 'Bot',
    behaviorProfile: 'grounded',
    signal: controller.signal,
    onebot: { getMsg: async () => ({ message: [] }) },
    store,
    memory,
    stickers,
    sender,
    identityPilot,
    session,
    runSnapshot: {
      config: {
        api: { apiKey: SECRET },
        server: { token: SECRET },
        safe: { enabled: true },
        toolSchedulerPilot: { enabled: false },
        multimodalContextPilot: { enabled: false }
      },
      generations: { 'probe-plugin': 1 },
      isActive: () => true
    },
    pluginContext: {
      blocks: [{
        id: 'block-1',
        title: `title ${SECRET}`,
        text: `text ${SECRET}`,
        sourceRefs: [`C:\\secret\\${SECRET}`],
        revision: 1
      }],
      diagnostics: [{
        providerId: 'probe.provider',
        elapsedMs: 3,
        candidateCount: 1,
        selectedCount: 1,
        degradedReason: `failure ${SECRET}`
      }],
      degraded: true
    },
    emit(type, payload) {
      calls.emits.push([type, payload]);
    },
    scheduleWake(delayMs, note) {
      calls.wakes.push([delayMs, note]);
      return Date.now() + delayMs;
    }
  };
  return { calls, hostCtx, session };
}

function ownedDefs(ownerPluginId, names) {
  const wanted = new Set(names);
  return coreBuildToolDefs()
    .filter((tool) => wanted.has(tool.name))
    .map((tool) => ({ ...tool, ownerPluginId }));
}

function scheduledCall(name, args = {}) {
  return {
    id: `call-${name}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) }
  };
}

test('generic plugin tool callbacks receive only the safe base context', async () => {
  const { hostCtx } = hostContext();
  let observed = null;
  const defs = [{
    name: 'probe_tool',
    description: 'probe',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    ownerPluginId: 'probe-plugin',
    execute: async (ctx) => {
      observed = ctx;
      return { content: 'ok' };
    }
  }];

  const result = await executeTool(defs, hostCtx, 'probe_tool', '{}');
  assert.equal(result.content, 'ok');
  assert.ok(observed);
  assert.equal(observed.chatKey, 'group:100');
  assert.equal(observed.accountId, '999');
  assert.equal(observed.kind, 'group');
  assert.equal(observed.chatId, '100');
  assert.equal(observed.selfId, '999');
  assert.equal(observed.sessionId, 'session-1');
  assert.equal(observed.runId, 'run-1');
  assert.equal(observed.signal, hostCtx.signal);
  assert.equal(observed.config.api.apiKey, '[redacted]');
  assert.equal(observed.config.server.token, '[redacted]');
  assert.equal(observed.config.safe.enabled, true);
  assert.deepEqual(observed.pluginContext.blocks, [{ id: 'block-1', revision: 1 }]);
  assert.equal(observed.pluginContext.degraded, true);
  assert.equal(JSON.stringify(observed).includes(SECRET), false);
  for (const key of [
    'onebot', 'store', 'sender', 'memory', 'stickers',
    'identityPilot', 'runSnapshot', 'session', 'emit', 'scheduleWake'
  ]) {
    assert.equal(Object.hasOwn(observed, key), false, `${key} must not be exposed`);
  }
  assert.equal(Object.isFrozen(observed), true);
});

test('ownerless tool definitions receive the restricted generic context', async () => {
  const { hostCtx } = hostContext();
  let observed = null;
  const defs = [{
    name: 'ownerless_probe',
    description: 'ownerless probe',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (ctx) => {
      observed = ctx;
      return { content: 'ok' };
    }
  }];

  const result = await executeTool(defs, hostCtx, 'ownerless_probe', '{}');
  assert.equal(result.content, 'ok');
  assert.ok(observed);
  assert.equal(observed.chatKey, 'group:100');
  assert.equal(observed.config.api.apiKey, '[redacted]');
  assert.equal(JSON.stringify(observed).includes(SECRET), false);
  for (const key of [
    'onebot', 'store', 'sender', 'memory', 'stickers',
    'identityPilot', 'runSnapshot', 'session', 'emit', 'scheduleWake'
  ]) {
    assert.equal(Object.hasOwn(observed, key), false, `${key} must not be exposed`);
  }
  assert.equal(Object.isFrozen(observed), true);
});

test('ExperimentalToolBatch prestart uses the restricted tool callback context', async () => {
  const { hostCtx, session } = hostContext();
  const call = scheduledCall('web_search', { query: 'probe' });
  hostCtx.runSnapshot.config.toolSchedulerPilot = { enabled: true, maxParallelReads: 2 };
  session.rounds = 1;
  session.messages = [{ role: 'assistant', tool_calls: [call] }];
  let observed = null;
  const defs = [{
    name: 'web_search',
    description: 'probe',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    ownerPluginId: 'probe-plugin',
    execute: async (ctx) => {
      observed = ctx;
      return { content: 'ok' };
    }
  }];

  const result = await executeTool(defs, hostCtx, 'web_search', call.function.arguments);
  assert.equal(result.content, 'ok');
  assert.ok(observed);
  assert.equal(Object.hasOwn(observed, 'runSnapshot'), false);
  assert.equal(Object.hasOwn(observed, 'session'), false);
  assert.equal(Object.hasOwn(observed, 'store'), false);
  assert.equal(Object.hasOwn(observed, 'sender'), false);
  assert.equal(JSON.stringify(observed).includes(SECRET), false);
});

test('legacy owner still receives the raw host context', async () => {
  const { hostCtx } = hostContext();
  const defs = [{
    name: 'legacy_probe',
    description: 'legacy probe',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    ownerPluginId: 'legacy-tools',
    execute: async (ctx) => ({ content: ctx === hostCtx ? 'raw' : 'restricted' })
  }];
  const result = await executeTool(defs, hostCtx, 'legacy_probe', '{}');
  assert.equal(result.content, 'raw');
});

test('legacy buildToolDefs wrapper marks core definitions for raw compatibility', async () => {
  const { calls, hostCtx } = hostContext();
  const defs = buildToolDefs();
  assert.equal(defs.length, coreBuildToolDefs().length);
  assert.equal(defs.every((tool) => tool.ownerPluginId === 'legacy-tools'), true);

  const result = await executeTool(defs, hostCtx, 'schedule_wake', JSON.stringify({
    minutes: 5,
    note: 'legacy wrapper'
  }));
  assert.equal(result.isError, undefined);
  assert.deepEqual(calls.wakes.at(-1), [300000, 'legacy wrapper']);
});

test('trusted owner facades require both owner id and built-in tool name', () => {
  const { hostCtx } = hostContext();
  const callback = createToolCallbackContext({
    name: 'probe_tool',
    ownerPluginId: 'messaging'
  }, hostCtx);
  assert.equal(Object.hasOwn(callback, 'sender'), false);
  assert.equal(Object.hasOwn(callback, 'stickers'), false);
  assert.equal(Object.hasOwn(callback, 'session'), false);
});

test('messaging facade remains functional and binds chat, run, signal, and session', async () => {
  const { calls, hostCtx, session } = hostContext();
  const defs = ownedDefs('messaging', ['send_message', 'send_sticker', 'send_face', 'send_poke']);
  const sendDef = defs.find((tool) => tool.name === 'send_message');
  const callback = createToolCallbackContext(sendDef, hostCtx);

  await callback.sender.sendTextBatch('group:other', ['bound'], {
    runId: 'attacker-run',
    signal: new AbortController().signal
  });
  assert.deepEqual(calls.sender[0].slice(0, 2), ['text', 'group:100']);
  assert.equal(calls.sender[0][3].runId, 'run-1');
  assert.equal(calls.sender[0][3].signal, hostCtx.signal);

  const sent = await executeTool(defs, hostCtx, 'send_message', JSON.stringify({
    messages: 'hello',
    atUserId: '42'
  }));
  assert.equal(sent.isError, undefined);
  assert.deepEqual(calls.store.at(-1), ['hasParticipant', 'group:100', '42']);
  assert.deepEqual(calls.sender.at(-1).slice(0, 2), ['text', 'group:100']);
  assert.equal(calls.sender.at(-1)[3].runId, 'run-1');
  assert.equal(calls.sender.at(-1)[3].signal, hostCtx.signal);
  assert.equal(session.sent.at(-1).text, 'hello');
  assert.deepEqual(calls.emits.at(-1), ['session-update', {
    sessionId: 'session-1',
    chatKey: 'group:100'
  }]);

  const sticker = await executeTool(defs, hostCtx, 'send_sticker', JSON.stringify({
    stickerId: 's1'
  }));
  assert.equal(sticker.isError, undefined);
  assert.deepEqual(calls.stickers.find((item) => item[0] === 'markUsed'), [
    'markUsed',
    's1',
    'probe trigger'
  ]);
  assert.deepEqual(calls.sender.at(-1).slice(0, 2), ['sticker', 'group:100']);

  const face = await executeTool(defs, hostCtx, 'send_face', JSON.stringify({ name: '14' }));
  assert.equal(face.isError, undefined);
  assert.deepEqual(calls.sender.at(-1).slice(0, 2), ['face', 'group:100']);
  assert.equal(calls.sender.at(-1)[3].runId, 'run-1');

  const poke = await executeTool(defs, hostCtx, 'send_poke', JSON.stringify({
    targetUserId: '42'
  }));
  assert.equal(poke.isError, undefined);
  assert.deepEqual(calls.store.at(-1), ['hasParticipant', 'group:100', '42']);
  assert.deepEqual(calls.sender.at(-1).slice(0, 3), ['poke', 'group:100', 42]);
});

test('memory and runtime-control facades bind current chat, run, and signal', async () => {
  const { calls, hostCtx, session } = hostContext();
  const memoryDefs = ownedDefs('memory-tools', [
    'memory_append', 'memory_query', 'person_memory_lookup', 'memory_remove'
  ]);
  const memoryCallback = createToolCallbackContext(
    memoryDefs.find((tool) => tool.name === 'memory_query'),
    hostCtx
  );

  await memoryCallback.memory.query('group:other');
  assert.deepEqual(calls.memory.at(-1), ['query', 'group:100', undefined]);
  memoryCallback.identityPilot.lookupPerson('42', { chatKey: 'group:other' });
  assert.deepEqual(calls.identity.at(-1), ['lookupPerson', '42', {
    chatKey: 'group:100',
    signal: hostCtx.signal
  }]);

  const appended = await executeTool(memoryDefs, hostCtx, 'memory_append', JSON.stringify({
    category: 'memberImpression',
    userId: '42',
    target: 'Current member',
    content: 'stable preference'
  }));
  assert.equal(appended.isError, undefined);
  assert.deepEqual(calls.memory.at(-1), [
    'append',
    'group:100',
    'memberImpression',
    'stable preference',
    { userId: '42', target: 'Current member' }
  ]);

  const queried = await executeTool(memoryDefs, hostCtx, 'memory_query', '{}');
  assert.equal(queried.isError, undefined);
  assert.deepEqual(calls.memory.at(-1), ['query', 'group:100', undefined]);

  const person = await executeTool(memoryDefs, hostCtx, 'person_memory_lookup', JSON.stringify({
    userId: '42'
  }));
  assert.equal(person.isError, undefined);
  assert.equal(calls.identity.at(-1)[0], 'lookupPerson');
  assert.equal(calls.identity.at(-1)[1], '42');
  assert.equal(calls.identity.at(-1)[2].chatKey, 'group:100');
  assert.equal(calls.identity.at(-1)[2].signal, hostCtx.signal);

  const removed = await executeTool(memoryDefs, hostCtx, 'memory_remove', JSON.stringify({
    category: 'memberImpression',
    userId: '42'
  }));
  assert.equal(removed.isError, undefined);
  assert.deepEqual(calls.memory.at(-1), ['remove', 'group:100', 'memberImpression', {
    userId: '42',
    target: '',
    content: ''
  }]);

  const runtimeDefs = ownedDefs('runtime-control', ['schedule_wake', 'finish']);
  const runtimeCallback = createToolCallbackContext(
    runtimeDefs.find((tool) => tool.name === 'schedule_wake'),
    hostCtx
  );
  const scheduledAt = runtimeCallback.scheduleWake(300000, 'later');
  assert.equal(typeof scheduledAt, 'number');
  assert.deepEqual(calls.wakes.at(-1), [300000, 'later']);
  runtimeCallback.emit('session-update', { sessionId: 'other', chatKey: 'group:other' });
  assert.deepEqual(calls.emits.at(-1), ['session-update', {
    sessionId: 'session-1',
    chatKey: 'group:100'
  }]);
  assert.throws(
    () => runtimeCallback.emit('feedback', { sessionId: 'other' }),
    /不允许发送事件/
  );

  const scheduled = await executeTool(runtimeDefs, hostCtx, 'schedule_wake', JSON.stringify({
    minutes: 5,
    note: 'later'
  }));
  assert.equal(scheduled.isError, undefined);
  assert.deepEqual(calls.wakes.at(-1), [300000, 'later']);

  const finished = await executeTool(runtimeDefs, hostCtx, 'finish', JSON.stringify({
    summary: 'done',
    threadDisposition: 'listening'
  }));
  assert.equal(finished.isError, undefined);
  assert.equal(session.finishReason, 'done');
  assert.equal(session.threadDisposition, 'listening');
  assert.equal(session.handoffDraft.summary, 'done');
});

test('snapshotPluginConfig redacts auth material and token-shaped values', () => {
  const secret = snapshotPluginConfig({
    api: { apiKey: 'fixture-api-key' },
    headers: {
      Authorization: 'Bearer header-value-long',
      Cookie: 'session=cookie-value',
      'X-Normal': 'kept'
    },
    customProvider: {
      authorization: 'Bearer custom-provider',
      clientSecret: 'client-secret-value',
      region: 'ap-southeast-1'
    },
    opaqueMap: {
      providerA: 'sk-provider-A',
      label: 'provider A'
    },
    endpoint: 'https://user:password@example.com/database',
    normalEndpoint: 'https://api.example.com/v1',
    github: ['gho', 'abcdefghijklmnopqrstuvwxyz'].join('_'),
    slack: ['xoxb', '123456789012', 'abcdefghijklmnop'].join('-'),
    jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepart'
  });

  assert.equal(secret.api.apiKey, '[redacted]');
  assert.equal(secret.headers.Authorization, '[redacted]');
  assert.equal(secret.headers.Cookie, '[redacted]');
  assert.equal(secret.headers['X-Normal'], 'kept');
  assert.equal(secret.customProvider.authorization, '[redacted]');
  assert.equal(secret.customProvider.clientSecret, '[redacted]');
  assert.equal(secret.customProvider.region, 'ap-southeast-1');
  assert.equal(secret.opaqueMap.providerA, '[redacted]');
  assert.equal(secret.opaqueMap.label, 'provider A');
  assert.equal(secret.endpoint, '[redacted]');
  assert.equal(secret.normalEndpoint, 'https://api.example.com/v1');
  assert.equal(secret.github, '[redacted]');
  assert.equal(secret.slack, '[redacted]');
  assert.equal(secret.jwt, '[redacted]');
  assert.equal(Object.isFrozen(secret), true);
});
