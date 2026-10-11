import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ReflectionStore,
  hashBasePersona,
  reflectionDatabasePath,
  validateReflectionOutput
} from '../src/plugins/self-evolution/index.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-lsr3-policy-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const BASE_PERSONA = {
  roleText: 'stable base',
  behaviorProfile: 'legacy',
  botName: 'policy-bot'
};

function event(sessionId, chatKey) {
  return {
    eventId: `event-${sessionId}`,
    observerId: 'self-evolution.reflection',
    observerPluginId: 'self-evolution',
    accountId: 'lsr3-account',
    sessionId,
    runId: `run-${sessionId}`,
    chatKey,
    observationWindowId: 'lsr3-window',
    evidenceVersion: 3,
    resultClass: 'done',
    actionSummary: {
      evidenceVersion: 3,
      sentCount: 1,
      finishReason: 'finish',
      outboundAttempted: true,
      participation: { mode: 'auto', decision: 'reply', reasonCode: 'normal' },
      termination: { kind: 'finish' },
      outbound: { attempted: 1, succeeded: 1, failed: 0, unknown: 0, held: 0 },
      conversationEvidence: [{
        evidenceId: `message:${sessionId}`,
        sourceRecordId: sessionId,
        role: 'user',
        userEvidence: true,
        userConfirmed: true,
        text: `用户偏好 ${sessionId}`
      }]
    },
    sourceMessageIds: [sessionId],
    completedAt: 1000
  };
}

function seedReadyJob(store) {
  let result;
  for (const [sessionId, chatKey] of [
    ['policy-1', 'group:100'],
    ['policy-2', 'group:200'],
    ['policy-3', 'group:100']
  ]) {
    result = store.enqueueObservation(event(sessionId, chatKey));
  }
  assert.equal(result.created, true);
  const generation = store.beginWorkerGeneration({ owner: 'lsr3-test' });
  const claimed = store.claimNextJob({
    owner: 'lsr3-test',
    generation,
    leaseMs: 60000,
    workerLeaseMs: 60000
  });
  assert.equal(claimed.status, 'claimed');
  return { generation, job: claimed.job };
}

test('LSR3 rejects procedural traits and keeps bounded_auto behavior traits pending', () => {
  const store = new ReflectionStore({
    filename: reflectionDatabasePath(path.join(root, 'policy')),
    now: () => 1000,
    limits: { leaseMs: 60000, workerLeaseMs: 60000, backoffMs: 0 }
  });
  try {
    const { generation, job } = seedReadyJob(store);
    const validEvidence = job.evidence;
    assert.throws(
      () => validateReflectionOutput({
        noteOperations: [],
        traitProposals: [{
          action: 'set',
          key: 'communication_style',
          value: 'result=120 后重试 queue',
          scope: 'global',
          confidence: 0.99,
          evidenceRefs: [validEvidence.userEvidenceRefs[0]]
        }],
        capabilityGapProposals: [],
        summary: 'procedural'
      }, { evidence: validEvidence }),
      (error) => error.code === 'REFLECTION_PROCEDURAL_TRAIT'
    );

    const committed = store.commitReflectionResult({
      job,
      owner: 'lsr3-test',
      generation,
      mode: 'bounded_auto',
      basePersona: BASE_PERSONA,
      basePersonaHash: hashBasePersona(BASE_PERSONA),
      expectedProfileRevision: 0,
      output: {
        noteOperations: [],
        traitProposals: [{
          action: 'set',
          key: 'communication_style',
          value: '简短且具体',
          scope: 'global',
          confidence: 0.99,
          evidenceRefs: [validEvidence.userEvidenceRefs[0]]
        }],
        capabilityGapProposals: [],
        summary: 'abstract preference'
      }
    });
    assert.equal(committed.jobStatus, 'ready');
    assert.equal(committed.appliedTraitCount, 0);
    assert.equal(store.getLearnedSelfRevision({ accountId: 'lsr3-account' }), 0);
    const pending = store.listProposals({ batchId: committed.batchId })[0];
    assert.equal(pending.status, 'pending');
    assert.equal(store.listAudit({ accountId: 'lsr3-account' })
      .some((row) => row.code === 'REFLECTION_BEHAVIOR_REVIEW_REQUIRED'), true);

    const reviewed = store.reviewBatch({
      batchId: committed.batchId,
      decision: 'approve',
      actor: 'lsr3-reviewer',
      expectedProfileRevision: 0,
      basePersona: BASE_PERSONA
    });
    assert.equal(reviewed.reviewed, true);
    assert.equal(reviewed.profileRevision, 1);
  } finally {
    store.close();
  }
});
