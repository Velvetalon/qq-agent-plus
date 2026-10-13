const SOCIAL_ACTIONS = new Set(['reply', 'listen', 'wait', 'close']);
const SOCIAL_CONTROL_TOOLS = new Set(['finish', 'stay_silent', 'schedule_wake']);

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

export function validateSocialDecision(content, { snapshot, knownMessages = [] } = {}) {
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

  const sourceMessageIds = [...new Set((Array.isArray(parsed.sourceMessageIds)
    ? parsed.sourceMessageIds
    : []).map(String))].slice(0, 8);
  if (sourceMessageIds.some((id) => !messagesById.has(id) || messagesById.get(id)?.self)) {
    return { ok: false, reason: 'unknown_source' };
  }
  const targetMessageId = parsed.targetMessageId == null || parsed.targetMessageId === ''
    ? null
    : String(parsed.targetMessageId);
  if (targetMessageId) {
    const target = messagesById.get(targetMessageId);
    if (!target || target.self) return { ok: false, reason: 'unknown_target' };
    if (!sourceMessageIds.includes(targetMessageId)) sourceMessageIds.push(targetMessageId);
  }
  if (action === 'reply' && (!targetMessageId || !sourceMessageIds.length)) {
    return { ok: false, reason: 'missing_reply_target' };
  }

  const goal = cleanText(parsed.goal, 200);
  const novelty = cleanText(parsed.novelty, 120);
  const topic = cleanText(parsed.topic, 100);
  if (action === 'reply' && (!goal || !novelty)) {
    return { ok: false, reason: 'missing_reply_metadata' };
  }
  return {
    ok: true,
    value: {
      action,
      topicId,
      topic,
      targetMessageId,
      sourceMessageIds: sourceMessageIds.slice(0, 8),
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
  const dueAt = Number(raw.dueAt);
  const expiresAt = Number(raw.expiresAt);
  if (!goal || /^(?:check.?in|say something|remind me|cooldown|idle)$/i.test(goal)) return null;
  if (!sourceMessageIds.length || sourceMessageIds.some((id) => !allowedSources.has(id))) return null;
  if (!Number.isSafeInteger(dueAt) || dueAt < minDueAt || dueAt > maxExpiresAt) return null;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= dueAt || expiresAt > maxExpiresAt) return null;
  return { goal, sourceMessageIds, dueAt, expiresAt };
}

export function socialPlannerTools(toolDefs = []) {
  return toolDefs
    .filter((tool) => tool?.effect === 'read' && !SOCIAL_CONTROL_TOOLS.has(String(tool.name || '')))
    .map((tool) => ({ ...tool }));
}

export function socialReplyerTools(toolDefs = []) {
  return toolDefs
    .filter((tool) => !SOCIAL_CONTROL_TOOLS.has(String(tool.name || '')))
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
