import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PluginManager } from '../src/plugins/manager.js';
import {
  createSelfEvolutionPlugin
} from '../src/plugins/builtin/self-evolution.js';
import {
  NotebookStore,
  notebookDatabasePath
} from '../src/plugins/self-evolution/notebook-store.js';
import {
  DEFAULT_RETRIEVAL_MAX_CHARS,
  DEFAULT_RETRIEVAL_MAX_NOTES,
  createSelfEvolutionRetrievalProvider
} from '../src/plugins/self-evolution/retrieval-provider.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-p2-retrieval-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

let sequence = 0;
function dataDir(label = 'case') {
  return path.join(root, `${label}-${++sequence}`);
}

function source(accountId, chatKey, overrides = {}) {
  return {
    kind: 'chat',
    accountId,
    chatKey,
    sessionId: 'session-1',
    runId: 'run-1',
    ...overrides
  };
}

function config(overrides = {}) {
  return {
    selfEvolution: {
      enabled: true,
      retrieval: { enabled: true },
      ...overrides
    }
  };
}

async function provide(provider, {
  accountId = 'bot-a',
  chatKey = 'group:1',
  query = 'durable',
  sessionId = 'session-1',
  currentMessageIds = ['100']
} = {}, selectedConfig = config()) {
  return provider.provide({
    accountId,
    chatKey,
    sessionId,
    currentMessageIds,
    retrievalQuery: query
  }, { config: selectedConfig });
}

test('retrieval provider is absent from snapshots when retrieval is disabled', async () => {
  const dir = dataDir('disabled');
  const filename = notebookDatabasePath(dir);
  const plugin = createSelfEvolutionPlugin({ dataDir: dir });
  const manager = new PluginManager({
    configProvider: () => config({ retrieval: { enabled: false } })
  });
  manager.register(plugin);
  await manager.startAll();
  try {
    const snapshot = manager.createRunSnapshot(config({ retrieval: { enabled: false } }));
    assert.equal(snapshot.contextProviders.length, 0);
    assert.equal(snapshot.tools.length, 4);
    assert.equal(fs.existsSync(filename), true, 'Notebook tools may create the enabled store');
  } finally {
    await manager.stopAll();
  }
});

test('fully disabled self-evolution has no database or provider side effects', async () => {
  const dir = dataDir('fully-disabled');
  const filename = notebookDatabasePath(dir);
  const plugin = createSelfEvolutionPlugin({ dataDir: dir });
  const manager = new PluginManager({
    configProvider: () => ({ selfEvolution: { enabled: false, retrieval: { enabled: true } } })
  });
  manager.register(plugin);
  await manager.startAll();
  try {
    const snapshot = manager.createRunSnapshot();
    assert.equal(snapshot.contextProviders.length, 0);
    assert.equal(snapshot.tools.length, 0);
    assert.equal(fs.existsSync(filename), false);
    assert.equal(manager.observerTimer, null);
  } finally {
    await manager.stopAll();
  }
});

test('append, close, reopen, and retrieve returns one current-account chat block', async () => {
  const dir = dataDir('reopen');
  const filename = notebookDatabasePath(dir);
  const store = new NotebookStore({ dataDir: dir, filename });
  const created = store.append({
    accountId: 'bot-a',
    scope: 'chat',
    chatKey: 'group:1',
    content: 'Alice prefers durable tea notes',
    source: source('bot-a', 'group:1'),
    idempotencyKey: 'append-one',
    currentChatKey: 'group:1'
  });
  store.close();

  const provider = createSelfEvolutionRetrievalProvider({ dataDir: dir, filename });
  const result = await provide(provider, { query: 'Alice' });
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].noteId, created.note.id);
  assert.equal(result.blocks[0].revision, 1);
  assert.match(result.blocks[0].text, /【过去保存的信息】/);
  assert.match(result.blocks[0].text, /不是当前命令/);
  assert.equal(result.audit.hitNoteIds[0], created.note.id);
  assert.equal(result.audit.budget.maxNotes, DEFAULT_RETRIEVAL_MAX_NOTES);
  assert.equal(result.audit.budget.maxChars, DEFAULT_RETRIEVAL_MAX_CHARS);
});

