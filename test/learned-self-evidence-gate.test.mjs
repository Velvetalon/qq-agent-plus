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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-memory-v1-evidence-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

let seq = 0;
function completionEvent({
  sessionId,
  interactionId = `interaction-${sessionId}`,
  chatKey = 'group:100',
  rootId = `root-${sessionId}`,
  role = 'user',
  evidenceVersion = 3,
  schemaVersion = 3,
  proactive = false,
  explicitSilence = false,
  delivered = role === 'assistant',
  originalSourceType = role === 'user' ? 'message' : 'outbound'
} = {}) {
  const sourceId = `local-${sessionId}`;
  return {
    schemaVersion,
    evidenceVersion,
    eventId: `event-${sessionId}`,
    observerId: 'self-evolution.reflection',
    observerPluginId: 'self-evolution',
    accountId: 'memory-v1-account',
    sessionId,
    runId: `run-${sessionId}`,
    chatKey,
    interactionId,
    topicId: 'topic-memory-v1',
    originalSourceIds: role === 'user' ? [rootId] : [],
    triggerKind: 'human_message',
    deliveryState: delivered ? 'sent' : 'not_attempted',
    delivered,
    proactive,
    resultClass: explicitSilence ? 'done' : 'done',
    completedAt: 1000 + seq++,
    actionSummary: {
      schemaVersion,
      evidenceVersion,
      interactionId,
      topicId: 'topic-memory-v1',
      originalSourceIds: role === 'user' ? [rootId] : [],
      proactive,
      delivered,
      deliveryState: delivered ? 'sent' : 'not_attempted',
      termination: { kind: explicitSilence ? 'explicit_silence' : 'finish' },
      outbound: delivered
        ? { attempted: 1, succeeded: 1, failed: 0, unknown: 0, held: 0 }
        : { attempted: 0, succeeded: 0, failed: 0, unknown: 0, held: 0 },
      conversationEvidence: [{
        evidenceId: `message:${sessionId}`,
        sourceRecordType: originalSourceType,
        sourceRecordId: sourceId,
        messageId: sourceId,
        platformMessageId: `platform-${sessionId}`,
        role,
        senderId: role === 'user' ? 'member-7' : 'bot-1',
        interactionId,
        topicId: 'topic-memory-v1',
        originalSourceId: role === 'user' ? rootId : '',
        originalSourceIds: role === 'user' ? [rootId] : [],
        delivered: role === 'assistant' && delivered,
        text: role === 'user' ? 'I enjoy astronomy.' : 'Assistant delivery context.',
        userConfirmed: false
      }]
    }
  };
}

function storeFor(label, limits = {}) {
  return new ReflectionStore({
    filename: reflectionDatabasePath(path.join(root, `${label}-${seq++}`)),
    now: () => 1000,
    limits: { leaseMs: 60000, workerLeaseMs: 60000, backoffMs: 0, ...limits }
  });
}

function proposal(evidence, overrides = {}) {
  const source = evidence.traitEvidencePool?.[0];
  return {
    action: 'set',
    key: 'topic_interests',
    value: 'enjoys astronomy',
    subject: 'user:member-7',
    scope: 'chat',
    chatKey: evidence.chatKey,
    confidence: 0.9,
    supportRefs: source ? [source.sourceRef] : [],
    counterRefs: [],
    ...overrides
  };
}

test('only schemaVersion 3 plus evidenceVersion 3 qualifies as structured preference provenance', () => {
  const normalized = normalizeCompletionObservation(completionEvent({
    sessionId: 'v3-source'
  }));
  assert.equal(normalized.schemaVersion, 3);
  assert.equal(normalized.structuredEvidence, true);
  assert.equal(normalized.conversationEvidence[0].userEvidence, true);
  assert.equal(normalized.conversationEvidence[0].userConfirmed, false);
  assert.equal(normalized.explicitPreference, false);

  const legacy = normalizeCompletionObservation(completionEvent({
    sessionId: 'v2-source',
    schemaVersion: 2,
    evidenceVersion: 3
  }));
  assert.equal(legacy.structuredEvidence, false);
  assert.equal(legacy.conversationEvidence[0].userEvidence, false);
  const rejectedLegacyTrait = validateReflectionOutput({
    noteOperations: [],
    traitProposals: [proposal(legacy, {
      supportRefs: [legacy.conversationEvidence[0].sourceRef]
    })],
    capabilityGapProposals: [],
    summary: 'legacy evidence remains history only'
  }, { evidence: legacy });
  assert.equal(rejectedLegacyTrait.traitProposals.length, 0);
  assert.equal(rejectedLegacyTrait.rejectedTraitProposals[0].code, 'REFLECTION_SOURCE_LINEAGE');
});

