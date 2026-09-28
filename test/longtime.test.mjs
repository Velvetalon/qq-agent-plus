import assert from 'node:assert/strict';
import test from 'node:test';

import { longtimePlugin } from '../src/plugins/builtin/longtime.js';
import { longtimeTool } from '../src/plugins/builtin/runtime-control-tools.js';
import { createRuntimeControlContext } from '../src/plugins/context.js';
import { executeLongtimeCommand } from '../src/tools/longtime.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function entry(overrides = {}) {
  return {
    id: 7,
    mid: '9001',
    text: '#龙time',
    media: [],
    ...overrides
  };
}

function harness(triggerEntries = [entry()]) {
  const sent = { text: [], stickers: [] };
  const marked = [];
  const entries = [
    { id: 'dragon-a', hidden: false, tags: ['龙图'], source: 'manual', localFile: 'sticker-assets/a.png', url: 'base64://a' },
    { id: 'dragon-b', hidden: false, tags: ['龙图'], source: 'qq', url: 'https://example.com/b.png' },
    { id: 'note-only', hidden: false, tags: ['备用'], url: 'https://example.com/c.png' }
  ];
  const stickers = {
    entries,
    async sync() { return { entries }; },
    async findForSend(id) { return entries.find((item) => item.id === id) || null; },
    note(id, patch = {}) {
      const item = entries.find((value) => value.id === id);
      if (!item) return null;
      if (patch.tags) item.tags = patch.tags;
      if (patch.note) item.localNote = patch.note;
      return item;
    },
    addManual({ imageBuffer, desc, localNote, tags }) {
      const item = {
        id: `manual-${entries.length + 1}`,
        hidden: false,
        source: 'manual',
        localFile: `sticker-assets/manual-${entries.length + 1}.png`,
        url: `base64://${imageBuffer.toString('base64')}`,
        desc,
        localNote,
        tags,
        md5: ''
      };
      entries.push(item);
      return item;
    },
    markUsed(id) { marked.push(id); }
  };
  const sender = {
    async sendSticker(chatKey, sticker, options) {
      sent.stickers.push({ chatKey, sticker, options });
      return { message_id: 'sticker-mid' };
    },
    async sendTextBatch(chatKey, messages, options) {
      sent.text.push({ chatKey, messages, options });
      return {
        sent: messages.map((text) => ({ text, at: 1 }))
      };
    }
  };
  const session = { id: 'session-1', leaseId: 'run-1', sent: [] };
  const execute = (args) => executeLongtimeCommand({
    triggerEntries,
    args,
    chatKey: 'group:1',
    stickers,
    sender,
    onebot: null,
    session,
    signal: null,
    random: () => 0
  });
  return { execute, sent, session, entries, marked };
}

test('longtime is a required system plugin with the #龙time tool', () => {
  const tools = [];
  longtimePlugin.declare({
    addTools(value) { tools.push(...(Array.isArray(value) ? value : [value])); }
  });
  const tool = tools.find((item) => item.name === 'longtime');
  assert.ok(tool);
  assert.equal(longtimePlugin.id, 'longtime');
  assert.equal(longtimePlugin.name, '龙time');
  assert.equal(longtimePlugin.required, true);
  assert.equal(tool.ownerPluginId, 'longtime');
  assert.equal(tool.effect, 'external-write');
  assert.match(tool.description, /#龙time/);
  assert.equal(longtimeTool.parameters.required[0], 'messageId');
});

test('independent #龙time randomly sends only stickers tagged exactly 龙图', async () => {
  const h = harness();
  const result = JSON.parse((await h.execute({ messageId: '9001' })).content);
  assert.deepEqual(result, {
    handled: true,
    action: 'random_sent',
    stickerId: 'dragon-a',
    messageId: 'sticker-mid'
  });
  assert.equal(h.sent.stickers.length, 1);
  assert.equal(h.sent.stickers[0].sticker.id, 'dragon-a');
  assert.deepEqual(h.marked, ['dragon-a']);
  assert.equal(h.sent.text.length, 0);
});

test('image #龙time returns message images, then applies only the model decision', async () => {
  const image = entry({
    media: [{ kind: 'image', url: `base64://${PNG}`, file: 'same.png' }]
  });
  const h = harness([image]);
  const inspected = await h.execute({ messageId: '9001' });
  assert.equal(Array.isArray(inspected.content), true);
  assert.match(inspected.content[0].text, /decision="dragon"/);
  assert.equal(inspected.content.filter((part) => part.type === 'image_url').length, 1);

  const accepted = JSON.parse((await h.execute({
    messageId: '9001',
    decision: 'dragon'
  })).content);
  assert.equal(accepted.action, 'collected');
  assert.equal(accepted.collected, 1);
  assert.equal(h.sent.text.length, 0);
  assert.ok(h.entries.some((item) => item.tags.includes('龙图')));

  const h2 = harness([image]);
  const rejected = JSON.parse((await h2.execute({
    messageId: '9001',
    decision: 'not_dragon',
    reply: '这也叫龙图？'
  })).content);
  assert.equal(rejected.action, 'rejected');
  assert.equal(h2.sent.text.length, 1);
  assert.deepEqual(h2.sent.text[0].messages, ['这也叫龙图？']);
  assert.equal(h2.sent.text[0].options.replyToMessageId, '9001');

  const h3 = harness([image]);
  const uncertain = JSON.parse((await h3.execute({
    messageId: '9001',
    decision: 'uncertain'
  })).content);
  assert.equal(uncertain.action, 'uncertain');
  assert.equal(h3.sent.text.length, 0);
  assert.equal(h3.sent.stickers.length, 0);
});

test('longtime rejects cross-message splicing and malformed decisions', async () => {
  const h = harness([
    entry({ id: 1, mid: '1', text: '#龙time' }),
    entry({ id: 2, mid: '2', text: '[图片]', media: [{ kind: 'image', url: `base64://${PNG}` }] })
  ]);
  const spliced = await h.execute({ messageId: '1', decision: 'dragon' });
  assert.equal(spliced.isError, true);
  const missingReply = await h.execute({
    messageId: '2',
    decision: 'not_dragon'
  });
  assert.equal(missingReply.isError, true);
  const wrongTool = await h.execute({ messageId: '2' });
  assert.equal(wrongTool.isError, true);
});

test('runtime-control facade exposes only the bound longtime host action', async () => {
  let received = null;
  const ctx = createRuntimeControlContext({
    session: { id: 's1', leaseId: 'r1' },
    longtimeCommand: async (args) => {
      received = args;
      return { content: '{"handled":true}' };
    }
  });
  const result = await longtimeTool.execute(ctx, { messageId: '9001' });
  assert.deepEqual(received, { messageId: '9001' });
  assert.equal(result.content, '{"handled":true}');
});
