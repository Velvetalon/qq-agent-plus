import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ChatStore } from '../src/core/store.js';
import { Orchestrator } from '../src/core/orchestrator.js';
import { PluginManager } from '../src/plugins/manager.js';
import { PluginRegistry } from '../src/plugins/registry.js';
import { executeTool } from '../src/tools/tools.js';

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

test('startAll failure atomically rolls back every plugin started by that call', async () => {
  const manager = new PluginManager();
  const stops = [];
  const stopObservations = [];
  manager.registerAll([
    {
      id: 'first',
      name: 'First',
      version: '1.0.0',
      apiVersion: 1,
      declare() {},
      start() {},
      stop() {
        const snapshot = manager.createRunSnapshot({});
        stopObservations.push({
          id: 'first',
          plugins: snapshot.plugins.map((plugin) => plugin.id),
          active: snapshot.isActive('first', manager.generations.get('first'))
        });
        manager.releaseRunSnapshot(snapshot);
        stops.push('first');
      }
    },
    {
      id: 'second',
      name: 'Second',
      version: '1.0.0',
      apiVersion: 1,
      declare() {},
      start() { throw new Error('boom'); },
      stop() {
        const snapshot = manager.createRunSnapshot({});
        stopObservations.push({
          id: 'second',
          plugins: snapshot.plugins.map((plugin) => plugin.id),
          active: snapshot.isActive('second', manager.generations.get('second'))
        });
        manager.releaseRunSnapshot(snapshot);
        stops.push('second');
      }
    }
  ]);
  await assert.rejects(() => manager.startAll(), /boom/);
  assert.deepEqual(manager.registry.listPlugins(), []);
  assert.deepEqual(manager.status(), []);
  assert.equal(manager.runtime.size, 0);
  assert.deepEqual(stops, ['second', 'first']);
  assert.deepEqual(stopObservations, [
    { id: 'second', plugins: [], active: false },
    { id: 'first', plugins: [], active: false }
  ]);
  assert.equal(manager.generations.get('first'), 2);
  assert.equal(manager.generations.get('second'), 2);
});

