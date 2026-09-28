import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createEmbeddingCapability } from '../src/plugins/self-evolution/embedding-runtime.js';
import { EmbeddingClient } from '../src/plugins/self-evolution/embedding-client.js';
import { NotebookStore } from '../src/plugins/self-evolution/notebook-store.js';

function config(overrides = {}) {
  return {
    enabled: true,
    provider: 'repair-test',
    endpoint: 'http://embedding.test/v1',
    model: 'repair-2d',
    dimension: 2,
    allowPrivate: true,
    allowQuery: true,
    ...overrides
  };
}

function source() {
  return {
    kind: 'chat',
    accountId: 'bot-repair',
    chatKey: 'group:1',
    sessionId: 'repair-session',
    runId: 'repair-run'
  };
}

test('host embedding capability keeps credentials private and honors explicit query denial', async () => {
  const requests = [];
  const capability = createEmbeddingCapability({
    config: config({ apiKey: 'secret-repair-key', allowQuery: false }),
    fetchImpl: async (_url, options) => {
      requests.push({ headers: options.headers, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }] }), { status: 200 });
    }
  });
  assert.equal(Object.hasOwn(capability, 'apiKey'), false);
  assert.equal(Object.hasOwn(capability.config, 'apiKey'), false);
  assert.equal(await capability.authorizeQuery(), false);
  await assert.rejects(
    () => capability.embedQuery({ query: '不会外发' }),
    (error) => error.code === 'EMBEDDING_EXTERNAL_DISALLOWED'
  );
  assert.equal(requests.length, 0);
  const noteVector = await capability.embedNote({
    note: { scope: 'global' },
    text: '允许的全局笔记'
  });
  assert.deepEqual(noteVector, [1, 0]);
  assert.equal(requests[0].headers.authorization, 'Bearer secret-repair-key');
});

test('semantic search does not create document embeddings and reports index-not-ready', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-functional-repair-'));
  let documents = 0;
  let queries = 0;
  const client = {
    isConfigured: () => true,
    async authorizeNote() { return true; },
    async authorizeQuery() { return true; },
    async embedNote() { documents += 1; return [1, 0]; },
    async embedQuery() { queries += 1; return [1, 0]; }
  };
  const store = new NotebookStore({
    dataDir: root,
    embeddingConfig: config(),
    embeddingClient: client
  });
  try {
    store.append({
      accountId: 'bot-repair',
      scope: 'chat',
      chatKey: 'group:1',
      content: '摄影经验',
      source: source(),
      currentChatKey: 'group:1',
      idempotencyKey: 'repair-note'
    });
    const before = await store.semanticSearch({
      accountId: 'bot-repair',
      chatKey: 'group:1',
      query: '摄影'
    });
    assert.equal(before.degradationReason, 'index-not-ready');
    assert.equal(documents, 0);
    assert.equal(queries, 0);
    assert.equal((await store.processEmbeddingQueue()).processed, 1);
    const after = await store.semanticSearch({
      accountId: 'bot-repair',
      chatKey: 'group:1',
      query: '摄影'
    });
    assert.equal(documents, 1);
    assert.equal(queries, 1);
    assert.equal(after.results.length, 1);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('temporary embedding failure retries with a bounded delay and reaches ready', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-functional-retry-'));
  let now = 1000;
  let attempts = 0;
  const client = {
    isConfigured: () => true,
    async authorizeNote() { return true; },
    async authorizeQuery() { return true; },
    async embedNote() {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('temporary'), { code: 'EMBEDDING_HTTP' });
      return [1, 0];
    },
    async embedQuery() { return [1, 0]; }
  };
  const store = new NotebookStore({
    dataDir: root,
    now: () => now,
    embeddingConfig: config(),
    embeddingClient: client
  });
  try {
    store.append({
      accountId: 'bot-repair',
      scope: 'chat',
      chatKey: 'group:1',
      content: '可恢复的索引任务',
      source: source(),
      currentChatKey: 'group:1',
      idempotencyKey: 'retry-note'
    });
    assert.equal((await store.processEmbeddingQueue()).processed, 0);
    const waiting = store.database.prepare('SELECT status,attempts,available_at FROM notebook_embedding_jobs').get();
    assert.equal(waiting.status, 'pending');
    assert.equal(waiting.attempts, 1);
    assert.ok(Number(waiting.available_at) > now);
    now = Number(waiting.available_at);
    assert.equal((await store.processEmbeddingQueue()).processed, 1);
    assert.equal(store.database.prepare('SELECT status FROM notebook_embedding_jobs').get().status, 'ready');
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
