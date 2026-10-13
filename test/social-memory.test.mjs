import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-social-memory-v1-'));
process.env.QQ_AGENT_DATA_DIR = root;

const { PluginManager } = await import('../src/plugins/manager.js');
const {
  NotebookStore,
  notebookDatabasePath
} = await import('../src/plugins/self-evolution/notebook-store.js');
const {
  classifyNotebookMemory,
  NOTEBOOK_POLICY_VERSION
} = await import('../src/plugins/self-evolution/notebook-policy.js');
const {
  ReflectionStore,
  hashBasePersona,
  normalizeCompletionObservation,
  reflectionDatabasePath
} = await import('../src/plugins/self-evolution/reflection-store.js');
const { ReflectionWorker } = await import('../src/plugins/self-evolution/reflection-worker.js');
const { createLearnedSelfContextProvider } = await import('../src/plugins/self-evolution/learned-self-provider.js');
const { runNotebookMemoryCleanup } = await import('../scripts/notebook-memory-cleanup.mjs');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

let serial = 0;
function caseDir(name) {
  const dir = path.join(root, `${name}-${++serial}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function chatSource(overrides = {}) {
  return {
    kind: 'chat',
    accountId: 'bot-1',
    chatKey: 'group:100',
    sessionId: 'session-1',
    runId: 'run-1',
    ...overrides
  };
}

function socialCompletion(manager, { sessionId, interactionId, rootId, explicitFeedback = null }) {
  const observer = { id: 'self-evolution.reflection', ownerPluginId: 'self-evolution' };
  const snapshot = {
    signal: { aborted: false },
    sessionObservers: [observer],
    generations: { 'self-evolution': 4 },
    isActive: () => true
  };
  return manager.buildCompletionEvents(snapshot, {
    schemaVersion: 3,
    evidenceVersion: 3,
    accountId: 'bot-1',
    chatKey: 'group:100',
    sessionId,
    runId: `run-${sessionId}`,
    triggerKind: 'human_message',
    proactive: false,
    topicId: 'topic-shared-interest',
    interactionId,
    originalSourceIds: [rootId],
    deliveryState: 'sent',
    delivered: true,
    resultClass: 'done',
    completedAt: Date.now(),
    conversationEvidence: [{
      evidenceId: `message:${sessionId}`,
      sourceRecordType: 'message',
      sourceRecordId: `local-${sessionId}`,
      platformMessageId: `qq-${sessionId}`,
      originalSourceId: rootId,
      originalSourceIds: [rootId],
      interactionId,
      topicId: 'topic-shared-interest',
      senderId: 'u-7',
      role: 'user',
      text: 'I enjoy astronomy and like comparing telescope notes.',
      userConfirmed: false,
      explicitFeedback
    }]
  })[0];
}

test('notebook policy preserves technical discussion and isolates execution scripts', () => {
  const technical = classifyNotebookMemory(
    'Node may return result=120 after an HTTP retry queue is drained; document the failure for debugging.'
  );
  const operational = classifyNotebookMemory(
    '助手以后遇到发送失败时必须等待30分钟再重试并回复用户。'
  );
  assert.equal(technical.recallable, true);
  assert.equal(technical.type, 'experience');
  assert.equal(operational.recallable, false);
  assert.equal(operational.channel, 'operational');
});

test('material refs require current, visible, recallable notes and exact policy revision', () => {
  const dataDir = caseDir('materials');
  const store = new NotebookStore({ dataDir });
  try {
    const note = store.append({
      accountId: 'bot-1',
      scope: 'chat',
      content: 'We discussed HTTP retry queues as a debugging technique.',
      source: chatSource(),
      idempotencyKey: 'material-technical'
    }).note;
    const operational = store.append({
      accountId: 'bot-1',
      scope: 'chat',
      content: '助手以后每次发送失败必须先重试再补发。',
      source: chatSource({ sessionId: 'session-2', runId: 'run-2' }),
      idempotencyKey: 'material-operational'
    }).note;
    const material = {
      kind: 'notebook',
      id: note.id,
      revision: note.revision,
      scope: 'chat',
      visibility: 'chat:group:100',
      policyVersion: NOTEBOOK_POLICY_VERSION
    };
    const accepted = store.validateMaterialRefs({
      accountId: 'bot-1',
      currentChatKey: 'group:100',
      refs: [material]
    });
    assert.equal(accepted.valid, true);
    assert.equal(accepted.validatedRefs.length, 1);
    assert.deepEqual(accepted.invalidRefs, []);

    const rejected = store.validateMaterialRefs({
      accountId: 'bot-1',
      currentChatKey: 'group:200',
      refs: [
        { ...material, revision: note.revision - 1 },
        { ...material, policyVersion: 'old-policy' },
        { ...material, visibility: 'chat:group:200' },
        { ...material, kind: 'unknown-memory' },
        {
          ...material,
          id: operational.id,
          revision: operational.revision
        }
      ]
    });
    assert.equal(rejected.valid, false);
    assert.equal(rejected.validatedRefs.length, 0);
    assert.deepEqual(rejected.invalidRefs.map((item) => item.reason), [
      'invalid-revision',
      'stale-policy-version',
      'chat-visibility-mismatch',
      'unsupported-material-kind',
      'note-not-recallable'
    ]);
  } finally {
    store.close();
  }
});

test('empty material validation does not open or initialize Notebook storage', () => {
  const filename = notebookDatabasePath(caseDir('empty-materials'));
  const unopened = new NotebookStore({ filename, create: false, readOnly: true });
  assert.equal(unopened.openState, false);
  assert.deepEqual(unopened.validateMaterialRefs({ refs: [] }), {
    valid: true,
    invalidRefs: [],
    validatedRefs: [],
    policyVersion: NOTEBOOK_POLICY_VERSION
  });
  assert.equal(unopened.openState, false);
  unopened.close();
});

test('cleanup is read-only by default and applies only matching explicit manifest revisions', () => {
  const dataDir = caseDir('cleanup');
  const filename = notebookDatabasePath(dataDir);
  const store = new NotebookStore({ dataDir, filename });
  let operational;
  let staleOperational;
  let technical;
  try {
    operational = store.append({
      accountId: 'bot-1',
      scope: 'chat',
      content: '机器人以后遇到投递失败必须30分钟后重试并补发。',
      source: chatSource(),
      idempotencyKey: 'cleanup-operational'
    }).note;
    staleOperational = store.append({
      accountId: 'bot-1',
      scope: 'chat',
      content: '机器人以后投递失败必须等待30分钟再补发。',
      source: chatSource({ sessionId: 'session-stale', runId: 'run-stale' }),
      idempotencyKey: 'cleanup-stale-operational'
    }).note;
    technical = store.append({
      accountId: 'bot-1',
      scope: 'chat',
      content: 'HTTP retry queues can return result=120 in the test harness.',
      source: chatSource(),
      idempotencyKey: 'cleanup-technical'
    }).note;
  } finally {
    store.close();
  }

  let printed = '';
  const dryRun = runNotebookMemoryCleanup([
    '--db', filename,
    '--account', 'bot-1'
  ], { log: (value) => { printed = value; } });
  assert.equal(dryRun.mode, 'dry-run');
  assert.equal(dryRun.manifest.items.length, 2);
  assert.ok(dryRun.manifest.items.some((item) => item.id === operational.id));
  assert.equal(printed.includes(operational.body), false);

  const reopened = NotebookStore.openExisting({ filename });
  try {
    assert.equal(reopened.get({
      accountId: 'bot-1',
      noteId: operational.id,
      currentChatKey: 'group:100',
      admin: true
    }).status, 'active');
  } finally {
    reopened.close();
  }

  const changed = new NotebookStore({ filename, create: false });
  try {
    changed.update({
      accountId: 'bot-1',
      noteId: staleOperational.id,
      expectedRevision: staleOperational.revision,
      content: '机器人以后投递失败必须等待60分钟再补发。',
      source: {
        kind: 'system',
        accountId: 'bot-1',
        actor: 'test-reviewer'
      },
      idempotencyKey: 'cleanup-stale-update'
    });
  } finally {
    changed.close();
  }

  const manifestPath = path.join(dataDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(dryRun.manifest));
  const applied = runNotebookMemoryCleanup([
    '--db', filename,
    '--account', 'bot-1',
    '--apply',
    '--manifest', manifestPath,
    '--confirm',
    '--actor', 'test-reviewer'
  ], { log() {} });
  const outcomes = new Map(applied.outcomes.map((item) => [item.id, item.status]));
  assert.equal(outcomes.get(operational.id), 'archived');
  assert.equal(outcomes.get(staleOperational.id), 'stale');
  const finalStore = NotebookStore.openExisting({ filename });
  try {
    assert.equal(finalStore.get({
      accountId: 'bot-1',
      noteId: operational.id,
      currentChatKey: 'group:100',
      includeArchived: true,
      admin: true
    }).status, 'archived');
    assert.equal(finalStore.get({
      accountId: 'bot-1',
      noteId: technical.id,
      currentChatKey: 'group:100'
    }).status, 'active');
    assert.equal(finalStore.get({
      accountId: 'bot-1',
      noteId: staleOperational.id,
      currentChatKey: 'group:100',
      admin: true
    }).status, 'active');
  } finally {
    finalStore.close();
  }
});

test('historical preference support stays within the evidence budget without blocking new episodes', () => {
  const dataDir = caseDir('evidence-budget');
  const manager = new PluginManager();
  const store = new ReflectionStore({ dataDir });
  const notebook = new NotebookStore({ dataDir });
  const owner = 'bounded-episode-test';
  const generation = store.beginWorkerGeneration({ owner });
  try {
    for (let index = 1; index <= 12; index += 1) {
      const event = socialCompletion(manager, {
        sessionId: `episode-${index}`,
        interactionId: `episode-interaction-${index}`,
        rootId: `episode-root-${index}`
      });
      assert.equal(store.enqueueObservation(event).created, true);
      const claimed = store.claimNextJob({
        owner, generation, leaseMs: 60000, workerLeaseMs: 60000
      });
      assert.ok(claimed.job);
      assert.ok(JSON.stringify(claimed.job.evidence).length <= store.limits.maxEvidenceChars);
      const currentRef = claimed.job.evidence.currentUserSourceRefs[0];
      assert.ok(claimed.job.evidence.traitEvidencePool.some((item) => item.sourceRef === currentRef),
        'current human evidence is retained before optional older support');
      const committed = store.commitReflectionResult({
        job: claimed.job, owner, generation, notebook,
        mode: 'bounded_auto', expectedProfileRevision: 0,
        basePersona: { roleText: 'synthetic unchanged persona' },
        output: {
          noteOperations: [{
            operation: 'append', scope: 'chat', chatKey: 'group:100',
            content: `We compared telescope notes in conversation ${index}.`,
            tags: ['experience'], evidenceRefs: [currentRef]
          }],
          traitProposals: [], capabilityGapProposals: [],
          summary: 'Preserve a concrete episode without adopting a preference.'
        }
      });
      assert.equal(committed.appliedNoteCount, 1, JSON.stringify(committed));
      assert.equal(committed.appliedTraitCount, 0);
    }
    assert.deepEqual(notebook.counts({ accountId: 'bot-1' }), {
      notes: 12, active: 12, archived: 0
    });
    assert.equal(store.getLearnedSelfRevision({ accountId: 'bot-1' }), 0);
  } finally {
    notebook.close();
    store.close();
  }
});

test('reflection accumulates same-candidate support from independent v3 interactions and requires review CAS', async () => {
  const dataDir = caseDir('candidates');
  const manager = new PluginManager();
  const store = new ReflectionStore({ dataDir });
  const basePersona = { roleText: 'test persona', behaviorProfile: 'steady' };
  const seenCandidateCounts = [];
  const worker = new ReflectionWorker({
    store,
    owner: 'memory-v1-test',
    reflector: async ({ job, reflectionInput }) => {
      seenCandidateCounts.push(reflectionInput.existingCandidates.length);
      const evidenceRefs = job.evidence.traitEvidencePool.map((item) => item.sourceRef).slice(-8);
      return {
        noteOperations: [],
        traitProposals: [{
          action: 'set',
          key: 'topic_interests',
          value: 'enjoys astronomy',
          subject: 'user:u-7',
          candidateId: reflectionInput.existingCandidates[0]?.candidateId,
          scope: 'chat',
          chatKey: 'group:100',
          confidence: 0.9,
          supportRefs: evidenceRefs,
          counterRefs: []
        }],
        capabilityGapProposals: [],
        summary: 'Candidate supported by host-verified interaction roots.'
      };
    },
    limits: {
      pollIntervalMs: 100000,
      minTraitValidSessions: 3,
      minTraitUserEvidence: 3
    }
  });
  worker.start({
    enabled: true,
    pollIntervalMs: 100000,
    basePersona,
    getMode: () => 'review'
  });
  try {
    for (let index = 1; index <= 3; index += 1) {
      const event = socialCompletion(manager, {
        sessionId: `human-run-${index}`,
        interactionId: `interaction-${index}`,
        rootId: `human-root-${index}`
      });
      assert.equal(event.schemaVersion, 3);
      assert.equal(event.evidenceVersion, 3);
      assert.equal(normalizeCompletionObservation(event).explicitPreference, false);
      assert.equal(event.actionSummary.conversationEvidence[0].platformMessageId, `qq-human-run-${index}`);
      assert.equal(event.actionSummary.conversationEvidence[0].originalSourceIds[0], `human-root-${index}`);
      assert.equal(store.enqueueObservation(event).created, true);
      const result = await worker.runOnce();
      assert.equal(result.status, 'completed', JSON.stringify({
        result,
        jobs: store.listJobs({ accountId: 'bot-1', limit: 5 })
      }));
    }

    const [candidate] = store.listCandidates({
      accountId: 'bot-1',
      chatKey: 'group:100',
      status: 'pending'
    });
    assert.deepEqual(seenCandidateCounts, [0, 1, 1]);
    assert.ok(candidate);
    const candidateProposals = store.listProposals({ accountId: 'bot-1', limit: 10 })
      .filter((item) => item.type === 'trait');
    const allCandidates = store.listCandidates({ accountId: 'bot-1', chatKey: 'group:100', status: '' });
    assert.equal(allCandidates.length, 1, JSON.stringify({
      candidates: allCandidates.map((item) => ({
        id: item.candidateId,
        proposalId: item.proposalId,
        supportRefs: item.supportRefs,
        reason: item.reason
      })),
      proposals: candidateProposals.map((item) => ({
        candidateId: item.payload.candidateId,
        status: item.status,
        payload: item.payload
      }))
    }));
    assert.equal(candidateProposals.length, 3, JSON.stringify({
      candidateProposals,
      audits: store.listAudit({ accountId: 'bot-1', limit: 20 })
    }));
    assert.equal(candidate.status, 'ready', JSON.stringify({
      candidate,
      proposals: store.listProposals({ accountId: 'bot-1', limit: 10 })
        .map((item) => ({ candidateId: item.payload.candidateId, supportRefs: item.payload.supportRefs }))
    }));
    assert.equal(candidate.eligible, true);
    assert.equal(candidate.independentRoots.length, 3);
    assert.equal(candidate.interactionIds.length, 3);
    assert.equal(candidate.supportingEvidence.length, 3);
    const feedbackSourceRef = 'bot-1:group:100:message:local-human-run-4';
    const feedbackEvent = socialCompletion(manager, {
      sessionId: 'human-run-4',
      interactionId: 'interaction-4',
      rootId: 'human-root-4',
      explicitFeedback: {
        feedbackId: 'feedback-astronomy-1',
        sourceRef: feedbackSourceRef,
        targetSourceRef: `candidate:${candidate.candidateId}`,
        action: 'confirm'
      }
    });
    assert.equal(normalizeCompletionObservation(feedbackEvent).explicitPreference, true);
    store.enqueueObservation(feedbackEvent);
    assert.equal(store.getLearnedSelfContext({
      accountId: 'bot-1',
      chatKey: 'group:100',
      basePersona
    }).revision, 0);
    assert.equal(store.listCandidates({
      accountId: 'bot-1',
      chatKey: 'group:100',
      status: 'pending'
    })[0].supportRefs.length, 4);

    const reviewed = store.reviewCandidate({
      proposalId: candidate.proposalId,
      decision: 'approve',
      actor: 'admin-1',
      expectedProfileRevision: candidate.currentProfileRevision,
      basePersonaHash: hashBasePersona(basePersona)
    });
    assert.equal(reviewed.reviewed, true);
    assert.equal(reviewed.decision, 'approve');
    assert.equal(reviewed.profileRevision, 1);
    assert.equal(store.listCandidates({
      accountId: 'bot-1',
      chatKey: 'group:100',
      status: 'adopted'
    })[0].status, 'adopted');
    store.correctProfileTrait({
      accountId: 'bot-1',
      key: 'topic_interests',
      subject: 'user:u-8',
      scope: 'chat',
      chatKey: 'group:100',
      action: 'set',
      value: 'collects astronomy books',
      expectedCurrentRevision: 1,
      basePersona,
      actor: 'admin-1',
      reason: 'separate person preference',
      confirm: true
    });
    const profile = store.getLearnedSelfContext({
      accountId: 'bot-1',
      chatKey: 'group:100',
      basePersona
    });
    assert.equal(Object.keys(profile.context).length, 2);
    const provider = createLearnedSelfContextProvider({
      getStore: () => store,
      getBasePersona: () => basePersona
    });
    const socialContext = await provider.provide({
      accountId: 'bot-1',
      chatKey: 'group:100',
      basePersonaHash: hashBasePersona(basePersona),
      mode: 'social',
      visibleParticipants: ['u-7']
    });
    assert.equal(socialContext.blocks.length, 1);
    assert.match(socialContext.blocks[0].text, /user:u-7/);
    assert.doesNotMatch(socialContext.blocks[0].text, /user:u-8/);
    const learnedRef = socialContext.blocks[0].materialRefs[0];
    assert.deepEqual({
      kind: learnedRef.kind,
      id: learnedRef.id,
      revision: learnedRef.revision,
      scope: learnedRef.scope,
      visibility: learnedRef.visibility,
      policyVersion: learnedRef.policyVersion
    }, {
      kind: 'learned-self',
      id: 'bot-1',
      revision: 2,
      scope: 'chat',
      visibility: 'chat:group:100',
      policyVersion: 'learned-self-v1'
    });
    assert.equal(learnedRef.traitKeys.length, 1);
    assert.ok(learnedRef.traitKeys[0].startsWith('topic_interests__user_'));
    assert.ok(learnedRef.expiresAt > Date.now());
    const materialCheck = store.validateMaterialRefs({
      accountId: 'bot-1',
      currentChatKey: 'group:100',
      basePersonaHash: hashBasePersona(basePersona),
      refs: socialContext.blocks[0].materialRefs
    });
    assert.equal(materialCheck.valid, true);
    assert.equal(store.validateMaterialRefs({
      accountId: 'bot-1',
      currentChatKey: 'group:100',
      basePersona: basePersona,
      refs: [{
        ...learnedRef,
        expiresAt: 1
      }]
    }).invalidRefs[0].reason, 'trait-material-expired');
    assert.equal(store.validateMaterialRefs({
      accountId: 'bot-1',
      currentChatKey: 'group:100',
      basePersonaHash: hashBasePersona(basePersona),
      refs: [{
        ...socialContext.blocks[0].materialRefs[0],
        revision: 1
      }]
    }).invalidRefs[0].reason, 'stale-revision');
    const legacyContext = await provider.provide({
      accountId: 'bot-1',
      chatKey: 'group:100',
      basePersonaHash: hashBasePersona(basePersona),
      mode: 'legacy'
    });
    assert.match(legacyContext.blocks[0].text, /user:u-8/);
  } finally {
    await worker.stop();
    store.close();
  }
});

test('rejected trait output does not discard a valid episodic note and rejection status is accurate', async () => {
  const dataDir = caseDir('separate-paths');
  const manager = new PluginManager();
  const store = new ReflectionStore({ dataDir });
  const event = socialCompletion(manager, {
    sessionId: 'episode-run',
    interactionId: 'episode-interaction',
    rootId: 'episode-root'
  });
  store.enqueueObservation(event);
  const basePersona = { roleText: 'test persona' };
  const worker = new ReflectionWorker({
    store,
    owner: 'memory-v1-separation',
    reflector: async ({ job }) => ({
      noteOperations: [{
        operation: 'append',
        scope: 'chat',
        chatKey: 'group:100',
        content: 'That was a memorable astronomy exchange.',
        tags: ['episode'],
        evidenceRefs: [`completion:${job.eventId || event.eventId}`]
      }],
      traitProposals: [{
        action: 'set',
        key: 'topic_interests',
        value: 'enjoys astronomy',
        subject: 'user:u-7',
        scope: 'chat',
        chatKey: 'group:100',
        confidence: 0.9,
        supportRefs: ['forged-source-ref'],
        counterRefs: []
      }],
      capabilityGapProposals: [],
      summary: 'One episode and an invalid source claim.'
    })
  });
  worker.start({ enabled: true, basePersona, getMode: () => 'review' });
  try {
    const result = await worker.runOnce();
    assert.equal(result.status, 'completed');
    assert.equal(result.jobStatus, 'ready');
    const proposals = store.listProposals({ accountId: 'bot-1', limit: 10 });
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].type, 'note');
    assert.equal(proposals[0].status, 'pending');
    const batch = store.getBatch(proposals[0].batchId);
    assert.equal(batch.output.rejectedTraitProposals[0].code, 'REFLECTION_SOURCE_LINEAGE');
  } finally {
    await worker.stop();
    store.close();
  }
});
