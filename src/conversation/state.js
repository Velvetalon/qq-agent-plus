import crypto from 'node:crypto';
import { SocialInterestStore } from './interests.js';

const MAX_MESSAGES_PER_TOPIC = 200;
const MAX_INTENT_SOURCES = 8;
const MAX_TARGETS = 8;
const MAX_INTENT_LIFETIME = 30 * 24 * 60 * 60 * 1000;
const OPEN = ['pending', 'leased'];
const TERMINAL = ['completed', 'expired', 'cancelled', 'held'];

const id = (value) => value == null ? '' : String(value).trim();
const clean = (value, max = 4000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const json = (value, fallback) => {
  if (value == null || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};
const strings = (values, max = 64) => [...new Set((Array.isArray(values) ? values : []).map(id).filter(Boolean))].slice(0, max);
const norm = (value) => clean(value, 10000).toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');
const commonAck = (value) => new Set(['好', '好的', '好呀', '嗯', '嗯嗯', '哦', '哦哦', '是', '是的', '收到', '谢谢', '谢了', '哈哈', 'ok', 'okay', 'thx', 'thanks']).has(norm(value));
const goalNorm = (value) => clean(value, 300).toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const stableJson = (value) => JSON.stringify(value && typeof value === 'object'
  ? Array.isArray(value) ? value.map((item) => JSON.parse(stableJson(item)))
    : Object.fromEntries(Object.keys(value).sort().map((key) => [key, JSON.parse(stableJson(value[key]) ?? 'null')]))
  : value);
const fail = (code, message) => Object.assign(new Error(message), { code });
const scopeOf = ({ accountId, chatKey }) => {
  const account = id(accountId), chat = id(chatKey);
  if (!account || !chat) throw fail('INVALID_SCOPE', 'accountId and chatKey are required');
  return { accountId: account, chatKey: chat };
};
const replyParts = (value) => {
  const reply = typeof value === 'string' ? json(value, {}) : (value && typeof value === 'object' ? value : {});
  return {
    messageId: id(reply.localMessageId ?? reply.sourceMessageId),
    mid: id(reply.platformMessageId ?? reply.mid ?? reply.message_id ?? reply.id ?? reply.messageId)
  };
};
const messageData = (value, selfId) => {
  const senderId = id(value?.senderId ?? value?.sender_id);
  const senderName = clean(value?.senderName ?? value?.sender_name, 160);
  const reply = typeof value?.reply === 'string' ? json(value.reply, {}) : (value?.reply || {});
  const refs = replyParts(reply);
  const rawTs = Number(value?.ts);
  return {
    id: id(value?.id), mid: id(value?.mid) || null,
    ts: Number.isFinite(rawTs) && rawTs > 0 ? Math.round(rawTs) : 0,
    senderId, senderName, self: value?.self === true || value?.self === 1 || (id(selfId) && senderId === id(selfId)),
    text: clean(value?.text, 10000), reply, replyJson: Object.keys(reply).length ? JSON.stringify(reply) : null,
    replyToMessageId: refs.messageId || null, replyToMid: refs.mid || null,
    mentionsSelf: value?.mentionsSelf === true || value?.mentionsSelf === 1 || value?.mentions_self === true || value?.mentions_self === 1
  };
};
const extractSentTexts = (items) => {
  const output = [];
  const visit = (value) => {
    if (typeof value === 'string') { if (value.trim()) output.push(value.trim()); return; }
    if (!value || typeof value !== 'object') return;
    for (const key of ['text', 'content', 'caption']) if (typeof value[key] === 'string' && value[key].trim()) output.push(value[key].trim());
    for (const key of ['segments', 'data']) if (Array.isArray(value[key])) value[key].forEach(visit);
  };
  (Array.isArray(items) ? items : items == null || items === '' ? [] : [items]).slice(0, 20).forEach(visit);
  return output;
};

export class SocialStateStore {
  #db;
  #now;
  #maxTopics;
  #ready = false;
  #savepoint = 0;

  constructor({ db, now = Date.now, maxTopics = 8 } = {}) {
    if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function') throw new TypeError('SocialStateStore requires the host SQLite db');
    this.#db = db;
    this.#now = typeof now === 'function' ? now : Date.now;
    this.interests = new SocialInterestStore({ db, now: this.#now });
    this.#maxTopics = Math.max(1, Math.min(32, Math.floor(Number(maxTopics) || 8)));
  }

  static isInitialized(db) {
    if (!db || typeof db.prepare !== 'function') throw new TypeError('isInitialized requires the host SQLite db');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'social_%'").all().map((row) => String(row.name)));
    return ['social_scope_state', 'social_topics', 'social_messages', 'social_intents', 'social_outcomes'].every((name) => tables.has(name));
  }

  #time(value) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
    const now = Number(this.#now());
    return Number.isFinite(now) && now > 0 ? Math.round(now) : Date.now();
  }

  #ensure() {
    if (this.#ready) return;
    this.#db.exec([
      "CREATE TABLE IF NOT EXISTS social_scope_state (account_id TEXT NOT NULL,chat_key TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(account_id,chat_key))",
      "CREATE TABLE IF NOT EXISTS social_topics (account_id TEXT NOT NULL,chat_key TEXT NOT NULL,topic_id TEXT NOT NULL,topic TEXT NOT NULL DEFAULT '',participant_ids TEXT NOT NULL DEFAULT '[]',status TEXT NOT NULL DEFAULT 'active',version INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,last_human_id TEXT,last_human_at INTEGER NOT NULL DEFAULT 0,last_self_at INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(account_id,chat_key,topic_id))",
      "CREATE INDEX IF NOT EXISTS social_topics_recent ON social_topics(account_id,chat_key,status,updated_at DESC)",
      "CREATE TABLE IF NOT EXISTS social_messages (account_id TEXT NOT NULL,chat_key TEXT NOT NULL,message_id TEXT NOT NULL,mid TEXT,ts INTEGER NOT NULL,sender_id TEXT NOT NULL DEFAULT '',sender_name TEXT NOT NULL DEFAULT '',self INTEGER NOT NULL DEFAULT 0,text TEXT NOT NULL DEFAULT '',reply_json TEXT,reply_to_message_id TEXT,reply_to_mid TEXT,mentions_self INTEGER NOT NULL DEFAULT 0,topic_id TEXT,interaction_id TEXT,observed_at INTEGER NOT NULL,observed_revision INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(account_id,chat_key,message_id),UNIQUE(account_id,chat_key,mid))",
      "CREATE INDEX IF NOT EXISTS social_messages_topic ON social_messages(account_id,chat_key,topic_id,ts DESC)",
      "CREATE INDEX IF NOT EXISTS social_messages_mid ON social_messages(account_id,chat_key,mid)",
      "CREATE TABLE IF NOT EXISTS social_interactions (account_id TEXT NOT NULL,chat_key TEXT NOT NULL,topic_id TEXT NOT NULL,interaction_id TEXT NOT NULL,causal_root_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',opened_at INTEGER NOT NULL,last_event_at INTEGER NOT NULL,PRIMARY KEY(account_id,chat_key,interaction_id))",
      "CREATE INDEX IF NOT EXISTS social_interactions_topic ON social_interactions(account_id,chat_key,topic_id,status,last_event_at DESC)",
      "CREATE TABLE IF NOT EXISTS social_external_observations (account_id TEXT NOT NULL,chat_key TEXT NOT NULL,source_id TEXT NOT NULL,topic_id TEXT,source_refs TEXT NOT NULL,content_text TEXT NOT NULL DEFAULT '',expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(account_id,chat_key,source_id))",
      "CREATE TABLE IF NOT EXISTS social_intents (id TEXT PRIMARY KEY,account_id TEXT NOT NULL,chat_key TEXT NOT NULL,topic_id TEXT NOT NULL,source_message_ids TEXT NOT NULL,source_refs TEXT NOT NULL DEFAULT '[]',causal_root_id TEXT NOT NULL DEFAULT '',evaluation_attempts INTEGER NOT NULL DEFAULT 0,postponements INTEGER NOT NULL DEFAULT 0,goal TEXT NOT NULL,semantic_key TEXT NOT NULL,due_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,status TEXT NOT NULL,lease_id TEXT,lease_until INTEGER NOT NULL DEFAULT 0,reason TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,finished_at INTEGER,answered_at INTEGER,UNIQUE(account_id,chat_key,semantic_key))",
      "CREATE INDEX IF NOT EXISTS social_intents_due ON social_intents(account_id,chat_key,status,due_at,expires_at)",
      "CREATE TABLE IF NOT EXISTS social_intent_events (event_id TEXT PRIMARY KEY,intent_id TEXT NOT NULL,account_id TEXT NOT NULL,chat_key TEXT NOT NULL,from_status TEXT,to_status TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL)",
      "CREATE INDEX IF NOT EXISTS social_intent_events_audit ON social_intent_events(account_id,chat_key,intent_id,created_at)",
      "CREATE TABLE IF NOT EXISTS social_outcomes (outcome_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,chat_key TEXT NOT NULL,idempotency_key TEXT NOT NULL,topic_id TEXT NOT NULL,target_message_id TEXT,action TEXT NOT NULL,sent_json TEXT NOT NULL,run_id TEXT NOT NULL DEFAULT '',initiative_id TEXT,outcome TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(account_id,chat_key,idempotency_key))",
      "CREATE INDEX IF NOT EXISTS social_outcomes_target ON social_outcomes(account_id,chat_key,topic_id,target_message_id,created_at DESC)",
      "CREATE INDEX IF NOT EXISTS social_outcomes_initiative ON social_outcomes(account_id,chat_key,initiative_id,created_at DESC)"
    ].join(';\n'));
    const addColumn = (table, column, definition) => {
      if (!this.#db.prepare('PRAGMA table_info(' + table + ')').all().some((item) => item.name === column)) {
        this.#db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + definition);
      }
    };
    addColumn('social_messages', 'sender_name', "TEXT NOT NULL DEFAULT ''");
    addColumn('social_messages', 'observed_revision', 'INTEGER NOT NULL DEFAULT 1');
    addColumn('social_messages', 'interaction_id', 'TEXT');
    addColumn('social_intents', 'answered_at', 'INTEGER');
    addColumn('social_intents', 'source_refs', "TEXT NOT NULL DEFAULT '[]'");
    addColumn('social_intents', 'causal_root_id', "TEXT NOT NULL DEFAULT ''");
    addColumn('social_intents', 'evaluation_attempts', 'INTEGER NOT NULL DEFAULT 0');
    addColumn('social_intents', 'postponements', 'INTEGER NOT NULL DEFAULT 0');
    addColumn('social_external_observations', 'content_text', "TEXT NOT NULL DEFAULT ''");
    this.#ready = true;
  }

  #requireInitialized() {
    if (!this.#ready && !SocialStateStore.isInitialized(this.#db)) {
      throw fail('SOCIAL_STATE_NOT_INITIALIZED', 'social state has not been initialized');
    }
  }

  #tx(fn) {
    this.#ensure();
    const point = 'social_state_' + (++this.#savepoint);
    this.#db.exec('SAVEPOINT ' + point);
    try { const value = fn(); this.#db.exec('RELEASE SAVEPOINT ' + point); return value; }
    catch (error) { this.#db.exec('ROLLBACK TO SAVEPOINT ' + point); this.#db.exec('RELEASE SAVEPOINT ' + point); throw error; }
  }

  #revision(scope) {
    return Number(this.#db.prepare('SELECT revision FROM social_scope_state WHERE account_id=? AND chat_key=?').get(scope.accountId, scope.chatKey)?.revision || 0);
  }

  #bump(scope) {
    this.#db.prepare("INSERT INTO social_scope_state(account_id,chat_key,revision,updated_at) VALUES (?,?,1,?) ON CONFLICT(account_id,chat_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at").run(scope.accountId, scope.chatKey, this.#time());
    return this.#revision(scope);
  }

  #topicRow(scope, topicId) {
    return this.#db.prepare('SELECT * FROM social_topics WHERE account_id=? AND chat_key=? AND topic_id=?').get(scope.accountId, scope.chatKey, topicId) || null;
  }

  #message(scope, messageId) {
    return this.#db.prepare('SELECT rowid AS row_order,* FROM social_messages WHERE account_id=? AND chat_key=? AND message_id=?').get(scope.accountId, scope.chatKey, String(messageId)) || null;
  }

  #messageByMid(scope, mid) {
    if (!id(mid)) return null;
    return this.#db.prepare('SELECT rowid AS row_order,* FROM social_messages WHERE account_id=? AND chat_key=? AND mid=?')
      .get(scope.accountId, scope.chatKey, id(mid)) || null;
  }

  #topic(scope, row) {
    if (!row) return null;
    const messages = this.#db.prepare('SELECT message_id FROM social_messages WHERE account_id=? AND chat_key=? AND topic_id=? ORDER BY ts,rowid LIMIT ?').all(scope.accountId, scope.chatKey, row.topic_id, MAX_MESSAGES_PER_TOPIC);
    return { id: String(row.topic_id), topic: String(row.topic || ''), participantIds: strings(json(row.participant_ids, [])), status: String(row.status), version: Number(row.version) || 1, lastHumanAt: Number(row.last_human_at) || 0, lastSelfAt: Number(row.last_self_at) || 0, messageIds: messages.map((item) => String(item.message_id)) };
  }

  #replyTarget(scope, refs) {
    if (refs.mid) {
      const row = this.#db.prepare('SELECT * FROM social_messages WHERE account_id=? AND chat_key=? AND mid=? LIMIT 1').get(scope.accountId, scope.chatKey, refs.mid);
      if (row) return row;
    }
    return refs.messageId ? this.#db.prepare('SELECT * FROM social_messages WHERE account_id=? AND chat_key=? AND message_id=? LIMIT 1').get(scope.accountId, scope.chatKey, refs.messageId) || null : null;
  }

  #interactionFor(scope, topicId, message, target) {
    const explicit = target?.interaction_id
      ? this.#db.prepare('SELECT * FROM social_interactions WHERE account_id=? AND chat_key=? AND interaction_id=?').get(scope.accountId, scope.chatKey, target.interaction_id)
      : null;
    if (explicit && String(explicit.status) === 'open') return explicit;
    const at = this.#time(message.ts);
    const recent = this.#db.prepare("SELECT * FROM social_interactions WHERE account_id=? AND chat_key=? AND topic_id=? AND status='open' ORDER BY last_event_at DESC LIMIT 1")
      .get(scope.accountId, scope.chatKey, topicId);
    if (recent && at >= Number(recent.last_event_at) && at - Number(recent.last_event_at) <= 30 * 60 * 1000) return recent;
    const interactionId = crypto.randomUUID();
    const causalRootId = message.self ? `outbound:${message.id}` : String(message.id);
    this.#db.prepare("INSERT INTO social_interactions(account_id,chat_key,topic_id,interaction_id,causal_root_id,status,opened_at,last_event_at) VALUES (?,?,?,?,?,'open',?,?)")
      .run(scope.accountId, scope.chatKey, topicId, interactionId, causalRootId, at, at);
    return this.#db.prepare('SELECT * FROM social_interactions WHERE account_id=? AND chat_key=? AND interaction_id=?')
      .get(scope.accountId, scope.chatKey, interactionId);
  }

  #makeRoom(scope, protect = []) {
    const count = Number(this.#db.prepare('SELECT COUNT(*) AS n FROM social_topics WHERE account_id=? AND chat_key=?').get(scope.accountId, scope.chatKey)?.n || 0);
    if (count < this.#maxTopics) return true;
    const protectedIds = new Set(protect);
    const rows = this.#db.prepare("SELECT topic_id FROM social_topics t WHERE account_id=? AND chat_key=? AND NOT EXISTS (SELECT 1 FROM social_intents i WHERE i.account_id=t.account_id AND i.chat_key=t.chat_key AND i.topic_id=t.topic_id AND (i.status IN ('pending','leased','held') OR (i.status='completed' AND i.answered_at IS NULL))) ORDER BY CASE status WHEN 'closed' THEN 0 ELSE 1 END,updated_at ASC").all(scope.accountId, scope.chatKey);
    const victim = rows.find((row) => !protectedIds.has(String(row.topic_id)));
    if (!victim) return false;
    this.#db.prepare('DELETE FROM social_messages WHERE account_id=? AND chat_key=? AND topic_id=?').run(scope.accountId, scope.chatKey, victim.topic_id);
    this.#db.prepare('DELETE FROM social_topics WHERE account_id=? AND chat_key=? AND topic_id=?').run(scope.accountId, scope.chatKey, victim.topic_id);
    return true;
  }

  #createTopic(scope, message, label = '', protect = []) {
    if (!this.#makeRoom(scope, protect)) return '';
    const now = this.#time(message?.ts);
    const topicId = crypto.randomUUID();
    const title = clean(label || message?.text || '新话题', 200);
    this.#db.prepare("INSERT INTO social_topics(account_id,chat_key,topic_id,topic,participant_ids,status,version,created_at,updated_at,last_human_id,last_human_at,last_self_at) VALUES (?,?,?,?,?,'active',1,?,?,?,?,?)").run(
      scope.accountId, scope.chatKey, topicId, title,
      JSON.stringify(message?.senderId ? [message.senderId] : []), now, now,
      message && !message.self ? message.id : null, message && !message.self ? now : 0, message?.self ? now : 0
    );
    return topicId;
  }

  #route(scope, message, target) {
    if (target?.topic_id && this.#topicRow(scope, target.topic_id)) return String(target.topic_id);
    const topics = this.#db.prepare("SELECT * FROM social_topics WHERE account_id=? AND chat_key=? AND status='active' ORDER BY updated_at DESC LIMIT ?").all(scope.accountId, scope.chatKey, this.#maxTopics);
    const at = message.ts || this.#time();
    if (message.self) {
      const topic = topics.find((item) => at >= Number(item.updated_at) && at - Number(item.updated_at) < 30 * 60 * 1000);
      return topic ? String(topic.topic_id) : '';
    }
    const recent = topics.find((item) => {
      const delta = at - (Number(item.last_human_at) || 0);
      return delta >= 0 && delta <= 3 * 60 * 1000 && message.senderId && strings(json(item.participant_ids, [])).includes(message.senderId);
    });
    return recent ? String(recent.topic_id) : '';
  }

  #touch(scope, topicId, message) {
    const row = this.#topicRow(scope, topicId);
    if (!row) return;
    const participants = strings([...json(row.participant_ids, []), message.senderId]);
    const at = this.#time(message.ts);
    this.#db.prepare("UPDATE social_topics SET participant_ids=?,status='active',version=version+1,updated_at=?,last_human_id=?,last_human_at=?,last_self_at=? WHERE account_id=? AND chat_key=? AND topic_id=?").run(
      JSON.stringify(participants), at,
      message.self ? row.last_human_id : message.id,
      message.self ? Number(row.last_human_at) || 0 : Math.max(Number(row.last_human_at) || 0, at),
      message.self ? Math.max(Number(row.last_self_at) || 0, at) : Number(row.last_self_at) || 0,
      scope.accountId, scope.chatKey, topicId
    );
  }

  #recompute(scope, topicId) {
    const row = this.#topicRow(scope, topicId);
    if (!row) return;
    const messages = this.#db.prepare('SELECT message_id,sender_id,self,ts FROM social_messages WHERE account_id=? AND chat_key=? AND topic_id=? ORDER BY ts,rowid').all(scope.accountId, scope.chatKey, topicId);
    if (!messages.length) {
      const protectedIntent = this.#db.prepare("SELECT 1 FROM social_intents WHERE account_id=? AND chat_key=? AND topic_id=? AND status IN ('pending','leased') LIMIT 1").get(scope.accountId, scope.chatKey, topicId);
      if (!protectedIntent) this.#db.prepare('DELETE FROM social_topics WHERE account_id=? AND chat_key=? AND topic_id=?').run(scope.accountId, scope.chatKey, topicId);
      return;
    }
    const humans = messages.filter((item) => !item.self), selfs = messages.filter((item) => item.self);
    const human = humans[humans.length - 1], self = selfs[selfs.length - 1], latest = messages[messages.length - 1];
    this.#db.prepare('UPDATE social_topics SET participant_ids=?,version=version+1,updated_at=?,last_human_id=?,last_human_at=?,last_self_at=? WHERE account_id=? AND chat_key=? AND topic_id=?').run(
      JSON.stringify(strings(messages.map((item) => item.sender_id))), Number(latest.ts) || this.#time(),
      human?.message_id || null, Number(human?.ts) || 0, Number(self?.ts) || Number(row.last_self_at) || 0,
      scope.accountId, scope.chatKey, topicId
    );
  }

  #pruneMessages(scope, topicId) {
    const protectedIds = new Set();
    const intents = this.#db.prepare("SELECT source_message_ids FROM social_intents WHERE account_id=? AND chat_key=? AND topic_id=? AND (status IN ('pending','leased','held') OR (status='completed' AND answered_at IS NULL))").all(scope.accountId, scope.chatKey, topicId);
    for (const row of intents) for (const sourceId of strings(json(row.source_message_ids, []), MAX_INTENT_SOURCES)) protectedIds.add(sourceId);
    const rows = this.#db.prepare('SELECT message_id FROM social_messages WHERE account_id=? AND chat_key=? AND topic_id=? ORDER BY ts DESC,rowid DESC').all(scope.accountId, scope.chatKey, topicId);
    const keep = new Set(rows.slice(0, MAX_MESSAGES_PER_TOPIC).map((row) => String(row.message_id)));
    for (const sourceId of protectedIds) keep.add(sourceId);
    for (const row of rows) {
      if (keep.has(String(row.message_id))) continue;
      this.#db.prepare('DELETE FROM social_messages WHERE account_id=? AND chat_key=? AND message_id=?').run(scope.accountId, scope.chatKey, row.message_id);
    }
  }

  #resolveReplies(scope) {
    const rows = this.#db.prepare('SELECT message_id,topic_id,interaction_id,reply_to_mid,reply_to_message_id FROM social_messages WHERE account_id=? AND chat_key=? AND (reply_to_mid IS NOT NULL OR reply_to_message_id IS NOT NULL) ORDER BY ts,rowid LIMIT ?').all(scope.accountId, scope.chatKey, this.#maxTopics * MAX_MESSAGES_PER_TOPIC);
    const changed = new Set();
    for (const row of rows) {
      const target = this.#replyTarget(scope, { mid: row.reply_to_mid || '', messageId: row.reply_to_message_id || '' });
      if (!target?.topic_id || (String(row.topic_id || '') === String(target.topic_id)
        && String(row.interaction_id || '') === String(target.interaction_id || ''))) continue;
      if (row.topic_id) changed.add(String(row.topic_id));
      this.#db.prepare('UPDATE social_messages SET topic_id=?,interaction_id=?,observed_revision=? WHERE account_id=? AND chat_key=? AND message_id=?').run(target.topic_id, target.interaction_id, this.#revision(scope) + 1, scope.accountId, scope.chatKey, row.message_id);
      changed.add(String(target.topic_id));
    }
    for (const topicId of changed) this.#recompute(scope, topicId);
    return changed.size > 0;
  }

  #snapshot(scope) {
    const topics = this.#db.prepare('SELECT * FROM social_topics WHERE account_id=? AND chat_key=? ORDER BY updated_at DESC,created_at DESC LIMIT ?').all(scope.accountId, scope.chatKey, this.#maxTopics);
    const human = this.#db.prepare('SELECT message_id,ts FROM social_messages WHERE account_id=? AND chat_key=? AND self=0 ORDER BY ts DESC,rowid DESC LIMIT 1').get(scope.accountId, scope.chatKey);
    const selfTopic = this.#db.prepare('SELECT MAX(last_self_at) AS at FROM social_topics WHERE account_id=? AND chat_key=?').get(scope.accountId, scope.chatKey);
    const selfMessage = this.#db.prepare('SELECT MAX(ts) AS at FROM social_messages WHERE account_id=? AND chat_key=? AND self=1').get(scope.accountId, scope.chatKey);
    const unanswered = Number(this.#db.prepare("SELECT COUNT(*) AS n FROM social_intents WHERE account_id=? AND chat_key=? AND (status IN ('pending','leased') OR (status='completed' AND answered_at IS NULL AND expires_at>?))").get(scope.accountId, scope.chatKey, this.#time())?.n || 0);
    return { revision: this.#revision(scope), topics: topics.map((row) => this.#topic(scope, row)), lastHumanId: human ? String(human.message_id) : null, lastHumanAt: Number(human?.ts) || 0, lastSelfAt: Math.max(Number(selfTopic?.at) || 0, Number(selfMessage?.at) || 0), unansweredInitiatives: unanswered };
  }

  #intent(row, lease = false) {
    if (!row) return null;
    const result = { id: String(row.id), topicId: String(row.topic_id), sourceMessageIds: strings(json(row.source_message_ids, []), MAX_INTENT_SOURCES), sourceRefs: json(row.source_refs, []), causalRootId: String(row.causal_root_id || ''), evaluationAttempts: Number(row.evaluation_attempts) || 0, postponements: Number(row.postponements) || 0, goal: String(row.goal), dueAt: Number(row.due_at) || 0, expiresAt: Number(row.expires_at) || 0, status: String(row.status), createdAt: Number(row.created_at) || 0, updatedAt: Number(row.updated_at) || 0, answeredAt: Number(row.answered_at) || 0, reason: String(row.reason || '') };
    if (lease) { result.leaseId = row.lease_id ? String(row.lease_id) : null; result.leaseUntil = Number(row.lease_until) || 0; }
    return result;
  }

  #event(scope, row, from, to, reason, at) {
    this.#db.prepare('INSERT INTO social_intent_events(event_id,intent_id,account_id,chat_key,from_status,to_status,reason,created_at) VALUES (?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), row.id, scope.accountId, scope.chatKey, from || null, to, clean(reason, 300), at);
  }

  #transition(scope, row, status, reason, at) {
    if (!row || !OPEN.includes(String(row.status))) return false;
    this.#db.prepare('UPDATE social_intents SET status=?,reason=?,lease_id=NULL,lease_until=0,updated_at=?,finished_at=? WHERE account_id=? AND chat_key=? AND id=?').run(status, clean(reason, 300), at, at, scope.accountId, scope.chatKey, row.id);
    this.#event(scope, row, String(row.status), status, reason, at);
    return true;
  }

  observe({ accountId, chatKey, messages = [], selfId } = {}) {
    const scope = scopeOf({ accountId, chatKey });
    return this.#tx(() => {
      let changed = false;
      const observedRevision = this.#revision(scope) + 1;
      for (const raw of Array.isArray(messages) ? messages : []) {
        const message = messageData(raw, selfId);
        if (!message.id || this.#message(scope, message.id) || this.#messageByMid(scope, message.mid)) continue;
        const target = this.#replyTarget(scope, replyParts(message.reply));
        let topicId = this.#route(scope, message, target);
        if (!topicId) topicId = this.#createTopic(scope, message);
        const interaction = topicId ? this.#interactionFor(scope, topicId, message, target) : null;
        this.#db.prepare('INSERT OR IGNORE INTO social_messages(account_id,chat_key,message_id,mid,ts,sender_id,sender_name,self,text,reply_json,reply_to_message_id,reply_to_mid,mentions_self,topic_id,interaction_id,observed_at,observed_revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
          scope.accountId, scope.chatKey, message.id, message.mid, message.ts || this.#time(), message.senderId, message.senderName, message.self ? 1 : 0, message.text, message.replyJson, message.replyToMessageId, message.replyToMid, message.mentionsSelf ? 1 : 0, topicId || null, interaction?.interaction_id || null, this.#time(), observedRevision
        );
        if (interaction && message.id) {
          this.#db.prepare('UPDATE social_interactions SET last_event_at=MAX(last_event_at,?) WHERE account_id=? AND chat_key=? AND interaction_id=?')
            .run(message.ts || this.#time(), scope.accountId, scope.chatKey, interaction.interaction_id);
        }
        if (topicId) this.#touch(scope, topicId, message);
        if (topicId && !message.self) {
          const pending = this.#db.prepare("SELECT * FROM social_intents WHERE account_id=? AND chat_key=? AND topic_id=? AND status IN ('pending','leased')").all(scope.accountId, scope.chatKey, topicId);
          for (const intent of pending) {
            const roots = strings(json(intent.source_message_ids, []), MAX_INTENT_SOURCES);
            const related = String(intent.causal_root_id || '') === String(interaction?.causal_root_id || '')
              || roots.some((sourceId) => sourceId === target?.message_id || (target?.mid && String(target.mid) === sourceId));
            if (related) this.#transition(scope, intent, 'cancelled', 'related human continuation superseded due initiative', this.#time(message.ts));
          }
          const completed = this.#db.prepare("SELECT * FROM social_intents WHERE account_id=? AND chat_key=? AND topic_id=? AND status='completed' AND answered_at IS NULL AND finished_at<?").all(scope.accountId, scope.chatKey, topicId, message.ts || this.#time());
          for (const intent of completed) {
            if (String(intent.causal_root_id || '') !== String(interaction?.causal_root_id || '')) continue;
            const answeredAt = this.#time(message.ts);
            this.#db.prepare('UPDATE social_intents SET answered_at=?,updated_at=? WHERE account_id=? AND chat_key=? AND id=?').run(answeredAt, answeredAt, scope.accountId, scope.chatKey, intent.id);
            this.#event(scope, intent, 'completed', 'answered', 'human replied in the initiative topic', answeredAt);
          }
        }
        changed = true;
      }
      if (this.#resolveReplies(scope)) changed = true;
      const topics = this.#db.prepare('SELECT topic_id FROM social_topics WHERE account_id=? AND chat_key=?').all(scope.accountId, scope.chatKey);
      for (const topic of topics) this.#pruneMessages(scope, String(topic.topic_id));
      if (changed) this.#bump(scope);
      return this.#snapshot(scope);
    });
  }

  snapshot({ accountId, chatKey } = {}) {
    const scope = scopeOf({ accountId, chatKey });
    this.#requireInitialized();
    return this.#snapshot(scope);
  }

  assignTopic({ accountId, chatKey, topicId, messageIds = [], topic = '', expectedRevision } = {}) {
    const scope = scopeOf({ accountId, chatKey });
    return this.#tx(() => {
      if (expectedRevision != null && Number(expectedRevision) !== this.#revision(scope)) throw fail('STALE_REVISION', 'scene revision changed before topic assignment');
      const ids = strings(messageIds, MAX_MESSAGES_PER_TOPIC);
      if (!ids.length) throw fail('INVALID_MESSAGES', 'at least one observed message id is required');
      const messages = ids.map((messageId) => this.#message(scope, messageId));
      if (messages.some((row) => !row)) throw fail('UNKNOWN_MESSAGE', 'only host-observed message ids can be assigned');
      let targetId = id(topicId), target = targetId ? this.#topicRow(scope, targetId) : null;
      if (targetId && !target) throw fail('UNKNOWN_TOPIC', 'topicId is not in this account/chat');
      if (!targetId) {
        targetId = this.#createTopic(scope, {
          id: String(messages[0].message_id),
          senderId: messages[0].sender_id,
          self: Boolean(messages[0].self),
          ts: Number(messages[0].ts)
        }, topic, strings(messages.map((item) => item.topic_id)));
        if (!targetId) throw fail('TOPIC_LIMIT', 'no topic slot is available without evicting an active initiative');
        target = this.#topicRow(scope, targetId);
      }
      const label = clean(topic, 200), labelChanged = Boolean(label && label !== String(target.topic || ''));
      if (labelChanged) this.#db.prepare('UPDATE social_topics SET topic=? WHERE account_id=? AND chat_key=? AND topic_id=?').run(label, scope.accountId, scope.chatKey, targetId);
      const old = new Set();
      let changed = false;
      for (const row of messages) {
        if (String(row.topic_id || '') === targetId) continue;
        if (row.topic_id) old.add(String(row.topic_id));
        this.#db.prepare('UPDATE social_messages SET topic_id=?,observed_revision=? WHERE account_id=? AND chat_key=? AND message_id=?').run(targetId, this.#revision(scope) + 1, scope.accountId, scope.chatKey, row.message_id);
        changed = true;
      }
      const movedByInteraction = new Map();
      for (const row of messages) {
        if (!row.interaction_id || String(row.topic_id || '') === targetId) continue;
        const ids = movedByInteraction.get(String(row.interaction_id)) || [];
        ids.push(String(row.message_id));
        movedByInteraction.set(String(row.interaction_id), ids);
      }
      for (const [interactionId, movedIds] of movedByInteraction) {
        const remaining = this.#db.prepare('SELECT COUNT(*) AS n FROM social_messages WHERE account_id=? AND chat_key=? AND interaction_id=? AND topic_id<>?')
          .get(scope.accountId, scope.chatKey, interactionId, targetId)?.n || 0;
        if (!remaining) {
          this.#db.prepare('UPDATE social_interactions SET topic_id=? WHERE account_id=? AND chat_key=? AND interaction_id=?')
            .run(targetId, scope.accountId, scope.chatKey, interactionId);
          continue;
        }
        const previous = this.#db.prepare('SELECT * FROM social_interactions WHERE account_id=? AND chat_key=? AND interaction_id=?')
          .get(scope.accountId, scope.chatKey, interactionId);
        if (!previous) continue;
        const moved = movedIds.map((messageId) => this.#message(scope, messageId)).filter(Boolean);
        const nextInteractionId = crypto.randomUUID();
        this.#db.prepare('INSERT INTO social_interactions(account_id,chat_key,topic_id,interaction_id,causal_root_id,status,opened_at,last_event_at) VALUES (?,?,?,?,?,?,?,?)')
          .run(scope.accountId, scope.chatKey, targetId, nextInteractionId, previous.causal_root_id, 'open',
            Math.min(...moved.map((row) => Number(row.ts) || this.#time())),
            Math.max(...moved.map((row) => Number(row.ts) || this.#time())));
        for (const row of moved) {
          this.#db.prepare('UPDATE social_messages SET interaction_id=? WHERE account_id=? AND chat_key=? AND message_id=?')
            .run(nextInteractionId, scope.accountId, scope.chatKey, row.message_id);
        }
      }
      for (const previous of old) this.#recompute(scope, previous);
      if (changed || labelChanged) this.#recompute(scope, targetId);
      else if (target.status !== 'active') {
        this.#db.prepare("UPDATE social_topics SET status='active',version=version+1,updated_at=? WHERE account_id=? AND chat_key=? AND topic_id=?").run(this.#time(), scope.accountId, scope.chatKey, targetId);
        changed = true;
      }
      if (changed || labelChanged) this.#bump(scope);
      this.#pruneMessages(scope, targetId);
      return this.#topic(scope, this.#topicRow(scope, targetId));
    });
  }

  topicMessages({ accountId, chatKey, topicId, limit = 40 } = {}) {
    const scope = scopeOf({ accountId, chatKey }), topic = id(topicId);
    this.#ensure();
    if (!topic || !this.#topicRow(scope, topic)) return [];
    const cap = Math.max(1, Math.min(MAX_MESSAGES_PER_TOPIC, Math.floor(Number(limit) || 40)));
    const rows = this.#db.prepare('SELECT * FROM (SELECT rowid AS row_order,* FROM social_messages WHERE account_id=? AND chat_key=? AND topic_id=? ORDER BY ts DESC,rowid DESC LIMIT ?) ORDER BY ts,row_order').all(scope.accountId, scope.chatKey, topic, cap);
    return rows.map((row) => ({ id: String(row.message_id), mid: row.mid == null ? null : String(row.mid), ts: Number(row.ts) || 0, senderId: String(row.sender_id || ''), senderName: String(row.sender_name || ''), self: Boolean(row.self), text: String(row.text || ''), reply: json(row.reply_json, null), mentionsSelf: Boolean(row.mentions_self), topicId: String(row.topic_id), interactionId: row.interaction_id == null ? null : String(row.interaction_id), replyToMessageId: row.reply_to_message_id == null ? null : String(row.reply_to_message_id), replyToMid: row.reply_to_mid == null ? null : String(row.reply_to_mid) }));
  }

  interactionIdForMessage({ accountId, chatKey, messageId } = {}) {
    const scope = scopeOf({ accountId, chatKey });
    this.#ensure();
    return String(this.#message(scope, id(messageId))?.interaction_id || '');
  }

  interactionForMessage({ accountId, chatKey, messageId } = {}) {
    const scope = scopeOf({ accountId, chatKey });
    this.#ensure();
    const row = this.#message(scope, id(messageId));
    if (!row?.interaction_id) return null;
    const interaction = this.#db.prepare('SELECT * FROM social_interactions WHERE account_id=? AND chat_key=? AND interaction_id=?')
      .get(scope.accountId, scope.chatKey, row.interaction_id);
    return interaction ? {
      id: String(interaction.interaction_id),
      topicId: String(interaction.topic_id),
      causalRootId: String(interaction.causal_root_id),
      status: String(interaction.status),
      openedAt: Number(interaction.opened_at) || 0,
      lastEventAt: Number(interaction.last_event_at) || 0
    } : null;
  }

  sourceRefForMessage({ accountId, chatKey, messageId } = {}) {
    const scope = scopeOf({ accountId, chatKey });
    this.#ensure();
    const row = this.#message(scope, id(messageId));
    if (!row || row.self) return null;
    return {
      kind: 'message',
      id: String(row.message_id),
      revision: 1,
      scope: { accountId: scope.accountId, chatKey: scope.chatKey },
      visibility: 'chat',
      policyVersion: 'social-scene-v1'
    };
  }

  recordExternalObservation({
    accountId, chatKey, sourceId, topicId = null, sourceRefs = [], contentText = '', expiresAt, now
  } = {}) {
    const scope = scopeOf({ accountId, chatKey });
    this.#ensure();
    const source = id(sourceId);
    const refs = (Array.isArray(sourceRefs) ? sourceRefs : [])
      .filter((ref) => ref && typeof ref === 'object' && !Array.isArray(ref))
      .slice(0, 8);
    const at = this.#time(now), expiry = Number(expiresAt), topic = id(topicId);
    if (!source || !refs.length || !Number.isSafeInteger(expiry)
      || expiry <= at || expiry - at > MAX_INTENT_LIFETIME) {
      throw fail('INVALID_EXTERNAL_OBSERVATION', 'external observations need scoped refs and a bounded future expiry');
    }
    if (topic && !this.#topicRow(scope, topic)) throw fail('UNKNOWN_TOPIC', 'observation topic is outside this account/chat');
    const refsJson = JSON.stringify(refs), content = clean(contentText, 2400);
    const unreferenced = `NOT EXISTS (
      SELECT 1 FROM social_intents i, json_each(i.source_refs) r
      WHERE i.account_id=social_external_observations.account_id
        AND i.chat_key=social_external_observations.chat_key
        AND i.status IN ('pending','leased','held')
        AND json_extract(r.value,'$.kind')='external_observation'
        AND json_extract(r.value,'$.id')=social_external_observations.source_id
    )`;
    this.#tx(() => {
      const existing = this.#db.prepare('SELECT topic_id,source_refs,content_text,expires_at FROM social_external_observations WHERE account_id=? AND chat_key=? AND source_id=?')
        .get(scope.accountId, scope.chatKey, source);
      if (existing) {
        if (String(existing.topic_id || '') !== topic
          || stableJson(json(existing.source_refs, [])) !== stableJson(refs)
          || String(existing.content_text || '') !== content) {
          throw fail('EXTERNAL_OBSERVATION_IMMUTABLE', 'an external source id cannot be rewritten with different content');
        }
        if (Number(existing.expires_at) <= at) {
          throw fail('EXTERNAL_OBSERVATION_EXPIRED', 'an expired source cannot be renewed under the same id');
        }
        return;
      }
      this.#db.prepare('INSERT INTO social_external_observations(account_id,chat_key,source_id,topic_id,source_refs,content_text,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(scope.accountId, scope.chatKey, source, topic || null, refsJson, content, expiry, at);
      this.#db.prepare(`DELETE FROM social_external_observations WHERE account_id=? AND chat_key=?
        AND ${unreferenced}
        AND source_id NOT IN (SELECT source_id FROM social_external_observations
          WHERE account_id=? AND chat_key=? ORDER BY created_at DESC,rowid DESC LIMIT 64)`)
        .run(scope.accountId, scope.chatKey, scope.accountId, scope.chatKey);
    });
    return { kind: 'external_observation', id: source, revision: 1, scope, visibility: 'chat', policyVersion: 'social-source-v1' };
  }

  knownExternalSourceRefs({ accountId, chatKey, now } = {}) {
    const scope = scopeOf({ accountId, chatKey }), at = this.#time(now);
    this.#ensure();
    return this.#db.prepare('SELECT source_id,expires_at FROM social_external_observations WHERE account_id=? AND chat_key=? AND expires_at>? ORDER BY created_at DESC LIMIT 32')
      .all(scope.accountId, scope.chatKey, at)
      .map((row) => ({
        kind: 'external_observation',
        id: String(row.source_id),
        revision: 1,
        scope,
        visibility: 'chat',
        policyVersion: 'social-source-v1'
      }));
  }

  externalObservationText({ accountId, chatKey, sourceId, now } = {}) {
    const scope = scopeOf({ accountId, chatKey }), at = this.#time(now);
    this.#ensure();
    const row = this.#db.prepare('SELECT content_text FROM social_external_observations WHERE account_id=? AND chat_key=? AND source_id=? AND expires_at>?')
      .get(scope.accountId, scope.chatKey, id(sourceId), at);
    return String(row?.content_text || '').slice(0, 2400);
  }

  validateSourceRefs({ accountId, chatKey, refs = [], now } = {}) {
    const scope = scopeOf({ accountId, chatKey }), at = this.#time(now);
    if (!Array.isArray(refs) || refs.length > MAX_INTENT_SOURCES) {
      return { valid: [], invalidRefs: [{ reason: 'invalid_source_ref_list' }] };
    }
    this.#ensure();
    const valid = [], invalidRefs = [];
    for (const ref of refs) {
      let external = ref?.kind === 'external_observation'
        ? this.#db.prepare(`SELECT source_id,source_refs FROM social_external_observations
            WHERE account_id=? AND chat_key=? AND source_id=? AND expires_at>?`)
          .get(scope.accountId, scope.chatKey, String(ref.id || ''), at)
        : null;
      if (external && json(external.source_refs, []).some((parent) => parent?.kind === 'configured_interest'
        && stableJson(this.interests.ref(scope, parent.id)) !== stableJson(parent))) external = null;
      const current = ref?.kind === 'message'
        ? this.sourceRefForMessage({ ...scope, messageId: ref.id })
        : ref?.kind === 'configured_interest' ? this.interests.ref(scope, ref.id)
        : external
          ? { kind: 'external_observation', id: String(ref.id), revision: 1, scope, visibility: 'chat', policyVersion: 'social-source-v1' }
          : null;
      if (!current || stableJson(current) !== stableJson(ref)) invalidRefs.push(ref);
      else valid.push(current);
    }
    return { valid, invalidRefs };
  }

  recordOutcome({ accountId, chatKey, topicId, targetMessageId = null, targetMessageIds = [], action, sent = [], runId, initiativeId = null, intentLeaseId = null, outcome = 'sent' } = {}) {
    const scope = scopeOf({ accountId, chatKey });
    return this.#tx(() => {
      const topic = id(topicId), target = id(targetMessageIds[0] || targetMessageId) || null;
      if (!topic || !this.#topicRow(scope, topic)) throw fail('UNKNOWN_TOPIC', 'outcome topic is not in this account/chat');
      if (target && !this.#message(scope, target)) throw fail('UNKNOWN_MESSAGE', 'outcome target must be host-observed in this account/chat');
      const initiative = id(initiativeId) || null;
      const intent = initiative ? this.#db.prepare('SELECT * FROM social_intents WHERE account_id=? AND chat_key=? AND id=?').get(scope.accountId, scope.chatKey, initiative) : null;
      if (initiative && !intent) throw fail('UNKNOWN_INTENT', 'initiative is not in this account/chat');
      if (initiative && String(intent.status) === 'leased' && String(intent.lease_id || '') !== String(intentLeaseId || '')) {
        throw fail('INTENT_LEASE_MISMATCH', 'only the current lease owner can record this initiative outcome');
      }
      const actionValue = clean(action || 'reply', 40), outcomeValue = clean(outcome || 'sent', 40).toLowerCase();
      const sentValue = (Array.isArray(sent) ? sent : sent == null ? [] : [sent]).slice(0, 20).map((value) => typeof value === 'string' ? clean(value, 4000) : value);
      const sentJson = JSON.stringify(sentValue), run = clean(runId || '', 200);
      const key = hash(run ? 'run:' + run : JSON.stringify([topic, target, actionValue, initiative, outcomeValue, sentJson]));
      const now = this.#time(), outcomeId = crypto.randomUUID();
      const inserted = this.#db.prepare('INSERT OR IGNORE INTO social_outcomes(outcome_id,account_id,chat_key,idempotency_key,topic_id,target_message_id,action,sent_json,run_id,initiative_id,outcome,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(outcomeId, scope.accountId, scope.chatKey, key, topic, target, actionValue, sentJson, run, initiative, outcomeValue, now).changes > 0;
      if (inserted) {
        const visible = extractSentTexts(sentValue).length > 0 || sentValue.some((item) => item && typeof item === 'object');
        if (visible && ['sent', 'partial', 'delivered'].includes(outcomeValue)) this.#db.prepare("UPDATE social_topics SET last_self_at=?,updated_at=?,version=version+1,status='active' WHERE account_id=? AND chat_key=? AND topic_id=?").run(now, now, scope.accountId, scope.chatKey, topic);
        if (actionValue === 'close') this.#db.prepare("UPDATE social_topics SET status='closed',updated_at=?,version=version+1 WHERE account_id=? AND chat_key=? AND topic_id=?").run(now, scope.accountId, scope.chatKey, topic);
        if (initiative && OPEN.includes(String(intent.status))) {
          const next = ['unknown', 'partial', 'held', 'uncertain'].includes(outcomeValue) ? 'held' : 'completed';
          this.#transition(scope, intent, next, next === 'completed' ? 'initiative delivery recorded' : 'delivery outcome ' + outcomeValue + ' is not safe to replay', now);
          if (next === 'completed' && !visible) {
            this.#db.prepare('UPDATE social_intents SET answered_at=? WHERE account_id=? AND chat_key=? AND id=?').run(now, scope.accountId, scope.chatKey, initiative);
          }
        }
        this.#bump(scope);
      }
      const row = this.#db.prepare('SELECT * FROM social_outcomes WHERE account_id=? AND chat_key=? AND idempotency_key=?').get(scope.accountId, scope.chatKey, key);
      return { id: String(row.outcome_id), topicId: String(row.topic_id), targetMessageId: row.target_message_id == null ? null : String(row.target_message_id), action: String(row.action), sent: json(row.sent_json, []), runId: String(row.run_id || ''), initiativeId: row.initiative_id == null ? null : String(row.initiative_id), outcome: String(row.outcome), createdAt: Number(row.created_at) || 0, duplicate: !inserted };
    });
  }

  addIntent({ accountId, chatKey, topicId, sourceMessageIds = [], sourceRefs = [], goal, dueAt, expiresAt } = {}) {
    const scope = scopeOf({ accountId, chatKey });
    if (!Array.isArray(sourceMessageIds) || sourceMessageIds.length > MAX_INTENT_SOURCES
      || sourceMessageIds.some((value) => !['string', 'number'].includes(typeof value) || !id(value))
      || !Array.isArray(sourceRefs) || sourceRefs.length > MAX_INTENT_SOURCES
      || sourceRefs.some((ref) => !ref || typeof ref !== 'object' || Array.isArray(ref))) {
      throw fail('INVALID_SOURCES', 'initiative sources must be complete bounded lists');
    }
    return this.#tx(() => {
      const topic = id(topicId);
      if (!topic || !this.#topicRow(scope, topic)) throw fail('UNKNOWN_TOPIC', 'initiative topic is not in this account/chat');
      const sources = strings(sourceMessageIds, MAX_INTENT_SOURCES);
      const refs = sourceRefs;
      const checkedRefs = this.validateSourceRefs({ ...scope, refs });
      if (checkedRefs.invalidRefs.length) throw fail('INVALID_SOURCES', 'initiative source references are not current or visible');
      for (const ref of checkedRefs.valid) {
        if (ref.kind === 'message') {
          const source = this.#message(scope, ref.id);
          if (!source || source.self || String(source.topic_id || '') !== topic) throw fail('INVALID_SOURCES', 'initiative message sources must be human messages in its topic');
        } else if (ref.kind === 'external_observation') {
          const source = this.#db.prepare('SELECT topic_id FROM social_external_observations WHERE account_id=? AND chat_key=? AND source_id=?').get(scope.accountId, scope.chatKey, ref.id);
          if (source?.topic_id && String(source.topic_id) !== topic) throw fail('INVALID_SOURCES', 'external source is outside the initiative topic');
        }
      }
      if (!sources.length && !refs.length) throw fail('INVALID_SOURCES', 'initiative needs host-observed source material');
      for (const sourceId of sources) {
        const source = this.#message(scope, sourceId);
        if (!source || String(source.topic_id || '') !== topic || source.self) throw fail('INVALID_SOURCES', 'initiative sources must be observed human messages in its topic');
      }
      const goalValue = clean(goal, 300);
      if (goalValue.length < 4 || /\b(?:send|post|publish|poke)\s+(?:(?:a|the)\s+)?(?:message|reply|notification)\b|\b(?:run|execute|invoke)\b[^.!?]{0,30}\b(?:tool|command|script|api)\b|\b(?:delete|write to|edit file|change setting|auto(?:matic)?[- ]retry|schedule another)\b|调用(?:工具|接口)|执行(?:命令|脚本)|删除(?:文件|数据)|自动重试/i.test(goalValue)) throw fail('INVALID_GOAL', 'initiative goal must be a bounded conversational goal, not an operation');
      const now = this.#time(), due = Number(dueAt), expiry = Number(expiresAt);
      if (!Number.isSafeInteger(due) || !Number.isSafeInteger(expiry) || due <= now || expiry <= due || expiry - now > MAX_INTENT_LIFETIME) throw fail('INVALID_DATES', 'initiative needs future due and expiry times within 30 days');
      const firstSource = sources.length ? this.#message(scope, sources[0]) : null;
      const sourceInteraction = firstSource?.interaction_id
        ? this.#db.prepare('SELECT causal_root_id FROM social_interactions WHERE account_id=? AND chat_key=? AND interaction_id=?')
          .get(scope.accountId, scope.chatKey, firstSource.interaction_id)
        : null;
      const causalRootId = sources.length
        ? String(sourceInteraction?.causal_root_id || sources[0])
        : String(refs[0]?.id || '');
      const semantic = hash(JSON.stringify([causalRootId, sources.slice().sort(), refs.map((ref) => [ref.kind, ref.id, ref.revision]).sort(), goalNorm(goalValue)]));
      const existing = this.#db.prepare('SELECT * FROM social_intents WHERE account_id=? AND chat_key=? AND semantic_key=?').get(scope.accountId, scope.chatKey, semantic);
      if (existing) return this.#intent(existing);
      const active = this.#db.prepare("SELECT id FROM social_intents WHERE account_id=? AND chat_key=? AND (status IN ('pending','leased') OR (status='completed' AND answered_at IS NULL AND expires_at>?)) LIMIT 1").get(scope.accountId, scope.chatKey, now);
      if (active) throw fail('INITIATIVE_LIMIT', 'one unanswered initiative is allowed per account/chat');
      const intentId = crypto.randomUUID();
      this.#db.prepare("INSERT INTO social_intents(id,account_id,chat_key,topic_id,source_message_ids,source_refs,causal_root_id,goal,semantic_key,due_at,expires_at,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)").run(intentId, scope.accountId, scope.chatKey, topic, JSON.stringify(sources), JSON.stringify(refs), causalRootId, goalValue, semantic, Math.round(due), Math.round(expiry), now, now);
      const row = this.#db.prepare('SELECT * FROM social_intents WHERE id=?').get(intentId);
      this.#event(scope, row, null, 'pending', 'grounded initiative created', now);
      this.#bump(scope);
      return this.#intent(row);
    });
  }

  requestInterestOpportunity({ accountId, chatKey, sourceId, sourceRevision, topicId, goal, dueAt, expiresAt }) {
    const scope = scopeOf({ accountId, chatKey });
    this.#ensure();
    const ref = this.interests.ref(scope, sourceId);
    if (!ref || ref.revision !== sourceRevision) throw fail('INVALID_SOURCES', 'Interest source is disabled, stale or outside this scope');
    const topic = this.#topicRow(scope, String(topicId || ''));
    if (!topic || topic.status !== 'active' || !topic.last_human_id) throw fail('UNKNOWN_TOPIC', 'Choose an active host-observed shared topic');
    this.claimDue({ ...scope, claim: false });
    return this.addIntent({ ...scope, topicId, sourceRefs: [ref], goal, dueAt, expiresAt });
  }

  claimDue({ accountId, chatKey, now, leaseMs = 180000, claim = true } = {}) {
    const scope = scopeOf({ accountId, chatKey });
    return this.#tx(() => {
      const at = this.#time(now), lease = Math.max(1000, Math.min(5 * 60 * 1000, Math.floor(Number(leaseMs) || 180000)));
      const expired = this.#db.prepare("SELECT * FROM social_intents WHERE account_id=? AND chat_key=? AND status='pending' AND expires_at<=?").all(scope.accountId, scope.chatKey, at);
      for (const row of expired) this.#transition(scope, row, 'expired', 'initiative expired before claim', at);
      const leases = this.#db.prepare("SELECT * FROM social_intents WHERE account_id=? AND chat_key=? AND status='leased' AND lease_until<=?").all(scope.accountId, scope.chatKey, at);
      for (const row of leases) this.#transition(scope, row, 'held', 'lease expired with delivery outcome unknown; not replayed', at);
      if (!claim) { if (expired.length || leases.length) this.#bump(scope); return null; }
      const due = this.#db.prepare("SELECT * FROM social_intents WHERE account_id=? AND chat_key=? AND status='pending' AND due_at<=? AND expires_at>? ORDER BY due_at,created_at LIMIT 1").get(scope.accountId, scope.chatKey, at, at);
      if (!due) { if (expired.length || leases.length) this.#bump(scope); return null; }
      if (!this.#topicRow(scope, due.topic_id)) { this.#transition(scope, due, 'held', 'initiative topic is no longer available', at); this.#bump(scope); return null; }
      const leaseId = crypto.randomUUID();
      this.#db.prepare("UPDATE social_intents SET status='leased',lease_id=?,lease_until=?,updated_at=?,evaluation_attempts=evaluation_attempts+1,reason='' WHERE account_id=? AND chat_key=? AND id=? AND status='pending'").run(leaseId, at + lease, at, scope.accountId, scope.chatKey, due.id);
      this.#event(scope, due, 'pending', 'leased', 'due initiative claimed', at);
      this.#bump(scope);
      return this.#intent(this.#db.prepare('SELECT * FROM social_intents WHERE account_id=? AND chat_key=? AND id=?').get(scope.accountId, scope.chatKey, due.id), true);
    });
  }

  finishIntent({ accountId, chatKey, id: intentId, leaseId = null, status, reason = '' } = {}) {
    const scope = scopeOf({ accountId, chatKey });
    return this.#tx(() => {
      const next = id(status).toLowerCase();
      if (!TERMINAL.includes(next)) throw fail('INVALID_INTENT_STATUS', 'finish status must be a terminal initiative state');
      const row = this.#db.prepare('SELECT * FROM social_intents WHERE account_id=? AND chat_key=? AND id=?').get(scope.accountId, scope.chatKey, id(intentId));
      if (!row) return null;
      if (String(row.status) === 'leased' && String(row.lease_id || '') !== String(leaseId || '')) {
        throw fail('INTENT_LEASE_MISMATCH', 'only the current lease owner can resolve this initiative');
      }
      if (!OPEN.includes(String(row.status))) {
        if (String(row.status) !== next) throw fail('INTENT_TERMINAL', 'initiative already has a terminal state');
        return this.#intent(row, true);
      }
      const at = this.#time();
      this.#transition(scope, row, next, reason || ('initiative marked ' + next), at);
      this.#bump(scope);
      return this.#intent(this.#db.prepare('SELECT * FROM social_intents WHERE account_id=? AND chat_key=? AND id=?').get(scope.accountId, scope.chatKey, id(intentId)), true);
    });
  }

  cancelIntent({ accountId, chatKey, id: intentId, reason = '' } = {}) {
    const scope = scopeOf({ accountId, chatKey });
    return this.#tx(() => {
      const row = this.#db.prepare('SELECT * FROM social_intents WHERE account_id=? AND chat_key=? AND id=?').get(scope.accountId, scope.chatKey, id(intentId));
      if (!row) return null;
      if (String(row.status) === 'cancelled') return this.#intent(row, true);
      if (!OPEN.includes(String(row.status))) throw fail('INTENT_TERMINAL', 'only pending or leased initiatives can be cancelled');
      const at = this.#time(), why = clean(reason || 'cancelled by host operator', 300);
      this.#transition(scope, row, 'cancelled', why, at);
      this.#bump(scope);
      return this.#intent(this.#db.prepare('SELECT * FROM social_intents WHERE account_id=? AND chat_key=? AND id=?').get(scope.accountId, scope.chatKey, id(intentId)), true);
    });
  }

  listIntents({ accountId, chatKey, limit = 50 } = {}) {
    const scope = scopeOf({ accountId, chatKey });
    this.#requireInitialized();
    const cap = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)));
    return this.#db.prepare('SELECT * FROM social_intents WHERE account_id=? AND chat_key=? ORDER BY created_at DESC,id DESC LIMIT ?').all(scope.accountId, scope.chatKey, cap).map((row) => this.#intent(row));
  }

  getIntent({ accountId, chatKey, id: intentId } = {}) {
    const scope = scopeOf({ accountId, chatKey });
    this.#requireInitialized();
    const row = this.#db.prepare('SELECT * FROM social_intents WHERE account_id=? AND chat_key=? AND id=?')
      .get(scope.accountId, scope.chatKey, id(intentId));
    return row ? this.#intent(row, true) : null;
  }

  eligibleToSend({ accountId, chatKey, topicId, targetMessageId = null, targetMessageIds = [], snapshotRevision, coveredMessageIds = [], currentMessages = [], text = '', initiativeId = null, intentLeaseId = null, direct = false } = {}) {
    const scope = scopeOf({ accountId, chatKey });
    return this.#tx(() => {
    const topic = id(topicId), topicRow = topic ? this.#topicRow(scope, topic) : null;
    if (!topicRow || String(topicRow.status) !== 'active') return { allowed: false, reason: 'unknown-or-closed-topic' };
    if (snapshotRevision != null && Number(snapshotRevision) > this.#revision(scope)) return { allowed: false, reason: 'invalid-future-revision' };
    const targets = strings(targetMessageIds.length ? targetMessageIds : targetMessageId ? [targetMessageId] : [], MAX_TARGETS);
    const targetRows = targets.map((target) => this.#message(scope, target));
    if (!targets.length && !direct) return { allowed: false, reason: 'missing-target' };
    if (targetRows.some((target) => !target || String(target.topic_id || '') !== topic)) return { allowed: false, reason: 'target-not-in-topic' };
    if (targetRows.some((target) => target.self)) return { allowed: false, reason: 'target-is-self' };
    const targetSet = new Set(targets);
    const covered = new Set(strings(coveredMessageIds));
    const baselineRevision = snapshotRevision == null
      ? Math.max(0, ...targetRows.map((target) => Number(target?.observed_revision) || 0))
      : Number(snapshotRevision);
    const participants = new Set(strings(json(topicRow.participant_ids, [])));
    const targetTimes = targetRows.map((target) => Number(target?.ts) || 0);
    const newerRows = this.#db.prepare('SELECT * FROM social_messages WHERE account_id=? AND chat_key=? AND topic_id=? AND self=0 AND observed_revision>? ORDER BY observed_revision,rowid LIMIT 200')
      .all(scope.accountId, scope.chatKey, topic, baselineRevision);
    for (const row of newerRows) {
      const messageId = String(row.message_id);
      if (targetSet.has(messageId) || covered.has(messageId)) continue;
      const repliesToTarget = targetRows.some((target) =>
        row.reply_to_message_id === String(target.message_id)
        || (target.mid && row.reply_to_mid === String(target.mid)));
      const withdrawn = /(?:不用了|不需要了|算了|撤回|忽略刚才|ignore (?:that|my last)|never mind|cancel that)/i.test(String(row.text || ''));
      if (repliesToTarget || withdrawn) return { allowed: false, reason: 'target-withdrawn-or-updated' };
    }
    for (const raw of Array.isArray(currentMessages) ? currentMessages : []) {
      const current = messageData(raw, '');
      if (!current.id || targetSet.has(current.id) || covered.has(current.id) || current.self) continue;
      const stored = this.#message(scope, current.id);
      if (stored) {
        if (String(stored.topic_id || '') === topic && Number(stored.observed_revision) > baselineRevision) {
          const repliesToTarget = targetRows.some((target) =>
            stored.reply_to_message_id === String(target.message_id)
            || (target.mid && stored.reply_to_mid === String(target.mid)));
          const withdrawn = /(?:不用了|不需要了|算了|撤回|忽略刚才|ignore (?:that|my last)|never mind|cancel that)/i.test(String(stored.text || ''));
          if (repliesToTarget || withdrawn) return { allowed: false, reason: 'target-withdrawn-or-updated' };
        }
        continue;
      }
      const ref = this.#replyTarget(scope, replyParts(current.reply));
      if (ref && String(ref.topic_id || '') === topic && targetSet.has(String(ref.message_id))) return { allowed: false, reason: 'new-relevant-message' };
      const at = current.ts || this.#time();
      if (targetTimes.length && at < Math.max(...targetTimes)) continue;
      if (current.mentionsSelf && (direct || participants.has(current.senderId))) return { allowed: false, reason: 'new-relevant-message' };
    }
    const initiative = id(initiativeId);
    if (initiative) {
      const intent = this.#db.prepare('SELECT * FROM social_intents WHERE account_id=? AND chat_key=? AND id=?').get(scope.accountId, scope.chatKey, initiative);
      if (!intent || String(intent.topic_id) !== topic) return { allowed: false, reason: 'unknown-initiative' };
      if (String(intent.status) !== 'leased') return { allowed: false, reason: 'initiative-not-leased' };
      if (String(intent.lease_id || '') !== String(intentLeaseId || '')) return { allowed: false, reason: 'initiative-lease-mismatch' };
      if (Number(intent.lease_until) <= this.#time()) return { allowed: false, reason: 'initiative-lease-expired' };
      if (this.#db.prepare('SELECT 1 FROM social_outcomes WHERE account_id=? AND chat_key=? AND initiative_id=? LIMIT 1').get(scope.accountId, scope.chatKey, initiative)) return { allowed: false, reason: 'initiative-already-recorded' };
    }
    const candidate = clean(text, 10000), normalized = norm(candidate);
    if (normalized && !commonAck(candidate)) {
      const targetId = targets[0] || null;
      const rows = this.#db.prepare("SELECT sent_json FROM social_outcomes WHERE account_id=? AND chat_key=? AND topic_id=? AND target_message_id IS ? AND outcome IN ('sent','partial','delivered','unknown','uncertain','held') ORDER BY created_at DESC LIMIT 100").all(scope.accountId, scope.chatKey, topic, targetId);
      for (const row of rows) if (extractSentTexts(json(row.sent_json, [])).some((previous) => norm(previous) === normalized)) return { allowed: false, reason: 'duplicate-target-content' };
    }
    return { allowed: true, reason: 'ok' };
    });
  }
}
