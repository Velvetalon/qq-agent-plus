// P7 控制台可观测性：插件清单/受限启停、自我迭代管理端、认证与请求体边界、
// 会话审计字段兼容、UI 指纹。全部走真实 createApp 实例 + 真实 HTTP 请求。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-p7-console-'));
process.env.QQ_AGENT_DATA_DIR = dataDir;
test.after(async () => {
  // Windows 上 SQLite 句柄释放有延迟（EBUSY）：退避重试若干次，清理失败不影响用例结论。
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
});

const { DEFAULT_CONFIG, getConfig, updateConfig } = await import('../src/core/config.js');
const { createApp } = await import('../src/console/app.js');
const {
  NotebookStore,
  notebookDatabasePath
} = await import('../src/plugins/self-evolution/notebook-store.js');
const {
  ReflectionStore,
  hashBasePersona,
  reflectionDatabasePath,
  REFLECTION_OBSERVER_ID
} = await import('../src/plugins/self-evolution/reflection-store.js');

const NOTEBOOK_FILE = notebookDatabasePath(dataDir);
const REFLECTION_FILE = reflectionDatabasePath(dataDir);

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function request(port, method, urlPath, { body, headers = {}, raw = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = raw !== null
      ? raw
      : (body === undefined ? null : JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: urlPath,
      headers: {
        ...(payload !== null
          ? {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload)
          }
          : {}),
        ...headers
      }
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* 非 JSON 响应留给断言 */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function buildConfig({
  token = '',
  selfId = '',
  selfEvolution = false,
  reflection = false
} = {}) {
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.server = {
    ...cfg.server,
    host: '127.0.0.1',
    port: await freePort(),
    strictPort: true,
    token
  };
  cfg.onebot = {
    ...cfg.onebot,
    wsUrl: 'ws://127.0.0.1:1',
    httpUrl: 'http://127.0.0.1:1',
    selfId
  };
  cfg.runtime = { ...cfg.runtime, mode: 'observe', paused: false };
  cfg.proactive = { ...cfg.proactive, enabled: false };
  cfg.pacing = { ...cfg.pacing, enabled: false };
  cfg.dailyMoments = { ...cfg.dailyMoments, enabled: false };
  cfg.qzoneInteractions = { ...cfg.qzoneInteractions, enabled: false };
  cfg.autoUpdate = { ...cfg.autoUpdate, enabled: false };
  cfg.webSearch = { ...cfg.webSearch, enabled: false };
  cfg.selfEvolution = {
    enabled: selfEvolution === true,
    ...(selfEvolution === true ? { reflection: { enabled: reflection === true } } : {})
  };
  return cfg;
}

async function launchApp(cfg) {
  updateConfig(cfg);
  const app = createApp({ log: () => {} });
  const actualPort = await app.start();
  const manager = app.orchestrator.pluginManager;
  const pluginStore = (pluginId) => manager.registry.getRegistrations()
    .find((item) => item.plugin.id === pluginId)?.plugin.getStore?.() ?? null;
  return {
    app,
    port: actualPort,
    manager,
    pluginStore,
    stop: () => app.stop()
  };
}

async function startApp(options = {}) {
  return launchApp(await buildConfig(options));
}

/**
 * 与 src/console/app.js 的 reflectionBasePersona() 同口径 —— 审批请求会按
 * 配置里的人设重算 Base Persona hash，种子批次必须用同一个 hash 才不算过期。
 */
function normalizedBasePersona(persona = {}) {
  return {
    roleText: String(persona.roleText || ''),
    behaviorProfile: String(persona.behaviorProfile || 'legacy'),
    botName: String(persona.botName || ''),
    selfNickname: String(persona.selfNickname || ''),
    customRules: String(persona.customRules || ''),
    tools: Array.isArray(persona.tools) ? persona.tools : []
  };
}

function sessionFile(id, extra = {}) {
  const dir = path.join(dataDir, 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({
    id,
    chatKey: 'group:9001',
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_001_000,
    status: 'done',
    messages: [],
    sent: [],
    ...extra
  }));
}

// ── 1. 停用时的可观测性 ────────────────────────────────────────────────────
test('disabled self-evolution serves historical reads without creating a new database or worker', async () => {
  // 先造一份"历史上启用过"的 Notebook 数据（由测试直接写库，不经过 app）。
  const seed = new NotebookStore({
    dataDir,
    filename: NOTEBOOK_FILE,
    now: (() => { let t = 1000; return () => ++t; })()
  });
  seed.append({
    accountId: 'default',
    scope: 'global',
    content: '历史笔记：停用后仍应可读',
    source: { kind: 'console', accountId: 'default', actor: 'seed' },
    idempotencyKey: 'p7-seed-1'
  });
  seed.close();
  const notebookMtime = fs.statSync(NOTEBOOK_FILE).mtimeMs;
  assert.equal(fs.existsSync(REFLECTION_FILE), false, '前置条件：不应存在反思库');

  const { port, manager, stop } = await startApp({ selfEvolution: false });
  try {
    const status = await request(port, 'GET', '/api/self-evolution/status');
    assert.equal(status.status, 200);
    assert.equal(status.json.accountId, 'default');
    assert.equal(status.json.accountSource, 'default');
    assert.equal(status.json.selfEvolution.enabled, false);
    assert.equal(status.json.selfEvolution.running, false);
    assert.equal(status.json.selfEvolution.notebook.exists, true);
    assert.equal(status.json.selfEvolution.notebook.readOnly, true);
    assert.equal(status.json.reflection.running, false);
    assert.equal(status.json.retrieval.available, false);
    assert.equal(status.json.plugins.every((plugin) => plugin.id.startsWith('self-evolution')), true);

    const listed = await request(port, 'GET', '/api/self-evolution/notebook?includeArchived=1');
    assert.equal(listed.status, 200);
    assert.equal(listed.json.disabled, true);
    assert.equal(listed.json.count, 1);
    assert.equal(listed.json.notes[0].content, '历史笔记：停用后仍应可读');

    const jobs = await request(port, 'GET', '/api/self-evolution/reflection/jobs');
    assert.equal(jobs.status, 200);
    assert.equal(jobs.json.entries.length, 0);

    // 停用时不建库、不起 worker
    assert.equal(fs.existsSync(REFLECTION_FILE), false);
    assert.equal(fs.statSync(NOTEBOOK_FILE).mtimeMs, notebookMtime);
    assert.equal(manager.runtime.has('self-evolution'), false);
    assert.equal(manager.runtime.has('self-evolution-reflection'), false);

    // 写入必须被显式拒绝
    const write = await request(port, 'PUT', '/api/self-evolution/notebook/nope123', {
      body: { expectedRevision: 1, content: 'x' }
    });
    assert.equal(write.status, 409);
    assert.equal(write.json.code, 'SELF_EVOLUTION_DISABLED');

    const archive = await request(port, 'POST', '/api/self-evolution/notebook/nope123/archive', {
      body: { expectedRevision: 1 }
    });
    assert.equal(archive.status, 409);
    assert.equal(archive.json.code, 'SELF_EVOLUTION_DISABLED');
  } finally {
    await stop();
  }
});

// ── 2. 认证与请求体边界 ────────────────────────────────────────────────────
test('write routes require a header/cookie credential and reject query-token auth', async () => {
  const token = 'p7-console-token-0000000000';
  const { port, stop } = await startApp({ token });
  try {
    const anonymous = await request(port, 'PUT', '/api/plugins/self-evolution', {
      body: { enabled: true }
    });
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.json.error, '未授权');
    assert.equal(anonymous.text.includes(token), false, '响应不得回显凭据');

    const queryOnly = await request(port, 'PUT',
      `/api/plugins/self-evolution?token=${encodeURIComponent(token)}`,
      { body: { enabled: true } });
    assert.equal(queryOnly.status, 401, '写路由不接受 URL token');
    assert.equal(queryOnly.text.includes(token), false);

    // 读路由保持既有兼容：query token 仍然可以
    const readWithQuery = await request(port, 'GET',
      `/api/plugins?token=${encodeURIComponent(token)}`);
    assert.equal(readWithQuery.status, 200);

    // header / cookie 写请求通过
    const headers = { 'x-console-token': token };
    const malformed = await request(port, 'POST',
      '/api/self-evolution/reflection/profiles/1/rollback',
      { raw: '{"expectedRevision":', headers });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.json.code, 'INVALID_JSON');

    const notObject = await request(port, 'POST',
      '/api/self-evolution/reflection/profiles/1/rollback',
      { raw: '[1,2,3]', headers });
    assert.equal(notObject.status, 400);
    assert.equal(notObject.json.code, 'INVALID_BODY');

    const oversized = await request(port, 'PUT', '/api/plugins/self-evolution', {
      raw: JSON.stringify({ enabled: true, pad: 'x'.repeat(2 * 1024 * 1024 + 16) }),
      headers
    });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.json.code, 'BODY_TOO_LARGE');
  } finally {
    await stop();
  }
});

