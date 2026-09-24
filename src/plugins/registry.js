import {
  validateContextProvider,
  validatePluginDefinition,
  validateSessionObserver,
  validateToolRegistration
} from './contract.js';

function duplicateError(kind, value) {
  return new Error(`Duplicate ${kind}: ${value}`);
}

function stablePluginSort(a, b) {
  const left = String(a.id);
  const right = String(b.id);
  return left < right ? -1 : left > right ? 1 : 0;
}

class PluginRegistrar {
  constructor(plugin) {
    this.plugin = plugin;
    this.tools = [];
    this.contextProviders = [];
    this.sessionObservers = [];
  }

  addTools(tools) {
    const list = Array.isArray(tools) ? tools : [tools];
    for (const tool of list) {
      this.tools.push(validateToolRegistration(tool, this.plugin.id));
    }
    return this;
  }

  addContextProvider(provider) {
    const list = Array.isArray(provider) ? provider : [provider];
    for (const item of list) {
      this.contextProviders.push(validateContextProvider(item, this.plugin.id));
    }
    return this;
  }

  addSessionObserver(observer) {
    const list = Array.isArray(observer) ? observer : [observer];
    for (const item of list) {
      this.sessionObservers.push(validateSessionObserver(item, this.plugin.id));
    }
    return this;
  }
}

function freezeRegistration(registration) {
  Object.freeze(registration.tools);
  Object.freeze(registration.contextProviders);
  Object.freeze(registration.sessionObservers);
  return Object.freeze(registration);
}

export class PluginRegistry {
  #plugins = new Map();
  #revision = 0;

  get revision() {
    return this.#revision;
  }

  stage(plugin) {
    const normalized = validatePluginDefinition(plugin);
    const registrar = new PluginRegistrar(normalized);
    normalized.declare(registrar);
    const registration = {
      plugin: normalized,
      tools: registrar.tools.map((tool, index) => ({ ...tool, registrationIndex: index })),
      contextProviders: registrar.contextProviders,
      sessionObservers: registrar.sessionObservers
    };
    this.#validateCandidate([...this.#plugins.values(), registration]);
    return freezeRegistration(registration);
  }

  publish(staged) {
    const items = Array.isArray(staged) ? staged : [staged];
    const candidate = [...this.#plugins.values(), ...items];
    this.#validateCandidate(candidate);
    const next = new Map(candidate.map((item) => [item.plugin.id, item]));
    this.#plugins = next;
    this.#revision += 1;
    return this.snapshot();
  }

  register(plugin) {
    return this.publish(this.stage(plugin));
  }

  registerAll(plugins) {
    const staged = (Array.isArray(plugins) ? plugins : [plugins]).map((plugin) => this.stage(plugin));
    return this.publish(staged);
  }

  unregister(pluginId) {
    const id = String(pluginId || '');
    if (!this.#plugins.has(id)) return false;
    const next = new Map(this.#plugins);
    next.delete(id);
    this.#plugins = next;
    this.#revision += 1;
    return true;
  }

  listPlugins() {
    return [...this.#plugins.values()]
      .sort((a, b) => stablePluginSort(a.plugin, b.plugin))
      .map((item) => ({
        id: item.plugin.id,
        name: item.plugin.name,
        version: item.plugin.version,
        apiVersion: item.plugin.apiVersion,
        required: item.plugin.required === true,
        enabled: item.plugin.enabled !== false
      }));
  }

  getRegistrations() {
    return [...this.#plugins.values()].sort((a, b) => stablePluginSort(a.plugin, b.plugin));
  }

  getTools() {
    const entries = this.getRegistrations().flatMap((registration) => registration.tools
      .map((tool) => ({ plugin: registration.plugin, tool })));
    entries.sort((left, right) => {
      const leftOrder = left.tool.order;
      const rightOrder = right.tool.order;
      if (leftOrder !== undefined && rightOrder !== undefined && leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      if (leftOrder !== undefined && rightOrder === undefined) return -1;
      if (leftOrder === undefined && rightOrder !== undefined) return 1;
      const pluginOrder = stablePluginSort(left.plugin, right.plugin);
      if (pluginOrder) return pluginOrder;
      return left.tool.registrationIndex - right.tool.registrationIndex;
    });
    return entries.map(({ tool }) => {
      const { registrationIndex, ...clean } = tool;
      return clean;
    });
  }

  getContextProviders() {
    return this.getRegistrations().flatMap((registration) => registration.contextProviders);
  }

  getSessionObservers() {
    return this.getRegistrations().flatMap((registration) => registration.sessionObservers);
  }

  snapshot() {
    return Object.freeze({
      revision: this.#revision,
      plugins: Object.freeze(this.listPlugins()),
      tools: Object.freeze(this.getTools()),
      contextProviders: Object.freeze(this.getContextProviders()),
      sessionObservers: Object.freeze(this.getSessionObservers())
    });
  }

  #validateCandidate(candidate) {
    const owners = new Set();
    const toolNames = new Set();
    const providerIds = new Set();
    const observerIds = new Set();
    for (const registration of candidate) {
      if (!registration || !registration.plugin) throw new TypeError('Invalid staged plugin registration');
      validatePluginDefinition(registration.plugin);
      const id = registration.plugin.id;
      if (owners.has(id)) throw duplicateError('plugin owner', id);
      owners.add(id);
      for (const tool of registration.tools) {
        validateToolRegistration(tool, id);
        if (toolNames.has(tool.name)) throw duplicateError('tool name', tool.name);
        toolNames.add(tool.name);
      }
      for (const provider of registration.contextProviders) {
        validateContextProvider(provider, id);
        if (providerIds.has(provider.id)) throw duplicateError('context provider', provider.id);
        providerIds.add(provider.id);
      }
      for (const observer of registration.sessionObservers) {
        validateSessionObserver(observer, id);
        if (observerIds.has(observer.id)) throw duplicateError('session observer', observer.id);
        observerIds.add(observer.id);
      }
    }
  }
}
