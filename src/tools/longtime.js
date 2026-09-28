import { extractMediaFromSegments } from '../onebot/onebot.js';
import { safeFetchBinary, validateImageUrl } from '../llm/safe-fetch.js';
import { downloadImageAsDataUrl } from './tools-core.js';

export const LONGTIME_COMMAND = '#龙time';
export const LONGTIME_TAG = '龙图';

function text(value) {
  return value == null ? '' : String(value);
}

function normalizeMessageId(value) {
  return text(value).trim().replace(/^#+/, '');
}

function imageMedia(entry) {
  return (Array.isArray(entry?.media) ? entry.media : [])
    .filter((item) => item?.kind === 'image' && item.url);
}

function ok(payload) {
  return { content: JSON.stringify(payload) };
}

function err(message) {
  return { content: `错误：${message}`, isError: true, reportIncident: false };
}

function exactCommand(entry) {
  return text(entry?.text).trim() === LONGTIME_COMMAND;
}

function containsCommand(entry) {
  return text(entry?.text).includes(LONGTIME_COMMAND);
}

function findEntry(triggerEntries, messageId) {
  const wanted = normalizeMessageId(messageId);
  const list = Array.isArray(triggerEntries) ? triggerEntries : [];
  if (wanted) {
    return list.find((entry) => String(entry?.mid) === wanted)
      || list.find((entry) => String(entry?.id) === wanted)
      || null;
  }
  const matches = list.filter(containsCommand);
  return matches.length === 1 ? matches[0] : null;
}

async function freshMedia(entry, onebot) {
  const stored = imageMedia(entry);
  if (!stored.length || typeof onebot?.getMsg !== 'function') return stored;
  try {
    const data = await onebot.getMsg(Number(entry.mid));
    const refreshed = extractMediaFromSegments(data?.message || [])
      .filter((item) => item?.kind === 'image' && item.url);
    if (!refreshed.length) return stored;
    return stored.map((item, index) => ({ ...item, ...(refreshed[index] || {}) }));
  } catch {
    return stored;
  }
}

async function loadVisionImages(media, signal) {
  const parts = [];
  for (const item of media) {
    try {
      parts.push({
        type: 'image_url',
        image_url: { url: await downloadImageAsDataUrl(item.url, signal) }
      });
    } catch {
      try {
        const safeUrl = await validateImageUrl(item.url);
        const { buffer, contentType } = await safeFetchBinary(safeUrl, 12 * 1024 * 1024, signal);
        const mime = /^image\//.test(text(contentType)) ? text(contentType).split(';')[0] : 'image/jpeg';
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${buffer.toString('base64')}` }
        });
      } catch {
        // A failed image is reported by the caller; do not fabricate a result.
      }
    }
  }
  return parts;
}

async function sendRandomDragon({
  chatKey,
  stickers,
  sender,
  session,
  signal,
  random
}) {
  const synced = await stickers.sync(false);
  const candidates = (Array.isArray(synced?.entries) ? synced.entries : [])
    .filter((entry) => entry?.hidden !== true
      && Array.isArray(entry.tags)
      && entry.tags.includes(LONGTIME_TAG));
  if (!candidates.length) {
    const fallback = '没有可用的龙图。';
    const result = await sender.sendTextBatch(chatKey, [fallback], {
      runId: session.leaseId || session.id,
      signal
    });
    session.sent.push(...result.sent.map((item) => ({
      type: 'text',
      text: item.text,
      at: item.at
    })));
    return ok({ handled: true, action: 'empty', sent: result.sent.length });
  }
  const index = Math.min(
    candidates.length - 1,
    Math.max(0, Math.floor(Math.max(0, Math.min(0.999999, Number(random()) || 0)) * candidates.length))
  );
  const chosen = candidates[index];
  const sticker = await stickers.findForSend(chosen.id);
  if (!sticker?.url) return err('随机龙图没有可发送的图片地址');
  const managedInline = sticker.source === 'manual'
    && Boolean(sticker.localFile)
    && sticker.url.startsWith('base64://');
  if (!managedInline) {
    try {
      await validateImageUrl(sticker.url);
    } catch (error) {
      return err(`随机龙图的图片地址不合法：${error?.message ?? error}`);
    }
  }
  const result = await sender.sendSticker(chatKey, sticker, {
    runId: session.leaseId || session.id,
    signal
  });
  stickers.markUsed(sticker.id, LONGTIME_COMMAND);
  session.sent.push({
    type: 'sticker',
    text: `[表情包:${sticker.desc || sticker.localNote || sticker.id}]`,
    at: new Date().toLocaleTimeString('zh-CN', { hour12: false })
  });
  return ok({
    handled: true,
    action: 'random_sent',
    stickerId: sticker.id,
    messageId: result?.message_id ?? null
  });
}

async function collectDragonImages({
  entry,
  media,
  stickers,
  signal
}) {
  const collected = [];
  const failed = [];
  for (const item of media) {
    try {
      const fileMd5 = text(item.file).replace(/\.[a-z0-9]+$/i, '').toUpperCase();
      const existing = (stickers.entries || []).find((entryItem) => entryItem.hidden !== true
        && ((fileMd5 && text(entryItem.md5).toUpperCase() === fileMd5)
          || (item.url && text(entryItem.url) === text(item.url))));
      if (existing) {
        const tags = [...new Set([...(existing.tags || []), LONGTIME_TAG])];
        const updated = stickers.note(existing.id, {
          tags,
          note: existing.localNote || LONGTIME_TAG
        });
        collected.push({ id: updated?.id || existing.id, existing: true });
        continue;
      }
      let buffer = null;
      if (text(item.url).startsWith('base64://')) {
        buffer = Buffer.from(text(item.url).slice('base64://'.length), 'base64');
      } else {
        const safeUrl = await validateImageUrl(item.url);
        ({ buffer } = await safeFetchBinary(safeUrl, 12 * 1024 * 1024, signal));
      }
      if (!buffer?.length) throw new Error('图片内容为空');
      const saved = stickers.addManual({
        imageBuffer: buffer,
        desc: LONGTIME_TAG,
        localNote: LONGTIME_TAG,
        tags: [LONGTIME_TAG],
        usage: ''
      });
      collected.push({ id: saved.id, existing: false });
    } catch (error) {
      failed.push(text(error?.message || error).slice(0, 120));
    }
  }
  return { collected, failed, messageId: entry.mid };
}

async function sendRejection({
  entry,
  reply,
  chatKey,
  sender,
  session,
  signal
}) {
  const result = await sender.sendTextBatch(chatKey, [reply], {
    runId: session.leaseId || session.id,
    signal,
    replyToMessageId: entry.mid
  });
  session.sent.push(...result.sent.map((item) => ({
    type: 'text',
    text: item.text,
    at: item.at
  })));
  return result;
}

/**
 * Host-owned implementation behind the runtime-control `longtime` tool.
 * The tool only routes validated current-message actions; it never accepts
 * arbitrary chat targets or raw image URLs from the model.
 */
export async function executeLongtimeCommand({
  triggerEntries = [],
  args = {},
  chatKey = '',
  stickers,
  sender,
  onebot,
  session,
  signal = null,
  random = Math.random
} = {}) {
  if (!stickers || !sender || !session) return err('龙time 系统工具尚未装配完整');
  const entry = findEntry(triggerEntries, args.messageId);
  if (!entry) return err('只能处理本次触发消息中明确包含 #龙time 的那一条');
  if (!containsCommand(entry)) return err('当前消息正文不包含字面量 #龙time');

  const media = await freshMedia(entry, onebot);
  const decision = text(args.decision).trim();
  if (!decision) {
    if (!media.length) {
      if (!exactCommand(entry)) {
        return err('无图时只有整条消息恰好为 #龙time 才随机发送龙图');
      }
      return sendRandomDragon({ chatKey, stickers, sender, session, signal, random });
    }
    const imageParts = await loadVisionImages(media, signal);
    if (!imageParts.length) return err('图片获取失败，未执行收藏或发送');
    return {
      content: [
        {
          type: 'text',
          text: '已取出本次 #龙time 投稿图片。请查看图片并再次调用 longtime：明确是龙图传 decision="dragon"；明确不是传 decision="not_dragon" 并给不超过 80 字的 reply；无法确定传 decision="uncertain"。不得拼接其他消息或图片。'
        },
        ...imageParts
      ],
      longtime: {
        messageId: String(entry.mid),
        imageCount: imageParts.length
      }
    };
  }

  if (!['dragon', 'not_dragon', 'uncertain'].includes(decision)) {
    return err('decision 只能是 dragon、not_dragon 或 uncertain');
  }
  if (!media.length) return err('这条消息没有可判断的图片');
  if (decision === 'uncertain') {
    return ok({ handled: true, action: 'uncertain', collected: 0, sent: 0 });
  }
  if (decision === 'dragon') {
    const collected = await collectDragonImages({ entry, media, stickers, signal });
    return ok({
      handled: true,
      action: 'collected',
      collected: collected.collected.length,
      failed: collected.failed,
      messageId: String(entry.mid)
    });
  }

  const reply = text(args.reply).replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!reply) return err('not_dragon 必须提供一句不超过 80 字的短回复');
  const sent = await sendRejection({ entry, reply, chatKey, sender, session, signal });
  return ok({
    handled: true,
    action: 'rejected',
    sent: sent.sent.length,
    messageId: String(entry.mid)
  });
}
