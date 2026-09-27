import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-learned-self-e2e-'));
process.env.QQ_AGENT_DATA_DIR = root;

const { Orchestrator } = await import('../src/core/orchestrator.js');
const { ChatStore } = await import('../src/core/store.js');
const { SessionRegistry } = await import('../src/core/sessions.js');
const { DEFAULT_CONFIG, setRuntimeConfig } = await import('../src/core/config.js');
const { createReflectionPlugin } = await import('../src/plugins/self-evolution/reflection-plugin.js');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const ACCOUNT_ID = 'learned-account';
const CHAT_KEY = 'group:100';
const BASE_PERSONA = {
  roleText: 'fixed base persona',
  behaviorProfile: 'legacy',
  botName: 'closure-bot',
  selfNickname: 'closure-bot',
  customRules: 'stay grounded',
  tools: [
    { name: 'notebook_search', effect: 'read', terminal: false },
    { name: 'notebook_append', effect: 'local-write', terminal: false }
  ]
};

function completionEvent(sessionId) {
  return {
    eventId: `${sessionId}:self-evolution.reflection`,
    observerId: 'self-evolution.reflection',
    observerPluginId: 'self-evolution-reflection',
    accountId: ACCOUNT_ID,
    sessionId,
    runId: `run-${sessionId}`,
    chatKey: CHAT_KEY,
    pluginGeneration: 1,
    resultClass: 'done',
    actionSummary: {
      sentCount: 1,
      finishReason: 'finish',
      outboundAttempted: true,
      participation: { mode: 'auto', decision: 'reply', reasonCode: 'normal' },
      termination: { kind: 'finish', threadDisposition: 'active' },
      outbound: { attempted: 1, succeeded: 1, failed: 0, unknown: 0, held: 0 }
    },
    sourceMessageIds: [`message-${sessionId}`],
    completedAt: Date.now()
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
      chatKey: '',
      confidence: 0.95,
      evidenceRefs: [`session:${job.sessionId}`]
    }],
    capabilityGapProposals: [],
    summary: `reflection for ${job.sessionId}`
  };
}

test('learned self is injected into the next user prompt and rollback removes the trait', async (t) => {
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
    reflection: {
      enabled: true,
      mode: 'bounded_auto',
      pollIntervalMs: 100000
    }
  };
  setRuntimeConfig(cfg);

  const dataDir = fs.mkdtempSync(path.join(root, 'case-'));
  const chatStore = new ChatStore(0, { dataDir: path.join(dataDir, 'chat') });
  const sessions = new SessionRegistry(0);
  const runner = new Orchestrator({
    store: chatStore,
    sessions,
    memory: {
      formatForPrompt: () => '',
      formatHandoffForPrompt: () => '',
      getHandoff: () => null,
      setHandoff: () => null,
      clearHandoff: () => {}
    },
    stickers: {},
    sender: {
      sendTextBatch: async (_chatKey, messages) => ({
        sent: messages.map((text, index) => ({ text, at: Date.now(), messageId: index + 1 })),
        failed: []
      })
    },
    onebot: {
      selfId: ACCOUNT_ID,
      selfNickname: 'closure-bot',
      connected: false,
      getGroupInfo: async () => ({ group_name: 'closure-group' })
    }
  });
  const plugin = createReflectionPlugin({
    dataDir,
    getBasePersona: () => BASE_PERSONA,
    getAccountId: () => ACCOUNT_ID,
    now: () => Date.now(),
    limits: {
      leaseMs: 30000,
      workerLeaseMs: 30000,
      maxCallsPerDay: 20,
      backoffMs: 0
    },
    reflector: async ({ job }) => job.sessionId === 'job-1'
      ? reflectionOutput(job, 'communication_style', 'concise')
      : reflectionOutput(job, 'language_preference', 'English')
  });
  runner.pluginManager.register(plugin);
  runner.pluginManager.setEnabled(plugin.id, true);

  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return Response.json({
      choices: [{ message: { content: 'done' } }],
      usage: { prompt_tokens: 10, total_tokens: 10 }
    });
  };

  let messageId = 0;
  const append = (text) => chatStore.appendIncoming(CHAT_KEY, {
    mid: ++messageId,
    text,
    senderId: 'member-1',
    senderName: 'member'
  });

  t.after(async () => {
    globalThis.fetch = originalFetch;
    await runner.abortAll();
    await runner.stopPlugins();
    chatStore.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await runner.startPlugins();
  const store = plugin.getStore();
  const worker = plugin.getWorker();
  store.enqueueObservation(completionEvent('job-1'));
  assert.equal((await worker.runOnce()).status, 'completed');
  store.enqueueObservation(completionEvent('job-2'));
  assert.equal((await worker.runOnce()).status, 'completed');
  assert.equal(store.getLearnedSelfRevision({ accountId: ACCOUNT_ID }), 2);

  append('first prompt');
  await runner.wake(CHAT_KEY, { manual: true });
  const firstPrompt = String(requests.at(-1).messages.at(-1).content);
  assert.match(firstPrompt, /习得自我参考/);
  assert.match(firstPrompt, /communication_style/);
  assert.match(firstPrompt, /language_preference/);
  assert.match(firstPrompt, /不改变身份、权限、安全规则/);

  store.rollbackProfile({
    accountId: ACCOUNT_ID,
    targetRevision: 1,
    expectedCurrentRevision: 2,
    basePersona: BASE_PERSONA,
    actor: 'closure-test',
    reason: 'remove second trait'
  });
  append('prompt after rollback');
  await runner.wake(CHAT_KEY, { manual: true });
  const rolledBackPrompt = String(requests.at(-1).messages.at(-1).content);
  assert.match(rolledBackPrompt, /communication_style/);
  assert.doesNotMatch(rolledBackPrompt, /language_preference/);
});
