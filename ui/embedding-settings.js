'use strict';

// Independent page: never reads or submits the general settings form.
const embeddingSettingsPage = (() => {
  let saved = null;
  let generation = 0;
  let busy = '';
  let controller = null;
  const box = () => document.querySelector('#embedding-settings-page');
  const find = (id) => box()?.querySelector(`#${id}`);
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const labels = { disabled: '未启用，语义召回不可用', unconfigured: '未配置完成，语义召回不可用',
    unverified: '已配置，尚未验证连通性', verified: '连通性与向量维度已验证', degraded: '服务降级，请检查模型网关或索引错误' };

  function message(text, error = false) {
    const el = find('embedding-result');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('context-warning', error);
  }

  function setBusy(value) {
    busy = value;
    box()?.querySelectorAll('input,button').forEach((element) => {
      element.disabled = Boolean(value) && !(element.id === 'embedding-cancel' && value === 'test');
    });
    if (find('embedding-cancel')) find('embedding-cancel').textContent = value === 'test' ? '取消测试' : '取消修改';
  }

  function render() {
    if (!box() || !saved) return;
    const c = saved.config;
    box().innerHTML = `
      <div class="asset-page-head"><div><h3>Embedding 模型设置</h3>
        <p class="muted">必需的语义检索能力 · 独立于聊天模型配置</p></div>
        <button class="btn" type="button" id="embedding-refresh">刷新已保存设置</button></div>
      <p id="embedding-status" role="status">${escape(labels[saved.state] || '状态未知')}。普通聊天与控制台不受影响。</p>
      <p class="hint">${saved.vector ? `向量索引：${escape(saved.vector.reason)} · 就绪 ${Number(saved.vector.stats?.ready) || 0} · 待处理 ${Number(saved.vector.stats?.pending) || 0} · 失败 ${Number(saved.vector.stats?.failed) || 0}。连通性测试不代表笔记已完成索引。` : '当前没有活动索引状态，请检查自我迭代是否运行。连通性测试不代表笔记已完成索引。'}</p>
      <p class="hint">默认使用 NanoGPT 的 Qwen/Qwen3-Embedding-4B（2560 维）。可以使用与 AACS 相同的 Key，但需要在此安全输入；不会读取或回显其他应用的密钥。</p>
      <div class="field"><label><input id="embedding-enabled" type="checkbox" ${c.enabled ? 'checked' : ''}> 启用 Embedding 服务</label></div>
      <div class="field"><label for="embedding-provider">提供商标识</label><input id="embedding-provider" type="text" maxlength="200" value="${escape(c.provider)}"></div>
      <div class="field"><label for="embedding-base-url">模型网关（Base URL）</label><input id="embedding-base-url" type="url" autocomplete="off" value="${escape(c.baseUrl)}" placeholder="https://api.nano-gpt.com/api/v1"><div class="hint">兼容 OpenAI 的 /embeddings 接口；改变网关必须重新输入该网关的 Key，防止旧密钥外泄。</div></div>
      <div class="field"><label for="embedding-api-key">API Key</label><input id="embedding-api-key" type="password" autocomplete="new-password" spellcheck="false" placeholder="${c.hasApiKey ? '已保存（不显示）；留空保持原值' : '尚未保存，请输入 API Key'}"><div class="hint">${c.hasApiKey ? '已保存密钥：••••••••' : '尚未保存密钥'}。不会显示明文，也不会存入浏览器本地存储。</div>
        <label><input id="embedding-clear-key" type="checkbox"> 清除已保存的 API Key（语义召回将不可用）</label></div>
      <div class="field"><label for="embedding-model">模型名称</label><input id="embedding-model" type="text" maxlength="200" value="${escape(c.model)}"></div>
      <div class="field"><label for="embedding-dimension">向量维度</label><input id="embedding-dimension" type="number" min="1" max="16384" step="1" value="${escape(c.dimension)}"><div class="hint">Qwen3-Embedding-4B 固定使用 2560 维；不能混用 8B/4096 的索引。切换模型或网关将隔离旧向量，不自动付费重建历史数据。</div></div>
      <details><summary>高级检索设置</summary><div class="field"><label for="embedding-max-distance">最大余弦距离（严格小于）</label><input id="embedding-max-distance" type="number" min="0" max="2" step="0.001" value="${escape(c.maxDistance ?? 1)}"><div class="hint">新配置默认为 0.5；值越小筛选越严格。小样本校准不代表所有真实对话的语义准确率，旧配置阈值保持不变。修改阈值不会混用或重建向量。</div></div></details>
      <div class="field"><label><input id="embedding-allow-query" type="checkbox" ${c.allowQuery ? 'checked' : ''}> 允许将语义查询发往此模型网关</label>
        <label><input id="embedding-allow-private" type="checkbox" ${c.allowPrivate ? 'checked' : ''}> 允许将会话范围笔记发往此模型网关（包括私聊内容）</label>
        <div class="hint">启用后，笔记索引可能向网关发送全局笔记；会话范围笔记需要上述单独许可。保存不会更改自我迭代/自动检索开关。</div></div>
      <p class="hint">测试仅发送固定公开测试句，可能产生少量费用，不发送笔记或聊天记录。测试草稿不保存；保存不等于测试通过。进程重启后需重新测试连通性。</p>
      <div class="save-bar"><button type="button" class="btn btn-primary" id="embedding-save">保存 Embedding 设置</button>
        <button type="button" class="btn" id="embedding-test">发送一次测试</button>
        <button type="button" class="btn" id="embedding-cancel">取消修改</button></div>
      <p id="embedding-result" role="status" aria-live="polite"></p>`;
    find('embedding-save')?.addEventListener('click', () => submit('save'));
    find('embedding-test')?.addEventListener('click', () => submit('test'));
    find('embedding-cancel')?.addEventListener('click', cancel);
    find('embedding-refresh')?.addEventListener('click', () => load());
    setBusy('');
  }

  function draft() {
    const patch = {
      enabled: find('embedding-enabled').checked,
      provider: find('embedding-provider').value.trim(),
      baseUrl: find('embedding-base-url').value.trim(),
      model: find('embedding-model').value.trim(),
      dimension: Number(find('embedding-dimension').value),
      maxDistance: find('embedding-max-distance').value.trim() === '' ? null : Number(find('embedding-max-distance').value),
      allowQuery: find('embedding-allow-query').checked,
      allowPrivate: find('embedding-allow-private').checked,
      clearApiKey: find('embedding-clear-key').checked
    };
    const key = find('embedding-api-key').value.trim();
    if (key) patch.apiKey = key;
    return patch;
  }

  async function submit(action) {
    if (busy || !saved) return;
    const patch = draft();
    const token = ++generation;
    controller = new AbortController();
    setBusy(action);
    message(action === 'save' ? '正在保存…' : '正在测试…');
    try {
      const result = await api(`/api/embedding/${action === 'save' ? 'settings' : 'test'}`, {
        method: 'POST', body: JSON.stringify(patch), signal: controller.signal
      });
      if (token !== generation) return;
      if (action === 'save') {
        saved = result;
        render();
        message(result.configured ? '已保存。请测试连通性；自我迭代与自动检索开关未改变。' : '已保存，但 Embedding 仍不可用，请启用并补全配置。');
      } else {
        message(result.ok ? `测试通过：${result.dimension} 维，${result.latencyMs} ms。当前草稿未保存。`
          : `测试失败：${result.error || result.code}。未保存任何修改。`, !result.ok);
      }
    } catch (error) {
      if (token !== generation) return;
      message(action === 'save' ? `保存未确认：${error.message}。可刷新检查已保存状态。` : `测试失败：${error.message}。未保存任何修改。`, true);
    } finally {
      if (token === generation) { controller = null; setBusy(''); }
    }
  }

  function cancel() {
    if (busy === 'save') return; // A potentially committed save is not cancellable.
    const wasTesting = busy === 'test';
    generation += 1;
    controller?.abort();
    controller = null;
    render();
    message(wasTesting ? '测试已取消，已恢复已保存设置。已发出的请求可能仍由网关计费。' : '已取消修改，恢复已保存设置。');
  }

  async function load() {
    if (busy === 'save') return;
    controller?.abort();
    controller = new AbortController();
    const token = ++generation;
    setBusy('load');
    if (!saved && box()) box().innerHTML = '<div class="empty-hint">正在加载 Embedding 设置…</div>';
    try {
      const result = await api('/api/embedding/settings', { signal: controller.signal });
      if (token !== generation) return;
      saved = result;
      render();
    } catch (error) {
      if (token !== generation) return;
      if (saved) message(`加载失败：${error.message}。当前显示上次读取的配置。`, true);
      else if (box()) box().innerHTML = `<p class="context-warning">加载失败：${escape(error.message)}</p><button type="button" class="btn" id="embedding-load-retry">重试</button>`;
      find('embedding-load-retry')?.addEventListener('click', () => load());
    } finally {
      if (token === generation) { controller = null; setBusy(''); }
    }
  }

  function leave() {
    generation += 1;
    if (busy !== 'save') controller?.abort();
    controller = null;
    busy = '';
    // Clear password and draft DOM immediately on navigation away.
    if (box()) box().innerHTML = '';
  }
  return { load, leave };
})();

function loadEmbeddingSettingsPage() { return embeddingSettingsPage.load(); }
function leaveEmbeddingSettingsPage() { embeddingSettingsPage.leave(); }
