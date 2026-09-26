import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PluginManager } from '../src/plugins/manager.js';
import {
  NotebookStore,
  ReflectionStore,
  ReflectionWorker,
  createReflectionObserver,
  createReflectionPlugin,
  hashBasePersona,
  openReflectionStore,
  reflectionDatabasePath
} from '../src/plugins/self-evolution/index.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-p6-reflection-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

let sequence = 0;
const ACCOUNT_ID = 'bot-1';
const OBSERVER_ID = 'self-evolution.reflection';

function fixture(options = {}) {
  const dataDir = path.join(root, `case-${++sequence}`);
  const filename = reflectionDatabasePath(dataDir);
  const clock = { value: 1000 };
  const now = () => clock.value;
  const store = new ReflectionStore({
    dataDir,
    filename,
    now,
    limits: {
      leaseMs: 10,
      workerLeaseMs: 10,
      maxAttempts: 2,
      maxCallsPerDay: 20,
      backoffMs: 0,
      ...options.limits
    }
  });
  return { dataDir, filename, clock, now, store };
}

function persona(overrides = {}) {
  return {
    roleText: 'base persona body',
    behaviorProfile: 'legacy',
    botName: 'test-bot',
    selfNickname: 'tester',
    customRules: 'stay in scope',
    tools: [
      { name: 'notebook_search', effect: 'read', terminal: false },
      { name: 'notebook_append', effect: 'local-write', terminal: false }
    ],
    auth: { accountToken: 'secret-token' },
    ...overrides
  };
}

function completionEvent(sessionId, overrides = {}) {
  const eventId = overrides.eventId || `${sessionId}:${OBSERVER_ID}`;
  return {
    eventId,
    observerId: OBSERVER_ID,
    observerPluginId: 'self-evolution',
    accountId: ACCOUNT_ID,
    sessionId,
    runId: `run-${sessionId}`,
    chatKey: 'group:100',
    pluginGeneration: 1,
    resultClass: 'done',
    actionSummary: {
      sentCount: 1,
      finishReason: 'finish',
      outboundAttempted: true,
      participation: {
        mode: 'auto',
        decision: 'reply',
        reasonCode: 'normal',
        reason: 'normal turn'
      },
      termination: {
        kind: 'finish',
        reasonCode: '',
        reason: '',
        threadDisposition: 'active',
        blocked: false
      },
      outbound: {
        attempted: 1,
        succeeded: 1,
        failed: 0,
        unknown: 0,
        held: 0
      }
    },
    sourceMessageIds: ['m1', 'm2'],
    completedAt: 1000,
    ...overrides
  };
}

function evidenceRef(sessionId) {
  return `session:${sessionId}`;
}

function reflectionOutput(sessionId, overrides = {}) {
  return {
    noteOperations: [],
    traitProposals: [],
    capabilityGapProposals: [],
    summary: `reflection for ${sessionId}`,
    ...overrides
  };
}

function startWorker(store, reflector, limits = {}, options = {}) {
  const worker = new ReflectionWorker({
    store,
    reflector,
    owner: options.owner || `worker-${sequence}`,
    limits: {
      leaseMs: 10,
      workerLeaseMs: 10,
      maxCallsPerDay: 20,
      ...limits
    },
    now: options.now
  });
  const started = worker.start({
    enabled: true,
    pollIntervalMs: 100000,
    basePersona: options.basePersona || persona()
  });
  assert.equal(started.started, true);
  return worker;
}

function currentProfileRevision(store, basePersona = persona()) {
  return store.getLearnedSelfContext({
    accountId: ACCOUNT_ID,
    basePersonaHash: hashBasePersona(basePersona)
  }).revision;
}

async function runQueued(worker, store, {
  mode = 'review',
  basePersona = persona(),
  expectedProfileRevision = currentProfileRevision(store, basePersona)
} = {}) {
  return worker.runOnce({
    basePersona,
    mode,
    expectedProfileRevision
  });
}

