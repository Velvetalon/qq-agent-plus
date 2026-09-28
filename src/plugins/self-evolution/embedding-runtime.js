import {
  EmbeddingClient,
  embeddingProfileId,
  normalizeEmbeddingConfig
} from './embedding-client.js';

function safeConfig(config = {}) {
  const normalized = normalizeEmbeddingConfig(config);
  return Object.freeze({
    enabled: normalized.enabled,
    provider: normalized.provider,
    endpoint: normalized.endpoint,
    model: normalized.model,
    dimension: normalized.dimension,
    allowPrivate: normalized.allowPrivate,
    allowQuery: normalized.allowQuery,
    allowAnonymous: normalized.allowAnonymous,
    timeoutMs: normalized.timeoutMs,
    maxBatch: normalized.maxBatch,
    queryPrefix: normalized.queryPrefix,
    documentPrefix: normalized.documentPrefix,
    inputVersion: normalized.inputVersion,
    profileId: embeddingProfileId(normalized)
  });
}

/** Host-owned capability; credentials never enter the plugin config object. */
export function createEmbeddingCapability({ config = {}, fetchImpl = globalThis.fetch } = {}) {
  if (String(config.apiKeyRef || '').trim()) {
    throw Object.assign(new Error('embedding apiKeyRef is not supported by this host'), {
      code: 'EMBEDDING_KEY_REF_UNSUPPORTED'
    });
  }
  const client = new EmbeddingClient({ config, fetchImpl });
  const view = safeConfig(config);
  return Object.freeze({
    config: view,
    profileId: view.profileId,
    isConfigured: () => client.configured,
    authorizeNote: (note) => client.authorizeNote(note),
    authorizeQuery: () => client.authorizeQuery(),
    embedNote: (options) => client.embedNote(options),
    embedQuery: (options) => client.embedQuery(options)
  });
}
