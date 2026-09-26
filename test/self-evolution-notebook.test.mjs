import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PluginManager } from '../src/plugins/manager.js';
import { executeTool } from '../src/tools/tools.js';
import {
  NotebookError,
  NotebookStore,
  notebookDatabasePath
} from '../src/plugins/self-evolution/notebook-store.js';
import {
  createSelfEvolutionPlugin,
  selfEvolutionPlugin
} from '../src/plugins/builtin/self-evolution.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-p4-notebook-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

let sequence = 0;
function fixture(options = {}) {
  const dataDir = path.join(root, `case-${++sequence}`);
  const filename = notebookDatabasePath(dataDir);
  const store = new NotebookStore({
    dataDir,
    filename,
    now: (() => {
      let time = 1000;
      return () => ++time;
    })(),
    ...options
  });
  return { dataDir, filename, store };
}

function source(chatKey = 'group:100', overrides = {}) {
  return {
    kind: 'chat',
    accountId: 'bot-1',
    chatKey,
    sessionId: 'session-1',
    runId: 'run-1',
    toolCallId: 'tool-call-1',
    ...overrides
  };
}

function append(store, overrides = {}) {
  return store.append({
    accountId: 'bot-1',
    content: 'A durable note',
    scope: 'global',
    tags: ['stable'],
    source: source(),
    idempotencyKey: `append-${cryptoRandom()}`,
    ...overrides
  });
}

function cryptoRandom() {
  return `${Date.now()}-${Math.random()}`;
}

test('declares exactly four notebook tools with local-write/read effects', () => {
  const tools = [];
  selfEvolutionPlugin.declare({
    addTools(items) {
      tools.push(...(Array.isArray(items) ? items : [items]));
    }
  });
  assert.deepEqual(tools.map((tool) => tool.name), [
    'notebook_append',
    'notebook_search',
    'notebook_update',
    'notebook_archive'
  ]);
  assert.deepEqual(tools.map((tool) => tool.effect), [
    'local-write',
    'read',
    'local-write',
    'local-write'
  ]);
  assert.ok(tools.every((tool) => tool.ownerPluginId === 'self-evolution'));
});

test('disabled plugin creates no database, directory, timers, or registered tools', async () => {
  const dataDir = path.join(root, `disabled-${++sequence}`);
  const filename = notebookDatabasePath(dataDir);
  const plugin = createSelfEvolutionPlugin({ dataDir });
  const manager = new PluginManager({
    configProvider: () => ({ selfEvolution: { enabled: false } })
  });
  manager.register(plugin);
  await manager.startAll();
  assert.equal(manager.runtime.has('self-evolution'), false);
  assert.deepEqual(manager.createRunSnapshot().tools, []);
  assert.equal(manager.observerTimer, null);
  assert.equal(fs.existsSync(filename), false);
  assert.equal(fs.existsSync(path.dirname(filename)), false);
  await manager.stopAll();
});

