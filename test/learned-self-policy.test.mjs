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
  const interactionId = `interaction-${sessionId}`;
  const rootId = `root-${sessionId}`;
  const sourceId = `local-${sessionId}`;
  return {
    schemaVersion: 3,
    eventId: `event-${sessionId}`,
    observerId: 'self-evolution.reflection',
    observerPluginId: 'self-evolution',
    accountId: 'lsr3-account',
    sessionId,
    runId: `run-${sessionId}`,
    chatKey,
    interactionId,
    topicId: 'policy-topic',
    originalSourceIds: [rootId],
    evidenceVersion: 3,
    resultClass: 'done',
    actionSummary: {
      evidenceVersion: 3,
      interactionId,
      topicId: 'policy-topic',
      originalSourceIds: [rootId],
      sentCount: 1,
      finishReason: 'finish',
      outboundAttempted: true,
      participation: { mode: 'auto', decision: 'reply', reasonCode: 'normal' },
      termination: { kind: 'finish' },
      outbound: { attempted: 1, succeeded: 1, failed: 0, unknown: 0, held: 0 },
      conversationEvidence: [{
        evidenceId: `message:${sessionId}`,
        sourceRecordType: 'message',
        sourceRecordId: sourceId,
        originalSourceId: rootId,
        interactionId,
        topicId: 'policy-topic',
        senderId: 'user-1',
        role: 'user',
        userConfirmed: false,
        text: `用户偏好 ${sessionId}`
      }]
    },
    sourceMessageIds: [sessionId],
    completedAt: 1000
  };
}

function seedReadyJob(store) {
  let result;
  for (const sessionId of ['policy-1', 'policy-2', 'policy-3']) {
    const chatKey = 'group:100';
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

test('procedural claims reject per item; behavior candidates stay pending until explicit review', () => {
  const store = new ReflectionStore({
    filename: reflectionDatabasePath(path.join(root, 'policy')),
    now: () => 1000,
    limits: { leaseMs: 60000, workerLeaseMs: 60000, backoffMs: 0 }
  });
  try {
    const { generation, job } = seedReadyJob(store);
    const validEvidence = job.evidence;
    const rejected = validateReflectionOutput({
        noteOperations: [],
        traitProposals: [{
          action: 'set',
          key: 'communication_style',
          value: 'result=120 后重试 queue',
          subject: 'user:user-1',
          scope: 'chat',
          chatKey: 'group:100',
          confidence: 0.99,
          supportRefs: validEvidence.traitEvidencePool.map((item) => item.sourceRef),
          counterRefs: []
        }],
        capabilityGapProposals: [],
        summary: 'procedural'
      }, { evidence: validEvidence });
    assert.equal(rejected.rejectedTraitProposals[0].code, 'REFLECTION_PROCEDURAL_TRAIT');

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
          subject: 'user:user-1',
          scope: 'chat',
          chatKey: 'group:100',
          confidence: 0.99,
          supportRefs: validEvidence.traitEvidencePool.map((item) => item.sourceRef),
          counterRefs: []
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

    const [candidate] = store.listCandidates({
      accountId: 'lsr3-account',
      chatKey: 'group:100',
      status: 'pending'
    });
    assert.ok(['pending_insufficient', 'ready'].includes(candidate.status));
    assert.equal(candidate.eligible, candidate.status === 'ready');
    const reviewed = store.reviewCandidate({
      proposalId: candidate.proposalId,
      decision: 'approve',
      actor: 'lsr3-reviewer',
      expectedProfileRevision: 0,
      basePersonaHash: hashBasePersona(BASE_PERSONA)
    });
    if (candidate.eligible) {
      assert.equal(reviewed.reviewed, true);
      assert.equal(reviewed.profileRevision, 1);
    } else {
      assert.equal(reviewed.reviewed, false);
      assert.match(reviewed.reason, /insufficient-/);
    }
    assert.equal(store.getLearnedSelfRevision({ accountId: 'lsr3-account' }),
      candidate.eligible ? 1 : 0);
  } finally {
    store.close();
  }
});
