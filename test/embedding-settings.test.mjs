import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMBEDDING_PRESET, EMBEDDING_PROBE_TEXT, embeddingSettingsDefaults,
  embeddingSettingsState, prepareEmbeddingSettings, probeEmbeddingSettings, publicEmbeddingSettings
} from '../src/plugins/self-evolution/embedding-settings.js';
import { embeddingProfileId } from '../src/plugins/self-evolution/embedding-client.js';

const key = 'synthetic-embedding-only-key';
const configured = () => prepareEmbeddingSettings({}, { enabled: true, apiKey: key, allowQuery: true });

test('embedding preset is 4B/2560, inactive until explicitly configured, and safe to display', () => {
  assert.equal(EMBEDDING_PRESET.model, 'Qwen/Qwen3-Embedding-4B');
  assert.equal(EMBEDDING_PRESET.dimension, 2560);
  assert.equal(EMBEDDING_PRESET.provider, 'NanoGPT');
  assert.equal(EMBEDDING_PRESET.baseUrl, 'https://api.nano-gpt.com/api/v1');
  assert.equal(embeddingSettingsDefaults().enabled, false);
  assert.equal(embeddingSettingsDefaults().maxDistance, 0.5);
  assert.equal(embeddingSettingsState().state, 'disabled');
  const config = configured();
  const view = publicEmbeddingSettings(config);
  assert.equal(view.hasApiKey, true);
  assert.equal(JSON.stringify(view).includes(key), false);
  assert.equal(Object.hasOwn(view, 'apiKey'), false);
  assert.equal(embeddingSettingsState(config).state, 'unverified');
  assert.equal(embeddingSettingsState({ ...config, apiKey: '' }).state, 'unconfigured');
  assert.equal(embeddingSettingsState(config, { ok: false }).state, 'degraded');
  assert.equal(embeddingSettingsState(config, { ok: true }).state, 'verified');
  assert.equal(embeddingSettingsState(config, { ok: true }, { stats: { failed: 1 } }).state, 'degraded');
  assert.equal(embeddingSettingsState(config, { ok: true }, { reason: 'extension-unavailable', stats: {} }).state, 'degraded');
});

test('blank/masked keys preserve, explicit clear removes aliases, destination changes require a replacement', () => {
  const config = configured();
  for (const apiKey of ['', ' ', '******', '[redacted]', '••••••••']) {
    assert.equal(prepareEmbeddingSettings(config, { apiKey }).apiKey, key);
  }
  assert.equal(prepareEmbeddingSettings(config, { baseUrl: 'https://api.nano-gpt.com/api/v1/embeddings/' }).apiKey, key);
  assert.throws(() => prepareEmbeddingSettings(config, { baseUrl: 'https://another.invalid/v1' }), { code: 'EMBEDDING_KEY_DESTINATION_CHANGED' });
  assert.equal(prepareEmbeddingSettings(config, { baseUrl: 'https://another.invalid/v1', apiKey: 'synthetic-new' }).apiKey, 'synthetic-new');
  const cleared = prepareEmbeddingSettings({ ...config, key }, { clearApiKey: true });
  assert.equal(cleared.apiKey, '');
  assert.equal(Object.hasOwn(cleared, 'key'), false);
  assert.equal(prepareEmbeddingSettings(config, { baseUrl: 'https://another.invalid/v1', clearApiKey: true }).apiKey, '');
  assert.throws(() => prepareEmbeddingSettings(config, { clearApiKey: true, apiKey: 'synthetic-new' }), { code: 'EMBEDDING_KEY_INVALID' });
  const legacy = { ...config, endpoint: undefined, url: EMBEDDING_PRESET.baseUrl, apiKey: undefined, key };
  assert.equal(publicEmbeddingSettings(legacy).hasApiKey, true);
  assert.equal(prepareEmbeddingSettings(legacy).apiKey, key);
  assert.equal(Object.hasOwn(prepareEmbeddingSettings(legacy), 'url'), false);
  assert.equal(prepareEmbeddingSettings({ ...config, apiKeyRef: 'unsupported' }, { apiKey: 'synthetic-repair' }).apiKey, 'synthetic-repair');
});