test('enabled plugin exposes persistent tool callbacks through the P2 manager', async () => {
  const dataDir = path.join(root, `enabled-${++sequence}`);
  const plugin = createSelfEvolutionPlugin({ dataDir });
  const manager = new PluginManager({
    configProvider: () => ({ selfEvolution: { enabled: true } })
  });
  manager.register(plugin);
  await manager.startAll();
  let snapshot = null;
  try {
    snapshot = manager.createRunSnapshot({ selfEvolution: { enabled: true } });
    assert.deepEqual(snapshot.tools.map((tool) => tool.name), [
      'notebook_append',
      'notebook_search',
      'notebook_update',
      'notebook_archive'
    ]);
    const context = {
      chatKey: 'group:100',
      accountId: 'bot-1',
      kind: 'group',
      session: {
        id: 'session-tool',
        leaseId: 'run-tool'
      }
    };
    const appended = await executeTool(
      snapshot.tools,
      context,
      'notebook_append',
      JSON.stringify({ content: 'tool callback note', scope: 'chat', tags: ['tool'] })
    );
    const appendResult = JSON.parse(appended.content);
    assert.equal(appendResult.saved, true);
    const searched = await executeTool(
      snapshot.tools,
      context,
      'notebook_search',
      JSON.stringify({ query: 'callback' })
    );
    const searchResult = JSON.parse(searched.content);
    assert.equal(searchResult.notes.length, 1);
    const updated = await executeTool(
      snapshot.tools,
      context,
      'notebook_update',
      JSON.stringify({
        noteId: appendResult.note.id,
        expectedRevision: appendResult.revision,
        content: 'updated through tool'
      })
    );
    assert.equal(JSON.parse(updated.content).saved, true);
    const archived = await executeTool(
      snapshot.tools,
      context,
      'notebook_archive',
      JSON.stringify({
        noteId: appendResult.note.id,
        expectedRevision: 2
      })
    );
    assert.equal(JSON.parse(archived.content).saved, true);
  } finally {
    manager.releaseRunSnapshot(snapshot);
    await manager.stopAll();
  }
});

test('chat tools reject a missing host account and isolate stored notes by account', async () => {
  const dataDir = path.join(root, `account-${++sequence}`);
  const plugin = createSelfEvolutionPlugin({ dataDir });
  const manager = new PluginManager({
    configProvider: () => ({ selfEvolution: { enabled: true } })
  });
  manager.register(plugin);
  await manager.startAll();
  let snapshot = null;
  try {
    snapshot = manager.createRunSnapshot({ selfEvolution: { enabled: true } });
    const tool = snapshot.tools.find((item) => item.name === 'notebook_append');
    const session = { id: 'session-account', leaseId: 'run-account' };
    const missingAccount = await tool.execute({
      chatKey: 'group:100',
      session,
      toolCallId: 'missing-account'
    }, { content: 'must not save', scope: 'global' });
    assert.equal(missingAccount.isError, true);
    assert.equal(missingAccount.errorCode, 'NOTEBOOK_INVALID_SOURCE');

    const context = {
      chatKey: 'group:100',
      accountId: '3000000001',
      kind: 'group',
      session,
      toolCallId: 'host-account-write'
    };
    const appended = await executeTool(
      snapshot.tools,
      context,
      'notebook_append',
      JSON.stringify({ content: 'account A tool note', scope: 'chat' })
    );
    const appendResult = JSON.parse(appended.content);
    assert.equal(appendResult.saved, true);
    assert.equal(appendResult.note.accountId, '3000000001');
    assert.equal(appendResult.note.source.accountId, '3000000001');

    const store = plugin.getStore();
    const accountA = store.search({
      accountId: '3000000001',
      currentChatKey: 'group:100'
    });
    const accountB = store.search({
      accountId: '3000000002',
      currentChatKey: 'group:100'
    });
    assert.equal(accountA.count, 1);
    assert.deepEqual(accountA.notes.map((note) => note.id), [appendResult.note.id]);
    assert.equal(accountB.count, 0);
  } finally {
    manager.releaseRunSnapshot(snapshot);
    await manager.stopAll();
  }
});

test('append is idempotent and restart preserves note, revision, and audit source', () => {
  const { dataDir, filename, store } = fixture();
  const idempotencyKey = 'host:invocation-one';
  try {
    const first = append(store, { idempotencyKey });
    const replay = append(store, { idempotencyKey });
    assert.equal(replay.note.id, first.note.id);
    assert.equal(replay.operationId, first.operationId);
    assert.equal(store.counts({ accountId: 'bot-1' }).notes, 1);
    store.close();

    const restarted = new NotebookStore({ dataDir, filename, create: false });
    try {
      const note = restarted.get({
        accountId: 'bot-1',
        noteId: first.note.id,
        currentChatKey: 'group:100'
      });
      assert.equal(note.content, 'A durable note');
      assert.equal(note.revision, 1);
      assert.equal(note.source.runId, 'run-1');
      assert.equal(restarted.listOperations({ accountId: 'bot-1' }).length, 1);
    } finally {
      restarted.close();
    }
  } finally {
    store.close();
  }
});

