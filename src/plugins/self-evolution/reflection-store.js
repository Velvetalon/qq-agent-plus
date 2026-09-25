import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from '../../core/config.js';
import { SELF_EVOLUTION_PLUGIN_ID } from './notebook-store.js';

export const REFLECTION_DATABASE_NAME = 'reflection.sqlite';
export const REFLECTION_OBSERVER_ID = 'self-evolution.reflection';
export const REFLECTION_MODES = Object.freeze(['review', 'bounded_auto']);
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
  leaseMs: 30000,
  workerLeaseMs: 60000,
  backoffMs: 1000
});

const LOW_RISK_TRAIT_KEYS = new Set([
  'communication_style',
  'language_preference',
  'working_habit'
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
  const chatKey = optionalText(event.chatKey, 'event.chatKey', 100);
  if (chatKey && !/^(group|private):\d+$/.test(chatKey)) {
    fail('REFLECTION_INVALID_EVENT', 'event.chatKey must be group:<QQ> or private:<QQ>');
  }
  return {
    eventId: optionalText(event.eventId, 'event.eventId', 240),
    observerId,
    observerPluginId,
    accountId,
    sessionId,
    runId: optionalText(event.runId, 'event.runId', 160),
    chatKey,
    pluginGeneration: Math.max(0, Math.round(Number(event.pluginGeneration) || 0))
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

function failureKinds(resultClass, finishReason, outbound, neverWoken) {
  const values = [];
  const combined = `${resultClass} ${finishReason}`.toLowerCase();
  if (/timeout|timed out|deadline/.test(combined)) values.push('timeout');
  if (/abort|interrupt/.test(combined)) values.push('aborted');
  if (/error|failed|failure/.test(combined)) values.push('failure');
  if (Number(outbound.unknown) > 0) values.push('unknown_external_write');
  if (Number(outbound.held) > 0) values.push('held_external_write');
  if (neverWoken) values.push('never_woken');
  return [...new Set(values)];
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
  const resultClass = optionalText(event.resultClass, 'event.resultClass', 80);
  const finishReason = optionalText(actionSummary.finishReason, 'actionSummary.finishReason', 300);
  const outbound = boundedOutbound(actionSummary.outbound);
  const neverWoken = actionSummary.neverWoken === true;
  const failures = failureKinds(resultClass, finishReason, outbound, neverWoken);
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
  ].filter(Boolean);
  return {
    sourceKind: 'run_completion',
    eventId: lineage.eventId,
    observerId: lineage.observerId,
    observerPluginId: lineage.observerPluginId,
    accountId: lineage.accountId,
    sessionId: lineage.sessionId,
    runId: lineage.runId,
    chatKey: lineage.chatKey,
    pluginGeneration: lineage.pluginGeneration,
    resultClass,
    actionSummary: {
      sentCount: Math.max(0, Number(actionSummary.sentCount) || 0),
      finishReason,
      outboundAttempted: actionSummary.outboundAttempted === true,
      participation: boundedParticipation(actionSummary.participation),
      termination: boundedTermination(actionSummary.termination),
      outbound
    },
    sourceMessageIds,
    completedAt: Math.max(0, Number(event.completedAt) || 0),
    evidenceIds: [...new Set(evidenceIds)],
    reliability: failures.length > 0 ? 'unreliable' : 'normal',
    failureKinds: failures,
    neverWoken
  };
}

export function observationWindowKey(event) {
  const normalized = event?.sourceKind === 'run_completion' ? event : normalizeCompletionObservation(event);
  return hash(stableJson({
    observerId: normalized.observerId,
    accountId: normalized.accountId,
    sessionId: normalized.sessionId
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
  const chatKey = chatKeyForScope(raw.chatKey, scope, evidence, pathName);
  const refs = evidenceRefs(raw.evidenceRefs, evidence, limits, `${pathName}.evidenceRefs`);
  const result = {
    operation,
    scope,
    chatKey,
    evidenceRefs: refs
  };
  if (operation === 'append') {
    result.content = noControlChars(text(raw.content, `${pathName}.content`, limits.maxContentChars),
      `${pathName}.content`);
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
    'scope',
    'chatKey',
    'confidence',
    'evidenceRefs'
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
  const chatKey = chatKeyForScope(raw.chatKey, scope, evidence, pathName);
  const confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    fail('REFLECTION_INVALID_OUTPUT', `${pathName}.confidence must be between 0 and 1`);
  }
  const refs = evidenceRefs(raw.evidenceRefs, evidence, limits, `${pathName}.evidenceRefs`);
  const result = {
    action,
    key,
    scope,
    chatKey,
    confidence,
    evidenceRefs: refs
  };
  if (action === 'set') {
    result.value = noControlChars(
      text(String(raw.value ?? ''), `${pathName}.value`, limits.maxTraitValueChars),
      `${pathName}.value`
    );
  } else if (raw.value !== undefined) {
    fail('REFLECTION_INVALID_OUTPUT', `${pathName}.value is not allowed for remove`);
  }
  const unreliable = evidence.reliability !== 'normal';
  if (unreliable && (disinterestLike(key) || disinterestLike(result.value || ''))) {
    fail('REFLECTION_PROHIBITED_INFERENCE',
      `${pathName} cannot infer disinterest from failures, timeouts, unknown writes, or missing wakeups`);
  }
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
  if (noteInput.length > normalizedLimits.maxNoteOperations) {
    fail('REFLECTION_LIMIT_EXCEEDED', 'noteOperations exceeds the limit');
  }
  if (traitInput.length > normalizedLimits.maxTraitProposals) {
    fail('REFLECTION_LIMIT_EXCEEDED', 'traitProposals exceeds the limit');
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
  const result = {
    noteOperations: noteInput.map((item, index) => validateNoteOperation(
      item, index, evidence, normalizedLimits
    )),
    traitProposals: traitInput.map((item, index) => validateTraitProposal(
      item, index, evidence, normalizedLimits
    )),
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
    && output.traitProposals.length === 0
    && output.capabilityGapProposals.length === 0;
}

function jobView(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    observationKey: String(row.observation_key),
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
    leaseExpiresAt: Number(row.lease_expires_at) || 0,
    availableAt: Number(row.available_at) || 0,
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

export class ReflectionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ReflectionError';
    this.code = String(code || 'REFLECTION_ERROR');
    this.details = plainObject(details) ? details : {};
    this.httpStatus = this.code === 'REFLECTION_CAS_CONFLICT'
      || this.code === 'REFLECTION_BASE_PERSONA_CHANGED' ? 409
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

        CREATE TABLE IF NOT EXISTS reflection_jobs (
          id TEXT PRIMARY KEY,
          observation_key TEXT NOT NULL UNIQUE,
          observer_id TEXT NOT NULL,
          observer_plugin_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          chat_key TEXT NOT NULL DEFAULT '',
          session_id TEXT NOT NULL,
          run_id TEXT NOT NULL DEFAULT '',
          plugin_generation INTEGER NOT NULL DEFAULT 0,
          source_kind TEXT NOT NULL CHECK(source_kind='run_completion'),
          evidence_json TEXT NOT NULL,
          evidence_hash TEXT NOT NULL,
          status TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL,
          lease_owner TEXT NOT NULL DEFAULT '',
          lease_generation INTEGER NOT NULL DEFAULT 0,
          lease_expires_at INTEGER NOT NULL DEFAULT 0,
          available_at INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          completed_at INTEGER NOT NULL DEFAULT 0,
          last_error TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS reflection_jobs_pending
          ON reflection_jobs(status, available_at, created_at);

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

        CREATE TABLE IF NOT EXISTS capability_gaps (
          id TEXT PRIMARY KEY,
          dedupe_key TEXT NOT NULL UNIQUE,
          account_id TEXT NOT NULL,
          category TEXT NOT NULL,
          capability TEXT NOT NULL,
          request_key TEXT NOT NULL,
          scope TEXT NOT NULL DEFAULT '',
          chat_key TEXT NOT NULL DEFAULT '',
          detail TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open',
          count INTEGER NOT NULL DEFAULT 1,
          evidence_refs_json TEXT NOT NULL DEFAULT '[]',
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS capability_gaps_lookup
          ON capability_gaps(account_id, category, last_seen_at DESC);

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

  enqueueObservation(event, { sourceKind = 'run_completion' } = {}) {
    if (sourceKind !== 'run_completion') {
      fail('REFLECTION_SOURCE_LINEAGE', 'only host-verified run completion observations may enqueue jobs');
    }
    const evidence = normalizeCompletionObservation(event);
    const observationKey = observationWindowKey(evidence);
    const evidenceJson = safeJson(evidence);
    if (evidenceJson.length > this.limits.maxEvidenceChars) {
      fail('REFLECTION_LIMIT_EXCEEDED', 'completion evidence exceeds the reflection budget');
    }
    const evidenceHash = hash(stableJson(evidence));
    return this.#transaction((db) => {
      const existing = db.prepare(
        'SELECT * FROM reflection_jobs WHERE observation_key=?'
      ).get(observationKey);
      if (existing) return { created: false, reason: 'duplicate', job: jobView(existing) };
      const ts = nowValue(this.now);
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
        evidence.observerId,
        evidence.observerPluginId,
        evidence.accountId,
        evidence.chatKey,
        evidence.sessionId,
        evidence.runId,
        evidence.pluginGeneration,
        evidence.sourceKind,
        evidenceJson,
        evidenceHash,
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

      const row = db.prepare(`
        SELECT * FROM reflection_jobs
        WHERE (
          (status IN ('pending','failed') AND attempts < max_attempts AND available_at<=?)
          OR (status='leased' AND lease_expires_at<=?)
        )
        ORDER BY created_at,id LIMIT 1
      `).get(ts, ts);
      if (!row) return { status: 'empty', job: null };
      const changed = db.prepare(`
        UPDATE reflection_jobs
        SET status='leased',attempts=attempts+1,lease_owner=?,lease_generation=?,
          lease_expires_at=?,updated_at=?,last_error=CASE WHEN ?='leased' THEN last_error ELSE '' END
        WHERE id=? AND (
          (status IN ('pending','failed') AND attempts < max_attempts AND available_at<=?)
          OR (status='leased' AND lease_expires_at<=?)
        )
      `).run(
        worker,
        generationValue,
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
    return this.#transaction((db) => {
      const ts = nowValue(this.now);
      const ownerValue = String(owner || '');
      const generationValue = Number(generation) || 0;
      db.prepare(`
        UPDATE reflection_jobs
        SET status='pending',lease_owner='',lease_generation=0,lease_expires_at=0,
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
      callsCount: Number(row?.calls_count) || 0
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
        return { allowed: false, reason: 'stale-generation', calls: 0 };
      }
      const currentDay = String(state.calls_day || '');
      const currentCount = currentDay === String(dayKey) ? Number(state.calls_count) || 0 : 0;
      if (currentCount >= Math.max(1, Number(maxCallsPerDay) || 1)) {
        return { allowed: false, reason: 'budget-exhausted', calls: currentCount };
      }
      const next = currentCount + 1;
      db.prepare(`
        UPDATE reflection_worker_state
        SET calls_day=?,calls_count=?,updated_at=? WHERE singleton=1
      `).run(String(dayKey), next, ts);
      return { allowed: true, reason: null, calls: next };
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
    return this.#transaction((db) => {
      const ts = nowValue(this.now);
      const current = db.prepare('SELECT * FROM reflection_jobs WHERE id=?').get(String(job?.id || ''));
      if (!current || !this.#leaseMatches(current, { owner, generation, ts })) {
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
        SET status=?,lease_owner='',lease_generation=0,lease_expires_at=0,
          available_at=?,updated_at=?,last_error=?
        WHERE id=? AND status='leased' AND lease_owner=? AND lease_generation=?
      `).run(
        status,
        availableAt,
        ts,
        String(error?.message || error).slice(0, 500),
        current.id,
        String(owner || ''),
        Number(generation) || 0
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
      if (!current || !this.#leaseMatches(current, { owner, generation, ts })) {
        return { accepted: false, reason: 'stale-lease' };
      }
      const attempts = Math.max(0, Number(current.attempts) - 1);
      db.prepare(`
        UPDATE reflection_jobs
        SET status='pending',attempts=?,lease_owner='',lease_generation=0,lease_expires_at=0,
          available_at=?,updated_at=?,last_error=?
        WHERE id=? AND status='leased' AND lease_owner=? AND lease_generation=?
      `).run(
        attempts,
        Math.max(ts, Number(availableAt) || ts),
        ts,
        String(reason || '').slice(0, 500),
        current.id,
        String(owner || ''),
        Number(generation) || 0
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
    const finalStatus = status === 'stale' ? 'stale' : 'invalid';
    return this.#transaction((db) => {
      const ts = nowValue(this.now);
      const current = db.prepare('SELECT * FROM reflection_jobs WHERE id=?').get(String(job?.id || ''));
      if (!current || !this.#leaseMatches(current, { owner, generation, ts })) {
        return { accepted: false, reason: 'stale-lease' };
      }
      db.prepare(`
        UPDATE reflection_jobs
        SET status=?,lease_owner='',lease_generation=0,lease_expires_at=0,
          updated_at=?,completed_at=?,last_error=?
        WHERE id=? AND status='leased' AND lease_owner=? AND lease_generation=?
      `).run(
        finalStatus,
        ts,
        ts,
        String(error?.message || error || '').slice(0, 500),
        current.id,
        String(owner || ''),
        Number(generation) || 0
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
      if (!current || !this.#leaseMatches(current, { owner, generation, ts })) {
        return { accepted: false, reason: 'late-result', committed: false };
      }
      const headRevision = this.#headRevision(db, current.account_id);
      if (headRevision !== expectedRevision) {
        db.prepare(`
          UPDATE reflection_jobs SET status='stale',lease_owner='',lease_generation=0,
            lease_expires_at=0,updated_at=?,completed_at=?,last_error=?
          WHERE id=? AND status='leased' AND lease_owner=? AND lease_generation=?
        `).run(
          ts,
          ts,
          'profile revision changed after reflection started',
          current.id,
          String(owner || ''),
          Number(generation) || 0
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
      const batchStatus = allItems.length === 0 ? 'applied' : 'ready';
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
          payload: entry.item,
          evidenceRefs: entry.item.evidenceRefs || [],
          basePersonaHash: baseHash
        };
      });
      const gapResult = this.#recordCapabilityGaps(db, current, normalized.capabilityGapProposals, ts);
      let profileRevision = headRevision;
      let appliedCount = 0;
      let invalidCount = 0;
      if (normalizedMode === 'bounded_auto') {
        const lowRiskTraits = proposals.filter((entry) => entry.type === 'trait' && entry.risk === 'low');
        if (lowRiskTraits.length > 0) {
          const result = this.#applyTraitProposals(db, {
            accountId: current.account_id,
            proposals: lowRiskTraits,
            baseHash,
            expectedRevision,
            actor: `reflection:${owner}`,
            source: {
              kind: 'reflection',
              jobId: current.id,
              batchId,
              mode: normalizedMode
            },
            ts
          });
          appliedCount += result.applied;
          invalidCount += result.invalid;
          profileRevision = result.profileRevision;
          if (result.applied > 0) {
            db.prepare(`
              UPDATE reflection_batches SET expected_profile_revision=? WHERE id=?
            `).run(profileRevision, batchId);
            db.prepare(`
              UPDATE reflection_proposals SET expected_profile_revision=?
              WHERE batch_id=? AND status='pending'
            `).run(profileRevision, batchId);
          }
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
      const finalBatchStatus = remaining > 0 ? (applied > 0 ? 'partially_applied' : batchStatus) : 'applied';
      const finalJobStatus = remaining > 0 ? 'ready' : 'applied';
      db.prepare(`
        UPDATE reflection_batches
        SET status=?,applied_profile_revision=? WHERE id=?
      `).run(finalBatchStatus, profileRevision, batchId);
      db.prepare(`
        UPDATE reflection_jobs
        SET status=?,lease_owner='',lease_generation=0,lease_expires_at=0,
          updated_at=?,completed_at=?,last_error=''
        WHERE id=? AND status='leased' AND lease_owner=? AND lease_generation=?
      `).run(
        finalJobStatus,
        ts,
        ts,
        current.id,
        String(owner || ''),
        Number(generation) || 0
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

  listJobs({ status = '', accountId = '', limit = 100 } = {}) {
    const db = this.#requireDb();
    const filters = [];
    const params = [];
    if (status) {
      filters.push('status=?');
      params.push(validateJobStatus(String(status)));
    }
    if (accountId) {
      filters.push('account_id=?');
      params.push(String(accountId));
    }
    const max = Math.min(500, Math.max(1, Number(limit) || 100));
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    return db.prepare(`
      SELECT * FROM reflection_jobs ${where}
      ORDER BY created_at,id LIMIT ?
    `).all(...params, max).map(jobView);
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
      const applied = this.#applyTraitProposals(innerDb, {
        accountId: batch.accountId,
        proposals: traitProposals,
        baseHash: currentBaseHash,
        expectedRevision,
        actor: reviewer,
        source: { kind: 'reflection-review', batchId: batch.id, decision: 'approve' },
        ts
      });
      this.#finishBatchAfterReview(innerDb, batch.id, ts, reviewer, '', '');
      return {
        reviewed: true,
        decision: 'approve',
        applied: applied.applied,
        invalid: applied.invalid,
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
    if (!head) return { revision: 0, profile: emptyProfile(), stale: false, context: {} };
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
    const chatProfile = chatKey ? (version.profile.chats?.[chatKey] || {}) : {};
    return {
      revision: version.revision,
      profile: structuredClone(version.profile),
      stale: false,
      context: {
        ...structuredClone(version.profile.global || {}),
        ...structuredClone(chatProfile)
      },
      basePersonaHash: version.basePersonaHash
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
      const currentHash = basePersonaHash || hashBasePersona(basePersona || {});
      if (target.basePersonaHash !== currentHash) {
        fail('REFLECTION_BASE_PERSONA_CHANGED',
          'target profile was learned against a different Base Persona');
      }
      const nextRevision = currentRevision + 1;
      const evidence = [{
        kind: 'rollback',
        targetRevision: Number(targetRevision),
        reason: String(reason || '').slice(0, 300)
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
        safeJson([{ kind: 'profile-rollback', targetRevision: Number(targetRevision) }]),
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
        details: { targetRevision: Number(targetRevision), revision: nextRevision },
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

  listCapabilityGaps({ accountId = '', category = '', limit = 100 } = {}) {
    const db = this.#requireDb();
    const filters = [];
    const params = [];
    if (accountId) {
      filters.push('account_id=?');
      params.push(String(accountId));
    }
    if (category) {
      if (!CATEGORY_SET.has(String(category))) {
        fail('REFLECTION_INVALID_ARGUMENT', 'unknown capability gap category');
      }
      filters.push('category=?');
      params.push(String(category));
    }
    const max = Math.min(500, Math.max(1, Number(limit) || 100));
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    return db.prepare(`
      SELECT * FROM capability_gaps ${where}
      ORDER BY last_seen_at DESC, id LIMIT ?
    `).all(...params, max).map(gapView);
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

  counts({ accountId = '' } = {}) {
    const db = this.#requireDb();
    const filter = accountId ? 'WHERE account_id=?' : '';
    const args = accountId ? [String(accountId)] : [];
    const count = (table) => Number(db.prepare(
      `SELECT COUNT(*) AS n FROM ${table} ${filter}`
    ).get(...args)?.n) || 0;
    return {
      jobs: count('reflection_jobs'),
      batches: count('reflection_batches'),
      proposals: count('reflection_proposals'),
      profileVersions: count('learned_self_versions'),
      capabilityGaps: count('capability_gaps')
    };
  }

  #leaseMatches(row, { owner, generation, ts }) {
    return String(row?.lease_owner || '') === String(owner || '')
      && Number(row?.lease_generation) === Number(generation)
      && Number(row?.lease_expires_at) > Number(ts);
  }

  #finishJob({ job, owner, generation, status, error = '' }) {
    return this.#transaction((db) => {
      const ts = nowValue(this.now);
      const current = db.prepare('SELECT * FROM reflection_jobs WHERE id=?').get(String(job?.id || ''));
      if (!current || !this.#leaseMatches(current, { owner, generation, ts })) {
        return { accepted: false, reason: 'stale-lease' };
      }
      db.prepare(`
        UPDATE reflection_jobs
        SET status=?,lease_owner='',lease_generation=0,lease_expires_at=0,
          updated_at=?,completed_at=?,last_error=?
        WHERE id=? AND status='leased' AND lease_owner=? AND lease_generation=?
      `).run(
        status,
        ts,
        ts,
        String(error || '').slice(0, 500),
        current.id,
        String(owner || ''),
        Number(generation) || 0
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
    if (item.action === 'remove') return 'low';
    if (!LOW_RISK_TRAIT_KEYS.has(item.key)) return 'high';
    if (Number(item.confidence) < 0.8) return 'high';
    if (evidence.reliability !== 'normal') return 'high';
    if (disinterestLike(item.value || '')) return 'high';
    return 'low';
  }

  #recordCapabilityGaps(db, job, gaps, ts) {
    const ids = [];
    for (const gap of gaps) {
      const dedupeKey = hash(stableJson({
        accountId: job.account_id,
        category: gap.category,
        capability: gap.capability,
        requestKey: gap.requestKey,
        scope: gap.scope,
        chatKey: gap.chatKey
      }));
      const existing = db.prepare(
        'SELECT * FROM capability_gaps WHERE dedupe_key=?'
      ).get(dedupeKey);
      if (existing) {
        db.prepare(`
          UPDATE capability_gaps
          SET count=count+1,last_seen_at=?,evidence_refs_json=?,
            detail=CASE WHEN ?='' THEN detail ELSE ? END
          WHERE dedupe_key=?
        `).run(ts, safeJson(gap.evidenceRefs), gap.detail, gap.detail, dedupeKey);
        ids.push(String(existing.id));
      } else {
        const id = `refgap_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
        db.prepare(`
          INSERT INTO capability_gaps (
            id,dedupe_key,account_id,category,capability,request_key,scope,chat_key,
            detail,status,count,evidence_refs_json,first_seen_at,last_seen_at
          ) VALUES (?,?,?,?,?,?,?,?,?,'open',1,?,?,?)
        `).run(
          id,
          dedupeKey,
          job.account_id,
          gap.category,
          gap.capability,
          gap.requestKey,
          gap.scope,
          gap.chatKey,
          gap.detail,
          safeJson(gap.evidenceRefs),
          ts,
          ts
        );
        ids.push(id);
      }
    }
    return { upserted: gaps.length, ids };
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
    if (!proposals.length) return { applied: 0, invalid: 0, profileRevision: expectedRevision };
    const currentRevision = this.#headRevision(db, accountId);
    if (currentRevision !== expectedRevision) {
      for (const proposal of proposals) {
        db.prepare(`
          UPDATE reflection_proposals SET status='stale',reviewed_at=?,error_code='REFLECTION_CAS_CONFLICT',
            error_message='Learned Self revision changed'
          WHERE id=? AND status='pending'
        `).run(ts, proposal.id);
      }
      return { applied: 0, invalid: proposals.length, profileRevision: currentRevision };
    }
    const current = profileView(db.prepare(`
      SELECT * FROM learned_self_versions WHERE account_id=? AND revision=?
    `).get(accountId, currentRevision)) || {
      profile: emptyProfile()
    };
    const profile = normalizeProfile(current.profile);
    let applied = 0;
    let invalid = 0;
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
      if (item.action === 'remove') {
        delete bucket[item.key];
      } else {
        bucket[item.key] = {
          value: item.value,
          confidence: item.confidence,
          evidenceRefs: item.evidenceRefs,
          updatedAt: ts
        };
      }
      db.prepare(`
        UPDATE reflection_proposals SET status='applied',reviewed_at=?,applied_at=?,applier=?
        WHERE id=? AND status='pending'
      `).run(ts, ts, actor, proposal.id);
      applied += 1;
    }
    if (applied === 0) return { applied, invalid, profileRevision: currentRevision };
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
    return { applied, invalid, profileRevision: nextRevision };
  }

  #applyNoteProposal(db, proposal, {
    accountId,
    sessionId,
    runId,
    chatKey,
    notebook,
    ts,
    actor
  }) {
    if (!notebook || typeof notebook.append !== 'function') {
      fail('REFLECTION_NOTEBOOK_UNAVAILABLE', 'Notebook adapter is required to apply note operations');
    }
    const source = {
      kind: 'system',
      accountId,
      chatKey: proposal.scope === 'chat' ? proposal.chatKey : chatKey,
      sessionId,
      runId,
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
    db.prepare(`
      UPDATE reflection_jobs
      SET status=? WHERE id=(SELECT job_id FROM reflection_batches WHERE id=?)
    `).run(
      ['applied', 'rejected', 'stale', 'invalid'].includes(status) ? status : 'ready',
      batchId
    );
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
      innerDb.prepare(
        "UPDATE reflection_jobs SET status='rejected' WHERE id=?"
      ).run(batch.jobId);
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
      db.prepare(`
        UPDATE reflection_jobs SET status='stale' WHERE id=?
      `).run(batch.job_id);
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

export function reflectionPrompt(job, limits = DEFAULT_REFLECTION_LIMITS) {
  const normalizedLimits = normalizeLimits(limits);
  return [
    'You are a read-only reflection worker.',
    'Return JSON with exactly: noteOperations, traitProposals, capabilityGapProposals, summary.',
    'Do not execute code, install plugins, request credentials, or infer disinterest from failures.',
    `Limits: noteOperations<=${normalizedLimits.maxNoteOperations}, ` +
      `traitProposals<=${normalizedLimits.maxTraitProposals}, ` +
      `capabilityGapProposals<=${normalizedLimits.maxCapabilityGapProposals}, ` +
      `input<=${normalizedLimits.maxModelInputChars} chars.`,
    'Allowed capability categories: missing, disabled, permission, config, temporary_failure.',
    `Observation: ${safeJson(job?.evidence || {})}`
  ].join('\n').slice(0, normalizedLimits.maxModelInputChars);
}
