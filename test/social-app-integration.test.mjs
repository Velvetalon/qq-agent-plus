import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-social-app-chain-'));
process.env.QQ_AGENT_DATA_DIR = dataDir;
const { DEFAULT_CONFIG, loadConfig, setRuntimeConfig } = await import('../src/core/config.js');
const { createApp } = await import('../src/console/app.js');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('A-H01 old database copy loads through createApp, enables explicitly, and retains history after restart and fallback', async (t) => {
  const accountId = '10000001';
  const chatKey = 'group:10001';
  const oldFile = path.join(dataDir, 'old-copy.sqlite');
  const old = new DatabaseSync(oldFile);
  // Synthetic threaded-era migration fixture; never a production database.
  old.exec(`
    CREATE TABLE conversation_threads (
      chat_key TEXT PRIMARY KEY, thread_id TEXT NOT NULL, state TEXT NOT NULL,
      topic TEXT NOT NULL DEFAULT '', participant_ids TEXT NOT NULL DEFAULT '[]',
      opened_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      last_human_at INTEGER NOT NULL DEFAULT 0, last_agent_at INTEGER NOT NULL DEFAULT 0,
      engaged_until INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL DEFAULT 0,
      last_message_id INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
      close_reason TEXT
    );
    INSERT INTO conversation_threads
      (chat_key,thread_id,state,opened_at,updated_at,expires_at)
      VALUES ('group:10001','synthetic-old-thread','engaged',1,1,9999999999999);
  `);
  old.close();
  fs.copyFileSync(oldFile, path.join(dataDir, 'messages.sqlite'));

  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.server = {
    ...cfg.server, host: '127.0.0.1', port: await freePort(),
    strictPort: true, token: 'synthetic-social-app-token'
  };
  cfg.onebot = {
    ...cfg.onebot, selfId: accountId,
    wsUrl: 'ws://127.0.0.1:1', httpUrl: 'http://127.0.0.1:1'
  };
  cfg.runtime.mode = 'observe';
  cfg.api.priceRemoteUrl = 'none';
  cfg.allow.groups = ['10001'];
  cfg.persona.templateId = '';
  cfg.persona.roleText = 'Synthetic unchanged persona.';
  cfg.conversation.mode = 'threaded';
  delete cfg.conversation.social;
  cfg.selfEvolution = { enabled: false };
  cfg.proactive = { ...cfg.proactive, enabled: false };
  cfg.pacing = { ...cfg.pacing, enabled: false };
  cfg.dailyMoments = { ...cfg.dailyMoments, enabled: false };
  cfg.qzoneInteractions = { ...cfg.qzoneInteractions, enabled: false };
  cfg.autoUpdate = { ...cfg.autoUpdate, enabled: false };
  cfg.memory.consolidateEnabled = false;
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify(cfg));
  const loaded = loadConfig();
  assert.equal(loaded.conversation.mode, 'threaded');
  assert.equal(loaded.persona.roleText, cfg.persona.roleText);
  assert.deepEqual(loaded.conversation.social, DEFAULT_CONFIG.conversation.social);
  setRuntimeConfig(loaded);

  let boundaryCalls = 0;
  const protocolCalls = [];
  let app = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    if (new URL(String(url)).hostname !== '127.0.0.1') {
      boundaryCalls += 1;
      throw new Error('Unexpected external HTTP in offline app fixture');
    }
    return originalFetch(url, options);
  };
  t.after(async () => {
    try { if (app) await app.stop(); }
    finally { globalThis.fetch = originalFetch; }
  });
  const openApp = async () => {
    const current = createApp({ log: () => {} });
    // Only protocol boundaries are stubbed; stores, scheduler, plugins and API are real.
    current.onebot.connect = async () => {};
    current.onebot.call = async (action) => {
      protocolCalls.push(action);
      if (action === 'get_login_info') return { user_id: accountId, nickname: 'synthetic-bot' };
      if (action === 'get_friend_list') return [];
      throw new Error('Unexpected OneBot call in offline app fixture: ' + action);
    };
    app = current;
    await app.start();
  };
  const request = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${cfg.server.port}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json', 'x-console-token': cfg.server.token,
        connection: 'close'
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  };
  const tables = () => app.store.db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'social_%' ORDER BY name"
  ).all().map((row) => row.name);
  const historyRoute = '/api/conversation/social?chatKey=' + encodeURIComponent(chatKey);
  const notebookPath = path.join(dataDir, 'plugins/self-evolution/notebook.sqlite');
  const reflectionPath = path.join(dataDir, 'plugins/self-evolution/reflection.sqlite');

  await openApp();
  const startupCalls = protocolCalls.length;
  assert.ok(protocolCalls.every((action) => ['get_login_info', 'get_friend_list'].includes(action)),
    JSON.stringify(protocolCalls));
  assert.equal(app.store.getConversationThread(chatKey).threadId, 'synthetic-old-thread');
  const initial = await request(historyRoute);
  assert.equal(initial.status, 200);
  assert.equal(initial.body.mode, 'threaded');
  assert.equal(initial.body.enabled, false);
  assert.equal(initial.body.scene, null);
  assert.deepEqual(tables(), []);
  assert.deepEqual(await app.orchestrator.runSocialIntentTick(), {
    claimed: 0, skipped: 'runtime-unavailable'
  });
  const missingMaterial = {
    kind: 'notebook', id: 'missing-note', revision: 1, scope: 'chat',
    visibility: `chat:${chatKey}`, policyVersion: 'notebook-memory-v2'
  };
  const materialCheck = await app.orchestrator.validateSocialMaterials({
    accountId, chatKey, refs: [missingMaterial]
  });
  assert.equal(materialCheck.valid, false);
  assert.equal(materialCheck.invalidRefs.length, 1);
  const missingLearnedSelf = {
    kind: 'learned-self', id: accountId, revision: 1, scope: 'chat',
    visibility: `chat:${chatKey}`, policyVersion: 'learned-self-v1',
    traitKeys: ['communication_style'], expiresAt: Date.now() + 60000
  };
  const missingLearnedCheck = await app.orchestrator.validateSocialMaterials({
    accountId, chatKey, refs: [missingLearnedSelf]
  });
  assert.equal(missingLearnedCheck.valid, false);
  assert.equal(missingLearnedCheck.invalidRefs.length, 1);
  const unknownKind = await app.orchestrator.validateSocialMaterials({
    accountId, chatKey, refs: [{ ...missingMaterial, kind: 'unregistered-material' }]
  });
  assert.equal(unknownKind.valid, false);
  assert.equal(unknownKind.invalidRefs.length, 1);
  assert.equal(fs.existsSync(notebookPath), false);
  assert.equal(fs.existsSync(reflectionPath), false);
  assert.equal(boundaryCalls, 0);
  assert.equal(protocolCalls.length, startupCalls, 'status, validators and idle ticks add no protocol calls');

  const enabled = await request('/api/config', { conversation: { mode: 'social', unifiedMode: true } });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.config.persona.roleText, cfg.persona.roleText);
  assert.equal(enabled.body.config.runtime.mode, 'observe');
  assert.deepEqual(tables(), [], 'selecting social without events leaves persistence lazy');
  const source = app.store.appendIncoming(chatKey, {
    mid: 'synthetic-source', ts: Date.now(), senderId: '20000002',
    senderName: 'synthetic-member', text: 'A shared topic to retain across restart.'
  }, { recordOnly: true });
  const state = app.orchestrator.getSocialState(chatKey);
  const scene = state.observe({ accountId, chatKey, selfId: accountId, messages: [source] });
  const topicId = scene.topics[0].id;
  const intent = state.addIntent({
    accountId, chatKey, topicId, sourceMessageIds: [String(source.id)],
    goal: 'Revisit the concrete shared topic once.',
    dueAt: Date.now() + 60000, expiresAt: Date.now() + 300000
  });
  assert.ok(intent?.id);
  const initializedTables = tables();
  assert.ok(initializedTables.length > 0);
  await app.stop();
  app = null;

  const persisted = loadConfig();
  assert.equal(persisted.conversation.mode, 'social');
  setRuntimeConfig(persisted);
  await openApp();
  const restartCalls = protocolCalls.length;
  const restored = await request(historyRoute);
  assert.equal(restored.body.enabled, true);
  assert.equal(restored.body.scene.topics[0].id, topicId);
  assert.equal(restored.body.intents.find((item) => item.id === intent.id)?.status, 'pending');
  assert.equal(app.store.getConversationThread(chatKey).threadId, 'synthetic-old-thread');

  const fallback = await request('/api/config', { conversation: { mode: 'threaded' } });
  assert.equal(fallback.status, 200);
  assert.equal(fallback.body.config.persona.roleText, cfg.persona.roleText);
  assert.equal(fallback.body.config.runtime.mode, 'observe');
  const historical = await request(historyRoute);
  assert.equal(historical.body.enabled, false);
  assert.equal(historical.body.scene.topics[0].id, topicId);
  assert.deepEqual(tables(), initializedTables);
  assert.deepEqual(await app.orchestrator.runSocialIntentTick(), {
    claimed: 0, skipped: 'runtime-unavailable'
  });
  assert.equal(boundaryCalls, 0, 'config, reads, idle ticks and fallback make no model/QQ calls');
  assert.equal(protocolCalls.length, restartCalls, 'history and fallback add no protocol calls');
  assert.ok(protocolCalls.every((action) => ['get_login_info', 'get_friend_list'].includes(action)),
    JSON.stringify(protocolCalls));
  assert.equal(fs.existsSync(notebookPath), false);
  assert.equal(fs.existsSync(reflectionPath), false);
});
