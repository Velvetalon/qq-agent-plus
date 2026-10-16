// Chromium interaction test against a real, synthetic createApp. No live model/QQ.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import WebSocket from 'ws';

const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-interest-browser-'));
process.env.QQ_AGENT_DATA_DIR = path.join(evidence, 'synthetic-data');
const { DEFAULT_CONFIG, updateConfig } = await import('../../src/core/config.js');
const { createApp } = await import('../../src/console/app.js');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const originalFetch = globalThis.fetch;
let app, chrome, ws, pending = new Map(), seq = 0;
let modelCalls = 0, sends = 0;
let scriptedModel = null, syntheticChatCalls = 0;
const errors = [], checks = [], unexpectedCalls = [], unexpectedProtocol = [];
try {
  const cfg = structuredClone(DEFAULT_CONFIG);
  const listener = http.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const freePort = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  cfg.server = { ...cfg.server, host: '127.0.0.1', port: freePort, strictPort: true, token: 'synthetic-browser-token' };
  cfg.runtime.mode = 'observe'; cfg.conversation.mode = 'social'; cfg.allow.groups = ['1'];
  cfg.onebot = { ...cfg.onebot, selfId: '888', wsUrl: 'ws://127.0.0.1:1', httpUrl: 'http://127.0.0.1:1' };
  cfg.api = { ...cfg.api, model: '', baseUrl: 'https://browser-model.invalid', priceRemoteUrl: 'none' };
  cfg.memory.consolidateEnabled = false;
  cfg.wakeDelayMinMs = 600000; cfg.wakeDelayMaxMs = 600000;
  for (const key of ['selfEvolution', 'proactive', 'pacing', 'dailyMoments', 'qzoneInteractions', 'autoUpdate']) cfg[key] = { ...cfg[key], enabled: false };
  updateConfig(cfg);
  globalThis.fetch = async (url, options) => {
    if (new URL(String(url)).hostname === '127.0.0.1') return originalFetch(url, options);
    // The real settings page checks release metadata independently of inference.
    if (String(url) === 'https://api.github.com/repos/Velvetalon/qq-agent-plus/releases/latest') return Response.json({ message: 'synthetic: no release' }, { status: 404 });
    if (String(url).startsWith('https://browser-model.invalid') && !options?.body) return Response.json({ data: [] });
    if (String(url).startsWith('https://browser-model.invalid') && scriptedModel) { syntheticChatCalls += 1; return scriptedModel(); }
    modelCalls += 1; unexpectedCalls.push(String(url)); throw new Error('Unexpected external call in browser test');
  };
  app = createApp({ log: () => {} });
  const bindProtocolBoundary = () => {
  app.onebot.getGroupInfo = async () => ({ group_name: 'synthetic' });
  app.onebot.connect = async () => { app.onebot.selfInfo = await app.onebot.call('get_login_info'); };
  app.onebot.call = async (action) => {
    if (action === 'get_login_info') return { user_id: 888, nickname: 'synthetic' };
    if (action === 'get_friend_list') return [];
    if (action === 'get_group_list') return [{ group_id: 1, group_name: 'synthetic' }];
    if (action === 'fetch_custom_face_detail') return [];
    sends += 1; unexpectedProtocol.push(action); throw new Error('Unexpected protocol action');
  };
  };
  bindProtocolBoundary();
  const port = await app.start();
  await app.onebot.onEvent({ post_type: 'message', message_type: 'group', self_id: 888,
    group_id: 1, user_id: 42, message_id: 100, time: Math.floor(Date.now() / 1000),
    sender: { user_id: 42, nickname: 'synthetic-member' }, message: 'Astronomy shared discussion', raw_message: 'Astronomy shared discussion' });
  const state = app.orchestrator.getSocialState('group:1');
  state.observe({ accountId: '888', chatKey: 'group:1', messages: app.store.recent('group:1') });
  const profile = path.join(evidence, 'owned-chromium-profile');
  chrome = spawn('/usr/bin/chromium', ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-background-networking', '--no-first-run', '--disable-sync', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const activePort = path.join(profile, 'DevToolsActivePort');
  for (let attempt = 0; !fs.existsSync(activePort) && attempt < 200; attempt += 1) await wait(25);
  const debugPort = fs.readFileSync(activePort, 'utf8').split('\n')[0];
  const pages = await (await originalFetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  ws = new WebSocket(pages[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.on('message', (raw) => {
    const message = JSON.parse(raw);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    const task = pending.get(message.id);
    if (task) { pending.delete(message.id); clearTimeout(task.timer); message.error ? task.reject(new Error(JSON.stringify(message.error))) : task.resolve(message.result); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression) => {
    for (let n = 0; n < 150; n += 1) { if (await evaluate(expression)) return; await wait(40); }
    throw new Error('DOM wait timed out: ' + expression);
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setCookie', { name: 'qq_agent_token', value: cfg.server.token, url: `http://127.0.0.1:${port}`, httpOnly: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${port}` });
  await until(`!!document.querySelector('.tab[data-tab="settings"]')`);
  await evaluate(`document.querySelector('.tab[data-tab="settings"]').click()`);
  await until(`!!document.querySelector('.settings-menu-item[data-section="chat"]')`);
  await evaluate(`document.querySelector('.settings-menu-item[data-section="chat"]').click()`);
  await until(`!!document.querySelector('#social-interest-open')`);
  await evaluate(`document.querySelector('#social-interest-chat').value='1';document.querySelector('#social-interest-open').click()`);
  await until(`!!document.querySelector('[data-interest-save]')`);
  await evaluate(`document.querySelector('[data-interest-add]').click();document.querySelector('[data-interest-title]').value='<script>synthetic</script>';document.querySelector('[data-interest-text]').value='共同关注天文新发现';document.querySelector('[data-interest-master]').checked=true;document.querySelector('[data-interest-save]').click()`);
  await until(`document.querySelector('[data-interest-result]').textContent.includes('请勾选')`);
  assert.equal(state.interests.read({ accountId: '888', chatKey: 'group:1' }).revision, 0);
  await evaluate(`document.querySelector('[data-interest-confirm]').checked=true;document.querySelector('[data-interest-save]').click()`);
  await until(`!!document.querySelector('[data-interest-title]') && !document.querySelector('[data-interest-confirm]').checked && !document.querySelector('[data-interest-save]').disabled`);
  assert.equal(state.interests.read({ accountId: '888', chatKey: 'group:1' }).revision, 1);
  assert.equal(await evaluate(`document.querySelector('[data-interest-title]').value`), '<script>synthetic</script>');
  assert.equal(await evaluate(`document.querySelector('.social-interest-editor').querySelectorAll('script').length`), 0);
  await evaluate(`document.querySelector('[data-interest-goal]').value='Discuss the new astronomy observations';document.querySelector('[data-interest-confirm]').checked=true;document.querySelector('[data-interest-schedule]').click()`);
  await until(`!!document.querySelector('[data-interest-cancel]')`);
  assert.equal(state.listIntents({ accountId: '888', chatKey: 'group:1' })[0].status, 'pending');
  const desktop = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(evidence, 'desktop.png'), Buffer.from(desktop.data, 'base64'));
  checks.push('real settings navigation, confirmation, source save/reload, escaping, schedule');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate(`document.querySelector('[data-interest-cancel]').scrollIntoView({block:'center'})`);
  const layout = await evaluate(`(()=>{const body=document.querySelector('.model-modal-body'),button=document.querySelector('[data-interest-cancel]').getBoundingClientRect();return {overflow:body.scrollWidth-body.clientWidth,pageOverflow:document.documentElement.scrollWidth-innerWidth,visible:button.top>=0&&button.bottom<=innerHeight}})()`);
  assert.ok(layout.overflow <= 1 && layout.pageOverflow <= 1 && layout.visible, JSON.stringify(layout));
  const mobile = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(evidence, 'mobile.png'), Buffer.from(mobile.data, 'base64'));
  await evaluate(`document.querySelector('[data-interest-cancel]').click()`);
  await until(`!!document.querySelector('#social-cancel-reason')`);
  await evaluate(`document.querySelector('#social-cancel-reason').value='synthetic browser cancellation';document.querySelector('[data-social-cancel-confirm]').click()`);
  await until(`!!document.querySelector('[data-interest-save]')&&!document.querySelector('[data-interest-cancel]')`);
  assert.equal(state.listIntents({ accountId: '888', chatKey: 'group:1' })[0].status, 'cancelled');
  checks.push('390px mobile overflow/reachable cancellation and actual cancel handler');
  const current = state.interests.read({ accountId: '888', chatKey: 'group:1' });
  state.interests.save({ accountId: '888', chatKey: 'group:1', expectedRevision: current.revision,
    config: { ...current, enabled: false } });
  await evaluate(`document.querySelector('[data-interest-title]').value='unsaved conflict text';document.querySelector('[data-interest-confirm]').checked=true;document.querySelector('[data-interest-save]').click()`);
  await until(`document.querySelector('[data-interest-result]').textContent.includes('未保存')`);
  assert.equal(await evaluate(`document.querySelector('[data-interest-title]').value`), 'unsaved conflict text');
  assert.equal(state.interests.read({ accountId: '888', chatKey: 'group:1' }).enabled, false);
  assert.equal(state.interests.read({ accountId: '888', chatKey: 'group:1' }).revision, current.revision + 1);
  checks.push('stale browser save preserves newer configuration and unsaved form input');
  // A-C05/C06: generate an actual guarded session, then inspect its real HTTP/UI.
  cfg.runtime.mode = 'active'; cfg.api.model = 'synthetic-ui'; cfg.api.apiKey = 'SYNTHETIC_MODEL_SECRET'; updateConfig(cfg);
  await app.onebot.onEvent({ post_type: 'message', message_type: 'group', self_id: 888, group_id: 1,
    user_id: 42, message_id: 101, time: Math.floor(Date.now() / 1000), sender: { user_id: 42, nickname: 'synthetic-member' },
    message: 'Please explain this astronomy observation.', raw_message: 'Please explain this astronomy observation.' });
  const sourceId = String(app.store.recent('group:1', { limit: 1 })[0].id);
  scriptedModel = () => Response.json({ choices: [{ message: syntheticChatCalls === 1
    ? { reasoning_content: 'SYNTHETIC_PRIVATE_REASONING', content: JSON.stringify({ action: 'reply', topicId: null, topic: 'Astronomy', targetMessageIds: [sourceId], sourceMessageIds: [sourceId], sourceRefs: [], goal: 'Explain the observation', novelty: 'A new explanation' }) }
    : { reasoning_content: 'SYNTHETIC_PRIVATE_REASONING', tool_calls: [{ id: 'ui-delivery', type: 'function', function: { name: 'send_message', arguments: JSON.stringify({ messages: 'A queued synthetic answer.' }) } }] }
  }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } });
  const enqueue = app.sender.sendTextBatch.bind(app.sender);
  app.sender.sendTextBatch = (...args) => { cfg.conversation.mode = 'legacy'; updateConfig(cfg); return enqueue(...args); };
  await app.orchestrator.wake('group:1'); scriptedModel = null;
  cfg.runtime.mode = 'observe'; updateConfig(cfg);
  assert.equal(syntheticChatCalls, 2);
  const session = app.sessions.listSummaries(1)[0];
  assert.equal(session.socialAudit.decision, 'reply'); assert.equal(session.socialAudit.delivered, false);
  const sessionResponse = await originalFetch(`http://127.0.0.1:${port}/api/sessions/${session.id}`, { headers: { 'x-console-token': cfg.server.token } });
  const sessionText = await sessionResponse.text();
  assert.ok(!sessionText.includes('SYNTHETIC_MODEL_SECRET'));
  assert.ok(!sessionText.includes('SYNTHETIC_PRIVATE_REASONING'));
  assert.ok(!sessionText.includes(cfg.server.token));
  await send('Page.navigate', { url: `http://127.0.0.1:${port}` });
  await until(`!!document.querySelector('.tab[data-tab="sessions"]')`);
  await evaluate(`document.querySelector('.tab[data-tab="sessions"]').click()`);
  await until(`!!document.querySelector('.session-item[data-id="${session.id}"]')`);
  await evaluate(`document.querySelector('.session-item[data-id="${session.id}"]').click()`);
  await until(`document.querySelector('.social-session-panel')?.textContent.includes('runtime_permission_changed')`);
  const auditText = await evaluate(`document.querySelector('.social-session-panel').textContent`);
  assert.match(auditText, /规划决定/); assert.match(auditText, /未发送/);
  assert.ok(!auditText.includes('SYNTHETIC_MODEL_SECRET'));
  for (const width of [390, 1440]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
    assert.ok(await evaluate(`document.documentElement.scrollWidth-innerWidth<=1`));
  }
  checks.push('real guarded session HTTP/UI distinguishes reply plan from non-delivery, with no synthetic credentials in response');
  await app.stop();
  app = createApp({ log: () => {} }); bindProtocolBoundary();
  assert.equal(await app.start(), port);
  assert.equal(app.sessions.get(session.id).socialAudit.delivered, false);
  assert.ok(!JSON.stringify(app.sessions.get(session.id)).includes('SYNTHETIC_PRIVATE_REASONING'));
  await send('Page.navigate', { url: `http://127.0.0.1:${port}` });
  await until(`!!document.querySelector('.tab[data-tab="sessions"]')`);
  await evaluate(`document.querySelector('.tab[data-tab="sessions"]').click()`);
  await until(`!!document.querySelector('.session-item[data-id="${session.id}"]')`);
  await evaluate(`document.querySelector('.session-item[data-id="${session.id}"]').click()`);
  await until(`document.querySelector('.social-session-panel')?.textContent.includes('runtime_permission_changed')`);
  for (const width of [390, 1440]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
    assert.ok(await evaluate(`document.documentElement.scrollWidth-innerWidth<=1`));
  }
  checks.push('mode fallback and app restart preserve the same historical guarded session in desktop/mobile browser');
  assert.deepEqual(errors, []); assert.equal(modelCalls, 0, JSON.stringify(unexpectedCalls)); assert.equal(sends, 0, JSON.stringify(unexpectedProtocol));
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ checks, layout, errors, modelCalls, syntheticChatCalls, sends }, null, 2));
  console.log(JSON.stringify({ evidence, checks, layout, errors, modelCalls, syntheticChatCalls, sends }));
} finally {
  for (const task of pending.values()) clearTimeout(task.timer);
  ws?.close();
  if (chrome && chrome.exitCode === null) { chrome.kill('SIGTERM'); await new Promise((resolve) => chrome.once('exit', resolve)); }
  if (app) await app.stop();
  globalThis.fetch = originalFetch;
}