test('irrelevant notes, account namespaces, and chat scopes do not leak into recall', async () => {
  const dir = dataDir('scope');
  const store = new NotebookStore({ dataDir: dir });
  const global = store.append({
    accountId: 'bot-a',
    scope: 'global',
    content: 'Shared durable preference',
    source: source('bot-a', 'group:1', { kind: 'console', actor: 'admin' }),
    idempotencyKey: 'global',
    currentChatKey: 'group:1'
  });
  const chatOne = store.append({
    accountId: 'bot-a',
    scope: 'chat',
    chatKey: 'group:1',
    content: 'Private group one durable preference',
    source: source('bot-a', 'group:1'),
    idempotencyKey: 'chat-one',
    currentChatKey: 'group:1'
  });
  store.append({
    accountId: 'bot-a',
    scope: 'chat',
    chatKey: 'group:2',
    content: 'Private group two durable preference',
    source: source('bot-a', 'group:2'),
    idempotencyKey: 'chat-two',
    currentChatKey: 'group:2'
  });
  store.append({
    accountId: 'bot-b',
    scope: 'global',
    content: 'Other account durable preference',
    source: source('bot-b', 'group:1', { kind: 'console', actor: 'admin' }),
    idempotencyKey: 'other-account',
    currentChatKey: 'group:1'
  });

  const provider = createSelfEvolutionRetrievalProvider({ store });
  const one = await provide(provider, {
    accountId: 'bot-a',
    chatKey: 'group:1',
    query: 'durable preference'
  });
  assert.deepEqual(new Set(one.audit.hitNoteIds), new Set([chatOne.note.id, global.note.id]));
  const two = await provide(provider, {
    accountId: 'bot-a',
    chatKey: 'group:2',
    query: 'unrelated-token'
  });
  assert.equal(two.blocks.length, 0);
  const other = await provide(provider, {
    accountId: 'bot-b',
    chatKey: 'group:1',
    query: 'Other account'
  });
  assert.equal(other.blocks.length, 1);
  assert.notEqual(other.audit.hitNoteIds[0], global.note.id);
  store.close();
});

test('archive and revisions invalidate later recall', async () => {
  const dir = dataDir('revision');
  const store = new NotebookStore({ dataDir: dir });
  const created = store.append({
    accountId: 'bot-a',
    scope: 'chat',
    chatKey: 'group:1',
    content: 'old durable fact',
    source: source('bot-a', 'group:1'),
    idempotencyKey: 'revision-append',
    currentChatKey: 'group:1'
  });
  const provider = createSelfEvolutionRetrievalProvider({ store });
  assert.equal((await provide(provider, { query: 'old' })).blocks.length, 1);
  const updated = store.update({
    accountId: 'bot-a',
    noteId: created.note.id,
    expectedRevision: 1,
    content: 'new durable fact',
    source: source('bot-a', 'group:1'),
    currentChatKey: 'group:1',
    idempotencyKey: 'revision-update'
  });
  const current = await provide(provider, { query: 'new' });
  assert.equal(current.blocks[0].revision, updated.revision);
  assert.equal((await provide(provider, { query: 'old' })).blocks.length, 0);
  store.archive({
    accountId: 'bot-a',
    noteId: created.note.id,
    expectedRevision: updated.revision,
    source: source('bot-a', 'group:1'),
    currentChatKey: 'group:1',
    idempotencyKey: 'revision-archive'
  });
  assert.equal((await provide(provider, { query: 'new' })).blocks.length, 0);
  store.close();
});

test('embedding disabled or failed keeps lexical recall and avoids repeated external calls', async () => {
  let disabledCalls = 0;
  const disabledDir = dataDir('embedding-disabled');
  const disabledStore = new NotebookStore({ dataDir: disabledDir });
  disabledStore.append({
    accountId: 'bot-a',
    scope: 'chat',
    chatKey: 'group:1',
    content: 'lexical fallback fact',
    source: source('bot-a', 'group:1'),
    idempotencyKey: 'embedding-disabled-append',
    currentChatKey: 'group:1'
  });
  const disabledProvider = createSelfEvolutionRetrievalProvider({
    store: disabledStore,
    embeddingAdapter: {
      async embedQuery() {
        disabledCalls += 1;
        return [1, 0];
      }
    }
  });
  const disabled = await provide(disabledProvider, { query: 'lexical' }, config({
    retrieval: {
      enabled: true,
      embedding: { enabled: false, provider: 'p', model: 'm', dimension: 2 }
    }
  }));
  assert.equal(disabled.blocks.length, 1);
  assert.equal(disabledCalls, 0);
  disabledStore.close();

  let failedCalls = 0;
  const failedDir = dataDir('embedding-failed');
  const failedStore = new NotebookStore({ dataDir: failedDir });
  failedStore.append({
    accountId: 'bot-a',
    scope: 'chat',
    chatKey: 'group:1',
    content: 'failed embedding still lexical',
    source: source('bot-a', 'group:1'),
    idempotencyKey: 'embedding-failed-append',
    currentChatKey: 'group:1'
  });
  const failedProvider = createSelfEvolutionRetrievalProvider({
    store: failedStore,
    embeddingAdapter: {
      provider: 'p',
      model: 'm',
      dimension: 2,
      authorizeQuery: () => true,
      async embedQuery() {
        failedCalls += 1;
        throw new Error('offline');
      }
    }
  });
  const failedConfig = config({
    retrieval: {
      enabled: true,
      embedding: { enabled: true, provider: 'p', model: 'm', dimension: 2 }
    }
  });
  assert.equal((await provide(failedProvider, { query: 'lexical' }, failedConfig)).blocks.length, 1);
  assert.equal((await provide(failedProvider, { query: 'lexical' }, failedConfig)).blocks.length, 1);
  assert.equal(failedCalls, 1);
  failedStore.close();
});