test('same observation window creates one idempotent job and rejects direct reflection sources', () => {
  const { store } = fixture();
  try {
    const first = store.enqueueObservation(completionEvent('session-1'));
    const replay = store.enqueueObservation({
      ...completionEvent('session-1'),
      eventId: 'different-event-id'
    });
    assert.equal(first.created, true);
    assert.equal(replay.created, false);
    assert.equal(replay.reason, 'duplicate');
    assert.equal(store.listJobs().length, 1);
    assert.throws(
      () => store.enqueueObservation(completionEvent('session-1'), { sourceKind: 'reflection' }),
      (error) => error.code === 'REFLECTION_SOURCE_LINEAGE'
    );
  } finally {
    store.close();
  }
});

test('expired job leases are recoverable and the old owner cannot commit late', () => {
  const { store, clock } = fixture();
  try {
    const enqueued = store.enqueueObservation(completionEvent('session-lease'));
    const jobId = enqueued.job.id;
    const generationOne = store.beginWorkerGeneration({ owner: 'worker-one' });
    const first = store.claimNextJob({ owner: 'worker-one', generation: generationOne });
    assert.equal(first.status, 'claimed');
    assert.equal(first.job.id, jobId);
    assert.equal(first.job.status, 'leased');
    assert.equal(first.job.attempts, 1);

    clock.value += 20;
    const generationTwo = store.beginWorkerGeneration({ owner: 'worker-two' });
    const second = store.claimNextJob({ owner: 'worker-two', generation: generationTwo });
    assert.equal(second.status, 'claimed');
    assert.equal(second.job.id, jobId);
    assert.equal(second.job.attempts, 2);

    const late = store.completeNoop({
      job: first.job,
      owner: 'worker-one',
      generation: generationOne
    });
    assert.equal(late.accepted, false);
    assert.equal(late.reason, 'stale-lease');
    const completed = store.completeNoop({
      job: second.job,
      owner: 'worker-two',
      generation: generationTwo
    });
    assert.equal(completed.accepted, true);
    assert.equal(store.listJobs().find((job) => job.id === jobId).status, 'noop');
  } finally {
    store.close();
  }
});

test('budget defers without spending a model attempt and failures retry finitely', async () => {
  const budgetFixture = fixture();
  let budgetCalls = 0;
  const budgetWorker = startWorker(budgetFixture.store, async () => {
    budgetCalls += 1;
    return reflectionOutput('session-budget');
  }, { maxCallsPerDay: 1 }, { basePersona: persona() });
  try {
    budgetFixture.store.enqueueObservation(completionEvent('session-budget-1'));
    budgetFixture.store.enqueueObservation(completionEvent('session-budget-2'));
    const first = await runQueued(budgetWorker, budgetFixture.store);
    assert.equal(first.status, 'noop');
    const second = await runQueued(budgetWorker, budgetFixture.store);
    assert.equal(second.status, 'budget');
    assert.equal(budgetCalls, 1);
    const deferred = budgetFixture.store.listJobs()
      .find((job) => job.status === 'pending');
    assert.equal(deferred.status, 'pending');
    assert.equal(deferred.attempts, 0);
  } finally {
    await budgetWorker.stop();
    budgetFixture.store.close();
  }

  const retryFixture = fixture({ limits: { maxAttempts: 2, backoffMs: 0 } });
  let retryCalls = 0;
  const retryWorker = startWorker(retryFixture.store, async () => {
    retryCalls += 1;
    if (retryCalls <= 2) throw new Error('transient reflection failure');
    return reflectionOutput('session-retry');
  }, { maxAttempts: 2, backoffMs: 0 }, { basePersona: persona() });
  try {
    retryFixture.store.enqueueObservation(completionEvent('session-retry'));
    const first = await runQueued(retryWorker, retryFixture.store);
    assert.equal(first.status, 'retry');
    assert.equal(first.retry, 'pending');
    const second = await runQueued(retryWorker, retryFixture.store);
    assert.equal(second.status, 'retry');
    assert.equal(second.retry, 'failed');
    const third = await runQueued(retryWorker, retryFixture.store);
    assert.equal(third.status, 'empty');
    assert.equal(retryCalls, 2);
    assert.equal(retryFixture.store.listJobs()[0].status, 'failed');
  } finally {
    await retryWorker.stop();
    retryFixture.store.close();
  }
});

