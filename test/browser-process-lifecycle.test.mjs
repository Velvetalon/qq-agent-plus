import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { trackChildProcess } from './browser/child-process-lifecycle.mjs';

function childProcess() {
  const child = new EventEmitter();
  child.pid = 123;
  child.exitCode = null;
  child.signalCode = null;
  child.kills = [];
  child.kill = (signal) => { child.kills.push(signal); return true; };
  return child;
}

test('browser cleanup recognizes a child already terminated by signal', async () => {
  const child = childProcess();
  child.signalCode = 'SIGTRAP';
  const lifecycle = trackChildProcess(child);
  await lifecycle.stop();
  assert.deepEqual(child.kills, []);
  await assert.rejects(lifecycle.waitForFile('/not-created'), /signal=SIGTRAP/);
});

test('browser readiness and cleanup retain an early signal exit', async () => {
  const child = childProcess();
  const lifecycle = trackChildProcess(child);
  child.emit('exit', null, 'SIGTRAP');
  await assert.rejects(lifecycle.waitForFile('/not-created'), /signal=SIGTRAP/);
  await lifecycle.stop();
  assert.deepEqual(child.kills, []);
});

test('browser spawn failure is reported without unhandled errors or hanging cleanup', async () => {
  const child = childProcess();
  child.pid = undefined;
  const lifecycle = trackChildProcess(child);
  child.emit('error', new Error('spawn ENOENT'));
  await assert.rejects(lifecycle.waitForFile('/not-created'), /spawn ENOENT/);
  await lifecycle.stop();
  assert.deepEqual(child.kills, []);
});

test('browser cleanup observes a synchronous exit during SIGTERM', async () => {
  const child = childProcess();
  child.kill = (signal) => { child.kills.push(signal); child.emit('exit', 0, null); return true; };
  await trackChildProcess(child).stop({ timeoutMs: 10 });
  assert.deepEqual(child.kills, ['SIGTERM']);
});

test('browser shutdown escalates once and fails boundedly if no exit occurs', async () => {
  const child = childProcess();
  await assert.rejects(trackChildProcess(child).stop({ timeoutMs: 10 }), /after SIGKILL/);
  assert.deepEqual(child.kills, ['SIGTERM', 'SIGKILL']);
});

test('browser readiness accepts a live ready file and bounds missing readiness', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-browser-lifecycle-'));
  try {
    const ready = path.join(root, 'DevToolsActivePort');
    fs.writeFileSync(ready, '12345');
    const lifecycle = trackChildProcess(childProcess());
    await lifecycle.waitForFile(ready);
    await assert.rejects(lifecycle.waitForFile(path.join(root, 'missing'), { timeoutMs: 10, pollMs: 2 }), /timed out/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test('browser kill error does not masquerade as successful process termination', async () => {
  const child = childProcess();
  child.kill = (signal) => {
    child.kills.push(signal);
    child.emit('error', Object.assign(new Error('kill EPERM'), { code: 'EPERM' }));
    return false;
  };
  const lifecycle = trackChildProcess(child);
  await assert.rejects(lifecycle.stop({ timeoutMs: 10 }), /Cannot send SIGTERM.*EPERM/);
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null);
  assert.deepEqual(child.kills, ['SIGTERM']);
});

test('browser kill refusal without an error event is not reported as success', async () => {
  const child = childProcess();
  child.kill = () => false;
  await assert.rejects(trackChildProcess(child).stop({ timeoutMs: 10 }), /kill returned false/);
});

test('browser runtime error is surfaced but cleanup still terminates the live child', async () => {
  const child = childProcess();
  const lifecycle = trackChildProcess(child);
  child.emit('error', new Error('synthetic runtime error'));
  await assert.rejects(lifecycle.waitForFile('/not-created'), /process error.*synthetic runtime error/);
  child.kill = (signal) => { child.kills.push(signal); child.emit('exit', null, signal); return true; };
  await lifecycle.stop();
  assert.deepEqual(child.kills, ['SIGTERM']);
});
