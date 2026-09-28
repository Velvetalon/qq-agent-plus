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
const DEFAULT_MAX_ATTEMPTS = 3;

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
      profile_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('pending','ready','failed','obsolete')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      last_error TEXT NOT NULL DEFAULT '',
      blocked_reason TEXT NOT NULL DEFAULT '',
      available_at INTEGER NOT NULL DEFAULT 0,
      lease_token TEXT NOT NULL DEFAULT '',
      lease_expires_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(account_id, note_id, note_revision, input_hash)
    );
    CREATE INDEX IF NOT EXISTS notebook_embedding_jobs_pending
      ON notebook_embedding_jobs(status, updated_at, account_id);
  `);
  const columns = db.prepare('PRAGMA table_info(notebook_embedding_jobs)').all()
    .map((row) => String(row.name));
  const additions = [
    ['profile_id', "TEXT NOT NULL DEFAULT ''"],
    ['max_attempts', `INTEGER NOT NULL DEFAULT ${DEFAULT_MAX_ATTEMPTS}`],
    ['blocked_reason', "TEXT NOT NULL DEFAULT ''"],
    ['available_at', 'INTEGER NOT NULL DEFAULT 0'],
    ['lease_token', "TEXT NOT NULL DEFAULT ''"],
    ['lease_expires_at', 'INTEGER NOT NULL DEFAULT 0']
  ];
  for (const [name, definition] of additions) {
    if (!columns.includes(name)) db.exec(`ALTER TABLE notebook_embedding_jobs ADD COLUMN ${name} ${definition}`);
  }
}

export function queueEmbedding(db, note, { now = Date.now, profileId = '' } = {}) {
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
      account_id,note_id,note_revision,input_hash,profile_id,status,attempts,max_attempts,
      last_error,blocked_reason,available_at,lease_token,lease_expires_at,created_at,updated_at
    ) VALUES (?,?,?,?,?,'pending',0,?,'','',0,'',0,?,?)
    ON CONFLICT(account_id,note_id,note_revision,input_hash)
    DO UPDATE SET profile_id=excluded.profile_id,status='pending',last_error='',blocked_reason='',
      available_at=excluded.available_at,lease_token='',lease_expires_at=0,updated_at=?
  `).run(
    item.accountId,
    item.noteId,
    item.revision,
    inputHash,
    text(profileId),
    DEFAULT_MAX_ATTEMPTS,
    timestamp,
    timestamp,
    timestamp
  );
  return { queued: true, inputHash, profileId: text(profileId), noteId: item.noteId, revision: item.revision };
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
    this.worker = null;
    this.processing = null;
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
    const clientConfigured = typeof this.embeddingClient?.isConfigured === 'function'
      ? this.embeddingClient.isConfigured() === true
      : Boolean(this.embeddingClient);
    const configured = this.config?.enabled === true
      && Boolean(this.config?.provider)
      && Boolean(this.config?.model)
      && positiveInt(this.config?.dimension) > 0
      && clientConfigured;
    const stats = this.schemaAvailable ? this.db.prepare(`
      SELECT
        SUM(CASE WHEN status='ready' THEN 1 ELSE 0 END) AS ready,
        SUM(CASE WHEN status='pending' AND blocked_reason='' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status='pending' AND blocked_reason<>'' THEN 1 ELSE 0 END) AS blocked,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status='obsolete' THEN 1 ELSE 0 END) AS obsolete,
        COUNT(*) AS total
      FROM notebook_embedding_jobs
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
        blocked: Number(stats.blocked) || 0,
        failed: Number(stats.failed) || 0,
        obsolete: Number(stats.obsolete) || 0,
        total: Number(stats.total) || 0
      }
    };
  }

  async processPending({ limit = 8, signal = null } = {}) {
    if (this.processing) return this.processing;
    this.processing = this.#processPending({ limit, signal })
      .finally(() => { this.processing = null; });
    return this.processing;
  }

  async #processPending({ limit = 8, signal = null } = {}) {
    if (this.readOnly) return { processed: 0, reason: 'read-only' };
    const status = this.status();
    if (status.reason !== 'ready') return { processed: 0, reason: status.reason };
    const profileId = this.profileId;
    const dimension = this.config.dimension;
    const client = this.embeddingClient;
    const rows = this.#claimJobs(Math.max(1, Math.min(64, Number(limit) || 8)));
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
        const vector = await client.embedNote({
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
        const checked = validateEmbeddingVector(vector, dimension);
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
        if (signal?.aborted || String(job.profile_id || '') !== profileId
          || this.profileId !== profileId || this.embeddingClient !== client
          || !current || current.status !== 'active'
          || Number(current.revision) !== Number(job.note_revision)
          || noteHash({ content: current.body, tags: currentTags }) !== String(job.input_hash)) {
          this.#markJob(job, 'obsolete', 'stale-note');
          continue;
        }
        const timestamp = Math.max(0, Number(this.now()) || Date.now());
        this.db.exec('BEGIN IMMEDIATE');
        try {
          const stillOwned = this.db.prepare(`
            SELECT 1 AS present FROM notebook_embedding_jobs
            WHERE account_id=? AND note_id=? AND note_revision=? AND input_hash=?
              AND profile_id=? AND status='pending' AND lease_token=?
          `).get(job.account_id, job.note_id, job.note_revision, job.input_hash,
            profileId, job.lease_token);
          const stillCurrent = this.db.prepare(`
            SELECT revision,status,body,tags_json FROM notebook_notes WHERE account_id=? AND id=?
          `).get(job.account_id, job.note_id);
          let committedTags = [];
          try { committedTags = JSON.parse(String(stillCurrent?.tags_json || '[]')); } catch { /* stale */ }
          if (!stillOwned || !stillCurrent || stillCurrent.status !== 'active'
            || Number(stillCurrent.revision) !== Number(job.note_revision)
            || noteHash({ content: stillCurrent.body, tags: committedTags }) !== String(job.input_hash)
            || signal?.aborted || this.profileId !== profileId || this.embeddingClient !== client) {
            this.db.exec('ROLLBACK');
            this.#markJob(job, 'obsolete', 'stale-note-or-lease');
            continue;
          }
          const claimed = this.db.prepare(`
            UPDATE notebook_embedding_jobs
            SET status='ready',last_error='',blocked_reason='',
              lease_token='',lease_expires_at=0,available_at=0,updated_at=?
            WHERE account_id=? AND note_id=? AND note_revision=? AND input_hash=?
              AND profile_id=? AND status='pending' AND lease_token=?
          `).run(timestamp, job.account_id, job.note_id, job.note_revision, job.input_hash,
            profileId, job.lease_token).changes;
          if (!claimed) {
            this.db.exec('ROLLBACK');
            continue;
          }
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
            profileId,
            job.note_revision,
            job.input_hash,
            dimension,
            checked.buffer,
            Number(job.attempts),
            '',
            timestamp,
            timestamp
          );
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

  startWorker({ signal = null, resources = null, intervalMs = 1000 } = {}) {
    if (this.readOnly || this.worker || !this.embeddingClient) return false;
    const controller = new AbortController();
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    }
    const worker = { controller, timer: null, running: false, clearTimer: resources?.clearTimer || clearTimeout };
    const schedule = (delay = intervalMs) => {
      if (controller.signal.aborted) return;
      const callback = async () => {
        worker.timer = null;
        if (controller.signal.aborted) return;
        worker.running = true;
        try { await this.processPending({ limit: 1, signal: controller.signal }); } catch { /* status carries the error */ }
        worker.running = false;
        schedule(intervalMs);
      };
      worker.timer = resources?.setTimer
        ? resources.setTimer(callback, delay)
        : setTimeout(callback, delay);
      worker.timer?.unref?.();
    };
    worker.schedule = schedule;
    this.worker = worker;
    schedule(0);
    return true;
  }

  async stopWorker() {
    const worker = this.worker;
    if (!worker) return;
    this.worker = null;
    worker.controller.abort(new Error('embedding worker stopped'));
    if (worker.timer != null) worker.clearTimer(worker.timer);
    while (worker.running || this.processing) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  retryFailed({ limit = 100 } = {}) {
    if (this.readOnly) return { retried: 0, reason: 'read-only' };
    const result = this.db.prepare(`
      UPDATE notebook_embedding_jobs
      SET status='pending',blocked_reason='',last_error='',available_at=?,
        lease_token='',lease_expires_at=0,updated_at=?
      WHERE rowid IN (
        SELECT rowid FROM notebook_embedding_jobs
        WHERE profile_id=? AND status='failed'
        ORDER BY updated_at ASC LIMIT ?
      )
    `).run(this.now(), this.now(), this.profileId, Math.max(1, Math.min(500, Number(limit) || 100)));
    return { retried: result.changes, profileId: this.profileId };
  }

  #claimJobs(limit) {
    const now = Math.max(0, Number(this.now()) || Date.now());
    this.db.prepare(`
      UPDATE notebook_embedding_jobs SET status='failed',last_error='max-attempts',
        blocked_reason='max-attempts',lease_token='',lease_expires_at=0,updated_at=?
      WHERE profile_id=? AND status='pending' AND attempts>=max_attempts
        AND lease_expires_at<=?
    `).run(now, this.profileId, now);
    const rows = this.db.prepare(`
      SELECT * FROM notebook_embedding_jobs
      WHERE status='pending' AND profile_id=? AND available_at<=?
        AND attempts<max_attempts
        AND (lease_token='' OR lease_expires_at<=?)
      ORDER BY updated_at ASC,account_id,note_id
      LIMIT ?
    `).all(this.profileId, now, now, limit);
    const claim = this.db.prepare(`
      UPDATE notebook_embedding_jobs
      SET lease_token=?,lease_expires_at=?,attempts=attempts+1,updated_at=?
      WHERE account_id=? AND note_id=? AND note_revision=? AND input_hash=?
        AND status='pending' AND profile_id=?
        AND (lease_token='' OR lease_expires_at<=?)
    `);
    return rows.filter((job) => {
      const token = crypto.randomUUID();
      const changed = claim.run(
        token, now + 60000, now,
        job.account_id, job.note_id, job.note_revision, job.input_hash,
        this.profileId, now
      ).changes;
      if (!changed) return false;
      job.lease_token = token;
      job.lease_expires_at = now + 60000;
      job.attempts = Number(job.attempts) + 1;
      return true;
    });
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
    const readyCandidate = this.db.prepare(`
      SELECT 1 AS present
      FROM notebook_notes n
      JOIN notebook_embeddings e
        ON e.account_id=n.account_id AND e.note_id=n.id AND e.note_revision=n.revision
      WHERE n.account_id=? AND n.status='active' AND e.status='ready' AND e.profile_id=?
        AND (n.scope='global' OR (n.scope='chat' AND n.chat_key=?))
      LIMIT 1
    `).get(text(accountId), this.profileId, text(chatKey));
    if (!readyCandidate) {
      return {
        results: [],
        contextBlocks: [],
        degradationReason: 'index-not-ready',
        degradationReasons: ['index-not-ready'],
        budget: { maxNotes, maxChars, maxSnippetChars, usedNotes: 0, usedChars: 0, truncated: false },
        diagnostics: { candidateCount: 0, matchCount: 0, profileId: this.profileId }
      };
    }
    if (typeof this.embeddingClient.authorizeQuery === 'function'
      && !(await this.embeddingClient.authorizeQuery())) {
      return {
        results: [],
        contextBlocks: [],
        degradationReason: 'external-disallowed',
        degradationReasons: ['external-disallowed'],
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
    const attempts = Number(job.attempts) || 0;
    const maxAttempts = Math.max(1, Number(job.max_attempts) || DEFAULT_MAX_ATTEMPTS);
    const code = text(error).slice(0, 200);
    const terminal = status === 'obsolete' || attempts >= maxAttempts
      || ['EMBEDDING_RESPONSE_INVALID', 'embedding-dimension-mismatch', 'embedding-zero-vector'].includes(code);
    const nextStatus = status === 'failed' && !terminal ? 'pending' : status;
    const delay = nextStatus === 'pending'
      ? Math.min(60_000, 1000 * (2 ** Math.max(0, attempts)))
      : 0;
    this.db.prepare(`
      UPDATE notebook_embedding_jobs
      SET status=?,attempts=?,last_error=?,blocked_reason=?,available_at=?,
        lease_token='',lease_expires_at=0,updated_at=?
      WHERE account_id=? AND note_id=? AND note_revision=? AND input_hash=?
        AND lease_token=?
    `).run(
      nextStatus,
      attempts,
      code,
      terminal && status === 'failed' ? code : '',
      timestamp + delay,
      timestamp,
      job.account_id,
      job.note_id,
      job.note_revision,
      job.input_hash,
      job.lease_token || ''
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
