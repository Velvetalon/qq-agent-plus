import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-console-account-e2e-'));
process.env.QQ_AGENT_DATA_DIR = dataDir;

const { DEFAULT_CONFIG, updateConfig } = await import('../src/core/config.js');
const { createApp } = await import('../src/console/app.js');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'GET',
      path: pathname
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode,
        json: JSON.parse(body)
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('chat Notebook write is visible through the management API in the host namespace', async (t) => {
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.server = {
    ...cfg.server,
    host: '127.0.0.1',
    port: await freePort(),
    strictPort: true,
    token: ''
  };
  cfg.onebot = {
    ...cfg.onebot,
    wsUrl: 'ws://127.0.0.1:1',
    httpUrl: 'http://127.0.0.1:1',
    selfId: ''
  };
  cfg.runtime = { ...cfg.runtime, mode: 'active', paused: false };
  cfg.allow = { ...cfg.allow, groups: ['100'] };
  cfg.proactive = { ...cfg.proactive, enabled: false };
  cfg.pacing = { ...cfg.pacing, enabled: false };
  cfg.dailyMoments = { ...cfg.dailyMoments, enabled: false };
  cfg.qzoneInteractions = { ...cfg.qzoneInteractions, enabled: false };
  cfg.autoUpdate = { ...cfg.autoUpdate, enabled: false };
  cfg.sticker = { ...cfg.sticker, enabled: false };
  cfg.memory = { ...cfg.memory, consolidateEnabled: false };
  cfg.store = { ...cfg.store, contextTier: 1, randomPercent: 0 };
  cfg.selfEvolution = {
    enabled: true,
    retrieval: { enabled: false },
    reflection: { enabled: false }
  };
  updateConfig(cfg);

  const app = createApp({ log: () => {} });
  const port = await app.start();
  t.after(() => app.stop());

  // The test host supplies the same runtime OneBot identity used by Orchestrator.
  app.onebot.selfInfo = { user_id: '50005', nickname: 'closure-bot' };
  const snapshot = app.orchestrator.pluginManager.createRunSnapshot(cfg);
  t.after(() => app.orchestrator.pluginManager.releaseRunSnapshot(snapshot));
  const result = await snapshot.toolHandles.notebook_append.execute({
    accountId: '50005',
    chatKey: 'group:100',
    sessionId: 'chat-session',
    runId: 'chat-run',
    toolCallId: 'chat-tool'
  }, {
    content: 'written by the chat tool'
  });

  const response = await request(port, '/api/self-evolution/notebook');
  assert.equal(JSON.parse(result.content).saved, true);
  assert.equal(response.status, 200);
  assert.equal(response.json.accountId, '50005');
  assert.equal(response.json.accountSource, 'selfId');
  assert.equal(response.json.notes.length, 1);
  assert.equal(response.json.notes[0].content, 'written by the chat tool');
});