test('validation rejects credential-bearing URLs, invalid dimensions and 4B/8B mixing without mutation', () => {
  const config = configured();
  for (const baseUrl of ['', '/v1', 'file:///tmp/test', 'https://user:secret@invalid/v1', 'https://invalid/v1?key=secret', 'https://invalid/v1#secret']) {
    assert.throws(() => prepareEmbeddingSettings(config, { baseUrl }), { code: 'EMBEDDING_GATEWAY_INVALID' });
  }
  for (const dimension of [0, -1, 2.5, 16385, 'bad', 4096]) {
    assert.throws(() => prepareEmbeddingSettings(config, { dimension }), { code: 'EMBEDDING_DIMENSION_INVALID' });
  }
  assert.throws(() => prepareEmbeddingSettings(config, { model: 'Qwen/Qwen3-Embedding-8B' }), { code: 'EMBEDDING_DIMENSION_INVALID' });
  assert.throws(() => prepareEmbeddingSettings(config, { provider: '' }), { code: 'EMBEDDING_FIELD_INVALID' });
  assert.throws(() => prepareEmbeddingSettings(config, { enabled: 'true' }), { code: 'EMBEDDING_FIELD_INVALID' });
  assert.throws(() => prepareEmbeddingSettings(config, { apiKey: 'synthetic\nheader' }), { code: 'EMBEDDING_KEY_INVALID' });
  assert.equal(config.dimension, 2560);
  const changed = prepareEmbeddingSettings(config, { model: 'Qwen/Qwen3-Embedding-8B', dimension: 4096 });
  assert.notEqual(embeddingProfileId(changed), embeddingProfileId(config));
  assert.equal(embeddingProfileId(prepareEmbeddingSettings(config, { apiKey: 'synthetic-rotated' })), embeddingProfileId(config));
  assert.equal(embeddingProfileId(prepareEmbeddingSettings(config, { maxDistance: 0.537 })), embeddingProfileId(config));
  for (const maxDistance of [-1, 3, '', null, 'bad', true]) {
    assert.throws(() => prepareEmbeddingSettings(config, { maxDistance }), { code: 'EMBEDDING_DISTANCE_INVALID' });
  }
  assert.equal(publicEmbeddingSettings({ ...config, endpoint: 'https://user:secret@invalid/v1?key=hidden' }).baseUrl, '');
});

test('fixed diagnostic verifies response dimension, returns no vectors or provider bodies, and does not require query consent', async () => {
  const requests = [];
  const config = { ...configured(), allowQuery: false };
  const result = await probeEmbeddingSettings(config, { fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return Response.json({ data: [{ index: 0, embedding: [1, ...Array(2559).fill(0)] }], usage: { unexpected: key } });
  } });
  assert.equal(result.ok, true);
  assert.equal(result.dimension, 2560);
  assert.equal(JSON.stringify(result).includes(key), false);
  assert.equal(Object.hasOwn(result, 'vectors'), false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `${EMBEDDING_PRESET.baseUrl}/embeddings`);
  assert.equal(requests[0].options.redirect, 'error');
  assert.deepEqual(JSON.parse(requests[0].options.body), { model: EMBEDDING_PRESET.model, input: [EMBEDDING_PROBE_TEXT], dimensions: 2560 });
});

test('diagnostic fails closed for unavailable, authentication, throttling, malformed vectors, timeout and cancellation', async () => {
  const config = configured();
  let calls = 0;
  const forbidden = async () => { calls += 1; throw new Error(key); };
  assert.equal((await probeEmbeddingSettings({ ...config, apiKey: '' }, { fetchImpl: forbidden })).code, 'EMBEDDING_NOT_CONFIGURED');
  assert.equal((await probeEmbeddingSettings({ ...config, enabled: false }, { fetchImpl: forbidden })).code, 'EMBEDDING_NOT_CONFIGURED');
  assert.equal(calls, 0);
  for (const [status, code] of [[401, 'EMBEDDING_AUTH'], [403, 'EMBEDDING_AUTH'], [429, 'EMBEDDING_RATE_LIMIT'], [503, 'EMBEDDING_HTTP']]) {
    const result = await probeEmbeddingSettings(config, { fetchImpl: async () => Response.json({ error: key }, { status }) });
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
    assert.equal(JSON.stringify(result).includes(key), false);
  }
  for (const payload of [{ data: [] }, { data: [{ index: 0, embedding: [1, 0] }] }, { data: [{ index: 0, embedding: Array(2560).fill(0) }] }]) {
    assert.equal((await probeEmbeddingSettings(config, { fetchImpl: async () => Response.json(payload) })).code, 'EMBEDDING_RESPONSE_INVALID');
  }
  const failed = await probeEmbeddingSettings(config, { fetchImpl: forbidden });
  assert.equal(failed.code, 'EMBEDDING_PROBE_FAILED');
  assert.equal(JSON.stringify(failed).includes(key), false);
  const controller = new AbortController();
  controller.abort();
  assert.equal((await probeEmbeddingSettings(config, { signal: controller.signal, fetchImpl: async (_url, options) => { options.signal.throwIfAborted(); } })).code, 'EMBEDDING_CANCELLED');
  const timeout = await probeEmbeddingSettings({ ...config, timeoutMs: 1000 }, { fetchImpl: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })) });
  assert.equal(timeout.code, 'EMBEDDING_TIMEOUT');
});
