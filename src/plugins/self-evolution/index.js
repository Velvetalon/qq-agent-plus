export {
  DEFAULT_NOTEBOOK_LIMITS,
  NOTEBOOK_SCOPES,
  NOTEBOOK_STATUSES,
  NotebookError,
  NotebookStore,
  SELF_EVOLUTION_PLUGIN_ID,
  notebookDatabasePath
} from './notebook-store.js';

export {
  CAPABILITY_GAP_CATEGORIES,
  DEFAULT_REFLECTION_LIMITS,
  REFLECTION_INVALID_EVIDENCE_KINDS,
  REFLECTION_DATABASE_NAME,
  REFLECTION_JOB_STATUSES,
  REFLECTION_MODES,
  REFLECTION_OBSERVER_ID,
  REFLECTION_PROPOSAL_STATUSES,
  ReflectionError,
  ReflectionStore,
  createReflectionObserver,
  hashBasePersona,
  normalizeCompletionObservation,
  observationWindowKey,
  reflectionDatabasePath,
  reflectionPrompt,
  validateReflectionOutput
} from './reflection-store.js';

export {
  ReflectionWorker
} from './reflection-worker.js';

export {
  createReflectionPlugin,
  openReflectionStore,
  reflectionConfig
} from './reflection-plugin.js';

export {
  DEFAULT_RETRIEVAL_MAX_CHARS,
  DEFAULT_RETRIEVAL_MAX_NOTES,
  DEFAULT_RETRIEVAL_MAX_SNIPPET_CHARS,
  SELF_EVOLUTION_RETRIEVAL_PROVIDER_ID,
  SelfEvolutionRetrievalProvider,
  createSelfEvolutionRetrievalProvider,
  parseSourceRef
} from './retrieval-provider.js';

export {
  createSelfEvolutionPlugin,
  openSelfEvolutionNotebook,
  selfEvolutionPlugin
} from '../builtin/self-evolution.js';
