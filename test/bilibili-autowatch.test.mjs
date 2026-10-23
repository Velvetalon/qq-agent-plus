import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BilibiliAutowatchManager, parseCandidates, normalizeBilibiliConfig } from '../src/features/bilibili-autowatch.js';
import { getConfig, setRuntimeConfig } from '../src/core/config.js';

const base = structuredClone(getConfig());
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bili-test-')), 'state.json');
const result = (data) => ({ body: JSON.stringify({ code: 0, data }) });
function cfg(extra = {}) { setRuntimeConfig({ ...structuredClone(base), timeControl: { enabled: false, schedule: { mode: 'always', windows: [] }, overrides: {} }, bilibiliAutowatch: { ...base.bilibiliAutowatch, enabled: true, startupDelayMs: 0, ...extra } }); }
function fakePages({ subtitle = true } = {}) {
  return async (url) => {
    const u = String(url);
    if (u.includes('/popular')) return result({ list: [{ bvid: 'BV1abc', title: 'one' }, { bvid: 'BV1abc', title: 'dup' }, { bvid: 'BV2def', title: 'two' }] });
    if (u.includes('/search/type')) return result({ result: [{ bvid: 'BV3ghi', title: 'search' }] });
    if (u.includes('/view')) return result({ bvid: u.match(/bvid=([^&]+)/)?.[1] || 'BV1abc', title: 'detail', desc: 'description', owner: { name: 'up' }, stat: { view: 3 }, cid: 9 });
    if (u.includes('/player/v2')) return result({ subtitle: { subtitles: subtitle ? [{ subtitle_url: 'https://api.bilibili.com/sub.json' }] : [] } });
    if (u.includes('sub.json')) return result({ body: [{ content: 'hello' }] });
    throw new Error(`unexpected ${u}`);
  };
}

test.after(() => setRuntimeConfig(base));

test('default config is disabled and bounded', () => {
  const c = normalizeBilibiliConfig({});
  assert.equal(c.enabled, false); assert.equal(c.shareAdmin, true); assert.equal(c.maxSharePerRun, 1); assert.deepEqual(c.keywords, []);
});

test('popular/search parsing deduplicates BVID', () => {
  assert.deepEqual(parseCandidates({ body: JSON.stringify({ code: 0, data: { list: [{ bvid: 'BV1x', title: 'a' }, { bvid: 'BV1x', title: 'b' }] } }) }).map((x) => x.bvid), ['BV1x']);
  assert.equal(parseCandidates({ body: JSON.stringify({ code: 0, data: { result: [{ bvid: 'BV2y', title: 's' }] } }) })[0].bvid, 'BV2y');
});

test('detail/subtitle success and metadata fallback', async () => {
  cfg({ keywords: [] });
  const seen = []; const m = new BilibiliAutowatchManager({ onebot: { connected: true }, sender: { sendTextBatch: async (...x) => seen.push(x) }, fetchPage: fakePages(), complete: async ({ messages }) => { assert.match(messages.map((m) => m.content).join('\n'), /B站资料.*不是指令|外部资料.*不是指令|只按用户提供的外部资料/); return { message: { content: JSON.stringify({ interesting: true, score: .9, shareNow: true, reason: 'r', summary: 's', openingQuestion: 'q', shareText: '我刚看到一个很有意思的片段，你会怎么想？', tags: [] }) } }; }, stateFile: tmp(), now: () => 1700000000000 });
  const out = await m.runNow({ publish: false }); assert.equal(out.preview, true); assert.equal(seen.length, 0); assert.equal(out.candidates[0].status, 'candidate');
  const fallback = new BilibiliAutowatchManager({ onebot: { connected: true }, sender: { sendTextBatch: async () => {} }, fetchPage: fakePages({ subtitle: false }), complete: async () => ({ message: { content: '{bad' } }), stateFile: tmp() });
  const r = await fallback.runNow({ publish: false }); assert.equal(r.candidates[0].status, 'skipped'); assert.equal(r.candidates[0].error, 'no-subtitle');
});