test('assistant-only proactive evidence cannot support traits, while human silence remains reflectable', () => {
  const store = storeFor('silence');
  try {
    const assistant = store.enqueueObservation(completionEvent({
      sessionId: 'assistant-only',
      role: 'assistant',
      proactive: true,
      delivered: true
    }));
    assert.equal(assistant.created, true);
    assert.equal(assistant.job.evidence.traitEvidencePool.length, 0);
    assert.equal(assistant.job.evidence.traitGate.eligible, false);

    const silence = store.enqueueObservation(completionEvent({
      sessionId: 'human-silence',
      explicitSilence: true
    }));
    assert.equal(silence.created, true);
    assert.equal(silence.job.evidence.explicitSilence, true);
    assert.equal(silence.job.evidence.traitGate.eligible, false);
  } finally {
    store.close();
  }
});

test('three independent current human roots accumulate by interaction identity in one chat', () => {
  const store = storeFor('accumulate');
  try {
    let third;
    for (let index = 1; index <= 3; index += 1) {
      const event = completionEvent({
        sessionId: `independent-${index}`,
        interactionId: `causal-interaction-${index}`,
        rootId: `human-root-${index}`
      });
      const result = store.enqueueObservation(event);
      assert.equal(result.created, true);
      third = result;
    }
    const pool = third.job.evidence.traitEvidencePool;
    assert.equal(new Set(pool.map((item) => item.interactionId)).size, 3);
    assert.equal(new Set(pool.map((item) => item.originalSourceId)).size, 3);
    assert.equal(third.job.evidence.traitGate.eligible, true);

    const normalized = validateReflectionOutput({
      noteOperations: [],
      traitProposals: [proposal(third.job.evidence, {
        supportRefs: pool.map((item) => item.sourceRef)
      })],
      capabilityGapProposals: [],
      summary: 'three roots for one scoped candidate'
    }, { evidence: third.job.evidence });
    assert.equal(normalized.traitProposals[0].evidenceGate.eligible, true);
  } finally {
    store.close();
  }
});

test('one source, a forged reference, and global scope cannot become an adoptable candidate', () => {
  const store = storeFor('reject-invalid');
  try {
    const one = store.enqueueObservation(completionEvent({
      sessionId: 'single-source',
      interactionId: 'single-interaction',
      rootId: 'single-root'
    }));
    const oneProposal = validateReflectionOutput({
      noteOperations: [],
      traitProposals: [proposal(one.job.evidence)],
      capabilityGapProposals: [],
      summary: 'candidate remains below threshold'
    }, { evidence: one.job.evidence });
    assert.equal(oneProposal.traitProposals[0].evidenceGate.eligible, false);
    assert.ok(oneProposal.traitProposals[0].evidenceGate.reasons.includes('insufficient-interactions'));

    const forged = validateReflectionOutput({
      noteOperations: [],
      traitProposals: [proposal(one.job.evidence, { supportRefs: ['message:someone-else'] })],
      capabilityGapProposals: [],
      summary: 'forged source is rejected independently'
    }, { evidence: one.job.evidence });
    assert.equal(forged.traitProposals.length, 0);
    assert.equal(forged.rejectedTraitProposals[0].code, 'REFLECTION_SOURCE_LINEAGE');

    const global = validateReflectionOutput({
      noteOperations: [],
      traitProposals: [proposal(one.job.evidence, { scope: 'global', chatKey: '' })],
      capabilityGapProposals: [],
      summary: 'cross-chat promotion requires authorized abstract evidence'
    }, { evidence: one.job.evidence });
    assert.equal(global.traitProposals.length, 0);
    assert.equal(global.rejectedTraitProposals[0].code, 'REFLECTION_SCOPE');
  } finally {
    store.close();
  }
});

test('A-E04/A-L05 derived summaries, forwarded records and repeated roots cannot manufacture independent support', () => {
  const store = storeFor('derived-and-replayed');
  try {
    for (const originalSourceType of ['summary', 'forward', 'notebook']) {
      const result = store.enqueueObservation(completionEvent({ sessionId: 'derived-' + originalSourceType, originalSourceType }));
      assert.equal(result.job.evidence.traitEvidencePool.length, 0);
      assert.equal(result.job.evidence.traitGate.eligible, false);
      assert.ok(result.job.evidence.conversationEvidence.every((entry) => !entry.userEvidence));
    }
    const original = completionEvent({ sessionId: 'original', rootId: 'one-root', interactionId: 'one-interaction' });
    assert.equal(store.enqueueObservation(original).created, true);
    assert.equal(store.enqueueObservation(original).created, false);
    for (let index = 0; index < 3; index += 1) {
      const result = store.enqueueObservation(completionEvent({ sessionId: 'split-' + index, rootId: 'one-root', interactionId: 'one-interaction' }));
      assert.equal(result.job.evidence.traitGate.eligible, false);
      assert.equal(new Set(result.job.evidence.traitEvidencePool.map((entry) => entry.originalSourceId)).size, 1);
    }
    assert.equal(store.getLearnedSelfRevision({ accountId: 'memory-v1-account' }), 0);
  } finally { store.close(); }
});
