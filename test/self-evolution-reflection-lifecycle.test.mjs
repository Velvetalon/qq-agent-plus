import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-p6-reflection-'));

const {
  NotebookStore,
  createReflectionPlugin,
  reflectionDatabasePath,
  hashBasePersona
} = await import('../src/plugins/self-evolution/index.js');
const {
  notebookDatabasePath
} = await import('../src/plugins/self-evolution/notebook-store.js');
const {
  createSelfEvolutionPlugin
} = await import('../src/plugins/builtin/self-evolution.js');
const { PluginManager } = await import('../src/plugins/manager.js');
const {
  createSelfEvolutionRetrievalProvider
} = await import('../src/plugins/self-evolution/retrieval-provider.js');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const ACCOUNT_ID = 'account-a';
const OBSERVER_ID = 'self-evolution.reflection';

function persona() {
  return {
    roleText: 'closure base persona',
    behaviorProfile: 'legacy',
    botName: 'closure-bot',
    selfNickname: 'closure-bot',
    customRules: 'stay in scope',
    tools: [
      { name: 'notebook_search', effect: 'read', terminal: false },
      { name: 'notebook_append', effect: 'local-write', terminal: false }
    ],
    auth: { accountToken: 'must-not-change' }
  };
}

function currentTrait(context, key, subject = 'user:user-1') {
  return Object.values(context || {}).find((entry) => (
    entry?.key === key && entry.subject === subject
  ));
}

function completionEvent(sessionId, text = 'The user prefers concise answers.') {
  const interactionId = `interaction-${sessionId}`;
  const rootId = `root-${sessionId}`;
  const sourceId = `local-${sessionId}`;
  return {
    schemaVersion: 3,
    eventId: `${sessionId}:${OBSERVER_ID}`,
    observerId: OBSERVER_ID,
    observerPluginId: 'self-evolution-reflection',
    accountId: ACCOUNT_ID,
    sessionId,
    runId: `run-${sessionId}`,
    chatKey: 'group:100',
    interactionId,
    topicId: 'shared-preferences',
    originalSourceIds: [rootId],
    pluginGeneration: 1,
    resultClass: 'done',
    actionSummary: {
      schemaVersion: 3,
      sentCount: 1,
      evidenceVersion: 3,
      interactionId,
      topicId: 'shared-preferences',
      originalSourceIds: [rootId],
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
        sourceRecordType: 'message',
        sourceRecordId: sourceId,
        messageId: sourceId,
        platformMessageId: `platform-${sessionId}`,
        role: 'user',
        senderId: 'user-1',
        interactionId,
        topicId: 'shared-preferences',
        originalSourceId: rootId,
        originalSourceIds: [rootId],
        text
      }]
    },
    sourceMessageIds: ['message-1'],
    completedAt: 1000
  };
}

function reflectionOutput(job, reflectionInput, key, value) {
  return {
    noteOperations: [],
    traitProposals: [{
      action: 'set',
      key,
      value,
      subject: 'user:user-1',
      candidateId: reflectionInput.existingCandidates
        .find((candidate) => candidate.key === key && candidate.value === value)?.candidateId,
      scope: 'chat',
      chatKey: 'group:100',
      confidence: 0.95,
      supportRefs: job.evidence.traitEvidencePool
        .filter((item) => String(item.text).includes(key === 'communication_style' ? 'concise' : 'English'))
        .map((item) => item.sourceRef),
      counterRefs: []
    }],
    capabilityGapProposals: [],
    summary: `reflection for ${job.sessionId}`
  };
}

