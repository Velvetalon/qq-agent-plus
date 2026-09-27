import crypto from 'node:crypto';

export const EMBEDDING_INPUT_VERSION = 'role-note-v1';

function text(value) {
  return value == null ? '' : String(value);
}

function positiveInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function normalizeEndpoint(config) {
  const raw = text(config.endpoint || config.baseUrl || config.url).trim();
  if (!raw) return '';
  return raw.replace(/\/+$/u, '').endsWith('/embeddings')
    ? raw.replace(/\/+$/u, '')
    : `${raw.replace(/\/+$/u, '')}/embeddings`;
}

function vectorValues(value, dimension) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    throw new Error('embedding vector must be an array');
  }
  const values = Array.from(value, Number);
  if (values.length !== dimension) {
    throw new Error(`embedding dimension mismatch: expected ${dimension}, got ${values.length}`);
  }
  if (values.some((item) => !Number.isFinite(item))) {
    throw new Error('embedding vector contains non-finite values');
  }
  const norm = Math.sqrt(values.reduce((sum, item) => sum + item * item, 0));
  if (!(norm > 0)) throw new Error('embedding vector has zero norm');
  return values;
}

function normalizeConfig(config = {}) {
  const selected = config && typeof config === 'object' ? config : {};
  return Object.freeze({
    enabled: selected.enabled === true,
    provider: text(selected.provider).trim(),
    endpoint: normalizeEndpoint(selected),
    model: text(selected.model).trim(),
    dimension: positiveInt(selected.dimension),
    apiKey: text(selected.apiKey || selected.key).trim(),
    apiKeyRef: text(selected.apiKeyRef).trim(),
    allowPrivate: selected.allowPrivate === true,
    allowQuery: selected.allowQuery === true || selected.allowPrivate === true,
    timeoutMs: Math.max(1000, positiveInt(selected.timeoutMs, 8000)),
    maxBatch: Math.min(32, Math.max(1, positiveInt(selected.maxBatch, 16))),
    queryPrefix: text(selected.queryPrefix),
    documentPrefix: text(selected.documentPrefix),
    inputVersion: text(selected.inputVersion || EMBEDDING_INPUT_VERSION)
  });
}

export function embeddingProfileId(config = {}) {
  const selected = normalizeConfig(config);
  return crypto.createHash('sha256').update(JSON.stringify({
    provider: selected.provider,
    endpoint: selected.endpoint,
    model: selected.model,
    dimension: selected.dimension,
    queryPrefix: selected.queryPrefix,
    documentPrefix: selected.documentPrefix,
    inputVersion: selected.inputVersion
  })).digest('hex');
}

export function embeddingInputHash(textValue, config = {}, kind = 'document') {
  const selected = normalizeConfig(config);
  const prefix = kind === 'query' ? selected.queryPrefix : selected.documentPrefix;
  return crypto.createHash('sha256')
    .update(`${selected.inputVersion}\0${kind}\0${prefix}${text(textValue)}`, 'utf8')
    .digest('hex');
}

export class EmbeddingClient {
  constructor({ config = {}, fetchImpl = globalThis.fetch } = {}) {
    this.config = normalizeConfig(config);
    this.fetchImpl = typeof fetchImpl === 'function' ? fetchImpl : null;
    this.provider = this.config.provider;
    this.model = this.config.model;
    this.dimension = this.config.dimension;
    this.profileId = embeddingProfileId(this.config);
  }

  get configured() {
    return this.config.enabled
      && Boolean(this.config.provider)
      && Boolean(this.config.endpoint)
      && Boolean(this.config.model)
      && this.config.dimension > 0
      && Boolean(this.fetchImpl);
  }

  async isAvailable() {
    return this.configured;
  }

  async authorizeNote(note) {
    const privateNote = ['chat', 'chat-private', 'private'].includes(
      text(note?.scope || note?.visibility).toLowerCase()
    );
    return !privateNote || this.config.allowPrivate;
  }

  async authorizeQuery() {
    return this.config.allowQuery;
  }

  async embedDocuments(texts, { signal = null } = {}) {
    const values = Array.isArray(texts) ? texts.map(text) : [];
    if (!this.configured) throw Object.assign(
      new Error('embedding-not-configured'),
      { code: 'EMBEDDING_NOT_CONFIGURED' }
    );
    if (values.length < 1 || values.length > this.config.maxBatch) {
      throw Object.assign(new Error('embedding batch size is out of range'), {
        code: 'EMBEDDING_BATCH_INVALID'
      });
    }
    const inputs = values.map((value) => `${this.config.documentPrefix}${value}`);
    return this.#request(inputs, { signal });
  }

  async embedNote({ text: noteText, signal = null } = {}) {
    const result = await this.embedDocuments([noteText], { signal });
    return result.vectors[0];
  }

  async embedQuery({ query, signal = null } = {}) {
    if (!this.configured) throw Object.assign(
      new Error('embedding-not-configured'),
      { code: 'EMBEDDING_NOT_CONFIGURED' }
    );
    const result = await this.#request(
      [`${this.config.queryPrefix}${text(query)}`],
      { signal }
    );
    return result.vectors[0];
  }

  async #request(input, { signal = null } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(
      Object.assign(new Error('embedding request timeout'), {
        code: 'EMBEDDING_TIMEOUT'
      })
    ), this.config.timeoutMs);
    const combined = signal && typeof AbortSignal?.any === 'function'
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    try {
      const response = await this.fetchImpl(this.config.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.config.model,
          input,
          dimensions: this.config.dimension
        }),
        signal: combined
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(`embedding http ${response.status}`);
        error.code = response.status === 401 || response.status === 403
          ? 'EMBEDDING_AUTH'
          : response.status === 429
            ? 'EMBEDDING_RATE_LIMIT'
            : 'EMBEDDING_HTTP';
        error.status = response.status;
        throw error;
      }
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      if (rows.length !== input.length) {
        throw Object.assign(new Error('embedding response count mismatch'), {
          code: 'EMBEDDING_RESPONSE_INVALID'
        });
      }
      const ordered = [...rows].sort((left, right) => (
        Number(left?.index) - Number(right?.index)
      ));
      const vectors = ordered.map((row) => vectorValues(row?.embedding, this.dimension));
      if (ordered.some((row, index) => Number(row?.index) !== index)) {
        throw Object.assign(new Error('embedding response order mismatch'), {
          code: 'EMBEDDING_RESPONSE_INVALID'
        });
      }
      return {
        vectors,
        usage: payload?.usage && typeof payload.usage === 'object'
          ? structuredClone(payload.usage)
          : null,
        usageKnown: Boolean(payload?.usage && typeof payload.usage === 'object')
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createEmbeddingClient(options = {}) {
  return new EmbeddingClient(options);
}
