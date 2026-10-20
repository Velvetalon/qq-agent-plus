import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from '../../core/config.js';
import { SELF_EVOLUTION_PLUGIN_ID } from './notebook-store.js';
import { classifyNotebookMemory, reflectionRoleNoteText } from './notebook-policy.js';
import { LEARNED_SELF_POLICY_VERSION } from './learned-self-provider.js';

export const REFLECTION_DATABASE_NAME = 'reflection.sqlite';
export const REFLECTION_OBSERVER_ID = 'self-evolution.reflection';
export const REFLECTION_MODES = Object.freeze(['review', 'bounded_auto']);
export const REFLECTION_CANDIDATE_POLICY_VERSION = 'reflection-candidate-v1';
export const CAPABILITY_GAP_CATEGORIES = Object.freeze([
  'missing',
  'disabled',
  'permission',
  'config',
  'temporary_failure'
]);
export const REFLECTION_JOB_STATUSES = Object.freeze([
  'pending',
  'leased',
  'noop',
  'ready',
  'applied',
  'rejected',
  'stale',
  'invalid',
  'failed'
]);
export const REFLECTION_PROPOSAL_STATUSES = Object.freeze([
  'pending',
  'applied',
  'rejected',
  'stale',
  'invalid'
]);
export const REFLECTION_INVALID_EVIDENCE_KINDS = Object.freeze([
  'timeout',
  'api',
  'api_failure',
  'tool',
  'tool_failure',
  'no_reply',
  'noreply',
  'not_called',
  'unknown_external_write',
  'held_external_write',
  'never_woken',
  'failure',
  'aborted'
]);

export const DEFAULT_REFLECTION_LIMITS = Object.freeze({
  maxNoteOperations: 8,
  maxTraitProposals: 12,
  maxCapabilityGapProposals: 20,
  maxEvidenceRefsPerItem: 8,
  maxContentChars: 2000,
  maxTraitValueChars: 160,
  maxTraitKeyChars: 64,
  maxCapabilityChars: 120,
  maxRequestKeyChars: 160,
  maxDetailChars: 300,
  maxSummaryChars: 2000,
  maxOutputChars: 20000,
  maxEvidenceChars: 12000,
  maxModelInputChars: 12000,
  maxAttempts: 3,
  maxCallsPerDay: 100,
  minValidSessions: 1,
  minTraitValidSessions: 3,
  minTraitUserEvidence: 3,
  minTraitGlobalChats: 2,
  maxTraitEvidenceInteractions: 24,
  traitEvidenceWindowMs: 90 * 24 * 60 * 60 * 1000,
  traitTtlMs: 30 * 24 * 60 * 60 * 1000,
  observationWindowMs: 0,
  leaseMs: 60000,
  workerLeaseMs: 90000,
  inputPreparationTimeoutMs: 5000,
  retrievalTimeoutMs: 5000,
  reflectionTimeoutMs: 30000,
  taskTimeoutMs: 50000,
  submissionGraceMs: 10000,
  workerGraceMs: 10000,
  backoffMs: 1000
});

const LOW_RISK_TRAIT_KEYS = new Set([
  'communication_style',
  'language_preference',
  'topic_interests',
  'interaction_preferences',
  'expression_preferences'
]);
const RESERVED_TRAIT_KEYS = new Set([
  'roletext',
  'role_text',
  'tools',
  'tool_policy',
  'permissions',
  'auth',
  'security',
  'capability',
  'capabilities',
  'disinterest'
]);
const DISINTEREST_PATTERNS = Object.freeze([
  /不\s*感兴趣/u,
  /没\s*兴趣/u,
  /不\s*想\s*聊/u,
  /不再\s*关注/u,
  /缺少兴趣/u,
  /disinterest(?:ed)?/i,
  /not\s+interested/i,
  /lost\s+interest/i,
  /no\s+longer\s+interested/i
]);
const USER_ROLES = new Set(['user', 'human', 'member', 'sender']);
const ASSISTANT_ROLES = new Set(['assistant', 'bot', 'system', 'tool', 'model']);
const PROCEDURAL_TRAIT_PATTERNS = Object.freeze([
  /result\s*=\s*\d+/iu,
  /\b(?:retry|retries|queue|queued|schedule|scheduled|wake|wakeup|cron|system\s+reminder)\b/iu,
  /(?:重试|队列|排队|定时|调度|唤醒|系统提醒|发送失败|外发失败|消息状态|发送状态)/u,
  /(?:\bmsg(?:id)?\b|\bmessage[_ -]?id\b|\bqq(?:号|id)?\b)\s*[:=#-]?\s*\d+/iu,
  /\b(?:at|on)\s+\d{4}[-/]\d{1,2}[-/]\d{1,2}/iu,
  /(?:固定(?:回复|台词|表情|触发)|每次(?:都)?(?:回复|发送)|看到.+就(?:回复|发送))/u
]);
const PROCEDURAL_KEY_PATTERNS = Object.freeze([
  /(?:working_habit|routine|schedule|retry|queue|wake|send|outbound|delivery|execution|runtime|status)/iu
]);
const SAFE_ID_RE = /^[a-z][a-z0-9._-]{0,127}$/;
const TRAIT_KEY_RE = /^[a-z][a-z0-9._-]{0,63}$/;
const CATEGORY_SET = new Set(CAPABILITY_GAP_CATEGORIES);
const MODE_SET = new Set(REFLECTION_MODES);
const JOB_STATUS_SET = new Set(REFLECTION_JOB_STATUSES);
const PROPOSAL_STATUS_SET = new Set(REFLECTION_PROPOSAL_STATUSES);

function fail(code, message, details = {}) {
  throw new ReflectionError(code, message, details);
}

function text(value, field, max) {
  if (typeof value !== 'string') fail('REFLECTION_INVALID_OUTPUT', `${field} must be a string`);
  const result = value.trim();
  if (!result) fail('REFLECTION_INVALID_OUTPUT', `${field} must not be empty`);
  if (result.length > max) {
    fail('REFLECTION_LIMIT_EXCEEDED', `${field} exceeds ${max} characters`, {
      field,
      limit: max,
      actual: result.length
    });
  }
  return result;
}

function optionalText(value, field, max) {
  if (value === undefined || value === null) return '';
  const result = String(value).trim();
  if (result.length > max) {
    fail('REFLECTION_LIMIT_EXCEEDED', `${field} exceeds ${max} characters`, {
      field,
      limit: max,
      actual: result.length
    });
  }
  return result;
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, allowed, pathName) {
  if (!plainObject(value)) fail('REFLECTION_INVALID_OUTPUT', `${pathName} must be an object`);
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      fail('REFLECTION_INVALID_OUTPUT', `${pathName}.${key} is not allowed`);
    }
  }
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (plainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort()
      .map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function traitCandidateId({
  accountId,
  chatKey,
  scope,
  subject,
  key,
  value,
  cycleInteractionId = ''
}) {
  return `traitcand_${hash(stableJson({
    accountId: String(accountId || ''),
    chatKey: String(chatKey || ''),
    scope: String(scope || ''),
    subject: String(subject || ''),
    key: String(key || ''),
    value: String(value || ''),
    cycleInteractionId: String(cycleInteractionId || '')
  })).slice(0, 32)}`;
}

function safeJson(value, fallback = {}) {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
  }
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(String(value ?? ''));
  } catch {
    return fallback;
  }
}

function nowValue(now) {
  return Math.max(0, Math.round(Number(typeof now === 'function' ? now() : now) || Date.now()));
}

function normalizeLimits(limits = {}) {
  const result = { ...DEFAULT_REFLECTION_LIMITS };
  for (const [key, fallback] of Object.entries(DEFAULT_REFLECTION_LIMITS)) {
    const value = Number(limits[key]);
    if (Number.isFinite(value) && value >= 0) result[key] = Math.round(value);
    else result[key] = fallback;
  }
  result.maxAttempts = Math.max(1, result.maxAttempts);
  result.maxCallsPerDay = Math.max(1, result.maxCallsPerDay);
  result.minValidSessions = Math.max(1, result.minValidSessions);
  result.minTraitValidSessions = Math.max(3, result.minTraitValidSessions);
  result.minTraitUserEvidence = Math.max(3, result.minTraitUserEvidence);
  result.minTraitGlobalChats = Math.max(1, result.minTraitGlobalChats);
  result.maxTraitEvidenceInteractions = Math.max(3, Math.min(100, result.maxTraitEvidenceInteractions));
  result.traitEvidenceWindowMs = Math.max(1, result.traitEvidenceWindowMs);
  result.traitTtlMs = Math.max(1, result.traitTtlMs);
  result.observationWindowMs = Math.max(0, result.observationWindowMs);
  result.leaseMs = Math.max(1, result.leaseMs);
  result.workerLeaseMs = Math.max(1, result.workerLeaseMs);
  result.backoffMs = Math.max(0, result.backoffMs);
  return Object.freeze(result);
}

function sourceLineage(event) {
  if (!plainObject(event)) fail('REFLECTION_INVALID_EVENT', 'completion event must be an object');
  const accountId = text(String(event.accountId || ''), 'event.accountId', 100);
  const sessionId = text(String(event.sessionId || ''), 'event.sessionId', 160);
  const observerId = text(String(event.observerId || REFLECTION_OBSERVER_ID), 'event.observerId', 120);
  const observerPluginId = text(
    String(event.observerPluginId || SELF_EVOLUTION_PLUGIN_ID),
    'event.observerPluginId',
    80
  );
  if (!SAFE_ID_RE.test(observerId)) {
    fail('REFLECTION_INVALID_EVENT', 'event.observerId must be a stable identifier');
  }
  if (observerPluginId !== SELF_EVOLUTION_PLUGIN_ID
    && observerPluginId !== 'self-evolution-reflection') {
    fail('REFLECTION_INVALID_EVENT', 'completion event is not owned by self-evolution');
  }
  const originKind = optionalText(event.originKind, 'event.originKind', 40) || 'chat_run';
  if (originKind !== 'chat_run') {
    fail('REFLECTION_SOURCE_LINEAGE',
      'reflection observations require a chat_run completion origin', { originKind });
  }
  const chatKey = optionalText(event.chatKey, 'event.chatKey', 100);
  if (chatKey && !/^(group|private):\d+$/.test(chatKey)) {
    fail('REFLECTION_INVALID_EVENT', 'event.chatKey must be group:<QQ> or private:<QQ>');
  }
  return {
    schemaVersion: Math.max(0, Math.round(Number(event.schemaVersion) || 0)),
    eventId: optionalText(event.eventId, 'event.eventId', 240),
    observerId,
    observerPluginId,
    originKind,
    accountId,
    sessionId,
    runId: optionalText(event.runId, 'event.runId', 160),
    deliveryState: optionalText(event.deliveryState, 'event.deliveryState', 40),
    chatKey,
    pluginGeneration: Math.max(0, Math.round(Number(event.pluginGeneration) || 0)),
    observationWindowId: optionalText(
      event.observationWindowId
        ?? event.observationWindowKey
        ?? event.windowKey
        ?? event.windowId,
      'event.observationWindowId',
      160
    )
  };
}

function boundedParticipation(value) {
  const participation = plainObject(value) ? value : {};
  return {
    mode: optionalText(participation.mode, 'participation.mode', 80),
    decision: optionalText(participation.decision, 'participation.decision', 80),
    reasonCode: optionalText(participation.reasonCode, 'participation.reasonCode', 120),
    reason: optionalText(participation.reason, 'participation.reason', 300)
  };
}

function boundedTermination(value) {
  const termination = plainObject(value) ? value : {};
  return {
    kind: optionalText(termination.kind, 'termination.kind', 80),
    reasonCode: optionalText(termination.reasonCode, 'termination.reasonCode', 120),
    reason: optionalText(termination.reason, 'termination.reason', 300),
    threadDisposition: optionalText(termination.threadDisposition, 'termination.threadDisposition', 80),
    blocked: termination.blocked === true
  };
}

function boundedOutbound(value) {
  const outbound = plainObject(value) ? value : {};
  return {
    attempted: Math.max(0, Number(outbound.attempted) || 0),
    succeeded: Math.max(0, Number(outbound.succeeded) || 0),
    failed: Math.max(0, Number(outbound.failed) || 0),
    unknown: Math.max(0, Number(outbound.unknown) || 0),
    held: Math.max(0, Number(outbound.held) || 0)
  };
}

function boundedExecutionOutcome(value) {
  const outcome = plainObject(value) ? value : {};
  return {
    kind: optionalText(outcome.kind, 'executionOutcome.kind', 80),
    status: optionalText(outcome.status, 'executionOutcome.status', 80),
    code: optionalText(outcome.code || outcome.reasonCode, 'executionOutcome.code', 120),
    noReply: outcome.noReply === true,
    failed: outcome.failed === true,
    timeout: outcome.timeout === true,
    cancelled: outcome.cancelled === true,
    aborted: outcome.aborted === true,
    notCalled: outcome.notCalled === true,
    apiFailure: outcome.apiFailure === true,
    toolFailure: outcome.toolFailure === true
  };
}

function boundedConversationEvidence(value, {
  schemaVersion = 0,
  evidenceVersion = 0,
  interactionId = '',
  topicId = '',
  originalSourceId = ''
} = {}) {
  if (!Array.isArray(value)) return [];
  const unique = new Map();
  const hostV3 = Number(schemaVersion) >= 3 && Number(evidenceVersion) >= 3;
  for (const item of value.slice(0, 40)) {
    const evidenceId = optionalText(item?.evidenceId, 'conversationEvidence.evidenceId', 160);
    const content = optionalText(item?.text, 'conversationEvidence.text', 240);
    if (!evidenceId || !content) continue;
    const role = optionalText(item?.role, 'conversationEvidence.role', 20);
    const messageId = optionalText(item?.messageId, 'conversationEvidence.messageId', 160);
    const sourceRecordId = optionalText(
      item?.sourceRecordId || messageId || (hostV3 ? '' : evidenceId),
      'conversationEvidence.sourceRecordId',
      160
    );
    const normalized = {
      evidenceId,
      sourceRecordType: optionalText(
        item?.sourceRecordType || (hostV3 ? '' : (evidenceId.includes(':') ? evidenceId.split(':', 1)[0] : 'message')),
        'conversationEvidence.sourceRecordType',
        40
      ),
      sourceRecordId,
      messageId,
      platformMessageId: optionalText(
        item?.platformMessageId,
        'conversationEvidence.platformMessageId',
        160
      ),
      senderId: optionalText(item?.senderId, 'conversationEvidence.senderId', 40),
      speaker: optionalText(item?.speaker || item?.role, 'conversationEvidence.speaker', 20),
      role,
      originalSourceId: optionalText(
        item?.originalSourceId || originalSourceId,
        'conversationEvidence.originalSourceId',
        160
      ),
      originalSourceIds: [...new Set([
        ...(Array.isArray(item?.originalSourceIds) ? item.originalSourceIds : []),
        item?.originalSourceId || originalSourceId
      ].map((value) => String(value || '').trim().slice(0, 160)).filter(Boolean))].slice(0, 20),
      interactionId: optionalText(
        item?.interactionId || interactionId,
        'conversationEvidence.interactionId',
        160
      ),
      topicId: optionalText(item?.topicId || topicId, 'conversationEvidence.topicId', 160),
      at: Math.max(0, Number(item?.at) || 0),
      text: content,
      truncated: item?.truncated === true,
      confirmed: item?.confirmed === true,
      delivered: role === 'assistant' && item?.delivered === true,
      userEvidence: hostV3 && role === 'user' && sourceRecordId.length > 0,
      userConfirmed: role === 'user' && isExplicitTraitFeedback(item?.explicitFeedback)
        && item.explicitFeedback.action === 'confirm',
      explicitFeedback: role === 'user' ? normalizeExplicitTraitFeedback(item?.explicitFeedback) : null
    };
    const current = unique.get(evidenceId);
    if (!current || (normalized.confirmed && !current.confirmed)
      || normalized.at > current.at) {
      unique.set(evidenceId, normalized);
    }
  }
  return [...unique.values()].slice(0, 20);
}

function normalizeExplicitTraitFeedback(value) {
  if (!plainObject(value)) return null;
  const feedbackId = String(value.feedbackId || '').trim();
  const sourceRef = String(value.sourceRef || '').trim();
  const targetSourceRef = String(value.targetSourceRef || '').trim();
  const action = String(value.action || '').trim();
  const nextValue = typeof value.value === 'string' ? value.value.trim().slice(0, 160) : '';
  if (!feedbackId || feedbackId.length > 160 || !sourceRef || sourceRef.length > 420
    || !/^(candidate|trait):[^\s:][^\s]*$/u.test(targetSourceRef)
    || targetSourceRef.length > 420
    || !['confirm', 'correct', 'retract'].includes(action)
    || (action === 'correct' && !nextValue)) return null;
  return { feedbackId, sourceRef, targetSourceRef, action, value: nextValue };
}

function isExplicitTraitFeedback(value) {
  return normalizeExplicitTraitFeedback(value) !== null;
}

function evidenceRole(item) {
  const explicit = String(item?.role || item?.speaker || '').trim().toLowerCase();
  if (USER_ROLES.has(explicit)) return 'user';
  if (ASSISTANT_ROLES.has(explicit)) return 'assistant';
  if (item?.userEvidence === true || item?.userConfirmed === true) return 'user';
  if (item?.delivered === true) return 'assistant';
  return 'unknown';
}

function failureKinds(
  resultClass,
  outbound,
  neverWoken,
  participation,
  termination,
  actionSummary,
  executionOutcome
) {
  const values = [];
  const outcome = plainObject(executionOutcome) ? executionOutcome : {};
  const outcomeKinds = new Set([
    outcome.kind,
    outcome.status,
    outcome.code,
    outcome.reasonCode
  ].map((value) => String(value || '').toLowerCase()).filter(Boolean));
  const exactResult = String(resultClass || '').toLowerCase();
  const explicitSilence = termination?.kind === 'explicit_silence'
    && Number(outbound.attempted) === 0
    && Number(outbound.succeeded) === 0
    && Number(outbound.failed) === 0
    && Number(outbound.unknown) === 0
    && Number(outbound.held) === 0;
  if (['timeout', 'timed_out', 'deadline', 'request_timeout'].includes(exactResult)
    || ['timeout', 'timed_out', 'deadline', 'request_timeout'].some((kind) => outcomeKinds.has(kind))
    || outcome.timeout === true) values.push('timeout');
  if (['aborted', 'cancelled', 'canceled', 'interrupt'].includes(exactResult)
    || ['aborted', 'cancelled', 'canceled', 'interrupt'].some((kind) => outcomeKinds.has(kind))
    || outcome.aborted === true
    || outcome.cancelled === true) values.push('aborted');
  if (['failed', 'failure', 'error'].includes(exactResult)
    || ['failed', 'failure', 'error'].some((kind) => outcomeKinds.has(kind))
    || outcome.failed === true) values.push('failure');
  if (['api_error', 'api_failure'].includes(exactResult)
    || ['api_error', 'api_failure'].some((kind) => outcomeKinds.has(kind))
    || outcome.apiFailure === true) values.push('api_failure');
  if (['tool_error', 'tool_failure'].includes(exactResult)
    || ['tool_error', 'tool_failure'].some((kind) => outcomeKinds.has(kind))
    || actionSummary?.toolFailed === true
    || actionSummary?.toolFailure === true
    || outcome.toolFailure === true) {
    values.push('tool_failure');
  }
  if (!explicitSilence && (['no_reply', 'noreply'].includes(exactResult)
    || actionSummary?.noreply === true
    || actionSummary?.noReply === true
    || outcome.noReply === true
    || participation?.decision === 'noreply')) {
    values.push('noreply');
  }
  if (actionSummary?.notCalled === true
    || outcome.notCalled === true
    || ['not_called', 'not_invoked', 'not_woken'].includes(
      String(participation?.decision || participation?.reasonCode || '').toLowerCase()
    )) {
    values.push('not_called');
  }
  if (Number(outbound.unknown) > 0) values.push('unknown_external_write');
  if (Number(outbound.held) > 0) values.push('held_external_write');
  if (neverWoken) values.push('never_woken');
  return [...new Set(values)];
}

function behaviorChangeSignal(event, actionSummary) {
  const explicit = [
    event.behaviorChange,
    event.behaviorChanged,
    actionSummary.behaviorChange,
    actionSummary.behaviorChanged
  ].some((value) => value === true);
  const evidence = event.behaviorChangeEvidence
    ?? event.behaviorChangeReason
    ?? actionSummary.behaviorChangeEvidence
    ?? actionSummary.behaviorChangeReason
    ?? '';
  return {
    detected: explicit || Boolean(String(evidence || '').trim()),
    evidence: optionalText(evidence, 'behaviorChangeEvidence', 300)
  };
}

export function reflectionDatabasePath(dataDir = DATA_DIR) {
  return path.join(dataDir, 'plugins', 'self-evolution', REFLECTION_DATABASE_NAME);
}

export function hashBasePersona(basePersona = {}) {
  const persona = plainObject(basePersona) ? basePersona : {};
  const tools = Array.isArray(persona.tools)
    ? persona.tools.map((tool) => ({
        name: String(tool?.name || ''),
        effect: String(tool?.effect || ''),
        terminal: tool?.terminal === true
      })).sort((left, right) => left.name.localeCompare(right.name, 'en'))
    : [];
  return hash(stableJson({
    roleText: String(persona.roleText || ''),
    behaviorProfile: String(persona.behaviorProfile || ''),
    botName: String(persona.botName || ''),
    selfNickname: String(persona.selfNickname || ''),
    customRules: String(persona.customRules || ''),
    tools,
    auth: persona.auth ?? null
  }));
}

export function normalizeCompletionObservation(event) {
  const lineage = sourceLineage(event);
  const actionSummary = plainObject(event.actionSummary) ? event.actionSummary : {};
  const rawEvidenceVersion = Number(event.evidenceVersion ?? actionSummary.evidenceVersion) || 0;
  const structuredEvidence = lineage.schemaVersion >= 3 && rawEvidenceVersion >= 3;
  const triggerKind = optionalText(
    event.triggerKind || actionSummary.triggerKind, 'event.triggerKind', 80
  );
  const interactionId = optionalText(
    event.interactionId || actionSummary.interactionId, 'event.interactionId', 160
  );
  const topicId = optionalText(event.topicId || actionSummary.topicId, 'event.topicId', 160);
  const originalSourceId = optionalText(
    event.originalSourceId || actionSummary.originalSourceId, 'event.originalSourceId', 160
  );
  const delivered = event.delivered === true || actionSummary.delivered === true;
  const conversationEvidence = boundedConversationEvidence(actionSummary.conversationEvidence, {
    schemaVersion: lineage.schemaVersion,
    evidenceVersion: rawEvidenceVersion,
    interactionId,
    topicId,
    originalSourceId
    })
    .map((item) => {
      const sourceRef = [
        lineage.accountId,
        lineage.chatKey || 'account',
        item.sourceRecordType || 'message',
        item.sourceRecordId || item.evidenceId
      ].join(':');
      const explicitFeedback = normalizeExplicitTraitFeedback(item.explicitFeedback);
      const verifiedFeedback = explicitFeedback?.sourceRef === sourceRef ? explicitFeedback : null;
      return ({
      ...item,
      sessionId: lineage.sessionId,
      chatKey: lineage.chatKey,
      accountId: lineage.accountId,
      schemaVersion: lineage.schemaVersion,
      evidenceVersion: rawEvidenceVersion,
      proactive: event.proactive === true || actionSummary.proactive === true,
      userEvidence: lineage.schemaVersion >= 3 && rawEvidenceVersion >= 3
        && structuredEvidence
        && item.role === 'user'
        && item.sourceRecordType === 'message'
        && Boolean(item.sourceRecordId && item.originalSourceId && item.interactionId),
      explicitFeedback: verifiedFeedback,
      userConfirmed: item.role === 'user' && verifiedFeedback?.action === 'confirm',
      assistantContext: item.delivered === true || evidenceRole(item) === 'assistant',
      sourceRef
    });});
  const resultClass = optionalText(event.resultClass, 'event.resultClass', 80);
  const finishReason = optionalText(actionSummary.finishReason, 'actionSummary.finishReason', 300);
  const outbound = boundedOutbound(actionSummary.outbound);
  const neverWoken = actionSummary.neverWoken === true;
  const participation = boundedParticipation(actionSummary.participation);
  const termination = boundedTermination(actionSummary.termination);
  const executionOutcome = boundedExecutionOutcome(actionSummary.executionOutcome);
  const behaviorChange = behaviorChangeSignal(event, actionSummary);
  const failures = failureKinds(
    resultClass,
    outbound,
    neverWoken,
    participation,
    termination,
    actionSummary,
    executionOutcome
  );
  const invalidEvidenceKinds = failures.filter((kind) =>
    REFLECTION_INVALID_EVIDENCE_KINDS.includes(kind)
  );
  const explicitSilence = termination.kind === 'explicit_silence'
    && outbound.attempted === 0
    && outbound.succeeded === 0
    && outbound.failed === 0
    && outbound.unknown === 0
    && outbound.held === 0;
  const explicitPreference = conversationEvidence.some((item) => (
    item.userEvidence === true
    && item.userConfirmed === true
  ));
  const participationMode = `${participation.mode} ${participation.decision} ${participation.reasonCode}`.toLowerCase();
  const proactive = event.proactive === true || actionSummary.proactive === true
    || (rawEvidenceVersion < 3
      && /\b(?:proactive|scheduled|schedule|wake|wakeup|manual_wake|cron)\b/u.test(participationMode));
  const userEvidence = conversationEvidence.filter((item) => item.userEvidence === true);
  const userEvidenceRefs = [...new Set(userEvidence.map((item) =>
    item.sourceRef || item.evidenceId
  ).filter(Boolean))];
  const userEvidenceSessionIds = [...new Set(userEvidence.map((item) =>
    String(item.sessionId || lineage.sessionId || '').trim()
  ).filter(Boolean))];
  const userEvidenceChatKeys = [...new Set(userEvidence.map((item) =>
    String(item.chatKey || lineage.chatKey || '').trim()
  ).filter(Boolean))];
  const currentUserSourceRefs = [...new Set(userEvidence.map((item) => item.sourceRef).filter(Boolean))];
  const explicitFeedbacks = conversationEvidence
    .filter((item) => item.userEvidence === true && item.explicitFeedback)
    .map((item) => ({
      ...item.explicitFeedback,
      senderId: item.senderId,
      interactionId: item.interactionId,
      originalSourceId: item.originalSourceId
    }));
  const originalSourceIds = [...new Set([
    ...(Array.isArray(event.originalSourceIds) ? event.originalSourceIds : []),
    originalSourceId
  ].map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 40);
  const sourceMessageIds = (Array.isArray(event.sourceMessageIds) ? event.sourceMessageIds : [])
    .map(String)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 32);
  const evidenceIds = [
    lineage.eventId ? `completion:${lineage.eventId}` : '',
    `session:${lineage.sessionId}`,
    lineage.runId ? `run:${lineage.runId}` : '',
    ...sourceMessageIds.map((id) => `message:${id}`)
    ,
    ...conversationEvidence.flatMap((item) => [item.evidenceId, item.sourceRef])
  ].filter(Boolean);
  return {
    sourceKind: 'run_completion',
    schemaVersion: lineage.schemaVersion,
    evidenceVersion: rawEvidenceVersion,
    eventId: lineage.eventId,
    observerId: lineage.observerId,
    observerPluginId: lineage.observerPluginId,
    originKind: lineage.originKind,
    triggerKind,
    interactionId,
    topicId,
    originalSourceId,
    originalSourceIds,
    delivered,
    deliveryState: lineage.deliveryState,
    structuredEvidence,
    accountId: lineage.accountId,
    sessionId: lineage.sessionId,
    runId: lineage.runId,
    chatKey: lineage.chatKey,
    pluginGeneration: lineage.pluginGeneration,
    observationWindowId: lineage.observationWindowId,
    resultClass,
    actionSummary: {
      evidenceVersion: rawEvidenceVersion,
      triggerKind,
      proactive,
      interactionId,
      topicId,
      originalSourceId,
      originalSourceIds,
      delivered,
      deliveryState: lineage.deliveryState,
      sentCount: Math.max(0, Number(actionSummary.sentCount) || 0),
      finishReason,
      outboundAttempted: actionSummary.outboundAttempted === true,
      participation,
      termination,
      outbound
    },
    executionOutcome: Object.keys(executionOutcome).length > 0
      ? executionOutcome
      : {
          resultClass,
          sentCount: Math.max(0, Number(actionSummary.sentCount) || 0),
          finishReason
        },
    conversationEvidence,
    explicitFeedbacks,
    userEvidenceRefs,
    currentUserSourceRefs,
    userEvidenceCount: userEvidenceRefs.length,
    userEvidenceSessionCount: userEvidenceSessionIds.length,
    userEvidenceChatCount: userEvidenceChatKeys.length,
    explicitSilence,
    explicitPreference,
    proactive,
    sourceMessageIds,
    completedAt: Math.max(0, Number(event.completedAt) || 0),
    evidenceIds: [...new Set(evidenceIds)],
    reliability: failures.length > 0 ? 'unreliable' : 'normal',
    failureKinds: failures,
    invalidEvidenceKinds,
    traitEligible: invalidEvidenceKinds.length === 0,
    validSession: invalidEvidenceKinds.length === 0,
    behaviorChange: behaviorChange.detected,
    behaviorChangeEvidence: behaviorChange.evidence,
    neverWoken
  };
}

