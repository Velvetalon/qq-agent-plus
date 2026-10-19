import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse } from 'node-html-parser';

const source = fs.readFileSync(new URL('../ui/embedding-settings.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
const initial = () => ({ required: true, state: 'unverified', configured: true, config: {
  enabled: true, provider: 'NanoGPT', baseUrl: 'https://embedding-ui.invalid/v1',
  model: 'Qwen/Qwen3-Embedding-4B', dimension: 2560, hasApiKey: true, allowQuery: true, allowPrivate: false
} });

function harness() {
  let tree = parse('<div></div>');
  const listeners = new WeakMap();
  const hydrate = (node) => {
    if (!node || listeners.has(node)) return node;
    listeners.set(node, new Map());
    node.value = node.getAttribute('value') || '';
    node.checked = node.hasAttribute('checked');
    node.disabled = false;
    node.addEventListener = (name, fn) => listeners.get(node).set(name, fn);
    node.classList.toggle = (name, force) => force ? node.classList.add(name) : node.classList.remove(name);
    return node;
  };
  const box = {
    get innerHTML() { return tree.innerHTML; },
    set innerHTML(html) { tree = parse(html); },
    querySelector: (query) => hydrate(tree.querySelector(query)),
    querySelectorAll: (query) => tree.querySelectorAll(query).map(hydrate)
  };
  const calls = [];
  let apiHandler = async (route) => {
    if (route === '/api/embedding/settings') return structuredClone(initial());
    return { ok: true, dimension: 2560, latencyMs: 5 };
  };
  const context = vm.createContext({ document: { querySelector: () => box }, AbortController,
    api: async (...args) => { calls.push(args); return apiHandler(...args); } });
  vm.runInContext(source, context);
  const click = (id) => listeners.get(box.querySelector('#' + id))?.get('click')?.();
  return { box, calls, context, click, get: (id) => box.querySelector('#' + id),
    setApi: (fn) => { apiHandler = fn; }, load: () => context.loadEmbeddingSettingsPage(), leave: () => context.leaveEmbeddingSettingsPage() };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('permanent independent page and executed form keep secrets masked and cancel without writes', async () => {
  assert.match(index, /data-tab="embedding"/);
  assert.match(index, /id="view-embedding"/);
  assert.match(index, /src="\/embedding-settings.js"/);
  assert.match(main, /if \(name === 'embedding'\) loadEmbeddingSettingsPage\(\)/);
  assert.match(main, /leaveEmbeddingSettingsPage\(\)/);
  const ui = harness();
  await ui.load();
  assert.equal(ui.get('embedding-api-key').getAttribute('type'), 'password');
  assert.equal(ui.get('embedding-api-key').value, '');
  assert.equal(ui.get('embedding-model').value, 'Qwen/Qwen3-Embedding-4B');
  assert.equal(ui.get('embedding-dimension').value, '2560');
  assert.match(ui.box.innerHTML, /已保存密钥：••••••••/);
  ui.get('embedding-model').value = 'discarded-model';
  ui.get('embedding-api-key').value = 'synthetic-secret-draft';
  ui.click('embedding-cancel');
  assert.equal(ui.get('embedding-model').value, 'Qwen/Qwen3-Embedding-4B');
  assert.equal(ui.get('embedding-api-key').value, '');
  assert.equal(ui.calls.length, 1, 'cancel must not save or probe');
  ui.get('embedding-api-key').value = 'synthetic-hidden-on-leave';
  ui.leave();
  assert.equal(ui.box.innerHTML, '');
  await ui.load();
  assert.equal(ui.get('embedding-api-key').value, '');
});

test('executed save owns only embedding fields, prevents repeats, clears key on success and preserves failures for retry', async () => {
  const ui = harness();
  await ui.load();
  let release;
  ui.setApi((_route, options) => new Promise((resolve) => { release = () => {
    const patch = JSON.parse(options.body);
    resolve({ ok: true, ...initial(), config: { ...initial().config, model: patch.model } });
  }; }));
  ui.get('embedding-model').value = 'synthetic-model';
  ui.get('embedding-api-key').value = 'synthetic-secret';
  const saving = ui.click('embedding-save');
  ui.click('embedding-save');
  ui.click('embedding-test');
  ui.click('embedding-cancel');
  assert.equal(ui.calls.length, 2);
  assert.equal(ui.get('embedding-save').disabled, true);
  assert.equal(ui.get('embedding-cancel').disabled, true);
  const [route, options] = ui.calls[1];
  assert.equal(route, '/api/embedding/settings');
  const patch = JSON.parse(options.body);
  assert.equal(patch.apiKey, 'synthetic-secret');
  assert.equal(Object.hasOwn(patch, 'selfEvolution'), false);
  assert.equal(Object.hasOwn(patch, 'api'), false);
  release(); await saving;
  assert.equal(ui.get('embedding-api-key').value, '');
  assert.equal(ui.get('embedding-save').disabled, false);
  assert.match(ui.get('embedding-result').textContent, /已保存/);
  ui.setApi(async () => { throw new Error('合成的格式错误'); });
  ui.get('embedding-model').value = '';
  await ui.click('embedding-save');
  assert.equal(ui.get('embedding-model').value, '');
  assert.match(ui.get('embedding-result').textContent, /保存未确认/);
  assert.equal(ui.get('embedding-save').disabled, false);
  assert.equal(Object.hasOwn(JSON.parse(ui.calls.at(-1)[1].body), 'apiKey'), false, 'blank key must be omitted');
});

test('executed test success/failure is truthful; cancellation and navigation ignore late responses', async () => {
  const ui = harness();
  await ui.load();
  await ui.click('embedding-test');
  assert.match(ui.get('embedding-result').textContent, /测试通过：2560 维/);
  assert.match(ui.get('embedding-result').textContent, /未保存/);
  ui.setApi(async () => ({ ok: false, code: 'EMBEDDING_HTTP', error: '模型网关返回错误' }));
  await ui.click('embedding-test');
  assert.match(ui.get('embedding-result').textContent, /测试失败/);
  let release;
  ui.setApi(() => new Promise((resolve) => { release = resolve; }));
  const pending = ui.click('embedding-test');
  const signal = ui.calls.at(-1)[1].signal;
  ui.click('embedding-test');
  assert.equal(ui.get('embedding-cancel').disabled, false);
  ui.click('embedding-cancel');
  assert.equal(signal.aborted, true);
  assert.match(ui.get('embedding-result').textContent, /测试已取消/);
  release({ ok: true, dimension: 2560, latencyMs: 1 }); await pending;
  assert.match(ui.get('embedding-result').textContent, /测试已取消/);
  const second = ui.click('embedding-test');
  const oldRelease = release;
  ui.leave();
  ui.setApi(async () => initial());
  await ui.load();
  oldRelease({ ok: true, dimension: 2560, latencyMs: 1 }); await second;
  assert.equal(ui.get('embedding-result').textContent, '');
});

test('refresh restores authoritative data; failed initial load has retry and stale load cannot overwrite newer navigation', async () => {
  const ui = harness();
  ui.setApi(async () => { throw new Error('offline'); });
  await ui.load();
  assert.match(ui.box.innerHTML, /加载失败/);
  assert.ok(ui.get('embedding-load-retry'));
  ui.setApi(async () => initial());
  await ui.click('embedding-load-retry');
  ui.get('embedding-model').value = 'unsaved';
  await ui.click('embedding-refresh');
  assert.equal(ui.get('embedding-model').value, 'Qwen/Qwen3-Embedding-4B');
  let release;
  ui.setApi(() => new Promise((resolve) => { release = resolve; }));
  const stale = ui.load();
  ui.leave();
  ui.setApi(async () => ({ ...initial(), config: { ...initial().config, model: 'newer' } }));
  await ui.load();
  release(initial()); await stale; await tick();
  assert.equal(ui.get('embedding-model').value, 'newer');
});