// ── 3. 插件清单与受限启停 ──────────────────────────────────────────────────
test('plugin inventory exposes the P7 read model and restricts runtime control', async () => {
  const { port, stop } = await startApp({ selfId: '20002' });
  try {
    const inventory = await request(port, 'GET', '/api/plugins');
    assert.equal(inventory.status, 200);
    assert.equal(inventory.json.accountId, '20002');
    assert.equal(inventory.json.accountSource, 'selfId');
    const ids = inventory.json.plugins.map((plugin) => plugin.id);
    for (const id of ['runtime-control', 'messaging', 'memory-tools', 'legacy-tools',
      'self-evolution', 'self-evolution-reflection']) {
      assert.ok(ids.includes(id), `插件清单缺少 ${id}`);
    }
    const selfEvolution = inventory.json.plugins.find((plugin) => plugin.id === 'self-evolution');
    assert.deepEqual(
      Object.keys(selfEvolution).sort(),
      ['apiVersion', 'canDisable', 'canEnable', 'capabilities', 'enabled', 'generation',
        'id', 'lastError', 'name', 'required', 'running', 'startedAt', 'version'].sort()
    );
    assert.equal(selfEvolution.enabled, false);
    assert.equal(selfEvolution.running, false);
    assert.equal(selfEvolution.canEnable, true);
    assert.equal(selfEvolution.canDisable, true);
    assert.ok(Array.isArray(selfEvolution.capabilities.tools));
    assert.ok(selfEvolution.capabilities.tools.includes('notebook_append'));

    // 必需插件不能停用
    const required = await request(port, 'PUT', '/api/plugins/runtime-control', {
      body: { enabled: false }
    });
    assert.equal(required.status, 409);
    assert.equal(required.json.code, 'PLUGIN_REQUIRED');

    // 非白名单插件不允许启停
    const blocked = await request(port, 'PUT', '/api/plugins/legacy-tools', {
      body: { enabled: true }
    });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.code, 'PLUGIN_NOT_CONTROLLABLE');

    // 未知插件
    const missing = await request(port, 'PUT', '/api/plugins/nope-plugin', {
      body: { enabled: true }
    });
    assert.equal(missing.status, 404);
    assert.equal(missing.json.code, 'PLUGIN_NOT_FOUND');

    // 字段校验
    const badBody = await request(port, 'PUT', '/api/plugins/self-evolution', {
      body: { enabled: 'yes' }
    });
    assert.equal(badBody.status, 400);
    assert.equal(badBody.json.code, 'INVALID_BODY');

    // 启用：必须走插件生命周期（running=true 且 startedAt>0）
    const enable = await request(port, 'PUT', '/api/plugins/self-evolution', {
      body: { enabled: true }
    });
    assert.equal(enable.status, 200);
    assert.equal(enable.json.plugin.running, true);
    assert.ok(enable.json.plugin.startedAt > 0);
    const afterEnable = await request(port, 'GET', '/api/plugins');
    const enabledEntry = afterEnable.json.plugins.find((plugin) => plugin.id === 'self-evolution');
    assert.equal(enabledEntry.enabled, true);
    assert.equal(enabledEntry.running, true);
    assert.equal(enabledEntry.canEnable, false);

    // 停用：同样走生命周期，running 回到 false 且数据仍在
    const disable = await request(port, 'PUT', '/api/plugins/self-evolution', {
      body: { enabled: false }
    });
    assert.equal(disable.status, 200);
    assert.equal(disable.json.plugin.running, false);
    assert.equal(fs.existsSync(NOTEBOOK_FILE), true, '停用不删除数据');
  } finally {
    await stop();
  }
});