function observationWindowToken(normalized, windowMs = 0) {
  if (normalized.interactionId) return `interaction:${normalized.interactionId}`;
  if (normalized.evidenceVersion >= 3 && normalized.eventId) return `event:${normalized.eventId}`;
  if (normalized.observationWindowId) return `explicit:${normalized.observationWindowId}`;
  const duration = Math.max(0, Number(windowMs) || 0);
  const completedAt = Number(normalized.completedAt) || 0;
  if (duration > 0 && completedAt > 0) {
    return `bucket:${Math.floor(completedAt / duration)}`;
  }
  return `session:${normalized.sessionId}`;
}

export function observationWindowKey(event, { windowMs = 0 } = {}) {
  const normalized = normalizeCompletionObservation(event);
  return hash(stableJson({
    observerId: normalized.observerId,
    accountId: normalized.accountId,
    chatKey: normalized.chatKey,
    window: observationWindowToken(normalized, windowMs)
  }));
}

function evidenceRefs(value, evidence, limits, pathName) {
  if (!Array.isArray(value)) fail('REFLECTION_INVALID_OUTPUT', `${pathName} must be an array`);
  if (value.length < 1) fail('REFLECTION_INVALID_OUTPUT', `${pathName} must not be empty`);
  if (value.length > limits.maxEvidenceRefsPerItem) {
    fail('REFLECTION_LIMIT_EXCEEDED', `${pathName} has too many entries`, {
      field: pathName,
      limit: limits.maxEvidenceRefsPerItem,
      actual: value.length
    });
  }
  const allowed = new Set(evidence.evidenceIds || []);
  return [...new Set(value.map((item, index) => {
    const ref = text(String(item), `${pathName}[${index}]`, 240);
    if (!allowed.has(ref)) {
      fail('REFLECTION_SOURCE_LINEAGE', `${pathName}[${index}] is not part of the observation window`, {
        ref
      });
    }
    return ref;
  }))];
}

function itemScope(value, evidence, pathName) {
  const scope = text(String(value || 'global'), `${pathName}.scope`, 20);
  if (!['global', 'chat'].includes(scope)) {
    fail('REFLECTION_INVALID_OUTPUT', `${pathName}.scope must be global or chat`);
  }
  if (scope === 'chat' && !evidence.chatKey) {
    fail('REFLECTION_SCOPE', `${pathName}.scope requires a chat observation`);
  }
  return scope;
}

function chatKeyForScope(value, scope, evidence, pathName) {
  const explicit = value === undefined || value === null ? '' : String(value).trim();
  if (explicit.length > 100) {
    fail('REFLECTION_LIMIT_EXCEEDED', `${pathName}.chatKey exceeds 100 characters`);
  }
  if (scope === 'global') {
    if (explicit) fail('REFLECTION_SCOPE', `${pathName}.chatKey must be empty for global scope`);
    return '';
  }
  const chatKey = explicit || evidence.chatKey;
  if (chatKey !== evidence.chatKey) {
    fail('REFLECTION_SCOPE', `${pathName}.chatKey cannot widen beyond the observation window`);
  }
  return chatKey;
}

function noControlChars(value, pathName) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    fail('REFLECTION_INVALID_OUTPUT', `${pathName} contains control characters`);
  }
  return value;
}

function disinterestLike(value) {
  return DISINTEREST_PATTERNS.some((pattern) => pattern.test(String(value)));
}

function verifiedTraitSources(evidence) {
  const pool = Array.isArray(evidence?.traitEvidencePool)
    ? evidence.traitEvidencePool
    : Array.isArray(evidence?.conversationEvidence) ? evidence.conversationEvidence : [];
  return pool.filter((entry) => (
    Number(entry?.schemaVersion ?? evidence?.schemaVersion) >= 3
    &&
    Number(entry?.evidenceVersion) >= 3
    && entry?.role === 'user'
    && entry?.sourceRecordType === 'message'
    && String(entry?.sourceRecordId || '').trim()
    && String(entry?.originalSourceId || '').trim()
    && String(entry?.interactionId || '').trim()
    && String(entry?.accountId || evidence?.accountId || '').trim() === String(evidence?.accountId || '').trim()
    && String(entry?.chatKey || evidence?.chatKey || '').trim() === String(evidence?.chatKey || '').trim()
    && entry?.proactive !== true
  ));
}

function traitEvidenceGate(evidence, limits = DEFAULT_REFLECTION_LIMITS, item = null) {
  const sources = verifiedTraitSources(evidence);
  const uniqueByRoot = new Map();
  for (const entry of sources) {
    const root = String(entry.originalSourceId || '').trim();
    const interactionId = String(entry.interactionId || '').trim();
    const identity = `${interactionId}:${root}`;
    if (!uniqueByRoot.has(identity)) uniqueByRoot.set(identity, entry);
  }
  const selectedRefs = new Set(Array.isArray(item?.supportRefs)
    ? item.supportRefs.map(String)
    : Array.isArray(item?.evidenceRefs) ? item.evidenceRefs.map(String) : []);
  const counterRefs = new Set(Array.isArray(item?.counterRefs) ? item.counterRefs.map(String) : []);
  const selected = item
    ? [...uniqueByRoot.values()].filter((entry) => selectedRefs.has(String(entry.sourceRef || '')))
    : [...uniqueByRoot.values()];
  const counters = [...uniqueByRoot.values()].filter((entry) =>
    counterRefs.has(String(entry.sourceRef || ''))
  );
  const validRefs = new Set([...uniqueByRoot.values()].map((entry) => String(entry.sourceRef || '')));
  const interactions = new Set(selected.map((entry) => String(entry.interactionId || '')));
  const roots = new Set(selected.map((entry) => String(entry.originalSourceId || '')));
  const subject = String(item?.subject || '').trim();
  const validSubject = subject === 'bot'
    || /^user:[^\s:][^\s]*$/u.test(subject);
  const currentInteractionId = String(evidence?.interactionId || '').trim();
  const hasCurrentHumanEvidence = Array.isArray(evidence?.currentUserSourceRefs)
    && evidence.currentUserSourceRefs.length > 0;
  const selectedCurrent = currentInteractionId
    ? selected.some((entry) => String(entry.interactionId || '') === currentInteractionId)
    : false;
  const reasons = [];
  if (Number(evidence?.schemaVersion) < 3
    || Number(evidence?.evidenceVersion) < 3
    || evidence?.structuredEvidence !== true) {
    reasons.push('legacy-evidence');
  }
  if (evidence?.proactive === true) reasons.push('proactive-run');
  if (!hasCurrentHumanEvidence || !selectedCurrent) reasons.push('no-current-human-interaction');
  if (evidence?.explicitSilence === true && evidence?.explicitPreference !== true) {
    reasons.push('explicit-silence');
  }
  if (Array.isArray(evidence?.invalidEvidenceKinds) && evidence.invalidEvidenceKinds.length) {
    reasons.push('unreliable-completion');
  }
  if (item && !validSubject) reasons.push('invalid-subject');
  if (item && [...selectedRefs, ...counterRefs].some((ref) => !validRefs.has(ref))) {
    reasons.push('unverified-source-reference');
  }
  if (item && subject.startsWith('user:')) {
    const senderId = subject.slice('user:'.length);
    if (selected.some((entry) => String(entry.senderId || '') !== senderId)) {
      reasons.push('subject-source-mismatch');
    }
  }
  if (interactions.size < Number(limits.minTraitValidSessions)) reasons.push('insufficient-interactions');
  if (roots.size < Number(limits.minTraitUserEvidence)) reasons.push('insufficient-human-sources');
  if (item?.scope === 'global') reasons.push('global-cross-chat-evidence-unavailable');
  return {
    mode: evidence?.evidenceVersion >= 3 ? 'host-v3' : 'legacy-audit',
    eligible: reasons.length === 0,
    globalScopeEligible: item?.scope !== 'global',
    reasons: [...new Set(reasons)],
    validSessionCount: interactions.size,
    userEvidenceCount: roots.size,
    userEvidenceRefs: selected.map((entry) => String(entry.sourceRef || '')).filter(Boolean),
    userEvidenceSessionCount: interactions.size,
    userEvidenceChatCount: new Set(selected.map((entry) => String(entry.chatKey || ''))).size,
    supportingEvidence: selected.slice(0, limits.maxEvidenceRefsPerItem).map((entry) => ({
      sourceRef: String(entry.sourceRef || ''),
      sourceMessageId: String(entry.originalSourceId || ''),
      interactionId: String(entry.interactionId || ''),
      topicId: String(entry.topicId || ''),
      text: String(entry.text || '').slice(0, 240)
    })),
    counterEvidence: counters.slice(0, limits.maxEvidenceRefsPerItem).map((entry) => ({
      sourceRef: String(entry.sourceRef || ''),
      sourceMessageId: String(entry.originalSourceId || ''),
      interactionId: String(entry.interactionId || ''),
      topicId: String(entry.topicId || ''),
      text: String(entry.text || '').slice(0, 240)
    })),
    explicitSilence: evidence?.explicitSilence === true,
    explicitPreference: evidence?.explicitPreference === true,
    proactive: evidence?.proactive === true
  };
}

function proceduralTraitReason(key, value) {
  const keyText = String(key || '').trim();
  const valueText = String(value || '').replace(/\s+/g, ' ').trim();
  if (PROCEDURAL_KEY_PATTERNS.some((pattern) => pattern.test(keyText))) {
    return 'procedural-key';
  }
  if (PROCEDURAL_TRAIT_PATTERNS.some((pattern) => pattern.test(valueText))) {
    return 'procedural-value';
  }
  return '';
}

function noteContentRejection(content) {
  const value = String(content || '').replace(/\s+/g, ' ').trim();
  if (!value) return null;
  // Keep objective run telemetry out of the Notebook, while allowing a
  // concrete experience or temporary impression to use natural language.
  if (/(?:本轮|本次)(?:运行|会话)[^。！？\n]{0,16}(?:统计|状态|预算|指标|记录)/iu.test(value)
    || /(?:token\s*budget|token预算|预算统计|外发统计|工具调用统计|延迟统计|run telemetry|outbound count)/iu.test(value)) {
    return {
      code: 'REFLECTION_NOTE_NOT_DURABLE',
      message: 'Notebook note cannot be run telemetry or model budget metadata'
    };
  }
  if (!classifyNotebookMemory(value).recallable) {
    return {
      code: 'REFLECTION_NOTE_OPERATIONAL',
      message: 'Notebook note cannot be an operational self-instruction or run record'
    };
  }
  return null;
}

function validateNoteOperation(raw, index, evidence, limits) {
  const pathName = `noteOperations[${index}]`;
  exactKeys(raw, [
    'operation',
    'scope',
    'chatKey',
    'content',
    'tags',
    'noteId',
    'expectedRevision',
    'evidenceRefs'
  ], pathName);
  const operation = text(String(raw.operation || ''), `${pathName}.operation`, 20);
  if (!['append', 'update', 'archive'].includes(operation)) {
    fail('REFLECTION_INVALID_OUTPUT', `${pathName}.operation must be append, update, or archive`);
  }
  const scope = itemScope(raw.scope, evidence, pathName);
  if (scope !== 'chat') {
    fail('REFLECTION_SCOPE', `${pathName}.scope must remain chat-scoped to the observed interaction`);
  }
  const chatKey = chatKeyForScope(raw.chatKey, scope, evidence, pathName);
  const refs = evidenceRefs(raw.evidenceRefs, evidence, limits, `${pathName}.evidenceRefs`);
  const result = {
    operation,
    scope,
    chatKey,
    evidenceRefs: refs
  };
  if (operation === 'append') {
    result.content = noControlChars(
      text(raw.content, `${pathName}.content`, limits.maxContentChars),
      `${pathName}.content`
    );
    if (raw.tags !== undefined) {
      if (!Array.isArray(raw.tags)) fail('REFLECTION_INVALID_OUTPUT', `${pathName}.tags must be an array`);
      if (raw.tags.length > 24) fail('REFLECTION_LIMIT_EXCEEDED', `${pathName}.tags has too many entries`);
      result.tags = [...new Set(raw.tags.map((tag, tagIndex) =>
        text(String(tag), `${pathName}.tags[${tagIndex}]`, 80)))];
    } else {
      result.tags = [];
    }
    if (raw.noteId !== undefined || raw.expectedRevision !== undefined) {
      fail('REFLECTION_INVALID_OUTPUT', `${pathName} cannot include noteId or expectedRevision for append`);
    }
  } else {
    result.noteId = text(raw.noteId, `${pathName}.noteId`, 120);
    const revision = Number(raw.expectedRevision);
    if (!Number.isSafeInteger(revision) || revision < 1) {
      fail('REFLECTION_INVALID_OUTPUT', `${pathName}.expectedRevision must be a positive integer`);
    }
    result.expectedRevision = revision;
    if (operation === 'update') {
      const hasContent = raw.content !== undefined;
      const hasTags = raw.tags !== undefined;
      if (!hasContent && !hasTags) {
        fail('REFLECTION_INVALID_OUTPUT', `${pathName} update needs content or tags`);
      }
      if (hasContent) {
        result.content = noControlChars(
          text(raw.content, `${pathName}.content`, limits.maxContentChars),
          `${pathName}.content`
        );
      }
      if (hasTags) {
        if (!Array.isArray(raw.tags)) fail('REFLECTION_INVALID_OUTPUT', `${pathName}.tags must be an array`);
        if (raw.tags.length > 24) fail('REFLECTION_LIMIT_EXCEEDED', `${pathName}.tags has too many entries`);
        result.tags = [...new Set(raw.tags.map((tag, tagIndex) =>
          text(String(tag), `${pathName}.tags[${tagIndex}]`, 80)))];
      }
    }
  }
  return result;
}

function validateTraitProposal(raw, index, evidence, limits) {
  const pathName = `traitProposals[${index}]`;
  exactKeys(raw, [
    'action',
    'key',
    'value',
    'subject',
    'candidateId',
    'scope',
    'chatKey',
    'confidence',
    'evidenceRefs',
    'supportRefs',
    'counterRefs'
  ], pathName);
  const action = text(String(raw.action || ''), `${pathName}.action`, 20);
  if (!['set', 'remove'].includes(action)) {
    fail('REFLECTION_INVALID_OUTPUT', `${pathName}.action must be set or remove`);
  }
  const key = text(raw.key, `${pathName}.key`, limits.maxTraitKeyChars);
  if (!TRAIT_KEY_RE.test(key)) {
    fail('REFLECTION_INVALID_OUTPUT', `${pathName}.key must be a stable identifier`);
  }
  if (RESERVED_TRAIT_KEYS.has(key.toLowerCase())) {
    fail('REFLECTION_PROTECTED_SCOPE', `${pathName}.key cannot modify Base Persona or permissions`);
  }
  const scope = itemScope(raw.scope, evidence, pathName);
  if (scope !== 'chat') {
    fail('REFLECTION_SCOPE', `${pathName}.scope must remain chat-scoped without authorized abstract evidence`);
  }
  const chatKey = chatKeyForScope(raw.chatKey, scope, evidence, pathName);
  const confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    fail('REFLECTION_INVALID_OUTPUT', `${pathName}.confidence must be between 0 and 1`);
  }
  if (raw.evidenceRefs !== undefined && raw.supportRefs !== undefined
    && stableJson(raw.evidenceRefs) !== stableJson(raw.supportRefs)) {
    fail('REFLECTION_INVALID_OUTPUT', `${pathName}.supportRefs conflicts with evidenceRefs`);
  }
  const refs = evidenceRefs(
    raw.supportRefs ?? raw.evidenceRefs,
    evidence,
    limits,
    `${pathName}.supportRefs`
  );
  const counterInput = raw.counterRefs === undefined ? [] : raw.counterRefs;
  if (!Array.isArray(counterInput)) {
    fail('REFLECTION_INVALID_OUTPUT', `${pathName}.counterRefs must be an array`);
  }
  if (counterInput.length > limits.maxEvidenceRefsPerItem) {
    fail('REFLECTION_LIMIT_EXCEEDED', `${pathName}.counterRefs has too many entries`);
  }
  const allowedRefs = new Set(evidence.evidenceIds || []);
  const counterRefs = [...new Set(counterInput.map((ref, refIndex) => {
    const normalizedRef = text(String(ref), `${pathName}.counterRefs[${refIndex}]`, 240);
    if (!allowedRefs.has(normalizedRef)) {
      fail('REFLECTION_SOURCE_LINEAGE',
        `${pathName}.counterRefs[${refIndex}] is not part of the observation window`);
    }
    return normalizedRef;
  }))];
  const verifiedSourceRefs = new Set(
    verifiedTraitSources(evidence).map((entry) => String(entry.sourceRef || '')).filter(Boolean)
  );
  if ([...refs, ...counterRefs].some((ref) => !verifiedSourceRefs.has(ref))) {
    fail('REFLECTION_SOURCE_LINEAGE',
      `${pathName} support and counter references must resolve to host-verified human sources`);
  }
  const subject = text(raw.subject, `${pathName}.subject`, 160);
  if (subject !== 'bot' && !/^user:[^\s:][^\s]*$/u.test(subject)) {
    fail('REFLECTION_INVALID_OUTPUT', `${pathName}.subject must be bot or user:<host sender id>`);
  }
  const candidateId = raw.candidateId === undefined
    ? ''
    : text(raw.candidateId, `${pathName}.candidateId`, 160);
  const referencedCandidate = candidateId
    ? (Array.isArray(evidence.existingCandidates) ? evidence.existingCandidates : [])
      .find((candidate) => candidate?.candidateId === candidateId)
    : null;
  if (candidateId && !referencedCandidate) {
    fail('REFLECTION_SOURCE_LINEAGE', `${pathName}.candidateId is not a visible current candidate`);
  }
  if (referencedCandidate && (
    referencedCandidate.subject !== subject
    || referencedCandidate.key !== key
    || referencedCandidate.value !== String(raw.value ?? '')
    || referencedCandidate.scope !== scope
    || referencedCandidate.chatKey !== chatKey
  )) {
    fail('REFLECTION_SOURCE_LINEAGE', `${pathName}.candidateId claim does not match`);
  }
  const result = {
    action,
    key,
    subject,
    candidateId,
    scope,
    chatKey,
    confidence,
    evidenceRefs: refs,
    supportRefs: refs,
    counterRefs
  };
  if (action === 'set') {
    result.value = noControlChars(
      text(String(raw.value ?? ''), `${pathName}.value`, limits.maxTraitValueChars),
      `${pathName}.value`
    );
  } else if (raw.value !== undefined) {
    fail('REFLECTION_INVALID_OUTPUT', `${pathName}.value is not allowed for remove`);
  }
  const proceduralReason = proceduralTraitReason(key, result.value || '');
  if (proceduralReason) {
    fail('REFLECTION_PROCEDURAL_TRAIT',
      `${pathName} contains procedural or scripted behavior`,
      { reason: proceduralReason });
  }
  const gate = traitEvidenceGate(evidence, limits, result);
  const unreliable = evidence.reliability !== 'normal';
  if (unreliable && (disinterestLike(key) || disinterestLike(result.value || ''))) {
    gate.eligible = false;
    gate.reasons = [...new Set([...gate.reasons, 'failure-based-disinterest-inference'])];
  }
  result.evidenceGate = gate;
  return result;
}

function validateCapabilityGap(raw, index, evidence, limits) {
  const pathName = `capabilityGapProposals[${index}]`;
  exactKeys(raw, [
    'category',
    'capability',
    'requestKey',
    'scope',
    'chatKey',
    'detail',
    'evidenceRefs'
  ], pathName);
  const category = text(raw.category, `${pathName}.category`, 30);
  if (!CATEGORY_SET.has(category)) {
    fail('REFLECTION_INVALID_OUTPUT', `${pathName}.category is not supported`);
  }
  const capability = noControlChars(
    text(raw.capability, `${pathName}.capability`, limits.maxCapabilityChars),
    `${pathName}.capability`
  );
  const requestKey = text(raw.requestKey, `${pathName}.requestKey`, limits.maxRequestKeyChars);
  const scope = itemScope(raw.scope, evidence, pathName);
  const chatKey = chatKeyForScope(raw.chatKey, scope, evidence, pathName);
  const detail = raw.detail === undefined || raw.detail === ''
    ? ''
    : noControlChars(text(raw.detail, `${pathName}.detail`, limits.maxDetailChars), `${pathName}.detail`);
  const refs = evidenceRefs(raw.evidenceRefs, evidence, limits, `${pathName}.evidenceRefs`);
  return {
    category,
    capability,
    requestKey,
    scope,
    chatKey,
    detail,
    evidenceRefs: refs
  };
}

