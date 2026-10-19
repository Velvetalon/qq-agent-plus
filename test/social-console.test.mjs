import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-social-console-'));
process.env.QQ_AGENT_DATA_DIR = dataDir;
const { DEFAULT_CONFIG, conversationConfigForChat, updateConfig } = await import('../src/core/config.js');
const { createApp } = await import('../src/console/app.js');
const { sessionSocialAuditView } = await import('../src/core/sessions.js');

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('social mode config and console state routes are scoped, bounded, and non-creating when disabled', async (t) => {
  assert.equal(DEFAULT_CONFIG.conversation.mode, 'legacy');
  assert.deepEqual(DEFAULT_CONFIG.conversation.social, {
    contextLimit: 60,
    maxPlannerRounds: 3,
    maxReplyRounds: 6,
    maxTopics: 8,
    topicIdleMs: 1800000,
    intentTtlMs: 21600000,
    minInitiativeGapMs: 1800000,
    maxUnansweredInitiatives: 1,
    replyTargetTtlMs: 180000,
    maxMessagesPerTurn: 3,
    reviewMaxOutputTokens: 768,
    reviewTimeoutMs: 15000
  });
  const clamped = updateConfig({ conversation: { social: {
    contextLimit: -1, maxPlannerRounds: 99, maxReplyRounds: 0, maxTopics: 999,
    topicIdleMs: 0, intentTtlMs: 999999999, minInitiativeGapMs: -10,
    maxUnansweredInitiatives: 9, replyTargetTtlMs: 0, maxMessagesPerTurn: 99
  } } });
  assert.deepEqual(clamped.conversation.social, {
    contextLimit: 10, maxPlannerRounds: 5, maxReplyRounds: 1, maxTopics: 20,
    topicIdleMs: 60000, intentTtlMs: 604800000, minInitiativeGapMs: 60000,
    maxUnansweredInitiatives: 3, replyTargetTtlMs: 10000, maxMessagesPerTurn: 6,
    reviewMaxOutputTokens: 768, reviewTimeoutMs: 15000
  });
  for (const invalid of [NaN, Infinity, -Infinity, 'not-a-number', null, {}, []]) {
    const invalidPatch = Object.fromEntries(Object.keys(DEFAULT_CONFIG.conversation.social).map((key) => [key, invalid]));
    const normalized = updateConfig({ conversation: { social: invalidPatch } }).conversation.social;
    for (const value of Object.values(normalized)) assert.ok(Number.isSafeInteger(value) && value >= 0, JSON.stringify(normalized));
    assert.ok(normalized.maxPlannerRounds <= 5 && normalized.maxReplyRounds <= 8);
    assert.ok(normalized.intentTtlMs <= 604800000);
  }
  const scoped = updateConfig({ conversation: {
    mode: 'lifecycle', unifiedMode: false, groupModes: { __replace__: { '10001': 'social' } }
  } });
  assert.equal(conversationConfigForChat('group:10001').mode, 'social');
  assert.equal(conversationConfigForChat('group:10002').mode, 'lifecycle');
  assert.equal(conversationConfigForChat('private:20002').mode, 'lifecycle');
  assert.equal(scoped.conversation.mode, 'lifecycle', 'social remains a selectable override, not a default');
  const auditView = sessionSocialAuditView({
    version: 1, decision: 'reply', goal: 'answer the question', novelty: 'new detail',
    sourceMessageIds: Array.from({ length: 20 }, (_, index) => String(index)),
    targetMessageIds: ['1', '2'],
    materialRefs: [{
      kind: 'notebook', id: 'note-1', revision: 3, scope: 'chat',
      visibility: 'chat:group:10001', policyVersion: 'notebook-memory-v2',
      content: 'must not be exposed'
    }],
    deliveryState: 'not_attempted', delivered: false,
    dispatchBlocked: 'material-stale',
    reasoning: 'must not be exposed', internal: 'must not be exposed'
  });
  assert.equal(auditView.sourceMessageIds.length, 12);
  assert.equal('reasoning' in auditView, false);
  assert.equal('internal' in auditView, false);
  assert.deepEqual(auditView.targetMessageIds, ['1', '2']);
  assert.equal('content' in auditView.materialRefs[0], false);
  assert.equal(auditView.dispatchBlocked, 'material-stale');
  assert.equal(auditView.delivered, false);
  assert.equal(sessionSocialAuditView({ decision: 'share' }).decision, 'share');
  assert.equal(sessionSocialAuditView({ decision: 'react' }).decision, 'react');

  const port = await freePort();
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.server = { ...cfg.server, host: '127.0.0.1', port, token: 'social-console-test-token-0123456' };
  cfg.runtime.mode = 'observe';
  cfg.onebot = { ...cfg.onebot, selfId: '10000001', wsUrl: 'ws://127.0.0.1:1', httpUrl: 'http://127.0.0.1:1' };
  cfg.allow.groups = ['10001'];
  cfg.allow.private = ['20002'];
  updateConfig(cfg);

  const app = createApp({ log: () => {} });
  await app.start();
  t.after(async () => {
    await app.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const request = async (route, { method = 'GET', body, auth = true } = {}) => {
    const response = await fetch('http://127.0.0.1:' + port + route, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(auth ? { 'x-console-token': cfg.server.token } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  };
  const socialTables = () => app.store.db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'social_%'"
  ).all();

  const unauthorized = await request('/api/conversation/social?chatKey=group:10001', { auth: false });
  assert.equal(unauthorized.status, 401);
  const malformed = await request('/api/conversation/social?chatKey=person:10001');
  assert.equal(malformed.status, 400);
  const outsideScope = await request('/api/conversation/social?chatKey=group:99999');
  assert.equal(outsideScope.status, 403);
  const disabled = await request('/api/conversation/social?chatKey=group:10001');
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.mode, 'legacy');
  assert.equal(disabled.body.enabled, false);
  assert.deepEqual(disabled.body.intents, []);
  assert.deepEqual(socialTables(), [], 'disabled status read must not initialize social tables');
  const noCandidates = await request('/api/self-evolution/reflection/candidates');
  assert.equal(noCandidates.status, 200);
  assert.deepEqual(noCandidates.body.entries, []);
  assert.equal(fs.existsSync(path.join(dataDir, 'plugins/self-evolution/reflection.sqlite')), false,
    'candidate history GET must not create a never-used reflection database');
  const deniedCandidates = await request('/api/self-evolution/reflection/candidates?chatKey=group:99999');
  assert.equal(deniedCandidates.status, 403);
  const malformedCandidates = await request('/api/self-evolution/reflection/candidates?chatKey=person:10001');
  assert.equal(malformedCandidates.status, 400);
  const absentCancel = await request('/api/conversation/social/intents/missing/cancel', {
    method: 'POST', body: { chatKey: 'group:10001', reason: '不存在的待办' }
  });
  assert.equal(absentCancel.status, 404);
  assert.deepEqual(socialTables(), [], 'cancelling an absent intent must not create social tables');
  await request('/api/config', { method: 'POST', body: { conversation: { mode: 'social' } } });
  assert.ok(app.orchestrator.getSocialState('group:10001'), 'active mode may hold a lazy state object');
  await request('/api/config', { method: 'POST', body: { conversation: { mode: 'legacy' } } });
  const lazyDisabled = await request('/api/conversation/social?chatKey=group:10001');
  assert.equal(lazyDisabled.status, 200);
  assert.equal(lazyDisabled.body.enabled, false);
  assert.deepEqual(socialTables(), [], 'a cached lazy store must not initialize tables after mode-off');

  const socialConfig = await request('/api/config', {
    method: 'POST', body: { conversation: { mode: 'social', unifiedMode: true } }
  });
  assert.equal(socialConfig.status, 200);
  assert.equal(socialConfig.body.config.conversation.mode, 'social');
  const chatKey = 'group:10001';
  const accountId = '10000001';
  const source = app.store.appendIncoming(chatKey, {
    mid: 'social-source-1', ts: Date.now(), senderId: '20000002', senderName: '成员',
    text: '周末想找个时间一起玩什么？'
  }, { recordOnly: true });
  const socialState = app.orchestrator.getSocialState(chatKey);
  assert.ok(socialState);
  const scene = socialState.observe({
    accountId, chatKey, selfId: accountId, messages: [source]
  });
  const topic = scene.topics[0];
  assert.ok(topic?.id);
  const now = Date.now();
  const intent = socialState.addIntent({
    accountId, chatKey, topicId: topic.id, sourceMessageIds: [String(source.id)],
    goal: '稍后询问大家的空闲时间', dueAt: now + 60000, expiresAt: now + 300000
  });
  assert.ok(intent?.id);
  assert.ok(socialTables().length > 0, 'social tables appear only after a real social write');

  const status = await request('/api/conversation/social?chatKey=group:10001');
  assert.equal(status.status, 200);
  assert.equal(status.body.mode, 'social');
  assert.equal(status.body.enabled, true);
  assert.equal(status.body.scene.topics[0].id, topic.id);
  assert.equal(status.body.intents.find((item) => item.id === intent.id)?.status, 'pending');

  const intentPath = '/api/conversation/social/intents/' + encodeURIComponent(intent.id) + '/cancel';
  const missingReason = await request(intentPath, { method: 'POST', body: { chatKey: 'group:10001' } });
  assert.equal(missingReason.status, 400);
  const deniedCancel = await request(intentPath, {
    method: 'POST', body: { chatKey: 'group:99999', reason: 'scope check' }
  });
  assert.equal(deniedCancel.status, 403);
  await request('/api/config', { method: 'POST', body: { onebot: { selfId: '' } } });
  const missingHostAccount = await request(intentPath, {
    method: 'POST', body: { chatKey: 'group:10001', reason: 'host account check' }
  });
  assert.equal(missingHostAccount.status, 409);
  await request('/api/config', { method: 'POST', body: { onebot: { selfId: accountId } } });
  const cancelled = await request(intentPath, {
    method: 'POST', body: { chatKey: 'group:10001', reason: '管理员调整了安排' }
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.ok, true);
  const stored = socialState.listIntents({ accountId, chatKey: 'group:10001', limit: 50 })
    .find((item) => item.id === intent.id);
  assert.equal(stored.status, 'cancelled');
  assert.equal(stored.reason, '管理员调整了安排');
  const disabledIntent = socialState.addIntent({
    accountId, chatKey: 'group:10001', topicId: topic.id,
    sourceMessageIds: [String(source.id)], goal: '检查已关闭模式下的待办处理',
    dueAt: Date.now() + 60000, expiresAt: Date.now() + 300000
  });
  assert.ok(disabledIntent?.id);

  const switchedBack = await request('/api/config', {
    method: 'POST', body: { conversation: { mode: 'legacy' } }
  });
  assert.equal(switchedBack.body.config.conversation.mode, 'legacy');
  const disabledWithHistory = await request('/api/conversation/social?chatKey=group:10001');
  assert.equal(disabledWithHistory.body.enabled, false);
  assert.equal(disabledWithHistory.body.scene.topics[0].id, topic.id,
    'disabled mode retains historical scene visibility without starting new work');
  assert.equal(disabledWithHistory.body.intents.find((item) => item.id === intent.id)?.status, 'cancelled');
  assert.equal(disabledWithHistory.body.intents.find((item) => item.id === disabledIntent.id)?.status, 'pending');
  const disabledIntentPath = '/api/conversation/social/intents/' + encodeURIComponent(disabledIntent.id) + '/cancel';
  const cancelledWhenDisabled = await request(disabledIntentPath, {
    method: 'POST', body: { chatKey: 'group:10001', reason: '社交模式已关闭' }
  });
  assert.equal(cancelledWhenDisabled.status, 200);
  const finalStatus = await request('/api/conversation/social?chatKey=group:10001');
  assert.equal(finalStatus.body.intents.find((item) => item.id === disabledIntent.id)?.status, 'cancelled');
});
