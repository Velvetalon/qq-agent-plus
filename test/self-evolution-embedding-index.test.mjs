import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { NotebookStore, notebookDatabasePath } from '../src/plugins/self-evolution/notebook-store.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-embedding-index-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

let sequence = 0;
function fixture() {
  const dataDir = path.join(root, `case-${++sequence}`);
  const store = new NotebookStore({
    dataDir,
    filename: notebookDatabasePath(dataDir),
    now: (() => {
      let time = 1000;
      return () => ++time;
    })()
  });
  store.open();
  return store;
}

function insertNote(store, id, body = 'note body') {
  store.db.prepare(`
    INSERT INTO notebook_notes (
      account_id,id,scope,chat_key,body,tags_json,note_type,channel,source_json,
      revision,status,created_at,updated_at,archived_at,operation_id
    ) VALUES ('bot-1',?,'chat','group:100',?,'["t"]','experience','chat','{}',1,'active',1,1,0,'op')
  `).run(id, body);
}

function insertJob(store, noteId, profileId, status) {
  store.db.prepare(`
    INSERT INTO notebook_embedding_jobs (
      account_id,note_id,note_revision,input_hash,profile_id,status,attempts,max_attempts,
      last_error,blocked_reason,available_at,lease_token,lease_expires_at,created_at,updated_at
    ) VALUES ('bot-1',?,1,'hash',?,?,0,3,'','',0,'',0,1,1)
  `).run(noteId, profileId, status);
}

function insertVector(store, noteId, profileId, status) {
  store.db.prepare(`
    INSERT INTO notebook_embeddings (
      account_id,note_id,profile_id,note_revision,input_hash,embedding_dimension,vector,status,
      attempts,last_error,created_at,updated_at
    ) VALUES ('bot-1',?,?,1,'hash',4,X'00000000000000000000000000000000',?,0,'',1,1)
  `).run(noteId, profileId, status);
}

const jobRows = (store) => store.db.prepare(
  'SELECT profile_id,status,COUNT(*) AS n FROM notebook_embedding_jobs GROUP BY profile_id,status'
).all().map((row) => `${row.profile_id || '(empty)'}:${row.status}:${row.n}`).sort();

const vectorRows = (store) => store.db.prepare(
  'SELECT profile_id,status,COUNT(*) AS n FROM notebook_embeddings GROUP BY profile_id,status'
).all().map((row) => `${row.profile_id || '(empty)'}:${row.status}:${row.n}`).sort();

test('purgeEmbeddingIndex 只保留当前 profile 的可用索引', () => {
  const store = fixture();
  try {
    for (const id of ['note-a', 'note-b', 'note-c', 'note-d', 'note-e']) insertNote(store, id);
    insertJob(store, 'note-a', 'profile-current', 'ready');
    insertJob(store, 'note-b', 'profile-current', 'obsolete');
    insertJob(store, 'note-c', 'profile-old', 'pending');
    insertJob(store, 'note-d', 'profile-old', 'obsolete');
    insertJob(store, 'note-e', '', 'pending');
    insertVector(store, 'note-a', 'profile-current', 'ready');
    insertVector(store, 'note-c', 'profile-old', 'ready');
    insertVector(store, 'note-b', 'profile-current', 'obsolete');
    insertVector(store, 'note-d', 'profile-old', 'obsolete');

    const before = jobRows(store);
    const result = store.purgeEmbeddingIndex({ profileId: 'profile-current' });

    assert.equal(result.foreignJobs, 3, '旧 profile 和空 profile 的 job 都要删');
    assert.equal(result.obsoleteJobs, 1, '当前 profile 的 obsolete job 要删');
    assert.equal(result.foreignVectors, 2);
    assert.equal(result.obsoleteVectors, 1);
    assert.deepEqual(jobRows(store), ['profile-current:ready:1']);
    assert.deepEqual(vectorRows(store), ['profile-current:ready:1']);
    assert.notDeepEqual(before, jobRows(store));

    // 正文与版本历史不受影响
    const notes = store.db.prepare('SELECT COUNT(*) AS n FROM notebook_notes').get();
    assert.equal(Number(notes.n), 5);
  } finally {
    store.close();
  }
});

test('purgeEmbeddingIndex 不重新入队，历史笔记不会回到向量库', () => {
  const store = fixture();
  try {
    insertNote(store, 'note-old');
    insertJob(store, 'note-old', 'profile-old', 'pending');
    store.purgeEmbeddingIndex({ profileId: 'profile-current' });
    assert.deepEqual(jobRows(store), []);
    assert.deepEqual(vectorRows(store), []);
  } finally {
    store.close();
  }
});

test('listForCleanup 默认不返回正文，显式请求才给截断摘录', () => {
  const store = fixture();
  try {
    const longBody = 'x'.repeat(800);
    insertNote(store, 'note-long', longBody);
    const metadata = store.listForCleanup({ accountId: 'bot-1' });
    assert.equal(metadata[0].excerpt, undefined);
    assert.equal(metadata[0].body, undefined);

    const withExcerpt = store.listForCleanup({ accountId: 'bot-1', includeExcerpt: true });
    assert.equal(withExcerpt[0].excerpt.length, 600);
    assert.equal(withExcerpt[0].excerptTruncated, true);
    assert.deepEqual(withExcerpt[0].tags, ['t']);
  } finally {
    store.close();
  }
});
