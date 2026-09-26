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

const SECRET_KEY_RE = /(?:api.?key|provider.?keys?|key|token|password|secret|credential|private.?key|auth(?:orization)?(?:[_-]?header)?|bearer|cookie|set[_-]?cookie|client[_-]?secret)/i;
const SECRET_VALUE_PATTERNS = Object.freeze([
  /^sk-[A-Za-z0-9_-]{8,}$/,
  /^(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{8,}$/i,
  /^xox[a-z]?-[A-Za-z0-9-]{8,}$/i,
  /^eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,}){2}$/,
  /^Bearer\s+\S{8,}$/i,
  /^[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i
]);

function isSecretValue(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return Boolean(text) && SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(text));
}

function redactPluginConfig(value, key = '') {
  if (SECRET_KEY_RE.test(key) || isSecretValue(value)) return '[redacted]';
  if (Array.isArray(value)) return value.map((item) => redactPluginConfig(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .map(([childKey, childValue]) => [childKey, redactPluginConfig(childValue, childKey)]));
}

function freezeList(items) {
  return Object.freeze((Array.isArray(items) ? items : []).slice());
}

const MESSAGING_TOOLS = new Set(['send_message', 'send_sticker', 'send_face', 'send_poke']);
const MEMORY_TOOLS = new Set([
  'memory_append',
  'memory_query',
  'person_memory_lookup',
  'memory_remove'
]);
const RUNTIME_CONTROL_TOOLS = new Set(['schedule_wake', 'finish', 'stay_silent']);

function snapshotPluginContextMetadata(pluginContext) {
  if (!pluginContext || typeof pluginContext !== 'object') return Object.freeze({});
  const blocks = (Array.isArray(pluginContext.blocks) ? pluginContext.blocks : [])
    .map((block) => Object.freeze({
      id: String(block?.id || ''),
      revision: block?.revision ?? null
    }));
  const diagnostics = (Array.isArray(pluginContext.diagnostics) ? pluginContext.diagnostics : [])
    .map((item) => Object.freeze({
      providerId: String(item?.providerId || ''),
      elapsedMs: Number(item?.elapsedMs) || 0,
      candidateCount: Number(item?.candidateCount) || 0,
      selectedCount: Number(item?.selectedCount) || 0
    }));
  return Object.freeze({
    blocks: Object.freeze(blocks),
    diagnostics: Object.freeze(diagnostics),
    degraded: pluginContext.degraded === true
  });
}

function genericToolCallbackContext(hostCtx = {}) {
  const session = hostCtx?.session && typeof hostCtx.session === 'object' ? hostCtx.session : {};
  return {
    chatKey: String(hostCtx?.chatKey || ''),
    accountId: String(hostCtx?.accountId ?? hostCtx?.selfId ?? ''),
    kind: String(hostCtx?.kind || ''),
    chatId: String(hostCtx?.chatId || ''),
    selfId: String(hostCtx?.selfId || ''),
    selfNickname: String(hostCtx?.selfNickname || ''),
    botName: String(hostCtx?.botName || ''),
    behaviorProfile: String(hostCtx?.behaviorProfile || ''),
    signal: hostCtx?.signal || null,
    sessionId: String(session.id || ''),
    runId: String(session.leaseId || session.id || ''),
    config: snapshotPluginConfig(hostCtx?.runSnapshot?.config),
    pluginContext: snapshotPluginContextMetadata(hostCtx?.pluginContext)
  };
}

function currentSessionId(hostCtx) {
  return String(hostCtx?.session?.id || '');
}

function currentRunId(hostCtx) {
  return String(hostCtx?.session?.leaseId || hostCtx?.session?.id || '');
}

function boundSendOptions(hostCtx, options = {}) {
  return {
    ...(options && typeof options === 'object' ? options : {}),
    runId: currentRunId(hostCtx),
    signal: hostCtx?.signal || null
  };
}

function senderFacade(hostCtx) {
  const sender = hostCtx?.sender;
  const chatKey = String(hostCtx?.chatKey || '');
  return Object.freeze({
    sendTextBatch(_chatKey, messages, options) {
      if (typeof sender?.sendTextBatch !== 'function') throw new TypeError('sender.sendTextBatch unavailable');
      return sender.sendTextBatch(chatKey, messages, boundSendOptions(hostCtx, options));
    },
    sendSticker(_chatKey, sticker, options) {
      if (typeof sender?.sendSticker !== 'function') throw new TypeError('sender.sendSticker unavailable');
      return sender.sendSticker(chatKey, sticker, boundSendOptions(hostCtx, options));
    },
    sendFace(_chatKey, face, options) {
      if (typeof sender?.sendFace !== 'function') throw new TypeError('sender.sendFace unavailable');
      return sender.sendFace(chatKey, face, boundSendOptions(hostCtx, options));
    },
    poke(_chatKey, targetUserId, options) {
      if (typeof sender?.poke !== 'function') throw new TypeError('sender.poke unavailable');
      return sender.poke(chatKey, targetUserId, boundSendOptions(hostCtx, options));
    }
  });
}

function stickerFacade(hostCtx) {
  const stickers = hostCtx?.stickers;
  return Object.freeze({
    findForSend(id) {
      if (typeof stickers?.findForSend !== 'function') return null;
      return stickers.findForSend(id);
    },
    list(query, limit) {
      if (typeof stickers?.list !== 'function') return { stickers: [] };
      return stickers.list(query, limit);
    },
    markUsed(id, note) {
      if (typeof stickers?.markUsed !== 'function') return null;
      return stickers.markUsed(id, note);
    }
  });
}

function participantStoreFacade(hostCtx) {
  const store = hostCtx?.store;
  const chatKey = String(hostCtx?.chatKey || '');
  return Object.freeze({
    activeMembers(_chatKey, limit) {
      return typeof store?.activeMembers === 'function'
        ? store.activeMembers(chatKey, limit)
        : [];
    },
    hasParticipant(_chatKey, userId) {
      if (typeof store?.hasParticipant === 'function') return store.hasParticipant(chatKey, userId);
      return (store?.activeMembers?.(chatKey, 1000) || [])
        .some((member) => String(member.userId) === String(userId));
    },
    findByMid(_chatKey, mid) {
      return typeof store?.findByMid === 'function' ? store.findByMid(chatKey, mid) : null;
    }
  });
}

function messagingSessionFacade(hostCtx) {
  const session = hostCtx?.session && typeof hostCtx.session === 'object' ? hostCtx.session : {};
  return Object.freeze({
    id: String(session.id || ''),
    leaseId: String(session.leaseId || session.id || ''),
    triggerText: String(session.triggerText || ''),
    sent: Object.freeze({
      push(...items) {
        if (Array.isArray(session.sent)) return session.sent.push(...items);
        return 0;
      }
    })
  });
}

function runtimeSessionFacade(hostCtx) {
  const session = hostCtx?.session && typeof hostCtx.session === 'object' ? hostCtx.session : {};
  const facade = {
    id: String(session.id || ''),
    leaseId: String(session.leaseId || session.id || '')
  };
  for (const key of ['finishReason', 'handoffDraft', 'threadDisposition', 'pendingTerminationRequest']) {
    Object.defineProperty(facade, key, {
      enumerable: true,
      get: () => session[key],
      set: (value) => { session[key] = value; }
    });
  }
  return Object.freeze(facade);
}

function memoryFacade(hostCtx) {
  const memory = hostCtx?.memory;
  const chatKey = String(hostCtx?.chatKey || '');
  return Object.freeze({
    append(_chatKey, category, content, extra) {
      return typeof memory?.append === 'function'
        ? memory.append(chatKey, category, content, extra)
        : null;
    },
    query(_chatKey, category) {
      if (typeof memory?.query !== 'function') return { memberImpression: [] };
      return category === undefined ? memory.query(chatKey) : memory.query(chatKey, category);
    },
    remove(_chatKey, category, options) {
      return typeof memory?.remove === 'function'
        ? memory.remove(chatKey, category, options)
        : false;
    }
  });
}

function identityFacade(hostCtx) {
  const identityPilot = hostCtx?.identityPilot;
  const chatKey = String(hostCtx?.chatKey || '');
  return Object.freeze({
    get active() {
      return Boolean(identityPilot?.active);
    },
    lookupPerson(userId, options = {}) {
      return typeof identityPilot?.lookupPerson === 'function'
        ? identityPilot.lookupPerson(userId, {
            ...(options && typeof options === 'object' ? options : {}),
            chatKey,
            signal: hostCtx?.signal || null
          })
        : null;
    }
  });
}

function safeEmit(hostCtx, allowedTypes) {
  return (type, payload) => {
    if (!allowedTypes.has(type)) {
      throw new Error(`工具上下文不允许发送事件 ${String(type)}`);
    }
    if (typeof hostCtx?.emit !== 'function') return undefined;
    const sessionId = currentSessionId(hostCtx);
    if (type === 'session-update') {
      return hostCtx.emit(type, {
        sessionId,
        chatKey: String(hostCtx?.chatKey || '')
      });
    }
    return hostCtx.emit(type, payload);
  };
}

export function createMessagingToolContext(hostCtx = {}) {
  return Object.freeze({
    ...genericToolCallbackContext(hostCtx),
    sender: senderFacade(hostCtx),
    stickers: stickerFacade(hostCtx),
    store: participantStoreFacade(hostCtx),
    session: messagingSessionFacade(hostCtx),
    emit: safeEmit(hostCtx, new Set(['session-update']))
  });
}

export function createMemoryToolsContext(hostCtx = {}) {
  return Object.freeze({
    ...genericToolCallbackContext(hostCtx),
    store: participantStoreFacade(hostCtx),
    memory: memoryFacade(hostCtx),
    identityPilot: identityFacade(hostCtx)
  });
}

export function createRuntimeControlContext(hostCtx = {}) {
  return Object.freeze({
    ...genericToolCallbackContext(hostCtx),
    ...(typeof hostCtx?.scheduleWake === 'function'
      ? { scheduleWake: (delayMs, note) => hostCtx.scheduleWake(delayMs, note) }
      : {}),
    session: runtimeSessionFacade(hostCtx),
    emit: safeEmit(hostCtx, new Set(['session-update']))
  });
}

export function createToolCallbackContext(tool, hostCtx = {}) {
  const ownerPluginId = String(tool?.ownerPluginId || '');
  if (ownerPluginId === 'legacy-tools') return hostCtx;
  const toolName = String(tool?.name || '');
  if (ownerPluginId === 'messaging' && MESSAGING_TOOLS.has(toolName)) {
    return createMessagingToolContext(hostCtx);
  }
  if (ownerPluginId === 'memory-tools' && MEMORY_TOOLS.has(toolName)) {
    return createMemoryToolsContext(hostCtx);
  }
  if (ownerPluginId === 'runtime-control' && RUNTIME_CONTROL_TOOLS.has(toolName)) {
    return createRuntimeControlContext(hostCtx);
  }
  return Object.freeze(genericToolCallbackContext(hostCtx));
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
