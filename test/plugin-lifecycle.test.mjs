import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ChatStore } from '../src/core/store.js';
import { Orchestrator } from '../src/core/orchestrator.js';
import { PluginManager } from '../src/plugins/manager.js';
import { PluginRegistry } from '../src/plugins/registry.js';

function probePlugin({ enabled = true, failStart = false, observe = null } = {}) {
  return {
    id: 'probe-plugin',
    name: 'Probe plugin',
    version: '1.0.0',
    apiVersion: 1,
    enabled,
    declare(registrar) {
      registrar.addTools({
        name: 'probe_tool',
        description: 'probe',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        ownerPluginId: 'probe-plugin',
        effect: 'local-write',
        parallelSafe: false,
        terminal: false,
        order: 100,
        execute: async () => ({ content: 'probe' })
      });
      registrar.addContextProvider({
        id: 'probe.context',
        ownerPluginId: 'probe-plugin',
        provide: async () => ({
          blocks: [{ id: 'probe-block', title: 'Probe', text: 'bounded context', sourceRefs: ['probe'] }]
        })
      });
      if (observe) registrar.addSessionObserver({
        id: 'probe.observer',
        ownerPluginId: 'probe-plugin',
        observe
      });
    },
    async start(services) {
      if (failStart) throw new Error('probe start failed');
      assert.equal(services.pluginId, 'probe-plugin');
      assert.equal(Object.hasOwn(services, 'onebot'), false);
      assert.equal(Object.hasOwn(services, 'store'), false);
    },
    async stop() {}
  };
}

test('disabled plugin has no start, context, timer, or tool side effects', async () => {
  const manager = new PluginManager();
  manager.register(probePlugin({ enabled: false }));
  await manager.startAll();
  const snapshot = manager.createRunSnapshot({});
  assert.deepEqual(snapshot.plugins, []);
  assert.deepEqual(snapshot.tools, []);
  assert.deepEqual(snapshot.contextProviders, []);
  assert.equal(manager.observerTimer, null);
  await manager.stopAll();
});

test('start failure removes the staged plugin and does not leave runtime state', async () => {
  const manager = new PluginManager();
  manager.register(probePlugin({ failStart: true }));
  await assert.rejects(() => manager.startAll(), /probe start failed/);
  assert.deepEqual(manager.status(), []);
  assert.equal(manager.runtime.size, 0);
});

test('provider failure degrades without failing the run context', async () => {
  const manager = new PluginManager({ registry: new PluginRegistry() });
  const plugin = probePlugin();
  plugin.declare = (registrar) => {
    registrar.addContextProvider({
      id: 'probe.failure',
      ownerPluginId: 'probe-plugin',
      provide: async () => { throw new Error('provider unavailable'); }
    });
  };
  manager.register(plugin);
  const snapshot = manager.createRunSnapshot({});
  const result = await manager.collectContext(snapshot, { chatKey: 'group:1' });
  assert.equal(result.blocks.length, 0);
  assert.equal(result.degraded, true);
  assert.equal(result.diagnostics[0].providerId, 'probe.failure');
});

test('ChatStore completion events are transactional, at-least-once, and retryable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-p2-events-'));
  const store = new ChatStore(0, { dataDir: dir, filename: path.join(dir, 'messages.sqlite') });
  try {
    const event = {
      eventId: 'session-1:probe.observer',
      observerId: 'probe.observer',
      observerPluginId: 'probe-plugin',
      accountId: 'bot-1',
      sessionId: 'session-1',
      runId: 'run-1',
      chatKey: 'group:1',
      pluginGeneration: 1,
      resultClass: 'done',
      actionSummary: { sentCount: 0 },
      sourceMessageIds: ['1'],
      completedAt: Date.now()
    };
    store.completeRun('run-1', { completionEvents: [event, event] });
    assert.equal(store.listExtensionEvents({ state: 'pending' }).length, 1);
    const claimed = store.claimExtensionEvents(10);
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].eventId, event.eventId);
    store.failExtensionEvent(event.eventId, 'temporary failure');
    const retried = store.claimExtensionEvents(10, Date.now() + 2000);
    assert.equal(retried.length, 1);
    assert.equal(retried[0].attempts, 2);
    store.completeExtensionEvent(event.eventId);
    assert.equal(store.listExtensionEvents({ state: 'delivered' }).length, 1);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('enabled observer delivery is at-least-once and delivered events are not replayed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-p2-observer-'));
  const store = new ChatStore(0, { dataDir: dir, filename: path.join(dir, 'messages.sqlite') });
  let calls = 0;
  const manager = new PluginManager({ eventStore: store });
  manager.register(probePlugin({ observe: async () => { calls += 1; } }));
  const snapshot = manager.createRunSnapshot({});
  const events = manager.buildCompletionEvents(snapshot, {
    accountId: 'bot-1', sessionId: 'session-2', runId: 'run-2', chatKey: 'group:1',
    resultClass: 'done'
  });
  store.completeRun('run-2', { completionEvents: events });
  await manager.startAll();
  await manager.drainCompletionEvents();
  await manager.drainCompletionEvents();
  assert.equal(calls, 1);
  await manager.stopAll();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Orchestrator composition accepts a probe manager through the real constructor path', async () => {
  const manager = new PluginManager();
  manager.register(probePlugin());
  const orchestrator = new Orchestrator({
    store: {}, memory: {}, stickers: {}, sender: {}, sessions: {}, onebot: {},
    pluginManager: manager
  });
  assert.equal(orchestrator.pluginManager, manager);
  await manager.startAll();
  const snapshot = manager.createRunSnapshot({});
  assert.equal(snapshot.tools[0].name, 'probe_tool');
  const context = await manager.collectContext(snapshot, { chatKey: 'group:1' });
  assert.equal(context.blocks[0].text, 'bounded context');
  const safeContext = manager.createRunContext({ chatKey: 'group:1' }, {
    api: { apiKey: 'secret-value' },
    onebot: { accessToken: 'qq-token' }
  });
  assert.equal(safeContext.config.api.apiKey, '[redacted]');
  assert.equal(safeContext.config.onebot.accessToken, '[redacted]');
  await manager.stopAll();
});
