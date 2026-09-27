import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  EmbeddingClient,
  embeddingProfileId
} from '../src/plugins/self-evolution/embedding-client.js';
import {
  NotebookStore,
  ReflectionStore,
  normalizeCompletionObservation,
  validateReflectionOutput
} from '../src/plugins/self-evolution/index.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-vector-persona-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function source(accountId = 'bot-a', chatKey = 'group:1') {
  return {
    kind: 'chat',
    accountId,
    chatKey,
    sessionId: 'session-vector',
    runId: 'run-vector'
  };
}

function embeddingConfig(overrides = {}) {
  return {
    enabled: true,
    provider: 'fake-http',
    endpoint: 'http://embedding.test/v1',
    model: 'fake-2d',
    dimension: 2,
    allowPrivate: true,
    allowQuery: true,
    ...overrides
  };
}

function fakeEmbeddingClient() {
  return {
    async isAvailable() {
      return true;
    },
    async authorizeNote() {
      return true;
    },
    async authorizeQuery() {
      return true;
    },
    async embedNote({ text }) {
      return /摄影|photo/iu.test(text) ? [1, 0] : [0, 1];
    },
    async embedQuery({ query }) {
      return /摄影|photo/iu.test(query) ? [1, 0] : [0, 1];
    }
  };
}

