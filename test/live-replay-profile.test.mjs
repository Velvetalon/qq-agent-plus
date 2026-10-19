import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readReplayKey } from './live/replay-credentials.mjs';
import { replayProxyOptions } from './live/replay-fetch-options.mjs';
import { LIVE_MODEL, LIVE_THINKING, LIVE_REVIEW_LIMITS } from './live/bounded-chat-transport.mjs';

test('current opt-in replay profile is the exact user-selected chat model', () => {
  assert.equal(LIVE_MODEL, 'deepseek/deepseek-v4.1-flash-1017');
  assert.equal(LIVE_THINKING, 'on');
  assert.deepEqual(LIVE_REVIEW_LIMITS, { maxOutputTokens: 2048, timeoutMs: 45000 });
  assert.ok(LIVE_REVIEW_LIMITS.maxOutputTokens <= 2048);
});

test('replay credentials can be supplied only in process memory without creating a file', () => {
  const env = { QQ_REPLAY_API_KEY: ' synthetic-replay-key\n' };
  assert.equal(readReplayKey(env), 'synthetic-replay-key');
  assert.deepEqual(env, { QQ_REPLAY_API_KEY: ' synthetic-replay-key\n' });
  assert.throws(() => readReplayKey({}), /Explicit replay credential required/);
});

test('existing replay key-file input remains supported and ambiguous sources fail closed', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-replay-key-unit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'synthetic-only.txt');
  fs.writeFileSync(filename, 'synthetic-only-key\n');
  assert.equal(readReplayKey({ QQ_REPLAY_KEY_FILE: filename }), 'synthetic-only-key');
  assert.throws(() => readReplayKey({ QQ_REPLAY_API_KEY: 'synthetic-other', QQ_REPLAY_KEY_FILE: filename }), /not both/);
  assert.throws(() => readReplayKey({ QQ_REPLAY_KEY_FILE: path.join(dir, 'missing') }), /Cannot read/);
});

test('direct replay fetch omits dispatcher while configured proxies retain their exact agent', () => {
  assert.deepEqual(replayProxyOptions(null), {});
  assert.deepEqual(replayProxyOptions(undefined), {});
  const direct = { method: 'POST', ...replayProxyOptions(null) };
  assert.equal(Object.hasOwn(direct, 'dispatcher'), false);
  const dispatcher = { dispatch() {} };
  assert.equal(replayProxyOptions(dispatcher).dispatcher, dispatcher);
});

test('invalid replay credentials fail without echoing their value', () => {
  for (const value of ['', ' \n ', 'synthetic-secret bad-second-value', 'synthetic-secret\nother', null, 123]) {
    assert.throws(() => readReplayKey({ QQ_REPLAY_API_KEY: value }), error => {
      assert.equal(error.message, 'Expected a single nonblank replay credential');
      assert.equal(error.message.includes('synthetic-secret'), false);
      return true;
    });
  }
});
