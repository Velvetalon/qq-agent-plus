import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-interest-app-'));
process.env.QQ_AGENT_DATA_DIR = root;
const { DEFAULT_CONFIG, updateConfig } = await import('../src/core/config.js');
const { createApp } = await import('../src/console/app.js');

test('A-P04/A-I/A-C/A-H configured interests use real app management, ingress, durable budget and guarded delivery', async (t) => {
  const listener = http.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.server = { ...cfg.server, host: '127.0.0.1', port, strictPort: true, token: 'synthetic-interest-console-token' };
  cfg.runtime.mode = 'active'; cfg.conversation.mode = 'social'; cfg.allow.groups = ['1'];
  cfg.onebot = { ...cfg.onebot, selfId: '888', wsUrl: 'ws://127.0.0.1:1', httpUrl: 'http://127.0.0.1:1' };
  cfg.api = { ...cfg.api, baseUrl: 'https://interest-model.invalid', model: 'mock', apiKey: 'synthetic', priceRemoteUrl: 'none' };
  cfg.memory.consolidateEnabled = false; cfg.sticker.enabled = false;
  for (const key of ['selfEvolution', 'proactive', 'pacing', 'dailyMoments', 'qzoneInteractions', 'autoUpdate']) cfg[key] = { ...cfg[key], enabled: false };
  cfg.send = { ...cfg.send, minGapMs: 1, maxGapMs: 1, byLengthMs: 0 };
  cfg.wakeDelayMinMs = 600000; cfg.wakeDelayMaxMs = 600000;
  updateConfig(cfg);
  const originalNow = Date.now, originalFetch = globalThis.fetch;
  let clock = originalNow(), app, modelCalls = 0, sends = 0, readCalls = 0, phase = 0;
  let mode = 'listen', interestRef = null, topicId = null, sourceId = null;
  let revokeBeforeSend = false, onModel = null;
  Date.now = () => clock;
  const requests = [], completions = [];
  const response = (message) => Response.json({ choices: [{ message }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } });
  globalThis.fetch = async (url, options) => {
    const host = new URL(String(url)).hostname;
    if (host === '127.0.0.1') return originalFetch(url, options);
    assert.equal(host, 'interest-model.invalid', 'no unmocked external endpoint');
    if (!options?.body) {
      assert.match(new URL(String(url)).pathname, /\/models$/);
      return Response.json({ data: [] });
    }
    modelCalls += 1;
    const body = JSON.parse(options.body); requests.push(body);
    if (onModel) { const override = await onModel(body); if (override) return override; }
    if (mode === 'listen') return response({ content: JSON.stringify({ action: 'listen', topicId, sourceMessageIds: sourceId ? [sourceId] : [], sourceRefs: [], goal: '', novelty: '' }) });
    phase += 1;
    if (phase === 1) {
      assert.ok(body.tools.every((tool) => !/^send_|poke/.test(tool.function.name)), 'planner has no visible tools');
      assert.match(body.messages[1].content, /共同关注/);
      return response({ tool_calls: [{ id: 'read-public', type: 'function', function: { name: 'public_read', arguments: '{}' } }] });
    }
    if (phase === 2) return response({ content: JSON.stringify({ action: 'share', topicId,
      sourceMessageIds: [], sourceRefs: [interestRef], targetMessageIds: [],
      goal: 'Discuss the new astronomy observations', novelty: 'New public data' }) });
    if (phase === 3) return response({ tool_calls: [{ id: 'share-public', type: 'function', function: { name: 'send_message', arguments: JSON.stringify({ messages: `A new astronomy observation ${sends + 1}.` }) } }] });
    return response({ content: 'done' });
  };
  const open = async () => {
    app = createApp({ log: () => {} });
    app.onebot.connect = async () => {};
    app.onebot.call = async (action) => {
      if (action === 'get_login_info') return { user_id: 888, nickname: 'synthetic-bot' };
      if (action === 'get_friend_list') return [];
      throw new Error('Unexpected protocol action: ' + action);
    };
    app.onebot.getGroupInfo = async () => ({ group_name: 'synthetic' });
    app.onebot.sendText = async () => { sends += 1; return { message_id: 10000 + sends }; };
    app.orchestrator.pluginManager.register({ id: 'test.interest-reader', name: 'synthetic read boundary', version: '1.0.0', apiVersion: 1,
      declare(registrar) { registrar.addTools({ name: 'public_read', description: 'Read a public synthetic result',
        parameters: { type: 'object', properties: {}, additionalProperties: false }, ownerPluginId: 'test.interest-reader',
        effect: 'read', socialSource: true, parallelSafe: true, terminal: false,
        execute: async () => { readCalls += 1; return { content: 'A new public astronomy result.' }; } }); }
    });
    const originalEvents = app.orchestrator.pluginManager.buildCompletionEvents.bind(app.orchestrator.pluginManager);
    app.orchestrator.pluginManager.buildCompletionEvents = (snapshot, input) => { completions.push(structuredClone(input)); return originalEvents(snapshot, input); };
    // The application exposes the actual SendQueue through the Orchestrator.
    const sender = app.orchestrator.sender, enqueue = sender.sendTextBatch.bind(sender);
    sender.sendTextBatch = async (...args) => {
      if (revokeBeforeSend) {
        revokeBeforeSend = false;
        const settings = app.orchestrator.getSocialState('group:1').interests;
        const current = settings.read({ accountId: '888', chatKey: 'group:1' });
        settings.save({ accountId: '888', chatKey: 'group:1', expectedRevision: current.revision,
          config: { ...current, sources: [{ ...current.sources[0], text: 'Revised while waiting for Sender.' }] } });
      }
      return enqueue(...args);
    };
    await app.start();
  };
  const request = async (route, body, { auth = true, queryToken = false } = {}) => {
    const result = await fetch(`http://127.0.0.1:${port}${route}${queryToken ? '?token=' + cfg.server.token : ''}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', connection: 'close', ...(auth ? { 'x-console-token': cfg.server.token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: result.status, body: await result.json() };
  };
  const status = () => request('/api/conversation/social?chatKey=group:1');
  const save = (current, patch = {}) => request('/api/conversation/social/interests', {
    chatKey: 'group:1', confirm: true, expectedRevision: current.revision, config: { ...current, ...patch }
  });
  const opportunity = (current, goal = 'Discuss the new astronomy observations') => request('/api/conversation/social/opportunities', {
    chatKey: 'group:1', confirm: true, sourceId: current.sources[0].id, sourceRevision: current.sources[0].revision,
    topicId, goal, dueAt: clock + 1000, expiresAt: clock + 120000
  });
  t.after(async () => { try { if (app) await app.stop(); } finally { Date.now = originalNow; globalThis.fetch = originalFetch; fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } });
  await open();
  const initial = await status();
  assert.equal(initial.status, 200, JSON.stringify(initial.body)); assert.equal(initial.body.interests.revision, 0);
  assert.equal(app.store.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'social_%'").get().n, 0);
  const defaultConfig = { ...initial.body.interests, enabled: true,
    sources: [{ id: 'astronomy', title: 'Astronomy', text: '共同关注新的天文发现。', enabled: true }] };
  const body = { chatKey: 'group:1', confirm: true, expectedRevision: 0, config: defaultConfig };
  assert.equal((await request('/api/conversation/social/interests', body, { auth: false })).status, 401);
  assert.equal((await request('/api/conversation/social/interests', body, { auth: false, queryToken: true })).status, 401);
  assert.equal((await request('/api/conversation/social/interests', { ...body, accountId: 'other' })).status, 403);
  assert.equal((await request('/api/conversation/social/interests', { ...body, chatKey: 'group:2' })).status, 403);
  assert.equal((await request('/api/conversation/social/interests', { ...body, confirm: false })).status, 400);
  assert.equal(app.store.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'social_%'").get().n, 0);
  let settings = (await save(initial.body.interests, defaultConfig)).body.interests;
  assert.equal(settings.revision, 1);
  assert.equal((await save(initial.body.interests, defaultConfig)).status, 409);
  assert.equal((await app.orchestrator.runSocialIntentTick()).claimed, 0); assert.equal(modelCalls, 0, JSON.stringify(requests));

  await app.onebot.onEvent({ post_type: 'message', message_type: 'group', self_id: 888, group_id: 1,
    user_id: 42, message_id: 101, time: Math.floor(clock / 1000), sender: { user_id: 42, nickname: 'synthetic-member' },
    message: [{ type: 'text', data: { text: 'We share an interest in astronomy.' } }], raw_message: 'We share an interest in astronomy.' });
  sourceId = String(app.store.recent('group:1', { limit: 1 })[0].id);
  await app.orchestrator.wake('group:1');
  topicId = (await status()).body.scene.topics[0].id;
  assert.equal(app.store.unreadCount('group:1'), 0);
  const scheduled = await opportunity(settings);
  assert.equal(scheduled.status, 200, JSON.stringify(scheduled));
  assert.equal((await opportunity(settings)).body.intent.id, scheduled.body.intent.id);
  const callsBefore = modelCalls;
  settings = (await save(settings, { enabled: false })).body.interests;
  clock += 1001;
  await app.orchestrator.runSocialIntentTick(); assert.equal(modelCalls, callsBefore);
  assert.equal((await status()).body.intents[0].status, 'pending');
  await app.stop(); app = null; await open();
  assert.equal((await status()).body.interests.enabled, false);
  settings = (await save(settings, { enabled: true })).body.interests;
  interestRef = app.orchestrator.getSocialState('group:1').interests.ref({ accountId: '888', chatKey: 'group:1' }, 'astronomy');
  mode = 'share'; phase = 0;
  await app.orchestrator.runSocialIntentTick();
  const after = await status();
  assert.equal(sends, 1, JSON.stringify(app.sessions?.listSummaries?.(1) || after.body));
  assert.equal(readCalls, 1); assert.equal(modelCalls - callsBefore, 4);
  assert.equal(after.body.interests.usage.runs, 1);
  assert.equal(after.body.intents[0].status, 'completed');
  assert.equal(completions.at(-1).proactive, true);
  assert.equal(completions.at(-1).conversationEvidence.filter((item) => item.role === 'user').length, 0);
  assert.ok(requests.slice(-4).every((item) => item.max_tokens === 2048));
  await app.orchestrator.runSocialIntentTick(); assert.equal(sends, 1);

  clock += 130000; // old unanswered opportunity expires; a new independent source is not permanently silenced.
  settings = (await save(after.body.interests, { sources: [{ ...settings.sources[0], text: '共同关注第二份独立资料。' }] })).body.interests;
  const second = await opportunity(settings, 'Discuss the second independent observation');
  assert.equal(second.status, 200, JSON.stringify(second));
  clock += 1001;
  await app.orchestrator.runSocialIntentTick(); assert.equal(modelCalls, callsBefore + 4, 'daily budget blocks without a model call');
  const cancelled = await request(`/api/conversation/social/intents/${second.body.intent.id}/cancel`, { chatKey: 'group:1', reason: 'operator cancelled' });
  assert.equal(cancelled.status, 200);
  settings = (await save(settings, { maxDailyRuns: 3, maxDailyTokens: 120000,
    sources: [{ ...settings.sources[0], text: '共同关注第三份独立资料。' }] })).body.interests;
  clock += 1800000;
  const third = await opportunity(settings, 'Discuss the third observation'); assert.equal(third.status, 200);
  clock += 1001; phase = 0; revokeBeforeSend = true;
  interestRef = app.orchestrator.getSocialState('group:1').interests.ref({ accountId: '888', chatKey: 'group:1' }, 'astronomy');
  await app.orchestrator.runSocialIntentTick();
  assert.equal(sends, 1, 'source edit before the actual Sender blocks visible output');
  assert.equal((await status()).body.interests.usage.runs, 2, 'failed attempts retain their budget reservation');

  const runBoundary = async (name, patch, hook, expectedCalls, expectedReads = 0) => {
    clock += 130000;
    const current = (await status()).body.interests;
    settings = (await save(current, { maxDailyRuns: 10, maxDailyTokens: 1000000,
      maxRunTokens: 40000, maxModelCalls: 4, ...patch,
      sources: [{ ...current.sources[0], enabled: true, text: '共同关注 ' + name }] })).body.interests;
    interestRef = app.orchestrator.getSocialState('group:1').interests.ref({ accountId: '888', chatKey: 'group:1' }, 'astronomy');
    const item = await opportunity(settings, name); assert.equal(item.status, 200, JSON.stringify(item));
    clock += 1001; phase = 0;
    const before = { calls: modelCalls, reads: readCalls, sends };
    onModel = hook ? (body) => hook(body, item.body.intent.id) : null;
    await app.orchestrator.runSocialIntentTick(); onModel = null;
    assert.equal(modelCalls - before.calls, expectedCalls, name + ': model admission');
    assert.equal(readCalls - before.reads, expectedReads, name + ': read admission');
    assert.equal(sends, before.sends, name + ': no visible output');
    const resolved = app.orchestrator.getSocialState('group:1').getIntent({ accountId: '888', chatKey: 'group:1', id: item.body.intent.id });
    assert.notEqual(resolved.status, 'pending', name + ': no automatic replay');
    await app.orchestrator.runSocialIntentTick();
    assert.equal(modelCalls - before.calls, expectedCalls, name + ': no repeat call');
  };
  await runBoundary('first call token admission', { maxRunTokens: 2000 }, null, 0);
  await runBoundary('model call count limit', { maxModelCalls: 1 }, null, 1, 1);
  await runBoundary('provider failure without retry or fallback', {}, () => Response.json({ error: { message: 'synthetic failure' } }, { status: 503 }), 1);
  await runBoundary('cancel during model response', {}, async (_body, id) => {
    const result = await request(`/api/conversation/social/intents/${id}/cancel`, { chatKey: 'group:1', reason: 'cancel while model pending' });
    assert.equal(result.status, 200);
  }, 1);
  await runBoundary('source disabled during model response', {}, async () => {
    const current = (await status()).body.interests;
    assert.equal((await save(current, { sources: [{ ...current.sources[0], enabled: false }] })).status, 200);
  }, 1);
  await runBoundary('opportunity expires during model response', {}, () => { clock += 120000; }, 1);
  await runBoundary('read tool batch budget', { maxModelCalls: 12, maxRunTokens: 160000 }, () => response({ tool_calls:
    Array.from({ length: 5 }, (_, index) => ({ id: 'budget-read-' + index, type: 'function', function: { name: 'public_read', arguments: '{}' } }))
  }), 1, 4);
});
