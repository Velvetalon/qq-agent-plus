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

function completionEvent(sessionId) {
  return {
    eventId: `${sessionId}:${OBSERVER_ID}`,
    observerId: OBSERVER_ID,
    observerPluginId: 'self-evolution-reflection',
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
    sourceMessageIds: ['message-1'],
    completedAt: 1000
  };
}

function reflectionOutput(job, key, value) {
  return {
    noteOperations: [],
    traitProposals: [{
      action: 'set',
      key,
      value,
      scope: 'global',
      confidence: 0.95,
      evidenceRefs: [`session:${job.sessionId}`]
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
    reflector: async ({ job }) => {
      modelCalls += 1;
      if (job.sessionId === 'job-1') {
        return reflectionOutput(job, 'communication_style', 'concise');
      }
      return reflectionOutput(job, 'language_preference', 'English');
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

test('reflection plugin applies job1/job2 as revisions 1/2 and rollback changes learned context', async () => {
  const fixture = reflectionPluginFixture();
  const { base, baseSnapshot, dataDir, modelCalls, plugin, store, worker } = fixture;
  try {
    store.enqueueObservation(completionEvent('job-1'));
    const first = await worker.runOnce();
    assert.equal(first.status, 'completed');
    assert.equal(first.profileRevision, 1);

    store.enqueueObservation(completionEvent('job-2'));
    const second = await worker.runOnce();
    assert.equal(second.status, 'completed');
    assert.equal(second.profileRevision, 2);
    assert.equal(modelCalls(), 2);
    const jobStatuses = Object.fromEntries(
      store.listJobs().map((job) => [job.sessionId, job.status])
    );
    assert.deepEqual(jobStatuses, {
      'job-1': 'applied',
      'job-2': 'applied'
    });

    let learned = store.getLearnedSelfContext({
      accountId: ACCOUNT_ID,
      basePersona: base
    });
    assert.equal(learned.revision, 2);
    assert.equal(learned.context.communication_style.value, 'concise');
    assert.equal(learned.context.language_preference.value, 'English');

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
      basePersona: base
    });
    assert.equal(learned.revision, 3);
    assert.equal(learned.context.communication_style.value, 'concise');
    assert.equal(learned.context.language_preference, undefined);
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
