import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ReflectionStore,
  normalizeCompletionObservation,
  reflectionDatabasePath,
  validateReflectionOutput
} from '../src/plugins/self-evolution/index.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-lsr2-evidence-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function completionEvent({
  sessionId,
  chatKey = 'group:100',
  windowId = 'lsr2-window',
  role = 'user',
  userEvidence = role === 'user',
  userConfirmed = false,
  delivered = role === 'assistant',
  proactive = false,
  explicitSilence = false,
  evidenceIds = [`message:${sessionId}`]
} = {}) {
  return {
    eventId: `event-${sessionId}`,
    observerId: 'self-evolution.reflection',
    observerPluginId: 'self-evolution',
    accountId: 'lsr2-account',
    sessionId,
    runId: `run-${sessionId}`,
    chatKey,
    observationWindowId: windowId,
    pluginGeneration: 1,
    resultClass: explicitSilence ? 'explicit_silence' : 'done',
    evidenceVersion: 3,
    actionSummary: {
      evidenceVersion: 3,
      sentCount: explicitSilence ? 0 : 1,
      finishReason: explicitSilence ? 'not_needed' : 'finish',
      outboundAttempted: !explicitSilence,
      proactive,
      participation: {
        mode: proactive ? 'proactive' : 'auto',
        decision: explicitSilence ? 'noreply' : 'reply',
        reasonCode: explicitSilence ? 'not_needed' : 'normal'
      },
      termination: {
        kind: explicitSilence ? 'explicit_silence' : 'finish'
      },
      outbound: explicitSilence
        ? { attempted: 0, succeeded: 0, failed: 0, unknown: 0, held: 0 }
        : { attempted: 1, succeeded: 1, failed: 0, unknown: 0, held: 0 },
      conversationEvidence: evidenceIds.map((evidenceId, index) => ({
        evidenceId,
        sourceRecordId: evidenceId.replace(/^message:/, ''),
        role,
        userEvidence,
        userConfirmed,
        delivered,
        at: 1000 + index,
        text: role === 'user' ? `用户偏好 ${evidenceId}` : 'assistant outbound context'
      }))
    },
    sourceMessageIds: evidenceIds.map((item) => item.replace(/^message:/, '')),
    completedAt: 1000
  };
}

function storeFor(name) {
  return new ReflectionStore({
    filename: reflectionDatabasePath(path.join(root, name)),
    now: () => 1000,
    limits: { leaseMs: 60000, workerLeaseMs: 60000, backoffMs: 0 }
  });
}

test('LSR2 normalizes user evidence, assistant context, delivery, and confirmation separately', () => {
  const normalized = normalizeCompletionObservation(completionEvent({
    sessionId: 'roles',
    evidenceIds: ['message:user-1', 'message:assistant-1']
  }));
  assert.equal(normalized.structuredEvidence, true);
  assert.equal(normalized.conversationEvidence[0].userEvidence, true);
  assert.equal(normalized.conversationEvidence[0].assistantContext, false);
  assert.equal(normalized.conversationEvidence[0].delivered, false);
  assert.equal(normalized.conversationEvidence[0].userConfirmed, false);

  const assistant = normalizeCompletionObservation(completionEvent({
    sessionId: 'assistant-only',
    role: 'assistant',
    userEvidence: false,
    delivered: true,
    proactive: true
  }));
  assert.equal(assistant.userEvidenceCount, 0);
  assert.equal(assistant.conversationEvidence[0].assistantContext, true);
  assert.equal(assistant.proactive, true);
});

test('LSR2 rejects assistant-only proactive and pure explicit-silence windows before creating jobs', () => {
  const store = storeFor('hard-gate');
  try {
    const proactive = store.enqueueObservation(completionEvent({
      sessionId: 'proactive',
      role: 'assistant',
      userEvidence: false,
      delivered: true,
      proactive: true
    }));
    assert.equal(proactive.created, false);
    assert.equal(proactive.reason, 'trait-evidence-gate');

    const silence = store.enqueueObservation(completionEvent({
      sessionId: 'silence',
      explicitSilence: true,
      evidenceIds: ['message:silence-user']
    }));
    assert.equal(silence.created, false);
    assert.equal(silence.reason, 'trait-evidence-gate');

    const emptySilence = store.enqueueObservation(completionEvent({
      sessionId: 'empty-silence',
      explicitSilence: true,
      evidenceIds: []
    }));
    assert.equal(emptySilence.created, false);
    assert.equal(emptySilence.reason, 'trait-evidence-gate');
    assert.equal(store.listJobs().length, 0);
    assert.equal(store.listAudit({ limit: 20 })
      .filter((row) => row.code === 'REFLECTION_EVIDENCE_GATE').length, 3);
  } finally {
    store.close();
  }
});

test('LSR2 requires three independent sessions and two user evidence refs', () => {
  const store = storeFor('threshold');
  try {
    const oneSession = store.enqueueObservation(completionEvent({
      sessionId: 'one-session',
      evidenceIds: ['message:one-a', 'message:one-b']
    }));
    assert.equal(oneSession.created, false);
    assert.equal(oneSession.reason, 'trait-evidence-threshold');
    assert.equal(oneSession.traitGate.validSessionCount, 1);
    assert.equal(oneSession.traitGate.userEvidenceCount, 2);
    assert.equal(store.listJobs().length, 0);
  } finally {
    store.close();
  }
});

test('LSR2 keeps global traits chat-scoped until evidence spans two chats', () => {
  const sameChat = storeFor('same-chat');
  try {
    let result;
    for (const sessionId of ['same-1', 'same-2', 'same-3']) {
      result = sameChat.enqueueObservation(completionEvent({
        sessionId,
        chatKey: 'group:100',
        evidenceIds: [`message:${sessionId}`]
      }));
    }
    assert.equal(result.created, true);
    const evidence = result.job.evidence;
    assert.throws(
      () => validateReflectionOutput({
        noteOperations: [],
        traitProposals: [{
          action: 'set',
          key: 'communication_style',
          value: 'concise',
          scope: 'global',
          confidence: 0.9,
          evidenceRefs: [evidence.userEvidenceRefs[0]]
        }],
        capabilityGapProposals: [],
        summary: 'global without cross-chat evidence'
      }, { evidence }),
      (error) => error.code === 'REFLECTION_EVIDENCE_GATE'
        && error.details.gate.reasons.includes('insufficient-global-chats')
    );
  } finally {
    sameChat.close();
  }

  const crossChat = storeFor('cross-chat');
  try {
    let result;
    for (const [sessionId, chatKey] of [
      ['cross-1', 'group:100'],
      ['cross-2', 'group:200'],
      ['cross-3', 'group:100']
    ]) {
      result = crossChat.enqueueObservation(completionEvent({
        sessionId,
        chatKey,
        evidenceIds: [`message:${sessionId}`]
      }));
    }
    assert.equal(result.created, true);
    assert.equal(result.job.evidence.validSessionCount, 3);
    assert.equal(result.job.evidence.userEvidenceCount, 3);
    assert.equal(result.job.evidence.userEvidenceChatCount, 2);
    const output = validateReflectionOutput({
      noteOperations: [],
      traitProposals: [{
        action: 'set',
        key: 'communication_style',
        value: 'concise',
        scope: 'global',
        confidence: 0.9,
        evidenceRefs: [result.job.evidence.userEvidenceRefs[0]]
      }],
      capabilityGapProposals: [],
      summary: 'cross-chat global evidence'
    }, { evidence: result.job.evidence });
    assert.equal(output.traitProposals[0].scope, 'global');
  } finally {
    crossChat.close();
  }
});
