import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from '../../core/config.js';

export const SELF_EVOLUTION_PLUGIN_ID = 'self-evolution';
export const NOTEBOOK_SCOPES = Object.freeze(['global', 'chat']);
export const NOTEBOOK_STATUSES = Object.freeze(['active', 'archived']);

export const DEFAULT_NOTEBOOK_LIMITS = Object.freeze({
  maxNotes: 10000,
  maxBodyChars: 4000,
  maxTags: 24,
  maxTagChars: 80,
  maxWritesPerRun: 20,
  maxSearchLimit: 100,
  maxHistory: 200
});

export function notebookDatabasePath(dataDir = DATA_DIR) {
  return path.join(dataDir, 'plugins', 'self-evolution', 'state.sqlite');
}

export class NotebookError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'NotebookError';
    this.code = String(code || 'NOTEBOOK_ERROR');
    this.details = details && typeof details === 'object' ? details : {};
    this.httpStatus = this.code === 'NOTEBOOK_NOT_FOUND' ? 404
      : this.code === 'NOTEBOOK_CAS_CONFLICT' || this.code === 'NOTEBOOK_IDEMPOTENCY_CONFLICT' ? 409
        : this.code === 'NOTEBOOK_DISABLED' || this.code === 'NOTEBOOK_READ_ONLY' ? 409
          : 400;
  }
}

function fail(code, message, details = {}) {
  throw new NotebookError(code, message, details);
}

function text(value, field, max = 200) {
  if (typeof value !== 'string') fail('NOTEBOOK_INVALID_ARGUMENT', `${field} 必须是字符串`);
  const result = value.trim();
  if (!result) fail('NOTEBOOK_INVALID_ARGUMENT', `${field} 不能为空`);
  if (result.length > max) {
    fail('NOTEBOOK_LIMIT_EXCEEDED', `${field} 不能超过 ${max} 个字符`, {
      field,
      limit: max,
      actual: result.length
    });
  }
  return result;
}

function optionalText(value, field, max = 200) {
  if (value === undefined || value === null || value === '') return '';
  return text(String(value), field, max);
}

function accountId(value) {
  const result = optionalText(value, 'accountId', 100);
  if (!result || /[\u0000-\u001f\u007f]/.test(result)) {
    fail('NOTEBOOK_INVALID_SOURCE', 'accountId 无效');
  }
  return result;
}

function chatKey(value, { optional = false } = {}) {
  const result = optionalText(value, 'chatKey', 100);
  if (!result && optional) return '';
  if (!/^(group|private):\d+$/.test(result)) {
    fail('NOTEBOOK_INVALID_SOURCE', 'chatKey 必须是 group:<QQ号> 或 private:<QQ号>');
  }
  return result;
}

function scope(value) {
  const result = String(value ?? 'global');
  if (!NOTEBOOK_SCOPES.includes(result)) {
    fail('NOTEBOOK_INVALID_ARGUMENT', 'scope 必须是 global 或 chat');
  }
  return result;
}

function body(value, maxBodyChars) {
  if (typeof value !== 'string') fail('NOTEBOOK_INVALID_ARGUMENT', 'content 必须是字符串');
  if (!value.trim()) fail('NOTEBOOK_INVALID_ARGUMENT', 'content 不能为空');
  if (value.length > maxBodyChars) {
    fail('NOTEBOOK_LIMIT_EXCEEDED', `content 不能超过 ${maxBodyChars} 个字符`, {
      field: 'content',
      limit: maxBodyChars,
      actual: value.length
    });
  }
  return value;
}

function tags(value, limits) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail('NOTEBOOK_INVALID_ARGUMENT', 'tags 必须是字符串数组');
  if (value.length > limits.maxTags) {
    fail('NOTEBOOK_LIMIT_EXCEEDED', `tags 不能超过 ${limits.maxTags} 个`, {
      field: 'tags',
      limit: limits.maxTags,
      actual: value.length
    });
  }
  const result = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string') fail('NOTEBOOK_INVALID_ARGUMENT', 'tags 必须是字符串数组');
    const tag = item.trim();
    if (!tag) fail('NOTEBOOK_INVALID_ARGUMENT', 'tags 不能包含空字符串');
    if (tag.length > limits.maxTagChars) {
      fail('NOTEBOOK_LIMIT_EXCEEDED', `单个 tag 不能超过 ${limits.maxTagChars} 个字符`, {
        field: 'tags',
        limit: limits.maxTagChars,
        actual: tag.length
      });
    }
    if (!seen.has(tag)) {
      seen.add(tag);
      result.push(tag);
    }
  }
  return result;
}

