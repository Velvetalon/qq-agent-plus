import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-p2-app-start-'));
process.env.QQ_AGENT_DATA_DIR = dataDir;

const { DEFAULT_CONFIG, updateConfig } = await import('../src/core/config.js');
const { createApp } = await import('../src/console/app.js');

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function appStartProbe(state) {
  return {
    id: 'p2-app-start-probe',
    name: 'P2 app-start probe',
    version: '1.0.0',
    apiVersion: 1,
    declare(registrar) {
      registrar.addTools({
        name: 'p2_app_start_probe',
        description: 'P2 app-start integration probe',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        ownerPluginId: 'p2-app-start-probe',
        effect: 'read',
        parallelSafe: true,
        terminal: false,
        order: 1000,
        execute: async () => ({ content: 'probe' })
      });
      registrar.addContextProvider({
        id: 'p2.app-start.context',
        ownerPluginId: 'p2-app-start-probe',
        provide: async () => ({
          blocks: [{
            id: 'p2-app-start-block',
            title: 'P2 app-start probe',
            text: 'real createApp startup context',
            sourceRefs: ['p2-app-start-probe']
          }]
        })
      });
      registrar.addSessionObserver({
        id: 'p2.app-start.observer',
        ownerPluginId: 'p2-app-start-probe',
        observe: async (_event, services) => {
          state.observerServices = services;
        }
      });
    },
    async start(services) {
      state.starts += 1;
      state.startServices = services;
      assert.equal(services.pluginId, 'p2-app-start-probe');
      assert.equal(Object.hasOwn(services, 'onebot'), false);
      assert.equal(Object.hasOwn(services, 'store'), false);
      assert.equal(services.signal.aborted, false);
      state.timer = services.resources.setTimer(() => {
        state.timerFired = true;
      }, 80);
    },
    async stop(_reason, services) {
      state.stops += 1;
      state.stopSignalAborted = services.signal.aborted;
    }
  };
}

test('real createApp startup starts and stops a scoped probe plugin', async (t) => {
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const port = await freePort();
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.server = {
    ...cfg.server,
    host: '127.0.0.1',
    port,
    strictPort: true,
    token: ''
  };
  cfg.onebot = {
    ...cfg.onebot,
    wsUrl: 'ws://127.0.0.1:1',
    httpUrl: 'http://127.0.0.1:1'
  };
  cfg.runtime = { ...cfg.runtime, mode: 'observe', paused: false };
  cfg.proactive = { ...cfg.proactive, enabled: false };
  cfg.pacing = { ...cfg.pacing, enabled: false };
  cfg.dailyMoments = { ...cfg.dailyMoments, enabled: false };
  cfg.qzoneInteractions = { ...cfg.qzoneInteractions, enabled: false };
  cfg.autoUpdate = { ...cfg.autoUpdate, enabled: false };
  cfg.webSearch = { ...cfg.webSearch, enabled: false };
  updateConfig(cfg);

  const state = {
    starts: 0,
    stops: 0,
    timer: null,
    timerFired: false,
    startServices: null,
    stopSignalAborted: false,
    observerServices: null
  };
  const app = createApp({ log: () => {} });
  const manager = app.orchestrator.pluginManager;
  manager.register(appStartProbe(state));

  try {
    await app.start();

    const registration = manager.registry.getRegistrations()
      .find((item) => item.plugin.id === 'p2-app-start-probe');
    assert.ok(registration);
    assert.equal(registration.tools.length, 1);
    assert.equal(registration.contextProviders.length, 1);
    assert.equal(registration.sessionObservers.length, 1);

    const status = manager.status().find((item) => item.id === 'p2-app-start-probe');
    assert.deepEqual(
      { enabled: status?.enabled, running: manager.runtime.has('p2-app-start-probe') },
      { enabled: true, running: true }
    );
    assert.equal(state.starts, 1);
    assert.ok(state.timer);
    assert.ok(manager.observerTimer);

    const snapshot = manager.createRunSnapshot({});
    assert.ok(snapshot.tools.some((tool) => tool.name === 'p2_app_start_probe'));
    assert.ok(snapshot.contextProviders.some((provider) => provider.id === 'p2.app-start.context'));
    assert.ok(snapshot.sessionObservers.some((observer) => observer.id === 'p2.app-start.observer'));
    const context = await manager.collectContext(snapshot, { chatKey: 'group:p2-app-start' });
    assert.equal(context.degraded, false);
    assert.equal(context.blocks[0].text, 'real createApp startup context');
  } finally {
    await app.stop();
  }

  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(state.stops, 1);
  assert.equal(state.stopSignalAborted, true);
  assert.equal(state.startServices.signal.aborted, true);
  assert.equal(state.timerFired, false);
  assert.equal(manager.runtime.has('p2-app-start-probe'), false);
  assert.equal(manager.runtime.size, 0);
  assert.equal(manager.observerTimer, null);
});
