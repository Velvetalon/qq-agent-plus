import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ChatStore } from '../../../src/core/store.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-p8-backup-rehearsal-'));
const sourceDir = path.join(root, 'source');
const restoreDir = path.join(root, 'restore');
const sourceDb = path.join(sourceDir, 'messages.sqlite');
const restoreDb = path.join(restoreDir, 'messages.sqlite');
const suffixes = ['', '-wal', '-shm'];

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

let source;
let restored;
try {
  fs.mkdirSync(restoreDir, { recursive: true });
  source = new ChatStore(0, { dataDir: sourceDir, filename: sourceDb });
  source.appendIncoming('group:8001', { mid: 'p8-backup-1', text: 'backup row one', senderId: '10001' });
  source.appendIncoming('group:8001', { mid: 'p8-backup-2', text: 'backup row two', senderId: '10002' });
  assert.equal(source.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');

  const copied = [];
  for (const suffix of suffixes) {
    const from = `${sourceDb}${suffix}`;
    const to = `${restoreDb}${suffix}`;
    assert.equal(fs.existsSync(from), true, `missing source file ${path.basename(from)}`);
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    copied.push({
      file: path.basename(from),
      bytes: fs.statSync(from).size,
      sha256: digest(from),
      restoredSha256: digest(to)
    });
  }

  restored = new ChatStore(0, { dataDir: restoreDir, filename: restoreDb });
  assert.equal(restored.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(restored.db.prepare('SELECT count(*) AS count FROM messages').get().count, 2);
  assert.equal(restored.findByMid('group:8001', 'p8-backup-1').text, 'backup row one');
  assert.equal(restored.findByMid('group:8001', 'p8-backup-2').text, 'backup row two');

  console.log(JSON.stringify({
    status: 'PASS',
    sourceDir,
    restoreDir,
    copied,
    sourceIntegrity: 'ok',
    restoredIntegrity: 'ok',
    restoredMessageCount: 2
  }, null, 2));
} finally {
  restored?.close();
  source?.close();
  cleanup(root);
}
