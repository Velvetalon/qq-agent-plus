import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  EmbeddingIndex,
  RetrievalService,
  createMemoryIndexAdapter,
  createSqliteIndexAdapter,
  detectFts5,
  escapeFts5Query
} from '../src/features/retrieval.js';

function note(id, content, extra = {}) {
  return {
    id,
    revision: extra.revision ?? 1,
    content,
    status: extra.status ?? 'active',
    scope: extra.scope ?? 'global',
    accountId: extra.accountId ?? 'acct-1',
    ...extra
  };
}

test('Chinese short terms, mixed terms, and person QQ IDs use deterministic lexical matching', async () => {
  const service = new RetrievalService({
    index: createMemoryIndexAdapter([
      note('n1', '小猫喜欢在窗边晒太阳，和 Alice 一起玩。', { personQqId: '123456' }),
      note('n2', 'Alice 负责整理群文件。', { personQqId: '654321' }),
      note('n3', '无关的天气记录。')
    ])
  });

  const shortWord = await service.search({ query: '小猫', accountId: 'acct-1' });
  assert.equal(shortWord.results[0].noteId, 'n1');
  assert.match(shortWord.results[0].snippet, /小猫/);

  const mixed = await service.search({ query: 'Alice 窗边', accountId: 'acct-1' });
  assert.equal(mixed.results[0].noteId, 'n1');
  assert.ok(mixed.results[0].matchedTerms.includes('alice'));
  const compactMixed = await service.search({ query: 'Alice窗边', accountId: 'acct-1' });
  assert.equal(compactMixed.results[0].noteId, 'n1');

  const person = await service.search({ query: '123456', accountId: 'acct-1' });
  assert.equal(person.results[0].noteId, 'n1');
  assert.ok(person.results[0].score > 2);
});

test('permission, scope, status, expiry, dedupe, ranking, and budget are enforced before selection', async () => {
  const now = Date.parse('2026-09-25T00:00:00Z');
  const service = new RetrievalService({
    index: createMemoryIndexAdapter([
      note('same', '旧版本 keyword', { revision: 1 }),
      note('same', '新版本 keyword', { revision: 2 }),
      note('chat-other', 'keyword', { scope: 'chat', scopeChatKey: 'group:2' }),
      note('chat-current', 'keyword', { scope: 'chat', scopeChatKey: 'group:1' }),
      note('archived', 'keyword', { status: 'archived' }),
      note('expired', 'keyword', { expiresAt: now - 1 }),
      note('denied', 'keyword'),
      { id: 'no-account', revision: 1, content: 'keyword', status: 'active', scope: 'global' },
      note('long', 'keyword '.repeat(100))
    ])
  });
  const result = await service.search({
    query: 'keyword',
    accountId: 'acct-1',
    chatKey: 'group:1',
    now,
    maxNotes: 2,
    maxChars: 25,
    canRead: (candidate) => candidate.id !== 'denied'
  });
  assert.deepEqual(result.results.map((item) => item.noteId), ['same', 'chat-current']);
  assert.equal(result.results[0].revision, 2);
  assert.ok(result.budget.usedChars <= 25);
  assert.ok(result.filtered.status >= 1);
  assert.ok(result.filtered.expiry >= 1);
  assert.ok(result.filtered.permission >= 1);
  assert.ok(result.filtered.account >= 1);
  assert.ok(result.contextBlocks[0].noteId);
  assert.equal(result.contextBlocks[0].revision, 2);
  assert.equal(result.contextBlocks[0].rankingSource, 'lexical');
  assert.ok(result.contextBlocks[0].budget);
});

test('FTS5 detection and query escaping never interpolate user text', () => {
  const escaped = escapeFts5Query('alpha" OR beta');
  assert.match(escaped, /^".*" AND ".*"$/);
  assert.ok(escaped.includes('""'));

  const db = new DatabaseSync(':memory:');
  const capability = detectFts5(db);
  assert.equal(capability.available, true);
  db.exec('CREATE TABLE notebook_notes (id TEXT PRIMARY KEY, revision INTEGER, content TEXT, status TEXT, scope TEXT)');
  db.exec('CREATE VIRTUAL TABLE notebook_notes_fts USING fts5(note_id UNINDEXED, content)');
  db.prepare('INSERT INTO notebook_notes VALUES (?, ?, ?, ?, ?)').run(
    'n1', 1, '中文检索 alpha', 'active', 'global'
  );
  db.prepare('INSERT INTO notebook_notes_fts VALUES (?, ?)').run('n1', '中文检索 alpha');
  const adapter = createSqliteIndexAdapter({ db });
  const hits = adapter.searchFts({ query: 'alpha' });
  assert.equal(hits[0].noteId, 'n1');
  assert.doesNotThrow(() => adapter.searchFts({ query: 'alpha\'; DROP TABLE notebook_notes; --' }));
  assert.equal(db.prepare('SELECT count(*) AS count FROM notebook_notes').get().count, 1);
  assert.equal(adapter.listNotes()[0].id, 'n1');
  db.close();
});

