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
  normalizeCompletionObservation,
  openReflectionStore,
  reflectionDatabasePath,
  reflectionPrompt,
  validateReflectionOutput
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
  const interactionId = overrides.interactionId || `interaction-${sessionId}`;
  const originalSourceId = overrides.originalSourceId || `root-${sessionId}`;
  const sourceRecordId = `local-${sessionId}`;
  const schemaVersion = Number(overrides.schemaVersion ?? 3);
  const evidenceVersion = Number(overrides.evidenceVersion ?? 3);
  const actionSummary = {
    schemaVersion,
    evidenceVersion,
    interactionId,
    topicId: overrides.topicId || 'reflection-topic',
    originalSourceId,
    originalSourceIds: [originalSourceId],
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
    },
    conversationEvidence: [{
      evidenceId: `message:${sessionId}`,
      sourceRecordType: schemaVersion >= 3 ? 'message' : '',
      sourceRecordId: schemaVersion >= 3 ? sourceRecordId : '',
      messageId: sourceRecordId,
      platformMessageId: `platform-${sessionId}`,
      originalSourceId,
      originalSourceIds: [originalSourceId],
      interactionId,
      topicId: overrides.topicId || 'reflection-topic',
      senderId: 'user-7',
      role: 'user',
      text: `Human source for ${sessionId}.`,
      userConfirmed: false
    }],
    ...(overrides.actionSummary || {})
  };
  return {
    schemaVersion,
    evidenceVersion,
    eventId,
    observerId: OBSERVER_ID,
    observerPluginId: 'self-evolution',
    accountId: ACCOUNT_ID,
    sessionId,
    runId: `run-${sessionId}`,
    chatKey: overrides.chatKey || 'group:100',
    interactionId,
    topicId: overrides.topicId || 'reflection-topic',
    originalSourceId,
    originalSourceIds: [originalSourceId],
    pluginGeneration: 1,
    resultClass: 'done',
    actionSummary,
    sourceMessageIds: ['m1', 'm2'],
    completedAt: 1000,
    ...overrides
  };
}

function evidenceRef(sessionId) {
  return `${ACCOUNT_ID}:group:100:message:local-${sessionId}`;
}