function noteId(value) {
  return text(value, 'noteId', 120);
}

function revision(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) {
    fail('NOTEBOOK_INVALID_ARGUMENT', 'expectedRevision 必须是正整数');
  }
  return result;
}

function idempotencyKey(value) {
  return text(value, 'idempotencyKey', 240);
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    return parsed;
  } catch {
    return fallback;
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort()
      .map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function requestHash(value) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (match) => `\\${match}`);
}

function safeJson(value, fallback = {}) {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
  }
}

function sourceView(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    kind: String(source.kind || ''),
    accountId: String(source.accountId || ''),
    chatKey: String(source.chatKey || ''),
    sessionId: String(source.sessionId || ''),
    runId: String(source.runId || ''),
    toolCallId: String(source.toolCallId || ''),
    actor: String(source.actor || '')
  };
}

function noteView(row) {
  if (!row) return null;
  const tagsValue = parseJson(row.tags_json, []);
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    scope: String(row.scope),
    chatKey: String(row.chat_key || ''),
    body: String(row.body || ''),
    content: String(row.body || ''),
    tags: Array.isArray(tagsValue) ? tagsValue.map(String) : [],
    revision: Number(row.revision) || 0,
    status: String(row.status || 'active'),
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
    archivedAt: Number(row.archived_at) || 0,
    operationId: String(row.operation_id || ''),
    source: sourceView(parseJson(row.source_json, {}))
  };
}

function versionView(row) {
  if (!row) return null;
  const tagsValue = parseJson(row.tags_json, []);
  return {
    noteId: String(row.note_id),
    accountId: String(row.account_id),
    scope: String(row.scope),
    chatKey: String(row.chat_key || ''),
    body: String(row.body || ''),
    content: String(row.body || ''),
    tags: Array.isArray(tagsValue) ? tagsValue.map(String) : [],
    revision: Number(row.revision) || 0,
    status: String(row.status || 'active'),
    operationId: String(row.operation_id || ''),
    source: sourceView(parseJson(row.source_json, {})),
    createdAt: Number(row.created_at) || 0
  };
}

function normalizeLimits(limits = {}) {
  const integer = (key, fallback, min = 1, max = 1000000) => {
    const raw = Number(limits[key]);
    if (!Number.isFinite(raw)) return fallback;
    return Math.min(max, Math.max(min, Math.round(raw)));
  };
  return Object.freeze({
    maxNotes: integer('maxNotes', DEFAULT_NOTEBOOK_LIMITS.maxNotes, 1, 1000000),
    maxBodyChars: integer('maxBodyChars', DEFAULT_NOTEBOOK_LIMITS.maxBodyChars, 1, 1000000),
    maxTags: integer('maxTags', DEFAULT_NOTEBOOK_LIMITS.maxTags, 0, 1000),
    maxTagChars: integer('maxTagChars', DEFAULT_NOTEBOOK_LIMITS.maxTagChars, 1, 10000),
    maxWritesPerRun: integer('maxWritesPerRun', DEFAULT_NOTEBOOK_LIMITS.maxWritesPerRun, 1, 10000),
    maxSearchLimit: integer('maxSearchLimit', DEFAULT_NOTEBOOK_LIMITS.maxSearchLimit, 1, 10000),
    maxHistory: integer('maxHistory', DEFAULT_NOTEBOOK_LIMITS.maxHistory, 1, 10000)
  });
}

export class NotebookStore {
  constructor({
    dataDir = DATA_DIR,
    filename = notebookDatabasePath(dataDir),
    create = true,
    readOnly = false,
    limits = {},
    now = () => Date.now()
  } = {}) {
    this.dataDir = dataDir;
    this.filename = filename;
    this.readOnly = readOnly === true;
    this.limits = normalizeLimits(limits);
    this.now = typeof now === 'function' ? now : () => Date.now();
    this.db = null;
    if (create !== false || fs.existsSync(filename)) this.open({ create: create !== false });
  }

  static openExisting(options = {}) {
    const filename = options.filename || notebookDatabasePath(options.dataDir || DATA_DIR);
    if (!fs.existsSync(filename)) return null;
    return new NotebookStore({ ...options, filename, create: false, readOnly: true });
  }