test('same idempotency key cannot silently represent a different write', () => {
  const { store } = fixture();
  try {
    const key = 'host:reused';
    append(store, { idempotencyKey: key });
    assert.throws(
      () => append(store, { idempotencyKey: key, content: 'different content' }),
      (error) => error instanceof NotebookError && error.code === 'NOTEBOOK_IDEMPOTENCY_CONFLICT'
    );
    assert.equal(store.counts({ accountId: 'bot-1' }).notes, 1);
  } finally {
    store.close();
  }
});

test('concurrent revisions use CAS and persist the losing conflict for audit', async () => {
  const { dataDir, filename, store } = fixture();
  const second = new NotebookStore({ dataDir, filename, create: false });
  try {
    const created = append(store);
    const update = (target, content, key) => Promise.resolve().then(() => target.update({
      accountId: 'bot-1',
      noteId: created.note.id,
      expectedRevision: 1,
      content,
      source: source(),
      currentChatKey: 'group:100',
      idempotencyKey: key
    }));
    const results = await Promise.allSettled([
      update(store, 'first edit', 'host:edit-one'),
      update(second, 'second edit', 'host:edit-two')
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.equal(rejected.reason.code, 'NOTEBOOK_CAS_CONFLICT');
    const current = store.get({
      accountId: 'bot-1',
      noteId: created.note.id,
      currentChatKey: 'group:100'
    });
    assert.equal(current.revision, 2);
    assert.ok(['first edit', 'second edit'].includes(current.content));
    const conflictAudit = store.listOperations({ accountId: 'bot-1', action: 'update' })
      .find((item) => item.errorCode === 'NOTEBOOK_CAS_CONFLICT');
    assert.ok(conflictAudit);
    assert.equal(conflictAudit.status, 'rejected');
  } finally {
    second.close();
    store.close();
  }
});

test('chat scope, account namespace, and tags cannot widen search visibility', () => {
  const { store } = fixture();
  try {
    const global = append(store, { idempotencyKey: 'host:global' });
    const privateNote = append(store, {
      idempotencyKey: 'host:chat-1',
      scope: 'chat',
      chatKey: 'group:100',
      content: 'Only group one can see this',
      tags: ['shared-tag']
    });
    const chatOne = store.search({
      accountId: 'bot-1',
      currentChatKey: 'group:100',
      query: '',
      tags: ['shared-tag']
    });
    assert.deepEqual(chatOne.notes.map((note) => note.id), [privateNote.note.id]);

    const chatTwo = store.search({
      accountId: 'bot-1',
      currentChatKey: 'group:200',
      query: '',
      tags: ['shared-tag']
    });
    assert.deepEqual(chatTwo.notes, []);
    const globalOnly = store.search({
      accountId: 'bot-1',
      currentChatKey: 'group:200',
      scope: 'global',
      query: ''
    });
    assert.deepEqual(globalOnly.notes.map((note) => note.id), [global.note.id]);
    assert.deepEqual(store.search({
      accountId: 'other-bot',
      currentChatKey: 'group:100',
      query: ''
    }).notes, []);
    assert.throws(
      () => store.append({
        accountId: 'bot-1',
        scope: 'chat',
        chatKey: 'group:200',
        content: 'forged',
        source: source('group:100'),
        idempotencyKey: 'host:scope-forgery',
        currentChatKey: 'group:100'
      }),
      (error) => error.code === 'NOTEBOOK_SCOPE_DENIED'
    );
  } finally {
    store.close();
  }
});

test('archive advances revision, remains in history, and is excluded from recall', () => {
  const { store } = fixture();
  try {
    const created = append(store);
    const archived = store.archive({
      accountId: 'bot-1',
      noteId: created.note.id,
      expectedRevision: 1,
      source: source(),
      currentChatKey: 'group:100',
      idempotencyKey: 'host:archive-one'
    });
    assert.equal(archived.saved, true);
    assert.equal(archived.revision, 2);
    assert.equal(archived.note.status, 'archived');
    assert.deepEqual(store.search({
      accountId: 'bot-1',
      currentChatKey: 'group:100',
      query: ''
    }).notes, []);
    const history = store.history({
      accountId: 'bot-1',
      noteId: created.note.id,
      currentChatKey: 'group:100'
    });
    assert.deepEqual(history.versions.map((item) => [item.revision, item.status]), [
      [2, 'archived'],
      [1, 'active']
    ]);
    assert.equal(store.get({
      accountId: 'bot-1',
      noteId: created.note.id,
      currentChatKey: 'group:100'
    }), null);
  } finally {
    store.close();
  }
});

test('body, capacity, and per-run limits reject explicitly without claiming saved', () => {
  const { store } = fixture({
    limits: { maxBodyChars: 5, maxNotes: 1, maxWritesPerRun: 1 }
  });
  try {
    assert.throws(
      () => append(store, { content: 'too long' }),
      (error) => error.code === 'NOTEBOOK_LIMIT_EXCEEDED'
    );
    const first = append(store, {
      content: 'first',
      idempotencyKey: 'host:first',
      source: source('group:100')
    });
    assert.equal(first.saved, true);
    assert.throws(
      () => append(store, {
        content: 'other',
        idempotencyKey: 'host:quota',
        source: source('group:100')
      }),
      (error) => error.code === 'NOTEBOOK_WRITE_QUOTA_EXCEEDED'
    );
    assert.equal(store.counts({ accountId: 'bot-1' }).notes, 1);
    assert.equal(
      store.listOperations({ accountId: 'bot-1' }).some((item) =>
        item.errorCode === 'NOTEBOOK_WRITE_QUOTA_EXCEEDED' && item.result.saved === false),
      true
    );
  } finally {
    store.close();
  }
});

test('invalid chat source is rejected and chat writes require host run identity', () => {
  const { store } = fixture();
  try {
    assert.throws(
      () => store.append({
        accountId: 'bot-1',
        content: 'invalid',
        source: source('group:100', { chatKey: 'group:200' }),
        currentChatKey: 'group:100',
        idempotencyKey: 'host:bad-source'
      }),
      (error) => error.code === 'NOTEBOOK_SCOPE_DENIED'
    );
    assert.throws(
      () => store.append({
        accountId: 'bot-1',
        content: 'missing host run',
        source: source('group:100', { runId: '', sessionId: '' }),
        currentChatKey: 'group:100',
        idempotencyKey: 'host:no-run'
      }),
      (error) => error.code === 'NOTEBOOK_INVALID_SOURCE'
    );
    assert.equal(store.counts({ accountId: 'bot-1' }).notes, 0);
  } finally {
    store.close();
  }
});

test('existing Notebook can be read in stopped read-only mode without enabling writes', () => {
  const { dataDir, filename, store } = fixture();
  try {
    const created = append(store);
    store.close();
    const existing = NotebookStore.openExisting({ dataDir });
    assert.ok(existing);
    assert.equal(existing.readOnly, true);
    assert.equal(existing.get({
      accountId: 'bot-1',
      noteId: created.note.id,
      currentChatKey: 'group:100'
    }).content, 'A durable note');
    assert.throws(
      () => existing.append({
        accountId: 'bot-1',
        content: 'not allowed',
        source: source(),
        idempotencyKey: 'host:readonly'
      }),
      (error) => error.code === 'NOTEBOOK_READ_ONLY'
    );
    existing.close();
    assert.equal(fs.existsSync(filename), true);
  } finally {
    store.close();
  }
});