export function validateReflectionOutput(raw, {
  evidence,
  limits = DEFAULT_REFLECTION_LIMITS
} = {}) {
  const normalizedLimits = normalizeLimits(limits);
  if (!plainObject(evidence) || evidence.sourceKind !== 'run_completion') {
    fail('REFLECTION_SOURCE_LINEAGE', 'a run completion observation is required');
  }
  exactKeys(raw, ['noteOperations', 'traitProposals', 'capabilityGapProposals', 'summary'],
    'reflectionOutput');
  const noteInput = raw.noteOperations === undefined ? [] : raw.noteOperations;
  const traitInput = raw.traitProposals === undefined ? [] : raw.traitProposals;
  const gapInput = raw.capabilityGapProposals === undefined ? [] : raw.capabilityGapProposals;
  if (!Array.isArray(noteInput) || !Array.isArray(traitInput) || !Array.isArray(gapInput)) {
    fail('REFLECTION_INVALID_OUTPUT', 'proposal collections must be arrays');
  }
  if (gapInput.length > normalizedLimits.maxCapabilityGapProposals) {
    fail('REFLECTION_LIMIT_EXCEEDED', 'capabilityGapProposals exceeds the limit');
  }
  if (typeof raw.summary !== 'string') {
    fail('REFLECTION_INVALID_OUTPUT', 'summary must be a string');
  }
  const summary = raw.summary.trim();
  if (summary.length > normalizedLimits.maxSummaryChars) {
    fail('REFLECTION_LIMIT_EXCEEDED', 'summary exceeds the limit');
  }
  const noteOperations = [];
  const rejectedNoteOperations = [];
  for (const [index, item] of noteInput.slice(0, normalizedLimits.maxNoteOperations).entries()) {
    try {
      noteOperations.push(validateNoteOperation(item, index, evidence, normalizedLimits));
    } catch (error) {
      rejectedNoteOperations.push({
        index,
        code: String(error?.code || 'REFLECTION_INVALID_OUTPUT').slice(0, 120),
        reason: String(error?.message || error).slice(0, 300),
        evidenceRefs: Array.isArray(item?.evidenceRefs)
          ? item.evidenceRefs.map((ref) => String(ref).slice(0, 240)).slice(0, 8)
          : []
      });
    }
  }
  for (let index = normalizedLimits.maxNoteOperations; index < noteInput.length; index += 1) {
    rejectedNoteOperations.push({
      index,
      code: 'REFLECTION_LIMIT_EXCEEDED',
      reason: 'note operation limit exceeded',
      evidenceRefs: Array.isArray(noteInput[index]?.evidenceRefs)
        ? noteInput[index].evidenceRefs.map((ref) => String(ref).slice(0, 240)).slice(0, 8)
        : []
    });
  }
  const traitProposals = [];
  const rejectedTraitProposals = [];
  for (const [index, item] of traitInput.slice(0, normalizedLimits.maxTraitProposals).entries()) {
    try {
      traitProposals.push(validateTraitProposal(item, index, evidence, normalizedLimits));
    } catch (error) {
      rejectedTraitProposals.push({
        index,
        code: String(error?.code || 'REFLECTION_INVALID_OUTPUT').slice(0, 120),
        reason: String(error?.message || error).slice(0, 300),
        evidenceRefs: Array.isArray(item?.evidenceRefs)
          ? item.evidenceRefs.map((ref) => String(ref).slice(0, 240)).slice(0, 8)
          : []
      });
    }
  }
  for (let index = normalizedLimits.maxTraitProposals; index < traitInput.length; index += 1) {
    rejectedTraitProposals.push({
      index,
      code: 'REFLECTION_LIMIT_EXCEEDED',
      reason: 'trait proposal limit exceeded',
      evidenceRefs: Array.isArray(traitInput[index]?.evidenceRefs)
        ? traitInput[index].evidenceRefs.map((ref) => String(ref).slice(0, 240)).slice(0, 8)
        : []
    });
  }
  const result = {
    noteOperations,
    rejectedNoteOperations,
    traitProposals,
    rejectedTraitProposals,
    capabilityGapProposals: gapInput.map((item, index) => validateCapabilityGap(
      item, index, evidence, normalizedLimits
    )),
    summary
  };
  const serialized = stableJson(result);
  if (serialized.length > normalizedLimits.maxOutputChars) {
    fail('REFLECTION_LIMIT_EXCEEDED', 'reflection output exceeds the total character budget');
  }
  return result;
}

function isEmptyOutput(output) {
  return output.noteOperations.length === 0
    && output.rejectedNoteOperations.length === 0
    && output.traitProposals.length === 0
    && output.capabilityGapProposals.length === 0
    && output.rejectedTraitProposals.length === 0;
}

function jobView(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    observationKey: String(row.observation_key),
    observationWindowKey: String(row.observation_key),
    observerId: String(row.observer_id),
    observerPluginId: String(row.observer_plugin_id),
    accountId: String(row.account_id),
    chatKey: String(row.chat_key || ''),
    sessionId: String(row.session_id),
    runId: String(row.run_id || ''),
    pluginGeneration: Number(row.plugin_generation) || 0,
    sourceKind: String(row.source_kind),
    evidence: parseJson(row.evidence_json, {}),
    evidenceHash: String(row.evidence_hash),
    status: String(row.status),
    attempts: Number(row.attempts) || 0,
    maxAttempts: Number(row.max_attempts) || 0,
  leaseOwner: String(row.lease_owner || ''),
  leaseGeneration: Number(row.lease_generation) || 0,
    leaseToken: String(row.lease_token || ''),
    leaseExpiresAt: Number(row.lease_expires_at) || 0,
    availableAt: Number(row.available_at) || 0,
    validSessionCount: Number(parseJson(row.evidence_json, {}).validSessionCount) || 0,
    behaviorChange: parseJson(row.evidence_json, {}).behaviorChange === true,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
    lastError: String(row.last_error || '')
  };
}

function batchView(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    accountId: String(row.account_id),
    mode: String(row.mode),
    status: String(row.status),
    summary: String(row.summary || ''),
    output: parseJson(row.output_json, {}),
    evidence: parseJson(row.evidence_json, {}),
    basePersonaHash: String(row.base_persona_hash || ''),
    expectedProfileRevision: Number(row.expected_profile_revision) || 0,
    appliedProfileRevision: Number(row.applied_profile_revision) || 0,
    createdAt: Number(row.created_at) || 0,
    reviewedAt: Number(row.reviewed_at) || 0,
    reviewer: String(row.reviewer || ''),
    errorCode: String(row.error_code || ''),
    errorMessage: String(row.error_message || '')
  };
}

function proposalView(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    batchId: String(row.batch_id),
    jobId: String(row.job_id),
    accountId: String(row.account_id),
    type: String(row.proposal_type),
    itemIndex: Number(row.item_index) || 0,
    risk: String(row.risk),
    scope: String(row.scope || ''),
    chatKey: String(row.chat_key || ''),
    detail: String(row.detail || ''),
    payload: parseJson(row.payload_json, {}),
    evidenceRefs: parseJson(row.evidence_refs_json, []),
    basePersonaHash: String(row.base_persona_hash || ''),
    expectedProfileRevision: Number(row.expected_profile_revision) || 0,
    status: String(row.status),
    createdAt: Number(row.created_at) || 0,
    reviewedAt: Number(row.reviewed_at) || 0,
    appliedAt: Number(row.applied_at) || 0,
    reviewer: String(row.reviewer || ''),
    applier: String(row.applier || ''),
    errorCode: String(row.error_code || ''),
    errorMessage: String(row.error_message || '')
  };
}

function profileView(row) {
  if (!row) return null;
  return {
    accountId: String(row.account_id),
    revision: Number(row.revision) || 0,
    parentRevision: Number(row.parent_revision) || 0,
    profile: parseJson(row.profile_json, { global: {}, chats: {} }),
    evidence: parseJson(row.evidence_json, []),
    basePersonaHash: String(row.base_persona_hash || ''),
    appliedBy: String(row.applied_by || ''),
    source: parseJson(row.source_json, []),
    createdAt: Number(row.created_at) || 0
  };
}

function gapView(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    category: String(row.category),
    capability: String(row.capability),
    requestKey: String(row.request_key),
    scope: String(row.scope || ''),
    chatKey: String(row.chat_key || ''),
    status: String(row.status || 'open'),
    count: Number(row.count) || 0,
    evidenceRefs: parseJson(row.evidence_refs_json, []),
    firstSeenAt: Number(row.first_seen_at) || 0,
    lastSeenAt: Number(row.last_seen_at) || 0
  };
}

function emptyProfile() {
  return { global: {}, chats: {} };
}

function normalizeProfile(profile) {
  const value = plainObject(profile) ? profile : {};
  return {
    global: plainObject(value.global) ? structuredClone(value.global) : {},
    chats: plainObject(value.chats) ? structuredClone(value.chats) : {}
  };
}

function traitStoredValue(value) {
  return plainObject(value) && Object.hasOwn(value, 'value')
    ? String(value.value ?? '')
    : String(value ?? '');
}

function traitStorageKey(logicalKey, subject = '') {
  const normalizedSubject = String(subject || '');
  if (!normalizedSubject.startsWith('user:')) return String(logicalKey || '');
  return `${String(logicalKey || '')}__user_${hash(normalizedSubject).slice(0, 16)}`;
}

function resolveTraitStorageKey(bucket, logicalKey, subject = '') {
  const explicit = String(subject || '');
  if (explicit) return traitStorageKey(logicalKey, explicit);
  if (Object.hasOwn(bucket || {}, logicalKey)) return logicalKey;
  const matches = Object.entries(bucket || {})
    .filter(([, value]) => plainObject(value) && String(value.key || '') === logicalKey);
  return matches.length === 1 && !String(matches[0][1].subject || '').startsWith('user:')
    ? matches[0][0]
    : '';
}

function normalizeStoredTrait(value, {
  scope = 'global',
  chatKey = '',
  now = 0,
  key = '',
  storageKey = ''
} = {}) {
  if (plainObject(value) && Object.hasOwn(value, 'value')) {
    return {
      ...structuredClone(value),
      value: traitStoredValue(value),
      key: String(value.key || key),
      storageKey: String(value.storageKey || storageKey || key),
      subject: String(value.subject || ''),
      scope: String(value.scope || scope),
      chatKey: String(value.chatKey || chatKey || ''),
      evidenceRefs: Array.isArray(value.evidenceRefs)
        ? [...new Set(value.evidenceRefs.map(String).filter(Boolean))].slice(0, 32)
        : [],
      sourceChats: Array.isArray(value.sourceChats)
        ? [...new Set(value.sourceChats.map(String).filter(Boolean))].slice(0, 16)
        : (chatKey ? [chatKey] : []),
      confidence: Number.isFinite(Number(value.confidence))
        ? Math.max(0, Math.min(1, Number(value.confidence)))
        : 0,
      createdAt: Math.max(0, Number(value.createdAt) || Number(value.updatedAt) || now),
      lastObservedAt: Math.max(
        0,
        Number(value.lastObservedAt) || Number(value.updatedAt) || now
      ),
      expiresAt: Math.max(0, Number(value.expiresAt) || 0)
    };
  }
  return {
    value: traitStoredValue(value),
    key: String(key),
    storageKey: String(storageKey || key),
    subject: '',
    scope,
    chatKey,
    evidenceRefs: [],
    sourceChats: chatKey ? [chatKey] : [],
    confidence: 0,
    createdAt: Math.max(0, Number(now) || 0),
    lastObservedAt: Math.max(0, Number(now) || 0),
    expiresAt: 0
  };
}

function activeProfile(profile, now) {
  const normalized = normalizeProfile(profile);
  const current = emptyProfile();
  let activeCount = 0;
  let expiredCount = 0;
  const copyBucket = (source, target, scope, chatKey = '') => {
    for (const [key, value] of Object.entries(source || {})) {
      const entry = normalizeStoredTrait(value, {
        scope,
        chatKey,
        now,
        key: value?.key || key,
        storageKey: key
      });
      if (entry.expiresAt > 0 && entry.expiresAt <= now) {
        expiredCount += 1;
        continue;
      }
      target[key] = entry;
      activeCount += 1;
    }
  };
  copyBucket(normalized.global, current.global, 'global');
  for (const [chatKey, chatProfile] of Object.entries(normalized.chats)) {
    if (!plainObject(chatProfile)) continue;
    const target = {};
    copyBucket(chatProfile, target, 'chat', chatKey);
    if (Object.keys(target).length) current.chats[chatKey] = target;
  }
  return { profile: current, activeCount, expiredCount };
}

function strictSafeInteger(value, field, minimum = 0) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    fail('REFLECTION_INVALID_ARGUMENT',
      `${field} must be a typed safe integer >= ${minimum}`);
  }
  return value;
}

function rawProfileEntry(profile, { scope, chatKey = '', key, storageKey = '' }) {
  const normalized = normalizeProfile(profile);
  const bucket = scope === 'chat'
    ? (plainObject(normalized.chats?.[chatKey]) ? normalized.chats[chatKey] : null)
    : normalized.global;
  const selectedStorageKey = storageKey || key;
  if (!bucket || !Object.hasOwn(bucket, selectedStorageKey)) {
    return { exists: false, value: undefined };
  }
  return { exists: true, value: structuredClone(bucket[selectedStorageKey]) };
}

function profileEntryDescriptor(profile, {
  accountId,
  revision,
  scope,
  chatKey = '',
  key
} = {}) {
  const raw = rawProfileEntry(profile, { scope, chatKey, key });
  if (!raw.exists) return null;
  const entry = plainObject(raw.value) && Object.hasOwn(raw.value, 'value')
    ? raw.value
    : {};
  const logicalKey = String(entry.key || key || '');
  return {
    accountId: String(accountId || ''),
    key: logicalKey,
    logicalKey,
    storageKey: String(key || ''),
    subject: String(entry.subject || ''),
    scope: scope === 'chat' ? 'chat' : 'global',
    chatKey: scope === 'chat' ? String(chatKey || '') : '',
    value: plainObject(raw.value) && Object.hasOwn(raw.value, 'value')
      ? String(raw.value.value ?? '')
      : String(raw.value ?? ''),
    entry: raw.value,
    evidenceRefs: Array.isArray(entry.evidenceRefs)
      ? [...new Set(entry.evidenceRefs.map(String).filter(Boolean))].slice(0, 32)
      : [],
    createdAt: Number.isFinite(Number(entry.createdAt))
      ? Number(entry.createdAt)
      : Number.isFinite(Number(entry.updatedAt)) ? Number(entry.updatedAt) : 0,
    updatedAt: Number.isFinite(Number(entry.updatedAt)) ? Number(entry.updatedAt) : 0,
    sourceRevision: Number(revision) || 0
  };
}

function profileEntryDescriptors(profile, { accountId = '', revision = 0 } = {}) {
  const normalized = normalizeProfile(profile);
  const result = [];
  for (const key of Object.keys(normalized.global)) {
    const descriptor = profileEntryDescriptor(normalized, {
      accountId,
      revision,
      scope: 'global',
      key
    });
    if (descriptor) result.push(descriptor);
  }
  for (const [chatKey, chatProfile] of Object.entries(normalized.chats)) {
    if (!plainObject(chatProfile)) continue;
    for (const key of Object.keys(chatProfile)) {
      const descriptor = profileEntryDescriptor(normalized, {
        accountId,
        revision,
        scope: 'chat',
        chatKey,
        key
      });
      if (descriptor) result.push(descriptor);
    }
  }
  return result;
}

function descriptorIdentity(descriptor) {
  return `${descriptor.scope}:${descriptor.chatKey || ''}:${descriptor.storageKey || descriptor.key}`;
}

function diffProfileEntries(before, after) {
  const beforeMap = new Map(before.map((entry) => [descriptorIdentity(entry), entry]));
  const afterMap = new Map(after.map((entry) => [descriptorIdentity(entry), entry]));
  const removed = [];
  const retained = [];
  for (const [identity, entry] of beforeMap) {
    if (afterMap.has(identity)) retained.push(entry);
    else removed.push(entry);
  }
  return { removed, retained };
}

function validateMode(mode) {
  const value = String(mode || 'review');
  if (!MODE_SET.has(value)) fail('REFLECTION_INVALID_ARGUMENT', 'mode must be review or bounded_auto');
  return value;
}

function validateProposalStatus(status) {
  if (!PROPOSAL_STATUS_SET.has(status)) fail('REFLECTION_INVALID_ARGUMENT', 'invalid proposal status');
  return status;
}

function validateJobStatus(status) {
  if (!JOB_STATUS_SET.has(status)) fail('REFLECTION_INVALID_ARGUMENT', 'invalid job status');
  return status;
}

function ensureColumn(db, table, name, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((column) => column.name === name)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

function nextUtcPeriod(ts) {
  const value = Math.max(0, Number(ts) || 0);
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

function aggregateObservations(rows, observationKey, limits = DEFAULT_REFLECTION_LIMITS) {
  const fullObservations = rows.map((row) => parseJson(row.evidence_json, {}))
    .sort((left, right) => (
      (Number(left.completedAt) || 0) - (Number(right.completedAt) || 0)
      || String(left.sessionId || '').localeCompare(String(right.sessionId || ''))
    ));
  const first = fullObservations[0] || {};
  const observations = fullObservations.map((item) => {
    const metadata = {
      sourceKind: item.sourceKind,
      schemaVersion: item.schemaVersion,
      evidenceVersion: item.evidenceVersion,
      structuredEvidence: item.structuredEvidence === true,
      eventId: item.eventId,
      sessionId: item.sessionId,
      runId: item.runId,
      chatKey: item.chatKey,
      resultClass: item.resultClass,
      completedAt: item.completedAt,
      reliability: item.reliability,
      validSession: item.validSession,
      userEvidenceCount: Number(item.userEvidenceCount) || 0,
      explicitSilence: item.explicitSilence === true,
      explicitPreference: item.explicitPreference === true,
      proactive: item.proactive === true,
      failureKinds: Array.isArray(item.failureKinds) ? item.failureKinds.slice(0, 12) : [],
      actionSummary: {
        sentCount: Number(item.actionSummary?.sentCount) || 0,
        finishReason: String(item.actionSummary?.finishReason || '').slice(0, 300),
        outboundAttempted: item.actionSummary?.outboundAttempted === true,
        participation: item.actionSummary?.participation || {},
        termination: item.actionSummary?.termination || {},
        outbound: item.actionSummary?.outbound || {}
      },
      executionOutcome: {
        kind: String(item.executionOutcome?.kind || '').slice(0, 80),
        status: String(item.executionOutcome?.status || '').slice(0, 80),
        code: String(item.executionOutcome?.code || '').slice(0, 120),
        noReply: item.executionOutcome?.noReply === true,
        failed: item.executionOutcome?.failed === true,
        timeout: item.executionOutcome?.timeout === true,
        cancelled: item.executionOutcome?.cancelled === true
      }
    };
    return metadata;
  });
  const evidenceIds = [...new Set(fullObservations.flatMap((item) => (
    Array.isArray(item.evidenceIds) ? item.evidenceIds : []
  )))];
  const failureKinds = [...new Set(fullObservations.flatMap((item) => (
    Array.isArray(item.failureKinds) ? item.failureKinds : []
  )))];
  const invalidEvidenceKinds = [...new Set(fullObservations.flatMap((item) => (
    Array.isArray(item.invalidEvidenceKinds) ? item.invalidEvidenceKinds : []
  )))];
  const sessionIds = [...new Set(fullObservations.map((item) => String(item.sessionId || '')).filter(Boolean))];
  const behaviorChangeObservation = fullObservations.find((item) => item.behaviorChange === true);
  const conversationEvidence = [...new Map(
    fullObservations.flatMap((item) => (
      Array.isArray(item.conversationEvidence) ? item.conversationEvidence : []
    )).map((item) => [String(item.sourceRef || item.evidenceId || ''), item])
  ).values()].filter((item) => item.evidenceId);
  const validSessionCount = fullObservations.filter((item) => item.validSession === true).length;
  const structuredEvidence = fullObservations.some((item) => item.structuredEvidence === true);
  const userEvidence = conversationEvidence.filter((item) => (
    item.userEvidence === true || evidenceRole(item) === 'user'
  ));
  const userEvidenceRefs = [...new Set(userEvidence.map((item) =>
    String(item.sourceRef || item.evidenceId || '').trim()
  ).filter(Boolean))];
  const userEvidenceSessionIds = [...new Set(userEvidence.map((item) =>
    String(item.sessionId || '').trim()
  ).filter(Boolean))];
  const userEvidenceChatKeys = [...new Set(userEvidence.map((item) =>
    String(item.chatKey || '').trim()
  ).filter(Boolean))];
  const explicitSilence = fullObservations.some((item) => item.explicitSilence === true);
  const explicitPreference = fullObservations.some((item) => item.explicitPreference === true)
    || userEvidence.some((item) => item.userConfirmed === true);
  const proactive = fullObservations.some((item) => item.proactive === true);
  const traitGate = traitEvidenceGate({
    ...first,
    structuredEvidence,
    validSessionCount,
    sessionIds,
    conversationEvidence,
    userEvidenceRefs,
    userEvidenceCount: userEvidenceRefs.length,
    userEvidenceSessionCount: userEvidenceSessionIds.length,
    userEvidenceChatCount: userEvidenceChatKeys.length,
    explicitSilence,
    explicitPreference,
    proactive
  }, limits);
  const aggregate = {
    ...first,
    schemaVersion: Math.max(2, Number(first.schemaVersion) || 0),
    evidenceVersion: Math.max(2, Number(first.evidenceVersion) || 0),
    observationWindowKey: String(observationKey || ''),
    structuredEvidence,
    sessionIds,
    observations,
    validSessionCount,
    behaviorChange: Boolean(behaviorChangeObservation),
    behaviorChangeEvidence: String(
      behaviorChangeObservation?.behaviorChangeEvidence
      || first.behaviorChangeEvidence
      || ''
    ).slice(0, 300),
    evidenceIds,
    conversationEvidence,
    userEvidenceRefs,
    userEvidenceCount: userEvidenceRefs.length,
    userEvidenceSessionCount: userEvidenceSessionIds.length,
    userEvidenceChatCount: userEvidenceChatKeys.length,
    explicitSilence,
    explicitPreference,
    proactive,
    traitGate: {
      ...traitGate,
      validSessionCount,
      userEvidenceSessionCount: userEvidenceSessionIds.length,
      userEvidenceChatCount: userEvidenceChatKeys.length
    },
    failureKinds,
    invalidEvidenceKinds,
    reliability: failureKinds.length > 0 ? 'unreliable' : 'normal',
    traitEligible: invalidEvidenceKinds.length === 0,
    validSession: validSessionCount > 0
  };
  return aggregate;
}

export class ReflectionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ReflectionError';
    this.code = String(code || 'REFLECTION_ERROR');
    this.details = plainObject(details) ? details : {};
    this.httpStatus = this.code === 'REFLECTION_CAS_CONFLICT'
      || this.code === 'REFLECTION_BASE_PERSONA_CHANGED'
      || this.code === 'REFLECTION_CONFIRM_REQUIRED' ? 409
      : this.code === 'REFLECTION_DISABLED' || this.code === 'REFLECTION_READ_ONLY' ? 409
        : 400;
  }
}

export class ReflectionStore {
  constructor({
    dataDir = DATA_DIR,
    filename = reflectionDatabasePath(dataDir),
    create = true,
    readOnly = false,
    limits = {},
    now = () => Date.now()
  } = {}) {
    this.dataDir = dataDir;
    this.filename = filename;
    this.readOnly = readOnly === true;
    this.limits = normalizeLimits(limits);
    this.now = typeof now === 'function' ? now : () => Date.now();
    this.db = null;
    if (create !== false || fs.existsSync(filename)) this.open({ create: create !== false });
  }

  static openExisting(options = {}) {
    const filename = options.filename || reflectionDatabasePath(options.dataDir || DATA_DIR);
    if (!fs.existsSync(filename)) return null;
    return new ReflectionStore({ ...options, filename, create: false, readOnly: true });
  }

  get exists() {
    return fs.existsSync(this.filename);
  }

  get openState() {
    return Boolean(this.db);
  }

