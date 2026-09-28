import { DATA_DIR } from '../../core/config.js';
import {
  NotebookStore,
  SELF_EVOLUTION_PLUGIN_ID,
  notebookDatabasePath
} from './notebook-store.js';
import {
  DEFAULT_REFLECTION_LIMITS,
  REFLECTION_OBSERVER_ID,
  ReflectionStore,
  createReflectionObserver,
  reflectionDatabasePath
} from './reflection-store.js';
import { ReflectionWorker } from './reflection-worker.js';
import { createLearnedSelfContextProvider } from './learned-self-provider.js';
import { selfEvolutionConfig } from './config.js';

export function reflectionConfig(config = {}) {
  const selected = selfEvolutionConfig(config);
  const reflection = selected.reflection;
  return {
    ...reflection,
    enabled: selected.reflectionEnabled,
    mode: 'bounded_auto',
    pollIntervalMs: Math.max(1, Number(reflection.pollIntervalMs) || 1000),
    minValidSessions: Math.max(
      1,
      Number(reflection.minValidSessions) || DEFAULT_REFLECTION_LIMITS.minValidSessions
    ),
    observationWindowMs: Math.max(
      0,
      Number(reflection.observationWindowMs) || DEFAULT_REFLECTION_LIMITS.observationWindowMs
    )
  };
}

export function createReflectionPlugin({
  id = 'self-evolution-reflection',
  dataDir = DATA_DIR,
  filename = reflectionDatabasePath(dataDir),
  notebookFilename = notebookDatabasePath(dataDir),
  reflector,
  owner,
  limits = {},
  now,
  getBasePersona = null,
  getMode = null,
  getAccountId = null,
  getExpectedProfileRevision = null,
  notebookAdapter = null,
  embeddingClient = null
} = {}) {
  if (typeof reflector !== 'function') throw new TypeError('reflector function is required');
  if (![SELF_EVOLUTION_PLUGIN_ID, 'self-evolution-reflection'].includes(id)) {
    throw new TypeError('reflection plugin id must be self-evolution or self-evolution-reflection');
  }
  let store = null;
  let notebook = null;
  let worker = null;
  const learnedSelfProvider = createLearnedSelfContextProvider({
    getStore: () => store,
    getBasePersona: () => (
      typeof getBasePersona === 'function' ? getBasePersona() : null
    )
  });
  const observer = createReflectionObserver({
    getStore: () => store,
    isEnabled: () => Boolean(store && worker?.active)
  });
  const plugin = {
    id,
    name: 'Self-evolution Reflection',
    version: '1.0.0',
    apiVersion: 1,
    enabled: false,
    isEnabled(config) {
      return reflectionConfig(config).enabled;
    },
    declare(registrar) {
      registrar.addSessionObserver({
        ...observer,
        ownerPluginId: id,
        id: REFLECTION_OBSERVER_ID
      });
      if (typeof registrar.addContextProvider === 'function') {
        registrar.addContextProvider({
          ...learnedSelfProvider,
          ownerPluginId: id
        });
      }
    },
    start(_services, config = {}) {
      const selected = reflectionConfig(config);
      if (!selected.enabled) return null;
      const evolution = selfEvolutionConfig(config);
      const embeddingConfig = evolution.retrieval?.embedding
        && typeof evolution.retrieval.embedding === 'object'
        ? evolution.retrieval.embedding
        : {};
      const client = embeddingClient || _services?.capabilities?.embedding || null;
      const selectedLimits = { ...limits, ...selected };
      store ||= new ReflectionStore({ dataDir, filename, limits: selectedLimits, now });
      notebook ||= new NotebookStore({
        dataDir,
        filename: notebookFilename,
        now,
        embeddingConfig,
        embeddingClient: client
      });
      worker ||= new ReflectionWorker({
        store,
        reflector,
        owner,
        limits: selectedLimits,
        now
      });
      worker.start({
        enabled: true,
        services: _services,
        pollIntervalMs: selected.pollIntervalMs,
        getBasePersona: typeof getBasePersona === 'function'
          ? () => getBasePersona(selected, _services)
          : () => selected.basePersona,
        getMode: typeof getMode === 'function'
          ? () => getMode(selected, _services)
          : () => selected.mode,
        getExpectedProfileRevision: typeof getExpectedProfileRevision === 'function'
          ? () => getExpectedProfileRevision(selected, _services)
          : () => {
              const accountId = selected.accountId || getAccountId?.(selected, _services) || '';
              if (!accountId) return null;
              return store.getLearnedSelfRevision({ accountId });
            },
        notebook: notebookAdapter || notebook
      });
      return { store, worker };
    },
    async stop(reason) {
      await worker?.stop(reason);
      worker = null;
      notebook?.close();
      notebook = null;
      store?.close();
      store = null;
    },
    getStore() {
      return store;
    },
    getWorker() {
      return worker;
    }
  };
  return Object.freeze(plugin);
}

export function openReflectionStore(options = {}) {
  return ReflectionStore.openExisting(options);
}