test('FTS5 bm25 ranks are converted to a deterministic bounded fusion score', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE VIRTUAL TABLE notebook_notes_fts USING fts5(note_id UNINDEXED, content)');
  const insert = db.prepare('INSERT INTO notebook_notes_fts VALUES (?, ?)');
  insert.run('best', 'alpha alpha alpha alpha');
  insert.run('other', 'alpha');
  const adapter = createSqliteIndexAdapter({ db });
  const hits = adapter.searchFts({ query: 'alpha' });
  assert.deepEqual(hits.map((hit) => hit.noteId), ['best', 'other']);
  assert.deepEqual(hits.map((hit) => hit.rank), [1, 2]);
  assert.ok(hits[0].rawScore < hits[1].rawScore);
  assert.ok(hits[0].score > hits[1].score);
  db.close();
});

test('embedding metadata is validated and stale responses cannot overwrite newer revisions', () => {
  let current = note('n1', 'old content', { revision: 1 });
  const index = new EmbeddingIndex({
    provider: 'test-provider',
    model: 'test-model',
    dimension: 2,
    getCurrentNote: () => current
  });
  assert.deepEqual(index.put(current, [1, 0]), { accepted: true, reason: null });
  current = note('n1', 'new content', { revision: 2 });
  const stale = index.put(note('n1', 'old content', { revision: 1 }), [0, 1]);
  assert.deepEqual(stale, { accepted: false, reason: 'embedding-stale-response' });
  assert.deepEqual(index.get('n1').vector, [1, 0]);
  assert.equal(index.put(current, [1, 0], { provider: 'wrong' }).accepted, false);
});

test('stale embedding index entries are ignored for a newer note revision', async () => {
  let current = note('n1', 'old content', { revision: 1 });
  const index = createMemoryIndexAdapter([current]);
  const embeddingIndex = new EmbeddingIndex({
    provider: 'test-provider',
    model: 'test-model',
    dimension: 2,
    getCurrentNote: () => index.getNote('n1')
  });
  assert.equal(embeddingIndex.put(current, [1, 0]).accepted, true);

  current = note('n1', 'new content', { revision: 2 });
  index.upsert(current);
  const service = new RetrievalService({
    index,
    embeddingIndex,
    embedding: {
      enabled: true,
      provider: 'test-provider',
      model: 'test-model',
      dimension: 2
    }
  });
  const stale = await service.search({ query: 'semantic-only', embeddingQueryVector: [1, 0] });
  assert.equal(stale.results.length, 0);

  assert.equal(embeddingIndex.put(current, [1, 0]).accepted, true);
  const fresh = await service.search({ query: 'semantic-only', embeddingQueryVector: [1, 0] });
  assert.equal(fresh.results[0].noteId, 'n1');
  assert.equal(fresh.results[0].rankingSource, 'embedding');
});

test('disabled, unavailable, and failed embedding degrade without blocking lexical retrieval', async () => {
  let unavailableCalls = 0;
  const unavailableAdapter = {
    enabled: true,
    provider: 'provider',
    model: 'model',
    dimension: 2,
    isAvailable: () => false,
    async embedQuery() {
      unavailableCalls += 1;
      return [1, 0];
    }
  };
  const unavailableService = new RetrievalService({
    index: createMemoryIndexAdapter([note('n1', '继续使用 lexical')]),
    embedding: { enabled: true },
    embeddingAdapter: unavailableAdapter
  });
  const unavailable = await unavailableService.search({ query: 'lexical' });
  assert.equal(unavailableCalls, 0);
  assert.equal(unavailable.results[0].noteId, 'n1');
  assert.ok(unavailable.degradationReasons.includes('embedding-unavailable'));

  let failedCalls = 0;
  const failing = {
    enabled: true,
    provider: 'provider',
    model: 'model',
    dimension: 2,
    authorizeQuery: () => true,
    async embedQuery() {
      failedCalls += 1;
      throw new Error('offline');
    }
  };
  const failedService = new RetrievalService({
    index: createMemoryIndexAdapter([note('n2', 'lexical still works')]),
    embedding: { enabled: true },
    embeddingAdapter: failing
  });
  const first = await failedService.search({ query: 'lexical' });
  const second = await failedService.search({ query: 'lexical' });
  assert.equal(first.results[0].noteId, 'n2');
  assert.equal(second.results[0].noteId, 'n2');
  assert.equal(failedCalls, 1);
  assert.ok(first.degradationReasons.includes('embedding-failed'));
  assert.ok(second.degradationReasons.includes('embedding-failed'));

  let disabledCalls = 0;
  const disabledAdapter = {
    provider: 'provider',
    model: 'model',
    dimension: 2,
    async embedQuery() {
      disabledCalls += 1;
      return [1, 0];
    }
  };
  const disabledService = new RetrievalService({
    index: createMemoryIndexAdapter([note('n3', 'lexical remains available')]),
    embedding: { enabled: false },
    embeddingAdapter: disabledAdapter
  });
  const disabled = await disabledService.search({ query: 'lexical' });
  assert.equal(disabled.results[0].noteId, 'n3');
  assert.equal(disabledCalls, 0);
  assert.ok(disabled.degradationReasons.includes('embedding-disabled'));
});