test('empty reflection is a noop, duplicate evidence is not called again, and invalid output changes no business state', async () => {
  const { store } = fixture();
  let calls = 0;
  const worker = startWorker(store, async () => {
    calls += 1;
    return reflectionOutput('session-noop');
  });
  try {
    store.enqueueObservation(completionEvent('session-noop'));
    const noop = await runQueued(worker, store);
    assert.equal(noop.status, 'noop');
    assert.equal(calls, 1);
    assert.equal(store.counts().proposals, 0);
    assert.equal(store.counts().profileVersions, 0);

    const duplicate = store.enqueueObservation(completionEvent('session-noop'));
    assert.equal(duplicate.created, false);
    const empty = await runQueued(worker, store);
    assert.equal(empty.status, 'empty');
    assert.equal(calls, 1);
  } finally {
    await worker.stop();
    store.close();
  }

  const invalidFixture = fixture();
  const invalidWorker = startWorker(invalidFixture.store, async () => ({
    ...reflectionOutput('session-invalid'),
    executeCode: 'return process.env'
  }));
  try {
    invalidFixture.store.enqueueObservation(completionEvent('session-invalid'));
    const result = await runQueued(invalidWorker, invalidFixture.store);
    assert.equal(result.status, 'invalid');
    assert.equal(invalidFixture.store.counts().proposals, 0);
    assert.equal(invalidFixture.store.counts().profileVersions, 0);
    assert.equal(invalidFixture.store.counts().capabilityGaps, 0);
    assert.equal(invalidFixture.store.listJobs()[0].status, 'invalid');
  } finally {
    await invalidWorker.stop();
    invalidFixture.store.close();
  }
});

test('review mode can approve or reject a proposal without mutating Base Persona', async () => {
  const { store } = fixture();
  const base = persona();
  const reflector = async ({ job }) => reflectionOutput(job.sessionId, {
    traitProposals: [{
      action: 'set',
      key: 'communication_style',
      value: 'concise',
      scope: 'global',
      confidence: 0.92,
      evidenceRefs: [evidenceRef(job.sessionId)]
    }]
  });
  const worker = startWorker(store, reflector, {}, { basePersona: base });
  try {
    store.enqueueObservation(completionEvent('session-review'));
    const reflected = await runQueued(worker, store, { basePersona: base });
    assert.equal(reflected.jobStatus, 'ready');
    const pending = store.listProposals({ status: 'pending' });
    assert.equal(pending.length, 1);
    const approved = store.reviewBatch({
      batchId: pending[0].batchId,
      decision: 'approve',
      actor: 'admin-1',
      expectedProfileRevision: 0,
      basePersona: base
    });
    assert.equal(approved.reviewed, true);
    assert.equal(approved.profileRevision, 1);
    const context = store.getLearnedSelfContext({
      accountId: ACCOUNT_ID,
      basePersona: base
    });
    assert.equal(context.stale, false);
    assert.equal(context.context.communication_style.value, 'concise');
    assert.equal(base.roleText, 'base persona body');

    store.enqueueObservation(completionEvent('session-reject'));
    const reflectedAgain = await runQueued(worker, store, { basePersona: base });
    assert.equal(reflectedAgain.jobStatus, 'ready');
    const secondBatch = store.listProposals({ status: 'pending' })[0].batchId;
    const rejected = store.reviewBatch({
      batchId: secondBatch,
      decision: 'reject',
      actor: 'admin-1',
      expectedProfileRevision: 1,
      basePersona: base
    });
    assert.equal(rejected.reviewed, true);
    assert.equal(rejected.decision, 'reject');
    assert.equal(store.listProposals({ batchId: secondBatch })[0].status, 'rejected');
    assert.equal(currentProfileRevision(store, base), 1);
  } finally {
    await worker.stop();
    store.close();
  }
});

