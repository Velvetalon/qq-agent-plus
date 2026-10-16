import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSelfEvolutionPlugin } from '../src/plugins/builtin/self-evolution.js';
import { createSelfEvolutionRetrievalProvider } from '../src/plugins/self-evolution/retrieval-provider.js';
import { fixtureEmbeddingConfig, fixtureEmbeddingClient, indexFixtureNotes } from './helpers/notebook-vector-fixture.mjs';

test('F4 actual tools and ready SQL enforce exact tags, metadata, scope, cancellation and zero fallback', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-f4-consumers-'));
  let queries = 0, documents = 0, action = null;
  const client = { ...fixtureEmbeddingClient,
    embedNote: async (args) => { documents += 1; return fixtureEmbeddingClient.embedNote(args); },
    embedQuery: async (args) => { queries += 1; if (action) await action(args); return [1, 0]; }
  };
  const cfg = { selfEvolution: { enabled: true, retrieval: { enabled: true, embedding: fixtureEmbeddingConfig } } };
  const plugin = createSelfEvolutionPlugin({ dataDir, embeddingClient: client });
  const tools = []; plugin.declare({ addTools: (entries) => tools.push(...entries) });
  plugin.start({}, cfg); const store = plugin.getStore(); await store.stopEmbeddingWorker();
  t.after(async () => { await plugin.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const ctx = { accountId: 'test', chatKey: 'group:1', sessionId: 's', runId: 'r' };
  const search = tools.find((tool) => tool.name === 'notebook_search');
  const invoke = async (args, context = ctx) => { const r = await search.execute(context, args); assert.ok(!r.isError, r.content); return JSON.parse(r.content); };
  const append = (id, tags, chatKey = ctx.chatKey) => store.append({ accountId: ctx.accountId, scope: 'chat', chatKey,
    content: 'Current full note ' + id + 'x'.repeat(700), tags, source: { kind: 'chat', ...ctx, chatKey },
    currentChatKey: chatKey, idempotencyKey: id }).note;
  const note = append('exact', ['cat', '100%_"']);
  append('substring', ['bobcat']); const other = append('other', ['private'], 'group:2');
  assert.equal((await invoke({ query: 'Current' })).degradationReason, 'index-not-ready');
  assert.equal(queries, 0); assert.equal(documents, 0);
  await indexFixtureNotes(store); assert.equal(documents, 3);
  const result = await invoke({ query: 'Current', tags: ['cat'], scope: 'chat' });
  assert.deepEqual(result.notes.map((n) => n.noteId), [note.id]);
  const hit = result.notes[0];
  assert.equal(hit.scope, 'chat'); assert.equal(hit.chatKey, ctx.chatKey); assert.deepEqual(hit.tags, note.tags);
  assert.equal(hit.isTruncated, true); assert.equal(hit.revision, 1); assert.equal(hit.rankingSource, 'sqlite-vec'); assert.equal(hit.distance, 0);
  assert.equal(hit.content, undefined, 'excerpt is not falsely labeled full content');
  assert.equal((await invoke({ query: 'Current', tags: ['100%_"'] })).notes.length, 1);
  const beforeNoScope = queries;
  for (const args of [{ query: 'Current', tags: ['ca'] }, { query: 'Current', tags: ['private'] }, { query: 'Current', scope: 'global' }]) {
    assert.equal((await invoke(args)).degradationReason, 'index-not-ready');
  }
  assert.equal(queries, beforeNoScope, 'no candidate under exact filters means no embedding');
  assert.equal((await search.execute(ctx, { noteId: other.id })).isError, true);
  assert.equal((await invoke({ noteId: note.id })).notes[0].content, note.content);
  assert.equal((await invoke({ noteId: note.id })).notes[0].isTruncated, false);
  assert.equal(queries, beforeNoScope, 'exact reads do not embed');
  const provider = createSelfEvolutionRetrievalProvider({ store });
  const context = { ...ctx, retrievalQuery: 'Current' };
  action = async ({ query }) => { assert.ok(query.length <= 64); assert.ok(query.endsWith('CURRENT_TARGET')); };
  store.setEmbeddingServices({ config: { ...fixtureEmbeddingConfig, maxQueryChars: 64 }, embeddingClient: client });
  const bounded = await invoke({ query: 'old context '.repeat(1000) + 'CURRENT_TARGET' });
  assert.equal(bounded.diagnostics.queryTruncated, true); assert.equal(bounded.diagnostics.queryChars, 64);
  action = null;
  store.setEmbeddingServices({ config: fixtureEmbeddingConfig, embeddingClient: client });
  const beforeFailure = queries;
  action = async () => { throw new Error('synthetic embedding outage'); };
  assert.equal((await search.execute(ctx, { query: 'Current' })).isError, true);
  assert.deepEqual((await provider.provide(context, { config: cfg })).blocks, []);
  assert.equal(queries, beforeFailure + 2, 'one attempt per consumer, no fallback/retry');
  action = null;
  const controller = new AbortController(); controller.abort(); const beforeCancel = queries;
  assert.equal((await search.execute({ ...ctx, signal: controller.signal }, { query: 'Current' })).isError, true);
  assert.equal(queries, beforeCancel);
  const late = new AbortController(); action = async ({ signal }) => { assert.equal(signal, late.signal); late.abort(); };
  assert.equal((await search.execute({ ...ctx, signal: late.signal }, { query: 'Current' })).isError, true);
  action = async () => { store.setEmbeddingServices({ config: { ...fixtureEmbeddingConfig, model: 'new-profile' }, embeddingClient: client }); };
  assert.equal((await invoke({ query: 'Current' })).degradationReason, 'profile-changed');
  action = null;
  store.setEmbeddingServices({ config: { ...fixtureEmbeddingConfig, maxDistance: 0 }, embeddingClient: client });
  const strict = await invoke({ query: 'Current' });
  assert.equal(strict.notes.length, 0); assert.equal(strict.diagnostics.maxDistance, 0);
  assert.equal(strict.diagnostics.thresholdCalibrated, false);
  store.setEmbeddingServices({ config: { ...fixtureEmbeddingConfig, enabled: false }, embeddingClient: client });
  const beforeDisabled = queries;
  assert.equal((await invoke({ query: 'Current' })).notes.length, 0);
  assert.equal((await invoke({})).notes.length, 2, 'ordinary scoped listing remains available');
  assert.equal((await invoke({ noteId: note.id })).notes[0].content, note.content);
  const disabledCfg = { selfEvolution: { enabled: true, retrieval: { enabled: true, embedding: { enabled: false } } } };
  const disabled = await provider.provide(context, { config: disabledCfg });
  assert.equal(disabled.blocks.length, 0); assert.ok(disabled.audit.reason);
  assert.equal(queries, beforeDisabled); assert.equal(documents, 3);
  store.setEmbeddingServices({ config: fixtureEmbeddingConfig, embeddingClient: { ...client, isConfigured: () => false } });
  assert.equal((await invoke({ query: 'Current' })).degradationReason, 'embedding-not-configured');
  assert.equal(queries, beforeDisabled);
});