  open({ create = true } = {}) {
    if (this.db) return this;
    if (this.readOnly && !fs.existsSync(this.filename)) return this;
    if (create && !this.readOnly) {
      fs.mkdirSync(path.dirname(this.filename), { recursive: true, mode: 0o700 });
    }
    if (!fs.existsSync(this.filename) && this.readOnly) return this;
    this.db = this.readOnly
      ? new DatabaseSync(this.filename, { readOnly: true })
      : new DatabaseSync(this.filename);
    if (!this.readOnly) {
      this.db.exec(`
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=FULL;
        PRAGMA busy_timeout=5000;
        PRAGMA foreign_keys=ON;

        CREATE TABLE IF NOT EXISTS reflection_observations (
          id TEXT PRIMARY KEY,
          observation_window_key TEXT NOT NULL,
          observer_id TEXT NOT NULL,
          observer_plugin_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          chat_key TEXT NOT NULL DEFAULT '',
          session_id TEXT NOT NULL,
          run_id TEXT NOT NULL DEFAULT '',
          origin_kind TEXT NOT NULL DEFAULT 'chat_run',
          evidence_json TEXT NOT NULL,
          evidence_hash TEXT NOT NULL,
          valid_session INTEGER NOT NULL DEFAULT 0,
          behavior_change INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          UNIQUE(observation_window_key, session_id)
        );
        CREATE INDEX IF NOT EXISTS reflection_observations_window
          ON reflection_observations(observation_window_key, created_at);
        CREATE INDEX IF NOT EXISTS reflection_observations_scope
          ON reflection_observations(account_id,chat_key,observer_id,created_at DESC);

        CREATE TABLE IF NOT EXISTS reflection_worker_state (
          singleton INTEGER PRIMARY KEY CHECK(singleton=1),
          generation INTEGER NOT NULL DEFAULT 0,
          lease_owner TEXT NOT NULL DEFAULT '',
          lease_generation INTEGER NOT NULL DEFAULT 0,
          lease_expires_at INTEGER NOT NULL DEFAULT 0,
          stop_requested INTEGER NOT NULL DEFAULT 0,
          stop_reason TEXT NOT NULL DEFAULT '',
          calls_day TEXT NOT NULL DEFAULT '',
          calls_count INTEGER NOT NULL DEFAULT 0,
          budget_blocked_until INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO reflection_worker_state
          (singleton,generation,updated_at) VALUES (1,0,0);

        CREATE TABLE IF NOT EXISTS reflection_batches (
          id TEXT PRIMARY KEY,
          job_id TEXT NOT NULL UNIQUE,
          account_id TEXT NOT NULL,
          mode TEXT NOT NULL CHECK(mode IN ('review','bounded_auto')),
          status TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          output_json TEXT NOT NULL,
          evidence_json TEXT NOT NULL,
          base_persona_hash TEXT NOT NULL,
          expected_profile_revision INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          reviewed_at INTEGER NOT NULL DEFAULT 0,
          reviewer TEXT NOT NULL DEFAULT '',
          applied_profile_revision INTEGER NOT NULL DEFAULT 0,
          error_code TEXT NOT NULL DEFAULT '',
          error_message TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS reflection_batches_status
          ON reflection_batches(status, created_at);

        CREATE TABLE IF NOT EXISTS reflection_proposals (
          id TEXT PRIMARY KEY,
          batch_id TEXT NOT NULL,
          job_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          proposal_type TEXT NOT NULL CHECK(proposal_type IN ('note','trait')),
          item_index INTEGER NOT NULL,
          risk TEXT NOT NULL CHECK(risk IN ('low','high')),
          scope TEXT NOT NULL DEFAULT '',
          chat_key TEXT NOT NULL DEFAULT '',
          payload_json TEXT NOT NULL,
          evidence_refs_json TEXT NOT NULL DEFAULT '[]',
          base_persona_hash TEXT NOT NULL,
          expected_profile_revision INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          reviewed_at INTEGER NOT NULL DEFAULT 0,
          applied_at INTEGER NOT NULL DEFAULT 0,
          reviewer TEXT NOT NULL DEFAULT '',
          applier TEXT NOT NULL DEFAULT '',
          error_code TEXT NOT NULL DEFAULT '',
          error_message TEXT NOT NULL DEFAULT '',
          UNIQUE(batch_id,proposal_type,item_index)
        );
        CREATE INDEX IF NOT EXISTS reflection_proposals_status
          ON reflection_proposals(status, created_at);

        CREATE TABLE IF NOT EXISTS reflection_candidates (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          chat_key TEXT NOT NULL,
          scope TEXT NOT NULL CHECK(scope='chat'),
          subject TEXT NOT NULL,
          trait_key TEXT NOT NULL,
          trait_value TEXT NOT NULL,
          action TEXT NOT NULL CHECK(action IN ('set','remove')),
          support_refs_json TEXT NOT NULL DEFAULT '[]',
          counter_refs_json TEXT NOT NULL DEFAULT '[]',
          policy_version TEXT NOT NULL DEFAULT 'reflection-candidate-v1',
          status TEXT NOT NULL,
          reason TEXT NOT NULL DEFAULT '',
          latest_proposal_id TEXT NOT NULL DEFAULT '',
          latest_batch_id TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          last_observed_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS reflection_candidates_scope
          ON reflection_candidates(account_id,chat_key,status,expires_at,last_observed_at DESC);

        CREATE TABLE IF NOT EXISTS reflection_feedback (
          feedback_id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          chat_key TEXT NOT NULL,
          source_ref TEXT NOT NULL,
          target_source_ref TEXT NOT NULL,
          action TEXT NOT NULL CHECK(action IN ('confirm','correct','retract')),
          value TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS learned_self_versions (
          account_id TEXT NOT NULL,
          revision INTEGER NOT NULL,
          parent_revision INTEGER NOT NULL DEFAULT 0,
          profile_json TEXT NOT NULL,
          evidence_json TEXT NOT NULL DEFAULT '[]',
          base_persona_hash TEXT NOT NULL,
          applied_by TEXT NOT NULL,
          source_json TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL,
          PRIMARY KEY(account_id, revision)
        );
        CREATE TABLE IF NOT EXISTS learned_self_heads (
          account_id TEXT PRIMARY KEY,
          revision INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS reflection_audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id TEXT NOT NULL DEFAULT '',
          job_id TEXT NOT NULL DEFAULT '',
          event TEXT NOT NULL,
          code TEXT NOT NULL DEFAULT '',
          message TEXT NOT NULL DEFAULT '',
          details_json TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL
        );
      `);
      ensureColumn(this.db, 'reflection_worker_state', 'budget_blocked_until',
        'INTEGER NOT NULL DEFAULT 0');
    } else {
      this.db.exec('PRAGMA busy_timeout=5000;');
    }
    if (!this.readOnly) {
      for (const suffix of ['', '-wal', '-shm']) {
        try { fs.chmodSync(`${this.filename}${suffix}`, 0o600); } catch { /* best effort */ }
      }
    }
    return this;
  }

  close() {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }

