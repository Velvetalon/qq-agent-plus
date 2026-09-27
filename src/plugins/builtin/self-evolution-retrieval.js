import { DATA_DIR } from '../../core/config.js';
import {
  notebookDatabasePath
} from '../self-evolution/notebook-store.js';
import {
  createSelfEvolutionRetrievalProvider,
  SELF_EVOLUTION_RETRIEVAL_PROVIDER_ID
} from '../self-evolution/retrieval-provider.js';
import { selfEvolutionConfig } from '../self-evolution/config.js';

export const SELF_EVOLUTION_RETRIEVAL_PLUGIN_ID = 'self-evolution-retrieval';

function retrievalEnabled(config = {}) {
  return selfEvolutionConfig(config).retrievalEnabled;
}

export function createSelfEvolutionRetrievalPlugin({
  dataDir = DATA_DIR,
  filename = notebookDatabasePath(dataDir),
  now,
  getStore = null
} = {}) {
  const provider = createSelfEvolutionRetrievalProvider({
    getStore,
    dataDir,
    filename,
    now,
    ownerPluginId: SELF_EVOLUTION_RETRIEVAL_PLUGIN_ID
  });
  return Object.freeze({
    id: SELF_EVOLUTION_RETRIEVAL_PLUGIN_ID,
    name: 'Self-evolution Retrieval',
    version: '1.0.0',
    apiVersion: 1,
    enabled: true,
    isEnabled: retrievalEnabled,
    declare(registrar) {
      registrar.addContextProvider(provider);
    },
    start() {
      return provider;
    },
    stop() {},
    getProvider() {
      return provider;
    },
    providerId: SELF_EVOLUTION_RETRIEVAL_PROVIDER_ID
  });
}
