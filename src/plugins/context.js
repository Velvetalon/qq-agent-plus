function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function cloneConfig(config) {
  if (config === undefined) return Object.freeze({});
  return deepFreeze(structuredClone(config));
}

function redactPluginConfig(value, key = '') {
  if (Array.isArray(value)) return value.map((item) => redactPluginConfig(item));
  if (/(?:api.?key|provider.?keys?|key|token|password|secret|credential|private.?key)/i.test(key)) return '[redacted]';
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .map(([childKey, childValue]) => [childKey, redactPluginConfig(childValue, childKey)]));
}

function freezeList(items) {
  return Object.freeze((Array.isArray(items) ? items : []).slice());
}

export function createRunContext(snapshot, {
  chatKey = '',
  accountId = '',
  sessionId = '',
  signal = null,
  visibleParticipants = [],
  currentMessageIds = []
} = {}) {
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError('plugin snapshot is required');
  const toolHandles = Object.fromEntries((snapshot.tools || []).map((tool) => [
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
  ]));
  return Object.freeze({
    chatKey: String(chatKey || ''),
    accountId: String(accountId || ''),
    sessionId: String(sessionId || ''),
    signal: signal || null,
    config: snapshotPluginConfig(snapshot.config),
    registryRevision: Number(snapshot.registryRevision) || 0,
    pluginIds: freezeList(snapshot.plugins?.map((plugin) => plugin.id)),
    toolHandles: Object.freeze(toolHandles),
    visibleParticipants: freezeList(visibleParticipants),
    currentMessageIds: freezeList(currentMessageIds)
  });
}

export function snapshotConfig(config) {
  return cloneConfig(config);
}

export function snapshotPluginConfig(config) {
  return deepFreeze(redactPluginConfig(structuredClone(config ?? {})));
}
