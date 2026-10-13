import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ReflectionStore,
  ReflectionWorker,
  createLearnedSelfContextProvider,
  hashBasePersona,
  reflectionDatabasePath
} from '../src/plugins/self-evolution/index.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-lsr4-injection-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const BASE_PERSONA = {
  roleText: 'stable base',
  behaviorProfile: 'legacy',
  botName: 'lsr4-bot'
};

function currentTrait(context, key, subject = 'user:user-1') {
  return Object.values(context || {}).find((entry) => (
    entry?.key === key && entry.subject === subject
  ));
}

function event(sessionId, chatKey) {
  const interactionId = `interaction-${sessionId}`;
  const rootId = `root-${sessionId}`;
  return {
    schemaVersion: 3,
    eventId: `event-${sessionId}`,
    observerId: 'self-evolution.reflection',
    observerPluginId: 'self-evolution',
    accountId: 'lsr4-account',
    sessionId,
    runId: `run-${sessionId}`,
    chatKey,
    interactionId,
    topicId: 'lsr4-topic',
    originalSourceIds: [rootId],
    evidenceVersion: 3,
    resultClass: 'done',
    actionSummary: {
      evidenceVersion: 3,
      interactionId,
      topicId: 'lsr4-topic',
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
        sourceRecordId: `local-${sessionId}`,
        originalSourceId: rootId,
        interactionId,
        topicId: 'lsr4-topic',
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

test('LSR4 stores metadata, filters expired traits, exposes provider diagnostics, and supports correction', async () => {
  let now = 1000;
  const store = new ReflectionStore({
    filename: reflectionDatabasePath(path.join(root, 'closure')),
    now: () => now,
    limits: {
      leaseMs: 60000,
      workerLeaseMs: 60000,
      backoffMs: 0,
      traitTtlMs: 100
    }
  });
  const worker = new ReflectionWorker({
    store,
    owner: 'lsr4-test',
    now: () => now,
    reflector: async ({ job, reflectionInput }) => ({
      noteOperations: [],
      traitProposals: [{
        action: 'set',
        key: 'communication_style',
        value: '简短',
        subject: 'user:user-1',
        candidateId: reflectionInput.existingCandidates
          .find((candidate) => candidate.key === 'communication_style'
            && candidate.value === '简短')?.candidateId,
        scope: 'chat',
        chatKey: 'group:100',
        confidence: 0.9,
        supportRefs: job.evidence.traitEvidencePool.map((item) => item.sourceRef),
        counterRefs: []
      }],
      capabilityGapProposals: [],
      summary: 'closure'
    })
  });
  worker.start({ enabled: true, pollIntervalMs: 100000, basePersona: BASE_PERSONA });
  try {
    const sessions = ['closure-1', 'closure-2', 'closure-3'];
    for (const sessionId of sessions) {
      const chatKey = 'group:100';
      assert.equal(store.enqueueObservation(event(sessionId, chatKey)).created, true);
    }
    for (const _sessionId of sessions) {
      assert.equal((await worker.runOnce()).status, 'completed');
    }
    const [candidate] = store.listCandidates({
      accountId: 'lsr4-account',
      chatKey: 'group:100',
      status: 'ready'
    });
    assert.ok(candidate);
    assert.equal(candidate.supportingEvidence.length, 3);
    const reviewed = store.reviewCandidate({
      proposalId: candidate.proposalId,
      decision: 'approve',
      actor: 'lsr4-reviewer',
      expectedProfileRevision: 0,
      basePersonaHash: hashBasePersona(BASE_PERSONA)
    });
    assert.equal(reviewed.profileRevision, 1);

    const active = store.getLearnedSelfContext({
      accountId: 'lsr4-account',
      chatKey: 'group:100',
      basePersona: BASE_PERSONA
    });
    const activeTrait = currentTrait(active.context, 'communication_style');
    assert.equal(activeTrait.value, '简短');
    assert.equal(activeTrait.scope, 'chat');
    assert.equal(activeTrait.evidenceCount, 3);
    assert.equal(activeTrait.expiresAt, 1100);
    assert.equal(active.expiredTraitCount, 0);

    const provider = createLearnedSelfContextProvider({
      getStore: () => store,
      getBasePersona: () => BASE_PERSONA
    });
    const provided = await provider.provide({
      accountId: 'lsr4-account',
      chatKey: 'group:100',
      basePersonaHash: hashBasePersona(BASE_PERSONA)
    });
    assert.equal(provided.blocks.length, 1);
    assert.match(provided.blocks[0].text, /scope=chat/);
    assert.match(provided.blocks[0].text, /evidence=3/);
    assert.match(provided.blocks[0].text, /expiresAt=1970-01-01/);

    now = 1101;
    const expired = store.getLearnedSelfContext({
      accountId: 'lsr4-account',
      chatKey: 'group:100',
      basePersona: BASE_PERSONA
    });
    assert.equal(currentTrait(expired.context, 'communication_style'), undefined);
    assert.equal(expired.expiredTraitCount, 1);
    const expiredProvided = await provider.provide({
      accountId: 'lsr4-account',
      chatKey: 'group:100',
      basePersonaHash: hashBasePersona(BASE_PERSONA)
    });
    assert.equal(expiredProvided.blocks.length, 0);
    assert.equal(expiredProvided.diagnostics.expiredTraitCount, 1);

    const corrected = store.correctProfileTrait({
      accountId: 'lsr4-account',
      key: 'communication_style',
      subject: 'user:user-1',
      scope: 'chat',
      chatKey: 'group:100',
      action: 'remove',
      expectedCurrentRevision: 1,
      basePersona: BASE_PERSONA,
      actor: 'lsr4-admin',
      reason: 'user correction',
      confirm: true
    });
    assert.equal(corrected.revision, 2);
    const afterCorrection = store.getLearnedSelfContext({
      accountId: 'lsr4-account',
      chatKey: 'group:100',
      basePersona: BASE_PERSONA
    });
    assert.equal(currentTrait(afterCorrection.context, 'communication_style'), undefined);
    const metrics = store.learnedSelfMetrics({ accountId: 'lsr4-account' });
    assert.equal(metrics.currentRevision, 2);
    assert.equal(metrics.injectedCount, 0);
    assert.equal(metrics.globalPromotionCount, 0);
  } finally {
    await worker.stop();
    store.close();
  }
});
