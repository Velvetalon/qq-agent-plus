import { createRunContext, snapshotConfig, snapshotPluginConfig } from './context.js';
import { PluginRegistry } from './registry.js';

const STOP_TIMEOUT_MS = 1000;
const OBSERVER_TIMEOUT_MS = 1000;

function enabledFor(plugin, config) {
  if (plugin.required) return true;
  if (typeof plugin.isEnabled === 'function') return plugin.isEnabled(config) === true;
  return plugin.enabled !== false;
}

function stableToolSnapshot(registrySnapshot, enabledPlugins) {
  const enabledIds = new Set(enabledPlugins.map((plugin) => plugin.id));
  return registrySnapshot.tools.filter((tool) => enabledIds.has(tool.ownerPluginId));
}

export class PluginManager {
  constructor({ registry = new PluginRegistry(), configProvider = () => ({}), eventStore = null } = {}) {
    this.registry = registry;
    this.configProvider = typeof configProvider === 'function' ? configProvider : () => ({});
    this.eventStore = eventStore;
    this.generations = new Map();
    this.enabled = new Map();
    this.runtime = new Map();
    // 最近一次启动/停止失败的原因：状态读模型要把它暴露给控制台，
    // 否则"插件没在跑"只能靠翻日志解释。
    this.lastErrors = new Map();
    this.activeSnapshots = new Set();
    this.observerTimer = null;
    this.services = {};
    this.stopping = false;
    this.inFlight = new Set();
  }

  register(plugin) {
    const result = this.registry.register(plugin);
    this.generations.set(plugin.id, (this.generations.get(plugin.id) || 0) + 1);
    if (plugin.enabled === false) this.enabled.set(plugin.id, false);
    return result;
  }

  registerAll(plugins) {
    const result = this.registry.registerAll(plugins);
    for (const plugin of (Array.isArray(plugins) ? plugins : [plugins])) {
      this.generations.set(plugin.id, (this.generations.get(plugin.id) || 0) + 1);
      if (plugin.enabled === false) this.enabled.set(plugin.id, false);
    }
    return result;
  }

  setEnabled(pluginId, enabled) {
    const registration = this.registry.getRegistrations().find((item) => item.plugin.id === pluginId);
    if (!registration) throw new Error(`Unknown plugin: ${pluginId}`);
    if (registration.plugin.required && enabled === false) {
      throw new Error(`Required plugin cannot be disabled: ${pluginId}`);
    }
    this.enabled.set(pluginId, enabled === true);
    this.generations.set(pluginId, (this.generations.get(pluginId) || 0) + 1);
    if (!enabled) {
      const runtime = this.runtime.get(pluginId);
      this.#clearTimers(runtime);
      runtime?.controller.abort(new Error('Plugin disabled'));
    }
  }