test('bounded_auto applies only allowlisted low-risk traits and leaves the rest pending', async () => {
  const { store } = fixture();
  const base = persona();
  const worker = startWorker(store, async () => reflectionOutput('session-auto', {
    traitProposals: [
      {
        action: 'set',
        key: 'communication_style',
        value: 'brief and concrete',
        scope: 'global',
        confidence: 0.95,
        evidenceRefs: [evidenceRef('session-auto')]
      },
      {
        action: 'set',
        key: 'social_strategy',
        value: 'lead every conversation',
        scope: 'global',
        confidence: 0.99,
        evidenceRefs: [evidenceRef('session-auto')]
      }
    ]
  }), {}, { basePersona: base });
  try {
    store.enqueueObservation(completionEvent('session-auto'));
    const result = await runQueued(worker, store, { mode: 'bounded_auto', basePersona: base });
    assert.equal(result.jobStatus, 'ready');
    const proposals = store.listProposals({ batchId: result.batchId });
    assert.deepEqual(
      proposals.map((proposal) => [proposal.payload.key, proposal.risk, proposal.status]),
      [
        ['communication_style', 'low', 'applied'],
        ['social_strategy', 'high', 'pending']
      ]
    );
    const context = store.getLearnedSelfContext({
      accountId: ACCOUNT_ID,
      basePersona: base
    });
    assert.equal(context.context.communication_style.value, 'brief and concrete');
    assert.equal(context.context.social_strategy, undefined);
    assert.equal(store.getBatch(result.batchId).expectedProfileRevision, 1);
    const reviewed = store.reviewBatch({
      batchId: result.batchId,
      decision: 'approve',
      actor: 'admin-1',
      expectedProfileRevision: 1,
      basePersona: base
    });
    assert.equal(reviewed.reviewed, true);
    assert.equal(reviewed.profileRevision, 2);
    assert.equal(store.getLearnedSelfContext({
      accountId: ACCOUNT_ID,
      basePersona: base
    }).context.social_strategy.value, 'lead every conversation');
  } finally {
    await worker.stop();
    store.close();
  }
});

test('review approval respects Notebook CAS and does not create a profile on a stale note', async () => {
  const { store, dataDir } = fixture();
  const notebook = new NotebookStore({ dataDir });
  const base = persona();
  try {
    const note = notebook.append({
      accountId: ACCOUNT_ID,
      content: 'original',
      scope: 'global',
      source: {
        kind: 'system',
        accountId: ACCOUNT_ID,
        sessionId: 'setup',
        runId: 'setup'
      },
      idempotencyKey: 'setup-note'
    });
    const worker = startWorker(store, async ({ job }) => reflectionOutput(job.sessionId, {
      noteOperations: [{
        operation: 'update',
        scope: 'global',
        noteId: note.note.id,
        expectedRevision: 1,
        content: 'reflection edit',
        evidenceRefs: [evidenceRef(job.sessionId)]
      }]
    }), {}, { basePersona: base });
    try {
      store.enqueueObservation(completionEvent('session-note-cas'));
      const reflected = await runQueued(worker, store, { basePersona: base });
      assert.equal(reflected.jobStatus, 'ready');
      notebook.update({
        accountId: ACCOUNT_ID,
        noteId: note.note.id,
        expectedRevision: 1,
        content: 'manual edit',
        source: {
          kind: 'system',
          accountId: ACCOUNT_ID,
          sessionId: 'manual',
          runId: 'manual'
        },
        idempotencyKey: 'manual-note-edit'
      });
      const reviewed = store.reviewBatch({
        batchId: reflected.batchId,
        decision: 'approve',
        actor: 'admin-1',
        expectedProfileRevision: 0,
        basePersona: base,
        notebook
      });
      assert.equal(reviewed.reviewed, false);
      assert.equal(reviewed.reason, 'stale');
      assert.equal(store.listProposals({ batchId: reflected.batchId })[0].status, 'stale');
      assert.equal(store.listJobs().find((job) => job.sessionId === 'session-note-cas').status, 'stale');
      assert.equal(store.counts().profileVersions, 0);
      assert.equal(notebook.get({
        accountId: ACCOUNT_ID,
        noteId: note.note.id,
        currentChatKey: 'group:100'
      }).content, 'manual edit');
    } finally {
      await worker.stop();
    }
  } finally {
    notebook.close();
    store.close();
  }
});

