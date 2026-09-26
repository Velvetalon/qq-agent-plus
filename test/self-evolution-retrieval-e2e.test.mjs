import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-p6-retrieval-e2e-'));
process.env.QQ_AGENT_DATA_DIR = root;

const { Orchestrator } = await import('../src/core/orchestrator.js');
const { ChatStore } = await import('../src/core/store.js');
const { SessionRegistry } = await import('../src/core/sessions.js');
const { DEFAULT_CONFIG, setRuntimeConfig } = await import('../src/core/config.js');
const { createSelfEvolutionPlugin } = await import('../src/plugins/builtin/self-evolution.js');
const {
  createSelfEvolutionRetrievalProvider
} = await import('../src/plugins/self-evolution/retrieval-provider.js');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function fixture(t) {
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.runtime.mode = 'active';
  cfg.allow.groups = ['100'];
  cfg.api.model = 'closure-test-model';
  cfg.api.baseUrl = 'https://closure-test.invalid';
  cfg.sticker.enabled = false;
  cfg.memory.consolidateEnabled = false;
  cfg.store.contextTier = 1;
  cfg.store.randomPercent = 0;
  cfg.wakeDelayMs = 1;
  cfg.wakeDelayMinMs = 1;
  cfg.wakeDelayMaxMs = 1;
  cfg.selfEvolution = {
    enabled: true,
    retrieval: {
      enabled: true,
      maxNotes: 5,
      maxChars: 2400,
      maxSnippetChars: 600
    }
  };
  setRuntimeConfig(cfg);

  const dataDir = fs.mkdtempSync(path.join(root, 'case-'));
  const store = new ChatStore(0, { dataDir: path.join(dataDir, 'chat') });
  const sessions = new SessionRegistry(0);
  const memory = {
    formatForPrompt: () => '',
    formatHandoffForPrompt: () => '',
    getHandoff: () => null,
    setHandoff: () => null,
    clearHandoff: () => {}
  };
  const sender = {
    sendTextBatch: async (_chatKey, messages) => ({
      sent: messages.map((text, index) => ({
        text,
        at: Date.now(),
        messageId: index + 1
      })),
      failed: []
    })
  };
  const runner = new Orchestrator({
    store,
    sessions,
    memory,
    stickers: {},
    sender,
    onebot: {
      selfId: 'account-a',
      selfNickname: 'closure-bot',
      connected: false,
      getGroupInfo: async () => ({ group_name: 'closure-group' })
    }
  });
  const plugin = createSelfEvolutionPlugin({ dataDir });
  runner.pluginManager.register(plugin);

  t.after(async () => {
    await runner.abortAll();
    await runner.stopPlugins();
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  let mid = 0;
  const appendMessage = (text) => store.appendIncoming('group:100', {
    mid: ++mid,
    text,
    senderId: 'member-1',
    senderName: 'member'
  });
  const noteSource = (sessionId, runId) => ({
    kind: 'chat',
    accountId: 'account-a',
    chatKey: 'group:100',
    sessionId,
    runId
  });
  return { cfg, dataDir, runner, store, sessions, plugin, appendMessage, noteSource };
}

function completedModelResponse() {
  return Response.json({
    choices: [{ message: { content: 'done' } }],
    usage: { prompt_tokens: 10, total_tokens: 10 }
  });
}

test('Notebook survives close/reopen and reaches a real Orchestrator model request', async (t) => {
  const {
    cfg,
    dataDir,
    runner,
    plugin,
    sessions,
    appendMessage,
    noteSource
  } = fixture(t);
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return completedModelResponse();
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  try {
    await runner.startPlugins();
    appendMessage('baseline');
    await runner.wake('group:100', { manual: true });
    const baseline = requests[0];
    assert.ok(baseline);
    assert.match(String(baseline.messages[0].content), /安全规则/);
    assert.match(String(baseline.messages[0].content), /工具不存在就是不存在/);

    const notebook = plugin.getStore();
    const relevant = notebook.append({
      accountId: 'account-a',
      scope: 'chat',
      chatKey: 'group:100',
      content: 'Alice prefers durable tea notes',
      tags: ['relevant'],
      source: noteSource('note-session', 'note-run'),
      currentChatKey: 'group:100',
      idempotencyKey: 'closure-relevant'
    });
    const irrelevant = notebook.append({
      accountId: 'account-a',
      scope: 'chat',
      chatKey: 'group:100',
      content: 'unrelated coral inventory token',
      tags: ['irrelevant'],
      source: noteSource('other-session', 'other-run'),
      currentChatKey: 'group:100',
      idempotencyKey: 'closure-irrelevant'
    });
    await runner.stopPlugins();
    await runner.startPlugins();
    assert.notEqual(plugin.getStore(), notebook);
    assert.equal(
      plugin.getStore().get({
        accountId: 'account-a',
        noteId: relevant.note.id,
        currentChatKey: 'group:100'
      }).content,
      'Alice prefers durable tea notes'
    );

    appendMessage('Alice');
    await runner.wake('group:100', { manual: true });
    const retrievalRequest = requests[1];
    const dynamicUserPrompt = String(retrievalRequest.messages.at(-1)?.content || '');
    assert.match(dynamicUserPrompt, /Alice prefers durable tea notes/);
    assert.doesNotMatch(dynamicUserPrompt, /unrelated coral inventory token/);
    assert.doesNotMatch(String(retrievalRequest.messages[0]?.content || ''), /Alice prefers durable tea notes/);
    assert.deepEqual(retrievalRequest.tools, baseline.tools);
    assert.equal(retrievalRequest.messages[0].content, baseline.messages[0].content);

    const retrievalSession = sessions.get(sessions.listSummaries(1)[0].id);
    assert.equal(retrievalSession.retrieval.zeroHit, false);
    assert.deepEqual(retrievalSession.retrieval.hitNoteIds, [relevant.note.id]);
    assert.equal(retrievalSession.retrieval.hits[0].revision, 1);
    assert.equal(retrievalSession.retrieval.budget.usedNotes, 1);
    assert.ok(
      retrievalSession.retrieval.injectedChars <= retrievalSession.retrieval.budget.maxChars
    );
    assert.equal(retrievalSession.retrieval.hits.some((hit) => hit.noteId === irrelevant.note.id), false);

    const reopened = plugin.getStore();
    const provider = createSelfEvolutionRetrievalProvider({ store: reopened });
    const context = {
      accountId: 'account-a',
      chatKey: 'group:100',
      sessionId: 'direct-retrieval',
      currentMessageIds: ['closure-1'],
      retrievalQuery: 'Alice'
    };
    assert.equal(
      (await provider.provide(context, { config: cfg })).blocks.length,
      1
    );
    const updated = reopened.update({
      accountId: 'account-a',
      noteId: relevant.note.id,
      expectedRevision: 1,
      content: 'Bob prefers coffee notes',
      source: noteSource('revision-session', 'revision-run'),
      currentChatKey: 'group:100',
      idempotencyKey: 'closure-revision'
    });
    const oldQuery = await provider.provide({
      ...context,
      sessionId: 'old-query',
      retrievalQuery: 'Alice'
    }, { config: cfg });
    assert.deepEqual(oldQuery.blocks, []);
    const newQuery = await provider.provide({
      ...context,
      sessionId: 'new-query',
      retrievalQuery: 'Bob'
    }, { config: cfg });
    assert.equal(newQuery.blocks.length, 1);
    assert.equal(newQuery.blocks[0].revision, updated.revision);

    reopened.archive({
      accountId: 'account-a',
      noteId: relevant.note.id,
      expectedRevision: updated.revision,
      source: noteSource('archive-session', 'archive-run'),
      currentChatKey: 'group:100',
      idempotencyKey: 'closure-archive'
    });
    const archivedQuery = await provider.provide({
      ...context,
      sessionId: 'archived-query',
      retrievalQuery: 'Bob'
    }, { config: cfg });
    assert.deepEqual(archivedQuery.blocks, []);
    assert.equal(
      reopened.history({
        accountId: 'account-a',
        noteId: relevant.note.id,
        currentChatKey: 'group:100'
      }).versions.length,
      3
    );
  } finally {
    await runner.stopPlugins();
  }
});
