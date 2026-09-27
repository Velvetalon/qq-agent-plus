import crypto from 'node:crypto';
import { embeddingProfileId } from './embedding-client.js';

let sqliteVec = null;
try {
  const { createRequire } = await import('node:module');
  sqliteVec = createRequire(import.meta.url)('sqlite-vec');
} catch {
  sqliteVec = null;
}

const STATUS = Object.freeze(['pending', 'ready', 'failed', 'obsolete']);

function text(value) {
  return value == null ? '' : String(value);
}

function positiveInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function noteContent(note) {
  return text(note?.content ?? note?.body).trim();
}

function noteEmbeddingText(note) {
  const tags = Array.isArray(note?.tags)
    ? note.tags.map(text).filter(Boolean)
    : [];
  return `${tags.join(' ')}\n${noteContent(note)}`.trim();
}

function noteHash(note) {
  return crypto.createHash('sha256').update(noteEmbeddingText(note), 'utf8').digest('hex');
}

function noteMeta(note) {
  return {
    accountId: text(note?.accountId ?? note?.account_id),
    noteId: text(note?.id ?? note?.noteId ?? note?.note_id),
    revision: Number(note?.revision ?? note?.note_revision) || 0,
    scope: text(note?.scope),
    chatKey: text(note?.chatKey ?? note?.chat_key),
    status: text(note?.status || 'active'),
    body: noteContent(note),
    tags: Array.isArray(note?.tags) ? note.tags.map(text) : []
  };
}

function vectorBuffer(values) {
  const data = Float32Array.from(values, Number);
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

export function validateEmbeddingVector(vector, dimension) {
  if (!Array.isArray(vector) && !ArrayBuffer.isView(vector)) {
    return { ok: false, reason: 'embedding-vector-invalid' };
  }
  const values = Array.from(vector, Number);
  if (values.length !== positiveInt(dimension)
    || values.some((value) => !Number.isFinite(value))) {
    return { ok: false, reason: 'embedding-dimension-mismatch' };
  }
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!(norm > 0)) return { ok: false, reason: 'embedding-zero-vector' };
  return { ok: true, values, buffer: vectorBuffer(values) };
}

export function loadSqliteVec(db) {
  if (!db || typeof db.loadExtension !== 'function' || !sqliteVec?.load) {
    return { available: false, reason: 'extension-unavailable', version: '' };
  }
  try {
    sqliteVec.load(db);
    db.enableLoadExtension?.(false);
    const version = text(db.prepare('SELECT vec_version() AS version').get()?.version);
    return {
      available: Boolean(version),
      reason: version ? 'ready' : 'extension-unavailable',
      version
    };
  } catch (error) {
    try { db.enableLoadExtension?.(false); } catch { /* best effort */ }
    return {
      available: false,
      reason: 'extension-unavailable',
      version: '',
      error: text(error?.message || error).slice(0, 200)
    };
  }
}