test('unconfigured and unauthorized embedding paths make zero external calls', async () => {
  let unconfiguredCalls = 0;
  const unconfiguredAdapter = {
    async embedQuery() {
      unconfiguredCalls += 1;
      return [1, 0];
    },
    async embedNote() {
      unconfiguredCalls += 1;
      return [1, 0];
    }
  };
  const unconfiguredService = new RetrievalService({
    index: createMemoryIndexAdapter([note('n1', 'lexical fallback')]),
    embedding: { enabled: true },
    embeddingAdapter: unconfiguredAdapter
  });
  const unconfigured = await unconfiguredService.search({ query: 'lexical' });
  const unconfiguredIndex = await unconfiguredService.indexEmbedding(note('n1', 'lexical fallback'));
  assert.equal(unconfiguredCalls, 0);
  assert.equal(unconfigured.results[0].noteId, 'n1');
  assert.equal(unconfiguredIndex.reason, 'embedding-unconfigured');
  assert.ok(unconfigured.degradationReasons.includes('embedding-unconfigured'));

  let unauthorizedCalls = 0;
  let authorized = false;
  const authorizedAdapter = {
    provider: 'provider',
    model: 'model',
    dimension: 2,
    authorizeQuery: () => authorized,
    async embedQuery() {
      unauthorizedCalls += 1;
      return [1, 0];
    }
  };
  const authorizedService = new RetrievalService({
    index: createMemoryIndexAdapter([note('n2', 'lexical remains')]),
    embedding: { enabled: true },
    embeddingAdapter: authorizedAdapter
  });
  const denied = await authorizedService.search({ query: 'lexical' });
  assert.equal(unauthorizedCalls, 0);
  assert.equal(denied.results[0].noteId, 'n2');
  assert.ok(denied.degradationReasons.includes('embedding-query-authorization-required'));

  authorized = true;
  const allowed = await authorizedService.search({ query: 'lexical' });
  assert.equal(unauthorizedCalls, 1);
  assert.equal(allowed.results[0].noteId, 'n2');
});

test('FTS5 unavailable uses pure lexical fallback with an observable degradation reason', async () => {
  const service = new RetrievalService({
    index: {
      fts5: { available: false, reason: 'fts5-unavailable' },
      listNotes: () => [note('fallback', '短词也能通过中文子串召回')]
    }
  });
  const result = await service.search({ query: '短词', accountId: 'acct-1' });
  assert.equal(result.results[0].noteId, 'fallback');
  assert.ok(result.degradationReasons.includes('fts5-unavailable'));
});

test('FTS5 query failures fall back to lexical retrieval', async () => {
  const service = new RetrievalService({
    index: {
      fts5: { available: true, reason: 'compile-option' },
      listNotes: () => [note('fallback', 'lexical still searches this note')],
      searchFts: async () => {
        throw new Error('fts unavailable at query time');
      }
    }
  });
  const result = await service.search({ query: 'lexical' });
  assert.equal(result.results[0].noteId, 'fallback');
  assert.ok(result.degradationReasons.includes('fts5-query-failed'));
});

test('private note embedding requires explicit adapter authorization', async () => {
  let calls = 0;
  const service = new RetrievalService({
    index: createMemoryIndexAdapter([note('private', 'private material', {
      scope: 'chat',
      scopeChatKey: 'group:1'
    })]),
    embedding: { enabled: true, provider: 'p', model: 'm', dimension: 2 },
    embeddingAdapter: {
      async embedNote() {
        calls += 1;
        return [1, 0];
      }
    }
  });
  const result = await service.indexEmbedding(
    note('private', 'private material', { scope: 'chat', scopeChatKey: 'group:1' })
  );
  assert.equal(result.reason, 'embedding-private-authorization-required');
  assert.equal(calls, 0);
});
