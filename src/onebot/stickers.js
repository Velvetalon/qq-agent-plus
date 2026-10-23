// 表情包体系（移植自原版 sticker-lib.js）：本地表情知识库 + 搜索 + 提示词摘要。
// QQ 收藏表情（SnowLuma fetch_custom_face_detail）是"源"，本地库是 AI 认知层。
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../core/config.js';
import { sanitizeUserText } from '../core/util.js';

const STICKER_FILE = path.join(DATA_DIR, 'stickers.json');

export function nowIso() {
  return new Date().toISOString();
}

export function normalizeStickerEntry(raw) {
  const entry = raw && typeof raw === 'object' ? raw : {};
  const id = String(entry.id || entry.emoji_id || entry.resId || '').trim();
  if (!id) return null;
  const tags = Array.isArray(entry.tags)
    ? entry.tags.map((t) => String(t ?? '').trim()).filter(Boolean).slice(0, 20)
    : [];
  return {
    id,
    resId: String(entry.resId || entry.emoji_id || id).trim(),
    url: String(entry.url || '').trim(),
    localFile: /^sticker-assets\/[a-z0-9_-]+\.(png|jpe?g|gif|webp)$/i.test(String(entry.localFile || ''))
      ? String(entry.localFile)
      : '',
    md5: String(entry.md5 || '').trim().toUpperCase(),
    srcKey: String(entry.srcKey ?? '').trim(),
    desc: String(entry.desc ?? '').trim(),
    localNote: String(entry.localNote ?? '').trim(),
    tags,
    usage: String(entry.usage ?? '').trim(),
    source: entry.source === 'manual' ? 'manual' : (entry.source === 'ai' ? 'ai' : 'qq'),
    hidden: entry.hidden === true,
    metadataEdited: entry.metadataEdited === true,
    useCount: Math.max(0, Number(entry.useCount) || 0),
    lastUsedAt: Number(entry.lastUsedAt) || 0,
    lastContext: String(entry.lastContext ?? '').slice(0, 200),
    createdAt: String(entry.createdAt || nowIso()),
    updatedAt: String(entry.updatedAt || nowIso())
  };
}

export function loadStickerStore(file = STICKER_FILE, { strict = false } = {}) {
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      if (strict) throw new Error('表情库根节点必须是数组');
      return [];
    }
    return parsed.map(normalizeStickerEntry).filter(Boolean);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    if (strict) {
      throw new Error(`表情库读取失败，已停止写入：${String(error?.message ?? error)}`, {
        cause: error
      });
    }
    return [];
  }
}

export function saveStickerStore(entries, file = STICKER_FILE) {
  // stickers.json 含模型按群友暗示写入的 desc/localNote/tags：与隐私数据同口径（0700/0600）。
  // rename 后显式 chmod：btrfs 上 writeFileSync 的 mode 会丢失（Issue #11）。
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  try { fs.rmSync(tmp, { force: true }); } catch { /* 不存在就算了 */ }
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

export function mergeStickerLibrary(existing, fetched) {
  const out = existing.map(normalizeStickerEntry).filter(Boolean);
  const byId = new Map(out.map((e) => [e.id, e]));
  const fetchedIds = new Set();
  for (const item of Array.isArray(fetched) ? fetched : []) {
    const id = String(item?.emoji_id || item?.resId || item?.id || '').trim();
    if (id) fetchedIds.add(id);
  }
  for (const item of Array.isArray(fetched) ? fetched : []) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.emoji_id || item.resId || item.id || '').trim();
    if (!id) continue;
    const old = byId.get(id);
    const merged = normalizeStickerEntry({
      ...(old || {}),
      id,
      resId: String(item.resId || item.emoji_id || id).trim(),
      url: String(item.url || old?.url || '').trim(),
      md5: String(item.md5 || old?.md5 || '').trim().toUpperCase(),
      desc: old?.metadataEdited
        ? old.desc
        : String(item.desc ?? old?.desc ?? '').trim(),
      localNote: old?.localNote || '',
      tags: old?.tags || [],
      usage: old?.usage || '',
      source: old?.source || 'qq',
      useCount: old?.useCount || 0,
      lastUsedAt: old?.lastUsedAt || 0,
      lastContext: old?.lastContext || '',
      createdAt: old?.createdAt || nowIso(),
      updatedAt: nowIso()
    });
    if (!merged) continue;
    if (!byId.has(id)) {
      out.push(merged);
      byId.set(id, merged);
    } else {
      const idx = out.findIndex((e) => e.id === id);
      if (idx >= 0) out[idx] = merged;
    }
  }
  // 保护：这次一条都没拉到（接口失败/空列表）时不要剪枝——否则 QQ 一抖，本地库连备注一起被清空
  if (!fetchedIds.size) return out;
  // 剪枝只剪"没有任何本地数据"的条目：这次没出现的 QQ 收藏可能是被删了，也可能只是
  // 协议端没把它带回来（分页/上限/响应不全都算）。备注、标签、使用计数是模型自己攒的，
  // 不能因为一次同步就静默丢掉 —— 那种丢失没有任何备份可恢复。
  const hasLocalData = (e) => Boolean(String(e.localNote || e.usage || '').trim())
    || (Array.isArray(e.tags) && e.tags.length > 0)
    || Number(e.useCount) > 0;
  return out.filter((e) => e.source !== 'qq' || e.hidden || fetchedIds.has(e.id) || hasLocalData(e));
}

