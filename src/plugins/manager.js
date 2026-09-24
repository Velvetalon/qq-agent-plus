import { createRunContext, snapshotConfig, snapshotPluginConfig } from './context.js';
import { PluginRegistry } from './registry.js';

function enabledFor(plugin, config) {
  if (plugin.required) return true;
  if (typeof plugin.isEnabled === 'function') return plugin.isEnabled(config) === true;
  return plugin.enabled !== false;
}

function stableToolSnapshot(registrySnapshot, config) {
  const enabledIds = new Set(registrySnapshot.plugins
    .filter((plugin) => enabledFor(plugin, config))
    .map((plugin) => plugin.id));
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
    this.activeSnapshots = new Set();
    this.observerTimer = null;
    this.services = {};
  }

  register(plugin) {
    const result = this.registry.register(plugin);
    this.generations.set(plugin.id, (this.generations.get(plugin.id) || 0) + 1);
    this.enabled.set(plugin.id, plugin.enabled !== false);
    return result;
  }

  registerAll(plugins) {
    const result = this.registry.registerAll(plugins);
    for (const plugin of (Array.isArray(plugins) ? plugins : [plugins])) {
      this.generations.set(plugin.id, (this.generations.get(plugin.id) || 0) + 1);
      this.enabled.set(plugin.id, plugin.enabled !== false);
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
    if (!enabled) this.runtime.get(pluginId)?.controller.abort(new Error('Plugin disabled'));
  }

  async startAll({ services = {}, config = this.configProvider() } = {}) {
    this.services = services && typeof services === 'object' ? { ...services } : {};
    const started = [];
    let startingId = '';
    try {
      for (const registration of this.registry.getRegistrations()) {
        const plugin = registration.plugin;
        if (!this.isEnabled(plugin.id)) continue;
        startingId = plugin.id;
        const generation = this.generations.get(plugin.id) || 0;
        const controller = new AbortController();
        const runtimeServices = this.#servicesFor(plugin.id, config, generation, controller.signal);
        if (typeof plugin.start === 'function') await plugin.start(runtimeServices, snapshotPluginConfig(config), controller.signal);
        this.runtime.set(plugin.id, { controller, generation, services: runtimeServices });
        started.push(plugin.id);
        startingId = '';
      }
      this.#startObserverWorker();
      return this.status();
    } catch (error) {
      if (startingId) {
        try { await this.registry.getRegistrations().find((item) => item.plugin.id === startingId)?.plugin.stop?.('startup-failed'); } catch { /* best effort */ }
        this.registry.unregister(startingId);
      }
      await this.#stopIds(started, 'startup-failed');
      throw error;
    }
  }

  async stopAll(reason = 'shutdown') {
    if (this.observerTimer) clearTimeout(this.observerTimer);
    this.observerTimer = null;
    await this.#stopIds([...this.runtime.keys()], reason);
    for (const snapshot of this.activeSnapshots) snapshot.abortController.abort(new Error(`Plugins stopped: ${reason}`));
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
    await this.#stopIds([pluginId], reason);
  }

  releaseRunSnapshot(snapshot) {
    if (snapshot) this.activeSnapshots.delete(snapshot);
  }

  isEnabled(pluginId) {
    const registration = this.registry.getRegistrations().find((item) => item.plugin.id === pluginId);
    if (!registration) return false;
    return this.enabled.has(pluginId)
      ? this.enabled.get(pluginId) === true
      : enabledFor(registration.plugin, this.configProvider());
  }

  createRunSnapshot(config = this.configProvider()) {
    const registrySnapshot = this.registry.snapshot();
    const configSnapshot = snapshotConfig(config);
    const tools = stableToolSnapshot({
      ...registrySnapshot,
      plugins: registrySnapshot.plugins.filter((plugin) => (
        (this.enabled.has(plugin.id) ? this.enabled.get(plugin.id) : enabledFor(plugin, configSnapshot))
      ))
    }, configSnapshot);
    const plugins = registrySnapshot.plugins.filter((plugin) => (
      (this.enabled.has(plugin.id) ? this.enabled.get(plugin.id) : enabledFor(plugin, configSnapshot))
    ));
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
        .filter((provider) => plugins.some((plugin) => plugin.id === provider.ownerPluginId))),
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
    return this.registry.listPlugins().map((plugin) => ({
      ...plugin,
      enabled: this.isEnabled(plugin.id),
      generation: this.generations.get(plugin.id) || 0
    }));
  }

  async collectContext(snapshot, runContext, { budgetChars = 6000, timeoutMs = 500 } = {}) {
    const blocks = [];
    const diagnostics = [];
    let remaining = Math.max(0, Number(budgetChars) || 6000);
    for (const provider of snapshot?.contextProviders || []) {
      const startedAt = Date.now();
      let timeoutHandle = null;
      try {
        const result = await Promise.race([
          provider.provide(runContext, this.#servicesFor(provider.ownerPluginId, snapshot.config,
            snapshot.generations[provider.ownerPluginId] || 0, snapshot.signal)),
          new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => reject(new Error('provider timeout')), timeoutMs);
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
          outboundAttempted: actionSummary.outboundAttempted === true
        },
        sourceMessageIds: (Array.isArray(sourceMessageIds) ? sourceMessageIds : []).map(String).slice(0, 32),
        completedAt: Number(completedAt) || Date.now()
      }));
  }

  #servicesFor(pluginId, config, generation, signal) {
    return Object.freeze({
      pluginId,
      generation,
      config: snapshotPluginConfig(config),
      signal,
      logger: this.services.logger || (() => {}),
      resources: Object.freeze({
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (timer) => clearTimeout(timer)
      })
    });
  }

  #startObserverWorker() {
    const hasEnabledObserver = this.registry.getSessionObservers()
      .some((observer) => this.isEnabled(observer.ownerPluginId));
    if (!this.eventStore || !hasEnabledObserver || this.observerTimer) return;
    const tick = async () => {
      this.observerTimer = null;
      await this.drainCompletionEvents();
      if (this.runtime.size) this.observerTimer = setTimeout(tick, 1000);
      this.observerTimer?.unref?.();
    };
    this.observerTimer = setTimeout(tick, 0);
    this.observerTimer.unref?.();
  }

  async drainCompletionEvents(limit = 20) {
    if (!this.eventStore) return 0;
    const events = this.eventStore.claimExtensionEvents?.(limit) || [];
    let delivered = 0;
    for (const event of events) {
      const registration = this.registry.getRegistrations()
        .find((item) => item.plugin.id === event.observerPluginId);
      const observer = registration?.sessionObservers.find((item) => item.id === event.observerId);
      if (!observer || !this.isEnabled(event.observerPluginId)) {
        this.eventStore.failExtensionEvent?.(event.eventId, 'observer disabled', { expired: true });
        continue;
      }
      try {
        await observer.observe(event, this.#servicesFor(event.observerPluginId, this.configProvider(),
          event.pluginGeneration, new AbortController().signal));
        this.eventStore.completeExtensionEvent?.(event.eventId);
        delivered += 1;
      } catch (error) {
        this.eventStore.failExtensionEvent?.(event.eventId, String(error?.message ?? error));
      }
    }
    return delivered;
  }

  async #stopIds(ids, reason) {
    for (const id of ids) {
      const runtime = this.runtime.get(id);
      const registration = this.registry.getRegistrations().find((item) => item.plugin.id === id);
      if (!runtime || !registration) continue;
      runtime.controller.abort(new Error(`Plugin stopped: ${reason}`));
      try { await registration.plugin.stop?.(reason, runtime.services); } catch { /* best effort */ }
      this.runtime.delete(id);
      this.generations.set(id, (this.generations.get(id) || 0) + 1);
    }
  }
}
