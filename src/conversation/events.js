export function buildSocialCompletionEvent({
  session,
  triggerEntries = [],
  state,
  scope,
  selfId = '',
  deliveryState = 'not_attempted'
} = {}) {
  const audit = session?.socialAudit || {};
  const roots = new Set();
  const evidence = (Array.isArray(triggerEntries) ? triggerEntries : []).slice(-20).map((entry) => {
    const interaction = !entry?.self
      ? state?.interactionForMessage?.({ ...scope, messageId: entry.id })
      : null;
    const originalSourceId = String(interaction?.causalRootId || entry.id || '');
    if (originalSourceId) roots.add(originalSourceId);
    return {
      evidenceId: `message:${entry.id}`,
      sourceRecordType: 'message',
      sourceRecordId: String(entry.id || ''),
      messageId: String(entry.id || ''),
      platformMessageId: entry.mid == null ? '' : String(entry.mid),
      originalSourceId,
      interactionId: String(interaction?.id || ''),
      topicId: String(interaction?.topicId || audit.topicId || ''),
      senderId: String(entry.senderId || ''),
      role: entry.self ? 'assistant' : 'user',
      at: Number(entry.ts) || 0,
      text: String(entry.text || ''),
      confirmed: true,
      delivered: false,
      userConfirmed: false
    };
  });
  const identityMessageId = (audit.sourceMessageIds || [])[0];
  const sourceInteraction = identityMessageId
    ? state?.interactionForMessage?.({ ...scope, messageId: identityMessageId })
    : null;
  if (sourceInteraction?.causalRootId) roots.add(String(sourceInteraction.causalRootId));
  for (const [index, entry] of (session?.socialDelivered || []).slice(-8).entries()) {
    evidence.push({
      evidenceId: `outbound:${session.id}:${index}`,
      sourceRecordType: 'outbound',
      sourceRecordId: String(entry.messageId || `${session.id}:${index}`),
      messageId: String(entry.messageId || ''),
      platformMessageId: String(entry.platformMessageId || ''),
      senderId: String(selfId || ''),
      role: 'assistant',
      originalSourceId: String(sourceInteraction?.causalRootId || ''),
      interactionId: String(audit.interactionId || ''),
      topicId: String(audit.topicId || ''),
      at: Number(entry.at) || 0,
      text: String(entry.text || ''),
      confirmed: true,
      delivered: true
    });
  }
  const originalSourceIds = [...roots].slice(0, 16);
  return {
    schemaVersion: 3,
    evidenceVersion: 3,
    triggerKind: String(audit.triggerKind || ''),
    proactive: audit.proactive === true,
    interactionId: String(audit.interactionId || ''),
    topicId: String(audit.topicId || ''),
    originalSourceIds,
    deliveryState: String(deliveryState || 'not_attempted'),
    delivered: (session?.socialDelivered || []).length > 0,
    sourceMessageIds: [...new Set((audit.sourceMessageIds || []).map(String))].slice(0, 32),
    conversationEvidence: evidence
  };
}
