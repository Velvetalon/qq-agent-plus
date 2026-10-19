import { EmbeddingClient, embeddingProfileId, normalizeEmbeddingConfig } from './embedding-client.js';

export const EMBEDDING_PRESET = Object.freeze({
  provider: 'NanoGPT',
  baseUrl: 'https://api.nano-gpt.com/api/v1',
  model: 'Qwen/Qwen3-Embedding-4B',
  dimension: 2560
});
export const EMBEDDING_PROBE_TEXT = 'QQAgent embedding connection test.';
const MASKS = new Set(['******', '[redacted]', '••••••••']);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

function invalid(code, message) {
  return Object.assign(new Error(message), { code, httpStatus: 400 });
}

function gateway(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    return url.href.replace(/\/+$/u, '').replace(/\/embeddings$/u, '');
  } catch {
    throw invalid('EMBEDDING_GATEWAY_INVALID', '模型网关须为完整 HTTP(S) 地址，不能包含账户、密码、查询参数或片段');
  }
}

export function embeddingSettingsDefaults(current = {}) {
  const hasProfile = Boolean(current.provider || current.model || current.endpoint || current.baseUrl || current.baseURL || current.url);
  return hasProfile ? { ...current } : {
    enabled: false,
    provider: EMBEDDING_PRESET.provider,
    endpoint: EMBEDDING_PRESET.baseUrl,
    model: EMBEDDING_PRESET.model,
    dimension: EMBEDDING_PRESET.dimension,
    maxDistance: 0.5,
    allowQuery: false,
    allowPrivate: false,
    ...current
  };
}

/** Only this module's fields may be edited. Empty/masked keys never erase secrets. */
export function prepareEmbeddingSettings(current = {}, patch = {}) {
  const next = embeddingSettingsDefaults(current);
  for (const key of ['enabled', 'allowQuery', 'allowPrivate', 'clearApiKey']) {
    if (hasOwn(patch, key) && typeof patch[key] !== 'boolean') throw invalid('EMBEDDING_FIELD_INVALID', `${key} 必须为布尔值`);
  }
  for (const key of ['enabled', 'allowQuery', 'allowPrivate']) {
    if (hasOwn(patch, key)) next[key] = patch[key];
  }
  for (const key of ['provider', 'model']) {
    if (hasOwn(patch, key)) next[key] = typeof patch[key] === 'string' ? patch[key].trim() : '';
    if (typeof next[key] !== 'string' || !next[key] || next[key].length > 200 || /[\r\n\0]/u.test(next[key])) throw invalid('EMBEDDING_FIELD_INVALID', `${key} 不能为空，且不能超过 200 字符`);
  }
  const requestedGateway = hasOwn(patch, 'baseUrl') ? patch.baseUrl
    : hasOwn(patch, 'endpoint') ? patch.endpoint
      : next.endpoint || next.baseUrl || next.baseURL || next.url;
  const baseUrl = gateway(requestedGateway);
  if (hasOwn(patch, 'dimension')) next.dimension = ['string', 'number'].includes(typeof patch.dimension) ? Number(patch.dimension) : NaN;
  if (!Number.isSafeInteger(next.dimension) || next.dimension < 1 || next.dimension > 16384) {
    throw invalid('EMBEDDING_DIMENSION_INVALID', '向量维度必须是 1 到 16384 的整数');
  }
  const knownDimension = { 'qwen/qwen3-embedding-4b': 2560, 'qwen/qwen3-embedding-8b': 4096 }[next.model.toLowerCase()];
  if (knownDimension && next.dimension !== knownDimension) {
    throw invalid('EMBEDDING_DIMENSION_INVALID', `此模型须使用 ${knownDimension} 维，不能混用其他模型的向量`);
  }
  if (hasOwn(patch, 'maxDistance')) {
    if (!['string', 'number'].includes(typeof patch.maxDistance) || String(patch.maxDistance).trim() === '') {
      throw invalid('EMBEDDING_DISTANCE_INVALID', '余弦距离阈值必须为 0 到 2 之间的数值');
    }
    next.maxDistance = Number(patch.maxDistance);
    if (!Number.isFinite(next.maxDistance) || next.maxDistance < 0 || next.maxDistance > 2) {
      throw invalid('EMBEDDING_DISTANCE_INVALID', '余弦距离阈值必须为 0 到 2 之间的数值');
    }
  }
  if (hasOwn(patch, 'apiKey') && typeof patch.apiKey !== 'string') throw invalid('EMBEDDING_KEY_INVALID', 'API Key 必须为文本');
  const submitted = String(patch.apiKey || '').trim();
  const replacement = submitted && !MASKS.has(submitted) ? submitted : '';
  if (replacement.length > 8192 || /[\r\n\0]/u.test(replacement)) throw invalid('EMBEDDING_KEY_INVALID', 'API Key 格式无效');
  let previousGateway = '';
  try { previousGateway = gateway(current.endpoint || current.baseUrl || current.baseURL || current.url); } catch { /* no saved destination */ }
  const savedKey = String(current.apiKey || current.key || '').trim();
  if (savedKey && !MASKS.has(savedKey) && previousGateway !== baseUrl && !replacement && patch.clearApiKey !== true) {
    throw invalid('EMBEDDING_KEY_DESTINATION_CHANGED', '网关已改变，请重新输入用于该网关的 API Key，或勾选清除密钥；不会把旧密钥发往新地址');
  }
  if (patch.clearApiKey && replacement) throw invalid('EMBEDDING_KEY_INVALID', '不能同时清除并替换 API Key');
  next.apiKey = patch.clearApiKey ? '' : replacement || (MASKS.has(savedKey) ? '' : savedKey);
  next.endpoint = baseUrl;
  // Canonical fields prevent stale aliases from reviving a cleared credential.
  delete next.key;
  delete next.baseUrl;
  delete next.baseURL;
  delete next.url;
  if (next.apiKeyRef && !replacement && !patch.clearApiKey) throw invalid('EMBEDDING_KEY_REF_UNSUPPORTED', '此宿主不支持 apiKeyRef，请在本页设置 API Key');
  delete next.apiKeyRef;
  return next;
}