test('review approval cannot widen a chat note into global scope', async () => {
  const { store, dataDir } = fixture();
  const notebook = new NotebookStore({ dataDir });
  const base = persona();
  try {
    const note = notebook.append({
      accountId: ACCOUNT_ID,
      content: 'chat-only',
      scope: 'chat',
      chatKey: 'group:100',
      source: {
        kind: 'chat',
        accountId: ACCOUNT_ID,
        chatKey: 'group:100',
        sessionId: 'setup',
        runId: 'setup'
      },
      currentChatKey: 'group:100',
      idempotencyKey: 'setup-chat-note'
    });
    const worker = startWorker(store, async ({ job }) => reflectionOutput(job.sessionId, {
      noteOperations: [{
        operation: 'update',
        scope: 'global',
        noteId: note.note.id,
        expectedRevision: 1,
        content: 'attempted scope widening',
        evidenceRefs: [evidenceRef(job.sessionId)]
      }]
    }), {}, { basePersona: base });
    try {
      store.enqueueObservation(completionEvent('session-note-scope'));
      const reflected = await runQueued(worker, store, { basePersona: base });
      const reviewed = store.reviewBatch({
        batchId: reflected.batchId,
        decision: 'approve',
        actor: 'admin-1',
        expectedProfileRevision: 0,
        basePersona: base,
        notebook
      });
      assert.equal(reviewed.reviewed, false);
      assert.equal(reviewed.reason, 'invalid');
      assert.equal(notebook.get({
        accountId: ACCOUNT_ID,
        noteId: note.note.id,
        currentChatKey: 'group:100'
      }).content, 'chat-only');
    } finally {
      await worker.stop();
    }
  } finally {
    notebook.close();
    store.close();
  }
});

test('stale profile CAS and Base Persona changes invalidate old proposals without applying them', async () => {
  const { store } = fixture();
  const base = persona();
  const otherBase = persona({ roleText: 'manually edited persona' });
  const worker = startWorker(store, async ({ job }) => reflectionOutput(job.sessionId, {
    traitProposals: [{
      action: 'set',
      key: 'communication_style',
      value: 'stale proposal',
      scope: 'global',
      confidence: 0.9,
      evidenceRefs: [evidenceRef(job.sessionId)]
    }]
  }), {}, { basePersona: base });
  try {
    store.enqueueObservation(completionEvent('session-stale'));
    const staleBatch = await runQueued(worker, store, { basePersona: base });
    store.enqueueObservation(completionEvent('session-apply'));
    const applied = await runQueued(worker, store, {
      mode: 'bounded_auto',
      basePersona: base
    });
    assert.equal(applied.profileRevision, 1);

    const cas = store.reviewBatch({
      batchId: staleBatch.batchId,
      decision: 'approve',
      actor: 'admin-1',
      expectedProfileRevision: 1,
      basePersona: base
    });
    assert.equal(cas.reviewed, false);
    assert.equal(cas.reason, 'stale');
    assert.equal(cas.batch.errorCode, 'REFLECTION_CAS_CONFLICT');
    assert.equal(currentProfileRevision(store, base), 1);

    store.enqueueObservation(completionEvent('session-base-change'));
    const baseBatch = await runQueued(worker, store, { basePersona: base });
    const invalidated = store.invalidateStaleProposals({
      accountId: ACCOUNT_ID,
      basePersonaHash: hashBasePersona(otherBase)
    });
    assert.equal(invalidated.invalidated, 1);
    assert.equal(store.getBatch(baseBatch.batchId).status, 'stale');
    assert.equal(store.listProposals({ batchId: baseBatch.batchId })[0].status, 'stale');
    assert.equal(store.getLearnedSelfContext({
      accountId: ACCOUNT_ID,
      basePersona: otherBase
    }).stale, true);
  } finally {
    await worker.stop();
    store.close();
  }
});

