import { createHash } from 'node:crypto';

const DEFAULT_MAX_NOTES = 5;
const DEFAULT_MAX_CHARS = 2400;
const DEFAULT_MAX_SNIPPET_CHARS = 600;
const ACTIVE_STATUSES = new Set(['active', 'current', 'published', 'ready']);
const FTS_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function asText(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function asPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function revisionNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compareRevisions(left, right) {
  const leftNumber = revisionNumber(left);
  const rightNumber = revisionNumber(right);
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  return asText(left).localeCompare(asText(right), 'en');
}

function noteId(note) {
  return asText(note?.id ?? note?.noteId ?? note?.note_id).trim();
}

function noteRevision(note) {
  return note?.revision ?? note?.noteRevision ?? note?.note_revision ?? 0;
}

function noteContent(note) {
  return asText(note?.content ?? note?.text ?? note?.body ?? note?.meaning ?? note?.note);
}

function noteTitle(note) {
  return asText(note?.title ?? note?.name ?? note?.summary);
}

function noteContentHash(note) {
  const supplied = asText(note?.contentHash ?? note?.content_hash).trim();
  if (supplied) return supplied;
  return createHash('sha256').update(noteContent(note), 'utf8').digest('hex');
}

function normalizedText(value) {
  return asText(value)
    .normalize('NFKC')
    .toLocaleLowerCase('und')
    .replace(/\s+/gu, ' ')
    .trim();
}

function noteScope(note) {
  return asText(note?.scope ?? note?.visibility ?? 'global').trim().toLocaleLowerCase('en');
}

function noteChatKey(note) {
  return asText(
    note?.scopeChatKey
      ?? note?.scope_chat_key
      ?? note?.chatKey
      ?? note?.chat_key
  ).trim();
}

function noteAccountId(note) {
  return asText(note?.accountId ?? note?.account_id).trim();
}

function noteStatus(note) {
  return asText(note?.status ?? note?.lifecycle ?? 'active').trim().toLocaleLowerCase('en');
}

function noteExpiry(note) {
  return note?.expiresAt ?? note?.expires_at ?? note?.expiryAt ?? note?.expiry_at ?? null;
}

function expiryTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function notePersonIds(note) {
  const values = [
    note?.personQqId,
    note?.person_qq_id,
    note?.qqId,
    note?.qq_id,
    note?.userId,
    note?.user_id,
    ...(Array.isArray(note?.personQqIds) ? note.personQqIds : []),
    ...(Array.isArray(note?.person_qq_ids) ? note.person_qq_ids : []),
    ...(Array.isArray(note?.personIds) ? note.personIds : []),
    ...(Array.isArray(note?.person_ids) ? note.person_ids : [])
  ];
  return [...new Set(values.map((value) => asText(value).trim()).filter(Boolean))];
}

function noteSearchText(note) {
  return normalizedText([
    noteTitle(note),
    noteContent(note),
    ...(Array.isArray(note?.tags) ? note.tags : []),
    ...notePersonIds(note)
  ].filter(Boolean).join(' '));
}

function queryTerms(query) {
  const normalized = normalizedText(query);
  if (!normalized) return [];

  const terms = [];
  const push = (value) => {
    const term = normalizedText(value);
    if (term && !terms.includes(term)) terms.push(term);
  };

  for (const part of normalized.split(/[\s,，。！？!?;；:：/\\|()[\]{}<>「」『』]+/u)) {
    if (!part) continue;
    if (/^[\p{Script=Han}]+$/u.test(part)) {
      push(part);
      if (part.length <= 2) {
        for (const character of part) push(character);
      } else if (part.length <= 4) {
        for (let index = 0; index < part.length - 1; index += 1) {
          push(part.slice(index, index + 2));
        }
      }
    } else {
      const runs = part.match(/\p{Script=Han}+|[\p{Script=Latin}\p{N}_-]+/gu) || [];
      for (const run of runs) {
        push(run);
        if (/^\p{Script=Han}+$/u.test(run)) {
          if (run.length <= 2) {
            for (const character of run) push(character);
          } else if (run.length <= 4) {
            for (let index = 0; index < run.length - 1; index += 1) {
              push(run.slice(index, index + 2));
            }
          }
        }
      }
    }
  }

  if (terms.length === 0) push(normalized);
  return terms;
}

function qqIdTerms(query) {
  return [...new Set((asText(query).match(/(?<!\d)\d{4,12}(?!\d)/g) || []))];
}

function occurrenceCount(text, term) {
  if (!term) return 0;
  let count = 0;
  let offset = 0;
  while (offset <= text.length) {
    const index = text.indexOf(term, offset);
    if (index < 0) break;
    count += 1;
    offset = index + Math.max(1, term.length);
    if (count >= 8) break;
  }
  return count;
}

function lexicalMatch(note, query) {
  const text = noteSearchText(note);
  const normalizedQuery = normalizedText(query);
  if (!normalizedQuery) return null;
  const terms = queryTerms(query);
  const personIds = notePersonIds(note);
  const exactPersonIds = qqIdTerms(query).filter((id) => personIds.includes(id));
  const matchedTerms = [];
  let score = 0;
  let firstMatchIndex = -1;

  for (const term of terms) {
    const count = occurrenceCount(text, term);
    if (count <= 0) continue;
    matchedTerms.push(term);
    if (firstMatchIndex < 0) firstMatchIndex = text.indexOf(term);
    const shortTerm = [...term].length <= 2;
    // Repetition should not make noisy notes outrank equally relevant notes.
    score += shortTerm ? 0.42 : 0.82;
  }

  if (text.includes(normalizedQuery)) {
    score += 0.7;
    if (firstMatchIndex < 0) firstMatchIndex = text.indexOf(normalizedQuery);
  }
  if (exactPersonIds.length > 0) score += 2.2 * exactPersonIds.length;
  if (score <= 0) return null;

  return {
    score,
    matchedTerms,
    firstMatchIndex,
    personMatch: exactPersonIds.length > 0
  };
}

function snippetFor(note, query, maxChars) {
  const content = noteContent(note) || noteTitle(note) || noteSearchText(note);
  if (!content) return '';
  const limit = Math.max(0, asPositiveInt(maxChars, DEFAULT_MAX_SNIPPET_CHARS));
  if (content.length <= limit) return content;
  const terms = queryTerms(query);
  const normalizedContent = normalizedText(content);
  const matched = terms
    .map((term) => normalizedContent.indexOf(term))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  const center = matched >= 0 ? matched : 0;
  const start = Math.max(0, Math.min(content.length - limit, center - Math.floor(limit / 3)));
  return content.slice(start, start + limit);
}

function normalizeScopeFilter(context) {
  const explicit = context?.scope;
  if (Array.isArray(explicit)) return new Set(explicit.map((item) => asText(item).toLocaleLowerCase('en')));
  if (explicit) return new Set([asText(explicit).toLocaleLowerCase('en')]);
  return null;
}

function visibilityCheck(note, context = {}) {
  const reasons = [];
  const requestedAccount = asText(context.accountId).trim();
  const account = noteAccountId(note);
  if (requestedAccount && requestedAccount !== account) reasons.push('account');

  const status = noteStatus(note);
  if (!ACTIVE_STATUSES.has(status)) reasons.push('status');

  const expiry = expiryTimestamp(noteExpiry(note));
  const now = Number.isFinite(Number(context.now)) ? Number(context.now) : Date.now();
  if (Number.isNaN(expiry) || (expiry !== null && expiry <= now)) reasons.push('expiry');

  const scope = noteScope(note);
  const allowedScopes = normalizeScopeFilter(context);
  if (allowedScopes && !allowedScopes.has(scope)) reasons.push('scope');
  if (scope === 'chat' || scope === 'chat-private' || scope === 'private') {
    const requestedChat = asText(context.chatKey ?? context.scopeChatKey).trim();
    if (!requestedChat || noteChatKey(note) !== requestedChat) reasons.push('scope');
  }
  if (typeof context.canRead === 'function') {
    try {
      if (context.canRead(note, context) !== true) reasons.push('permission');
    } catch {
      reasons.push('permission');
    }
  }
  return { visible: reasons.length === 0, reasons };
}

function preferNote(left, right) {
  const revisionComparison = compareRevisions(noteRevision(left), noteRevision(right));
  if (revisionComparison !== 0) return revisionComparison > 0 ? left : right;
  const updatedLeft = Number(left?.updatedAt ?? left?.updated_at ?? 0);
  const updatedRight = Number(right?.updatedAt ?? right?.updated_at ?? 0);
  if (updatedLeft !== updatedRight) return updatedLeft > updatedRight ? left : right;
  return asText(left?.content).localeCompare(asText(right?.content), 'en') <= 0 ? left : right;
}

function deduplicateNotes(notes) {
  const byId = new Map();
  for (const note of notes) {
    const id = noteId(note);
    if (!id) continue;
    const existing = byId.get(id);
    byId.set(id, existing ? preferNote(existing, note) : note);
  }
  return [...byId.values()];
}

function safeScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function rankSource(lexicalScore, ftsScore, embeddingScore) {
  const sources = [];
  if (lexicalScore > 0) sources.push('lexical');
  if (ftsScore > 0) sources.push('fts5');
  if (embeddingScore > 0) sources.push('embedding');
  if (sources.length > 1) return 'hybrid';
  return sources[0] || 'lexical';
}

function cloneNote(note) {
  if (!note || typeof note !== 'object') return note;
  return structuredClone(note);
}

function tableIdentifier(value, name) {
  const identifier = asText(value).trim();
  if (!FTS_IDENTIFIER_RE.test(identifier)) {
    throw new TypeError(`${name} must be a simple SQLite identifier`);
  }
  return identifier;
}

/**
 * FTS5 MATCH values are always bound parameters. Quoting each token prevents
 * user text from becoming an FTS operator or column selector.
 */
export function escapeFts5Query(query) {
  const rawTerms = normalizedText(query)
    .split(/\s+/u)
    .map((term) => term.trim())
    .filter(Boolean);
  const terms = rawTerms.length > 0 ? rawTerms : queryTerms(query);
  if (terms.length === 0) return '""';
  return terms
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(' AND ');
}

export function detectFts5(db) {
  if (!db || typeof db.prepare !== 'function') {
    return { available: false, reason: 'no-sqlite-database' };
  }
  try {
    const rows = db.prepare(
      'SELECT compile_options FROM pragma_compile_options WHERE compile_options LIKE ?'
    ).all('ENABLE_FTS5%');
    if (rows.some((row) => asText(row?.compile_options).startsWith('ENABLE_FTS5'))) {
      return { available: true, reason: 'compile-option' };
    }
  } catch {
    // Older SQLite builds may not expose pragma_compile_options.
  }
  if (typeof db.exec !== 'function') return { available: false, reason: 'probe-unavailable' };
  const tempName = '__retrieval_fts5_probe';
  try {
    db.exec(`CREATE VIRTUAL TABLE temp.${tempName} USING fts5(content)`);
    db.exec(`DROP TABLE temp.${tempName}`);
    return { available: true, reason: 'runtime-probe' };
  } catch {
    try { db.exec(`DROP TABLE IF EXISTS temp.${tempName}`); } catch { /* best effort */ }
    return { available: false, reason: 'fts5-unavailable' };
  }
}

function mapSqliteNote(row) {
  const note = { ...row };
  if (note.id === undefined && note.note_id !== undefined) note.id = note.note_id;
  if (note.content === undefined) {
    note.content = note.text ?? note.body ?? note.meaning ?? '';
  }
  if (note.scopeChatKey === undefined && note.scope_chat_key !== undefined) {
    note.scopeChatKey = note.scope_chat_key;
  }
  if (note.accountId === undefined && note.account_id !== undefined) note.accountId = note.account_id;
  if (note.expiresAt === undefined && note.expires_at !== undefined) note.expiresAt = note.expires_at;
  if (note.contentHash === undefined && note.content_hash !== undefined) note.contentHash = note.content_hash;
  return note;
}

export function createSqliteIndexAdapter({
  db,
  notesTable = 'notebook_notes',
  ftsTable = 'notebook_notes_fts',
  mapNote = mapSqliteNote
} = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('db.prepare is required');
  const table = tableIdentifier(notesTable, 'notesTable');
  const fts = tableIdentifier(ftsTable, 'ftsTable');
  const capability = detectFts5(db);
  return {
    kind: 'sqlite',
    fts5: capability,
    detectFts5: () => capability,
    listNotes() {
      return db.prepare(`SELECT * FROM ${table}`).all().map((row) => mapNote(row));
    },
    getNote(id) {
      const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`).get(asText(id));
      return row ? mapNote(row) : null;
    },
    searchFts({ query, records } = {}) {
      if (!capability.available) return [];
      const restrictToRecords = Array.isArray(records);
      const ids = [...new Set((restrictToRecords ? records : []).map(noteId).filter(Boolean))];
      if (restrictToRecords && ids.length === 0) return [];
      const byId = new Map();
      for (let offset = 0; offset < Math.max(1, ids.length); offset += 400) {
        const chunk = ids.slice(offset, offset + 400);
        const restriction = restrictToRecords ? ` AND note_id IN (${chunk.map(() => '?').join(', ')})` : '';
        const statement = db.prepare(
          `SELECT note_id, bm25(${fts}) AS fts_score FROM ${fts}
           WHERE ${fts} MATCH ?${restriction} ORDER BY fts_score ASC, note_id ASC`
        );
        for (const row of statement.all(escapeFts5Query(query), ...chunk)) {
          const id = asText(row?.note_id);
          if (!id) continue;
          const rawScore = safeScore(row?.fts_score);
          const existing = byId.get(id);
          if (!existing || rawScore < existing.rawScore) byId.set(id, { noteId: id, rawScore });
        }
      }
      return [...byId.values()]
        .sort((left, right) => left.rawScore - right.rawScore || left.noteId.localeCompare(right.noteId, 'en'))
        .map((hit, index) => ({
          noteId: hit.noteId,
          score: 1 / (index + 1),
          rawScore: hit.rawScore,
          rank: index + 1
        }));
    }
  };
}

export function createMemoryIndexAdapter(initialNotes = []) {
  let notes = (Array.isArray(initialNotes) ? initialNotes : []).map(cloneNote);
  return {
    kind: 'memory',
    fts5: { available: false, reason: 'memory-index' },
    detectFts5: () => ({ available: false, reason: 'memory-index' }),
    listNotes: () => notes.map(cloneNote),
    getNote: (id) => cloneNote(notes.find((note) => noteId(note) === asText(id))),
    replace(nextNotes) {
      notes = (Array.isArray(nextNotes) ? nextNotes : []).map(cloneNote);
    },
    upsert(note) {
      const id = noteId(note);
      if (!id) throw new TypeError('note.id is required');
      const index = notes.findIndex((item) => noteId(item) === id);
      if (index < 0) notes.push(cloneNote(note));
      else notes[index] = cloneNote(note);
    },
    remove(id) {
      const before = notes.length;
      notes = notes.filter((note) => noteId(note) !== asText(id));
      return notes.length !== before;
    }
  };
}

function validateVector(vector, dimension) {
  if (!Array.isArray(vector) && !ArrayBuffer.isView(vector)) {
    return { ok: false, reason: 'embedding-vector-invalid' };
  }
  const values = [...vector].map(Number);
  if (values.length !== dimension || values.some((value) => !Number.isFinite(value))) {
    return { ok: false, reason: 'embedding-dimension-mismatch' };
  }
  return { ok: true, values };
}

export class EmbeddingIndex {
  #entries = new Map();

  constructor({ provider = '', model = '', dimension = 0, getCurrentNote = null } = {}) {
    this.provider = asText(provider).trim();
    this.model = asText(model).trim();
    this.dimension = asPositiveInt(dimension, 0);
    this.getCurrentNote = typeof getCurrentNote === 'function' ? getCurrentNote : null;
  }

  get size() {
    return this.#entries.size;
  }

  get(noteIdValue) {
    const entry = this.#entries.get(asText(noteIdValue));
    return entry ? structuredClone(entry) : null;
  }

  delete(noteIdValue) {
    return this.#entries.delete(asText(noteIdValue));
  }

  clear() {
    this.#entries.clear();
  }

  accept(response = {}) {
    const note = response.note || response.noteRecord || {};
    const id = noteId(note);
    if (!id) return { accepted: false, reason: 'embedding-note-id-missing' };
    const expected = {
      revision: noteRevision(note),
      contentHash: noteContentHash(note),
      provider: this.provider,
      model: this.model,
      dimension: this.dimension
    };
    const metadata = {
      revision: response.revision ?? response.noteRevision ?? expected.revision,
      contentHash: response.contentHash ?? response.content_hash ?? expected.contentHash,
      provider: response.provider ?? expected.provider,
      model: response.model ?? expected.model,
      dimension: response.dimension ?? expected.dimension
    };
    if (compareRevisions(metadata.revision, expected.revision) !== 0
      || metadata.contentHash !== expected.contentHash
      || metadata.provider !== expected.provider
      || metadata.model !== expected.model
      || Number(metadata.dimension) !== Number(expected.dimension)) {
      return { accepted: false, reason: 'embedding-metadata-mismatch' };
    }
    if (this.getCurrentNote) {
      const current = this.getCurrentNote(id);
      if (current && (compareRevisions(noteRevision(current), expected.revision) !== 0
        || noteContentHash(current) !== expected.contentHash)) {
        return { accepted: false, reason: 'embedding-stale-response' };
      }
    }
    const existing = this.#entries.get(id);
    const existingRevision = existing ? compareRevisions(existing.revision, expected.revision) : 0;
    if (existing && (existingRevision > 0
      || (existingRevision === 0 && existing.contentHash !== expected.contentHash))) {
      return { accepted: false, reason: 'embedding-stale-response' };
    }
    const checked = validateVector(response.vector, this.dimension);
    if (!checked.ok) return { accepted: false, reason: checked.reason };
    this.#entries.set(id, {
      noteId: id,
      revision: expected.revision,
      contentHash: expected.contentHash,
      provider: expected.provider,
      model: expected.model,
      dimension: expected.dimension,
      vector: checked.values
    });
    return { accepted: true, reason: null };
  }

  put(note, vector, metadata = {}) {
    return this.accept({ note, vector, ...metadata });
  }

  search(queryVector, allowedIds = null) {
    const checked = validateVector(queryVector, this.dimension);
    if (!checked.ok) return [];
    const allowed = allowedIds ? new Set([...allowedIds].map(asText)) : null;
    const query = checked.values;
    const queryMagnitude = Math.sqrt(query.reduce((sum, value) => sum + value * value, 0));
    if (!queryMagnitude) return [];
    const results = [];
    for (const entry of this.#entries.values()) {
      if (allowed && !allowed.has(entry.noteId)) continue;
      const magnitude = Math.sqrt(entry.vector.reduce((sum, value) => sum + value * value, 0));
      if (!magnitude) continue;
      const dot = entry.vector.reduce((sum, value, index) => sum + value * query[index], 0);
      results.push({
        noteId: entry.noteId,
        revision: entry.revision,
        contentHash: entry.contentHash,
        score: dot / (magnitude * queryMagnitude)
      });
    }
    return results
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.noteId.localeCompare(right.noteId));
  }
}

async function listIndexNotes(index) {
  if (Array.isArray(index)) return index.map(cloneNote);
  if (typeof index?.listNotes === 'function') {
    const result = await index.listNotes();
    return Array.isArray(result) ? result.map(cloneNote) : [];
  }
  if (Array.isArray(index?.notes)) return index.notes.map(cloneNote);
  return [];
}

async function findCurrentNote(index, id) {
  if (typeof index?.getNote !== 'function') return { supported: false, note: null };
  return { supported: true, note: cloneNote(await index.getNote(id)) };
}

function normalizeEmbeddingConfig(config = {}) {
  const enabled = config.enabled === true;
  return {
    enabled,
    provider: asText(config.provider).trim(),
    model: asText(config.model).trim(),
    dimension: asPositiveInt(config.dimension, 0),
    allowPrivate: config.allowPrivate === true,
    allowQuery: config.allowQuery === true || config.allowPrivate === true
  };
}

function embeddingConfigurationIssue(config, adapter, { requireAdapter = true } = {}) {
  if (!config.enabled || adapter?.enabled === false) return 'embedding-disabled';
  if (!config.provider || !config.model || config.dimension <= 0) return 'embedding-unconfigured';
  if (requireAdapter && !adapter) return 'embedding-unconfigured';
  return null;
}

async function adapterAvailability(adapter) {
  if (typeof adapter?.isAvailable !== 'function') return { available: true, failed: false };
  try {
    return { available: await adapter.isAvailable() === true, failed: false };
  } catch {
    return { available: false, failed: true };
  }
}

export class RetrievalService {
  constructor({
    index = [],
    embeddingAdapter = null,
    embeddingIndex = null,
    embedding = {},
    now = () => Date.now(),
    maxNotes = DEFAULT_MAX_NOTES,
    maxChars = DEFAULT_MAX_CHARS,
    maxSnippetChars = DEFAULT_MAX_SNIPPET_CHARS
  } = {}) {
    this.index = index;
    this.embeddingAdapter = embeddingAdapter;
    this.embeddingConfig = normalizeEmbeddingConfig({
      ...embedding,
      provider: embedding.provider ?? embeddingAdapter?.provider,
      model: embedding.model ?? embeddingAdapter?.model,
      dimension: embedding.dimension ?? embeddingAdapter?.dimension
    });
    this.embeddingIndex = embeddingIndex || new EmbeddingIndex({
      ...this.embeddingConfig,
      getCurrentNote: (id) => {
        if (typeof this.index?.getNote !== 'function') return null;
        return this.index.getNote(id);
      }
    });
    this.now = typeof now === 'function' ? now : () => Date.now();
    this.defaults = {
      maxNotes: asPositiveInt(maxNotes, DEFAULT_MAX_NOTES),
      maxChars: asPositiveInt(maxChars, DEFAULT_MAX_CHARS),
      maxSnippetChars: asPositiveInt(maxSnippetChars, DEFAULT_MAX_SNIPPET_CHARS)
    };
    this.embeddingFailed = false;
  }

  async indexEmbedding(note, { signal = null, context = {} } = {}) {
    const configurationIssue = embeddingConfigurationIssue(this.embeddingConfig, this.embeddingAdapter);
    if (configurationIssue) return { accepted: false, reason: configurationIssue, calls: 0 };
    if (this.embeddingFailed) return { accepted: false, reason: 'embedding-failed', calls: 0 };
    if (typeof this.embeddingAdapter.embedNote !== 'function') {
      return { accepted: false, reason: 'embedding-unconfigured', calls: 0 };
    }
    const availability = await adapterAvailability(this.embeddingAdapter);
    if (!availability.available) {
      if (availability.failed) this.embeddingFailed = true;
      return {
        accepted: false,
        reason: availability.failed ? 'embedding-failed' : 'embedding-unavailable',
        calls: 0
      };
    }
    const privateNote = ['chat', 'chat-private', 'private'].includes(noteScope(note));
    let authorized = this.embeddingConfig.allowPrivate || !privateNote;
    if (typeof this.embeddingAdapter.authorizeNote === 'function') {
      try {
        authorized = await this.embeddingAdapter.authorizeNote(note, context) === true;
      } catch {
        authorized = false;
      }
    }
    if (privateNote && !authorized) {
      return { accepted: false, reason: 'embedding-private-authorization-required', calls: 0 };
    }
    const snapshot = cloneNote(note);
    try {
      const vector = await this.embeddingAdapter.embedNote({
        note: snapshot,
        text: `${noteTitle(snapshot)}\n${noteContent(snapshot)}`.trim(),
        provider: this.embeddingConfig.provider,
        model: this.embeddingConfig.model,
        dimension: this.embeddingConfig.dimension,
        signal
      });
      const currentResult = await findCurrentNote(this.index, noteId(snapshot));
      if (currentResult.supported && !currentResult.note) {
        return { accepted: false, reason: 'embedding-stale-response', calls: 1 };
      }
      const current = currentResult.note;
      if (current && (compareRevisions(noteRevision(current), noteRevision(snapshot)) !== 0
        || noteContentHash(current) !== noteContentHash(snapshot))) {
        return { accepted: false, reason: 'embedding-stale-response', calls: 1 };
      }
      const accepted = this.embeddingIndex.accept({
        note: snapshot,
        vector,
        revision: snapshot.revision,
        contentHash: noteContentHash(snapshot),
        provider: this.embeddingConfig.provider,
        model: this.embeddingConfig.model,
        dimension: this.embeddingConfig.dimension
      });
      return { ...accepted, calls: 1 };
    } catch (error) {
      this.embeddingFailed = true;
      return {
        accepted: false,
        reason: 'embedding-failed',
        error: asText(error?.message || error),
        calls: 1
      };
    }
  }

  async search({
    query = '',
    accountId = '',
    chatKey = '',
    scope = null,
    canRead = null,
    now = this.now(),
    maxNotes = this.defaults.maxNotes,
    maxChars = this.defaults.maxChars,
    maxSnippetChars = this.defaults.maxSnippetChars,
    embeddingQueryVector = null,
    signal = null
  } = {}) {
    const normalizedQuery = normalizedText(query);
    const budget = {
      maxNotes: asPositiveInt(maxNotes, this.defaults.maxNotes),
      maxChars: asPositiveInt(maxChars, this.defaults.maxChars),
      maxSnippetChars: asPositiveInt(maxSnippetChars, this.defaults.maxSnippetChars),
      usedNotes: 0,
      usedChars: 0,
      truncated: false
    };
    const degradationReasons = [];
    const allNotes = await listIndexNotes(this.index);
    const visible = [];
    const filtered = {};
    for (const note of allNotes) {
      const check = visibilityCheck(note, { accountId, chatKey, scope, canRead, now });
      if (check.visible) visible.push(note);
      else for (const reason of check.reasons) filtered[reason] = (filtered[reason] || 0) + 1;
    }
    const candidates = deduplicateNotes(visible);
    if (!normalizedQuery) {
      return this.#result(normalizedQuery, [], budget, degradationReasons, filtered, {
        fts5: this.index?.fts5 || { available: false, reason: 'empty-query' }
      });
    }

    let ftsHits = [];
    const ftsCapability = typeof this.index?.detectFts5 === 'function'
      ? this.index.detectFts5()
      : this.index?.fts5 || { available: false, reason: 'index-no-fts5' };
    if (ftsCapability?.available && typeof this.index?.searchFts === 'function') {
      try {
        ftsHits = await this.index.searchFts({ query: normalizedQuery, records: candidates });
      } catch {
        degradationReasons.push('fts5-query-failed');
      }
    } else if (ftsCapability && ftsCapability.available === false
      && ftsCapability.reason !== 'memory-index') {
      degradationReasons.push('fts5-unavailable');
    }
    const ftsById = new Map();
    for (const hit of Array.isArray(ftsHits) ? ftsHits : []) {
      const id = asText(hit?.noteId ?? hit?.note_id);
      if (id) ftsById.set(id, Math.max(ftsById.get(id) || 0, safeScore(hit?.score)));
    }

    let queryVector = null;
    let embeddingDegradation = embeddingConfigurationIssue(
      this.embeddingConfig,
      this.embeddingAdapter,
      { requireAdapter: embeddingQueryVector == null }
    );
    if (!embeddingDegradation) {
      if (this.embeddingFailed) {
        embeddingDegradation = 'embedding-failed';
      } else {
        const availability = await adapterAvailability(this.embeddingAdapter);
        if (!availability.available) {
          if (availability.failed) this.embeddingFailed = true;
          embeddingDegradation = availability.failed ? 'embedding-failed' : 'embedding-unavailable';
        } else if (embeddingQueryVector != null) {
          queryVector = embeddingQueryVector;
        } else if (typeof this.embeddingAdapter.embedQuery !== 'function') {
          embeddingDegradation = 'embedding-unconfigured';
        } else {
          let authorized = this.embeddingConfig.allowQuery;
          if (typeof this.embeddingAdapter.authorizeQuery === 'function') {
            try {
              authorized = await this.embeddingAdapter.authorizeQuery({
                query: asText(query),
                accountId,
                chatKey,
                scope,
                now,
                provider: this.embeddingConfig.provider,
                model: this.embeddingConfig.model,
                dimension: this.embeddingConfig.dimension
              }) === true;
            } catch {
              authorized = false;
            }
          }
          if (!authorized) {
            embeddingDegradation = 'embedding-query-authorization-required';
          } else {
            try {
              queryVector = await this.embeddingAdapter.embedQuery({
                query: asText(query),
                provider: this.embeddingConfig.provider,
                model: this.embeddingConfig.model,
                dimension: this.embeddingConfig.dimension,
                signal
              });
            } catch {
              this.embeddingFailed = true;
              embeddingDegradation = 'embedding-failed';
            }
          }
        }
      }
    }
    if (embeddingDegradation) degradationReasons.push(embeddingDegradation);
    if (queryVector != null) {
      const checked = validateVector(queryVector, this.embeddingConfig.dimension);
      if (!checked.ok) {
        queryVector = null;
        degradationReasons.push(checked.reason);
      }
    }
    const candidatesById = new Map(candidates.map((note) => [noteId(note), note]));
    const embeddingHits = queryVector
      ? this.embeddingIndex.search(queryVector, new Set(candidatesById.keys()))
      : [];
    const embeddingById = new Map();
    for (const hit of embeddingHits) {
      const candidate = candidatesById.get(hit.noteId);
      if (!candidate) continue;
      if (compareRevisions(hit.revision, noteRevision(candidate)) !== 0) continue;
      if (hit.contentHash !== noteContentHash(candidate)) continue;
      embeddingById.set(hit.noteId, safeScore(hit.score));
    }

    const ranked = [];
    for (const note of candidates) {
      const id = noteId(note);
      const lexical = lexicalMatch(note, query);
      const lexicalScore = lexical?.score || 0;
      const ftsScore = ftsById.get(id) || 0;
      const embeddingScore = Math.max(0, embeddingById.get(id) || 0);
      if (!lexical && ftsScore <= 0 && embeddingScore <= 0) continue;
      const score = lexicalScore + ftsScore * 0.3 + embeddingScore * 0.7;
      ranked.push({ note, lexical, lexicalScore, ftsScore, embeddingScore, score });
    }
    ranked.sort((left, right) => right.score - left.score
      || right.embeddingScore - left.embeddingScore
      || right.lexicalScore - left.lexicalScore
      || compareRevisions(noteRevision(right.note), noteRevision(left.note))
      || noteId(left.note).localeCompare(noteId(right.note), 'en'));

    const selected = [];
    for (const hit of ranked) {
      if (selected.length >= budget.maxNotes) {
        budget.truncated = true;
        break;
      }
      const remaining = budget.maxChars - budget.usedChars;
      if (remaining <= 0) {
        budget.truncated = true;
        break;
      }
      const snippet = snippetFor(hit.note, query, Math.min(budget.maxSnippetChars, remaining));
      if (!snippet) continue;
      const itemBudget = {
        maxChars: budget.maxChars,
        usedChars: snippet.length,
        remainingChars: Math.max(0, remaining - snippet.length)
      };
      budget.usedNotes += 1;
      budget.usedChars += snippet.length;
      selected.push({
        noteId: noteId(hit.note),
        revision: noteRevision(hit.note),
        noteRevision: noteRevision(hit.note),
        snippet,
        score: hit.score,
        lexicalScore: hit.lexicalScore,
        ftsScore: hit.ftsScore,
        embeddingScore: hit.embeddingScore,
        matchedTerms: hit.lexical?.matchedTerms || [],
        rankingSource: rankSource(hit.lexicalScore, hit.ftsScore, hit.embeddingScore),
        rankingSources: [
          ...(hit.lexicalScore > 0 ? ['lexical'] : []),
          ...(hit.ftsScore > 0 ? ['fts5'] : []),
          ...(hit.embeddingScore > 0 ? ['embedding'] : [])
        ],
        budget: itemBudget,
        degradationReason: null
      });
    }
    if (ranked.length > selected.length) budget.truncated = true;
    if (selected.length === 0) degradationReasons.push('no-matches');
    return this.#result(normalizedQuery, selected, budget, [...new Set(degradationReasons)], filtered, {
      fts5: ftsCapability,
      candidateCount: candidates.length,
      matchCount: ranked.length
    });
  }

  #result(query, selected, budget, degradationReasons, filtered, diagnostics) {
    const reasons = [...new Set(degradationReasons)];
    const blocks = selected.map((item) => ({
      noteId: item.noteId,
      revision: item.revision,
      snippet: item.snippet,
      rankingSource: item.rankingSource,
      budget: item.budget,
      degradationReason: reasons.length > 0 ? reasons.join(';') : null
    }));
    return {
      query,
      results: selected,
      hits: selected,
      contextBlocks: blocks,
      budget,
      degradationReason: reasons[0] || null,
      degradationReasons: reasons,
      filtered,
      diagnostics
    };
  }
}

export function createRetrievalService(options = {}) {
  return new RetrievalService(options);
}

export async function retrieveNotes(options = {}) {
  const service = options.service instanceof RetrievalService
    ? options.service
    : new RetrievalService(options);
  return service.search(options);
}

export const retrieve = retrieveNotes;

export {
  ACTIVE_STATUSES,
  DEFAULT_MAX_CHARS,
  DEFAULT_MAX_NOTES,
  DEFAULT_MAX_SNIPPET_CHARS,
  noteContentHash,
  noteId,
  noteRevision,
  normalizedText,
  queryTerms,
  visibilityCheck
};