function reflectionOutput(sessionId, overrides = {}) {
  const traitProposals = (Array.isArray(overrides.traitProposals) ? overrides.traitProposals : [])
    .map((proposal) => ({
      subject: 'user:user-7',
      scope: proposal?.scope === 'global' ? 'chat' : (proposal?.scope || 'chat'),
      chatKey: proposal?.scope === 'global' ? 'group:100' : (proposal?.chatKey || 'group:100'),
      supportRefs: proposal?.supportRefs
        ?? proposal?.evidenceRefs
        ?? [evidenceRef(sessionId)],
      counterRefs: [],
      ...proposal
    }));
  return {
    noteOperations: [],
    traitProposals,
    capabilityGapProposals: [],
    summary: `reflection for ${sessionId}`,
    ...overrides,
    traitProposals
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
    basePersona: options.basePersona || persona(),
    notebook: options.notebook || null
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

function currentTrait(context, key, subject = 'user:user-7') {
  return Object.values(context || {}).find((entry) => (
    entry?.key === key && entry.subject === subject
  ));
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

test('review mode approves a three-root candidate and rejects another without mutating Base Persona', async () => {
  const { store } = fixture();
  const base = persona();
  const reflector = async ({ job }) => reflectionOutput(job.sessionId, {
    traitProposals: [{
      action: 'set',
      key: 'communication_style',
      value: job.sessionId.startsWith('reject-') ? 'warm' : 'concise',
      scope: 'chat',
      chatKey: 'group:100',
      confidence: 0.92,
      evidenceRefs: [evidenceRef(job.sessionId)]
    }]
  });
  const worker = startWorker(store, reflector, {}, { basePersona: base });
  try {
    for (let index = 1; index <= 3; index += 1) {
      store.enqueueObservation(completionEvent(`approve-${index}`));
      assert.equal((await runQueued(worker, store, { basePersona: base })).status, 'completed');
    }
    const [candidate] = store.listCandidates({
      accountId: ACCOUNT_ID,
      chatKey: 'group:100',
      status: 'ready'
    });
    assert.ok(candidate);
    const approved = store.reviewCandidate({
      proposalId: candidate.proposalId,
      decision: 'approve',
      actor: 'admin-1',
      expectedProfileRevision: 0,
      basePersonaHash: hashBasePersona(base)
    });
    assert.equal(approved.reviewed, true);
    assert.equal(approved.profileRevision, 1);
    const context = store.getLearnedSelfContext({
      accountId: ACCOUNT_ID,
      chatKey: 'group:100',
      basePersona: base
    });
    assert.equal(context.stale, false);
    assert.equal(currentTrait(context.context, 'communication_style').value, 'concise');
    assert.equal(base.roleText, 'base persona body');

    for (let index = 1; index <= 3; index += 1) {
      store.enqueueObservation(completionEvent(`reject-${index}`));
      assert.equal((await runQueued(worker, store, { basePersona: base })).status, 'completed');
    }
    const rejectCandidate = store.listCandidates({
      accountId: ACCOUNT_ID,
      chatKey: 'group:100',
      status: 'ready'
    }).find((item) => item.value === 'warm');
    assert.ok(rejectCandidate);
    const rejected = store.reviewCandidate({
      proposalId: rejectCandidate.proposalId,
      decision: 'reject',
      actor: 'admin-1',
      expectedProfileRevision: 1,
      basePersonaHash: hashBasePersona(base)
    });
    assert.equal(rejected.reviewed, true);
    assert.equal(currentProfileRevision(store, base), 1);
  } finally {
    await worker.stop();
    store.close();
  }
});

test('bounded_auto never adopts behavior traits and leaves valid candidates for explicit review', async () => {
  const { store } = fixture();
  const base = persona();
  const worker = startWorker(store, async () => reflectionOutput('session-auto', {
    traitProposals: [
      {
        action: 'set',
        key: 'communication_style',
        value: 'brief and concrete',
        scope: 'chat',
        chatKey: 'group:100',
        confidence: 0.95,
        evidenceRefs: [evidenceRef('session-auto')]
      },
      {
        action: 'set',
        key: 'social_strategy',
        value: 'lead every conversation',
        scope: 'chat',
        chatKey: 'group:100',
        confidence: 0.99,
        evidenceRefs: [evidenceRef('session-auto')]
      }
    ]
  }), {}, { basePersona: base });
  try {
    store.enqueueObservation(completionEvent('session-auto'));
    const result = await runQueued(worker, store, { mode: 'bounded_auto', basePersona: base });
    assert.equal(result.jobStatus, 'ready');
    assert.equal(result.appliedTraitCount, 0);
    const proposals = store.listProposals({ batchId: result.batchId });
    assert.deepEqual(
      proposals.map((proposal) => [proposal.payload.key, proposal.risk, proposal.status]),
      [
        ['communication_style', 'low', 'pending'],
        ['social_strategy', 'high', 'pending']
      ]
    );
    const context = store.getLearnedSelfContext({
      accountId: ACCOUNT_ID,
      chatKey: 'group:100',
      basePersona: base
    });
    assert.equal(currentTrait(context.context, 'communication_style'), undefined);
    assert.equal(currentTrait(context.context, 'social_strategy'), undefined);
    assert.equal(store.getBatch(result.batchId).expectedProfileRevision, 0);
    assert.equal(store.getLearnedSelfRevision({ accountId: ACCOUNT_ID }), 0);
    assert.equal(store.listCandidates({
      accountId: ACCOUNT_ID,
      chatKey: 'group:100',
      status: 'pending'
    }).length, 2);
  } finally {
    await worker.stop();
    store.close();
  }
});

test('bounded_auto applies Notebook operations without approval and keeps history', async () => {
  const { store, dataDir } = fixture();
  const notebook = new NotebookStore({ dataDir });
  const base = persona();
  const worker = startWorker(store, async ({ job }) => reflectionOutput(job.sessionId, {
    noteOperations: [{
      operation: 'append',
      scope: 'chat',
      chatKey: 'group:100',
      content: 'automatically approved note',
      tags: ['reflection'],
      evidenceRefs: [evidenceRef(job.sessionId)]
    }]
  }), {}, { basePersona: base, notebook });
  try {
    store.enqueueObservation(completionEvent('session-note-auto'));
    const result = await runQueued(worker, store, { mode: 'bounded_auto', basePersona: base });
    assert.equal(result.jobStatus, 'applied');
    assert.equal(store.listProposals({ batchId: result.batchId })[0].status, 'applied');
    assert.equal(notebook.search({
      accountId: ACCOUNT_ID,
      currentChatKey: 'group:100',
      query: 'automatically approved'
    }).count, 1);
  } finally {
    await worker.stop();
    notebook.close();
    store.close();
  }
});

test('reflection rejects transient run summaries instead of writing them as Notebook notes', async () => {
  const { store, dataDir } = fixture();
  const notebook = new NotebookStore({ dataDir });
  const base = persona();
  const worker = startWorker(store, async ({ job }) => reflectionOutput(job.sessionId, {
    noteOperations: [{
      operation: 'append',
      scope: 'chat',
      chatKey: 'group:100',
      content: 'Run ended safely because the token budget was reached; sent 3 messages.',
      tags: [],
      evidenceRefs: [evidenceRef(job.sessionId)]
    }]
  }), {}, { basePersona: base, notebook });
  try {
    store.enqueueObservation(completionEvent('session-transient-note'));
    const result = await runQueued(worker, store, { mode: 'bounded_auto', basePersona: base });
    assert.equal(result.jobStatus, 'rejected');
    const [proposal] = store.listProposals({ batchId: result.batchId });
    assert.equal(proposal.status, 'rejected');
    assert.equal(proposal.errorCode, 'REFLECTION_NOTE_NOT_DURABLE');
    assert.deepEqual(proposal.evidenceRefs, [evidenceRef('session-transient-note')]);
    assert.equal(notebook.search({
      accountId: ACCOUNT_ID,
      currentChatKey: 'group:100',
      query: 'token budget'
    }).count, 0);
  } finally {
    await worker.stop();
    notebook.close();
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
      idempotencyKey: 'setup-note'
    });
    const worker = startWorker(store, async ({ job }) => reflectionOutput(job.sessionId, {
      noteOperations: [{
        operation: 'update',
        scope: 'chat',
        chatKey: 'group:100',
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
      assert.equal(reflected.jobStatus, 'rejected');
      const reviewed = store.reviewBatch({
        batchId: reflected.batchId,
        decision: 'approve',
        actor: 'admin-1',
        expectedProfileRevision: 0,
        basePersona: base,
        notebook
      });
      assert.equal(reviewed.reviewed, false);
      assert.equal(reviewed.reason, 'rejected');
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

test('candidate review rejects a changed Base Persona before adoption', async () => {
  const { store } = fixture();
  const base = persona();
  const otherBase = persona({ roleText: 'manually edited persona' });
  const worker = startWorker(store, async ({ job }) => {
    const selected = job.sessionId.startsWith('session-stale')
      ? ['communication_style', 'concise']
      : ['language_preference', 'English'];
    return reflectionOutput(job.sessionId, {
      traitProposals: [{
        action: 'set',
        key: selected[0],
        value: selected[1],
        scope: 'chat',
        chatKey: 'group:100',
        confidence: 0.9,
        evidenceRefs: [evidenceRef(job.sessionId)]
      }]
    });
  }, {}, { basePersona: base });
  try {
    for (let index = 1; index <= 3; index += 1) {
      store.enqueueObservation(completionEvent(`session-stale-${index}`));
      assert.equal((await runQueued(worker, store, { basePersona: base })).status, 'completed');
    }
    for (let index = 1; index <= 3; index += 1) {
      store.enqueueObservation(completionEvent(`session-apply-${index}`));
      assert.equal((await runQueued(worker, store, { basePersona: base })).status, 'completed');
    }
    const candidates = store.listCandidates({
      accountId: ACCOUNT_ID,
      chatKey: 'group:100',
      status: 'ready'
    });
    const first = candidates.find((item) => item.key === 'communication_style');
    const second = candidates.find((item) => item.key === 'language_preference');
    assert.ok(first && second);
    assert.equal(store.reviewCandidate({
      proposalId: first.proposalId,
      decision: 'approve',
      actor: 'admin-1',
      expectedProfileRevision: 0,
      basePersonaHash: hashBasePersona(base)
    }).profileRevision, 1);
    const baseChanged = store.reviewCandidate({
      proposalId: second.proposalId,
      decision: 'approve',
      actor: 'admin-1',
      expectedProfileRevision: 1,
      basePersonaHash: hashBasePersona(otherBase)
    });
    assert.equal(baseChanged.reviewed, false);
    assert.equal(baseChanged.reason, 'base-persona-changed');
    assert.equal(currentProfileRevision(store, base), 1);
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
  const worker = startWorker(store, async ({ job }) => {
    const communication = job.sessionId.startsWith('rollback-style');
    return reflectionOutput(job.sessionId, {
      traitProposals: [{
        action: 'set',
        key: communication ? 'communication_style' : 'language_preference',
        value: communication ? 'concise' : 'Chinese',
        scope: 'chat',
        chatKey: 'group:100',
        confidence: 0.95,
        evidenceRefs: [evidenceRef(job.sessionId)]
      }]
    });
  }, {}, { basePersona: base });
  try {
    for (let index = 1; index <= 3; index += 1) {
      store.enqueueObservation(completionEvent(`rollback-style-${index}`));
      assert.equal((await runQueued(worker, store, { basePersona: base })).status, 'completed');
    }
    for (let index = 1; index <= 3; index += 1) {
      store.enqueueObservation(completionEvent(`rollback-language-${index}`));
      assert.equal((await runQueued(worker, store, { basePersona: base })).status, 'completed');
    }
    const candidates = store.listCandidates({
      accountId: ACCOUNT_ID,
      chatKey: 'group:100',
      status: 'ready'
    });
    const style = candidates.find((item) => item.key === 'communication_style');
    const language = candidates.find((item) => item.key === 'language_preference');
    assert.ok(style && language);
    assert.equal(store.reviewCandidate({
      proposalId: style.proposalId,
      decision: 'approve',
      actor: 'admin-1',
      expectedProfileRevision: 0,
      basePersonaHash: hashBasePersona(base)
    }).profileRevision, 1);
    const staleLanguage = store.reviewCandidate({
      proposalId: language.proposalId,
      decision: 'approve',
      actor: 'admin-1',
      expectedProfileRevision: 1,
      basePersonaHash: hashBasePersona(base)
    });
    assert.equal(staleLanguage.reviewed, false);
    assert.equal(staleLanguage.reason, 'stale');
    assert.equal(store.getLearnedSelfRevision({ accountId: ACCOUNT_ID }), 1);
    for (let index = 4; index <= 6; index += 1) {
      store.enqueueObservation(completionEvent(`rollback-language-${index}`));
      assert.equal((await runQueued(worker, store, { basePersona: base })).status, 'completed');
    }
    const refreshedLanguage = store.listCandidates({
      accountId: ACCOUNT_ID, chatKey: 'group:100', status: 'ready'
    }).find((item) => item.key === 'language_preference');
    assert.ok(refreshedLanguage, JSON.stringify({
      candidates: store.listCandidates({ accountId: ACCOUNT_ID, chatKey: 'group:100' }),
      proposals: store.listProposals({ accountId: ACCOUNT_ID, limit: 3 })
        .map(({ type, status, errorCode, errorMessage }) => ({ type, status, errorCode, errorMessage }))
    }));
    assert.equal(refreshedLanguage.independentRoots.length, 3);
    assert.equal(store.reviewCandidate({
      proposalId: refreshedLanguage.proposalId,
      decision: 'approve',
      actor: 'admin-1',
      expectedProfileRevision: 1,
      basePersonaHash: hashBasePersona(base)
    }).profileRevision, 2);
    let context = store.getLearnedSelfContext({
      accountId: ACCOUNT_ID,
      chatKey: 'group:100',
      basePersona: base
    });
    assert.equal(currentTrait(context.context, 'communication_style').value, 'concise');
    assert.equal(currentTrait(context.context, 'language_preference').value, 'Chinese');

    const rolledBack = store.rollbackProfile({
      accountId: ACCOUNT_ID,
      targetRevision: 1,
      expectedCurrentRevision: 2,
      basePersona: base,
      actor: 'admin-1'
    });
    assert.equal(rolledBack.revision, 3);
    assert.equal(rolledBack.parentRevision, 2);
    context = store.getLearnedSelfContext({
      accountId: ACCOUNT_ID,
      chatKey: 'group:100',
      basePersona: base
    });
    assert.equal(context.revision, 3);
    assert.equal(currentTrait(context.context, 'communication_style').value, 'concise');
    assert.equal(currentTrait(context.context, 'language_preference'), undefined);
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
      assert.equal(result.status, 'completed');
      assert.equal(result.jobStatus, 'rejected');
      assert.equal(result.rejectedCount, 1);
      const rejected = store.listJobs().find((job) => job.sessionId === 'session-failure-interest');
      assert.equal(rejected.evidence.reliability, 'unreliable');
      assert.ok(rejected.evidence.failureKinds.includes('unknown_external_write'));
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

test('plugin worker leaves candidates pending and review rejects a stale profile CAS', async () => {
  const dataDir = path.join(root, `plugin-revision-${++sequence}`);
  const base = persona();
  const baseSnapshot = structuredClone(base);
  const plugin = createReflectionPlugin({
    dataDir,
    reflector: async ({ job }) => {
      const styleCandidate = job.sessionId.startsWith('plugin-style');
      return reflectionOutput(job.sessionId, {
        traitProposals: [{
          action: 'set',
          key: styleCandidate ? 'communication_style' : 'language_preference',
          value: styleCandidate ? 'concise' : 'Chinese',
          subject: 'user:user-7',
          scope: 'chat',
          chatKey: 'group:100',
          confidence: 0.95,
          supportRefs: job.evidence.traitEvidencePool.map((item) => item.sourceRef),
          counterRefs: []
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
    for (let index = 1; index <= 3; index += 1) {
      store.enqueueObservation(completionEvent(`plugin-style-${index}`));
      assert.equal((await worker.runOnce()).status, 'completed');
    }
    const [style] = store.listCandidates({
      accountId: ACCOUNT_ID,
      chatKey: 'group:100',
      status: 'ready'
    });
    assert.equal(style.key, 'communication_style');
    assert.equal(store.getLearnedSelfRevision({ accountId: ACCOUNT_ID }), 0);
    assert.equal(store.reviewCandidate({
      proposalId: style.proposalId,
      decision: 'approve',
      actor: 'revision-test',
      expectedProfileRevision: 0,
      basePersonaHash: hashBasePersona(base)
    }).profileRevision, 1);

    for (let index = 1; index <= 3; index += 1) {
      store.enqueueObservation(completionEvent(`plugin-language-${index}`));
      assert.equal((await worker.runOnce()).status, 'completed');
    }
    const [language] = store.listCandidates({
      accountId: ACCOUNT_ID,
      chatKey: 'group:100',
      status: 'ready'
    });
    assert.equal(language.key, 'language_preference');
    const stale = store.reviewCandidate({
      proposalId: language.proposalId,
      decision: 'approve',
      actor: 'revision-test',
      expectedProfileRevision: 0,
      basePersonaHash: hashBasePersona(base)
    });
    assert.equal(stale.reviewed, false);
    assert.equal(stale.reason, 'cas-conflict');
    assert.equal(store.getLearnedSelfRevision({ accountId: ACCOUNT_ID }), 1);

    const context = store.getLearnedSelfContext({
      accountId: ACCOUNT_ID,
      chatKey: 'group:100',
      basePersona: base
    });
    assert.equal(context.revision, 1);
    assert.equal(currentTrait(context.context, 'communication_style').value, 'concise');
    assert.equal(currentTrait(context.context, 'language_preference'), undefined);
    assert.deepEqual(base, baseSnapshot);

    const changedBase = persona({ roleText: 'changed only for stale read' });
    const staleContext = store.getLearnedSelfContext({
      accountId: ACCOUNT_ID,
      basePersona: changedBase
    });
    assert.equal(staleContext.revision, 1);
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

test('budget blocking persists until the next UTC period and then recovers', async () => {
  const { store, clock } = fixture({ limits: { maxCallsPerDay: 1 } });
  let calls = 0;
  const worker = startWorker(store, async ({ job }) => {
    calls += 1;
    return reflectionOutput(job.sessionId);
  }, { maxCallsPerDay: 1 });
  try {
    store.enqueueObservation(completionEvent('session-budget-period-1'));
    store.enqueueObservation(completionEvent('session-budget-period-2'));
    assert.equal((await runQueued(worker, store)).status, 'noop');

    const blocked = await runQueued(worker, store);
    assert.equal(blocked.status, 'budget');
    const state = store.workerState();
    assert.equal(state.budgetBlockedUntil, 86400000);
    assert.equal(store.listJobs().find((job) => job.status === 'pending')
      .availableAt, state.budgetBlockedUntil);
    assert.equal((await runQueued(worker, store)).status, 'budget-blocked');
    assert.equal(calls, 1);

    clock.value = state.budgetBlockedUntil;
    const recovered = await runQueued(worker, store);
    assert.equal(recovered.status, 'noop');
    assert.equal(calls, 2);
    assert.equal(store.workerState().budgetBlockedUntil, 0);
  } finally {
    await worker.stop();
    store.close();
  }
});

test('separate host interaction IDs accumulate bounded v3 sources without shared fake windows', async () => {
  const { store } = fixture();
  let calls = 0;
  const poolSizes = [];
  const worker = startWorker(store, async ({ job }) => {
    calls += 1;
    poolSizes.push(job.evidence.traitEvidencePool.length);
    return reflectionOutput(job.sessionId);
  });
  try {
    const first = store.enqueueObservation(completionEvent('session-window-1'));
    assert.equal(first.created, true);
    const second = store.enqueueObservation(completionEvent('session-window-2'));
    assert.equal(second.created, true);
    const duplicate = store.enqueueObservation(completionEvent('session-window-2'));
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.reason, 'duplicate');
    const third = store.enqueueObservation(completionEvent('session-window-3'));
    assert.equal(third.created, true);
    assert.deepEqual(
      third.job.evidence.traitEvidencePool.map((item) => item.interactionId).sort(),
      ['interaction-session-window-1', 'interaction-session-window-2', 'interaction-session-window-3']
    );
    assert.deepEqual(
      (await worker.runDrain({ maxJobs: 3 })).map((item) => item.status),
      ['noop', 'noop', 'noop']
    );
    assert.deepEqual([...poolSizes].sort(), [1, 2, 3]);
    assert.equal(calls, 3);
  } finally {
    await worker.stop();
    store.close();
  }
});

test('behavior-change evidence bypasses the valid-session threshold', () => {
  const { store } = fixture({
    limits: {
      minValidSessions: 3,
      observationWindowMs: 10000
    }
  });
  try {
    const result = store.enqueueObservation(completionEvent('session-behavior-change', {
      completedAt: 1000,
      behaviorChange: true,
      behaviorChangeEvidence: 'user explicitly changed the preferred response format'
    }));
    assert.equal(result.created, true);
    assert.equal(result.job.behaviorChange, true);
    assert.equal(result.job.evidence.behaviorChangeEvidence,
      'user explicitly changed the preferred response format');
    assert.equal(result.job.validSessionCount, 1);
  } finally {
    store.close();
  }
});

test('invalid completion evidence keeps otherwise valid candidates ineligible', () => {
  const cases = [
    ['timeout', { resultClass: 'timeout' }],
    ['api_failure', { resultClass: 'api_error' }],
    ['tool_failure', { resultClass: 'tool_error' }],
    ['noreply', { resultClass: 'noreply' }],
    ['not_called', {
      actionSummary: {
        participation: { decision: 'not_called' }
      }
    }],
    ['unknown_external_write', {
      actionSummary: {
        outbound: { unknown: 1 }
      }
    }],
    ['held_external_write', {
      actionSummary: {
        outbound: { held: 1 }
      }
    }]
  ];
  for (const [kind, overrides] of cases) {
    const evidence = normalizeCompletionObservation(completionEvent(`session-invalid-${kind}`, {
      ...overrides,
      actionSummary: {
        ...completionEvent(`session-invalid-${kind}`).actionSummary,
        ...(overrides.actionSummary || {})
      }
    }));
    assert.ok(evidence.invalidEvidenceKinds.includes(kind), `${kind} was not classified`);
    const output = validateReflectionOutput({
        noteOperations: [],
        traitProposals: [{
          action: 'set',
          key: 'communication_style',
          value: 'concise',
          subject: 'user:user-7',
          scope: 'chat',
          chatKey: 'group:100',
          confidence: 0.95,
          supportRefs: [evidenceRef(`session-invalid-${kind}`)],
          counterRefs: []
        }],
        capabilityGapProposals: [],
        summary: 'invalid evidence'
      }, { evidence });
    assert.equal(output.traitProposals.length, 1);
    assert.equal(output.traitProposals[0].evidenceGate.eligible, false);
    assert.ok(output.traitProposals[0].evidenceGate.reasons.includes('unreliable-completion'));
  }
});

test('completion provenance defaults to chat_run and rejects reflection origins', () => {
  const event = completionEvent('session-origin-default');
  assert.equal(normalizeCompletionObservation(event).originKind, 'chat_run');
  assert.throws(
    () => normalizeCompletionObservation({
      ...event,
      originKind: 'reflection'
    }),
    (error) => error.code === 'REFLECTION_SOURCE_LINEAGE'
  );
  assert.throws(
    () => normalizeCompletionObservation({
      ...event,
      originKind: 'internal'
    }),
    (error) => error.code === 'REFLECTION_SOURCE_LINEAGE'
  );
});

test('completion evidence preserves structured human sources without inferring preference from silence', () => {
  const event = completionEvent('session-evidence', {
    resultClass: 'explicit_silence',
    actionSummary: {
      ...completionEvent('session-evidence').actionSummary,
      sentCount: 0,
      outboundAttempted: false,
      termination: {
        kind: 'explicit_silence',
        reasonCode: 'not_needed',
        reason: 'no new content',
        threadDisposition: 'active',
        blocked: false
      },
      outbound: { attempted: 0, succeeded: 0, failed: 0, unknown: 0, held: 0 },
      conversationEvidence: [{
        evidenceId: 'message:m1',
        sourceRecordType: 'message',
        sourceRecordId: 'local-m1',
        messageId: 'm1',
        platformMessageId: 'platform-m1',
        senderId: 'user-1',
        originalSourceId: 'root-m1',
        interactionId: 'interaction-m1',
        topicId: 'topic-m1',
        role: 'user',
        at: 1000,
        text: '我今天想聊摄影',
        confirmed: true
      }]
    }
  });
  const normalized = normalizeCompletionObservation(event);
  assert.equal(normalized.traitEligible, true);
  assert.equal(normalized.explicitPreference, false);
  assert.equal(normalized.conversationEvidence[0].userEvidence, true);
  assert.equal(normalized.conversationEvidence[0].text, '我今天想聊摄影');
  assert.ok(normalized.evidenceIds.includes('message:m1'));
});

test('reflection prompt specifies the canonical nested proposal schema', () => {
  const prompt = reflectionPrompt({
    evidence: { sourceKind: 'run_completion', sessionId: 'session-schema' }
  }, undefined, {
    conversationEvidence: [{ evidenceId: 'message:m1', text: '我喜欢摄影' }],
    currentProfile: { revision: 2, context: { communication_style: 'concise' } },
    notebook: [{ id: 'note-1', revision: 3, content: '用户偏好摄影' }]
  });
  assert.match(prompt, /noteOperations item schema: operation/);
  assert.match(prompt, /traitProposals item schema: action/);
  assert.match(prompt, /capabilityGapProposals item schema: category/);
  assert.match(prompt, /Do not invent aliases such as op, type, target, note, trait, or evidenceIds/);
  assert.match(prompt, /operation \(append\|update\|archive\)/);
  assert.match(prompt, /我喜欢摄影/);
  assert.match(prompt, /note-1/);
});

test('reflection worker sends bounded conversation, current profile, and Notebook input', async () => {
  const { store, dataDir } = fixture();
  const notebook = new NotebookStore({ dataDir });
  const base = persona();
  notebook.append({
    accountId: ACCOUNT_ID,
    scope: 'chat',
    chatKey: 'group:100',
    content: '用户偏好摄影',
    source: { kind: 'chat', accountId: ACCOUNT_ID, chatKey: 'group:100', sessionId: 'seed', runId: 'seed' },
    currentChatKey: 'group:100',
    idempotencyKey: 'seed-note'
  });
  let observedPrompt = '';
  const worker = startWorker(store, async ({ prompt }) => {
    observedPrompt = prompt;
    return reflectionOutput('session-input');
  }, {}, { basePersona: base, notebook });
  try {
    store.enqueueObservation(completionEvent('session-input', {
      actionSummary: {
        ...completionEvent('session-input').actionSummary,
        conversationEvidence: [{
          evidenceId: 'message:m1',
          messageId: 'm1',
          senderId: 'user-1',
          role: 'user',
          at: 1000,
          text: '我最近喜欢摄影',
          confirmed: true
        }]
      }
    }));
    await runQueued(worker, store, { mode: 'bounded_auto', basePersona: base });
    assert.match(observedPrompt, /我最近喜欢摄影/);
    assert.match(observedPrompt, /用户偏好摄影/);
    assert.match(observedPrompt, /ReflectionInput/);
  } finally {
    await worker.stop();
    notebook.close();
    store.close();
  }
});

test('bounded_auto accumulates extended preference keys without bypassing review', async () => {
  const { store } = fixture();
  const base = persona();
  const worker = startWorker(store, async ({ job }) => reflectionOutput(job.sessionId, {
    traitProposals: [{
      action: 'set',
      key: 'topic_interests',
      value: '摄影',
      scope: 'chat',
      chatKey: 'group:100',
      confidence: 0.8,
      evidenceRefs: [evidenceRef(job.sessionId)]
    }]
  }), {}, { basePersona: base });
  try {
    store.enqueueObservation(completionEvent('topic-1'));
    const first = await runQueued(worker, store, {
      mode: 'bounded_auto',
      basePersona: base
    });
    assert.equal(first.profileRevision, 0);
    assert.equal(first.jobStatus, 'ready');
    store.enqueueObservation(completionEvent('topic-2'));
    const second = await runQueued(worker, store, {
      mode: 'bounded_auto',
      basePersona: base
    });
    assert.equal(second.profileRevision, 0);
    assert.equal(second.jobStatus, 'ready');
    const [candidate] = store.listCandidates({
      accountId: ACCOUNT_ID,
      chatKey: 'group:100',
      status: 'pending'
    });
    assert.equal(candidate.key, 'topic_interests');
    assert.equal(candidate.independentRoots.length, 2);
    assert.equal(store.getLearnedSelfRevision({ accountId: ACCOUNT_ID }), 0);
  } finally {
    await worker.stop('test');
    store.close();
  }
});