test('embedding client validates a fake HTTP boundary and isolates profile identity', async () => {
  let request = null;
  const client = new EmbeddingClient({
    config: embeddingConfig(),
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return new Response(JSON.stringify({
        data: [
          { index: 0, embedding: [1, 0] },
          { index: 1, embedding: [0, 1] }
        ],
        usage: { prompt_tokens: 4, total_tokens: 4 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const result = await client.embedDocuments(['摄影', '别的事情']);
  assert.deepEqual(result.vectors, [[1, 0], [0, 1]]);
  assert.equal(request.model, 'fake-2d');
  assert.equal(request.input.length, 2);
  assert.notEqual(
    embeddingProfileId(embeddingConfig()),
    embeddingProfileId(embeddingConfig({ endpoint: 'http://other.test/v1' }))
  );
  await assert.rejects(
    () => new EmbeddingClient({
      config: embeddingConfig(),
      fetchImpl: async () => new Response(JSON.stringify({
        data: [{ index: 0, embedding: [0, 0] }]
      }), { status: 200 })
    }).embedQuery({ query: 'zero' }),
    /zero norm/
  );
});

test('Notebook writes queue a derived sqlite-vec index, survive restart, and reject stale scope', async () => {
  const dataDir = path.join(root, 'notebook');
  const filename = path.join(dataDir, 'plugins', 'self-evolution', 'state.sqlite');
  const client = fakeEmbeddingClient();
  const store = new NotebookStore({
    dataDir,
    filename,
    embeddingConfig: embeddingConfig(),
    embeddingClient: client
  });
  const first = store.append({
    accountId: 'bot-a',
    scope: 'chat',
    chatKey: 'group:1',
    content: '摄影棚拍经验',
    source: source(),
    currentChatKey: 'group:1',
    idempotencyKey: 'vector-append'
  });
  assert.equal(store.database.prepare(
    "SELECT COUNT(*) AS n FROM notebook_embedding_jobs WHERE status='pending'"
  ).get().n, 1);
  assert.equal((await store.processEmbeddingQueue()).processed, 1);
  const found = await store.semanticSearch({
    accountId: 'bot-a',
    chatKey: 'group:1',
    query: 'photo',
    maxNotes: 5
  });
  assert.equal(found.results.length, 1);
  assert.equal(found.results[0].noteId, first.note.id);
  assert.equal(found.results[0].rankingSource, 'sqlite-vec');

  const updated = store.update({
    accountId: 'bot-a',
    noteId: first.note.id,
    expectedRevision: 1,
    content: '完全不同的事情',
    source: source(),
    currentChatKey: 'group:1',
    idempotencyKey: 'vector-update'
  });
  assert.equal((await store.processEmbeddingQueue()).processed, 1);
  const old = await store.semanticSearch({
    accountId: 'bot-a',
    chatKey: 'group:1',
    query: 'photo'
  });
  assert.equal(old.results.length, 0);
  const current = await store.semanticSearch({
    accountId: 'bot-a',
    chatKey: 'group:1',
    query: 'unrelated'
  });
  assert.equal(current.results[0].revision, updated.revision);
  store.close();

  const reopened = new NotebookStore({
    dataDir,
    filename,
    create: false,
    readOnly: true,
    embeddingConfig: embeddingConfig(),
    embeddingClient: client
  });
  const afterRestart = await reopened.semanticSearch({
    accountId: 'bot-a',
    chatKey: 'group:1',
    query: 'unrelated'
  });
  assert.equal(afterRestart.results[0].revision, 2);
  reopened.close();
});

test('canonical evidence deduplicates message text and ignores free-text failure words', () => {
  const event = normalizeCompletionObservation({
    eventId: 'event-a',
    observerId: 'self-evolution.reflection',
    observerPluginId: 'self-evolution',
    accountId: 'bot-a',
    sessionId: 'session-a',
    runId: 'run-a',
    chatKey: 'group:1',
    resultClass: 'done',
    actionSummary: {
      finishReason: 'normal API tool discussion with HTTP examples',
      participation: { decision: 'reply' },
      termination: { kind: 'finish' },
      outbound: { attempted: 0, succeeded: 0, failed: 0, unknown: 0, held: 0 },
      conversationEvidence: [
        {
          evidenceId: 'message:m1',
          messageId: 'm1',
          role: 'user',
          at: 2,
          text: '同一正文',
          confirmed: true
        },
        {
          evidenceId: 'message:m1',
          messageId: 'm1',
          role: 'user',
          at: 3,
          text: '同一正文',
          confirmed: true
        }
      ]
    }
  });
  assert.equal(event.conversationEvidence.length, 1);
  assert.equal(event.evidenceVersion, 2);
  assert.deepEqual(event.failureKinds, []);
  assert.equal(event.traitEligible, true);
  const structuredFailure = normalizeCompletionObservation({
    ...event,
    eventId: 'event-api-failure',
    sessionId: 'session-api-failure',
    runId: 'run-api-failure',
    actionSummary: {
      ...event.actionSummary,
      executionOutcome: { status: 'failed', code: 'API_ERROR', failed: true }
    }
  });
  assert.ok(structuredFailure.failureKinds.includes('api_failure'));
});

test('expired leased jobs at max attempts terminate and do not block the next job', () => {
  let now = 1000;
  const store = new ReflectionStore({
    filename: path.join(root, 'attempts.sqlite'),
    now: () => now,
    limits: { leaseMs: 10, workerLeaseMs: 20, maxAttempts: 1, backoffMs: 0 }
  });
  const event = (id) => ({
    eventId: id,
    observerId: 'self-evolution.reflection',
    observerPluginId: 'self-evolution',
    accountId: 'bot-a',
    sessionId: id,
    runId: `run-${id}`,
    chatKey: 'group:1',
    resultClass: 'done',
    actionSummary: { outbound: { attempted: 0 } }
  });
  try {
    const first = store.enqueueObservation(event('attempt-one')).job;
    const generation = store.beginWorkerGeneration({ owner: 'attempt-worker' });
    const claimed = store.claimNextJob({
      owner: 'attempt-worker',
      generation,
      leaseMs: 10,
      workerLeaseMs: 20
    });
    assert.equal(claimed.job.id, first.id);
    now += 20;
    store.enqueueObservation(event('attempt-two'));
    const nextGeneration = store.beginWorkerGeneration({ owner: 'next-worker' });
    const next = store.claimNextJob({
      owner: 'next-worker',
      generation: nextGeneration,
      leaseMs: 10,
      workerLeaseMs: 20
    });
    assert.equal(next.status, 'claimed');
    assert.equal(store.listJobs().find((job) => job.id === first.id).status, 'failed');
    assert.equal(
      store.listAudit({ limit: 20 }).some((row) => row.code === 'REFLECTION_ATTEMPTS_EXHAUSTED'),
      true
    );
  } finally {
    store.close();
  }
});

test('role note validation allows a concrete temporary experience without durable keywords', () => {
  const evidence = normalizeCompletionObservation({
    eventId: 'role-note',
    observerId: 'self-evolution.reflection',
    observerPluginId: 'self-evolution',
    accountId: 'bot-a',
    sessionId: 'role-note-session',
    runId: 'role-note-run',
    chatKey: 'group:1',
    resultClass: 'done',
    actionSummary: {
      conversationEvidence: [{
        evidenceId: 'message:role-note',
        role: 'user',
        text: '今天一起去摄影棚，临时但很有意思'
      }]
    }
  });
  const output = validateReflectionOutput({
    noteOperations: [{
      operation: 'append',
      scope: 'chat',
      chatKey: 'group:1',
      content: '今天一起去摄影棚，临时但很有意思，之后还想继续聊。',
      tags: ['经历'],
      evidenceRefs: ['message:role-note']
    }],
    traitProposals: [],
    capabilityGapProposals: [],
    summary: '留下一段具体经历'
  }, { evidence });
  assert.equal(output.noteOperations[0].content.includes('摄影棚'), true);
});
