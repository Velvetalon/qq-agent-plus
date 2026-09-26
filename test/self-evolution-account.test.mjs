import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-p6-account-'));
process.env.QQ_AGENT_DATA_DIR = root;

const {
  Orchestrator
} = await import('../src/core/orchestrator.js');
const { ChatStore } = await import('../src/core/store.js');
const { SessionRegistry } = await import('../src/core/sessions.js');
const { DEFAULT_CONFIG, setRuntimeConfig } = await import('../src/core/config.js');
const { createSelfEvolutionPlugin } = await import('../src/plugins/builtin/self-evolution.js');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function fixture(t, selfId = 'account-a') {
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
    retrieval: { enabled: false }
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
      selfId,
      selfNickname: 'closure-bot',
      connected: false,
      getGroupInfo: async () => ({ group_name: 'closure-group' })
    }
  });
  const dataPluginDir = path.join(dataDir, 'self-evolution');
  const plugin = createSelfEvolutionPlugin({ dataDir: dataPluginDir });
  runner.pluginManager.register(plugin);

  t.after(async () => {
    await runner.abortAll();
    await runner.stopPlugins();
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  let mid = 0;
  const append = (text) => store.appendIncoming('group:100', {
    mid: ++mid,
    text,
    senderId: 'member-1',
    senderName: 'member'
  });
  return { cfg, dataDir: dataPluginDir, runner, store, sessions, plugin, append };
}

function modelResponse(message, totalTokens = 10) {
  return Response.json({
    choices: [{ message }],
    usage: { prompt_tokens: totalTokens, total_tokens: totalTokens }
  });
}

test('real orchestrator tool calls stay in the host account and cannot widen scope', async (t) => {
  const { runner, plugin, sessions, append } = fixture(t, 'account-a');
  const originalFetch = globalThis.fetch;
  const requests = [];
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    calls += 1;
    if (calls === 1) {
      return modelResponse({
        tool_calls: [{
          id: 'forged-scope',
          type: 'function',
          function: {
            name: 'notebook_append',
            arguments: JSON.stringify({
              accountId: 'account-b',
              chatKey: 'group:999',
              scope: 'global',
              tags: ['account-b', 'global'],
              content: 'must be rejected'
            })
          }
        }]
      });
    }
    if (calls === 2) {
      return modelResponse({
        tool_calls: [{
          id: 'host-bound',
          type: 'function',
          function: {
            name: 'notebook_append',
            arguments: JSON.stringify({
              accountId: 'account-b',
              tags: ['model-selected-tag'],
              content: 'host account note'
            })
          }
        }]
      });
    }
    return modelResponse({ content: 'done' });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  try {
    await runner.startPlugins();
    append('remember this');
    await runner.wake('group:100', { manual: true });

    assert.equal(calls, 3);
    const notebook = plugin.getStore();
    assert.ok(notebook);
    const accountA = notebook.search({
      accountId: 'account-a',
      currentChatKey: 'group:100'
    });
    const accountB = notebook.search({
      accountId: 'account-b',
      currentChatKey: 'group:100'
    });
    assert.equal(accountA.count, 1);
    assert.equal(accountA.notes[0].accountId, 'account-a');
    assert.equal(accountA.notes[0].scope, 'chat');
    assert.equal(accountA.notes[0].chatKey, 'group:100');
    assert.deepEqual(accountA.notes[0].tags, ['model-selected-tag']);
    assert.equal(accountB.count, 0);

    const session = sessions.get(sessions.listSummaries(1)[0].id);
    const forgedCall = session.messages.find((item) =>
      item?.toolCall?.id === 'forged-scope')?.toolCall;
    assert.equal(forgedCall?.isError, true);
    assert.equal(forgedCall?.errorCode, 'NOTEBOOK_SCOPE_DENIED');

    const global = notebook.append({
      accountId: 'account-a',
      scope: 'global',
      content: 'account-wide preference',
      source: {
        kind: 'console',
        accountId: 'account-a',
        chatKey: 'group:100',
        actor: 'admin'
      },
      currentChatKey: 'group:100',
      idempotencyKey: 'closure-global'
    });
    const privateNote = notebook.append({
      accountId: 'account-a',
      scope: 'chat',
      chatKey: 'private:111',
      content: 'private account-a fact',
      source: {
        kind: 'chat',
        accountId: 'account-a',
        chatKey: 'private:111',
        sessionId: 'private-session',
        runId: 'private-run'
      },
      currentChatKey: 'private:111',
      idempotencyKey: 'closure-private'
    });

    const otherGroup = notebook.search({
      accountId: 'account-a',
      currentChatKey: 'group:200',
      query: 'fact'
    });
    assert.deepEqual(otherGroup.notes, []);
    const sameAccountOtherChat = notebook.search({
      accountId: 'account-a',
      currentChatKey: 'group:200',
      query: ''
    });
    assert.deepEqual(
      sameAccountOtherChat.notes.map((note) => note.id),
      [global.note.id]
    );
    const privateChat = notebook.search({
      accountId: 'account-a',
      currentChatKey: 'private:111',
      query: ''
    });
    assert.deepEqual(
      new Set(privateChat.notes.map((note) => note.id)),
      new Set([global.note.id, privateNote.note.id])
    );
    const otherAccount = notebook.search({
      accountId: 'account-b',
      currentChatKey: 'private:111',
      query: ''
    });
    assert.deepEqual(otherAccount.notes, []);
    const forgedTags = notebook.search({
      accountId: 'account-a',
      currentChatKey: 'group:200',
      tags: ['model-selected-tag']
    });
    assert.deepEqual(
      forgedTags.notes.map((note) => note.id),
      []
    );
  } finally {
    await runner.stopPlugins();
  }
});
