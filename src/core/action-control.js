// Host-owned terminal action validation and participation accounting.
//
// Tool callbacks may only record a pending request. The orchestrator owns
// batch preflight, terminal commit, and the final result class.

export const TERMINAL_TOOL_NAMES = Object.freeze(new Set(['finish', 'stay_silent']));
export const STAY_SILENT_REASON_CODES = Object.freeze(new Set([
  'not_relevant',
  'no_new_value',
  'waiting_for_context',
  'already_answered',
  'topic_moved'
]));
export const THREAD_DISPOSITIONS = Object.freeze(new Set(['active', 'listening', 'close']));
export const VISIBLE_EXTERNAL_TOOL_NAMES = Object.freeze(new Set([
  'send_message',
  'send_sticker',
  'send_face',
  'send_poke'
]));

// P4 may register this tool later. Keep its same-round contract explicit now.
const FUTURE_LOCAL_WRITE_TOOL_NAMES = new Set(['notebook_append']);

export function isTerminalTool(name) {
  return TERMINAL_TOOL_NAMES.has(String(name || ''));
}

export function validateStaySilentArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, errorCode: 'INVALID_STAY_SILENT_ARGUMENTS', message: '参数必须是对象' };
  }
  const allowed = new Set(['reasonCode', 'reason', 'threadDisposition']);
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) {
      return {
        ok: false,
        errorCode: 'INVALID_STAY_SILENT_ARGUMENTS',
        message: `不支持参数 ${key}`
      };
    }
  }
  if (typeof args.reasonCode !== 'string' || !STAY_SILENT_REASON_CODES.has(args.reasonCode)) {
    return {
      ok: false,
      errorCode: 'INVALID_STAY_SILENT_ARGUMENTS',
      message: 'reasonCode 必须是 not_relevant、no_new_value、waiting_for_context、already_answered 或 topic_moved'
    };
  }
  if (args.reason !== undefined
    && (typeof args.reason !== 'string' || args.reason.length > 240)) {
    return {
      ok: false,
      errorCode: 'INVALID_STAY_SILENT_ARGUMENTS',
      message: 'reason 必须是最多 240 字符的字符串'
    };
  }
  if (typeof args.threadDisposition !== 'string'
    || !THREAD_DISPOSITIONS.has(args.threadDisposition)) {
    return {
      ok: false,
      errorCode: 'INVALID_STAY_SILENT_ARGUMENTS',
      message: 'threadDisposition 必须是 active、listening 或 close'
    };
  }
  return {
    ok: true,
    value: {
      reasonCode: args.reasonCode,
      reason: args.reason === undefined ? '' : args.reason,
      threadDisposition: args.threadDisposition
    }
  };
}

export function terminalRequestResult(request) {
  return {
    content: JSON.stringify({
      requested: true,
      reasonCode: request.reasonCode,
      reason: request.reason || '',
      threadDisposition: request.threadDisposition
    }),
    pendingTermination: true
  };
}

export function skippedToolResult(message, errorCode = 'SKIPPED_AFTER_TERMINAL') {
  return {
    content: `错误：${message}`,
    isError: true,
    errorCode,
    reportIncident: false,
    skipped: true
  };
}

export function blockedTerminalResult(message, errorCode = 'TERMINAL_BATCH_BLOCKED') {
  return {
    content: `错误：${message}`,
    isError: true,
    errorCode,
    reportIncident: false,
    terminalBlocked: true
  };
}

function effectOfCall(call, defsByName) {
  const name = String(call?.function?.name || '');
  const def = defsByName.get(name);
  if (def?.terminal === true || isTerminalTool(name)) {
    return { name, terminal: true, effect: 'terminal', known: true };
  }
  if (VISIBLE_EXTERNAL_TOOL_NAMES.has(name)) {
    return { name, terminal: false, effect: 'external-visible', known: true };
  }
  if (FUTURE_LOCAL_WRITE_TOOL_NAMES.has(name)) {
    return { name, terminal: false, effect: 'local-write', known: true };
  }
  if (def?.effect) {
    return { name, terminal: false, effect: String(def.effect), known: true };
  }
  return { name, terminal: false, effect: 'unknown', known: false };
}

/**
 * Preflight a complete assistant tool_calls batch before any callback runs.
 * Non-terminal actions before a valid terminal retain their ordered execution.
 * Calls after the first terminal are always represented by structured skips.
 */