test('profile rollback creates a new traceable version and changes the learned context', async () => {
  const { store } = fixture();
  const base = persona();
  let session = 0;
  const worker = startWorker(store, async ({ job }) => reflectionOutput(job.sessionId, {
    traitProposals: [{
      action: 'set',
      key: session++ === 0 ? 'communication_style' : 'language_preference',
      value: session === 1 ? 'concise' : 'Chinese',
      scope: 'global',
      confidence: 0.95,
      evidenceRefs: [evidenceRef(job.sessionId)]
    }]
  }), {}, { basePersona: base });
  try {
    store.enqueueObservation(completionEvent('session-profile-1'));
    const first = await runQueued(worker, store, { mode: 'bounded_auto', basePersona: base });
    assert.equal(first.profileRevision, 1);
    store.enqueueObservation(completionEvent('session-profile-2'));
    const second = await runQueued(worker, store, { mode: 'bounded_auto', basePersona: base });
    assert.equal(second.profileRevision, 2);
    let context = store.getLearnedSelfContext({ accountId: ACCOUNT_ID, basePersona: base });
    assert.equal(context.context.communication_style.value, 'concise');
    assert.equal(context.context.language_preference.value, 'Chinese');

    const rolledBack = store.rollbackProfile({
      accountId: ACCOUNT_ID,
      targetRevision: 1,
      expectedCurrentRevision: 2,
      basePersona: base,
      actor: 'admin-1'
    });
    assert.equal(rolledBack.revision, 3);
    assert.equal(rolledBack.parentRevision, 2);
    context = store.getLearnedSelfContext({ accountId: ACCOUNT_ID, basePersona: base });
    assert.equal(context.revision, 3);
    assert.equal(context.context.communication_style.value, 'concise');
    assert.equal(context.context.language_preference, undefined);
    const versions = store.listProfileVersions({ accountId: ACCOUNT_ID });
    assert.deepEqual(versions.map((version) => version.revision), [3, 2, 1]);
    assert.equal(versions[0].parentRevision, 2);
  } finally {
    await worker.stop();
    store.close();
  }
});

test('capability gaps dedupe by real request and keep failure categories separate from interest', async () => {
  const { store } = fixture();
  const base = persona();
  const outputs = [
    reflectionOutput('session-gap-1', {
      capabilityGapProposals: [
        {
          category: 'missing',
          capability: 'send_voice',
          requestKey: 'request-voice-1',
          scope: 'global',
          evidenceRefs: [evidenceRef('session-gap-1')]
        },
        {
          category: 'temporary_failure',
          capability: 'qq_api',
          requestKey: 'timeout-1',
          scope: 'global',
          detail: 'request timed out',
          evidenceRefs: [evidenceRef('session-gap-1')]
        },
        {
          category: 'disabled',
          capability: 'plugin_x',
          requestKey: 'plugin-disabled-1',
          scope: 'global',
          evidenceRefs: [evidenceRef('session-gap-1')]
        },
        {
          category: 'permission',
          capability: 'admin_api',
          requestKey: 'permission-1',
          scope: 'global',
          evidenceRefs: [evidenceRef('session-gap-1')]
        },
        {
          category: 'config',
          capability: 'web_search',
          requestKey: 'config-1',
          scope: 'global',
          evidenceRefs: [evidenceRef('session-gap-1')]
        }
      ]
    }),
    reflectionOutput('session-gap-2', {
      capabilityGapProposals: [{
        category: 'missing',
        capability: 'send_voice',
        requestKey: 'request-voice-1',
        scope: 'global',
        evidenceRefs: [evidenceRef('session-gap-2')]
      }]
    })
  ];
  const worker = startWorker(store, async () => outputs.shift(), {}, { basePersona: base });
  try {
    store.enqueueObservation(completionEvent('session-gap-1'));
    await runQueued(worker, store, { basePersona: base });
    store.enqueueObservation(completionEvent('session-gap-2'));
    await runQueued(worker, store, { basePersona: base });
    const gaps = store.listCapabilityGaps({ accountId: ACCOUNT_ID });
    const voice = gaps.find((gap) => gap.capability === 'send_voice');
    const timeout = gaps.find((gap) => gap.capability === 'qq_api');
    assert.equal(voice.count, 2);
    assert.equal(timeout.category, 'temporary_failure');
    assert.equal(timeout.count, 1);
    assert.deepEqual(
      new Set(gaps.map((gap) => gap.category)),
      new Set(['missing', 'temporary_failure', 'disabled', 'permission', 'config'])
    );

    store.enqueueObservation(completionEvent('session-failure-interest', {
      resultClass: 'error',
      actionSummary: {
        finishReason: 'request timeout',
        outboundAttempted: true,
        outbound: {
          attempted: 1,
          succeeded: 0,
          failed: 0,
          unknown: 1,
          held: 0
        }
      }
    }));
    const invalidWorker = startWorker(store, async () => reflectionOutput('session-failure-interest', {
      traitProposals: [{
        action: 'set',
        key: 'communication_style',
        value: 'not interested',
        scope: 'global',
        confidence: 0.99,
        evidenceRefs: [evidenceRef('session-failure-interest')]
      }]
    }), {}, { basePersona: base });
    try {
      const result = await runQueued(invalidWorker, store, { basePersona: base });
      assert.equal(result.status, 'invalid', JSON.stringify({
        result,
        jobs: store.listJobs().map((job) => ({
          sessionId: job.sessionId,
          status: job.status,
          reliability: job.evidence.reliability,
          failureKinds: job.evidence.failureKinds
        }))
      }));
      assert.equal(result.errorCode, 'REFLECTION_PROHIBITED_INFERENCE');
      assert.equal(store.counts().profileVersions, 0);
    } finally {
      await invalidWorker.stop();
    }
  } finally {
    await worker.stop();
    store.close();
  }
});