  #requireDb() {
    if (!this.db) fail('REFLECTION_DISABLED', 'self-evolution Reflection is not enabled');
    return this.db;
  }

  #jobsPresent;

  /**
   * 反思作业表已从产品中移除。这里统一探测一次，让旧调用方在表缺失时拿到
   * 安全的空结果，而不是让整个反思/记忆链路在启动时崩掉。
   */
  #jobsAvailable() {
    if (this.#jobsPresent === undefined) {
      try {
        this.#jobsPresent = Boolean(this.#requireDb().prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='reflection_jobs'"
        ).get());
      } catch {
        this.#jobsPresent = false;
      }
    }
    return this.#jobsPresent === true;
  }

  #requireWritable() {
    const db = this.#requireDb();
    if (this.readOnly) fail('REFLECTION_READ_ONLY', 'Reflection is read-only');
    return db;
  }

  #transaction(fn) {
    const db = this.#requireWritable();
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn(db);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* preserve the original error */ }
      throw error;
    }
  }

  #audit(db, {
    accountId = '',
    jobId = '',
    event,
    code = '',
    message = '',
    details = {},
    ts = nowValue(this.now)
  }) {
    db.prepare(`
      INSERT INTO reflection_audit
        (account_id,job_id,event,code,message,details_json,created_at)
      VALUES (?,?,?,?,?,?,?)
    `).run(
      String(accountId || ''),
      String(jobId || ''),
      String(event || ''),
      String(code || '').slice(0, 120),
      String(message || '').slice(0, 500),
      safeJson(details),
      ts
    );
  }

  #attachTraitEvidencePool(db, evidence, ts) {
    const empty = {
      ...evidence,
      traitEvidencePool: [],
      traitGate: traitEvidenceGate({
        ...evidence,
        traitEvidencePool: [],
        currentUserSourceRefs: evidence.currentUserSourceRefs || []
      }, this.limits)
    };
    if (evidence.evidenceVersion < 3 || !evidence.chatKey || !evidence.interactionId) {
      return empty;
    }
    const cutoff = Math.max(0, ts - this.limits.traitEvidenceWindowMs);
    const rows = db.prepare(`
      SELECT evidence_json,created_at,id FROM reflection_observations
      WHERE account_id=? AND chat_key=? AND observer_id=? AND created_at>=?
      ORDER BY created_at DESC,id DESC LIMIT ?
    `).all(
      evidence.accountId,
      evidence.chatKey,
      evidence.observerId,
      cutoff,
      Math.max(100, this.limits.maxTraitEvidenceInteractions * 8)
    ).map((row) => ({
      observation: parseJson(row.evidence_json, {}),
      createdAt: Number(row.created_at) || 0,
      id: String(row.id || '')
    })).sort((left, right) => {
      const leftCurrent = left.observation.interactionId === evidence.interactionId ? 1 : 0;
      const rightCurrent = right.observation.interactionId === evidence.interactionId ? 1 : 0;
      return rightCurrent - leftCurrent || right.createdAt - left.createdAt || right.id.localeCompare(left.id);
    });
    const byRoot = new Map();
    const interactions = new Set();
    for (const row of rows) {
      const observation = row.observation;
      if (Number(observation.evidenceVersion) < 3
        || Number(observation.schemaVersion) < 3
        || observation.structuredEvidence !== true
        || observation.proactive === true
        || (Array.isArray(observation.invalidEvidenceKinds) && observation.invalidEvidenceKinds.length > 0)) {
        continue;
      }
      for (const item of (Array.isArray(observation.conversationEvidence)
        ? observation.conversationEvidence : [])) {
        if (item.userEvidence !== true
          || Number(item.schemaVersion) < 3
          || item.role !== 'user'
          || item.sourceRecordType !== 'message'
          || !item.sourceRecordId
          || !item.originalSourceId
          || !item.interactionId
          || String(item.accountId || observation.accountId || '') !== evidence.accountId
          || String(item.chatKey || observation.chatKey || '') !== evidence.chatKey) continue;
        const interactionId = String(item.interactionId);
        if (!interactions.has(interactionId)
          && interactions.size >= this.limits.maxTraitEvidenceInteractions) continue;
        interactions.add(interactionId);
        const rootId = String(item.originalSourceId);
        const identity = `${interactionId}:${rootId}`;
        if (!byRoot.has(identity)) {
          byRoot.set(identity, {
            ...item,
            accountId: evidence.accountId,
            chatKey: evidence.chatKey,
            schemaVersion: Number(observation.schemaVersion),
            evidenceVersion: Number(observation.evidenceVersion),
            interactionId,
            sourceRef: String(item.sourceRef || '').slice(0, 420),
            proactive: false,
            completedAt: Number(observation.completedAt) || row.createdAt
          });
        }
      }
    }
    const pool = [...byRoot.values()];
    const assemble = () => {
      const evidenceIds = [...new Set([
        ...(Array.isArray(evidence.evidenceIds) ? evidence.evidenceIds : []),
        ...pool.map((item) => String(item.sourceRef || '')).filter(Boolean)
      ])];
      const withPool = { ...evidence, traitEvidencePool: [...pool], evidenceIds };
      return { ...withPool, traitGate: traitEvidenceGate(withPool, this.limits) };
    };
    let result = assemble();
    // Optional historical trait support must not block a new, otherwise bounded episode.
    while (pool.length && safeJson(result).length > this.limits.maxEvidenceChars) {
      pool.pop();
      result = assemble();
    }
    return result;
  }

  #applyStructuredFeedback(db, evidence, feedback, ts) {
    const reject = (reason) => {
      this.#audit(db, {
        accountId: evidence.accountId,
        event: 'explicit-trait-feedback-rejected',
        code: 'REFLECTION_FEEDBACK_INVALID',
        message: reason,
        details: {
          feedbackId: feedback.feedbackId,
          sourceRef: feedback.sourceRef,
          targetSourceRef: feedback.targetSourceRef,
          action: feedback.action,
          actor: 'host-explicit-feedback'
        },
        ts
      });
      return false;
    };
    const source = (evidence.conversationEvidence || []).find((item) => (
      item.role === 'user'
      && item.userEvidence === true
      && item.sourceRef === feedback.sourceRef
      && item.chatKey === evidence.chatKey
      && item.accountId === evidence.accountId
    ));
    if (evidence.schemaVersion < 3 || evidence.evidenceVersion < 3
      || !source || !source.senderId) {
      return reject('current user source is missing or unverified');
    }
    const inserted = db.prepare(`
      INSERT OR IGNORE INTO reflection_feedback (
        feedback_id,account_id,chat_key,source_ref,target_source_ref,action,value,status,created_at
      ) VALUES (?,?,?,?,?,?,?,'pending',?)
    `).run(
      feedback.feedbackId,
      evidence.accountId,
      evidence.chatKey,
      feedback.sourceRef,
      feedback.targetSourceRef,
      feedback.action,
      feedback.value,
      ts
    ).changes;
    if (!inserted) return false;

    const [targetKind, targetId] = String(feedback.targetSourceRef).split(/:(.*)/s, 2);
    let candidate = null;
    let traitKey = '';
    if (targetKind === 'candidate') {
      candidate = db.prepare(`
        SELECT * FROM reflection_candidates
        WHERE id=? AND account_id=? AND chat_key=?
      `).get(targetId, evidence.accountId, evidence.chatKey);
      if (!candidate || candidate.subject !== `user:${source.senderId}` || candidate.scope !== 'chat') {
        db.prepare("UPDATE reflection_feedback SET status='rejected' WHERE feedback_id=?")
          .run(feedback.feedbackId);
        return reject('candidate target is missing, out of scope, or has another subject');
      }
      traitKey = String(candidate.trait_key);
    } else if (targetKind === 'trait') {
      traitKey = String(targetId || '');
    } else {
      db.prepare("UPDATE reflection_feedback SET status='rejected' WHERE feedback_id=?")
        .run(feedback.feedbackId);
      return reject('unsupported feedback target');
    }

    const headRevision = this.#headRevision(db, evidence.accountId);
    const head = headRevision > 0
      ? db.prepare(`SELECT * FROM learned_self_versions WHERE account_id=? AND revision=?`)
        .get(evidence.accountId, headRevision)
      : null;
    const baseHash = String(head?.base_persona_hash || hashBasePersona({}));
    const profile = normalizeProfile(parseJson(head?.profile_json, emptyProfile()));
    const bucket = profile.chats[evidence.chatKey] || {};
    const userSubject = `user:${source.senderId}`;
    const storageKey = resolveTraitStorageKey(bucket, traitKey, userSubject);
    const existing = storageKey ? bucket[storageKey] : undefined;
    const existingSubject = plainObject(existing) ? String(existing.subject || '') : '';
    const adoptedForSubject = existing && existingSubject === userSubject;
    if (feedback.action !== 'confirm' && candidate) {
      db.prepare(`
        UPDATE reflection_candidates SET status='rejected',reason='explicit-correction'
        WHERE id=? AND account_id=?
      `).run(candidate.id, evidence.accountId);
      if (!adoptedForSubject) {
        db.prepare("UPDATE reflection_feedback SET status='recorded' WHERE feedback_id=?")
          .run(feedback.feedbackId);
        this.#audit(db, {
          accountId: evidence.accountId,
          event: 'explicit-trait-feedback-recorded',
          details: {
            feedbackId: feedback.feedbackId,
            targetSourceRef: feedback.targetSourceRef,
            action: feedback.action,
            actor: 'host-explicit-feedback',
            status: 'candidate-corrected-without-adopted-trait'
          },
          ts
        });
        return true;
      }
    }
    if (!adoptedForSubject && feedback.action === 'confirm') {
      if (!candidate) return reject('trait target is not an adopted user-subject trait');
      const refs = parseJson(candidate.support_refs_json, []);
      const supportRefs = [...new Set([
        ...(Array.isArray(refs) ? refs : []),
        feedback.sourceRef
      ])].slice(-100);
      db.prepare(`
        UPDATE reflection_candidates SET support_refs_json=?,last_observed_at=?,expires_at=?
        WHERE id=? AND account_id=?
      `).run(safeJson(supportRefs), ts, ts + this.limits.traitTtlMs, candidate.id, evidence.accountId);
      const updated = db.prepare('SELECT * FROM reflection_candidates WHERE id=?').get(candidate.id);
      const view = this.#candidateView(db, updated, headRevision);
      db.prepare(`
        UPDATE reflection_candidates SET status=?,reason=?
        WHERE id=? AND status NOT IN ('adopted','rejected','expired','stale')
      `).run(view.eligible ? 'ready' : 'pending_insufficient', view.reason, candidate.id);
    } else if (adoptedForSubject) {
      if (feedback.action === 'confirm') {
        const next = normalizeStoredTrait(existing, {
          scope: 'chat',
          chatKey: evidence.chatKey,
          key: traitKey,
          storageKey,
          now: ts
        });
        const evidenceRefs = [...new Set([...next.evidenceRefs, feedback.sourceRef])].slice(-32);
        bucket[storageKey] = {
          ...next,
          key: traitKey,
          storageKey,
          subject: userSubject,
          evidenceRefs,
          evidenceCount: evidenceRefs.length,
          lastObservedAt: ts
        };
      } else if (feedback.action === 'retract') {
        delete bucket[storageKey];
      } else {
        bucket[storageKey] = {
          ...normalizeStoredTrait(existing, {
            scope: 'chat',
            chatKey: evidence.chatKey,
            key: traitKey,
            storageKey,
            now: ts
          }),
          key: traitKey,
          storageKey,
          subject: userSubject,
          value: feedback.value,
          evidenceRefs: [feedback.sourceRef],
          evidenceCount: 1,
          lastObservedAt: ts,
          expiresAt: ts + this.limits.traitTtlMs
        };
      }
      const nextRevision = headRevision + 1;
      db.prepare(`
        INSERT INTO learned_self_versions (
          account_id,revision,parent_revision,profile_json,evidence_json,
          base_persona_hash,applied_by,source_json,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?)
      `).run(
        evidence.accountId,
        nextRevision,
        headRevision,
        safeJson(profile),
        safeJson([feedback]),
        baseHash,
        'host-explicit-feedback',
        safeJson([{
          kind: 'explicit-feedback',
          feedbackId: feedback.feedbackId,
          sourceRef: feedback.sourceRef,
          targetSourceRef: feedback.targetSourceRef
        }]),
        ts
      );
      const changed = headRevision === 0
        ? db.prepare(`
            INSERT INTO learned_self_heads(account_id,revision,updated_at) VALUES (?,?,?)
            ON CONFLICT(account_id) DO NOTHING
          `).run(evidence.accountId, nextRevision, ts).changes
        : db.prepare(`
            UPDATE learned_self_heads SET revision=?,updated_at=?
            WHERE account_id=? AND revision=?
          `).run(nextRevision, ts, evidence.accountId, headRevision).changes;
      if (changed !== 1) fail('REFLECTION_CAS_CONFLICT', 'profile changed during explicit feedback');
    }
    db.prepare("UPDATE reflection_feedback SET status='recorded' WHERE feedback_id=?")
      .run(feedback.feedbackId);
    this.#audit(db, {
      accountId: evidence.accountId,
      event: 'explicit-trait-feedback-recorded',
      details: {
        feedbackId: feedback.feedbackId,
        sourceRef: feedback.sourceRef,
        targetSourceRef: feedback.targetSourceRef,
        action: feedback.action,
        actor: 'host-explicit-feedback',
        status: feedback.action === 'confirm' ? 'support-only' : 'profile-cas-revocation'
      },
      ts
    });
    return true;
  }

  enqueueObservation(event, {
    sourceKind = 'run_completion',
    observationWindowId = ''
  } = {}) {
    if (sourceKind !== 'run_completion') {
      fail('REFLECTION_SOURCE_LINEAGE', 'only host-verified run completion observations may enqueue jobs');
    }
    if (!this.#jobsAvailable()) return { enqueued: false, reason: 'jobs-removed' };
    const input = observationWindowId
      ? { ...event, observationWindowId }
      : event;
    const evidence = normalizeCompletionObservation(input);
    const observationKey = observationWindowKey(evidence, {
      windowMs: this.limits.observationWindowMs
    });
    const evidenceJson = safeJson(evidence);
    if (evidenceJson.length > this.limits.maxEvidenceChars) {
      fail('REFLECTION_LIMIT_EXCEEDED', 'completion evidence exceeds the reflection budget');
    }
    const evidenceHash = hash(stableJson(evidence));
    return this.#transaction((db) => {
      const ts = nowValue(this.now);
      const inserted = db.prepare(`
        INSERT OR IGNORE INTO reflection_observations (
          id,observation_window_key,observer_id,observer_plugin_id,account_id,chat_key,
          session_id,run_id,origin_kind,evidence_json,evidence_hash,valid_session,
          behavior_change,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        `refobs_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`,
        observationKey,
        evidence.observerId,
        evidence.observerPluginId,
        evidence.accountId,
        evidence.chatKey,
        evidence.sessionId,
        evidence.runId,
        evidence.originKind,
        evidenceJson,
        evidenceHash,
        evidence.validSession === true ? 1 : 0,
        evidence.behaviorChange === true ? 1 : 0,
        ts
      ).changes;
      if (inserted !== 1) {
        const existing = db.prepare(
          'SELECT * FROM reflection_jobs WHERE observation_key=?'
        ).get(observationKey);
        return { created: false, reason: 'duplicate', job: jobView(existing) };
      }
      for (const feedback of (Array.isArray(evidence.explicitFeedbacks)
        ? evidence.explicitFeedbacks : [])) {
        this.#applyStructuredFeedback(db, evidence, feedback, ts);
      }
      const existing = db.prepare(
        'SELECT * FROM reflection_jobs WHERE observation_key=?'
      ).get(observationKey);
      const rows = db.prepare(`
        SELECT * FROM reflection_observations
        WHERE observation_window_key=?
        ORDER BY created_at,id
      `).all(observationKey);
      const validSessionCount = rows.filter((row) => row.valid_session === 1).length;
      const behaviorChange = rows.some((row) => row.behavior_change === 1);
      const reflectableConversation = evidence.conversationEvidence.some((item) => (
        item.role === 'user' || (item.role === 'assistant' && item.delivered === true)
      ));
      if (!existing && evidence.evidenceVersion >= 3
        && !reflectableConversation && evidence.failureKinds.length === 0 && !behaviorChange) {
        this.#audit(db, {
          accountId: evidence.accountId,
          event: 'reflection-empty-evidence',
          code: 'REFLECTION_NO_EPISODE_EVIDENCE',
          message: 'completion had no human message, confirmed assistant delivery, or capability evidence',
          details: { interactionId: evidence.interactionId, triggerKind: evidence.triggerKind },
          ts
        });
        return { created: false, reason: 'no-reflectable-evidence', job: null };
      }
      if (existing) {
        if (existing.status === 'pending') {
          const aggregate = this.#attachTraitEvidencePool(
            db, aggregateObservations(rows, observationKey, this.limits), ts
          );
          const aggregateJson = safeJson(aggregate);
          if (aggregateJson.length > this.limits.maxEvidenceChars) {
            fail('REFLECTION_LIMIT_EXCEEDED',
              'aggregated completion evidence exceeds the reflection budget');
          }
          db.prepare(`
            UPDATE reflection_jobs
            SET evidence_json=?,evidence_hash=?,updated_at=?
            WHERE id=? AND status='pending'
          `).run(aggregateJson, hash(stableJson(aggregate)), ts, existing.id);
        }
        return {
          created: false,
          reason: existing.status === 'pending' ? 'aggregated' : 'duplicate-window',
          job: jobView(db.prepare('SELECT * FROM reflection_jobs WHERE id=?').get(existing.id)),
          validSessionCount,
          behaviorChange
        };
      }
      const aggregate = this.#attachTraitEvidencePool(
        db, aggregateObservations(rows, observationKey, this.limits), ts
      );
      const aggregateJson = safeJson(aggregate);
      if (aggregateJson.length > this.limits.maxEvidenceChars) {
        fail('REFLECTION_LIMIT_EXCEEDED',
          'aggregated completion evidence exceeds the reflection budget');
      }
      const id = `refjob_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
      db.prepare(`
        INSERT INTO reflection_jobs (
          id,observation_key,observer_id,observer_plugin_id,account_id,chat_key,
          session_id,run_id,plugin_generation,source_kind,evidence_json,evidence_hash,
          status,attempts,max_attempts,available_at,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pending',0,?,?,?,?)
      `).run(
        id,
        observationKey,
        aggregate.observerId,
        aggregate.observerPluginId,
        evidence.accountId,
        aggregate.chatKey,
        aggregate.sessionId,
        aggregate.runId,
        aggregate.pluginGeneration,
        aggregate.sourceKind,
        aggregateJson,
        hash(stableJson(aggregate)),
        this.limits.maxAttempts,
        ts,
        ts,
        ts
      );
      const job = jobView(db.prepare('SELECT * FROM reflection_jobs WHERE id=?').get(id));
      return { created: true, reason: null, job };
    });
  }

  hasProcessedEvidence({ accountId, observerId, evidenceHash } = {}) {
    if (!this.#jobsAvailable()) return false;
    const db = this.#requireDb();
    const row = db.prepare(`
      SELECT 1 FROM reflection_jobs
      WHERE account_id=? AND observer_id=? AND evidence_hash=?
        AND status IN ('noop','ready','applied','rejected')
      LIMIT 1
    `).get(String(accountId || ''), String(observerId || ''), String(evidenceHash || ''));
    return Boolean(row);
  }

  beginWorkerGeneration({ owner = '' } = {}) {
    return this.#transaction((db) => {
      const ts = nowValue(this.now);
      db.prepare(`
        UPDATE reflection_worker_state
        SET generation=generation+1,lease_owner='',lease_generation=0,lease_expires_at=0,
          stop_requested=0,stop_reason='',updated_at=?
        WHERE singleton=1
      `).run(ts);
      const row = db.prepare('SELECT * FROM reflection_worker_state WHERE singleton=1').get();
      this.#audit(db, { event: 'worker-generation', message: String(owner || ''),
        details: { generation: Number(row.generation) }, ts });
      return Number(row.generation);
    });
  }

  claimNextJob({
    owner,
    generation,
    leaseMs = this.limits.leaseMs,
    workerLeaseMs = this.limits.workerLeaseMs
  } = {}) {
    if (!this.#jobsAvailable()) return { status: 'jobs-removed', job: null };
    const worker = text(String(owner || ''), 'owner', 160);
    const generationValue = Number(generation);
    if (!Number.isSafeInteger(generationValue) || generationValue < 1) {
      fail('REFLECTION_INVALID_ARGUMENT', 'generation must be a positive integer');
    }
    return this.#transaction((db) => {
      const ts = nowValue(this.now);
      const state = db.prepare('SELECT * FROM reflection_worker_state WHERE singleton=1').get();
      if (Number(state.generation) !== generationValue) {
        return { status: 'stale-generation', job: null };
      }
      if (state.stop_requested === 1) return { status: 'stopped', job: null };
      if (Number(state.budget_blocked_until) > ts) {
        return {
          status: 'budget-blocked',
          job: null,
          budgetBlockedUntil: Number(state.budget_blocked_until)
        };
      }
      const held = String(state.lease_owner || '');
      const heldGeneration = Number(state.lease_generation) || 0;
      const expired = Number(state.lease_expires_at) <= ts;
      if (held && !expired && (held !== worker || heldGeneration !== generationValue)) {
        return { status: 'busy', job: null };
      }
      db.prepare(`
        UPDATE reflection_worker_state
        SET lease_owner=?,lease_generation=?,lease_expires_at=?,updated_at=?
        WHERE singleton=1
      `).run(worker, generationValue, ts + Math.max(1, Number(workerLeaseMs) || 1), ts);

      const exhausted = db.prepare(`
        SELECT id,account_id FROM reflection_jobs
        WHERE status='leased' AND lease_expires_at<=? AND attempts>=max_attempts
      `).all(ts);
      for (const row of exhausted) {
        db.prepare(`
          UPDATE reflection_jobs
          SET status='failed',lease_owner='',lease_generation=0,lease_token='',
            lease_expires_at=0,updated_at=?,completed_at=?,last_error=?
          WHERE id=? AND status='leased' AND lease_expires_at<=? AND attempts>=max_attempts
        `).run(
          ts,
          ts,
          'REFLECTION_ATTEMPTS_EXHAUSTED',
          row.id,
          ts
        );
        this.#audit(db, {
          accountId: row.account_id,
          jobId: row.id,
          event: 'job-failed',
          code: 'REFLECTION_ATTEMPTS_EXHAUSTED',
          message: 'expired reflection lease exhausted its attempt limit',
          ts
        });
      }

      const row = db.prepare(`
        SELECT * FROM reflection_jobs
        WHERE (
          (status IN ('pending','failed') AND attempts < max_attempts AND available_at<=?)
          OR (status='leased' AND lease_expires_at<=?)
        )
        ORDER BY created_at,id LIMIT 1
      `).get(ts, ts);
      if (!row) return { status: 'empty', job: null };
      const leaseToken = crypto.randomUUID();
      const changed = db.prepare(`
        UPDATE reflection_jobs
        SET status='leased',attempts=attempts+1,lease_owner=?,lease_generation=?,
          lease_token=?,lease_expires_at=?,updated_at=?,last_error=CASE WHEN ?='leased' THEN last_error ELSE '' END
        WHERE id=? AND (
          (status IN ('pending','failed') AND attempts < max_attempts AND available_at<=?)
          OR (status='leased' AND lease_expires_at<=?)
        )
      `).run(
        worker,
        generationValue,
        leaseToken,
        ts + Math.max(1, Number(leaseMs) || 1),
        ts,
        row.status,
        row.id,
        ts,
        ts
      ).changes;
      if (changed !== 1) return { status: 'contended', job: null };
      return {
        status: 'claimed',
        job: jobView(db.prepare('SELECT * FROM reflection_jobs WHERE id=?').get(row.id))
      };
    });
  }

  releaseWorkerLease({ owner, generation, reason = 'stopped' } = {}) {
    if (!this.#jobsAvailable()) return { released: false, at: 0 };
    return this.#transaction((db) => {
      const ts = nowValue(this.now);
      const ownerValue = String(owner || '');
      const generationValue = Number(generation) || 0;
      db.prepare(`
        UPDATE reflection_jobs
        SET status='pending',lease_owner='',lease_generation=0,lease_token='',lease_expires_at=0,
          available_at=?,updated_at=?
        WHERE status='leased' AND lease_owner=? AND lease_generation=?
      `).run(ts, ts, ownerValue, generationValue);
      db.prepare(`
        UPDATE reflection_worker_state
        SET lease_owner='',lease_generation=0,lease_expires_at=0,stop_requested=1,
          stop_reason=?,updated_at=?
        WHERE singleton=1 AND lease_owner=? AND lease_generation=?
      `).run(String(reason || 'stopped').slice(0, 200), ts, ownerValue, generationValue);
      return { released: true, at: ts };
    });
  }

  workerState() {
    const row = this.#requireDb().prepare('SELECT * FROM reflection_worker_state WHERE singleton=1').get();
    return {
      generation: Number(row?.generation) || 0,
      leaseOwner: String(row?.lease_owner || ''),
      leaseGeneration: Number(row?.lease_generation) || 0,
      leaseExpiresAt: Number(row?.lease_expires_at) || 0,
      stopRequested: row?.stop_requested === 1,
      stopReason: String(row?.stop_reason || ''),
      callsDay: String(row?.calls_day || ''),
      callsCount: Number(row?.calls_count) || 0,
      budgetBlockedUntil: Number(row?.budget_blocked_until) || 0
    };
  }

  consumeModelCallBudget({
    owner,
    generation,
    maxCallsPerDay = this.limits.maxCallsPerDay,
    dayKey = new Date(nowValue(this.now)).toISOString().slice(0, 10)
  } = {}) {
    return this.#transaction((db) => {
      const ts = nowValue(this.now);
      const state = db.prepare('SELECT * FROM reflection_worker_state WHERE singleton=1').get();
      if (Number(state.generation) !== Number(generation)
        || String(state.lease_owner || '') !== String(owner || '')
        || state.stop_requested === 1) {
        return { allowed: false, reason: 'stale-generation', calls: 0, blockedUntil: 0 };
      }
      const periodEnd = nextUtcPeriod(ts);
      const currentDay = String(state.calls_day || '');
      const currentCount = currentDay === String(dayKey) ? Number(state.calls_count) || 0 : 0;
      if (currentDay !== String(dayKey)) {
        db.prepare(`
          UPDATE reflection_worker_state
          SET calls_day=?,calls_count=0,budget_blocked_until=0,updated_at=?
          WHERE singleton=1
        `).run(String(dayKey), ts);
      } else if (Number(state.budget_blocked_until) > ts) {
        return {
          allowed: false,
          reason: 'budget-blocked',
          calls: currentCount,
          blockedUntil: Number(state.budget_blocked_until)
        };
      }
      if (currentCount >= Math.max(1, Number(maxCallsPerDay) || 1)) {
        db.prepare(`
          UPDATE reflection_worker_state
          SET budget_blocked_until=?,updated_at=? WHERE singleton=1
        `).run(periodEnd, ts);
        return {
          allowed: false,
          reason: 'budget-exhausted',
          calls: currentCount,
          blockedUntil: periodEnd
        };
      }
      const next = currentCount + 1;
      db.prepare(`
        UPDATE reflection_worker_state
        SET calls_day=?,calls_count=?,budget_blocked_until=0,updated_at=? WHERE singleton=1
      `).run(String(dayKey), next, ts);
      return { allowed: true, reason: null, calls: next, blockedUntil: 0 };
    });
  }

  completeNoop({ job, owner, generation, reason = 'no-new-evidence' } = {}) {
    return this.#finishJob({
      job,
      owner,
      generation,
      status: 'noop',
      error: reason
    });
  }

  failJob({ job, owner, generation, error = 'reflection failed' } = {}) {
    if (!this.#jobsAvailable()) return { accepted: false, reason: 'jobs-removed' };
    return this.#transaction((db) => {
      const ts = nowValue(this.now);
      const current = db.prepare('SELECT * FROM reflection_jobs WHERE id=?').get(String(job?.id || ''));
      if (!current || !this.#leaseMatches(current, {
        owner, generation, leaseToken: job?.leaseToken, ts
      })) {
        return { accepted: false, reason: 'stale-lease' };
      }
      const attempts = Number(current.attempts) || 0;
      const terminal = attempts >= Number(current.max_attempts);
      const status = terminal ? 'failed' : 'pending';
      const availableAt = terminal
        ? ts
        : ts + Math.max(0, this.limits.backoffMs) * Math.max(1, attempts);
      db.prepare(`
        UPDATE reflection_jobs
        SET status=?,lease_owner='',lease_generation=0,lease_token='',lease_expires_at=0,
          available_at=?,updated_at=?,last_error=?
        WHERE id=? AND status='leased' AND lease_owner=? AND lease_generation=? AND lease_token=?
      `).run(
        status,
        availableAt,
        ts,
        String(error?.message || error).slice(0, 500),
        current.id,
        String(owner || ''),
        Number(generation) || 0,
        String(job?.leaseToken || '')
      );
      this.#audit(db, {
        accountId: current.account_id,
        jobId: current.id,
        event: terminal ? 'job-failed' : 'job-retry',
        code: String(error?.code || ''),
        message: String(error?.message || error),
        details: { attempts },
        ts
      });
      return { accepted: true, status, attempts, availableAt };
    });
  }

  deferJob({
    job,
    owner,
    generation,
    reason = 'deferred',
    availableAt = nowValue(this.now)
  } = {}) {
    return this.#transaction((db) => {
      const ts = nowValue(this.now);
      const current = db.prepare('SELECT * FROM reflection_jobs WHERE id=?').get(String(job?.id || ''));
      if (!current || !this.#leaseMatches(current, {
        owner, generation, leaseToken: job?.leaseToken, ts
      })) {
        return { accepted: false, reason: 'stale-lease' };
      }
      const attempts = Math.max(0, Number(current.attempts) - 1);
      db.prepare(`
        UPDATE reflection_jobs
        SET status='pending',attempts=?,lease_owner='',lease_generation=0,lease_token='',lease_expires_at=0,
          available_at=?,updated_at=?,last_error=?
        WHERE id=? AND status='leased' AND lease_owner=? AND lease_generation=? AND lease_token=?
      `).run(
        attempts,
        Math.max(ts, Number(availableAt) || ts),
        ts,
        String(reason || '').slice(0, 500),
        current.id,
        String(owner || ''),
        Number(generation) || 0,
        String(job?.leaseToken || '')
      );
      this.#audit(db, {
        accountId: current.account_id,
        jobId: current.id,
        event: 'job-deferred',
        code: 'REFLECTION_BUDGET',
        message: String(reason || ''),
        details: { attempts },
        ts
      });
      return { accepted: true, status: 'pending', attempts };
    });
  }

  invalidateJob({ job, owner, generation, error, status = 'invalid' } = {}) {
    if (!this.#jobsAvailable()) return { accepted: false, reason: 'jobs-removed' };
    const finalStatus = status === 'stale' ? 'stale' : 'invalid';
    return this.#transaction((db) => {
      const ts = nowValue(this.now);
      const current = db.prepare('SELECT * FROM reflection_jobs WHERE id=?').get(String(job?.id || ''));
      if (!current || !this.#leaseMatches(current, {
        owner, generation, leaseToken: job?.leaseToken, ts
      })) {
        return { accepted: false, reason: 'stale-lease' };
      }
      db.prepare(`
        UPDATE reflection_jobs
        SET status=?,lease_owner='',lease_generation=0,lease_token='',lease_expires_at=0,
          updated_at=?,completed_at=?,last_error=?
        WHERE id=? AND status='leased' AND lease_owner=? AND lease_generation=? AND lease_token=?
      `).run(
        finalStatus,
        ts,
        ts,
        String(error?.message || error || '').slice(0, 500),
        current.id,
        String(owner || ''),
        Number(generation) || 0,
        String(job?.leaseToken || '')
      );
      this.#audit(db, {
        accountId: current.account_id,
        jobId: current.id,
        event: `${finalStatus}-job`,
        code: String(error?.code || ''),
        message: String(error?.message || error || ''),
        ts
      });
      return { accepted: true, status: finalStatus };
    });
  }

  commitReflectionResult({
    job,
    owner,
    generation,
    output,
    mode = 'review',
    basePersonaHash,
    basePersona,
    expectedProfileRevision,
    notebook = null
  } = {}) {
    const normalizedMode = validateMode(mode);
    const normalized = validateReflectionOutput(output, {
      evidence: job?.evidence,
      limits: this.limits
    });
    const baseHash = basePersonaHash || hashBasePersona(basePersona || {});
    if (!/^[a-f0-9]{64}$/.test(baseHash)) {
      fail('REFLECTION_INVALID_ARGUMENT', 'basePersonaHash is required');
    }
    const expectedRevision = Number(expectedProfileRevision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      fail('REFLECTION_INVALID_ARGUMENT', 'expectedProfileRevision must be a non-negative integer');
    }
    if (isEmptyOutput(normalized)) {
      return this.completeNoop({ job, owner, generation, reason: 'empty-reflection' });
    }
    return this.#transaction((db) => {
      const ts = nowValue(this.now);
      const current = db.prepare('SELECT * FROM reflection_jobs WHERE id=?').get(String(job?.id || ''));
      if (!current || !this.#leaseMatches(current, {
        owner, generation, leaseToken: job?.leaseToken, ts
      })) {
        return { accepted: false, reason: 'late-result', committed: false };
      }
      const headRevision = this.#headRevision(db, current.account_id);
      if (headRevision !== expectedRevision) {
        db.prepare(`
          UPDATE reflection_jobs SET status='stale',lease_owner='',lease_generation=0,lease_token='',
            lease_expires_at=0,updated_at=?,completed_at=?,last_error=?
          WHERE id=? AND status='leased' AND lease_owner=? AND lease_generation=? AND lease_token=?
        `).run(
          ts,
          ts,
          'profile revision changed after reflection started',
          current.id,
          String(owner || ''),
          Number(generation) || 0,
          String(job?.leaseToken || '')
        );
        this.#audit(db, {
          accountId: current.account_id,
          jobId: current.id,
          event: 'stale-proposal',
          code: 'REFLECTION_CAS_CONFLICT',
          message: 'profile revision changed after reflection started',
          ts
        });
        return { accepted: false, reason: 'cas-conflict', committed: false };
      }
      const batchId = `refbatch_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
      const rejectedItemCount = (normalized.rejectedNoteOperations || []).length
        + (normalized.rejectedTraitProposals || []).length;
      for (const rejected of normalized.rejectedNoteOperations || []) {
        this.#audit(db, {
          accountId: current.account_id,
          jobId: current.id,
          event: 'note-operation-rejected',
          code: rejected.code,
          message: rejected.reason,
          details: {
            index: rejected.index,
            status: 'rejected',
            actor: 'reflection-validator',
            evidenceRefs: rejected.evidenceRefs || []
          },
          ts
        });
      }
      for (const rejected of normalized.rejectedTraitProposals || []) {
        this.#audit(db, {
          accountId: current.account_id,
          jobId: current.id,
          event: 'trait-proposal-rejected',
          code: rejected.code,
          message: rejected.reason,
          details: {
            index: rejected.index,
            status: 'rejected',
            actor: 'reflection-validator',
            evidenceRefs: rejected.evidenceRefs || []
          },
          ts
        });
      }
      const allItems = [
        ...normalized.noteOperations.map((item, index) => ({
          type: 'note',
          itemIndex: index,
          risk: 'high',
          item
        })),
        ...normalized.traitProposals.map((item, index) => ({
          type: 'trait',
          itemIndex: index,
          risk: this.#traitRisk(item, current.evidence_json),
          item
        }))
      ];
      const batchStatus = allItems.length === 0
        ? rejectedItemCount > 0 ? 'rejected' : 'applied'
        : 'ready';
      db.prepare(`
        INSERT INTO reflection_batches (
          id,job_id,account_id,mode,status,summary,output_json,evidence_json,
          base_persona_hash,expected_profile_revision,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        batchId,
        current.id,
        current.account_id,
        normalizedMode,
        batchStatus,
        normalized.summary,
        safeJson(normalized),
        current.evidence_json,
        baseHash,
        expectedRevision,
        ts
      );
      const insertProposal = db.prepare(`
        INSERT INTO reflection_proposals (
          id,batch_id,job_id,account_id,proposal_type,item_index,risk,scope,chat_key,
          payload_json,evidence_refs_json,base_persona_hash,expected_profile_revision,
          status,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?)
      `);
      for (const entry of allItems) {
        if (entry.type !== 'trait') continue;
        const identity = {
          accountId: current.account_id,
          chatKey: entry.item.chatKey,
          scope: entry.item.scope,
          subject: entry.item.subject,
          key: entry.item.key,
          value: entry.item.value || ''
        };
        entry.item.candidateId ||= traitCandidateId(identity);
        const priorCandidate = db.prepare(
          'SELECT status,expires_at FROM reflection_candidates WHERE id=? AND account_id=?'
        ).get(entry.item.candidateId, current.account_id);
        if (priorCandidate && (
          ['rejected', 'expired', 'stale'].includes(String(priorCandidate.status))
          || Number(priorCandidate.expires_at) <= ts
        )) {
          const activeCycle = db.prepare(`
            SELECT id FROM reflection_candidates
            WHERE account_id=? AND chat_key=? AND scope=? AND subject=?
              AND trait_key=? AND trait_value=? AND action=?
              AND status IN ('ready','pending_insufficient') AND expires_at>?
            ORDER BY last_observed_at DESC,created_at DESC,id LIMIT 1
          `).get(
            identity.accountId, identity.chatKey, identity.scope, identity.subject,
            identity.key, identity.value, entry.item.action, ts
          );
          entry.item.candidateId = activeCycle?.id || traitCandidateId({
            ...identity,
            cycleInteractionId: String(job.evidence.interactionId || job.evidence.eventId || job.id)
          });
        }
      }
      const proposals = allItems.map((entry) => {
        const id = `refprop_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
        insertProposal.run(
          id,
          batchId,
          current.id,
          current.account_id,
          entry.type,
          entry.itemIndex,
          entry.risk,
          entry.item.scope || '',
          entry.item.chatKey || '',
          safeJson(entry.item),
          safeJson(entry.item.evidenceRefs || []),
          baseHash,
          expectedRevision,
          ts
        );
        return {
          ...entry,
          id,
          accountId: current.account_id,
          batchId,
          payload: entry.item,
          evidenceRefs: entry.item.evidenceRefs || [],
          basePersonaHash: baseHash
        };
      });
      for (const proposal of proposals.filter((entry) => entry.type === 'trait')) {
        this.#upsertTraitCandidate(db, proposal, job.evidence, ts);
      }
      const gapResult = this.#recordCapabilityGaps(db, current, normalized.capabilityGapProposals, ts);
      let profileRevision = headRevision;
      let appliedCount = 0;
      let invalidCount = 0;
      let appliedNoteCount = 0;
      let appliedTraitCount = 0;
      let rejectedCount = rejectedItemCount;
      let noopCount = 0;
      if (normalizedMode === 'bounded_auto') {
        const policyActor = `reflection:${owner}`;
        const noteProposals = proposals.filter((entry) => entry.type === 'note');
        for (const proposal of noteProposals) {
          try {
            this.#applyNoteProposal(db, proposal, {
              accountId: current.account_id,
              sessionId: job.evidence.sessionId,
              runId: job.evidence.runId,
              chatKey: job.evidence.chatKey,
              interactionId: job.evidence.interactionId,
              topicId: job.evidence.topicId,
              originalSourceId: job.evidence.originalSourceId,
              triggerKind: job.evidence.triggerKind,
              notebook,
              ts,
              actor: policyActor
            });
            appliedCount += 1;
            appliedNoteCount += 1;
          } catch (error) {
            const code = String(error?.code || 'REFLECTION_NOTE_APPLY_FAILED');
            const stale = code.includes('CAS') || code.includes('REVISION') || code.includes('ARCHIVED');
            const policyRejected = code === 'REFLECTION_NOTE_TELEMETRY'
              || code === 'REFLECTION_NOTE_NOT_DURABLE'
              || code === 'REFLECTION_NOTE_OPERATIONAL';
            db.prepare(`
              UPDATE reflection_proposals
              SET status=?,reviewed_at=?,reviewer=?,error_code=?,error_message=?
              WHERE id=? AND status='pending'
            `).run(
              stale ? 'stale' : policyRejected ? 'rejected' : 'invalid',
              ts,
              policyActor,
              code,
              String(error?.message || error).slice(0, 500),
              proposal.id
            );
            invalidCount += 1;
            rejectedCount += 1;
          }
        }
        const traitProposals = proposals.filter((entry) => entry.type === 'trait');
        if (traitProposals.length > 0) {
          this.#audit(db, {
            accountId: current.account_id,
            jobId: current.id,
            event: 'behavior-trait-review-required',
            code: 'REFLECTION_BEHAVIOR_REVIEW_REQUIRED',
            message: 'behavior traits remain pending for explicit human review',
            details: { batchId, proposals: traitProposals.length },
            ts
          });
        }
      }
      const remaining = db.prepare(`
        SELECT COUNT(*) AS n FROM reflection_proposals
        WHERE batch_id=? AND status='pending'
      `).get(batchId).n;
      const applied = db.prepare(`
        SELECT COUNT(*) AS n FROM reflection_proposals
        WHERE batch_id=? AND status='applied'
      `).get(batchId).n;
      const rejected = db.prepare(`
        SELECT COUNT(*) AS n FROM reflection_proposals
        WHERE batch_id=? AND status='rejected'
      `).get(batchId).n;
      const stale = db.prepare(`
        SELECT COUNT(*) AS n FROM reflection_proposals
        WHERE batch_id=? AND status='stale'
      `).get(batchId).n;
      const invalid = db.prepare(`
        SELECT COUNT(*) AS n FROM reflection_proposals
        WHERE batch_id=? AND status='invalid'
      `).get(batchId).n;
      let finalBatchStatus = rejectedItemCount > 0 && allItems.length === 0 ? 'rejected' : 'applied';
      if (remaining > 0) {
        finalBatchStatus = applied > 0 ? 'partially_applied' : batchStatus;
      } else if (appliedCount === 0 && noopCount > 0 && rejected === 0 && stale === 0 && invalid === 0) {
        finalBatchStatus = 'noop';
      } else if (appliedCount === 0 && (rejected > 0 || rejectedItemCount > 0)
        && stale === 0 && invalid === 0) {
        finalBatchStatus = 'rejected';
      } else if (appliedCount === 0 && stale > 0 && invalid === 0) {
        finalBatchStatus = 'stale';
      } else if (appliedCount === 0 && invalid > 0 && stale === 0) {
        finalBatchStatus = 'invalid';
      } else if (rejected > 0 || stale > 0 || invalid > 0) {
        finalBatchStatus = 'partially_applied';
      }
      const finalJobStatus = remaining > 0
        ? 'ready'
        : finalBatchStatus === 'noop'
          ? 'noop'
        : ['stale', 'invalid', 'rejected'].includes(finalBatchStatus)
          ? finalBatchStatus
          : 'applied';
      db.prepare(`
        UPDATE reflection_batches
        SET status=?,applied_profile_revision=? WHERE id=?
      `).run(finalBatchStatus, profileRevision, batchId);
      db.prepare(`
        UPDATE reflection_jobs
        SET status=?,lease_owner='',lease_generation=0,lease_token='',lease_expires_at=0,
          updated_at=?,completed_at=?,last_error=''
        WHERE id=? AND status='leased' AND lease_owner=? AND lease_generation=? AND lease_token=?
      `).run(
        finalJobStatus,
        ts,
        ts,
        current.id,
        String(owner || ''),
        Number(generation) || 0,
        String(job?.leaseToken || '')
      );
      this.#audit(db, {
        accountId: current.account_id,
        jobId: current.id,
        event: 'reflection-committed',
        details: {
          batchId,
          mode: normalizedMode,
          proposals: proposals.length,
          applied: appliedCount,
          appliedNoteCount,
          appliedTraitCount,
          rejectedCount,
          noopCount,
          profileRevisionBefore: headRevision,
          profileRevisionAfter: profileRevision,
          invalid: invalidCount,
          gaps: gapResult.upserted
        },
        ts
      });
      return {
        accepted: true,
        committed: true,
        batchId,
        jobStatus: finalJobStatus,
        batchStatus: finalBatchStatus,
        profileRevision,
        appliedNoteCount,
        appliedTraitCount,
        rejectedCount,
        noopCount,
        profileRevisionBefore: headRevision,
        profileRevisionAfter: profileRevision,
        proposalIds: proposals.map((entry) => entry.id),
        gapIds: gapResult.ids
      };
    });
  }

  getBatch(batchId) {
    const db = this.#requireDb();
    return batchView(db.prepare('SELECT * FROM reflection_batches WHERE id=?').get(String(batchId || '')));
  }

  listProposals({ batchId = '', accountId = '', status = '', limit = 100 } = {}) {
    const db = this.#requireDb();
    const filters = [];
    const params = [];
    if (batchId) {
      filters.push('batch_id=?');
      params.push(String(batchId));
    }
    if (accountId) {
      filters.push('account_id=?');
      params.push(String(accountId));
    }
    if (status) {
      filters.push('status=?');
      params.push(validateProposalStatus(String(status)));
    }
    const max = Math.min(500, Math.max(1, Number(limit) || 100));
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    return db.prepare(`
      SELECT * FROM reflection_proposals ${where}
      ORDER BY created_at, batch_id, proposal_type, item_index LIMIT ?
    `).all(...params, max).map(proposalView);
  }

  /**
   * P7 管理端按 id 取单条提案（含所属 batchId），仅限调用方给定的账号命名空间。
   * 读-only：不写审计、不改状态。
   */
  getProposal({ proposalId, accountId = '' } = {}) {
    const db = this.#requireDb();
    const id = String(proposalId || '');
    if (!id) return null;
    const row = accountId
      ? db.prepare('SELECT * FROM reflection_proposals WHERE id=? AND account_id=?')
        .get(id, String(accountId))
      : db.prepare('SELECT * FROM reflection_proposals WHERE id=?').get(id);
    return proposalView(row);
  }

  listCandidates({
    accountId: rawAccount,
    chatKey: rawChatKey = '',
    status = 'pending',
    limit = 100
  } = {}) {
    const db = this.#requireDb();
    const account = text(String(rawAccount || ''), 'accountId', 100);
    const candidateTable = db.prepare(`
      SELECT 1 AS present FROM sqlite_master
      WHERE type='table' AND name='reflection_candidates'
    `).get();
    if (!candidateTable) return [];
    const currentChat = rawChatKey ? text(String(rawChatKey), 'chatKey', 100) : '';
    if (currentChat && !/^(group|private):\d+$/.test(currentChat)) {
      fail('REFLECTION_INVALID_ARGUMENT', 'chatKey must be group:<QQ> or private:<QQ>');
    }
    const filters = ['account_id=?'];
    const params = [account];
    if (currentChat) {
      filters.push('chat_key=?');
      params.push(currentChat);
    }
    if (status) {
      const selected = String(status);
      if (!['pending', 'pending_insufficient', 'ready', 'adopted', 'rejected', 'expired', 'stale'].includes(selected)) {
        fail('REFLECTION_INVALID_ARGUMENT', 'unsupported candidate status');
      }
      if (selected === 'pending') filters.push("status IN ('pending_insufficient','ready')");
      else {
        filters.push('status=?');
        params.push(selected);
      }
    }
    const rows = db.prepare(`
      SELECT * FROM reflection_candidates
      WHERE ${filters.join(' AND ')}
      ORDER BY last_observed_at DESC,id LIMIT ?
    `).all(...params, Math.min(500, Math.max(1, Number(limit) || 100)));
    const currentProfileRevision = this.#headRevision(db, account);
    return rows.map((row) => this.#candidateView(db, row, currentProfileRevision));
  }

  reviewCandidate({
    proposalId,
    decision,
    actor = '',
    expectedProfileRevision,
    basePersonaHash,
    basePersona
  } = {}) {
    const action = String(decision || '').toLowerCase();
    if (!['approve', 'reject'].includes(action)) {
      fail('REFLECTION_INVALID_ARGUMENT', 'decision must be approve or reject');
    }
    const reviewer = text(String(actor || ''), 'actor', 160);
    const proposal = this.getProposal({ proposalId });
    if (!proposal || proposal.type !== 'trait') {
      fail('REFLECTION_NOT_FOUND', 'trait proposal not found');
    }
    const candidateId = String(proposal.payload?.candidateId || '');
    const db = this.#requireWritable();
    const row = candidateId
      ? db.prepare('SELECT * FROM reflection_candidates WHERE id=? AND account_id=?')
        .get(candidateId, proposal.accountId)
      : null;
    if (!row) fail('REFLECTION_NOT_FOUND', 'trait candidate not found');
    const currentBaseHash = basePersonaHash || hashBasePersona(basePersona || {});
    const expectedRevision = Number(expectedProfileRevision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      fail('REFLECTION_INVALID_ARGUMENT', 'expectedProfileRevision must be a non-negative integer');
    }
    return this.#transaction((innerDb) => {
      const ts = nowValue(this.now);
      const currentRow = innerDb.prepare(
        'SELECT * FROM reflection_candidates WHERE id=? AND account_id=?'
      ).get(candidateId, proposal.accountId);
      if (!currentRow || currentRow.status === 'adopted' || currentRow.status === 'rejected') {
        return { reviewed: false, reason: currentRow?.status || 'not-found' };
      }
      if (Number(currentRow.expires_at) <= ts) {
        innerDb.prepare("UPDATE reflection_candidates SET status='expired',reason='expired' WHERE id=?")
          .run(candidateId);
        innerDb.prepare(`
          UPDATE reflection_proposals SET status='stale',reviewed_at=?,reviewer=?,
            error_code='REFLECTION_CANDIDATE_EXPIRED',error_message='candidate TTL expired'
          WHERE id=? AND account_id=? AND status='pending'
        `).run(ts, reviewer, String(proposalId), proposal.accountId);
        return { reviewed: false, reason: 'expired' };
      }
      const headRevision = this.#headRevision(innerDb, proposal.accountId);
      if (headRevision !== expectedRevision) {
        return { reviewed: false, reason: 'cas-conflict', currentProfileRevision: headRevision };
      }
      const batch = batchView(innerDb.prepare(
        'SELECT * FROM reflection_batches WHERE id=? AND account_id=?'
      ).get(proposal.batchId, proposal.accountId));
      if (!batch || batch.basePersonaHash !== currentBaseHash) {
        innerDb.prepare("UPDATE reflection_candidates SET status='stale',reason='base-persona-changed' WHERE id=?")
          .run(candidateId);
        return { reviewed: false, reason: 'base-persona-changed' };
      }
      if (batch.expectedProfileRevision !== headRevision) {
        innerDb.prepare("UPDATE reflection_candidates SET status='stale',reason='profile-changed-after-proposal' WHERE id=?")
          .run(candidateId);
        innerDb.prepare(`
          UPDATE reflection_proposals SET status='stale',reviewed_at=?,reviewer=?,
            error_code='REFLECTION_CAS_CONFLICT',error_message='profile changed after proposal'
          WHERE id=? AND account_id=? AND status='pending'
        `).run(ts, reviewer, String(proposalId), proposal.accountId);
        return {
          reviewed: false,
          reason: 'stale',
          currentProfileRevision: headRevision
        };
      }
      const view = this.#candidateView(innerDb, currentRow, headRevision);
      if (action === 'reject') {
        innerDb.prepare(`
          UPDATE reflection_candidates SET status='rejected',reason='human-rejected'
          WHERE id=?
        `).run(candidateId);
        innerDb.prepare(`
          UPDATE reflection_proposals SET status='rejected',reviewed_at=?,reviewer=?,
            error_code='',error_message='human rejected candidate'
          WHERE id=? AND account_id=? AND status='pending'
        `).run(ts, reviewer, String(proposalId), proposal.accountId);
        this.#audit(innerDb, {
          accountId: proposal.accountId,
          jobId: proposal.jobId,
          event: 'trait-candidate-rejected',
          details: { candidateId, proposalId, actor: reviewer },
          ts
        });
        return { reviewed: true, decision: 'reject', candidateId, status: 'rejected' };
      }
      if (!view.eligible) {
        innerDb.prepare(`
          UPDATE reflection_candidates SET status='pending_insufficient',reason=?
          WHERE id=?
        `).run(view.reason, candidateId);
        return {
          reviewed: false,
          reason: view.reason,
          candidateId,
          currentProfileRevision: headRevision
        };
      }
      const payload = proposal.payload;
      const synthetic = {
        id: String(proposalId),
        payload: {
          ...payload,
          evidenceRefs: view.supportRefs,
          supportRefs: view.supportRefs,
          counterRefs: view.counterRefs
        },
        evidenceRefs: view.supportRefs,
        basePersonaHash: currentBaseHash
      };
      const applied = this.#applyTraitProposals(innerDb, {
        accountId: proposal.accountId,
        proposals: [synthetic],
        baseHash: currentBaseHash,
        expectedRevision,
        actor: reviewer,
        source: {
          kind: 'reflection-candidate-review',
          candidateId,
          sourceChatKeys: [String(currentRow.chat_key)]
        },
        ts
      });
      if (!applied.applied && !applied.nooped) {
        innerDb.prepare("UPDATE reflection_candidates SET status='stale',reason='profile-cas-conflict' WHERE id=?")
          .run(candidateId);
        return {
          reviewed: false,
          reason: 'profile-cas-conflict',
          candidateId,
          currentProfileRevision: applied.profileRevision
        };
      }
      innerDb.prepare(`
        UPDATE reflection_candidates SET status='adopted',reason=''
        WHERE id=? AND account_id=?
      `).run(candidateId, proposal.accountId);
      this.#audit(innerDb, {
        accountId: proposal.accountId,
        jobId: proposal.jobId,
        event: 'trait-candidate-adopted',
        details: {
          candidateId,
          proposalId,
          actor: reviewer,
          profileRevision: applied.profileRevision,
          supportRefs: view.supportRefs,
          counterRefs: view.counterRefs
        },
        ts
      });
      return {
        reviewed: true,
        decision: 'approve',
        candidateId,
        applied: applied.applied,
        profileRevision: applied.profileRevision
      };
    });
  }

  listJobs() {
    // 反思作业表已从产品与数据库移除；保留空实现以兼容旧的只读调用方。
    this.#requireDb();
    return [];
  }

  reviewBatch({
    batchId,
    decision,
    actor = '',
    expectedProfileRevision,
    basePersonaHash,
    basePersona,
    notebook = null
  } = {}) {
    const action = String(decision || '').toLowerCase();
    if (!['approve', 'reject'].includes(action)) {
      fail('REFLECTION_INVALID_ARGUMENT', 'decision must be approve or reject');
    }
    const reviewer = text(String(actor || ''), 'actor', 160);
    const currentBaseHash = basePersonaHash || hashBasePersona(basePersona || {});
    const expectedRevision = Number(expectedProfileRevision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      fail('REFLECTION_INVALID_ARGUMENT', 'expectedProfileRevision must be a non-negative integer');
    }
    const db = this.#requireWritable();
    const batch = batchView(db.prepare(
      'SELECT * FROM reflection_batches WHERE id=?'
    ).get(String(batchId || '')));
    if (!batch) fail('REFLECTION_NOT_FOUND', 'reflection batch not found');
    if (['applied', 'rejected', 'stale', 'invalid'].includes(batch.status)) {
      return { reviewed: false, reason: batch.status, batch };
    }
    if (batch.basePersonaHash !== currentBaseHash) {
      return this.#markBatchStale(batchId,
        'Base Persona changed after reflection was produced',
        'REFLECTION_BASE_PERSONA_CHANGED');
    }
    const headRevision = this.#headRevision(db, batch.accountId);
    if (headRevision !== expectedRevision || batch.expectedProfileRevision !== expectedRevision) {
      return this.#markBatchStale(batchId,
        'Learned Self revision changed after reflection was produced',
        'REFLECTION_CAS_CONFLICT');
    }
    if (action === 'reject') {
      return this.#rejectBatch(db, batch, reviewer);
    }
    const proposals = this.listProposals({ batchId: batch.id, status: 'pending', limit: 500 });
    return this.#transaction((innerDb) => {
      const ts = nowValue(this.now);
      const noteProposals = proposals.filter((proposal) => proposal.type === 'note');
      const traitProposals = proposals.filter((proposal) => proposal.type === 'trait');
      for (const proposal of noteProposals) {
        try {
          this.#applyNoteProposal(innerDb, proposal, {
            accountId: batch.accountId,
            sessionId: batch.evidence.sessionId,
            runId: batch.evidence.runId,
            chatKey: batch.evidence.chatKey,
            interactionId: batch.evidence.interactionId,
            topicId: batch.evidence.topicId,
            originalSourceId: batch.evidence.originalSourceId,
            triggerKind: batch.evidence.triggerKind,
            notebook,
            ts,
            actor: reviewer
          });
        } catch (error) {
          const code = String(error?.code || 'REFLECTION_NOTE_APPLY_FAILED');
          const stale = code.includes('CAS') || code.includes('REVISION') || code.includes('ARCHIVED');
          innerDb.prepare(`
            UPDATE reflection_proposals
            SET status=?,reviewed_at=?,reviewer=?,error_code=?,error_message=?
            WHERE id=? AND status='pending'
          `).run(
            stale ? 'stale' : 'invalid',
            ts,
            reviewer,
            code,
            String(error?.message || error).slice(0, 500),
            proposal.id
          );
          this.#finishBatchAfterReview(innerDb, batch.id, ts, reviewer, code,
            String(error?.message || error));
          return {
            reviewed: false,
            reason: stale ? 'stale' : 'invalid',
            batch: batchView(innerDb.prepare('SELECT * FROM reflection_batches WHERE id=?').get(batch.id)),
            proposalId: proposal.id
          };
        }
      }
      const eligibleTraits = [];
      let gatedTraitCount = 0;
      for (const proposal of traitProposals) {
        const gate = traitEvidenceGate(batch.evidence, this.limits, proposal.payload);
        if (gate.eligible) {
          eligibleTraits.push(proposal);
          continue;
        }
        gatedTraitCount += 1;
        innerDb.prepare(`
          UPDATE reflection_proposals
          SET status='rejected',reviewed_at=?,reviewer=?,error_code='REFLECTION_EVIDENCE_GATE',
            error_message=?
          WHERE id=? AND status='pending'
        `).run(ts, reviewer, gate.reasons.join(',').slice(0, 500), proposal.id);
      }
      const applied = this.#applyTraitProposals(innerDb, {
        accountId: batch.accountId,
        proposals: eligibleTraits,
        baseHash: currentBaseHash,
        expectedRevision,
        actor: reviewer,
        source: {
          kind: 'reflection-review',
          batchId: batch.id,
          decision: 'approve',
          sourceChatKeys: [
            ...new Set(
              (batch.evidence.conversationEvidence || [])
                .map((item) => String(item?.chatKey || '').trim())
                .filter(Boolean)
            )
          ]
        },
        ts
      });
      this.#finishBatchAfterReview(innerDb, batch.id, ts, reviewer, '', '');
      return {
        reviewed: true,
        decision: 'approve',
        applied: applied.applied,
        invalid: applied.invalid + gatedTraitCount,
        profileRevision: applied.profileRevision,
        batch: batchView(innerDb.prepare('SELECT * FROM reflection_batches WHERE id=?').get(batch.id))
      };
    });
  }

  getLearnedSelfContext({
    accountId,
    chatKey = '',
    basePersonaHash,
    basePersona
  } = {}) {
    const db = this.#requireDb();
    const account = text(String(accountId || ''), 'accountId', 100);
    const currentHash = basePersonaHash || hashBasePersona(basePersona || {});
    const head = db.prepare(
      'SELECT * FROM learned_self_heads WHERE account_id=?'
    ).get(account);
    if (!head) {
      return {
        revision: 0,
        profile: emptyProfile(),
        stale: false,
        context: {},
        activeTraitCount: 0,
        expiredTraitCount: 0
      };
    }
    const version = profileView(db.prepare(`
      SELECT * FROM learned_self_versions WHERE account_id=? AND revision=?
    `).get(account, head.revision));
    if (!version) return { revision: 0, profile: emptyProfile(), stale: true, context: {} };
    if (version.basePersonaHash !== currentHash) {
      return {
        revision: version.revision,
        profile: version.profile,
        stale: true,
        reason: 'base-persona-changed',
        context: {}
      };
    }
    const active = activeProfile(version.profile, nowValue(this.now));
    const chatProfile = chatKey ? (active.profile.chats?.[chatKey] || {}) : {};
    return {
      revision: version.revision,
      profile: structuredClone(active.profile),
      stale: false,
      context: {
        ...structuredClone(active.profile.global || {}),
        ...structuredClone(chatProfile)
      },
      basePersonaHash: version.basePersonaHash,
      activeTraitCount: active.activeCount,
      expiredTraitCount: active.expiredCount
    };
  }

  getLearnedSelfRevision({ accountId } = {}) {
    const db = this.#requireDb();
    const account = text(String(accountId || ''), 'accountId', 100);
    return this.#headRevision(db, account);
  }

  validateMaterialRefs({
    accountId: rawAccount,
    currentChatKey = '',
    basePersonaHash = '',
    basePersona,
    refs = []
  } = {}) {
    if (!Array.isArray(refs)) {
      return {
        valid: false,
        invalidRefs: [{ ref: refs, reason: 'invalid-ref-list' }],
        validatedRefs: [],
        policyVersion: LEARNED_SELF_POLICY_VERSION
      };
    }
    if (refs.length === 0) {
      return {
        valid: true,
        invalidRefs: [],
        validatedRefs: [],
        policyVersion: LEARNED_SELF_POLICY_VERSION
      };
    }
    const db = this.#requireDb();
    const account = text(String(rawAccount || ''), 'accountId', 100);
    const chat = String(currentChatKey || '').trim();
    if (!/^(group|private):\d+$/.test(chat)) {
      return {
        valid: false,
        invalidRefs: refs.map((ref) => ({ ref, reason: 'missing-current-chat' })),
        validatedRefs: [],
        policyVersion: LEARNED_SELF_POLICY_VERSION
      };
    }
    const currentRevision = this.#headRevision(db, account);
    const current = currentRevision > 0
      ? db.prepare(`SELECT * FROM learned_self_versions
          WHERE account_id=? AND revision=?`).get(account, currentRevision)
      : null;
    const currentBasePersonaHash = basePersonaHash || (
      basePersona && typeof basePersona === 'object' ? hashBasePersona(basePersona) : ''
    );
    let visibleContextExists = false;
    let currentVisibleProfile = null;
    if (current) {
      const active = activeProfile(parseJson(current.profile_json, emptyProfile()), nowValue(this.now));
      currentVisibleProfile = {
        ...(active.profile.global || {}),
        ...(active.profile.chats?.[chat] || {})
      };
      visibleContextExists = Object.keys(currentVisibleProfile).length > 0;
    }
    const invalidRefs = [];
    const validatedRefs = [];
    for (const ref of refs) {
      let reason = '';
      const revision = Number(ref?.revision);
      if (ref?.kind !== 'learned-self') reason = 'unsupported-material-kind';
      else if (ref.id !== account) reason = 'account-mismatch';
      else if (ref.policyVersion !== LEARNED_SELF_POLICY_VERSION) reason = 'stale-policy-version';
      else if (ref.scope !== 'chat' || ref.visibility !== `chat:${chat}`) {
        reason = 'chat-visibility-mismatch';
      } else if (!Number.isSafeInteger(revision) || revision < 1) reason = 'invalid-revision';
      else if (!current || revision !== currentRevision) reason = 'stale-revision';
      else if (!currentBasePersonaHash || current.base_persona_hash !== currentBasePersonaHash) {
        reason = 'base-persona-changed';
      } else if (!visibleContextExists) reason = 'empty-or-expired-context';
      else if (!Array.isArray(ref.traitKeys) || !ref.traitKeys.length || ref.traitKeys.length > 12) {
        reason = 'invalid-trait-keys';
      } else if (ref.traitKeys.some((key) => typeof key !== 'string'
        || !Object.hasOwn(currentVisibleProfile, key))) {
        reason = 'trait-key-stale-or-invisible';
      } else if (!Number.isFinite(Number(ref.expiresAt)) || Number(ref.expiresAt) < 0
        || (Number(ref.expiresAt) > 0 && Number(ref.expiresAt) <= nowValue(this.now))) {
        reason = 'trait-material-expired';
      } else {
        const currentExpiries = ref.traitKeys
          .map((key) => Number(currentVisibleProfile[key]?.expiresAt) || 0)
          .filter((expiresAt) => expiresAt > 0);
        const currentEarliest = currentExpiries.length ? Math.min(...currentExpiries) : 0;
        if (Number(ref.expiresAt) !== currentEarliest) reason = 'trait-expiry-changed';
      }
      if (reason) invalidRefs.push({ ref, reason });
      else {
        validatedRefs.push({
          kind: 'learned-self',
          id: account,
          revision,
          scope: 'chat',
          visibility: `chat:${chat}`,
          policyVersion: LEARNED_SELF_POLICY_VERSION
        });
      }
    }
    return {
      valid: invalidRefs.length === 0,
      invalidRefs,
      validatedRefs,
      policyVersion: LEARNED_SELF_POLICY_VERSION
    };
  }

  listProfileVersions({ accountId, limit = 100 } = {}) {
    const db = this.#requireDb();
    const account = text(String(accountId || ''), 'accountId', 100);
    const max = Math.min(500, Math.max(1, Number(limit) || 100));
    return db.prepare(`
      SELECT * FROM learned_self_versions
      WHERE account_id=? ORDER BY revision DESC LIMIT ?
    `).all(account, max).map(profileView);
  }

  auditProfile({ accountId, revision } = {}) {
    const db = this.#requireDb();
    const account = text(String(accountId || ''), 'accountId', 100);
    const headRevision = this.#headRevision(db, account);
    const selectedRevision = revision === undefined
      ? headRevision
      : strictSafeInteger(revision, 'revision', 1);
    if (selectedRevision === 0) {
      return {
        accountId: account,
        headRevision,
        revision: 0,
        parentRevision: 0,
        basePersonaHash: '',
        appliedBy: '',
        source: [],
        createdAt: 0,
        entries: []
      };
    }
    const rows = db.prepare(`
      SELECT * FROM learned_self_versions
      WHERE account_id=? AND revision<=?
      ORDER BY revision DESC
    `).all(account, selectedRevision);
    const current = rows.find((row) => Number(row.revision) === selectedRevision);
    if (!current) fail('REFLECTION_NOT_FOUND', 'profile revision not found');
    const profile = parseJson(current.profile_json, emptyProfile());
    const entries = profileEntryDescriptors(profile, {
      accountId: account,
      revision: selectedRevision
    });
    const profiles = new Map(rows.map((row) => [
      Number(row.revision),
      parseJson(row.profile_json, emptyProfile())
    ]));
    for (const entry of entries) {
      let sourceRevision = selectedRevision;
      for (let candidate = selectedRevision - 1; candidate >= 1; candidate -= 1) {
        const previous = profiles.get(candidate);
        if (!previous) break;
        const before = rawProfileEntry(previous, entry);
        if (!before.exists || stableJson(before.value) !== stableJson(entry.entry)) break;
        sourceRevision = candidate;
      }
      entry.sourceRevision = sourceRevision;
    }
    return {
      accountId: account,
      headRevision,
      revision: selectedRevision,
      parentRevision: Number(current.parent_revision) || 0,
      basePersonaHash: String(current.base_persona_hash || ''),
      appliedBy: String(current.applied_by || ''),
      source: parseJson(current.source_json, []),
      createdAt: Number(current.created_at) || 0,
      entries
    };
  }

  previewProfileReset({ accountId, expectedCurrentRevision } = {}) {
    const account = text(String(accountId || ''), 'accountId', 100);
    const expected = strictSafeInteger(
      expectedCurrentRevision,
      'expectedCurrentRevision',
      0
    );
    const audit = this.auditProfile({ accountId: account });
    if (audit.headRevision !== expected) {
      fail('REFLECTION_CAS_CONFLICT', 'Learned Self revision changed', {
        expectedRevision: expected,
        currentRevision: audit.headRevision
      });
    }
    const entries = structuredClone(audit.entries);
    return {
      accountId: account,
      mode: 'quarantine_all',
      currentRevision: audit.revision,
      nextRevision: entries.length ? audit.revision + 1 : audit.revision,
      rollbackTargetRevision: audit.revision > 0 ? audit.revision : 0,
      removedEntries: entries,
      retainedEntries: [],
      removedCount: entries.length,
      retainedCount: 0,
      noOp: entries.length === 0
    };
  }

  resetProfile({
    accountId,
    expectedCurrentRevision,
    actor,
    reason,
    confirm
  } = {}) {
    const account = text(String(accountId || ''), 'accountId', 100);
    const expected = strictSafeInteger(
      expectedCurrentRevision,
      'expectedCurrentRevision',
      0
    );
    const applier = text(actor, 'actor', 160);
    const resetReason = text(reason, 'reason', 300);
    if (confirm !== true) {
      fail('REFLECTION_CONFIRM_REQUIRED', 'profile reset requires confirm=true');
    }
    return this.#transaction((db) => {
      const ts = nowValue(this.now);
      const currentRevision = this.#headRevision(db, account);
      if (currentRevision !== expected) {
        fail('REFLECTION_CAS_CONFLICT', 'Learned Self revision changed', {
          expectedRevision: expected,
          currentRevision
        });
      }
      if (currentRevision === 0) {
        return {
          reset: false,
          noOp: true,
          accountId: account,
          currentRevision: 0,
          revision: 0,
          removedCount: 0,
          retainedCount: 0,
          rollbackTargetRevision: 0
        };
      }
      const current = db.prepare(`
        SELECT * FROM learned_self_versions WHERE account_id=? AND revision=?
      `).get(account, currentRevision);
      const before = profileEntryDescriptors(
        parseJson(current?.profile_json, emptyProfile()),
        { accountId: account, revision: currentRevision }
      );
      if (!before.length) {
        return {
          reset: false,
          noOp: true,
          accountId: account,
          currentRevision,
          revision: currentRevision,
          removedCount: 0,
          retainedCount: 0,
          rollbackTargetRevision: currentRevision
        };
      }
      const changes = before.map((entry) => ({
        scope: entry.scope,
        chatKey: entry.chatKey,
        key: entry.key,
        evidenceRefs: entry.evidenceRefs,
        valueLength: entry.value.length,
        sourceRevision: entry.sourceRevision
      }));
      const nextRevision = currentRevision + 1;
      const evidence = [{
        kind: 'profile-reset',
        mode: 'quarantine_all',
        fromRevision: currentRevision,
        removedCount: before.length,
        retainedCount: 0,
        actor: applier,
        reason: resetReason,
        changes
      }];
      const source = [{
        kind: 'profile-reset',
        mode: 'quarantine_all',
        targetRevision: currentRevision,
        actor: applier
      }];
      db.prepare(`
        INSERT INTO learned_self_versions
          (account_id,revision,parent_revision,profile_json,evidence_json,
           base_persona_hash,applied_by,source_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).run(
        account,
        nextRevision,
        currentRevision,
        safeJson(emptyProfile()),
        safeJson(evidence),
        String(current.base_persona_hash || ''),
        applier,
        safeJson(source),
        ts
      );
      db.prepare(`
        INSERT INTO learned_self_heads(account_id,revision,updated_at)
        VALUES (?,?,?)
        ON CONFLICT(account_id) DO UPDATE SET revision=excluded.revision,updated_at=excluded.updated_at
      `).run(account, nextRevision, ts);
      this.#audit(db, {
        accountId: account,
        event: 'profile-reset',
        message: resetReason,
        details: {
          mode: 'quarantine_all',
          actor: applier,
          reason: resetReason,
          beforeRevision: currentRevision,
          afterRevision: nextRevision,
          removedCount: before.length,
          retainedCount: 0,
          changes
        },
        ts
      });
      return {
        reset: true,
        noOp: false,
        accountId: account,
        mode: 'quarantine_all',
        currentRevision,
        revision: nextRevision,
        parentRevision: currentRevision,
        rollbackTargetRevision: currentRevision,
        removedCount: before.length,
        retainedCount: 0,
        removedEntries: before,
        retainedEntries: [],
        profile: emptyProfile()
      };
    });
  }

  correctProfileTrait({
    accountId,
    key,
    subject = '',
    scope = 'global',
    chatKey = '',
    action = 'remove',
    value,
    confidence = 1,
    expectedCurrentRevision,
    basePersonaHash,
    basePersona,
    actor,
    reason,
    confirm
  } = {}) {
    const account = text(String(accountId || ''), 'accountId', 100);
    const traitKey = text(key, 'key', 64);
    if (!TRAIT_KEY_RE.test(traitKey)) {
      fail('REFLECTION_INVALID_ARGUMENT', 'key must be a stable identifier');
    }
    const traitScope = String(scope || 'global');
    if (!['global', 'chat'].includes(traitScope)) {
      fail('REFLECTION_INVALID_ARGUMENT', 'scope must be global or chat');
    }
    const traitChatKey = String(chatKey || '').trim();
    if (traitScope === 'global' && traitChatKey) {
      fail('REFLECTION_SCOPE', 'global correction cannot include chatKey');
    }
    if (traitScope === 'chat' && !/^(group|private):\d+$/.test(traitChatKey)) {
      fail('REFLECTION_SCOPE', 'chat correction requires a scoped chatKey');
    }
    const traitSubject = String(subject || '').trim();
    if (traitSubject && traitSubject !== 'bot' && !/^user:[^\s:][^\s]*$/u.test(traitSubject)) {
      fail('REFLECTION_INVALID_ARGUMENT', 'subject must be bot or user:<host identity>');
    }
    if (traitSubject.startsWith('user:') && traitScope !== 'chat') {
      fail('REFLECTION_SCOPE', 'user-subject traits must remain chat-scoped');
    }
    const correctionAction = String(action || 'remove').toLowerCase();
    if (!['set', 'remove'].includes(correctionAction)) {
      fail('REFLECTION_INVALID_ARGUMENT', 'action must be set or remove');
    }
    const correctedValue = correctionAction === 'set'
      ? text(value, 'value', this.limits.maxTraitValueChars)
      : '';
    const proceduralReason = proceduralTraitReason(traitKey, correctedValue);
    if (proceduralReason) {
      fail('REFLECTION_PROCEDURAL_TRAIT',
        'correction cannot create a procedural or scripted trait',
        { reason: proceduralReason });
    }
    const expected = strictSafeInteger(
      expectedCurrentRevision,
      'expectedCurrentRevision',
      0
    );
    const applier = text(actor, 'actor', 160);
    const correctionReason = text(reason, 'reason', 300);
    if (confirm !== true) {
      fail('REFLECTION_CONFIRM_REQUIRED', 'profile correction requires confirm=true');
    }
    return this.#transaction((db) => {
      const ts = nowValue(this.now);
      const currentRevision = this.#headRevision(db, account);
      if (currentRevision !== expected) {
        fail('REFLECTION_CAS_CONFLICT', 'Learned Self revision changed', {
          expectedRevision: expected,
          currentRevision
        });
      }
      if (currentRevision === 0) {
        return {
          corrected: false,
          noOp: true,
          accountId: account,
          revision: 0,
          currentRevision: 0
        };
      }
      const current = db.prepare(`
        SELECT * FROM learned_self_versions WHERE account_id=? AND revision=?
      `).get(account, currentRevision);
      const currentHash = basePersonaHash || hashBasePersona(basePersona || {});
      if (String(current.base_persona_hash || '') !== currentHash) {
        fail('REFLECTION_BASE_PERSONA_CHANGED',
          'current profile was learned against a different Base Persona');
      }
      const profile = normalizeProfile(parseJson(current.profile_json, emptyProfile()));
      const bucket = traitScope === 'chat'
        ? (profile.chats[traitChatKey] ||= {})
        : profile.global;
      const storageKey = resolveTraitStorageKey(bucket, traitKey, traitSubject);
      const existing = storageKey ? bucket[storageKey] : undefined;
      if (correctionAction === 'remove' && !storageKey) {
        this.#audit(db, {
          accountId: account,
          event: 'profile-correction',
          code: 'REFLECTION_NOOP_DUPLICATE',
          message: correctionReason,
          details: {
            action: correctionAction,
            key: traitKey,
            logicalKey: traitKey,
            storageKey: '',
            subject: traitSubject,
            scope: traitScope,
            chatKey: traitChatKey,
            revision: currentRevision,
            noOp: true,
            actor: applier
          },
          ts
        });
        return {
          corrected: false,
          noOp: true,
          accountId: account,
          revision: currentRevision,
          currentRevision
        };
      }
      if (correctionAction === 'set'
        && existing
        && (!traitSubject || String(existing.subject || '') === traitSubject)
        && traitStoredValue(existing) === correctedValue) {
        return {
          corrected: false,
          noOp: true,
          accountId: account,
          revision: currentRevision,
          currentRevision
        };
      }
      if (correctionAction === 'remove') {
        delete bucket[storageKey];
      } else {
        const old = normalizeStoredTrait(existing, {
          scope: traitScope,
          chatKey: traitChatKey,
          key: traitKey,
          storageKey: storageKey || traitStorageKey(traitKey, traitSubject),
          now: ts
        });
        const nextStorageKey = storageKey || traitStorageKey(traitKey, traitSubject);
        bucket[nextStorageKey] = {
          key: traitKey,
          storageKey: nextStorageKey,
          subject: traitSubject || old.subject || '',
          value: correctedValue,
          confidence: Math.max(0, Math.min(1, Number(confidence) || 1)),
          evidenceRefs: [],
          evidenceCount: 0,
          sourceChats: traitChatKey ? [traitChatKey] : [],
          scope: traitScope,
          chatKey: traitChatKey,
          createdAt: old.createdAt || ts,
          lastObservedAt: ts,
          expiresAt: ts + this.limits.traitTtlMs
        };
      }
      const nextRevision = currentRevision + 1;
      const evidence = [{
        kind: 'profile-correction',
        action: correctionAction,
        key: traitKey,
        storageKey: storageKey || traitStorageKey(traitKey, traitSubject),
        subject: traitSubject,
        scope: traitScope,
        chatKey: traitChatKey,
        reason: correctionReason,
        actor: applier
      }];
      const source = [{
        kind: 'profile-correction',
        action: correctionAction,
        key: traitKey,
        storageKey: storageKey || traitStorageKey(traitKey, traitSubject),
        subject: traitSubject,
        scope: traitScope,
        chatKey: traitChatKey,
        actor: applier
      }];
      db.prepare(`
        INSERT INTO learned_self_versions
          (account_id,revision,parent_revision,profile_json,evidence_json,
           base_persona_hash,applied_by,source_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).run(
        account,
        nextRevision,
        currentRevision,
        safeJson(profile),
        safeJson(evidence),
        currentHash,
        applier,
        safeJson(source),
        ts
      );
      db.prepare(`
        INSERT INTO learned_self_heads(account_id,revision,updated_at)
        VALUES (?,?,?)
        ON CONFLICT(account_id) DO UPDATE SET revision=excluded.revision,updated_at=excluded.updated_at
      `).run(account, nextRevision, ts);
      this.#audit(db, {
        accountId: account,
        event: 'profile-correction',
        message: correctionReason,
        details: {
          action: correctionAction,
          key: traitKey,
          scope: traitScope,
          chatKey: traitChatKey,
          actor: applier,
          beforeRevision: currentRevision,
          afterRevision: nextRevision
        },
        ts
      });
      return {
        corrected: true,
        noOp: false,
        accountId: account,
        revision: nextRevision,
        parentRevision: currentRevision,
        action: correctionAction,
        key: traitKey,
        scope: traitScope,
        chatKey: traitChatKey,
        profile
      };
    });
  }

  rollbackProfile({
    accountId,
    targetRevision,
    expectedCurrentRevision,
    basePersonaHash,
    basePersona,
    actor,
    reason = 'manual rollback'
  } = {}) {
    const account = text(String(accountId || ''), 'accountId', 100);
    const target = Number(targetRevision);
    const expected = Number(expectedCurrentRevision);
    const applier = text(String(actor || ''), 'actor', 160);
    if (!Number.isSafeInteger(target) || target < 1) {
      fail('REFLECTION_INVALID_ARGUMENT', 'targetRevision must be a positive integer');
    }
    if (!Number.isSafeInteger(expected) || expected < 0) {
      fail('REFLECTION_INVALID_ARGUMENT', 'expectedCurrentRevision must be non-negative');
    }
    return this.#transaction((db) => {
      const ts = nowValue(this.now);
      const currentRevision = this.#headRevision(db, account);
      if (currentRevision !== expected) {
        fail('REFLECTION_CAS_CONFLICT', 'Learned Self revision changed', {
          expectedRevision: expected,
          currentRevision
        });
      }
      const target = profileView(db.prepare(`
        SELECT * FROM learned_self_versions WHERE account_id=? AND revision=?
      `).get(account, Number(targetRevision)));
      if (!target) fail('REFLECTION_NOT_FOUND', 'target profile version not found');
      const currentVersion = profileView(db.prepare(`
        SELECT * FROM learned_self_versions WHERE account_id=? AND revision=?
      `).get(account, currentRevision));
      const currentHash = basePersonaHash || hashBasePersona(basePersona || {});
      if (target.basePersonaHash !== currentHash) {
        fail('REFLECTION_BASE_PERSONA_CHANGED',
          'target profile was learned against a different Base Persona');
      }
      const nextRevision = currentRevision + 1;
      const beforeEntries = profileEntryDescriptors(currentVersion?.profile, {
        accountId: account,
        revision: currentRevision
      });
      const afterEntries = profileEntryDescriptors(target.profile, {
        accountId: account,
        revision: Number(targetRevision)
      });
      const beforeMap = new Map(beforeEntries.map((entry) => [
        descriptorIdentity(entry),
        entry
      ]));
      const afterMap = new Map(afterEntries.map((entry) => [
        descriptorIdentity(entry),
        entry
      ]));
      const changes = [];
      for (const [identity, entry] of beforeMap) {
        const next = afterMap.get(identity);
        if (!next || stableJson(entry.entry) !== stableJson(next.entry)) {
          changes.push({
            scope: entry.scope,
            chatKey: entry.chatKey,
            key: entry.key,
            action: next ? 'replace' : 'remove',
            beforeValueLength: entry.value.length,
            afterValueLength: next ? next.value.length : 0
          });
        }
      }
      for (const [identity, entry] of afterMap) {
        if (!beforeMap.has(identity)) {
          changes.push({
            scope: entry.scope,
            chatKey: entry.chatKey,
            key: entry.key,
            action: 'add',
            beforeValueLength: 0,
            afterValueLength: entry.value.length
          });
        }
      }
      const evidence = [{
        kind: 'rollback',
        targetRevision: Number(targetRevision),
        beforeRevision: currentRevision,
        afterRevision: nextRevision,
        actor: applier,
        reason: String(reason || '').slice(0, 300),
        changes
      }];
      const source = [{
        kind: 'profile-rollback',
        targetRevision: Number(targetRevision),
        actor: applier
      }];
      db.prepare(`
        INSERT INTO learned_self_versions
          (account_id,revision,parent_revision,profile_json,evidence_json,
           base_persona_hash,applied_by,source_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).run(
        account,
        nextRevision,
        currentRevision,
        safeJson(target.profile),
        safeJson(evidence),
        currentHash,
        applier,
        safeJson(source),
        ts
      );
      db.prepare(`
        INSERT INTO learned_self_heads(account_id,revision,updated_at)
        VALUES (?,?,?)
        ON CONFLICT(account_id) DO UPDATE SET revision=excluded.revision,updated_at=excluded.updated_at
      `).run(account, nextRevision, ts);
      this.#audit(db, {
        accountId: account,
        event: 'profile-rollback',
        details: {
          targetRevision: Number(targetRevision),
          beforeRevision: currentRevision,
          afterRevision: nextRevision,
          actor: applier,
          reason: String(reason || '').slice(0, 300),
          changes
        },
        ts
      });
      return {
        rolledBack: true,
        targetRevision: Number(targetRevision),
        revision: nextRevision,
        parentRevision: currentRevision,
        profile: target.profile,
        basePersonaHash: currentHash
      };
    });
  }

  invalidateStaleProposals({ accountId, basePersonaHash } = {}) {
    const account = text(String(accountId || ''), 'accountId', 100);
    const currentHash = text(String(basePersonaHash || ''), 'basePersonaHash', 64);
    if (!/^[a-f0-9]{64}$/.test(currentHash)) {
      fail('REFLECTION_INVALID_ARGUMENT', 'basePersonaHash must be a SHA-256 hash');
    }
    return this.#transaction((db) => {
      const ts = nowValue(this.now);
      const rows = db.prepare(`
        SELECT id FROM reflection_batches
        WHERE account_id=? AND status IN ('ready','partially_applied') AND base_persona_hash<>?
      `).all(account, currentHash);
      const markProposal = db.prepare(`
        UPDATE reflection_proposals SET status='stale',reviewed_at=?,error_code='REFLECTION_BASE_PERSONA_CHANGED',
          error_message='Base Persona changed'
        WHERE batch_id=? AND status='pending'
      `);
      const markBatch = db.prepare(`
        UPDATE reflection_batches SET status='stale',reviewed_at=?,error_code='REFLECTION_BASE_PERSONA_CHANGED',
          error_message='Base Persona changed'
        WHERE id=?
      `);
      for (const row of rows) {
        markProposal.run(ts, row.id);
        markBatch.run(ts, row.id);
      }
      return { invalidated: rows.length };
    });
  }

  listCapabilityGaps() {
    // 能力缺口表已从产品与数据库移除；保留空实现以兼容旧的只读调用方。
    this.#requireDb();
    return [];
  }

  listAudit({ accountId = '', jobId = '', limit = 100 } = {}) {
    const db = this.#requireDb();
    const filters = [];
    const params = [];
    if (accountId) {
      filters.push('account_id=?');
      params.push(String(accountId));
    }
    if (jobId) {
      filters.push('job_id=?');
      params.push(String(jobId));
    }
    const max = Math.min(500, Math.max(1, Number(limit) || 100));
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    return db.prepare(`
      SELECT * FROM reflection_audit ${where} ORDER BY id DESC LIMIT ?
    `).all(...params, max).map((row) => ({
      id: Number(row.id),
      accountId: String(row.account_id || ''),
      jobId: String(row.job_id || ''),
      event: String(row.event),
      code: String(row.code || ''),
      message: String(row.message || ''),
      details: parseJson(row.details_json, {}),
      createdAt: Number(row.created_at) || 0
    }));
  }

  learnedSelfMetrics({ accountId = '' } = {}) {
    const db = this.#requireDb();
    const account = accountId ? String(accountId) : '';
    const profileRow = account
      ? db.prepare(`
          SELECT v.* FROM learned_self_versions v
          JOIN learned_self_heads h
            ON h.account_id=v.account_id AND h.revision=v.revision
          WHERE v.account_id=?
        `).get(account)
      : null;
    const active = profileRow
      ? activeProfile(parseJson(profileRow.profile_json, emptyProfile()), nowValue(this.now))
      : { activeCount: 0, expiredCount: 0 };
    const jobRows = this.#jobsAvailable()
      ? db.prepare(`
          SELECT evidence_json FROM reflection_jobs
          ${account ? 'WHERE account_id=?' : ''}
        `).all(...(account ? [account] : []))
      : [];
    const structuredJobs = jobRows
      .map((row) => parseJson(row.evidence_json, {}))
      .filter((evidence) => evidence.structuredEvidence === true);
    const userEvidenceJobs = structuredJobs.filter((evidence) =>
      Number(evidence.userEvidenceCount) > 0
    );
    const audits = db.prepare(`
      SELECT event,code,details_json FROM reflection_audit
      ${account ? 'WHERE account_id=?' : ''}
    `).all(...(account ? [account] : []));
    const detailRows = audits.map((row) => parseJson(row.details_json, {}));
    return {
      accountId: account,
      currentRevision: Number(profileRow?.revision) || 0,
      injectedCount: active.activeCount,
      expiredCount: active.expiredCount,
      userEvidenceRatio: structuredJobs.length
        ? userEvidenceJobs.length / structuredJobs.length
        : 0,
      assistantOnlyRejected: detailRows.filter((details) =>
        Array.isArray(details.reasons) && details.reasons.includes('assistant-only')
      ).length,
      proceduralRejected: audits.filter((row) =>
        row.code === 'REFLECTION_PROCEDURAL_TRAIT'
      ).length,
      globalPromotionCount: audits.filter((row) =>
        row.event === 'global-trait-applied'
      ).length
    };
  }

  counts({ accountId = '' } = {}) {
    const db = this.#requireDb();
    const filter = accountId ? 'WHERE account_id=?' : '';
    const args = accountId ? [String(accountId)] : [];
    const count = (table) => Number(db.prepare(
      `SELECT COUNT(*) AS n FROM ${table} ${filter}`
    ).get(...args)?.n) || 0;
    return {
      batches: count('reflection_batches'),
      proposals: count('reflection_proposals'),
      profileVersions: count('learned_self_versions')
    };
  }

  #leaseMatches(row, { owner, generation, leaseToken, ts }) {
    return String(row?.lease_owner || '') === String(owner || '')
      && Number(row?.lease_generation) === Number(generation)
      && String(row?.lease_token || '') === String(leaseToken || '')
      && Boolean(String(leaseToken || ''))
      && Number(row?.lease_expires_at) > Number(ts);
  }

  #finishJob({ job, owner, generation, status, error = '' }) {
    return this.#transaction((db) => {
      const ts = nowValue(this.now);
      const current = db.prepare('SELECT * FROM reflection_jobs WHERE id=?').get(String(job?.id || ''));
      if (!current || !this.#leaseMatches(current, {
        owner, generation, leaseToken: job?.leaseToken, ts
      })) {
        return { accepted: false, reason: 'stale-lease' };
      }
      db.prepare(`
        UPDATE reflection_jobs
        SET status=?,lease_owner='',lease_generation=0,lease_token='',lease_expires_at=0,
          updated_at=?,completed_at=?,last_error=?
        WHERE id=? AND status='leased' AND lease_owner=? AND lease_generation=? AND lease_token=?
      `).run(
        status,
        ts,
        ts,
        String(error || '').slice(0, 500),
        current.id,
        String(owner || ''),
        Number(generation) || 0,
        String(job?.leaseToken || '')
      );
      this.#audit(db, {
        accountId: current.account_id,
        jobId: current.id,
        event: `${status}-job`,
        message: String(error || ''),
        ts
      });
      return { accepted: true, status };
    });
  }

  #headRevision(db, accountId) {
    return Number(db.prepare(
      'SELECT revision FROM learned_self_heads WHERE account_id=?'
    ).get(accountId)?.revision) || 0;
  }

  #traitRisk(item, evidenceJson) {
    const evidence = parseJson(evidenceJson, {});
    if (!LOW_RISK_TRAIT_KEYS.has(item.key)) return 'high';
    if (item.action === 'remove') return 'low';
    if (Number(item.confidence) < 0.8) return 'high';
    if (evidence.reliability !== 'normal') return 'high';
    if (disinterestLike(item.value || '')) return 'high';
    return 'low';
  }

  #recordCapabilityGaps() {
    // 能力缺口表已移除：不再记录，也不再写库。
    return { upserted: 0, ids: [] };
  }

  #traitSourcePool(db, accountId, currentChatKey, ts) {
    const cutoff = Math.max(0, ts - this.limits.traitEvidenceWindowMs);
    const rows = db.prepare(`
      SELECT evidence_json FROM reflection_observations
      WHERE account_id=? AND chat_key=? AND created_at>=?
      ORDER BY created_at DESC LIMIT ?
    `).all(
      accountId,
      currentChatKey,
      cutoff,
      Math.max(100, this.limits.maxTraitEvidenceInteractions * 8)
    );
    const unique = new Map();
    for (const row of rows) {
      const evidence = parseJson(row.evidence_json, {});
      if (Number(evidence.schemaVersion) < 3
        || Number(evidence.evidenceVersion) < 3
        || evidence.structuredEvidence !== true
        || evidence.proactive === true
        || (Array.isArray(evidence.invalidEvidenceKinds) && evidence.invalidEvidenceKinds.length)) {
        continue;
      }
      for (const item of (Array.isArray(evidence.conversationEvidence)
        ? evidence.conversationEvidence : [])) {
        if (item?.userEvidence !== true
          || Number(item.schemaVersion) < 3
          || item.role !== 'user'
          || item.sourceRecordType !== 'message'
          || !item.sourceRecordId
          || !item.originalSourceId
          || !item.interactionId
          || item.accountId !== accountId
          || item.chatKey !== currentChatKey
          || item.proactive === true) continue;
        const identity = `${item.interactionId}:${item.originalSourceId}`;
        if (!unique.has(identity)) unique.set(identity, item);
      }
    }
    return [...unique.values()];
  }

  #candidateView(db, row, currentProfileRevision = 0) {
    const ts = nowValue(this.now);
    const storedSupport = parseJson(row.support_refs_json, []);
    const storedCounters = parseJson(row.counter_refs_json, []);
    const supportRefs = Array.isArray(storedSupport) ? [...new Set(storedSupport.map(String))] : [];
    const counterRefs = Array.isArray(storedCounters) ? [...new Set(storedCounters.map(String))] : [];
    const pool = this.#traitSourcePool(db, String(row.account_id), String(row.chat_key), ts);
    const byRef = new Map(pool.map((item) => [String(item.sourceRef || ''), item]));
    const support = supportRefs.map((ref) => byRef.get(ref)).filter(Boolean);
    const counters = counterRefs.map((ref) => byRef.get(ref)).filter(Boolean);
    const staleSupportRefs = supportRefs.filter((ref) => !byRef.has(ref));
    const staleCounterRefs = counterRefs.filter((ref) => !byRef.has(ref));
    const supportRoots = new Set(support.map((item) => String(item.originalSourceId || '')));
    const supportInteractions = new Set(support.map((item) => String(item.interactionId || '')));
    const reasons = [];
    if (row.policy_version !== REFLECTION_CANDIDATE_POLICY_VERSION) reasons.push('policy-version-changed');
    if (Number(row.expires_at) <= ts) reasons.push('expired');
    if (row.scope !== 'chat') reasons.push('global-scope-denied');
    if (staleSupportRefs.length) reasons.push('stale-support-sources');
    if (staleCounterRefs.length) reasons.push('stale-counter-sources');
    if (supportInteractions.size < this.limits.minTraitValidSessions) {
      reasons.push('insufficient-interactions');
    }
    if (supportRoots.size < this.limits.minTraitUserEvidence) {
      reasons.push('insufficient-human-sources');
    }
    const subject = String(row.subject || '');
    if (subject.startsWith('user:')) {
      const expectedSender = subject.slice('user:'.length);
      if (support.some((item) => String(item.senderId || '') !== expectedSender)) {
        reasons.push('subject-source-mismatch');
      }
    }
    const storedStatus = String(row.status);
    const terminalStatus = ['adopted', 'rejected', 'expired', 'stale'].includes(storedStatus);
    const status = Number(row.expires_at) <= ts
      ? 'expired'
      : row.policy_version !== REFLECTION_CANDIDATE_POLICY_VERSION
        ? 'stale'
        : terminalStatus
          ? storedStatus
          : reasons.length ? 'pending_insufficient' : 'ready';
    return {
      candidateId: String(row.id),
      proposalId: String(row.latest_proposal_id || ''),
      batchId: String(row.latest_batch_id || ''),
      accountId: String(row.account_id),
      scope: String(row.scope),
      chatKey: String(row.chat_key),
      subject,
      key: String(row.trait_key),
      value: String(row.trait_value || ''),
      action: String(row.action || 'set'),
      claim: `${String(row.trait_key)}=${String(row.trait_value || '')}`,
      supportRefs: supportRefs.filter((ref) => byRef.has(ref)),
      counterRefs: counterRefs.filter((ref) => byRef.has(ref)),
      supportingEvidence: support.map((item) => ({
        sourceRef: String(item.sourceRef || ''),
        originalSourceId: String(item.originalSourceId || ''),
        interactionId: String(item.interactionId || ''),
        senderId: String(item.senderId || ''),
        text: String(item.text || '').slice(0, 240)
      })),
      counterEvidence: counters.map((item) => ({
        sourceRef: String(item.sourceRef || ''),
        originalSourceId: String(item.originalSourceId || ''),
        interactionId: String(item.interactionId || ''),
        senderId: String(item.senderId || ''),
        text: String(item.text || '').slice(0, 240)
      })),
      independentRoots: [...supportRoots].filter(Boolean),
      interactionIds: [...supportInteractions].filter(Boolean),
      createdAt: Number(row.created_at) || 0,
      lastObservedAt: Number(row.last_observed_at) || 0,
      expiresAt: Number(row.expires_at) || 0,
      status,
      eligible: status === 'ready',
      reason: reasons.join(',') || (status === 'ready' ? '' : String(row.reason || status)),
      currentProfileRevision: Number(currentProfileRevision) || 0
    };
  }

  #upsertTraitCandidate(db, proposal, evidence, ts) {
    const item = proposal.item;
    const id = item.candidateId || traitCandidateId({
      accountId: proposal.accountId,
      chatKey: item.chatKey,
      scope: item.scope,
      subject: item.subject,
      key: item.key,
      value: item.value || ''
    });
    const current = db.prepare(
      'SELECT * FROM reflection_candidates WHERE id=? AND account_id=? AND chat_key=?'
    ).get(id, proposal.accountId, item.chatKey);
    if (current && (
      String(current.subject) !== item.subject
      || String(current.trait_key) !== item.key
      || String(current.trait_value || '') !== String(item.value || '')
      || String(current.scope) !== item.scope
      || String(current.action) !== item.action
    )) {
      fail('REFLECTION_CANDIDATE_CONFLICT', 'candidate id claim mismatch');
    }
    const previousSupport = current ? parseJson(current.support_refs_json, []) : [];
    const previousCounters = current ? parseJson(current.counter_refs_json, []) : [];
    const supportRefs = [...new Set([
      ...(Array.isArray(previousSupport) ? previousSupport : []),
      ...item.supportRefs
    ].map(String))].slice(-100);
    const counterRefs = [...new Set([
      ...(Array.isArray(previousCounters) ? previousCounters : []),
      ...item.counterRefs
    ].map(String))].filter((ref) => !supportRefs.includes(ref)).slice(-100);
    const candidateEvidence = {
      ...evidence,
      traitEvidencePool: this.#traitSourcePool(db, proposal.accountId, item.chatKey, ts),
      evidenceVersion: 3,
      structuredEvidence: true,
      currentUserSourceRefs: Array.isArray(evidence.currentUserSourceRefs)
        ? evidence.currentUserSourceRefs
        : [],
      proactive: false,
      invalidEvidenceKinds: [],
      explicitSilence: false
    };
    const gate = traitEvidenceGate(candidateEvidence, this.limits, {
      ...item,
      supportRefs,
      evidenceRefs: supportRefs,
      counterRefs
    });
    const status = gate.eligible ? 'ready' : 'pending_insufficient';
    const reason = gate.reasons.join(',');
    db.prepare(`
      INSERT INTO reflection_candidates (
        id,account_id,chat_key,scope,subject,trait_key,trait_value,action,
        support_refs_json,counter_refs_json,policy_version,status,reason,latest_proposal_id,
        latest_batch_id,created_at,last_observed_at,expires_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        support_refs_json=excluded.support_refs_json,
        counter_refs_json=excluded.counter_refs_json,
        status=CASE WHEN reflection_candidates.status IN ('adopted','rejected','expired','stale')
          THEN reflection_candidates.status ELSE excluded.status END,
        reason=CASE WHEN reflection_candidates.status IN ('adopted','rejected','expired','stale')
          THEN reflection_candidates.reason ELSE excluded.reason END,
        latest_proposal_id=excluded.latest_proposal_id,
        latest_batch_id=excluded.latest_batch_id,
        last_observed_at=excluded.last_observed_at,
        expires_at=excluded.expires_at
    `).run(
      id,
      proposal.accountId,
      item.chatKey,
      item.scope,
      item.subject,
      item.key,
      String(item.value || ''),
      item.action,
      safeJson(supportRefs),
      safeJson(counterRefs),
      REFLECTION_CANDIDATE_POLICY_VERSION,
      status,
      reason,
      proposal.id,
      proposal.batchId,
      Number(current?.created_at) || ts,
      ts,
      ts + this.limits.traitTtlMs
    );
    item.candidateId = id;
    return id;
  }

  #applyTraitProposals(db, {
    accountId,
    proposals,
    baseHash,
    expectedRevision,
    actor,
    source,
    ts
  }) {
    if (!proposals.length) return { applied: 0, invalid: 0, nooped: 0, profileRevision: expectedRevision };
    const currentRevision = this.#headRevision(db, accountId);
    if (currentRevision !== expectedRevision) {
      for (const proposal of proposals) {
        db.prepare(`
          UPDATE reflection_proposals SET status='stale',reviewed_at=?,error_code='REFLECTION_CAS_CONFLICT',
            error_message='Learned Self revision changed'
          WHERE id=? AND status='pending'
        `).run(ts, proposal.id);
      }
      return { applied: 0, invalid: proposals.length, nooped: 0, profileRevision: currentRevision };
    }
    const current = profileView(db.prepare(`
      SELECT * FROM learned_self_versions WHERE account_id=? AND revision=?
    `).get(accountId, currentRevision)) || {
      profile: emptyProfile()
    };
    const profile = normalizeProfile(current.profile);
    let applied = 0;
    let invalid = 0;
    let nooped = 0;
    for (const proposal of proposals) {
      const item = proposal.payload;
      if (proposal.basePersonaHash !== baseHash) {
        db.prepare(`
          UPDATE reflection_proposals SET status='stale',reviewed_at=?,error_code='REFLECTION_BASE_PERSONA_CHANGED',
            error_message='Base Persona changed'
          WHERE id=? AND status='pending'
        `).run(ts, proposal.id);
        invalid += 1;
        continue;
      }
      const bucket = item.scope === 'chat'
        ? (profile.chats[item.chatKey] ||= {})
        : profile.global;
      const storageKey = traitStorageKey(item.key, item.subject);
      const currentValue = bucket[storageKey];
      const currentEntry = normalizeStoredTrait(currentValue, {
        scope: item.scope,
        chatKey: item.chatKey,
        now: ts,
        key: item.key,
        storageKey
      });
      if (item.action === 'remove') {
        if (!Object.hasOwn(bucket, storageKey)) {
          nooped += 1;
          db.prepare(`
            UPDATE reflection_proposals SET status='applied',reviewed_at=?,applied_at=?,
              applier=?,error_code='REFLECTION_NOOP_DUPLICATE',error_message='No matching trait to remove'
            WHERE id=? AND status='pending'
          `).run(ts, ts, actor, proposal.id);
          continue;
        }
        delete bucket[storageKey];
      } else {
        if (currentValue && traitStoredValue(currentValue) === item.value) {
          nooped += 1;
          db.prepare(`
            UPDATE reflection_proposals SET status='applied',reviewed_at=?,applied_at=?,
              applier=?,error_code='REFLECTION_NOOP_DUPLICATE',error_message='Trait value already matches'
            WHERE id=? AND status='pending'
          `).run(ts, ts, actor, proposal.id);
          continue;
        }
        const sourceChatKeys = [
          ...(Array.isArray(source?.sourceChatKeys) ? source.sourceChatKeys : []),
          ...(item.chatKey ? [item.chatKey] : [])
        ];
        bucket[storageKey] = {
          key: item.key,
          storageKey,
          value: item.value,
          subject: String(item.subject || ''),
          confidence: item.confidence,
          evidenceRefs: item.evidenceRefs,
          sourceChats: [...new Set(sourceChatKeys.map(String).filter(Boolean))].slice(0, 16),
          scope: item.scope,
          chatKey: item.chatKey || '',
          createdAt: currentEntry.createdAt || ts,
          lastObservedAt: Number(source?.lastObservedAt) || ts,
          expiresAt: ts + this.limits.traitTtlMs,
          evidenceCount: item.evidenceRefs.length
        };
      }
      db.prepare(`
        UPDATE reflection_proposals SET status='applied',reviewed_at=?,applied_at=?,applier=?
        WHERE id=? AND status='pending'
      `).run(ts, ts, actor, proposal.id);
      if (item.candidateId) {
        db.prepare(`
          UPDATE reflection_candidates SET status='adopted',reason=''
          WHERE id=? AND account_id=?
        `).run(item.candidateId, accountId);
      }
      applied += 1;
      if (item.scope === 'global') {
        this.#audit(db, {
          accountId,
          jobId: String(source?.jobId || ''),
          event: 'global-trait-applied',
          details: {
            key: item.key,
            evidenceCount: item.evidenceRefs.length,
            sourceChats: Array.isArray(source?.sourceChatKeys)
              ? source.sourceChatKeys.slice(0, 16)
              : []
          },
          ts
        });
      }
    }
    if (applied === 0) return { applied, invalid, nooped, profileRevision: currentRevision };
    const nextRevision = currentRevision + 1;
    db.prepare(`
      INSERT INTO learned_self_versions
        (account_id,revision,parent_revision,profile_json,evidence_json,
         base_persona_hash,applied_by,source_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      accountId,
      nextRevision,
      currentRevision,
      safeJson(profile),
      safeJson(proposals.flatMap((proposal) => proposal.evidenceRefs || [])),
      baseHash,
      actor,
      safeJson(source),
      ts
    );
    db.prepare(`
      INSERT INTO learned_self_heads(account_id,revision,updated_at)
      VALUES (?,?,?)
      ON CONFLICT(account_id) DO UPDATE SET revision=excluded.revision,updated_at=excluded.updated_at
    `).run(accountId, nextRevision, ts);
    return { applied, invalid, nooped, profileRevision: nextRevision };
  }

  #applyNoteProposal(db, proposal, {
    accountId,
    sessionId,
    runId,
    chatKey,
    interactionId = '',
    topicId = '',
    originalSourceId = '',
    triggerKind = '',
    notebook,
    ts,
    actor
  }) {
    const noteRejection = (proposal.payload?.operation === 'append'
      || proposal.payload?.operation === 'update')
      ? noteContentRejection(proposal.payload.content)
      : null;
    if (noteRejection) {
      fail(noteRejection.code, noteRejection.message);
    }
    if (!notebook || typeof notebook.append !== 'function') {
      fail('REFLECTION_NOTEBOOK_UNAVAILABLE', 'Notebook adapter is required to apply note operations');
    }
    const source = {
      kind: 'system',
      accountId,
      chatKey: proposal.scope === 'chat' ? proposal.chatKey : chatKey,
      sessionId,
      runId,
      interactionId,
      topicId,
      originalSourceId,
      triggerKind,
      actor: actor || 'reflection-review'
    };
    const item = proposal.payload;
    let result;
    if (item.operation === 'append') {
      result = notebook.append({
        accountId,
        scope: item.scope,
        chatKey: item.chatKey,
        content: item.content,
        tags: item.tags,
        source,
        currentChatKey: chatKey,
        idempotencyKey: `reflection:${proposal.id}`
      });
    } else {
      if (typeof notebook.get !== 'function') {
        fail('REFLECTION_NOTEBOOK_UNAVAILABLE', 'Notebook get adapter is required');
      }
      const current = notebook.get({
        accountId,
        noteId: item.noteId,
        currentChatKey: chatKey,
        includeArchived: true,
        admin: true
      });
      if (!current) fail('REFLECTION_NOTE_STALE', 'Notebook note no longer exists');
      if (String(current.scope || '') !== item.scope
        || (item.scope === 'chat' && String(current.chatKey || '') !== item.chatKey)) {
        fail('REFLECTION_SCOPE', 'Notebook note is outside the proposal scope', {
          expectedScope: item.scope,
          actualScope: current.scope,
          expectedChatKey: item.chatKey,
          actualChatKey: current.chatKey
        });
      }
      if (Number(current.revision) !== Number(item.expectedRevision)) {
        fail('REFLECTION_CAS_CONFLICT', 'Notebook revision changed', {
          expectedRevision: item.expectedRevision,
          currentRevision: current.revision
        });
      }
      const method = item.operation === 'update' ? notebook.update : notebook.archive;
      if (typeof method !== 'function') {
        fail('REFLECTION_NOTEBOOK_UNAVAILABLE', `Notebook ${item.operation} adapter is required`);
      }
      result = method.call(notebook, {
        accountId,
        noteId: item.noteId,
        expectedRevision: item.expectedRevision,
        content: item.content,
        tags: item.tags,
        source,
        currentChatKey: chatKey,
        idempotencyKey: `reflection:${proposal.id}`
      });
    }
    db.prepare(`
      UPDATE reflection_proposals
      SET status='applied',reviewed_at=?,applied_at=?,reviewer=?,applier=?
      WHERE id=? AND status='pending'
    `).run(ts, ts, actor, actor, proposal.id);
    return result;
  }

  #finishBatchAfterReview(db, batchId, ts, reviewer, code, message) {
    const pending = Number(db.prepare(`
      SELECT COUNT(*) AS n FROM reflection_proposals WHERE batch_id=? AND status='pending'
    `).get(batchId)?.n) || 0;
    const applied = Number(db.prepare(`
      SELECT COUNT(*) AS n FROM reflection_proposals WHERE batch_id=? AND status='applied'
    `).get(batchId)?.n) || 0;
    const stale = Number(db.prepare(`
      SELECT COUNT(*) AS n FROM reflection_proposals WHERE batch_id=? AND status='stale'
    `).get(batchId)?.n) || 0;
    const invalid = Number(db.prepare(`
      SELECT COUNT(*) AS n FROM reflection_proposals WHERE batch_id=? AND status='invalid'
    `).get(batchId)?.n) || 0;
    let status = 'applied';
    if (pending > 0) status = 'partially_applied';
    else if (stale > 0 && applied === 0) status = 'stale';
    else if (invalid > 0 && applied === 0) status = 'invalid';
    else if (stale > 0 || invalid > 0) status = 'partially_applied';
    db.prepare(`
      UPDATE reflection_batches
      SET status=?,reviewed_at=?,reviewer=?,error_code=?,error_message=?
      WHERE id=?
    `).run(status, ts, reviewer, String(code || ''), String(message || '').slice(0, 500), batchId);
    if (this.#jobsAvailable()) {
      db.prepare(`
        UPDATE reflection_jobs
        SET status=? WHERE id=(SELECT job_id FROM reflection_batches WHERE id=?)
      `).run(
        ['applied', 'rejected', 'stale', 'invalid'].includes(status) ? status : 'ready',
        batchId
      );
    }
  }

  #rejectBatch(db, batch, reviewer) {
    return this.#transaction((innerDb) => {
      const ts = nowValue(this.now);
      innerDb.prepare(`
        UPDATE reflection_proposals
        SET status='rejected',reviewed_at=?,reviewer=?
        WHERE batch_id=? AND status='pending'
      `).run(ts, reviewer, batch.id);
      innerDb.prepare(`
        UPDATE reflection_batches
        SET status='rejected',reviewed_at=?,reviewer=?,error_code='',error_message=''
        WHERE id=?
      `).run(ts, reviewer, batch.id);
      if (this.#jobsAvailable()) {
        innerDb.prepare(
          "UPDATE reflection_jobs SET status='rejected' WHERE id=?"
        ).run(batch.jobId);
      }
      return {
        reviewed: true,
        decision: 'reject',
        batch: batchView(innerDb.prepare('SELECT * FROM reflection_batches WHERE id=?').get(batch.id))
      };
    });
  }

  #markBatchStale(batchId, message, code) {
    return this.#transaction((db) => {
      const ts = nowValue(this.now);
      const batch = db.prepare('SELECT * FROM reflection_batches WHERE id=?').get(String(batchId));
      if (!batch) fail('REFLECTION_NOT_FOUND', 'reflection batch not found');
      db.prepare(`
        UPDATE reflection_proposals
        SET status='stale',reviewed_at=?,error_code=?,error_message=?
        WHERE batch_id=? AND status='pending'
      `).run(ts, code, message, batchId);
      db.prepare(`
        UPDATE reflection_batches
        SET status='stale',reviewed_at=?,error_code=?,error_message=?
        WHERE id=?
      `).run(ts, code, message, batchId);
      if (this.#jobsAvailable()) {
        db.prepare(`
          UPDATE reflection_jobs SET status='stale' WHERE id=?
        `).run(batch.job_id);
      }
      return {
        reviewed: false,
        reason: 'stale',
        batch: batchView(db.prepare('SELECT * FROM reflection_batches WHERE id=?').get(batchId))
      };
    });
  }
}

export function createReflectionObserver({
  store,
  getStore = null,
  isEnabled = () => true,
  observerId = REFLECTION_OBSERVER_ID
} = {}) {
  const resolveStore = typeof getStore === 'function' ? getStore : () => store;
  return {
    id: observerId,
    ownerPluginId: SELF_EVOLUTION_PLUGIN_ID,
    observe(event) {
      if (isEnabled() !== true) return { enqueued: false, reason: 'disabled' };
      const target = resolveStore();
      if (!(target instanceof ReflectionStore)) {
        throw new TypeError('ReflectionStore is required');
      }
      const result = target.enqueueObservation(event, { sourceKind: 'run_completion' });
      return {
        enqueued: result.created,
        reason: result.reason,
        jobId: result.job?.id || ''
      };
    }
  };
}

export function reflectionPrompt(job, limits = DEFAULT_REFLECTION_LIMITS, reflectionInput = {}) {
  const normalizedLimits = normalizeLimits(limits);
  const sourceObservation = plainObject(job?.evidence) ? job.evidence : {};
  const observation = {
    schemaVersion: Number(sourceObservation.schemaVersion) || 0,
    evidenceVersion: Number(sourceObservation.evidenceVersion) || 0,
    eventId: String(sourceObservation.eventId || '').slice(0, 160),
    sessionId: String(sourceObservation.sessionId || '').slice(0, 160),
    runId: String(sourceObservation.runId || '').slice(0, 160),
    accountId: String(sourceObservation.accountId || '').slice(0, 100),
    chatKey: String(sourceObservation.chatKey || '').slice(0, 100),
    triggerKind: String(sourceObservation.triggerKind || '').slice(0, 80),
    interactionId: String(sourceObservation.interactionId || '').slice(0, 160),
    topicId: String(sourceObservation.topicId || '').slice(0, 160),
    originalSourceIds: Array.isArray(sourceObservation.originalSourceIds)
      ? sourceObservation.originalSourceIds.slice(0, 12)
      : [],
    deliveryState: String(sourceObservation.deliveryState || '').slice(0, 40),
    delivered: sourceObservation.delivered === true,
    resultClass: String(sourceObservation.resultClass || '').slice(0, 80),
    reliability: String(sourceObservation.reliability || '').slice(0, 40),
    failureKinds: Array.isArray(sourceObservation.failureKinds)
      ? sourceObservation.failureKinds.slice(0, 8)
      : [],
    invalidEvidenceKinds: Array.isArray(sourceObservation.invalidEvidenceKinds)
      ? sourceObservation.invalidEvidenceKinds.slice(0, 8)
      : [],
    explicitSilence: sourceObservation.explicitSilence === true,
    explicitPreference: sourceObservation.explicitPreference === true,
    proactive: sourceObservation.proactive === true,
    validSessionCount: Number(sourceObservation.validSessionCount) || 0,
    userEvidenceCount: Number(sourceObservation.userEvidenceCount) || 0,
    traitGate: sourceObservation.traitGate
      ? {
          eligible: sourceObservation.traitGate.eligible === true,
          reasons: Array.isArray(sourceObservation.traitGate.reasons)
            ? sourceObservation.traitGate.reasons.slice(0, 8)
            : [],
          interactionCount: Number(sourceObservation.traitGate.validSessionCount) || 0,
          humanRootCount: Number(sourceObservation.traitGate.userEvidenceCount) || 0
        }
      : null
  };
  const instructions = [
    'You are the current character leaving a note for your future self.',
    'Return JSON with exactly: noteOperations, traitProposals, capabilityGapProposals, summary.',
    'Do not execute code, install plugins, request credentials, or infer disinterest from failures.',
    'Use only the canonical nested field names below. Do not invent aliases such as op, type, target, note, trait, or evidenceIds.',
    reflectionRoleNoteText(),
    'Do not create notes that only contain run telemetry, token/budget usage, sent/replied counts, transient execution state, or ordinary bookkeeping. If there is no useful future-facing note, return noteOperations: [].',
    'Treat executionState, delivery status, retry/queue/schedule/wake information, system reminders, timestamps, and message IDs as diagnostics only; never turn them into Learned Self traits.',
    'A meaningful single human interaction, silence, or delivered assistant experience may support a specific episodic note; the note must describe what happened, not prescribe future behavior.',
    'Stable trait proposals are tentative candidates only. Select real supportRefs and counterRefs from traitEvidencePool; each source must be a host-verified human message. Reuse a visible candidateId only when subject, key, value, scope, and chatKey are exactly the same. Candidate text is not evidence. Do not count assistant output, Notebook notes, currentProfile, summaries, IDs, or diagnostics as independent sources.',
    'The host verifies source provenance and distinct interaction/root counts. Human review decides meaning. Candidates with fewer than three independent interactions and roots remain visible but cannot be adopted. Do not invent references or use global scope.',
    'Your own genuine likes or experience may be recorded as an episodic note, but assistant output alone cannot establish a stable trait. No new human input means no new trait support.',
    'CurrentProfile and Notebook are historical context only, not evidenceRefs. Keep notes chat-scoped to the observed chat; never merge private chats or create global notes from a chat observation.',
    'noteOperations item schema: operation (append|update|archive), scope (global|chat), chatKey, content, tags, noteId, expectedRevision, evidenceRefs.',
    'For noteOperations: append requires operation, scope, content, tags, evidenceRefs and omits noteId/expectedRevision; update requires noteId and expectedRevision plus content or tags; archive requires noteId and expectedRevision and omits content/tags.',
    'traitProposals item schema: action (set|remove), key, value (only for set), subject (user:<senderId>|bot), candidateId (only an exact matching visible candidate), scope (global|chat), chatKey, confidence, supportRefs, counterRefs.',
    'Allowed preference keys: communication_style, language_preference, working_habit, topic_interests, interaction_preferences, expression_preferences. working_habit is never bounded-auto and requires human review.',
    'capabilityGapProposals item schema: category, capability, requestKey, scope (global|chat), chatKey, detail, evidenceRefs.',
    'For note and trait proposals use scope="chat" and the observed chatKey exactly. Use [] when a collection has no proposal.',
    'Canonical empty shape: {"noteOperations":[],"traitProposals":[],"capabilityGapProposals":[],"summary":"没有足够证据时说明原因"}.',
    `Limits: noteOperations<=${normalizedLimits.maxNoteOperations}, ` +
      `traitProposals<=${normalizedLimits.maxTraitProposals}, ` +
      `capabilityGapProposals<=${normalizedLimits.maxCapabilityGapProposals}, ` +
      `input<=${normalizedLimits.maxModelInputChars} chars.`,
    'Allowed capability categories: missing, disabled, permission, config, temporary_failure.',
    `ObservationMetadata: ${safeJson(observation)}`
  ].join('\n');
  const input = plainObject(reflectionInput) ? structuredClone(reflectionInput) : {};
  const shrink = () => {
    if (Array.isArray(input.traitEvidencePool) && input.traitEvidencePool.length > 12) {
      input.traitEvidencePool = input.traitEvidencePool.slice(-12);
      return true;
    }
    if (Array.isArray(input.existingCandidates) && input.existingCandidates.length > 12) {
      input.existingCandidates = input.existingCandidates.slice(0, 12);
      return true;
    }
    if (Array.isArray(input.preferenceEvidence) && input.preferenceEvidence.length > 8) {
      input.preferenceEvidence = input.preferenceEvidence.slice(-8);
      return true;
    }
    if (Array.isArray(input.conversationEvidence) && input.conversationEvidence.length > 8) {
      input.conversationEvidence = input.conversationEvidence.slice(-8);
      return true;
    }
    if (Array.isArray(input.notebook) && input.notebook.length > 4) {
      input.notebook = input.notebook.slice(0, 4);
      return true;
    }
    if (input.basePersona?.customRules && input.basePersona.customRules.length > 800) {
      input.basePersona.customRules = input.basePersona.customRules.slice(0, 800);
      return true;
    }
    if (input.basePersona?.roleText && input.basePersona.roleText.length > 1800) {
      input.basePersona.roleText = input.basePersona.roleText.slice(0, 1800);
      return true;
    }
    if (input.currentProfile?.context && Object.keys(input.currentProfile.context).length > 8) {
      input.currentProfile.context = Object.fromEntries(
        Object.entries(input.currentProfile.context).slice(0, 8)
      );
      return true;
    }
    if (Array.isArray(input.basePersona?.tools) && input.basePersona.tools.length > 12) {
      input.basePersona.tools = input.basePersona.tools.slice(0, 12);
      return true;
    }
    return false;
  };
  let serialized = safeJson(input);
  while (instructions.length + serialized.length + 24 > normalizedLimits.maxModelInputChars && shrink()) {
    serialized = safeJson(input);
  }
  const available = Math.max(0, normalizedLimits.maxModelInputChars - instructions.length - 24);
  if (serialized.length > available) {
    input.conversationEvidence = Array.isArray(input.conversationEvidence)
      ? input.conversationEvidence.slice(-4)
      : [];
    input.preferenceEvidence = Array.isArray(input.preferenceEvidence)
      ? input.preferenceEvidence.slice(-4)
      : [];
    input.traitEvidencePool = Array.isArray(input.traitEvidencePool)
      ? input.traitEvidencePool.slice(-4)
      : [];
    input.existingCandidates = Array.isArray(input.existingCandidates)
      ? input.existingCandidates.slice(0, 4)
      : [];
    input.notebook = Array.isArray(input.notebook)
      ? input.notebook.slice(0, 2)
      : [];
    input.basePersona = {
      roleText: String(input.basePersona?.roleText || '').slice(0, 1200),
      behaviorProfile: String(input.basePersona?.behaviorProfile || '').slice(0, 120),
      botName: String(input.basePersona?.botName || '').slice(0, 120),
      selfNickname: String(input.basePersona?.selfNickname || '').slice(0, 120),
      customRules: String(input.basePersona?.customRules || '').slice(0, 400),
      tools: Array.isArray(input.basePersona?.tools)
        ? input.basePersona.tools.slice(0, 6)
        : []
    };
    serialized = safeJson(input);
  }
  if (serialized.length > available) {
    input.conversationEvidence = (Array.isArray(input.conversationEvidence)
      ? input.conversationEvidence : []).map((item) => ({
      evidenceId: item.evidenceId,
      sourceRef: item.sourceRef,
      role: item.role,
      senderId: item.senderId,
      interactionId: item.interactionId,
      originalSourceId: item.originalSourceId,
      text: String(item.text || '').slice(0, 120)
    }));
    input.traitEvidencePool = (Array.isArray(input.traitEvidencePool)
      ? input.traitEvidencePool : []).map((item) => ({
      sourceRef: item.sourceRef,
      sourceMessageId: item.sourceMessageId,
      interactionId: item.interactionId,
      senderId: item.senderId,
      role: 'user',
      text: String(item.text || '').slice(0, 120)
    }));
    input.preferenceEvidence = [];
    input.notebook = [];
    input.currentProfile = null;
    serialized = safeJson(input);
  }
  if (serialized.length > available) {
    throw new ReflectionError(
      'REFLECTION_INSUFFICIENT_CONTEXT_BUDGET',
      'reflection input cannot fit the configured character budget',
      { available, actual: serialized.length }
    );
  }
  return `${instructions}\nReflectionInput: ${serialized}`;
}