export function preflightToolCalls(calls, defs = []) {
  const list = Array.isArray(calls) ? calls : [];
  const defsByName = new Map((Array.isArray(defs) ? defs : []).map((def) => [def.name, def]));
  const effects = list.map((call) => effectOfCall(call, defsByName));
  const terminalIndexes = effects
    .map((effect, index) => effect.terminal ? index : -1)
    .filter((index) => index >= 0);
  const firstTerminalIndex = terminalIndexes.length ? terminalIndexes[0] : -1;
  const duplicateTerminal = terminalIndexes.length > 1;
  const terminalNotLast = firstTerminalIndex >= 0 && firstTerminalIndex !== list.length - 1;
  const firstTerminal = firstTerminalIndex >= 0 ? effects[firstTerminalIndex].name : '';
  const hasVisibleExternal = effects.some((effect, index) =>
    index !== firstTerminalIndex && effect.effect === 'external-visible');
  const hasUnknown = effects.some((effect, index) =>
    index !== firstTerminalIndex && effect.effect === 'unknown');
  const silentExternalConflict = firstTerminal === 'stay_silent'
    && (hasVisibleExternal || hasUnknown);
  const terminalBlocked = duplicateTerminal || terminalNotLast || silentExternalConflict;
  const terminalBlockReason = duplicateTerminal
    ? '本批次最多只能有一个终止工具'
    : terminalNotLast
      ? '终止工具必须是本批次最后一个调用'
      : silentExternalConflict
        ? 'stay_silent 不能与同批外部可见或未知副作用同时提交'
        : '';

  return {
    calls: list.map((call, index) => {
      const effect = effects[index];
      if (firstTerminalIndex >= 0 && index > firstTerminalIndex) {
        return {
          index,
          call,
          effect,
          execute: false,
          result: skippedToolResult(
            `未执行：${firstTerminal} 已形成终止边界，之后的工具不能再产生副作用。`
          )
        };
      }
      if (effect.terminal && terminalBlocked) {
        return {
          index,
          call,
          effect,
          execute: false,
          result: blockedTerminalResult(terminalBlockReason)
        };
      }
      return { index, call, effect, execute: true, result: null };
    }),
    terminalIndexes,
    firstTerminalIndex,
    terminalBlocked,
    terminalBlockReason,
    validTerminal: firstTerminalIndex >= 0 && !terminalBlocked
  };
}

function emptyOutbound() {
  return {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    unknown: 0,
    held: 0,
    effects: []
  };
}

function normalizeEffect(row) {
  const state = String(row?.state || '');
  return {
    id: String(row?.id || ''),
    type: String(row?.type || row?.payload?.type || 'unknown'),
    state,
    messageId: row?.messageId == null ? null : String(row.messageId)
  };
}

export function summarizeOutbound(session, store = null) {
  const runId = String(session?.leaseId || session?.id || '');
  let effects = [];
  if (runId && typeof store?.listRunEffects === 'function') {
    effects = store.listRunEffects(runId).map(normalizeEffect);
    if (typeof store.listHeldEffects === 'function') {
      effects.push(...store.listHeldEffects(runId).map(normalizeEffect));
    }
  }
  const observed = Array.isArray(session?.outbound?.effects)
    ? session.outbound.effects.map(normalizeEffect)
    : [];
  if (!effects.length) effects = observed;
  const summary = emptyOutbound();
  for (const effect of effects) {
    summary.effects.push(effect);
    summary.attempted += 1;
    if (effect.state === 'sent' || effect.state === 'succeeded') summary.succeeded += 1;
    else if (effect.state === 'failed') summary.failed += 1;
    else if (effect.state === 'held') summary.held += 1;
    else if (effect.state === 'sending' || effect.state === 'unknown' || effect.state === 'uncertain') summary.unknown += 1;
  }
  if (!effects.length && Array.isArray(session?.sent) && session.sent.length) {
    summary.attempted = session.sent.length;
    summary.succeeded = session.sent.length;
    summary.effects = session.sent.map((item, index) => ({
      id: `session:${index}`,
      type: String(item?.type || 'message'),
      state: 'sent',
      messageId: item?.messageId == null ? null : String(item.messageId)
    }));
  }
  if (!effects.length && session?.outbound) {
    summary.attempted = Number(session.outbound.attempted) || 0;
    summary.succeeded = Number(session.outbound.succeeded) || 0;
    summary.failed = Number(session.outbound.failed) || 0;
    summary.unknown = Number(session.outbound.unknown) || 0;
    summary.held = Number(session.outbound.held) || 0;
  }
  return summary;
}

export function recordOutboundObservation(session, name, result, callId = '') {
  if (!VISIBLE_EXTERNAL_TOOL_NAMES.has(String(name || ''))) return;
  session.outbound ||= emptyOutbound();
  session.outbound.effects ||= [];
  const state = result?.isError ? 'failed' : 'sent';
  session.outbound.effects.push({
    id: String(callId || `tool:${session.outbound.effects.length}`),
    type: String(name),
    state,
    messageId: null
  });
}

export function commitStaySilent(session, request, {
  terminalToolCallId = '',
  outbound = summarizeOutbound(session)
} = {}) {
  const valid = validateStaySilentArgs(request);
  if (!valid.ok) return { committed: false, blocked: true, error: valid };
  const value = valid.value;
  const hasOutbound = Number(outbound?.attempted) > 0
    || Number(outbound?.succeeded) > 0
    || Number(outbound?.failed) > 0
    || Number(outbound?.unknown) > 0
    || Number(outbound?.held) > 0
    || (Array.isArray(outbound?.effects) && outbound.effects.length > 0);
  session.outbound = outbound;
  session.participation = {
    mode: 'silent',
    decision: hasOutbound ? 'blocked' : 'stay_silent',
    reasonCode: value.reasonCode,
    reason: value.reason
  };
  session.threadDisposition = value.threadDisposition;
  session.termination = {
    kind: hasOutbound ? 'blocked' : 'explicit_silence',
    reasonCode: value.reasonCode,
    reason: value.reason,
    threadDisposition: value.threadDisposition,
    terminalToolCallId: String(terminalToolCallId || ''),
    blocked: hasOutbound
  };
  return {
    committed: !hasOutbound,
    blocked: hasOutbound,
    value,
    outbound
  };
}