// ── 4. Notebook 写路由的 CAS ───────────────────────────────────────────────
test('notebook write and archive routes enforce revision CAS', async () => {
  const { port, pluginStore, stop } = await startApp({ selfId: '40004', selfEvolution: true });
  try {
    const store = pluginStore('self-evolution');
    assert.ok(store, '启用后应有活动 Notebook store');
    const note = store.append({
      accountId: '40004',
      scope: 'global',
      content: 'P7 CAS 用例',
      source: { kind: 'console', accountId: '40004', actor: 'test' },
      idempotencyKey: 'p7-cas-1'
    });
    assert.equal(note.revision, 1);

    const conflict = await request(port, 'PUT', `/api/self-evolution/notebook/${note.note.id}`, {
      body: { expectedRevision: 99, content: '过期写入' }
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.json.code, 'NOTEBOOK_CAS_CONFLICT');

    const updated = await request(port, 'PUT', `/api/self-evolution/notebook/${note.note.id}`, {
      body: { expectedRevision: 1, content: 'P7 CAS 用例（已更新）', tags: ['p7'] }
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.revision, 2);
    assert.equal(updated.json.note.content, 'P7 CAS 用例（已更新）');

    const archiveConflict = await request(port, 'POST',
      `/api/self-evolution/notebook/${note.note.id}/archive`, { body: { expectedRevision: 1 } });
    assert.equal(archiveConflict.status, 409);
    assert.equal(archiveConflict.json.code, 'NOTEBOOK_CAS_CONFLICT');

    const archived = await request(port, 'POST',
      `/api/self-evolution/notebook/${note.note.id}/archive`, { body: { expectedRevision: 2 } });
    assert.equal(archived.status, 200);
    assert.equal(archived.json.note.status, 'archived');

    const activeOnly = await request(port, 'GET', '/api/self-evolution/notebook');
    assert.equal(activeOnly.json.count, 0);
    const withArchived = await request(port, 'GET', '/api/self-evolution/notebook?includeArchived=1');
    assert.equal(withArchived.json.count, 1);

    const htmlNote = store.append({
      accountId: '40004',
      scope: 'global',
      content: '<script>alert("p7")</script>',
      source: { kind: 'console', accountId: '40004', actor: 'test' },
      idempotencyKey: 'p7-cas-html'
    });
    const htmlRead = await request(port, 'GET', '/api/self-evolution/notebook?query=script');
    assert.equal(htmlRead.status, 200);
    assert.equal(htmlRead.json.notes[0].content, '<script>alert("p7")</script>');
    assert.equal(htmlNote.revision, 1);
  } finally {
    await stop();
  }
});

// ── 5. 审批 / 回滚 CAS ────────────────────────────────────────────────────
test('reflection review and rollback routes return 409 on revision conflicts', async () => {
  const accountId = '50005';
  // 先用与 app 相同的配置落地，再按 app 的口径算 Base Persona hash 造种子批次。
  const cfg = await buildConfig({ selfId: accountId, selfEvolution: true, reflection: true });
  updateConfig(cfg);
  const basePersona = normalizedBasePersona(getConfig().persona);
  const baseHash = hashBasePersona(basePersona);
  const seed = new ReflectionStore({
    dataDir,
    filename: REFLECTION_FILE,
    now: (() => { let t = 5000; return () => ++t; })(),
    limits: { leaseMs: 60000, workerLeaseMs: 60000, backoffMs: 0 }
  });
  const generation = seed.beginWorkerGeneration({ owner: 'p7-seed' });
  for (const suffix of ['a', 'b', 'c']) {
    seed.enqueueObservation({
      eventId: `p7-seed-event-${suffix}`,
      observerId: REFLECTION_OBSERVER_ID,
      observerPluginId: 'self-evolution',
      accountId,
      sessionId: `p7-session-${suffix}`,
      runId: `p7-run-${suffix}`,
      chatKey: 'group:5005',
      pluginGeneration: 1,
      resultClass: 'done',
      actionSummary: { sentCount: 1, finishReason: 'finish', outboundAttempted: true },
      sourceMessageIds: [`m-${suffix}`],
      completedAt: 5000
    });
    const claimed = seed.claimNextJob({
      owner: 'p7-seed',
      generation,
      leaseMs: 60000,
      workerLeaseMs: 60000
    });
    assert.equal(claimed.status, 'claimed');
    const committed = seed.commitReflectionResult({
      job: claimed.job,
      owner: 'p7-seed',
      generation,
      mode: 'review',
      basePersonaHash: baseHash,
      expectedProfileRevision: 0,
      output: {
        noteOperations: [{
          operation: 'append',
          scope: 'global',
          content: `P7 审批写入的笔记 ${suffix}`,
          tags: ['p7'],
          evidenceRefs: [`session:p7-session-${suffix}`]
        }],
        // 只有 b 批次带 trait：审批后应生成新的 Learned Self 版本（head 0 → 1）。
        traitProposals: suffix === 'b'
          ? [{
            action: 'set',
            key: 'communication_style',
            value: 'concise',
            scope: 'global',
            confidence: 0.8,
            evidenceRefs: ['session:p7-session-b']
          }]
          : [],
        capabilityGapProposals: [],
        summary: `p7 seed batch ${suffix}`
      }
    });
    assert.equal(committed.accepted, true);
  }
  const proposals = seed.listProposals({ accountId, limit: 10 });
  assert.equal(proposals.length, 4, 'a/b/c 三个批次：3 条 note + 1 条 trait');
  const batchIds = [...new Set(proposals.map((proposal) => proposal.batchId))];
  assert.equal(batchIds.length, 3);
  const conflictProposal = proposals.find((proposal) => proposal.batchId === batchIds[0]);
  const approveProposal = proposals.find((proposal) => proposal.batchId === batchIds[1]);
  const rejectProposal = proposals.find((proposal) => proposal.batchId === batchIds[2]);
  seed.close();

  const { port, stop } = await launchApp(cfg);
  try {
    const jobs = await request(port, 'GET', '/api/self-evolution/reflection/jobs');
    assert.equal(jobs.status, 200);
    assert.ok(Array.isArray(jobs.json.entries));

    const proposalsRead = await request(port, 'GET', '/api/self-evolution/reflection/proposals');
    assert.equal(proposalsRead.status, 200);
    assert.equal(proposalsRead.json.count, 4);

    const gaps = await request(port, 'GET', '/api/self-evolution/reflection/gaps');
    assert.equal(gaps.status, 200);

    const profiles = await request(port, 'GET', '/api/self-evolution/reflection/profiles');
    assert.equal(profiles.status, 200);
    assert.equal(profiles.json.headRevision, 0);

    const reviewConflict = await request(port, 'POST',
      `/api/self-evolution/reflection/proposals/${conflictProposal.id}/review`,
      { body: { decision: 'approve', expectedRevision: 7 } });
    assert.equal(reviewConflict.status, 409);
    assert.equal(reviewConflict.json.code, 'REFLECTION_REVIEW_STALE');

    const missing = await request(port, 'POST',
      '/api/self-evolution/reflection/proposals/nope/review',
      { body: { decision: 'approve', expectedRevision: 0 } });
    assert.equal(missing.status, 404);

    const badDecision = await request(port, 'POST',
      `/api/self-evolution/reflection/proposals/${approveProposal.id}/review`,
      { body: { decision: 'maybe', expectedRevision: 0 } });
    assert.equal(badDecision.status, 400);

    // 拒绝也要按 revision CAS 走，且不改 Learned Self
    const rejected = await request(port, 'POST',
      `/api/self-evolution/reflection/proposals/${rejectProposal.id}/review`,
      { body: { decision: 'reject', expectedRevision: 0 } });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.json.decision, 'reject');

    const approved = await request(port, 'POST',
      `/api/self-evolution/reflection/proposals/${approveProposal.id}/review`,
      { body: { decision: 'approve', expectedRevision: 0 } });
    assert.equal(approved.status, 200);
    assert.equal(approved.json.reviewed, true);
    assert.equal(approved.json.profileRevision, 1);

    const profilesAfter = await request(port, 'GET', '/api/self-evolution/reflection/profiles');
    assert.equal(profilesAfter.json.headRevision, 1);
    assert.equal(profilesAfter.json.entries.length, 1);

    // 审批后 head revision 变为 1：用过期 revision 回滚必须 409，且不得写新版本
    const rollbackConflict = await request(port, 'POST',
      '/api/self-evolution/reflection/profiles/1/rollback',
      { body: { expectedRevision: 9 } });
    assert.equal(rollbackConflict.status, 409);
    assert.equal(rollbackConflict.json.code, 'REFLECTION_CAS_CONFLICT');

    const conflictCheck = await request(port, 'GET', '/api/self-evolution/reflection/profiles');
    assert.equal(conflictCheck.json.headRevision, 1, '冲突的回滚不写版本');
    assert.equal(conflictCheck.json.entries.length, 1, '冲突的回滚不写版本');

    // 正确 revision 的回滚会写出新版本（head 1 → 2），且不改 Base Persona
    const rolledBack = await request(port, 'POST',
      '/api/self-evolution/reflection/profiles/1/rollback',
      { body: { expectedRevision: 1 } });
    assert.equal(rolledBack.status, 200);
    assert.equal(rolledBack.json.rolledBack, true);
    assert.equal(rolledBack.json.revision, 2);
  } finally {
    await stop();
  }
});

// ── 6. 旧会话默认值 + 会话审计字段 ────────────────────────────────────────
test('session list and detail expose audit fields with defaults for old files', async () => {
  sessionFile('p7-old-session');
  const { port, stop } = await startApp({ selfId: '60006' });
  try {
    const list = await request(port, 'GET', '/api/sessions?limit=10');
    assert.equal(list.status, 200);
    const summary = list.json.sessions.find((session) => session.id === 'p7-old-session');
    assert.ok(summary);
    assert.equal(summary.pluginSnapshot, null);
    assert.equal(summary.pluginContext, null);
    assert.equal(summary.retrieval.integrated, false);
    assert.equal(summary.retrieval.available, false);
    assert.equal(summary.retrieval.reason, 'unavailable');
    assert.equal(summary.contextBudget.promptChars, 0);
    assert.equal(summary.participation, null);
    assert.equal(summary.termination, null);
    assert.equal(summary.outbound, null);

    const detail = await request(port, 'GET', '/api/sessions/p7-old-session');
    assert.equal(detail.status, 200);
    assert.equal(detail.json.retrieval.available, false);
    assert.equal(detail.json.pluginSnapshot, null);
    assert.equal('roleText' in detail.json, false);

    // 新字段写进会话文件后必须原样透出
    const sessionPath = path.join(dataDir, 'sessions', 'p7-old-session.json');
    const record = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    record.pluginSnapshot = { registryRevision: 3, plugins: [{ id: 'self-evolution', version: '1.0.0', generation: 2 }] };
    record.pluginContext = { blocks: [{ id: 'b1', title: 'Notebook', revision: 4 }], diagnostics: [], degraded: false };
    record.retrieval = { integrated: true, available: true, reason: '', blocks: 1 };
    record.contextBudget = { promptChars: 123, contextLimit: 8 };
    fs.writeFileSync(sessionPath, JSON.stringify(record));
    const refreshed = await request(port, 'GET', '/api/sessions/p7-old-session');
    assert.equal(refreshed.json.pluginSnapshot.registryRevision, 3);
    assert.equal(refreshed.json.pluginContext.blocks[0].revision, 4);
    assert.equal(refreshed.json.retrieval.integrated, true);
    assert.equal(refreshed.json.contextBudget.contextLimit, 8);
  } finally {
    await stop();
  }
});

// ── 7. UI：指纹与转义 ─────────────────────────────────────────────────────
function loadUiSandbox() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const code = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
  const makeEl = (id = '') => {
    const el = {
      id,
      dataset: {},
      style: { setProperty() {}, removeProperty() {} },
      textContent: '',
      innerHTML: '',
      value: '',
      checked: false,
      children: [],
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener() {},
      removeEventListener() {},
      querySelector: () => makeEl(),
      querySelectorAll: () => [],
      appendChild(child) { el.children.push(child); return child; },
      remove() {},
      closest: () => null,
      setAttribute() {},
      getAttribute: () => null,
      focus() {},
      scrollIntoView() {},
      insertAdjacentHTML() {},
      contains: () => false,
      scrollTop: 0,
      scrollHeight: 100,
      clientHeight: 50
    };
    return el;
  };
  const store = new Map();
  const document = {
    documentElement: makeEl('html'),
    body: makeEl('body'),
    head: makeEl('head'),
    querySelector: (sel) => {
      if (!store.has(sel)) store.set(sel, makeEl(String(sel)));
      return store.get(sel);
    },
    querySelectorAll: () => [],
    getElementById: (id) => document.querySelector(`#${id}`),
    createElement: () => makeEl(),
    addEventListener() {},
    removeEventListener() {}
  };
  const sandbox = {
    document,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { href: 'http://127.0.0.1/', protocol: 'http:', host: '127.0.0.1' },
    fetch: async () => ({
      ok: true,
      json: async () => ({ sessions: [], chats: [], config: {}, files: [], members: [] }),
      text: async () => ''
    }),
    EventSource: function () { this.addEventListener = () => {}; this.close = () => {}; },
    setTimeout, clearTimeout,
    // 页面里的常驻轮询在桩里不排真实定时器，否则测试进程不会退出。
    setInterval: () => 0,
    clearInterval: () => {},
    console, alert: () => {}, confirm: () => true, prompt: () => null,
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    navigator: { userAgent: 'node', clipboard: { writeText: async () => {} } },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    URL, Intl, Math, JSON, Date, Number, String, Object, Array, Map, Set, Boolean,
    RegExp, Error, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    structuredClone: (value) => JSON.parse(JSON.stringify(value))
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  new vm.Script(code, { filename: 'ui/app.js' }).runInContext(ctx);
  return ctx;
}

test('session detail fingerprint tracks audit fields and audit rendering escapes HTML', () => {
  const ctx = loadUiSandbox();
  const base = {
    id: 'fingerprint-session',
    chatKey: 'group:1',
    status: 'done',
    startedAt: 1,
    messages: [],
    sent: []
  };
  const first = ctx.sessionDetailFingerprint(base);
  assert.equal(typeof first, 'string');
  assert.notEqual(first, ctx.sessionDetailFingerprint({
    ...base, pluginSnapshot: { registryRevision: 1 }
  }));
  assert.notEqual(first, ctx.sessionDetailFingerprint({
    ...base, retrieval: { integrated: true, available: true }
  }));
  assert.notEqual(first, ctx.sessionDetailFingerprint({
    ...base, participation: { decision: 'reply' }
  }));
  assert.notEqual(first, ctx.sessionDetailFingerprint({
    ...base, termination: { kind: 'finish' }
  }));
  assert.notEqual(first, ctx.sessionDetailFingerprint({
    ...base, outbound: { attempted: 1 }
  }));
  assert.equal(first, ctx.sessionDetailFingerprint({ ...base }));

  const html = ctx.renderSelfEvolutionNotebook({
    notes: [{
      id: 'note-1',
      scope: 'global',
      status: 'active',
      revision: 3,
      content: '<script>alert("x")</script>',
      tags: ['<img src=x onerror=alert(1)>']
    }],
    count: 1
  });
  assert.equal(html.includes('<script>alert'), false, '正文必须转义');
  assert.equal(html.includes('&lt;script&gt;'), true);
  assert.equal(html.includes('<img src=x'), false, '标签必须转义');

  // 会话审计面板同样必须走 esc()，并把旧会话的默认值显示出来
  const auditHtml = ctx.renderSessionAuditPanels({
    id: 'audit-session',
    chatKey: 'group:1',
    status: 'done',
    messages: [],
    sent: [],
    participation: { decision: '<b>reply</b>' },
    termination: { kind: '<i>finish</i>' },
    outbound: { attempted: 1, succeeded: 1, failed: 0, unknown: 0, held: 0 },
    pluginSnapshot: { registryRevision: 2, plugins: [{ id: 'self-evolution', version: '1.0.0', generation: 1 }] },
    pluginContext: { blocks: [{ id: 'note-1', revision: 4 }], diagnostics: [], degraded: false },
    retrieval: { integrated: false, available: false, reason: 'unavailable' },
    contextBudget: { promptChars: 10, contextLimit: 4 }
  });
  assert.equal(auditHtml.includes('<b>reply</b>'), false);
  assert.equal(auditHtml.includes('&lt;b&gt;reply&lt;/b&gt;'), true);
  assert.equal(auditHtml.includes('note-1@4'), true);
  assert.equal(auditHtml.includes('不可用'), true);

  const emptyAuditHtml = ctx.renderSessionAuditPanels({ id: 'old', messages: [], sent: [] });
  assert.equal(emptyAuditHtml.includes('旧会话未记录'), true);
  assert.equal(emptyAuditHtml.includes('旧会话无记录'), true);

  // 插件页：只给白名单插件渲染启停按钮，必需插件不能停用
  vm.runInContext(`state.pluginsPage = ${JSON.stringify({
    accountId: '70007',
    accountSource: 'selfId',
    selfEvolution: { enabled: false, reflectionEnabled: false },
    retrieval: { available: false },
    plugins: [
      {
        id: 'runtime-control', name: 'Runtime control', version: '1.1.0', apiVersion: 1,
        required: true, enabled: true, generation: 1, running: true, startedAt: 1,
        lastError: '', capabilities: { tools: ['finish'], contextProviders: [], sessionObservers: [] },
        canEnable: false, canDisable: false
      },
      {
        id: 'self-evolution', name: 'Self-evolution Notebook', version: '1.0.0', apiVersion: 1,
        required: false, enabled: false, generation: 1, running: false, startedAt: 0,
        lastError: '<bad>', capabilities: { tools: ['notebook_append'], contextProviders: [], sessionObservers: [] },
        canEnable: true, canDisable: true
      }
    ]
  })};`, ctx);
  ctx.renderPluginsPage();
  const pluginsHtml = ctx.document.querySelector('#plugins-page').innerHTML;
  assert.equal(pluginsHtml.includes('data-plugin-id="self-evolution"'), true);
  assert.equal(pluginsHtml.includes('data-plugin-id="runtime-control"'), false,
    '非白名单插件不渲染启停按钮');
  assert.equal(pluginsHtml.includes('&lt;bad&gt;'), true, '最后错误必须转义');

  // 自我迭代页：四个页签 + 无数据时的空态，切到反思页签渲染提案
  vm.runInContext(`state.selfEvolutionData = ${JSON.stringify({
    status: {
      accountId: '70007',
      disabled: true,
      selfEvolution: { enabled: false },
      reflection: { running: false, budget: { maxCallsPerDay: 100, callsCount: 0 } },
      retrieval: { available: false }
    },
    notebook: { notes: [], disabled: true },
    jobs: { entries: [] },
    proposals: { entries: [{ id: 'refprop_1', batchId: 'b1', type: 'note', risk: 'low', status: 'pending', detail: '<x>', expectedProfileRevision: 0 }] },
    gaps: { entries: [] },
    profiles: { entries: [{ revision: 1, parentRevision: 0, appliedBy: 'console', createdAt: 1, source: [] }], headRevision: 1 }
  })}; state.selfEvolutionTab = 'reflection';`, ctx);
  ctx.renderSelfEvolutionPage();
  const selfEvoHtml = ctx.document.querySelector('#self-evolution-page').innerHTML;
  for (const label of ['笔记', '习得自我', '反思作业 / 提案', '能力缺口']) {
    assert.equal(selfEvoHtml.includes(label), true, `缺少页签 ${label}`);
  }
  assert.equal(selfEvoHtml.includes('data-proposal-review="refprop_1"'), true);
  assert.equal(selfEvoHtml.includes('&lt;x&gt;'), true, '提案内容必须转义');
});