export function ensureVectorSchema(db, { readOnly = false } = {}) {
  if (!db || readOnly) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS notebook_embeddings (
      account_id TEXT NOT NULL,
      note_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      note_revision INTEGER NOT NULL,
      input_hash TEXT NOT NULL,
      embedding_dimension INTEGER NOT NULL,
      vector BLOB NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','ready','failed','obsolete')),
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(note_id, profile_id, note_revision)
    );
    CREATE INDEX IF NOT EXISTS notebook_embeddings_current
      ON notebook_embeddings(account_id, note_id, profile_id, status, note_revision);
    CREATE TABLE IF NOT EXISTS notebook_embedding_jobs (
      account_id TEXT NOT NULL,
      note_id TEXT NOT NULL,
      note_revision INTEGER NOT NULL,
      input_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','ready','failed','obsolete')),
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(account_id, note_id, note_revision, input_hash)
    );
    CREATE INDEX IF NOT EXISTS notebook_embedding_jobs_pending
      ON notebook_embedding_jobs(status, updated_at, account_id);
  `);
}

export function queueEmbedding(db, note, { now = Date.now } = {}) {
  if (!db || typeof db.prepare !== 'function') return { queued: false, reason: 'no-database' };
  const item = noteMeta(note);
  if (!item.accountId || !item.noteId || item.revision < 1) {
    return { queued: false, reason: 'invalid-note' };
  }
  const timestamp = Math.max(0, Number(typeof now === 'function' ? now() : now) || Date.now());
  const inputHash = noteHash(item);
  db.prepare(`
    UPDATE notebook_embedding_jobs
    SET status='obsolete',updated_at=?,last_error='superseded'
    WHERE account_id=? AND note_id=? AND note_revision<? AND status IN ('pending','ready','failed')
  `).run(timestamp, item.accountId, item.noteId, item.revision);
  db.prepare(`
    UPDATE notebook_embeddings
    SET status='obsolete',updated_at=?,last_error='superseded'
    WHERE account_id=? AND note_id=? AND note_revision<? AND status IN ('pending','ready','failed')
  `).run(timestamp, item.accountId, item.noteId, item.revision);
  if (item.status !== 'active') {
    db.prepare(`
      UPDATE notebook_embedding_jobs
      SET status='obsolete',updated_at=?,last_error='note-not-active'
      WHERE account_id=? AND note_id=? AND note_revision=?
    `).run(timestamp, item.accountId, item.noteId, item.revision);
    return { queued: false, reason: 'note-not-active', inputHash };
  }
  db.prepare(`
    INSERT INTO notebook_embedding_jobs (
      account_id,note_id,note_revision,input_hash,status,attempts,last_error,created_at,updated_at
    ) VALUES (?,?,?,?, 'pending',0,'',?,?)
    ON CONFLICT(account_id,note_id,note_revision,input_hash)
    DO UPDATE SET status='pending',last_error='',updated_at=?
  `).run(
    item.accountId,
    item.noteId,
    item.revision,
    inputHash,
    timestamp,
    timestamp,
    timestamp
  );
  return { queued: true, inputHash, noteId: item.noteId, revision: item.revision };
}

export function obsoleteEmbedding(db, {
  accountId,
  noteId,
  revision = 0,
  now = Date.now
} = {}) {
  if (!db || !accountId || !noteId) return;
  const timestamp = Math.max(0, Number(typeof now === 'function' ? now() : now) || Date.now());
  db.prepare(`
    UPDATE notebook_embedding_jobs
    SET status='obsolete',updated_at=?,last_error='note-invalidated'
    WHERE account_id=? AND note_id=? AND note_revision<=?
  `).run(timestamp, text(accountId), text(noteId), Math.max(0, Number(revision) || 0));
  db.prepare(`
    UPDATE notebook_embeddings
    SET status='obsolete',updated_at=?,last_error='note-invalidated'
    WHERE account_id=? AND note_id=? AND note_revision<=?
  `).run(timestamp, text(accountId), text(noteId), Math.max(0, Number(revision) || 0));
}

export class VectorMemory {
  constructor({
    db,
    config = {},
    embeddingClient = null,
    now = () => Date.now(),
    readOnly = false
  } = {}) {
    if (!db || typeof db.prepare !== 'function') throw new TypeError('sqlite database is required');
    this.db = db;
    this.config = config && typeof config === 'object' ? { ...config } : {};
    this.embeddingClient = embeddingClient;
    this.now = typeof now === 'function' ? now : () => Date.now();
    this.readOnly = readOnly === true;
    this.extension = loadSqliteVec(db);
    if (!this.readOnly) ensureVectorSchema(db);
    this.schemaAvailable = this.#hasSchema();
  }

  configure({ config = this.config, embeddingClient = this.embeddingClient } = {}) {
    this.config = config && typeof config === 'object' ? { ...config } : {};
    this.embeddingClient = embeddingClient;
    return this;
  }

  get profileId() {
    return embeddingProfileId(this.config);
  }

  status() {
    const configured = this.config?.enabled === true
      && Boolean(this.config?.provider)
      && Boolean(this.config?.model)
      && positiveInt(this.config?.dimension) > 0
      && Boolean(this.embeddingClient);
    const stats = this.schemaAvailable ? this.db.prepare(`
      SELECT
        SUM(status='ready') AS ready,
        SUM(status='pending') AS pending,
        SUM(status='failed') AS failed,
        SUM(status='obsolete') AS obsolete,
        COUNT(*) AS total
      FROM notebook_embeddings
      WHERE profile_id=?
    `).get(this.profileId) || {} : {};
    return {
      extension: structuredClone(this.extension),
      configured: configured && this.schemaAvailable,
      reason: !this.schemaAvailable
        ? 'vector-schema-unavailable'
        : !this.extension.available
        ? 'extension-unavailable'
        : !configured
          ? 'embedding-not-configured'
          : 'ready',
      profileId: this.profileId,
      stats: {
        ready: Number(stats.ready) || 0,
        pending: Number(stats.pending) || 0,
        failed: Number(stats.failed) || 0,
        obsolete: Number(stats.obsolete) || 0,
        total: Number(stats.total) || 0
      }
    };
  }

  async processPending({ limit = 8, signal = null } = {}) {
    if (this.readOnly) return { processed: 0, reason: 'read-only' };
    const status = this.status();
    if (status.reason !== 'ready') return { processed: 0, reason: status.reason };
    const rows = this.db.prepare(`
      SELECT * FROM notebook_embedding_jobs
      WHERE status='pending'
      ORDER BY updated_at ASC,account_id,note_id
      LIMIT ?
    `).all(Math.max(1, Math.min(64, Number(limit) || 8)));
    let processed = 0;
    for (const job of rows) {
      if (signal?.aborted) break;
      const note = this.db.prepare(`
        SELECT * FROM notebook_notes WHERE account_id=? AND id=?
      `).get(job.account_id, job.note_id);
      if (!note || note.status !== 'active' || Number(note.revision) !== Number(job.note_revision)) {
        this.#markJob(job, 'obsolete', 'stale-note');
        continue;
      }
      let noteTags = [];
      try {
        const parsed = JSON.parse(String(note.tags_json || '[]'));
        noteTags = Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : [];
      } catch {
        noteTags = [];
      }
      const content = noteEmbeddingText({ body: note.body, tags: noteTags });
      try {
        const vector = await this.embeddingClient.embedNote({
          note: {
            id: note.id,
            accountId: note.account_id,
            scope: note.scope,
            chatKey: note.chat_key,
            revision: note.revision,
            content: note.body,
            tags: noteTags
          },
          text: content,
          signal
        });
        const checked = validateEmbeddingVector(vector, this.config.dimension);
        if (!checked.ok) throw Object.assign(new Error(checked.reason), { code: checked.reason });
        const current = this.db.prepare(`
          SELECT revision,status,body,tags_json FROM notebook_notes WHERE account_id=? AND id=?
        `).get(job.account_id, job.note_id);
        let currentTags = [];
        try {
          const parsed = JSON.parse(String(current.tags_json || '[]'));
          currentTags = Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : [];
        } catch {
          currentTags = [];
        }
        if (!current || current.status !== 'active'
          || Number(current.revision) !== Number(job.note_revision)
          || noteHash({ content: current.body, tags: currentTags }) !== String(job.input_hash)) {
          this.#markJob(job, 'obsolete', 'stale-note');
          continue;
        }
        const timestamp = Math.max(0, Number(this.now()) || Date.now());
        this.db.exec('BEGIN IMMEDIATE');
        try {
          this.db.prepare(`
            INSERT INTO notebook_embeddings (
              account_id,note_id,profile_id,note_revision,input_hash,embedding_dimension,
              vector,status,attempts,last_error,created_at,updated_at
            ) VALUES (?,?,?,?,?,?,?,'ready',?,?,?,?)
            ON CONFLICT(note_id,profile_id,note_revision)
            DO UPDATE SET input_hash=excluded.input_hash,embedding_dimension=excluded.embedding_dimension,
              vector=excluded.vector,status='ready',attempts=excluded.attempts,last_error='',
              updated_at=excluded.updated_at
          `).run(
            job.account_id,
            job.note_id,
            this.profileId,
            job.note_revision,
            job.input_hash,
            this.config.dimension,
            checked.buffer,
            Number(job.attempts) + 1,
            '',
            timestamp,
            timestamp
          );
          this.db.prepare(`
            UPDATE notebook_embedding_jobs
            SET status='ready',attempts=attempts+1,last_error='',updated_at=?
            WHERE account_id=? AND note_id=? AND note_revision=? AND input_hash=? AND status='pending'
          `).run(timestamp, job.account_id, job.note_id, job.note_revision, job.input_hash);
          this.db.exec('COMMIT');
        } catch (error) {
          try { this.db.exec('ROLLBACK'); } catch { /* preserve original */ }
          throw error;
        }
        processed += 1;
      } catch (error) {
        this.#markJob(job, 'failed', text(error?.code || error?.message || error).slice(0, 200));
      }
    }
    return { processed, reason: null, profileId: this.profileId };
  }

  async search({
    accountId,
    chatKey,
    query,
    scope = '',
    tags = [],
    maxNotes = 5,
    maxChars = 2400,
    maxSnippetChars = 600,
    signal = null
  } = {}) {
    const status = this.status();
    const normalizedQuery = text(query).trim();
    if (!normalizedQuery) {
      return {
        results: [],
        contextBlocks: [],
        degradationReason: 'empty-query',
        degradationReasons: ['empty-query'],
        budget: { maxNotes, maxChars, maxSnippetChars, usedNotes: 0, usedChars: 0, truncated: false },
        diagnostics: { candidateCount: 0, matchCount: 0 }
      };
    }
    if (status.reason !== 'ready') {
      return {
        results: [],
        contextBlocks: [],
        degradationReason: status.reason,
        degradationReasons: [status.reason],
        budget: { maxNotes, maxChars, maxSnippetChars, usedNotes: 0, usedChars: 0, truncated: false },
        diagnostics: { candidateCount: 0, matchCount: 0 }
      };
    }
    const vector = await this.embeddingClient.embedQuery({ query: normalizedQuery, signal });
    const checked = validateEmbeddingVector(vector, this.config.dimension);
    if (!checked.ok) {
      return {
        results: [],
        contextBlocks: [],
        degradationReason: checked.reason,
        degradationReasons: [checked.reason],
        budget: { maxNotes, maxChars, maxSnippetChars, usedNotes: 0, usedChars: 0, truncated: false },
        diagnostics: { candidateCount: 0, matchCount: 0 }
      };
    }
    const filters = [
      "n.account_id=?",
      "n.status='active'",
      "e.status='ready'",
      "e.profile_id=?",
      "(n.scope='global' OR (n.scope='chat' AND n.chat_key=?))"
    ];
    const params = [text(accountId), this.profileId, text(chatKey)];
    if (scope === 'global') {
      filters.push("n.scope='global'");
    } else if (scope === 'chat') {
      filters.push("n.scope='chat'");
    }
    for (const tag of (Array.isArray(tags) ? tags : [])) {
      filters.push("n.tags_json LIKE ? ESCAPE '\\'");
      params.push(`%${text(tag).replace(/[\\%_]/g, (value) => `\\${value}`)}%`);
    }
    const current = this.db.prepare(`
      SELECT n.*, e.note_revision, e.input_hash, e.profile_id,
        vec_distance_cosine(e.vector, ?) AS distance
      FROM notebook_notes n
      JOIN notebook_embeddings e
        ON e.account_id=n.account_id AND e.note_id=n.id AND e.note_revision=n.revision
      WHERE ${filters.join(' AND ')}
      ORDER BY distance ASC, n.updated_at DESC, n.id ASC
      LIMIT ?
    `).all(
      checked.buffer,
      ...params,
      Math.max(1, Math.min(100, Number(maxNotes) || 5))
    );
    const budget = {
      maxNotes: Math.max(0, Number(maxNotes) || 5),
      maxChars: Math.max(0, Number(maxChars) || 2400),
      maxSnippetChars: Math.max(0, Number(maxSnippetChars) || 600),
      usedNotes: 0,
      usedChars: 0,
      truncated: false
    };
    const results = [];
    for (const row of current) {
      if (results.length >= budget.maxNotes || budget.usedChars >= budget.maxChars) {
        budget.truncated = true;
        break;
      }
      const remaining = budget.maxChars - budget.usedChars;
      const snippet = text(row.body).slice(0, Math.min(budget.maxSnippetChars, remaining));
      if (!snippet) continue;
      const distance = Number(row.distance);
      if (!Number.isFinite(distance) || distance >= 1) continue;
      const item = {
        noteId: text(row.id),
        revision: Number(row.revision) || 0,
        noteRevision: Number(row.note_revision) || 0,
        snippet,
        distance,
        score: Math.max(0, 1 - distance),
        rankingSource: 'sqlite-vec',
        rankingSources: ['sqlite-vec'],
        budget: {
          maxChars: budget.maxChars,
          usedChars: snippet.length,
          remainingChars: Math.max(0, remaining - snippet.length)
        }
      };
      budget.usedNotes += 1;
      budget.usedChars += snippet.length;
      results.push(item);
    }
    return {
      results,
      hits: results,
      contextBlocks: results.map((item) => ({
        noteId: item.noteId,
        revision: item.revision,
        snippet: item.snippet,
        rankingSource: 'sqlite-vec',
        budget: item.budget,
        degradationReason: null
      })),
      budget,
      degradationReason: results.length ? null : 'no-matches',
      degradationReasons: results.length ? [] : ['no-matches'],
      diagnostics: {
        candidateCount: current.length,
        matchCount: results.length,
        profileId: this.profileId,
        extensionVersion: this.extension.version
      }
    };
  }

  #markJob(job, status, error = '') {
    if (!STATUS.includes(status)) return;
    const timestamp = Math.max(0, Number(this.now()) || Date.now());
    this.db.prepare(`
      UPDATE notebook_embedding_jobs
      SET status=?,attempts=attempts+1,last_error=?,updated_at=?
      WHERE account_id=? AND note_id=? AND note_revision=? AND input_hash=?
    `).run(
      status,
      text(error).slice(0, 200),
      timestamp,
      job.account_id,
      job.note_id,
      job.note_revision,
      job.input_hash
    );
  }

  #hasSchema() {
    try {
      const names = this.db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name IN ('notebook_embeddings','notebook_embedding_jobs')
      `).all().map((row) => text(row.name));
      return names.includes('notebook_embeddings') && names.includes('notebook_embedding_jobs');
    } catch {
      return false;
    }
  }
}

export function createVectorMemory(options = {}) {
  return new VectorMemory(options);
}
