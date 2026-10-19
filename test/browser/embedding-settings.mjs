// Real createApp + Chromium UI; only synthetic data and mocked provider boundaries.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { trackChildProcess } from './child-process-lifecycle.mjs';

const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-embedding-browser-'));
process.env.QQ_AGENT_DATA_DIR = path.join(evidence, 'synthetic-data');
const { DEFAULT_CONFIG, updateConfig, getConfig, loadConfig, setRuntimeConfig } = await import('../../src/core/config.js');
const { createApp } = await import('../../src/console/app.js');
const originalFetch = globalThis.fetch;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const key = 'synthetic-browser-embedding-key';
const errors = [], checks = [], unexpectedCalls = [], unexpectedProtocol = [];
const requests = { save: 0, test: 0, embedding: 0, cancelled: 0 };
let app, chromeLifecycle, ws, seq = 0;
const pending = new Map();
try {
  const listener = http.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.server = { ...cfg.server, host: '127.0.0.1', port, strictPort: true, token: 'synthetic-embedding-browser-console' };
  cfg.runtime.mode = 'observe';
  cfg.onebot = { ...cfg.onebot, selfId: '888', wsUrl: 'ws://127.0.0.1:1', httpUrl: 'http://127.0.0.1:1' };
  cfg.api = { ...cfg.api, model: '', apiKey: '', baseUrl: 'https://embedding-chat.invalid/v1', priceRemoteUrl: 'none' };
  cfg.memory.consolidateEnabled = false; cfg.sticker.enabled = false;
  for (const name of ['proactive', 'pacing', 'dailyMoments', 'qzoneInteractions', 'autoUpdate']) cfg[name] = { ...cfg[name], enabled: false };
  cfg.selfEvolution = { enabled: true, reflection: { enabled: false }, retrieval: { enabled: true } };
  updateConfig(cfg);
  globalThis.fetch = async (url, options) => {
    const target = new URL(String(url));
    if (target.hostname === '127.0.0.1') return originalFetch(url, options);
    if (target.hostname === 'api.github.com') return Response.json({ message: 'synthetic release fixture' }, { status: 404 });
    if (target.hostname === 'embedding-chat.invalid' && !options?.body) return Response.json({ data: [] });
    if (String(url) !== 'https://api.nano-gpt.com/api/v1/embeddings') {
      unexpectedCalls.push(String(url)); throw new Error('Unexpected external boundary');
    }
    assert.equal(options.headers.authorization, `Bearer ${key}`);
    requests.embedding += 1;
    const body = JSON.parse(options.body);
    assert.deepEqual(body.input, ['QQAgent embedding connection test.']);
    if (body.model === 'synthetic-failure') return Response.json({ error: key }, { status: 503 });
    if (body.model === 'synthetic-slow') await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 6000);
      options.signal.addEventListener('abort', () => { requests.cancelled += 1; clearTimeout(timer); reject(options.signal.reason); }, { once: true });
    });
    const dimension = body.model === 'synthetic-wrong-dimension' ? 2 : body.dimensions;
    return Response.json({ data: [{ index: 0, embedding: [1, ...Array(dimension - 1).fill(0)] }] });
  };
  async function startApp() {
    app = createApp({ log: () => {} });
    app.onebot.connect = async () => { app.onebot.selfInfo = await app.onebot.call('get_login_info'); };
    app.onebot.call = async (action) => {
      if (action === 'get_login_info') return { user_id: 888, nickname: 'synthetic' };
      if (['get_friend_list', 'get_group_list', 'fetch_custom_face_detail'].includes(action)) return [];
      unexpectedProtocol.push(action); throw new Error('Unexpected protocol action');
    };
    app.server.on('request', (request) => {
      if (request.method === 'POST' && request.url === '/api/embedding/settings') requests.save += 1;
      if (request.method === 'POST' && request.url === '/api/embedding/test') requests.test += 1;
    });
    assert.equal(await app.start(), port);
  }
  await startApp();
  const profile = path.join(evidence, 'owned-chromium-profile');
  const chrome = spawn('/usr/bin/chromium', ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-background-networking', '--no-first-run', '--disable-sync', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  chromeLifecycle = trackChildProcess(chrome);
  const activePort = path.join(profile, 'DevToolsActivePort');
  await chromeLifecycle.waitForFile(activePort);
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
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression) => {
    for (let n = 0; n < 200; n += 1) { if (await evaluate(expression)) return; await wait(40); }
    throw new Error('DOM wait timed out: ' + expression);
  };
  const click = (id) => evaluate(`document.querySelector(${JSON.stringify('#' + id)}).click()`);
  const fill = (id, value) => evaluate(`document.querySelector(${JSON.stringify('#' + id)}).${typeof value === 'boolean' ? 'checked' : 'value'}=${JSON.stringify(value)}`);
  const resultContains = (value) => until(`document.querySelector('#embedding-result')?.textContent.includes(${JSON.stringify(value)}) && !document.querySelector('#embedding-save').disabled`);
  const openEmbedding = async () => {
    await until(`typeof state !== 'undefined' && !!state.config && typeof loadEmbeddingSettingsPage === 'function'`);
    await evaluate(`document.querySelector('.tab[data-tab="embedding"]').click()`);
    await until(`!!document.querySelector('#embedding-enabled') && !document.querySelector('#embedding-save').disabled`);
  };
  const screenshot = async (name) => {
    const png = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(evidence, name), Buffer.from(png.data, 'base64'));
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setCookie', { name: 'qq_agent_token', value: cfg.server.token, url: `http://127.0.0.1:${port}`, httpOnly: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${port}` });
  await openEmbedding();
  assert.equal(await evaluate(`document.querySelector('#embedding-provider').value`), 'NanoGPT');
  assert.equal(await evaluate(`document.querySelector('#embedding-base-url').value`), 'https://api.nano-gpt.com/api/v1');
  assert.equal(await evaluate(`document.querySelector('#embedding-model').value`), 'Qwen/Qwen3-Embedding-4B');
  assert.equal(await evaluate(`document.querySelector('#embedding-dimension').value`), '2560');
  assert.equal(await evaluate(`document.querySelector('#embedding-max-distance').value`), '0.5');
  await click('embedding-test'); await resultContains('测试失败');
  assert.equal(requests.embedding, 0);
  checks.push('permanent page, exact NanoGPT/4B/2560 defaults and explicit unconfigured no-call test');

  const unrelated = JSON.stringify(getConfig().api);
  await fill('embedding-enabled', true); await fill('embedding-api-key', key);
  await fill('embedding-allow-query', true); await fill('embedding-allow-private', true);
  const beforeSave = requests.save;
  await evaluate(`document.querySelector('#embedding-save').click();document.querySelector('#embedding-save').click()`);
  await resultContains('已保存');
  assert.equal(requests.save, beforeSave + 1);
  assert.equal(getConfig().selfEvolution.retrieval.embedding.apiKey, key);
  assert.equal(JSON.stringify(getConfig().api), unrelated);
  assert.equal(await evaluate(`document.querySelector('#embedding-api-key').value`), '');
  assert.equal(await evaluate(`document.querySelector('#embedding-api-key').type`), 'password');
  await fill('embedding-model', 'cancel-me'); await fill('embedding-api-key', 'synthetic-discard');
  await click('embedding-cancel'); await resultContains('已取消修改');
  assert.equal(requests.save, beforeSave + 1);
  assert.equal(await evaluate(`document.querySelector('#embedding-model').value`), 'Qwen/Qwen3-Embedding-4B');
  assert.equal(await evaluate(`document.querySelector('#embedding-api-key').value`), '');
  await click('embedding-save'); await resultContains('已保存');
  assert.equal(getConfig().selfEvolution.retrieval.embedding.apiKey, key);
  checks.push('single save under duplicate clicks, key masking/blank preservation, field isolation, cancel without mutation');

  await fill('embedding-dimension', '4096'); await click('embedding-save'); await resultContains('保存未确认');
  assert.equal(getConfig().selfEvolution.retrieval.embedding.dimension, 2560);
  assert.equal(await evaluate(`document.querySelector('#embedding-dimension').value`), '4096');
  await click('embedding-cancel');
  await fill('embedding-base-url', 'https://another.invalid/v1'); await click('embedding-test'); await resultContains('测试失败');
  assert.equal(requests.embedding, 0);
  await click('embedding-cancel');
  await fill('embedding-model', 'synthetic-wrong-dimension'); await click('embedding-test'); await resultContains('维度不匹配');
  await fill('embedding-model', 'synthetic-failure'); await click('embedding-test'); await resultContains('模型网关返回错误');
  assert.equal(await evaluate(`document.body.textContent.includes(${JSON.stringify(key)})`), false);
  await click('embedding-cancel'); await click('embedding-test'); await resultContains('测试通过：2560');
  checks.push('invalid dimension rejected, changed destination blocked, malformed vectors and HTTP errors fail truthfully, recovered test succeeds');

  await fill('embedding-model', 'synthetic-slow');
  const beforeProbe = requests.embedding;
  const beforeTest = requests.test;
  await evaluate(`document.querySelector('#embedding-test').click();document.querySelector('#embedding-test').click()`);
  for (let n = 0; n < 100 && requests.embedding === beforeProbe; n += 1) await wait(10);
  assert.equal(requests.embedding, beforeProbe + 1);
  assert.equal(requests.test, beforeTest + 1);
  await click('embedding-cancel'); await resultContains('测试已取消');
  for (let n = 0; n < 100 && !requests.cancelled; n += 1) await wait(10);
  assert.equal(requests.cancelled, 1);
  await fill('embedding-api-key', 'synthetic-unsaved-navigation');
  await evaluate(`document.querySelector('.tab[data-tab="sessions"]').click()`);
  assert.equal(await evaluate(`document.querySelector('#embedding-settings-page').innerHTML`), '');
  await openEmbedding();
  assert.equal(await evaluate(`document.querySelector('#embedding-api-key').value`), '');
  assert.equal(await evaluate(`document.querySelector('#embedding-model').value`), 'Qwen/Qwen3-Embedding-4B');
  checks.push('single in-flight test, real abort reaches provider boundary, cancellation clears draft, navigation erases secret input');

  await fill('embedding-model', 'unsaved-refresh'); await click('embedding-refresh');
  await until(`document.querySelector('#embedding-model')?.value==='Qwen/Qwen3-Embedding-4B' && !document.querySelector('#embedding-save').disabled`);
  await send('Page.reload'); await openEmbedding();
  assert.equal(await evaluate(`document.querySelector('#embedding-api-key').value`), '');
  assert.match(await evaluate(`document.querySelector('#embedding-api-key').placeholder`), /已保存/);
  await screenshot('desktop.png');
  await app.stop(); app = null;
  setRuntimeConfig(loadConfig()); await startApp();
  await send('Page.navigate', { url: `http://127.0.0.1:${port}` }); await openEmbedding();
  assert.equal(getConfig().selfEvolution.retrieval.embedding.apiKey, key);
  assert.equal(await evaluate(`document.querySelector('#embedding-model').value`), 'Qwen/Qwen3-Embedding-4B');
  assert.match(await evaluate(`document.querySelector('#embedding-status').textContent`), /尚未验证/);
  checks.push('refresh/page reload restore saved configuration; real app stop/load/start preserves key and profile but not false health');

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await screenshot('mobile-top.png');
  await evaluate(`document.querySelector('#embedding-save').scrollIntoView({block:'center'})`);
  const layout = await evaluate(`(()=>{const page=document.querySelector('#embedding-settings-page'),button=document.querySelector('#embedding-save').getBoundingClientRect();return {overflow:page.scrollWidth-page.clientWidth,pageOverflow:document.documentElement.scrollWidth-innerWidth,visible:button.top>=0&&button.bottom<=innerHeight}})()`);
  assert.ok(layout.overflow <= 1 && layout.pageOverflow <= 1 && layout.visible, JSON.stringify(layout));
  await screenshot('mobile-controls.png');
  await fill('embedding-clear-key', true); await click('embedding-save'); await resultContains('仍不可用');
  const beforeUnconfigured = requests.embedding;
  await click('embedding-test'); await resultContains('测试失败');
  assert.equal(requests.embedding, beforeUnconfigured);
  assert.equal(getConfig().selfEvolution.retrieval.embedding.apiKey, '');
  await evaluate(`document.querySelector('.tab[data-tab="sessions"]').click()`);
  assert.equal((await originalFetch(`http://127.0.0.1:${port}/healthz`, { headers: { connection: 'close' } })).status, 200);
  checks.push('390px mobile has no overflow and reachable actions; cleared key is unavailable without blocking console or making model calls');
  assert.deepEqual(errors, []); assert.deepEqual(unexpectedCalls, []); assert.deepEqual(unexpectedProtocol, []);
  const result = { evidence, checks, layout, errors, requests, externalNetworkCalls: 0, qqSends: 0 };
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  fs.writeFileSync(path.join(evidence, 'failure.json'), JSON.stringify({ message: error.message, checks, errors, requests, unexpectedCalls, unexpectedProtocol }, null, 2));
  console.error(`Browser evidence: ${evidence}`);
  throw error;
} finally {
  try {
    for (const task of pending.values()) clearTimeout(task.timer);
    ws?.close(); await chromeLifecycle?.stop();
  } finally {
    try { if (app) await app.stop(); }
    finally { globalThis.fetch = originalFetch; }
  }
}
