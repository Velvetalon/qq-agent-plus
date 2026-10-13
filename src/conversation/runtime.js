const SOCIAL_ACTIONS = new Set(['reply', 'share', 'react', 'listen', 'wait', 'close']);
const SOCIAL_CONTROL_TOOLS = new Set(['finish', 'stay_silent', 'schedule_wake']);
const GUARDED_VISIBLE_TOOLS = new Set(['send_message', 'send_sticker', 'send_face', 'send_poke']);
const MAX_TARGETS = 8;
const canonical = (value) => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const stableJson = (value) => JSON.stringify(canonical(value));

function cleanText(value, limit) {
  const text = [...String(value ?? '')].map((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : character;
  }).join('').replace(/\s+/g, ' ').trim();
  return text.slice(0, limit);
}

export function parseSocialJson(content) {
  let text = String(content ?? '').trim();
  const fence = String.fromCharCode(96).repeat(3);
  if (text.startsWith(fence) && text.endsWith(fence)) {
    text = text.slice(fence.length, -fence.length).trim();
    if (/^json(?:\s|$)/i.test(text)) text = text.slice(4).trim();
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function validateSocialDecision(content, {
  snapshot,
  knownMessages = [],
  knownSourceRefs = []
} = {}) {
  const parsed = parseSocialJson(content);
  if (!parsed) return { ok: false, reason: 'invalid_json' };
  const action = String(parsed.action || '').trim().toLowerCase();
  if (!SOCIAL_ACTIONS.has(action)) return { ok: false, reason: 'invalid_action' };

  const messagesById = new Map((Array.isArray(knownMessages) ? knownMessages : [])
    .filter((item) => item?.id !== undefined && item?.id !== null)
    .map((item) => [String(item.id), item]));
  const topicIds = new Set((snapshot?.topics || []).map((item) => String(item.id)));
  const topicId = parsed.topicId == null || parsed.topicId === '' ? null : String(parsed.topicId);
  if (topicId && !topicIds.has(topicId)) return { ok: false, reason: 'unknown_topic' };

  const rawSourceIds = Array.isArray(parsed.sourceMessageIds) ? parsed.sourceMessageIds : [];
  if (rawSourceIds.length > 8) return { ok: false, reason: 'too_many_sources' };
  const sourceMessageIds = [...new Set(rawSourceIds.map(String))];
  if (sourceMessageIds.some((id) => !messagesById.has(id) || messagesById.get(id)?.self)) {
    return { ok: false, reason: 'unknown_source' };
  }
  const rawTargets = Array.isArray(parsed.targetMessageIds)
    ? parsed.targetMessageIds
    : parsed.targetMessageId == null || parsed.targetMessageId === '' ? [] : [parsed.targetMessageId];
  if (rawTargets.length > MAX_TARGETS) return { ok: false, reason: 'too_many_targets' };
  const targetMessageIds = [...new Set(rawTargets.map(String))];
  for (const targetMessageId of targetMessageIds) {
    const target = messagesById.get(targetMessageId);
    if (!target || target.self) return { ok: false, reason: 'unknown_target' };
    if (!sourceMessageIds.includes(targetMessageId)) sourceMessageIds.push(targetMessageId);
  }
  if (['reply', 'react'].includes(action) && (!targetMessageIds.length || !sourceMessageIds.length)) {
    return { ok: false, reason: 'missing_reply_target' };
  }

  const goal = cleanText(parsed.goal, 200);
  const novelty = cleanText(parsed.novelty, 120);
  const topic = cleanText(parsed.topic, 100);
  const knownRefs = new Set((Array.isArray(knownSourceRefs) ? knownSourceRefs : []).map(stableJson));
  const requestedRefs = (Array.isArray(parsed.sourceRefs) ? parsed.sourceRefs : [])
    .filter((ref) => ref && typeof ref === 'object' && !Array.isArray(ref))
    .slice(0, 8);
  if (parsed.sourceRefs != null && !Array.isArray(parsed.sourceRefs)) {
    return { ok: false, reason: 'invalid_source_refs' };
  }
  if (Array.isArray(parsed.sourceRefs) && parsed.sourceRefs.length > 8) {
    return { ok: false, reason: 'too_many_source_refs' };
  }
  if (Array.isArray(parsed.sourceRefs) && parsed.sourceRefs.length !== requestedRefs.length) {
    return { ok: false, reason: 'invalid_source_ref_shape' };
  }
  if (requestedRefs.some((ref) => !knownRefs.has(stableJson(ref)))) {
    return { ok: false, reason: 'unknown_source_ref' };
  }
  const sourceRefs = [...new Map(requestedRefs.map((ref) => [stableJson(ref), structuredClone(ref)])).values()];
  if (['reply', 'share', 'react'].includes(action) && (!goal || !novelty)) {
    return { ok: false, reason: 'missing_reply_metadata' };
  }
  if (action === 'share' && !sourceMessageIds.length && !sourceRefs.length) {
    return { ok: false, reason: 'missing_share_source' };
  }
  return {
    ok: true,
    value: {
      action,
      topicId,
      topic,
      targetMessageIds,
      targetMessageId: targetMessageIds[0] || null,
      sourceMessageIds: sourceMessageIds.slice(0, 8),
      sourceRefs,
      goal,
      novelty,
      initiative: parsed.initiative && typeof parsed.initiative === 'object'
        && !Array.isArray(parsed.initiative)
        ? parsed.initiative
        : null
    }
  };
}

export function validateSocialInitiative(raw, {
  humanMessageIds = [],
  knownSourceRefs = [],
  now = Date.now(),
  minDueAt = now,
  maxExpiresAt = now + 24 * 60 * 60 * 1000,
  maxSourceMessageIds = 4
} = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const allowedSources = new Set((humanMessageIds || []).map(String));
  const sourceMessageIds = [...new Set((Array.isArray(raw.sourceMessageIds)
    ? raw.sourceMessageIds
    : []).map(String))].slice(0, maxSourceMessageIds);
  const goal = cleanText(raw.goal, 180);
  const knownRefs = new Set((Array.isArray(knownSourceRefs) ? knownSourceRefs : []).map(stableJson));
  const sourceRefs = [...new Map((Array.isArray(raw.sourceRefs) ? raw.sourceRefs : [])
    .filter((ref) => ref && typeof ref === 'object' && !Array.isArray(ref))
    .filter((ref) => knownRefs.has(stableJson(ref)))
    .map((ref) => [stableJson(ref), structuredClone(ref)])).values()].slice(0, 8);
  if ((Array.isArray(raw.sourceRefs) ? raw.sourceRefs : []).length !== sourceRefs.length) return null;
  const dueAt = Number(raw.dueAt);
  const expiresAt = Number(raw.expiresAt);
  if (!goal || /^(?:check.?in|say something|remind me|cooldown|idle)$/i.test(goal)) return null;
  if ((sourceMessageIds.length && sourceMessageIds.some((id) => !allowedSources.has(id)))
    || (!sourceMessageIds.length && !sourceRefs.length)) return null;
  if (!Number.isSafeInteger(dueAt) || dueAt < minDueAt || dueAt > maxExpiresAt) return null;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= dueAt || expiresAt > maxExpiresAt) return null;
  return { goal, sourceMessageIds, sourceRefs, dueAt, expiresAt };
}

export function socialPlannerTools(toolDefs = []) {
  return toolDefs
    .filter((tool) => tool?.effect === 'read' && !SOCIAL_CONTROL_TOOLS.has(String(tool.name || '')))
    .map((tool) => ({ ...tool }));
}

export function socialReplyerTools(toolDefs = []) {
  return toolDefs
    .filter((tool) => {
      const name = String(tool?.name || '');
      if (SOCIAL_CONTROL_TOOLS.has(name)) return false;
      if (tool?.effect === 'read') return true;
      if (GUARDED_VISIBLE_TOOLS.has(name)) return tool?.ownerPluginId === 'messaging';
      return name === 'longtime' && tool?.ownerPluginId === 'longtime';
    })
    .map((tool) => {
      if (tool.name === 'send_message') {
        return {
          ...tool,
          description: 'Send one natural message or a short list only when distinct thoughts genuinely belong in separate messages. A single message is normal; do not split or pad for appearance.'
        };
      }
      if (tool.name === 'send_sticker') {
        return { ...tool, description: 'Optionally send one relevant sticker when it adds something; text is often enough. Never send a sticker just to fill the turn.' };
      }
      return { ...tool };
    });
}