  get exists() {
    return fs.existsSync(this.filename);
  }

  get openState() {
    return Boolean(this.db);
  }

  open({ create = true } = {}) {
    if (this.db) return this;
    if (this.readOnly && !fs.existsSync(this.filename)) return this;
    if (create && !this.readOnly) {
      fs.mkdirSync(path.dirname(this.filename), { recursive: true, mode: 0o700 });
    }
    if (!fs.existsSync(this.filename) && this.readOnly) return this;
    this.db = this.readOnly
      ? new DatabaseSync(this.filename, { readOnly: true })
      : new DatabaseSync(this.filename);
    if (!this.readOnly) {
      this.db.exec(`
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=FULL;
        PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS notebook_notes (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          scope TEXT NOT NULL CHECK(scope IN ('global','chat')),
          chat_key TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL,
          tags_json TEXT NOT NULL DEFAULT '[]',
          revision INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('active','archived')),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          archived_at INTEGER NOT NULL DEFAULT 0,
          operation_id TEXT NOT NULL,
          source_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS notebook_notes_visibility
          ON notebook_notes(account_id, status, scope, chat_key, updated_at DESC);
        CREATE TABLE IF NOT EXISTS notebook_versions (
          note_id TEXT NOT NULL,
          revision INTEGER NOT NULL,
          account_id TEXT NOT NULL,
          scope TEXT NOT NULL,
          chat_key TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL,
          tags_json TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL,
          operation_id TEXT NOT NULL,
          source_json TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL,
          PRIMARY KEY(note_id, revision)
        );
        CREATE INDEX IF NOT EXISTS notebook_versions_note
          ON notebook_versions(note_id, revision DESC);
        CREATE TABLE IF NOT EXISTS notebook_operations (
          operation_id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          action TEXT NOT NULL,
          note_id TEXT NOT NULL DEFAULT '',
          expected_revision INTEGER NOT NULL DEFAULT 0,
          run_id TEXT NOT NULL DEFAULT '',
          request_hash TEXT NOT NULL,
          request_json TEXT NOT NULL DEFAULT '{}',
          source_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL,
          error_code TEXT NOT NULL DEFAULT '',
          error_message TEXT NOT NULL DEFAULT '',
          result_json TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL,
          UNIQUE(account_id, idempotency_key)
        );
        CREATE INDEX IF NOT EXISTS notebook_operations_run
          ON notebook_operations(account_id, run_id, created_at);
      `);
    } else {
      this.db.exec('PRAGMA busy_timeout=5000;');
    }
    if (!this.readOnly) {
      for (const suffix of ['', '-wal', '-shm']) {
        try { fs.chmodSync(`${this.filename}${suffix}`, 0o600); } catch { /* best effort */ }
      }
    }
    return this;
  }

  close() {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }

  #requireDb() {
    if (!this.db) fail('NOTEBOOK_DISABLED', 'self-evolution Notebook 当前未启用');
    return this.db;
  }

  #requireWritable() {
    const db = this.#requireDb();
    if (this.readOnly) fail('NOTEBOOK_READ_ONLY', 'Notebook 当前仅可读');
    return db;
  }

  #transaction(fn) {
    const db = this.#requireWritable();
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn(db);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* preserve the original error */ }
      throw error;
    }
  }

  #normalizeSource(source, { account, currentChatKey = '', write = false } = {}) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      fail('NOTEBOOK_INVALID_SOURCE', '必须提供经过宿主校验的 source');
    }
    const kind = String(source.kind || '');
    if (!['chat', 'console', 'system'].includes(kind)) {
      fail('NOTEBOOK_INVALID_SOURCE', 'source.kind 必须是 chat、console 或 system');
    }
    if (kind === 'console' && !optionalText(source.actor, 'source.actor', 160)) {
      fail('NOTEBOOK_INVALID_SOURCE', 'console 写入必须显式声明 actor 授权来源');
    }
    if (source.accountId === undefined || source.accountId === null || source.accountId === '') {
      fail('NOTEBOOK_INVALID_SOURCE', 'source.accountId 必须由宿主提供');
    }
    const sourceAccount = accountId(source.accountId);
    if (sourceAccount !== account) {
      fail('NOTEBOOK_INVALID_SOURCE', 'source.accountId 与 accountId 不一致');
    }
    const sourceChat = chatKey(source.chatKey, { optional: true });
    const current = currentChatKey ? chatKey(currentChatKey) : '';
    if (kind === 'chat' && !sourceChat) {
      fail('NOTEBOOK_INVALID_SOURCE', 'chat source 必须包含 chatKey');
    }
    if (kind === 'chat' && current && sourceChat !== current) {
      fail('NOTEBOOK_SCOPE_DENIED', 'source.chatKey 不能超出当前会话');
    }
    if (write && kind === 'chat' && !source.runId && !source.sessionId) {
      fail('NOTEBOOK_INVALID_SOURCE', 'chat 写入必须包含 runId 或 sessionId');
    }
    return {
      kind,
      accountId: sourceAccount,
      chatKey: sourceChat,
      sessionId: optionalText(source.sessionId, 'source.sessionId', 160),
      runId: optionalText(source.runId, 'source.runId', 160),
      toolCallId: optionalText(source.toolCallId, 'source.toolCallId', 160),
      actor: optionalText(source.actor, 'source.actor', 160)
    };
  }

  #sourceIsAdmin(source) {
    return source.kind === 'console' || source.kind === 'system';
  }

  #scopeForWrite(rawScope, rawChatKey, source) {
    if (source.kind === 'chat') {
      if (rawScope !== undefined && rawScope !== null && rawScope !== '') {
        const requested = String(rawScope).trim().toLowerCase();
        if (requested === 'global') {
          fail('NOTEBOOK_SCOPE_DENIED', '聊天模型不能创建 global Notebook');
        }
        if (requested !== 'chat') {
          fail('NOTEBOOK_INVALID_ARGUMENT', 'scope 必须是 global 或 chat');
        }
      }
      const noteChat = chatKey(rawChatKey || source.chatKey);
      if (rawChatKey && noteChat !== source.chatKey) {
        fail('NOTEBOOK_SCOPE_DENIED', 'chat 笔记只能写入当前会话');
      }
      return { scope: 'chat', chatKey: noteChat };
    }
    const noteScope = scope(rawScope);
    if (noteScope === 'global') return { scope: noteScope, chatKey: '' };
    const requestedChat = chatKey(rawChatKey || source.chatKey);
    return { scope: noteScope, chatKey: requestedChat };
  }

  #assertVisible(row, { account, currentChatKey = '', admin = false } = {}) {
    if (!row || String(row.account_id) !== account) {
      fail('NOTEBOOK_NOT_FOUND', '找不到 Notebook 条目');
    }
    if (admin) return;
    const current = currentChatKey ? chatKey(currentChatKey) : '';
    if (row.scope === 'global') return;
    if (!current || row.chat_key !== current) {
      fail('NOTEBOOK_SCOPE_DENIED', 'Notebook 条目不在当前会话可见范围内');
    }
  }

  #operation(db, account, key) {
    return db.prepare(`
      SELECT * FROM notebook_operations
      WHERE account_id=? AND idempotency_key=?
    `).get(account, key);
  }

  #replayOperation(row, hash) {
    if (row.request_hash !== hash) {
      fail('NOTEBOOK_IDEMPOTENCY_CONFLICT', '同一个幂等键不能复用给不同请求', {
        operationId: row.operation_id
      });
    }
    if (row.status === 'succeeded') return parseJson(row.result_json, { saved: true });
    fail(
      row.error_code || 'NOTEBOOK_WRITE_REJECTED',
      row.error_message || 'Notebook 写入被拒绝',
      parseJson(row.result_json, { saved: false })
    );
  }

  #insertOperation(db, {
    operationId,
    account,
    key,
    action,
    noteId: id = '',
    expectedRevision = 0,
    source,
    request,
    hash,
    status,
    result = {},
    error = null,
    createdAt
  }) {
    db.prepare(`
      INSERT INTO notebook_operations (
        operation_id,account_id,idempotency_key,action,note_id,expected_revision,
        run_id,request_hash,request_json,source_json,status,error_code,error_message,
        result_json,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      operationId,
      account,
      key,
      action,
      id,
      Number(expectedRevision) || 0,
      source.runId,
      hash,
      safeJson(request),
      safeJson(source),
      status,
      error?.code || '',
      error?.message || '',
      safeJson(result),
      createdAt
    );
  }

  #checkQuota(db, source, account) {
    if (!source.runId) return;
    const count = Number(db.prepare(`
      SELECT COUNT(*) AS n FROM notebook_operations
      WHERE account_id=? AND run_id=? AND status='succeeded'
    `).get(account, source.runId)?.n) || 0;
    if (count >= this.limits.maxWritesPerRun) {
      fail('NOTEBOOK_WRITE_QUOTA_EXCEEDED', `本次 Run 最多写入 ${this.limits.maxWritesPerRun} 次`, {
        runId: source.runId,
        limit: this.limits.maxWritesPerRun,
        used: count
      });
    }
  }

  #write(action, {
    account: rawAccount,
    source: rawSource,
    currentChatKey = '',
    idempotencyKey: rawKey,
    request,
    noteId: id = '',
    expectedRevision = 0,
      apply
  }) {
    const account = accountId(rawAccount);
    const source = this.#normalizeSource(rawSource, {
      account,
      currentChatKey,
      write: true
    });
    const key = idempotencyKey(rawKey);
    const hash = requestHash(request);
    const operationId = crypto.randomUUID();
    const createdAt = Math.max(0, Number(this.now()) || Date.now());

    const outcome = this.#transaction((db) => {
      const existing = this.#operation(db, account, key);
      if (existing) {
        try {
          return { value: this.#replayOperation(existing, hash) };
        } catch (error) {
          return { error };
        }
      }
      try {
        this.#checkQuota(db, source, account);
        this.#scopeForWrite(request.scope, request.chatKey, source);
        const { scope: noteScope, chatKey: noteChatKey } = this.#scopeForWrite(
          request.scope,
          request.chatKey,
          source
        );
        request.scope = noteScope;
        request.chatKey = noteChatKey;
        const result = apply(db, {
          account,
          source,
          operationId,
          createdAt,
          noteScope,
          noteChatKey
        });
        this.#insertOperation(db, {
          operationId,
          account,
          key,
          action,
          noteId: id,
          expectedRevision,
          source,
          request,
          hash,
          status: 'succeeded',
          result,
          createdAt
        });
        return { value: result };
      } catch (error) {
        const normalized = error instanceof NotebookError
          ? error
          : new NotebookError('NOTEBOOK_WRITE_REJECTED', String(error?.message || error));
        this.#insertOperation(db, {
          operationId,
          account,
          key,
          action,
          noteId: id,
          expectedRevision,
          source,
          request,
          hash,
          status: 'rejected',
          result: { saved: false, errorCode: normalized.code },
          error: normalized,
          createdAt
        });
        return { error: normalized };
      }
    });
    if (outcome?.error) throw outcome.error;
    return outcome.value;
  }

  append({
    accountId: rawAccount,
    scope: rawScope = 'chat',
    chatKey: rawChatKey = '',
    content,
    body: rawBody,
    tags: rawTags,
    source,
    idempotencyKey: rawKey,
    currentChatKey = ''
  } = {}) {
    const account = accountId(rawAccount);
    const sourceViewValue = this.#normalizeSource(source, {
      account,
      currentChatKey,
      write: true
    });
    if (content !== undefined && rawBody !== undefined && content !== rawBody) {
      fail('NOTEBOOK_INVALID_ARGUMENT', 'content 与 body 不能同时指向不同正文');
    }
    const noteBody = body(content !== undefined ? content : rawBody, this.limits.maxBodyChars);
    const noteTags = tags(rawTags, this.limits);
    const request = {
      scope: scope(rawScope),
      chatKey: String(rawChatKey || ''),
      body: noteBody,
      tags: noteTags
    };
    return this.#write('append', {
      account,
      source: sourceViewValue,
      currentChatKey,
      idempotencyKey: rawKey,
      request,
      apply: (db, {
        account: namespace,
        source: normalizedSource,
        operationId,
        createdAt,
        noteScope,
        noteChatKey
      }) => {
        const total = Number(db.prepare(
          'SELECT COUNT(*) AS n FROM notebook_notes WHERE account_id=?'
        ).get(namespace)?.n) || 0;
        if (total >= this.limits.maxNotes) {
          fail('NOTEBOOK_CAPACITY_EXCEEDED', `Notebook 最多保存 ${this.limits.maxNotes} 条`, {
            limit: this.limits.maxNotes,
            used: total
          });
        }
        const id = `note_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
        db.prepare(`
          INSERT INTO notebook_notes (
            id,account_id,scope,chat_key,body,tags_json,revision,status,
            created_at,updated_at,operation_id,source_json
          ) VALUES (?,?,?,?,?,?,1,'active',?,?,?,?)
        `).run(
          id,
          namespace,
          noteScope,
          noteChatKey,
          noteBody,
          safeJson(noteTags, []),
          createdAt,
          createdAt,
          operationId,
          safeJson(normalizedSource)
        );
        db.prepare(`
          INSERT INTO notebook_versions (
            note_id,revision,account_id,scope,chat_key,body,tags_json,status,
            operation_id,source_json,created_at
          ) VALUES (?,?,?,?,?,?,?,'active',?,?,?)
        `).run(
          id,
          1,
          namespace,
          noteScope,
          noteChatKey,
          noteBody,
          safeJson(noteTags, []),
          operationId,
          safeJson(normalizedSource),
          createdAt
        );
        const note = noteView(db.prepare(
          'SELECT * FROM notebook_notes WHERE id=?'
        ).get(id));
        return { saved: true, operationId, note, revision: note.revision };
      }
    });
  }

  update({
    accountId: rawAccount,
    noteId: rawId,
    expectedRevision: rawRevision,
    content,
    body: rawBody,
    tags: rawTags,
    source,
    idempotencyKey: rawKey,
    currentChatKey = ''
  } = {}) {
    const account = accountId(rawAccount);
    const id = noteId(rawId);
    const expected = revision(rawRevision);
    const sourceViewValue = this.#normalizeSource(source, {
      account,
      currentChatKey,
      write: true
    });
    if (content !== undefined && rawBody !== undefined && content !== rawBody) {
      fail('NOTEBOOK_INVALID_ARGUMENT', 'content 与 body 不能同时指向不同正文');
    }
    const hasBody = content !== undefined || rawBody !== undefined;
    const nextBody = hasBody
      ? body(content !== undefined ? content : rawBody, this.limits.maxBodyChars)
      : undefined;
    const nextTags = rawTags === undefined ? undefined : tags(rawTags, this.limits);
    if (!hasBody && nextTags === undefined) {
      fail('NOTEBOOK_INVALID_ARGUMENT', 'update 至少需要 content/body 或 tags');
    }
    const request = {
      noteId: id,
      expectedRevision: expected,
      body: nextBody,
      tags: nextTags
    };
    return this.#write('update', {
      account,
      source: sourceViewValue,
      currentChatKey,
      idempotencyKey: rawKey,
      request,
      noteId: id,
      expectedRevision: expected,
      apply: (db, { account: namespace, source: normalizedSource, operationId, createdAt }) => {
        const current = db.prepare(
          'SELECT * FROM notebook_notes WHERE id=? AND account_id=?'
        ).get(id, namespace);
        this.#assertVisible(current, {
          account: namespace,
          currentChatKey: currentChatKey || normalizedSource.chatKey,
          admin: this.#sourceIsAdmin(normalizedSource)
        });
        if (current.status === 'archived') fail('NOTEBOOK_ARCHIVED', '已归档的 Notebook 不能再修改');
        const actual = Number(current.revision) || 0;
        if (actual !== expected) {
          fail('NOTEBOOK_CAS_CONFLICT', 'Notebook revision 已变化，请基于最新版本重试', {
            noteId: id,
            expectedRevision: expected,
            currentRevision: actual
          });
        }
        const finalBody = nextBody === undefined ? String(current.body) : nextBody;
        const finalTags = nextTags === undefined
          ? (Array.isArray(parseJson(current.tags_json, [])) ? parseJson(current.tags_json, []) : [])
          : nextTags;
        const nextRevision = actual + 1;
        const changed = db.prepare(`
          UPDATE notebook_notes SET body=?,tags_json=?,revision=?,updated_at=?,
            operation_id=?,source_json=?
          WHERE id=? AND account_id=? AND revision=? AND status='active'
        `).run(
          finalBody,
          safeJson(finalTags, []),
          nextRevision,
          createdAt,
          operationId,
          safeJson(normalizedSource),
          id,
          namespace,
          expected
        ).changes;
        if (changed !== 1) {
          fail('NOTEBOOK_CAS_CONFLICT', 'Notebook revision 已变化，请基于最新版本重试', {
            noteId: id,
            expectedRevision: expected,
            currentRevision: Number(db.prepare(
              'SELECT revision FROM notebook_notes WHERE id=?'
            ).get(id)?.revision) || 0
          });
        }
        db.prepare(`
          INSERT INTO notebook_versions (
            note_id,revision,account_id,scope,chat_key,body,tags_json,status,
            operation_id,source_json,created_at
          ) VALUES (?,?,?,?,?,?,?,'active',?,?,?)
        `).run(
          id,
          nextRevision,
          namespace,
          current.scope,
          current.chat_key,
          finalBody,
          safeJson(finalTags, []),
          operationId,
          safeJson(normalizedSource),
          createdAt
        );
        const note = noteView(db.prepare(
          'SELECT * FROM notebook_notes WHERE id=?'
        ).get(id));
        return { saved: true, operationId, note, revision: note.revision };
      }
    });
  }

  archive({
    accountId: rawAccount,
    noteId: rawId,
    expectedRevision: rawRevision,
    source,
    idempotencyKey: rawKey,
    currentChatKey = ''
  } = {}) {
    const account = accountId(rawAccount);
    const id = noteId(rawId);
    const expected = revision(rawRevision);
    const sourceViewValue = this.#normalizeSource(source, {
      account,
      currentChatKey,
      write: true
    });
    const request = { noteId: id, expectedRevision: expected };
    return this.#write('archive', {
      account,
      source: sourceViewValue,
      currentChatKey,
      idempotencyKey: rawKey,
      request,
      noteId: id,
      expectedRevision: expected,
      apply: (db, { account: namespace, source: normalizedSource, operationId, createdAt }) => {
        const current = db.prepare(
          'SELECT * FROM notebook_notes WHERE id=? AND account_id=?'
        ).get(id, namespace);
        this.#assertVisible(current, {
          account: namespace,
          currentChatKey: currentChatKey || normalizedSource.chatKey,
          admin: this.#sourceIsAdmin(normalizedSource)
        });
        if (current.status === 'archived') fail('NOTEBOOK_ARCHIVED', 'Notebook 已经归档');
        const actual = Number(current.revision) || 0;
        if (actual !== expected) {
          fail('NOTEBOOK_CAS_CONFLICT', 'Notebook revision 已变化，请基于最新版本重试', {
            noteId: id,
            expectedRevision: expected,
            currentRevision: actual
          });
        }
        const nextRevision = actual + 1;
        const changed = db.prepare(`
          UPDATE notebook_notes SET status='archived',revision=?,updated_at=?,
            archived_at=?,operation_id=?,source_json=?
          WHERE id=? AND account_id=? AND revision=? AND status='active'
        `).run(
          nextRevision,
          createdAt,
          createdAt,
          operationId,
          safeJson(normalizedSource),
          id,
          namespace,
          expected
        ).changes;
        if (changed !== 1) {
          fail('NOTEBOOK_CAS_CONFLICT', 'Notebook revision 已变化，请基于最新版本重试', {
            noteId: id,
            expectedRevision: expected,
            currentRevision: Number(db.prepare(
              'SELECT revision FROM notebook_notes WHERE id=?'
            ).get(id)?.revision) || 0
          });
        }
        db.prepare(`
          INSERT INTO notebook_versions (
            note_id,revision,account_id,scope,chat_key,body,tags_json,status,
            operation_id,source_json,created_at
          ) VALUES (?,?,?,?,?,?,?,'archived',?,?,?)
        `).run(
          id,
          nextRevision,
          namespace,
          current.scope,
          current.chat_key,
          current.body,
          current.tags_json,
          operationId,
          safeJson(normalizedSource),
          createdAt
        );
        const note = noteView(db.prepare(
          'SELECT * FROM notebook_notes WHERE id=?'
        ).get(id));
        return { saved: true, operationId, note, revision: note.revision };
      }
    });
  }

  get({
    accountId: rawAccount,
    noteId: rawId,
    currentChatKey = '',
    includeArchived = false,
    admin = false
  } = {}) {
    const db = this.#requireDb();
    const account = accountId(rawAccount);
    const id = noteId(rawId);
    const row = db.prepare('SELECT * FROM notebook_notes WHERE id=? AND account_id=?')
      .get(id, account);
    this.#assertVisible(row, { account, currentChatKey, admin });
    if (!includeArchived && row.status !== 'active') return null;
    return noteView(row);
  }

  search({
    accountId: rawAccount,
    currentChatKey = '',
    scope: rawScope = '',
    query = '',
    tags: rawTags,
    limit = 20,
    includeArchived = false,
    admin = false
  } = {}) {
    const db = this.#requireDb();
    const account = accountId(rawAccount);
    const current = currentChatKey ? chatKey(currentChatKey) : '';
    const requestedScope = rawScope ? scope(rawScope) : '';
    if (requestedScope === 'chat' && !current && !admin) {
      fail('NOTEBOOK_SCOPE_DENIED', '当前会话缺少 chat scope');
    }
    const terms = query === undefined || query === null || query === ''
      ? ''
      : text(String(query), 'query', 500);
    const filters = ['account_id=?'];
    const params = [account];
    if (!includeArchived) filters.push("status='active'");
    if (requestedScope) {
      filters.push('scope=?');
      params.push(requestedScope);
    }
    if (!admin && current) {
      filters.push("(scope='global' OR (scope='chat' AND chat_key=?))");
      params.push(current);
    } else if (!admin && !current) {
      filters.push("scope='global'");
    }
    if (terms) {
      filters.push("(body LIKE ? ESCAPE '\\' COLLATE NOCASE OR tags_json LIKE ? ESCAPE '\\' COLLATE NOCASE)");
      const pattern = `%${escapeLike(terms)}%`;
      params.push(pattern, pattern);
    }
    const max = Math.min(this.limits.maxSearchLimit, Math.max(1, Number(limit) || 20));
    const rows = db.prepare(`
      SELECT * FROM notebook_notes
      WHERE ${filters.join(' AND ')}
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `).all(...params, max);
    const requestedTags = rawTags === undefined ? [] : tags(rawTags, this.limits);
    const notes = rows
      .map(noteView)
      .filter((note) => requestedTags.every((tag) => note.tags.includes(tag)));
    return {
      notes,
      count: notes.length,
      scope: requestedScope || (current ? 'global+chat' : 'global'),
      archivedExcluded: includeArchived !== true
    };
  }

  history({
    accountId: rawAccount,
    noteId: rawId,
    currentChatKey = '',
    admin = false,
    limit = this.limits.maxHistory
  } = {}) {
    const db = this.#requireDb();
    const account = accountId(rawAccount);
    const id = noteId(rawId);
    const current = db.prepare('SELECT * FROM notebook_notes WHERE id=? AND account_id=?')
      .get(id, account);
    this.#assertVisible(current, { account, currentChatKey, admin });
    const max = Math.min(this.limits.maxHistory, Math.max(1, Number(limit) || this.limits.maxHistory));
    const versions = db.prepare(`
      SELECT * FROM notebook_versions
      WHERE note_id=? AND account_id=?
      ORDER BY revision DESC
      LIMIT ?
    `).all(id, account, max).map(versionView);
    return { note: noteView(current), versions };
  }

  listOperations({ accountId: rawAccount, limit = 100, action = '' } = {}) {
    const db = this.#requireDb();
    const account = accountId(rawAccount);
    const params = [account];
    const filters = ['account_id=?'];
    if (action) {
      filters.push('action=?');
      params.push(text(action, 'action', 40));
    }
    const max = Math.min(1000, Math.max(1, Number(limit) || 100));
    return db.prepare(`
      SELECT * FROM notebook_operations
      WHERE ${filters.join(' AND ')}
      ORDER BY created_at DESC, operation_id DESC
      LIMIT ?
    `).all(...params, max).map((row) => ({
      operationId: String(row.operation_id),
      accountId: String(row.account_id),
      idempotencyKey: String(row.idempotency_key),
      action: String(row.action),
      noteId: String(row.note_id || ''),
      expectedRevision: Number(row.expected_revision) || 0,
      runId: String(row.run_id || ''),
      status: String(row.status),
      errorCode: String(row.error_code || ''),
      errorMessage: String(row.error_message || ''),
      request: parseJson(row.request_json, {}),
      source: sourceView(parseJson(row.source_json, {})),
      result: parseJson(row.result_json, {}),
      createdAt: Number(row.created_at) || 0
    }));
  }

  counts({ accountId: rawAccount } = {}) {
    const db = this.#requireDb();
    const account = accountId(rawAccount);
    const notes = Number(db.prepare(
      'SELECT COUNT(*) AS n FROM notebook_notes WHERE account_id=?'
    ).get(account)?.n) || 0;
    const active = Number(db.prepare(
      "SELECT COUNT(*) AS n FROM notebook_notes WHERE account_id=? AND status='active'"
    ).get(account)?.n) || 0;
    const archived = notes - active;
    return { notes, active, archived };
  }
}