test('stop releases the lease and a late model result cannot commit', async () => {
  const { store } = fixture();
  const base = persona();
  let release;
  let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  const resultPromise = new Promise((resolve) => { release = resolve; });
  const worker = startWorker(store, async () => {
    started();
    return resultPromise;
  }, {}, { basePersona: base });
  try {
    store.enqueueObservation(completionEvent('session-stop'));
    const pending = runQueued(worker, store, { basePersona: base });
    await startedPromise;
    await worker.stop('shutdown', { timeoutMs: 5 });
    release(reflectionOutput('session-stop', {
      traitProposals: [{
        action: 'set',
        key: 'communication_style',
        value: 'late value',
        scope: 'global',
        confidence: 0.99,
        evidenceRefs: [evidenceRef('session-stop')]
      }]
    }));
    const result = await pending;
    assert.equal(result.status, 'stopped');
    assert.equal(store.counts().proposals, 0);
    assert.equal(store.counts().profileVersions, 0);
    assert.equal(store.listJobs()[0].status, 'pending');
  } finally {
    await worker.stop();
    store.close();
  }
});

test('plugin reads the live account head without basePersonaHash and preserves stale CAS rollback semantics', async () => {
  const dataDir = path.join(root, `plugin-revision-${++sequence}`);
  const base = persona();
  const baseSnapshot = structuredClone(base);
  let staleStarted;
  let releaseStale;
  const staleStartedPromise = new Promise((resolve) => { staleStarted = resolve; });
  const staleResultPromise = new Promise((resolve) => { releaseStale = resolve; });
  const plugin = createReflectionPlugin({
    dataDir,
    reflector: async ({ job }) => {
      if (job.sessionId === 'plugin-revision-stale') {
        staleStarted();
        return staleResultPromise;
      }
      const value = job.sessionId === 'plugin-revision-1' ? 'concise' : 'Chinese';
      const key = job.sessionId === 'plugin-revision-1'
        ? 'communication_style'
        : 'language_preference';
      return reflectionOutput(job.sessionId, {
        traitProposals: [{
          action: 'set',
          key,
          value,
          scope: 'global',
          confidence: 0.95,
          evidenceRefs: [evidenceRef(job.sessionId)]
        }]
      });
    },
    getBasePersona: () => base,
    getAccountId: () => ACCOUNT_ID,
    now: () => 1000,
    limits: {
      leaseMs: 10,
      workerLeaseMs: 10,
      maxCallsPerDay: 20,
      backoffMs: 0
    }
  });
  const started = plugin.start({}, {
    selfEvolution: {
      enabled: true,
      reflection: {
        enabled: true,
        mode: 'bounded_auto',
        pollIntervalMs: 100000
      }
    }
  });
  assert.ok(started);
  const { store, worker } = started;
  try {
    store.enqueueObservation(completionEvent('plugin-revision-1'));
    const first = await worker.runOnce();
    assert.equal(first.status, 'completed');
    assert.equal(first.profileRevision, 1);

    store.enqueueObservation(completionEvent('plugin-revision-2'));
    const second = await worker.runOnce();
    assert.equal(second.status, 'completed');
    assert.equal(second.profileRevision, 2);
    assert.equal(store.getLearnedSelfRevision({ accountId: ACCOUNT_ID }), 2);

    store.enqueueObservation(completionEvent('plugin-revision-stale'));
    const pending = worker.runOnce();
    await staleStartedPromise;
    const rolledBack = store.rollbackProfile({
      accountId: ACCOUNT_ID,
      targetRevision: 1,
      expectedCurrentRevision: 2,
      basePersona: base,
      actor: 'revision-test',
      reason: 'stale CAS fixture'
    });
    assert.equal(rolledBack.revision, 3);
    releaseStale(reflectionOutput('plugin-revision-stale', {
      traitProposals: [{
        action: 'set',
        key: 'working_habit',
        value: 'stale result',
        scope: 'global',
        confidence: 0.95,
        evidenceRefs: [evidenceRef('plugin-revision-stale')]
      }]
    }));
    const stale = await pending;
    assert.equal(stale.status, 'cas-conflict');
    assert.equal(stale.committed, false);
    assert.equal(store.listJobs().find((job) => job.sessionId === 'plugin-revision-stale').status, 'stale');
    assert.equal(store.getLearnedSelfRevision({ accountId: ACCOUNT_ID }), 3);

    const context = store.getLearnedSelfContext({
      accountId: ACCOUNT_ID,
      basePersona: base
    });
    assert.equal(context.revision, 3);
    assert.equal(context.context.communication_style.value, 'concise');
    assert.equal(context.context.language_preference, undefined);
    assert.equal(context.context.working_habit, undefined);
    assert.deepEqual(base, baseSnapshot);

    const changedBase = persona({ roleText: 'changed only for stale read' });
    const staleContext = store.getLearnedSelfContext({
      accountId: ACCOUNT_ID,
      basePersona: changedBase
    });
    assert.equal(staleContext.revision, 3);
    assert.equal(staleContext.stale, true);
    assert.deepEqual(staleContext.context, {});
    assert.equal(store.getLearnedSelfRevision({ accountId: 'other-bot' }), 0);
  } finally {
    await plugin.stop('test-finished');
  }
});