function reflectionPluginFixture() {
  const dataDir = fs.mkdtempSync(path.join(root, 'enabled-'));
  const base = persona();
  const baseSnapshot = structuredClone(base);
  let modelCalls = 0;
  const plugin = createReflectionPlugin({
    dataDir,
    getBasePersona: () => base,
    getAccountId: () => ACCOUNT_ID,
    now: () => 1000,
    reflector: async ({ job, reflectionInput }) => {
      modelCalls += 1;
      if (job.sessionId.startsWith('communication-')) {
        return reflectionOutput(job, reflectionInput, 'communication_style', 'concise');
      }
      return reflectionOutput(job, reflectionInput, 'language_preference', 'English');
    },
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
  return { base, baseSnapshot, dataDir, modelCalls: () => modelCalls, plugin, ...started };
}

test('reflection plugin accumulates v3 candidates, requires review CAS, and rollback changes learned context', async () => {
  const fixture = reflectionPluginFixture();
  const { base, baseSnapshot, dataDir, modelCalls, plugin, store, worker } = fixture;
  try {
    for (let index = 1; index <= 3; index += 1) {
      const sessionId = `communication-${index}`;
      store.enqueueObservation(completionEvent(sessionId));
      assert.equal((await worker.runOnce()).status, 'completed');
    }
    for (let index = 1; index <= 3; index += 1) {
      const sessionId = `language-${index}`;
      store.enqueueObservation(completionEvent(sessionId, 'The user prefers English replies.'));
      assert.equal((await worker.runOnce()).status, 'completed');
    }
    assert.equal(modelCalls(), 6);
    assert.equal(store.getLearnedSelfRevision({ accountId: ACCOUNT_ID }), 0);
    const candidates = store.listCandidates({
      accountId: ACCOUNT_ID,
      chatKey: 'group:100',
      status: 'ready'
    });
    const communication = candidates.find((candidate) => candidate.key === 'communication_style');
    const language = candidates.find((candidate) => candidate.key === 'language_preference');
    assert.equal(communication.independentRoots.length, 3);
    assert.equal(language.independentRoots.length, 3);
    assert.equal(store.reviewCandidate({
      proposalId: communication.proposalId,
      decision: 'approve',
      actor: 'closure-admin',
      expectedProfileRevision: 0,
      basePersonaHash: hashBasePersona(base)
    }).profileRevision, 1);
    const staleLanguage = store.reviewCandidate({
      proposalId: language.proposalId,
      decision: 'approve',
      actor: 'closure-admin',
      expectedProfileRevision: 1,
      basePersonaHash: hashBasePersona(base)
    });
    assert.equal(staleLanguage.reviewed, false);
    assert.equal(staleLanguage.reason, 'stale');
    assert.equal(store.getLearnedSelfRevision({ accountId: ACCOUNT_ID }), 1);
    store.enqueueObservation(completionEvent('language-4', 'The user prefers English replies.'));
    assert.equal((await worker.runOnce()).status, 'completed');
    assert.equal(modelCalls(), 7);
    const refreshedLanguage = store.listCandidates({
      accountId: ACCOUNT_ID, chatKey: 'group:100', status: 'ready'
    }).find((candidate) => candidate.key === 'language_preference');
    assert.ok(refreshedLanguage);
    assert.equal(store.reviewCandidate({
      proposalId: refreshedLanguage.proposalId,
      decision: 'approve',
      actor: 'closure-admin',
      expectedProfileRevision: 1,
      basePersonaHash: hashBasePersona(base)
    }).profileRevision, 2);

    let learned = store.getLearnedSelfContext({
      accountId: ACCOUNT_ID,
      chatKey: 'group:100',
      basePersona: base
    });
    assert.equal(learned.revision, 2);
    assert.equal(currentTrait(learned.context, 'communication_style').value, 'concise');
    assert.equal(currentTrait(learned.context, 'language_preference').value, 'English');

    const rollback = store.rollbackProfile({
      accountId: ACCOUNT_ID,
      targetRevision: 1,
      expectedCurrentRevision: 2,
      basePersona: base,
      actor: 'closure-admin',
      reason: 'closure verification'
    });
    assert.equal(rollback.revision, 3);
    assert.equal(rollback.parentRevision, 2);
    learned = store.getLearnedSelfContext({
      accountId: ACCOUNT_ID,
      chatKey: 'group:100',
      basePersona: base
    });
    assert.equal(learned.revision, 3);
    assert.equal(currentTrait(learned.context, 'communication_style').value, 'concise');
    assert.equal(currentTrait(learned.context, 'language_preference'), undefined);
    assert.deepEqual(
      store.listProfileVersions({ accountId: ACCOUNT_ID }).map((version) => version.revision),
      [3, 2, 1]
    );
    assert.equal(store.getLearnedSelfRevision({ accountId: ACCOUNT_ID }), 3);
    assert.deepEqual(base, baseSnapshot);
    assert.equal(hashBasePersona(base), store.listProfileVersions({
      accountId: ACCOUNT_ID
    })[0].basePersonaHash);
    assert.ok(fs.existsSync(reflectionDatabasePath(dataDir)));
  } finally {
    await plugin.stop('closure-test');
  }
});

test('disabled self-evolution creates no new DB/worker/model/embedding calls and reads old data', async () => {
  const disabledDir = fs.mkdtempSync(path.join(root, 'disabled-empty-'));
  const disabledPlugin = createSelfEvolutionPlugin({ dataDir: disabledDir });
  let reflectionModelCalls = 0;
  const disabledReflection = createReflectionPlugin({
    dataDir: disabledDir,
    getAccountId: () => ACCOUNT_ID,
    reflector: async () => {
      reflectionModelCalls += 1;
      return {};
    }
  });
  const manager = new PluginManager({
    configProvider: () => ({
      selfEvolution: {
        enabled: false,
        retrieval: { enabled: true },
        reflection: { enabled: true }
      }
    })
  });
  manager.registerAll([disabledPlugin, disabledReflection]);
  await manager.startAll();
  try {
    assert.equal(manager.runtime.has('self-evolution'), false);
    assert.equal(manager.runtime.has('self-evolution-reflection'), false);
    assert.equal(disabledReflection.getWorker(), null);
    assert.deepEqual(manager.createRunSnapshot().tools, []);
    assert.deepEqual(manager.createRunSnapshot().contextProviders, []);
    assert.equal(fs.existsSync(notebookDatabasePath(disabledDir)), false);
    assert.equal(fs.existsSync(reflectionDatabasePath(disabledDir)), false);
    assert.equal(reflectionModelCalls, 0);

    let embeddingCalls = 0;
    const provider = createSelfEvolutionRetrievalProvider({
      dataDir: disabledDir,
      embeddingAdapter: {
        async embedQuery() {
          embeddingCalls += 1;
          return [1, 0];
        }
      }
    });
    const disabledResult = await provider.provide({
      accountId: ACCOUNT_ID,
      chatKey: 'group:100',
      sessionId: 'disabled-retrieval',
      retrievalQuery: 'old'
    }, {
      config: {
        selfEvolution: {
          enabled: false,
          retrieval: {
            enabled: true,
            embedding: {
              enabled: true,
              provider: 'closure',
              model: 'closure',
              dimension: 2,
              allowQuery: true
            }
          }
        }
      }
    });
    assert.deepEqual(disabledResult.blocks, []);
    assert.equal(embeddingCalls, 0);

    const oldDataDir = fs.mkdtempSync(path.join(root, 'disabled-existing-'));
    const oldStore = new NotebookStore({ dataDir: oldDataDir });
    const oldNote = oldStore.append({
      accountId: ACCOUNT_ID,
      scope: 'chat',
      chatKey: 'group:100',
      content: 'old data remains readable',
      source: {
        kind: 'chat',
        accountId: ACCOUNT_ID,
        chatKey: 'group:100',
        sessionId: 'old-session',
        runId: 'old-run'
      },
      currentChatKey: 'group:100',
      idempotencyKey: 'old-note'
    });
    oldStore.close();

    const readOnly = NotebookStore.openExisting({ dataDir: oldDataDir });
    assert.ok(readOnly);
    assert.equal(readOnly.readOnly, true);
    assert.equal(readOnly.get({
      accountId: ACCOUNT_ID,
      noteId: oldNote.note.id,
      currentChatKey: 'group:100'
    }).content, 'old data remains readable');
    readOnly.close();
    fs.rmSync(oldDataDir, { recursive: true, force: true });
  } finally {
    await manager.stopAll();
    fs.rmSync(disabledDir, { recursive: true, force: true });
  }
});