export function findSticker(entries, ref) {
  const raw = String(ref ?? '').trim();
  if (!raw) return null;
  const md5 = raw.toUpperCase();
  const urlNormalized = raw.replace(/\/+$/, '').replace(/^https?:\/\//i, '');
  const visible = (Array.isArray(entries) ? entries : []).filter((entry) =>
    entry && entry.hidden !== true);
  const direct = visible.find((e) => {
    if (!e) return false;
    if (e.id === raw || e.resId === raw) return true;
    if (e.md5 && e.md5 === md5) return true;
    const eUrl = String(e.url || '').replace(/\/+$/, '').replace(/^https?:\/\//i, '');
    if (eUrl && urlNormalized && (eUrl === urlNormalized || eUrl.includes(urlNormalized) || urlNormalized.includes(eUrl))) return true;
    return false;
  });
  if (direct) return direct;
  const label = raw.toLowerCase();
  const exactLabels = visible.filter((entry) =>
    [entry.desc, entry.localNote].some((value) =>
      String(value || '').trim().toLowerCase() === label));
  if (exactLabels.length === 1) return exactLabels[0];
  // 模糊兜底：模型经常只记得备注里的半句，唯一命中就认它；多处命中仍然要求精确 id
  if (label.length >= 2) {
    const loose = visible.filter((entry) =>
      [entry.desc, entry.localNote, ...(Array.isArray(entry.tags) ? entry.tags : [])].some((value) => {
        const text = String(value || '').trim().toLowerCase();
        return text.length > 0 && (text.includes(label) || label.includes(text));
      }));
    if (loose.length === 1) return loose[0];
  }
  return null;
}

export function formatStickerList(entries, query = '', limit = 48) {
  const list = (Array.isArray(entries) ? entries : [])
    .map(normalizeStickerEntry)
    .filter((entry) => entry && !entry.hidden);
  const q = String(query ?? '').trim().toLowerCase();
  const filtered = q
    ? list.filter((e) => {
        const haystack = [e.desc, e.localNote, e.usage, e.id, e.resId, e.md5, ...(e.tags || [])].join(' ').toLowerCase();
        return haystack.includes(q);
      })
    : list;
  const max = Math.max(1, Math.min(500, Number(limit) || 48));
  const items = filtered.slice(0, max).map((e) => ({
    id: e.id,
    // list_stickers 的输出会回传给模型（与 buildStickerContext 同一条注入通道），同口径清洗。
    desc: sanitizeUserText(e.desc || ''),
    localNote: sanitizeUserText(e.localNote || ''),
    tags: (e.tags || []).map((t) => sanitizeUserText(t)),
    useCount: e.useCount || 0
  }));
  return { total: list.length, matched: filtered.length, truncated: filtered.length > max, stickers: items };
}

/** 提示词里的【可用表情包】摘要（不暴露完整 URL，控制上下文体积）。 */
export function buildStickerContext(entries, max = 10) {
  const list = (Array.isArray(entries) ? entries : [])
    .map(normalizeStickerEntry)
    .filter((entry) => entry && !entry.hidden);
  if (!list.length) return '';
  const top = [...list]
    .sort((a, b) => (b.useCount || 0) - (a.useCount || 0) || ((b.desc || b.localNote) ? 1 : 0) - ((a.desc || a.localNote) ? 1 : 0))
    .slice(0, Math.max(1, Math.min(30, Number(max) || 10)));
  const lines = top.map((e) => {
    // 备注/标签由模型按群友暗示写入（sticker_note 工具可写），最终拼进**系统提示**的
    // 【可用表情包】段 —— 不过清洗就是一个可持久化的注入位（写了每轮都在）。
    const label = sanitizeUserText(e.desc || e.localNote || '') || '（无备注，可先看图）';
    const extra = e.tags?.length ? ` [${e.tags.map((t) => sanitizeUserText(t)).join('/')}]` : '';
    const used = e.useCount ? `（用过${e.useCount}次）` : '';
    return `- ${label}${extra}${used}（stickerId：${e.id}）`;
  });
  return `【可用表情包】你的表情库里有 ${list.length} 个表情包（以下是常用/有备注的 ${top.length} 个，完整列表可用 list_stickers 查询）：\n${lines.join('\n')}`;
}

/** 发送前的表情包策略提示（软策略）。 */
export function buildStickerStrategyHint() {
  return [
    '【表情包工具协议】',
    '- 表情包是可选工具；是否使用由当前消息、管理员参与配置和安全判断决定，不规定频率。',
    '- 发送前仅使用库存中可确认的 stickerId；必要时用 list_stickers、get_sticker_image 或 get_message_images 审阅图片和备注。',
    '- 调用 send_sticker 发送；一条表情消息只能包含一个表情，不能与文字混在同一气泡。',
    '- 不在严肃、敏感或隐私内容中使用未经确认的图片；无法确认内容时不发送。'
  ].join('\n');
}

export function applyStickerNote(entries, id, patch = {}) {
  const list = (Array.isArray(entries) ? entries : []).map(normalizeStickerEntry).filter(Boolean);
  const target = findSticker(list, id);
  if (!target) return { entries: list, entry: null };
  const idx = list.findIndex((e) => e.id === target.id);
  // 封顶与 StickerManager.update / 收藏判定的口径一致：这两个字段会原样进系统提示的
  // 表情清单（buildStickerContext 用 desc || localNote 当标签），模型写多长就占多少 token。
  const cap = (value, max) => String(value ?? '').trim().slice(0, max);
  const next = normalizeStickerEntry({
    ...target,
    localNote: patch.note !== undefined ? cap(patch.note, 300) : target.localNote,
    tags: Array.isArray(patch.tags) ? patch.tags.map((s) => cap(s, 40)).filter(Boolean).slice(0, 20) : target.tags,
    usage: patch.usage !== undefined ? cap(patch.usage, 300) : target.usage,
    source: patch.source || target.source || 'ai',
    updatedAt: nowIso()
  });
  if (!next) return { entries: list, entry: null };
  list[idx] = next;
  return { entries: list, entry: next };
}

export function markStickerUsed(entries, id, context = '') {
  const list = (Array.isArray(entries) ? entries : []).map(normalizeStickerEntry).filter(Boolean);
  const target = findSticker(list, id);
  if (!target) return { entries: list, entry: null };
  const idx = list.findIndex((e) => e.id === target.id);
  const next = normalizeStickerEntry({
    ...target,
    useCount: (target.useCount || 0) + 1,
    lastUsedAt: Date.now(),
    lastContext: String(context || '').slice(0, 200),
    updatedAt: nowIso()
  });
  if (!next) return { entries: list, entry: null };
  list[idx] = next;
  return { entries: list, entry: next };
}