test('disabled reflection creates no database or model call, while old data remains read-only readable', async () => {
  const dataDir = path.join(root, `disabled-${++sequence}`);
  const filename = reflectionDatabasePath(dataDir);
  let modelCalls = 0;
  const plugin = createReflectionPlugin({
    dataDir,
    reflector: async () => {
      modelCalls += 1;
      return reflectionOutput('disabled');
    }
  });
  const manager = new PluginManager({
    configProvider: () => ({ selfEvolution: { enabled: false } })
  });
  manager.register(plugin);
  await manager.startAll();
  assert.equal(manager.runtime.has(plugin.id), false);
  assert.equal(fs.existsSync(filename), false);
  assert.equal(modelCalls, 0);
  await manager.stopAll();

  const writable = new ReflectionStore({ dataDir, filename });
  try {
    writable.enqueueObservation(completionEvent('session-readable'));
  } finally {
    writable.close();
  }
  const readOnly = openReflectionStore({ dataDir, filename });
  assert.ok(readOnly);
  assert.equal(readOnly.counts().jobs, 1);
  assert.throws(
    () => readOnly.enqueueObservation(completionEvent('session-read-only-write')),
    (error) => error.code === 'REFLECTION_READ_ONLY'
  );
  readOnly.close();

  let disabledObserverCalls = 0;
  const disabledStore = new ReflectionStore({ dataDir, filename: path.join(dataDir, 'other.sqlite') });
  try {
    const observer = createReflectionObserver({
      store: disabledStore,
      isEnabled: () => false
    });
    const result = observer.observe(completionEvent('session-disabled-observer'));
    disabledObserverCalls += result.enqueued ? 1 : 0;
    assert.equal(result.reason, 'disabled');
    assert.equal(disabledObserverCalls, 0);
    assert.equal(disabledStore.counts().jobs, 0);
  } finally {
    disabledStore.close();
  }
});