export function publicEmbeddingSettings(current = {}) {
  const effective = embeddingSettingsDefaults(current);
  const normalized = normalizeEmbeddingConfig(effective);
  let baseUrl = '';
  try { baseUrl = gateway(effective.endpoint || effective.baseUrl || effective.baseURL || effective.url); } catch { /* show invalid as unconfigured */ }
  return {
    enabled: normalized.enabled,
    provider: normalized.provider,
    baseUrl,
    model: normalized.model,
    dimension: normalized.dimension,
    maxDistance: normalized.maxDistance,
    hasApiKey: Boolean(normalized.apiKey && !MASKS.has(normalized.apiKey)),
    allowQuery: normalized.allowQuery,
    allowPrivate: normalized.allowPrivate,
    profileId: embeddingProfileId(effective)
  };
}

export function embeddingSettingsState(current = {}, lastTest = null, vector = null) {
  const config = publicEmbeddingSettings(current);
  let valid = true;
  try { prepareEmbeddingSettings(current); } catch { valid = false; }
  const configured = valid && Boolean(config.baseUrl) && new EmbeddingClient({ config: current }).configured;
  const state = !config.enabled ? 'disabled' : !configured ? 'unconfigured'
    : lastTest?.ok === false || Number(vector?.stats?.failed) > 0 || (vector && vector.reason !== 'ready') ? 'degraded'
      : lastTest?.ok === true ? 'verified' : 'unverified';
  return { required: true, state, configured, config, lastTest, vector: vector || null };
}

/** Fixed public diagnostic text only; provider bodies, thrown messages and keys never escape. */
export async function probeEmbeddingSettings(config, { fetchImpl = globalThis.fetch, signal } = {}) {
  const startedAt = Date.now();
  const client = new EmbeddingClient({ config: { ...config, documentPrefix: '' }, fetchImpl });
  if (!client.configured) return { ok: false, code: 'EMBEDDING_NOT_CONFIGURED', error: 'Embedding 未启用或缺少 API Key，未发送测试请求', latencyMs: 0 };
  try {
    await client.embedDocuments([EMBEDDING_PROBE_TEXT], { signal });
    return { ok: true, code: 'EMBEDDING_PROBE_OK', dimension: client.dimension, latencyMs: Date.now() - startedAt };
  } catch (error) {
    const messages = {
      EMBEDDING_AUTH: 'API Key 无效或无权限',
      EMBEDDING_RATE_LIMIT: '网关限流，请稍后手动重试',
      EMBEDDING_HTTP: '模型网关返回错误',
      EMBEDDING_TIMEOUT: '模型网关请求超时',
      EMBEDDING_RESPONSE_INVALID: '模型返回的向量格式或维度不匹配'
    };
    const code = signal?.aborted ? 'EMBEDDING_CANCELLED'
      : messages[error?.code] ? error.code
        : error?.name === 'AbortError' || error?.name === 'TimeoutError' ? 'EMBEDDING_TIMEOUT' : 'EMBEDDING_PROBE_FAILED';
    return { ok: false, code, error: code === 'EMBEDDING_CANCELLED' ? '测试已取消' : messages[code] || '无法完成测试，请检查网关、网络和向量维度', latencyMs: Date.now() - startedAt };
  }
}
