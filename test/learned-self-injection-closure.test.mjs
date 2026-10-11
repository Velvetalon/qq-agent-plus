import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ReflectionStore,
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

function event(sessionId, chatKey) {
  return {
    eventId: `event-${sessionId}`,
    observerId: 'self-evolution.reflection',
    observerPluginId: 'self-evolution',
    accountId: 'lsr4-account',
    sessionId,
    runId: `run-${sessionId}`,
    chatKey,
    observationWindowId: 'lsr4-window',
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
  try {
    let result;
    for (const [sessionId, chatKey] of [
      ['closure-1', 'group:100'],
      ['closure-2', 'group:200'],
      ['closure-3', 'group:100']
    ]) {
      result = store.enqueueObservation(event(sessionId, chatKey));
    }
    assert.equal(result.created, true);
    const generation = store.beginWorkerGeneration({ owner: 'lsr4-test' });
    const claimed = store.claimNextJob({
      owner: 'lsr4-test',
      generation,
      leaseMs: 60000,
      workerLeaseMs: 60000
    });
    const committed = store.commitReflectionResult({
      job: claimed.job,
      owner: 'lsr4-test',
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
          value: '简短',
          scope: 'global',
          confidence: 0.9,
          evidenceRefs: [result.job.evidence.userEvidenceRefs[0]]
        }],
        capabilityGapProposals: [],
        summary: 'closure'
      }
    });
    assert.equal(committed.jobStatus, 'ready');
    const reviewed = store.reviewBatch({
      batchId: committed.batchId,
      decision: 'approve',
      actor: 'lsr4-reviewer',
      expectedProfileRevision: 0,
      basePersona: BASE_PERSONA
    });
    assert.equal(reviewed.profileRevision, 1);

    const active = store.getLearnedSelfContext({
      accountId: 'lsr4-account',
      chatKey: 'group:100',
      basePersona: BASE_PERSONA
    });
    assert.equal(active.context.communication_style.value, '简短');
    assert.equal(active.context.communication_style.scope, 'global');
    assert.equal(active.context.communication_style.evidenceCount, 1);
    assert.equal(active.context.communication_style.expiresAt, 1100);
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
    assert.match(provided.blocks[0].text, /scope=global/);
    assert.match(provided.blocks[0].text, /evidence=1/);
    assert.match(provided.blocks[0].text, /expiresAt=1970-01-01/);

    now = 1101;
    const expired = store.getLearnedSelfContext({
      accountId: 'lsr4-account',
      chatKey: 'group:100',
      basePersona: BASE_PERSONA
    });
    assert.equal(expired.context.communication_style, undefined);
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
      action: 'remove',
      expectedCurrentRevision: 1,
      basePersona: BASE_PERSONA,
      actor: 'lsr4-admin',
      reason: 'user correction',
      confirm: true
    });
    assert.equal(corrected.revision, 2);
    assert.equal(store.getLearnedSelfContext({
      accountId: 'lsr4-account',
      basePersona: BASE_PERSONA
    }).context.communication_style, undefined);
    const metrics = store.learnedSelfMetrics({ accountId: 'lsr4-account' });
    assert.equal(metrics.currentRevision, 2);
    assert.equal(metrics.injectedCount, 0);
    assert.equal(metrics.globalPromotionCount, 1);
  } finally {
    store.close();
  }
});
