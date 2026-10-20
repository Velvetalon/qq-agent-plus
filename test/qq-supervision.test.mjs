import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installQQSupervision, verifyQQSupervision } from '../scripts/qq-supervision.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-supervision-assets-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return path.join(folder, 'qq-supervision');
}

test('QQ supervision assets install atomically and remain unchanged on repeat', (t) => {
  const target = fixture(t);
  const first = installQQSupervision(target);
  assert.equal(first.changed, true);
  assert.deepEqual(verifyQQSupervision(target).files, first.files);
  const before = fs.statSync(path.join(target, 'qq-supervisor.py')).mtimeMs;
  assert.equal(installQQSupervision(target).changed, false);
  assert.equal(fs.statSync(path.join(target, 'qq-supervisor.py')).mtimeMs, before);
  assert.match(fs.readFileSync(path.join(target, 'qq-supervisor.conf'), 'utf8'), /^\[program:qq\]$/m);
});

test('QQ supervision refuses drift instead of silently replacing operator changes', (t) => {
  const target = fixture(t);
  installQQSupervision(target);
  const file = path.join(target, 'qq-supervisor.py');
  fs.appendFileSync(file, '\n# external change\n');
  const before = fs.readFileSync(file);
  assert.throws(() => verifyQQSupervision(target), /changed outside deployment/);
  assert.throws(() => installQQSupervision(target), /changed outside deployment/);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(fs.existsSync(path.join(target, '.install.lock')), false);
});

test('QQ supervision refuses partial unowned assets', (t) => {
  const target = fixture(t);
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'qq-supervisor.py'), '# unmanaged\n');
  assert.throws(() => installQQSupervision(target));
  assert.equal(fs.readFileSync(path.join(target, 'qq-supervisor.py'), 'utf8'), '# unmanaged\n');
});

test('QQ supervision does not install through a symlink directory', { skip: process.platform === 'win32' }, (t) => {
  const target = fixture(t);
  const other = `${target}-other`;
  fs.mkdirSync(other);
  fs.symlinkSync(other, target);
  assert.throws(() => installQQSupervision(target), /symlink/);
  assert.deepEqual(fs.readdirSync(other), []);
});

test('full-stack deployment persists the guard without replacing data volumes', () => {
  const source = fs.readFileSync(path.join(repo, 'deploy-all.sh'), 'utf8');
  assert.match(source, /SNOWLUMA_EXTRA_QQ_HOMES: ""/);
  assert.match(source, /qq-supervisor\.py:\/opt\/qq-agent\/qq-supervisor\.py:ro/);
  assert.match(source, /qq-supervisor\.conf:\/etc\/supervisor\/conf\.d\/qq-agent-single-instance\.conf:ro/);
  assert.ok(source.indexOf('scripts/qq-supervision.mjs') < source.indexOf("step 'Starting SnowLuma and OneBot'"));
  for (const mount of ['./data:/app/data', './client-config:/app/.config', './client-data:/app/.local/share']) {
    assert.ok(source.includes(mount));
  }
});