test('startAll failure preserves plugins that were already running', async () => {
  const manager = new PluginManager();
  const stops = [];
  manager.register({
    id: 'first-running',
    name: 'First running',
    version: '1.0.0',
    apiVersion: 1,
    declare() {},
    start() {},
    stop() { stops.push('first-running'); }
  });
  await manager.startAll();
  manager.register({
    id: 'second-failing',
    name: 'Second failing',
    version: '1.0.0',
    apiVersion: 1,
    declare() {},
    start() { throw new Error('later boom'); },
    stop() { stops.push('second-failing'); }
  });
  await assert.rejects(() => manager.startAll(), /later boom/);
  assert.deepEqual(manager.registry.listPlugins().map((plugin) => plugin.id), ['first-running']);
  assert.equal(manager.runtime.has('first-running'), true);
  assert.deepEqual(stops, ['second-failing']);
  await manager.stopAll();
  assert.deepEqual(stops, ['second-failing', 'first-running']);
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

test('provider timeout aborts the provider and preserves the shared run context', async () => {
  const manager = new PluginManager();
  let aborted = false;
  const plugin = probePlugin();
  plugin.declare = (registrar) => {
    registrar.addContextProvider({
      id: 'probe.timeout',
      ownerPluginId: 'probe-plugin',
      provide: async (context) => {
        await new Promise((resolve) => {
          context.signal.addEventListener('abort', () => {
            aborted = true;
            resolve();
          }, { once: true });
        });
        return { blocks: [{ text: 'late block' }] };
      }
    });
  };
  manager.register(plugin);
  const snapshot = manager.createRunSnapshot({});
  const result = await manager.collectContext(snapshot, { chatKey: 'group:1' }, { timeoutMs: 5 });
  assert.equal(result.blocks.length, 0);
  assert.equal(result.degraded, true);
  assert.match(result.diagnostics[0].degradedReason, /timeout/);
  assert.equal(aborted, true);
});

test('stop invalidates snapshots before plugin cleanup and clears plugin timers', async () => {
  const manager = new PluginManager();
  const events = [];
  let timerFired = false;
  manager.register({
    id: 'stop-probe',
    name: 'Stop probe',
    version: '1.0.0',
    apiVersion: 1,
    declare() {},
    async start(services) {
      services.resources.setTimer(() => { timerFired = true; }, 100);
    },
    async stop(_reason, services) {
      events.push({
        aborted: services.signal.aborted,
        active: manager.createRunSnapshot({}).plugins.some((plugin) => plugin.id === 'stop-probe')
      });
    }
  });
  await manager.startAll();
  const snapshot = manager.createRunSnapshot({});
  await manager.stopAll();
  assert.equal(snapshot.signal.aborted, true);
  assert.equal(snapshot.isActive('stop-probe', snapshot.generations['stop-probe']), false);
  assert.deepEqual(events, [{ aborted: true, active: false }]);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(timerFired, false);
  assert.equal(manager.runtime.size, 0);
});

test('config-based enablement is evaluated when the manager starts', async () => {
  const config = { enabled: false };
  const manager = new PluginManager({ configProvider: () => config });
  let starts = 0;
  manager.register({
    id: 'config-probe',
    name: 'Config probe',
    version: '1.0.0',
    apiVersion: 1,
    isEnabled: (current) => current.enabled === true,
    declare() {},
    start() { starts += 1; }
  });
  await manager.startAll();
  assert.equal(starts, 0);
  config.enabled = true;
  await manager.startAll();
  assert.equal(starts, 1);
  await manager.stopAll();
});

test('startAll explicit config controls dynamic plugin enablement', async () => {
  const manager = new PluginManager({ configProvider: () => ({ enabled: false }) });
  let starts = 0;
  manager.register({
    id: 'explicit-config-probe',
    name: 'Explicit config probe',
    version: '1.0.0',
    apiVersion: 1,
    isEnabled: (current) => current.enabled === true,
    declare() {},
    start() { starts += 1; }
  });
  await manager.startAll({ config: { enabled: true } });
  assert.equal(starts, 1);
  assert.equal(manager.runtime.has('explicit-config-probe'), true);
  await manager.stopAll();
});

test('hard disable rejects a late tool result from an old run snapshot', async () => {
  const manager = new PluginManager();
  let callbackContext = null;
  const plugin = probePlugin();
  plugin.declare = (registrar) => {
    registrar.addTools({
      name: 'late_tool',
      description: 'late tool',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      ownerPluginId: 'probe-plugin',
      effect: 'local-write',
      parallelSafe: false,
      terminal: false,
      execute: async (ctx) => {
        callbackContext = ctx;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return { content: 'late side effect' };
      }
    });
  };
  manager.register(plugin);
  const snapshot = manager.createRunSnapshot({});
  const pending = executeTool(snapshot.tools, {
    runSnapshot: snapshot,
    signal: snapshot.signal
  }, 'late_tool', '{}');
  await new Promise((resolve) => setTimeout(resolve, 1));
  await manager.disable('probe-plugin');
  const result = await pending;
  assert.equal(result.errorCode, 'PLUGIN_DISABLED');
  assert.equal(result.isError, true);
  assert.equal(Object.hasOwn(callbackContext, 'runSnapshot'), false);
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

test('hung observers time out as retryable failures and do not block stopAll', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-p2-observer-timeout-'));
  const store = new ChatStore(0, { dataDir: dir, filename: path.join(dir, 'messages.sqlite') });
  const seen = [];
  const manager = new PluginManager({ eventStore: store });
  manager.register(probePlugin({
    observe: async (event) => {
      seen.push(event.sessionId);
      if (event.sessionId !== 'fast') await new Promise(() => {});
    }
  }));
  const snapshot = manager.createRunSnapshot({});
  const hung = manager.buildCompletionEvents(snapshot, {
    accountId: 'bot-1',
    sessionId: 'hung',
    runId: 'run-hung',
    chatKey: 'group:1',
    resultClass: 'done',
    completedAt: 1
  });
  const fast = manager.buildCompletionEvents(snapshot, {
    accountId: 'bot-1',
    sessionId: 'fast',
    runId: 'run-fast',
    chatKey: 'group:1',
    resultClass: 'done',
    completedAt: 2
  });
  store.completeRun('run-hung', { completionEvents: hung });
  store.completeRun('run-fast', { completionEvents: fast });

  const drainStartedAt = Date.now();
  const delivered = await manager.drainCompletionEvents(20, 25);
  const drainElapsedMs = Date.now() - drainStartedAt;
  assert.equal(delivered, 1);
  assert.ok(drainElapsedMs < 500, `drain took ${drainElapsedMs}ms`);
  assert.deepEqual(seen, ['hung', 'fast']);

  const states = store.listExtensionEvents();
  const hungState = states.find((event) => event.eventId === hung[0].eventId);
  const fastState = states.find((event) => event.eventId === fast[0].eventId);
  assert.equal(hungState?.state, 'failed');
  assert.match(hungState?.lastError || '', /timeout/);
  assert.equal(fastState?.state, 'delivered');
  const retried = store.claimExtensionEvents(10, Date.now() + 2000);
  assert.deepEqual(retried.map((event) => event.eventId), [hung[0].eventId]);
  assert.equal(retried[0].attempts, 2);

  const stopHung = manager.buildCompletionEvents(snapshot, {
    accountId: 'bot-1',
    sessionId: 'stop-hung',
    runId: 'run-stop-hung',
    chatKey: 'group:1',
    resultClass: 'done',
    completedAt: 3
  });
  store.completeRun('run-stop-hung', { completionEvents: stopHung });
  const pendingDrain = manager.drainCompletionEvents(20);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const stopStartedAt = Date.now();
  await manager.stopAll();
  const stopElapsedMs = Date.now() - stopStartedAt;
  assert.ok(stopElapsedMs < 1500, `stopAll took ${stopElapsedMs}ms`);
  assert.equal(await pendingDrain, 0);
  const stopHungState = store.listExtensionEvents()
    .find((event) => event.eventId === stopHung[0].eventId);
  assert.equal(stopHungState?.state, 'failed');
  assert.match(stopHungState?.lastError || '', /timeout/);

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