  async startAll({ services = {}, config = this.configProvider() } = {}) {
    this.stopping = false;
    this.services = services && typeof services === 'object' ? { ...services } : {};
    const started = [];
    const preExistingRuntimeIds = new Set(this.runtime.keys());
    let startingId = '';
    try {
      for (const registration of this.registry.getRegistrations()) {
        const plugin = registration.plugin;
        if (!this.isEnabled(plugin.id, config) || this.runtime.has(plugin.id)) continue;
        startingId = plugin.id;
        const generation = this.generations.get(plugin.id) || 0;
        const controller = new AbortController();
        const runtime = {
          controller,
          generation,
          timers: new Set(),
          services: null,
          startedAt: 0
        };
        const runtimeServices = this.#servicesFor(
          plugin.id, config, generation, controller.signal, runtime
        );
        runtime.services = runtimeServices;
        this.runtime.set(plugin.id, runtime);
        if (typeof plugin.start === 'function') await plugin.start(runtimeServices, snapshotPluginConfig(config), controller.signal);
        runtime.startedAt = Date.now();
        this.lastErrors.delete(plugin.id);
        started.push(plugin.id);
        startingId = '';
      }
      this.#startObserverWorker();
      return this.status();
    } catch (error) {
      const rollbackIds = startingId ? [startingId, ...started] : started;
      const rollbackError = new Error('Plugin startup failed');
      for (const pluginId of rollbackIds) {
        if (preExistingRuntimeIds.has(pluginId)) continue;
        if (pluginId === startingId) {
          this.lastErrors.set(pluginId, String(error?.message ?? error));
        }
        this.enabled.set(pluginId, false);
        this.#invalidateRuntime(pluginId, rollbackError);
      }
      await this.#drainInFlight(new Set(rollbackIds));
      await this.#stopIds(rollbackIds, 'startup-failed', { prepared: true });
      for (const pluginId of rollbackIds) {
        if (preExistingRuntimeIds.has(pluginId)) continue;
        this.registry.unregister(pluginId);
        this.enabled.delete(pluginId);
      }
      throw error;
    }
  }

  async stopAll(reason = 'shutdown') {
    this.stopping = true;
    if (this.observerTimer) clearTimeout(this.observerTimer);
    this.observerTimer = null;
    const stopError = new Error(`Plugins stopped: ${reason}`);
    for (const snapshot of this.activeSnapshots) snapshot.abortController.abort(stopError);
    const ids = [...this.runtime.keys()];
    for (const id of ids) this.#invalidateRuntime(id, stopError);
    await this.#drainInFlight();
    await this.#stopIds(ids, reason, { prepared: true });
    this.activeSnapshots.clear();
  }

  async disable(pluginId, reason = 'disabled') {
    this.setEnabled(pluginId, false);
    const snapshotList = [...this.activeSnapshots];
    for (const snapshot of snapshotList) {
      if (snapshot.plugins.some((plugin) => plugin.id === pluginId)) {
        snapshot.abortController.abort(new Error(`Plugin disabled: ${pluginId}`));
      }
    }
    await this.#drainInFlight(new Set([pluginId]));
    await this.#stopIds([pluginId], reason, { prepared: true });
  }

  releaseRunSnapshot(snapshot) {
    if (snapshot) this.activeSnapshots.delete(snapshot);
  }

  isEnabled(pluginId, config = this.configProvider()) {
    const registration = this.registry.getRegistrations().find((item) => item.plugin.id === pluginId);
    if (!registration) return false;
    if (this.stopping) return false;
    return this.enabled.has(pluginId)
      ? this.enabled.get(pluginId) === true
      : enabledFor(registration.plugin, config);
  }

  createRunSnapshot(config = this.configProvider()) {
    const registrySnapshot = this.registry.snapshot();
    const configSnapshot = snapshotConfig(config);
    const plugins = registrySnapshot.plugins.filter((plugin) => this.isEnabled(plugin.id, configSnapshot));
    const tools = stableToolSnapshot(registrySnapshot, plugins);
    const toolHandles = Object.freeze(Object.fromEntries(tools.map((tool) => [
      tool.name,
      Object.freeze({
        name: tool.name,
        ownerPluginId: tool.ownerPluginId,
        effect: tool.effect,
        parallelSafe: tool.parallelSafe,
        terminal: tool.terminal,
        order: tool.order,
        execute: tool.execute
      })
    ])));
    const abortController = new AbortController();
    const generations = Object.freeze(Object.fromEntries(
      plugins.map((plugin) => [plugin.id, this.generations.get(plugin.id) || 0])
    ));
    const snapshot = {
      registryRevision: registrySnapshot.revision,
      config: configSnapshot,
      plugins: Object.freeze(plugins),
      tools: Object.freeze(tools),
      toolHandles,
      contextProviders: Object.freeze(registrySnapshot.contextProviders
        .filter((provider) => plugins.some((plugin) => plugin.id === provider.ownerPluginId))
        .filter((provider) => typeof provider.isEnabled !== 'function'
          || provider.isEnabled(configSnapshot) === true)),
      sessionObservers: Object.freeze(registrySnapshot.sessionObservers
        .filter((observer) => plugins.some((plugin) => plugin.id === observer.ownerPluginId))),
      generations,
      abortController,
      signal: abortController.signal,
      isActive: (pluginId, generation) => !abortController.signal.aborted
        && this.isEnabled(pluginId)
        && (this.generations.get(pluginId) || 0) === Number(generation)
    };
    Object.freeze(snapshot);
    this.activeSnapshots.add(snapshot);
    return snapshot;
  }

  createRunContext(options = {}, config = this.configProvider()) {
    return createRunContext(this.createRunSnapshot(config), options);
  }

  getToolDefs() {
    return this.registry.getTools();
  }

  status() {
    const registrations = new Map(
      this.registry.getRegistrations().map((item) => [item.plugin.id, item])
    );
    return this.registry.listPlugins().map((plugin) => {
      const registration = registrations.get(plugin.id);
      const runtime = this.runtime.get(plugin.id);
      const enabled = this.isEnabled(plugin.id);
      return {
        ...plugin,
        enabled,
        generation: this.generations.get(plugin.id) || 0,
        running: Boolean(runtime),
        startedAt: Number(runtime?.startedAt) || 0,
        lastError: String(this.lastErrors.get(plugin.id) || ''),
        capabilities: {
          tools: (registration?.tools || []).map((tool) => tool.name),
          contextProviders: (registration?.contextProviders || []).map((provider) => provider.id),
          sessionObservers: (registration?.sessionObservers || []).map((observer) => observer.id)
        },
        canEnable: !enabled,
        canDisable: plugin.required !== true
      };
    });
  }

  async collectContext(snapshot, runContext, { budgetChars = 6000, timeoutMs = 500 } = {}) {
    const blocks = [];
    const diagnostics = [];
    let remaining = Math.max(0, Number(budgetChars) || 6000);
    for (const provider of snapshot?.contextProviders || []) {
      const startedAt = Date.now();
      let timeoutHandle = null;
      const providerController = new AbortController();
      const providerSignal = this.#combineSignals(
        snapshot.signal,
        runContext?.signal,
        providerController.signal
      );
      const providerContext = runContext && typeof runContext === 'object'
        ? Object.freeze({ ...runContext, signal: providerSignal })
        : runContext;
      try {
        const providerTask = this.#trackTask(provider.ownerPluginId, Promise.resolve().then(() => provider.provide(
          providerContext,
          this.#servicesFor(provider.ownerPluginId, snapshot.config,
            snapshot.generations[provider.ownerPluginId] || 0, providerSignal)
        )));
        const abortTask = new Promise((_, reject) => {
          if (providerSignal.aborted) {
            reject(providerSignal.reason || new Error('provider aborted'));
            return;
          }
          providerSignal.addEventListener(
            'abort',
            () => reject(providerSignal.reason || new Error('provider aborted')),
            { once: true }
          );
        });
        const result = await Promise.race([
          providerTask,
          abortTask,
          new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => {
              providerController.abort(new Error('provider timeout'));
              reject(new Error('provider timeout'));
            }, Math.max(1, Number(timeoutMs) || 500));
          })
        ]);
        const candidates = Array.isArray(result?.blocks) ? result.blocks : [];
        let selected = 0;
        for (const block of candidates) {
          const text = String(block?.text || '').trim();
          if (!text || text.length > remaining) continue;
          blocks.push({
            id: String(block.id || `${provider.id}:${selected + 1}`),
            title: String(block.title || provider.id).slice(0, 120),
            text: text.slice(0, remaining),
            sourceRefs: Array.isArray(block.sourceRefs) ? block.sourceRefs.slice(0, 8) : [],
            revision: block.revision ?? null
          });
          remaining -= text.length;
          selected += 1;
        }
        diagnostics.push({ providerId: provider.id, elapsedMs: Date.now() - startedAt,
          candidateCount: candidates.length, selectedCount: selected });
      } catch (error) {
        diagnostics.push({ providerId: provider.id, elapsedMs: Date.now() - startedAt,
          candidateCount: 0, selectedCount: 0, degradedReason: String(error?.message ?? error).slice(0, 200) });
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    }
    return { blocks, diagnostics, degraded: diagnostics.some((item) => item.degradedReason) };
  }

  buildCompletionEvents(snapshot, {
    accountId = '', sessionId = '', runId = '', chatKey = '', resultClass = '',
    actionSummary = {}, sourceMessageIds = [], completedAt = Date.now()
  } = {}) {
    if (!snapshot || snapshot.signal.aborted) return [];
    return snapshot.sessionObservers
      .filter((observer) => snapshot.isActive(observer.ownerPluginId, snapshot.generations[observer.ownerPluginId]))
      .map((observer) => ({
        eventId: `${sessionId}:${observer.id}`,
        accountId: String(accountId || ''),
        sessionId: String(sessionId || ''),
        runId: String(runId || ''),
        chatKey: String(chatKey || ''),
        observerId: observer.id,
        pluginGeneration: snapshot.generations[observer.ownerPluginId] || 0,
        resultClass: String(resultClass || ''),
        observerPluginId: observer.ownerPluginId,
        actionSummary: {
          sentCount: Number(actionSummary.sentCount) || 0,
          finishReason: String(actionSummary.finishReason || '').slice(0, 300),
          outboundAttempted: actionSummary.outboundAttempted === true,
          participation: actionSummary.participation && typeof actionSummary.participation === 'object'
            ? structuredClone(actionSummary.participation)
            : null,
          termination: actionSummary.termination && typeof actionSummary.termination === 'object'
            ? structuredClone(actionSummary.termination)
            : null,
          outbound: actionSummary.outbound && typeof actionSummary.outbound === 'object'
            ? structuredClone(actionSummary.outbound)
            : null
        },
        sourceMessageIds: (Array.isArray(sourceMessageIds) ? sourceMessageIds : []).map(String).slice(0, 32),
        completedAt: Number(completedAt) || Date.now()
      }));
  }

  #servicesFor(pluginId, config, generation, signal, runtime = null) {
    const timers = runtime?.timers || new Set();
    const setTimer = (fn, ms, ...args) => {
      if (signal?.aborted || this.stopping || typeof fn !== 'function') return null;
      let timer = null;
      timer = setTimeout(() => {
        timers.delete(timer);
        if (!signal?.aborted && !this.stopping) fn(...args);
      }, Math.max(0, Number(ms) || 0));
      timers.add(timer);
      return timer;
    };
    const clearTimer = (timer) => {
      if (timer == null) return;
      clearTimeout(timer);
      timers.delete(timer);
    };
    return Object.freeze({
      pluginId,
      generation,
      config: snapshotPluginConfig(config),
      signal,
      logger: this.services.logger || (() => {}),
      resources: Object.freeze({ setTimer, clearTimer })
    });
  }

  #startObserverWorker() {
    const hasEnabledObserver = this.registry.getSessionObservers()
      .some((observer) => this.isEnabled(observer.ownerPluginId));
    if (!this.eventStore || !hasEnabledObserver || this.observerTimer) return;
    const tick = async () => {
      this.observerTimer = null;
      try {
        await this.drainCompletionEvents();
      } catch {
        // A failed observer drain must not kill the worker.
      }
      if (!this.stopping && this.runtime.size) this.observerTimer = setTimeout(tick, 1000);
      this.observerTimer?.unref?.();
    };
    this.observerTimer = setTimeout(tick, 0);
    this.observerTimer.unref?.();
  }

  async drainCompletionEvents(limit = 20, observerTimeoutMs = OBSERVER_TIMEOUT_MS) {
    if (!this.eventStore) return 0;
    const events = this.eventStore.claimExtensionEvents?.(limit) || [];
    let delivered = 0;
    for (const event of events) {
      const registration = this.registry.getRegistrations()
        .find((item) => item.plugin.id === event.observerPluginId);
      const observer = registration?.sessionObservers.find((item) => item.id === event.observerId);
      const runtime = this.runtime.get(event.observerPluginId);
      const signal = runtime?.controller.signal || new AbortController().signal;
      if (!observer || !this.isEnabled(event.observerPluginId)
        || signal.aborted
        || (this.generations.get(event.observerPluginId) || 0) !== Number(event.pluginGeneration)) {
        this.eventStore.failExtensionEvent?.(event.eventId, 'observer disabled', { expired: true });
        continue;
      }
      const observerController = new AbortController();
      const observerSignal = this.#combineSignals(signal, observerController.signal);
      let timeoutHandle = null;
      try {
        const observerTask = Promise.resolve().then(() => observer.observe(
          event,
          this.#servicesFor(event.observerPluginId, this.configProvider(),
            event.pluginGeneration, observerSignal, runtime)
        ));
        await this.#trackTask(event.observerPluginId, Promise.race([
          observerTask,
          new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => {
              const timeoutError = new Error('observer timeout');
              observerController.abort(timeoutError);
              reject(timeoutError);
            }, Math.max(1, Number(observerTimeoutMs) || OBSERVER_TIMEOUT_MS));
          })
        ]));
        if (observerSignal.aborted
          || !this.isEnabled(event.observerPluginId)
          || (this.generations.get(event.observerPluginId) || 0) !== Number(event.pluginGeneration)) {
          this.eventStore.failExtensionEvent?.(event.eventId, 'observer disabled', { expired: true });
        } else {
          this.eventStore.completeExtensionEvent?.(event.eventId);
          delivered += 1;
        }
      } catch (error) {
        this.eventStore.failExtensionEvent?.(event.eventId, String(error?.message ?? error));
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    }
    return delivered;
  }

  async #stopIds(ids, reason, { prepared = false } = {}) {
    for (const id of ids) {
      const runtime = this.runtime.get(id);
      const registration = this.registry.getRegistrations().find((item) => item.plugin.id === id);
      if (!runtime || !registration) continue;
      if (!prepared) this.#invalidateRuntime(id, new Error(`Plugin stopped: ${reason}`));
      else this.#clearTimers(runtime);
      await this.#boundedStop(registration.plugin, reason, runtime.services);
      this.runtime.delete(id);
      this.#clearTimers(runtime);
    }
  }

  #invalidateRuntime(pluginId, reason) {
    const runtime = this.runtime.get(pluginId);
    this.generations.set(pluginId, (this.generations.get(pluginId) || 0) + 1);
    if (!runtime) return;
    this.#clearTimers(runtime);
    runtime.controller.abort(reason);
  }

  #clearTimers(runtime) {
    for (const timer of runtime?.timers || []) clearTimeout(timer);
    runtime?.timers?.clear();
  }

  #trackTask(pluginId, task) {
    const tracked = {
      pluginId,
      promise: Promise.resolve(task)
    };
    this.inFlight.add(tracked);
    tracked.promise.finally(() => this.inFlight.delete(tracked)).catch(() => {});
    return tracked.promise;
  }

  async #drainInFlight(pluginIds = null) {
    const pending = [...this.inFlight]
      .filter((entry) => !pluginIds || pluginIds.has(entry.pluginId))
      .map((entry) => entry.promise);
    if (!pending.length) return;
    let timer = null;
    try {
      await Promise.race([
        Promise.allSettled(pending),
        new Promise((resolve) => {
          timer = setTimeout(resolve, STOP_TIMEOUT_MS);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async #boundedStop(plugin, reason, services) {
    if (typeof plugin.stop !== 'function') return;
    let timer = null;
    try {
      await Promise.race([
        Promise.resolve().then(() => plugin.stop(reason, services)),
        new Promise((resolve) => {
          timer = setTimeout(resolve, STOP_TIMEOUT_MS);
        })
      ]);
    } catch (error) {
      // Plugin cleanup is best effort; runtime resources are still released.
      this.lastErrors.set(plugin.id, String(error?.message ?? error));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  #combineSignals(...signals) {
    const active = signals.filter((signal) => signal && typeof signal.addEventListener === 'function');
    if (active.length === 1) return active[0];
    if (typeof AbortSignal?.any === 'function') return AbortSignal.any(active);
    const controller = new AbortController();
    for (const signal of active) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    }
    return controller.signal;
  }
}