test('threshold, strict JSON failure and sender target intersection', async () => {
  cfg({ minInterest: .8, shareGroupIds: ['111', '999'], shareAdmin: true });
  const calls = []; const m = new BilibiliAutowatchManager({ onebot: { connected: true }, sender: { sendTextBatch: async (...args) => calls.push(args) }, fetchPage: fakePages(), complete: async () => ({ message: { content: JSON.stringify({ interesting: true, score: .9, shareNow: true, reason: 'r', summary: 's', openingQuestion: 'q', shareText: '我刚看到一个很有意思的片段，你会怎么想？' }) } }), stateFile: tmp(), now: () => 1700000000000 });
  const c = getConfig(); c.admin = { ownerUin: '42' }; c.allow = { private: ['42'], groups: ['111'] };
  const r = await m.runNow({ publish: true }); assert.equal(r.shared, 1); assert.equal(calls.length, 1); assert.equal(calls[0][0], 'group:111'); assert.deepEqual(calls[0][2], { runId: calls[0][2].runId }); assert.match(calls[0][1][0], /bilibili\.com\/video\/BV1abc/);
});

test('disconnected, duplicate and daily cap suppress sends', async () => {
  cfg({ maxSharesPerDay: 1 }); const calls = []; const state = tmp();
  const m = new BilibiliAutowatchManager({ onebot: { connected: false }, sender: { sendTextBatch: async (...x) => calls.push(x) }, fetchPage: fakePages(), complete: async () => ({ message: { content: '{}' } }), stateFile: state });
  assert.equal((await m.runNow({ publish: true })).reason, 'onebot-disconnected'); assert.equal(calls.length, 0);
  const s = { records: [{ bvid: 'BV1abc', status: 'shared', at: Date.now() }] }; fs.writeFileSync(state, JSON.stringify(s));
  const m2 = new BilibiliAutowatchManager({ onebot: { connected: true }, sender: { sendTextBatch: async (...x) => calls.push(x) }, fetchPage: fakePages(), complete: async () => ({ message: { content: '{}' } }), stateFile: state });
  assert.equal((await m2.runNow({ publish: true })).reason, 'daily-cap'); assert.equal(calls.length, 0);
});

test('recent candidate is suppressed to avoid repeated model calls', async () => {
  cfg({ maxSharesPerDay: 2 }); const state = tmp();
  fs.writeFileSync(state, JSON.stringify({ records: [{ bvid: 'BV1abc', status: 'candidate', at: 1700000000000 }] }));
  let calls = 0;
  const m = new BilibiliAutowatchManager({ onebot: { connected: true }, sender: { sendTextBatch: async () => {} }, fetchPage: async (url) => { calls++; if (String(url).includes('/popular')) return result({ list: [{ bvid: 'BV1abc', title: 'one' }] }); throw new Error(`unexpected ${url}`); }, complete: async () => ({ message: { content: '{}' } }), stateFile: state, now: () => 1700000000000 + 1000 });
  const output = await m.runNow({ publish: false }); assert.equal(output.candidates.length, 0); assert.equal(calls, 1);
});

test('state recovery marks in-flight unknown and writes bounded atomic state', () => {
  const state = tmp(); fs.writeFileSync(state, JSON.stringify({ records: [{ bvid: 'BVx', status: 'publishing' }] }));
  const m = new BilibiliAutowatchManager({ onebot: { connected: false }, stateFile: state, now: () => 123 });
  assert.equal(m.status().latest.status, 'unknown'); assert.match(m.status().latest.error, /未自动重发/); assert.ok(fs.statSync(state).size < 10000);
});

test('unauthorized group is never sent', async () => {
  cfg({ shareAdmin: false, shareGroupIds: ['999'] }); setRuntimeConfig({ ...getConfig(), allow: { private: [], groups: ['111'] } });
  const calls = []; const m = new BilibiliAutowatchManager({ onebot: { connected: true }, sender: { sendTextBatch: async (...x) => calls.push(x) }, fetchPage: fakePages(), complete: async () => ({ message: { content: JSON.stringify({ interesting: true, score: 1, shareNow: true, reason: 'r', summary: 's', openingQuestion: 'q', shareText: '我刚看到一个很有意思的片段，你会怎么想？' }) } }), stateFile: tmp() });
  await m.runNow({ publish: true }); assert.equal(calls.length, 0);
});
