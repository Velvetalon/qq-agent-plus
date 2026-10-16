const defaults = () => ({ enabled: false, maxDailyRuns: 1, maxDailyTokens: 40000,
  maxRunTokens: 40000, maxModelCalls: 4, sources: [] });
const fail = (code, message) => Object.assign(new Error(message), { code });
const scopeOf = ({ accountId, chatKey }) => {
  if (!String(accountId || '').trim() || !/^(group|private):\d+$/.test(String(chatKey || ''))) {
    throw fail('INVALID_SCOPE', 'A host account and valid chat are required');
  }
  return { accountId: String(accountId), chatKey: String(chatKey) };
};
const bounded = (value, min, max, name) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw fail('INVALID_CONFIG', `Invalid ${name}`);
  return value;
};
const text = (value, max, name) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw fail('INVALID_CONFIG', `Invalid ${name}`);
  return value.trim();
};
const dayOf = (now) => new Date(now).toISOString().slice(0, 10);

// Owned by the same host database as SocialStateStore; never opens its own file.
export class SocialInterestStore {
  constructor({ db, now = Date.now }) { this.db = db; this.now = now; }
  exists() {
    return Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='social_interest_settings'").get());
  }
  ensure() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS social_interest_settings (
        account_id TEXT NOT NULL, chat_key TEXT NOT NULL, revision INTEGER NOT NULL,
        config_json TEXT NOT NULL, PRIMARY KEY(account_id,chat_key));
      CREATE TABLE IF NOT EXISTS social_interest_history (
        account_id TEXT NOT NULL, chat_key TEXT NOT NULL, revision INTEGER NOT NULL,
        config_json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(account_id,chat_key,revision));
      CREATE TABLE IF NOT EXISTS social_exploration_budget (
        account_id TEXT NOT NULL, chat_key TEXT NOT NULL, intent_id TEXT NOT NULL,
        day TEXT NOT NULL, reserved_tokens INTEGER NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY(account_id,chat_key,intent_id));
    `);
  }
  read(scope, now = this.now()) {
    const { accountId, chatKey } = scopeOf(scope);
    if (!this.exists()) return { revision: 0, ...defaults(), usage: { day: dayOf(now), runs: 0, reservedTokens: 0 } };
    const row = this.db.prepare('SELECT revision,config_json FROM social_interest_settings WHERE account_id=? AND chat_key=?').get(accountId, chatKey);
    const usage = this.db.prepare('SELECT COUNT(*) AS runs,COALESCE(SUM(reserved_tokens),0) AS reservedTokens FROM social_exploration_budget WHERE account_id=? AND chat_key=? AND day=?').get(accountId, chatKey, dayOf(now));
    return { revision: Number(row?.revision) || 0, ...(row ? JSON.parse(row.config_json) : defaults()), usage: { day: dayOf(now), ...usage } };
  }
  save({ accountId, chatKey, expectedRevision, config }) {
    const scope = scopeOf({ accountId, chatKey });
    if (!config || typeof config !== 'object' || Array.isArray(config) || typeof config.enabled !== 'boolean'
      || !Array.isArray(config.sources) || config.sources.length > 16) throw fail('INVALID_CONFIG', 'Invalid interest configuration');
    bounded(expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1, 'revision');
    const next = {
      enabled: config.enabled,
      maxDailyRuns: bounded(config.maxDailyRuns, 0, 10, 'daily runs'),
      maxDailyTokens: bounded(config.maxDailyTokens, 0, 1000000, 'daily tokens'),
      maxRunTokens: bounded(config.maxRunTokens, 2000, 160000, 'run tokens'),
      maxModelCalls: bounded(config.maxModelCalls, 1, 12, 'model calls'),
      sources: []
    };
    const ids = new Set();
    for (const item of config.sources) {
      if (!item || typeof item.enabled !== 'boolean' || typeof item.id !== 'string'
        || !/^[A-Za-z0-9_-]{1,80}$/.test(item.id) || ids.has(item.id)) {
        throw fail('INVALID_CONFIG', 'Interest source IDs must be unique and bounded');
      }
      ids.add(item.id);
      next.sources.push({ id: item.id, enabled: item.enabled, title: text(item.title, 100, 'title'), text: text(item.text, 1600, 'source text') });
    }
    this.ensure();
    this.db.exec('SAVEPOINT social_interest_save');
    try {
      const current = this.read(scope);
      if (current.revision !== expectedRevision) throw fail('STALE_REVISION', 'Interest configuration changed; reload before saving');
      const previous = new Map(current.sources.map((item) => [item.id, item]));
      next.sources = next.sources.map((item) => {
        const old = previous.get(item.id);
        const unchanged = old && old.enabled === item.enabled && old.title === item.title && old.text === item.text;
        return { ...item, revision: unchanged ? old.revision : (Number(old?.revision) || 0) + 1 };
      });
      for (const old of current.sources) if (!ids.has(old.id)) next.sources.push({ ...old, enabled: false, revision: old.revision + (old.enabled ? 1 : 0) });
      if (next.sources.length > 16) throw fail('INVALID_CONFIG', 'At most 16 retained sources; edit an existing source instead');
      const revision = current.revision + 1, encoded = JSON.stringify(next);
      this.db.prepare('INSERT INTO social_interest_settings VALUES (?,?,?,?) ON CONFLICT(account_id,chat_key) DO UPDATE SET revision=excluded.revision,config_json=excluded.config_json').run(scope.accountId, scope.chatKey, revision, encoded);
      this.db.prepare('INSERT INTO social_interest_history VALUES (?,?,?,?,?)').run(scope.accountId, scope.chatKey, revision, encoded, this.now());
      this.db.exec('RELEASE social_interest_save');
      return this.read(scope);
    } catch (error) {
      this.db.exec('ROLLBACK TO social_interest_save; RELEASE social_interest_save');
      throw error;
    }
  }
  source(scope, sourceId) {
    const config = this.read(scope);
    if (!config.enabled) return null;
    return config.sources.find((item) => item.id === sourceId && item.enabled) || null;
  }
  ref(scope, sourceId) {
    const selected = this.source(scope, sourceId);
    if (!selected) return null;
    return { kind: 'configured_interest', id: selected.id, revision: selected.revision,
      scope: scopeOf(scope), visibility: 'chat', policyVersion: 'social-interest-v1' };
  }
  reserve(scope, intent, now = this.now()) {
    this.ensure();
    const key = scopeOf(scope);
    this.db.exec('SAVEPOINT social_interest_budget');
    try {
      const config = this.read(key, now);
      const previous = this.db.prepare('SELECT 1 FROM social_exploration_budget WHERE account_id=? AND chat_key=? AND intent_id=?').get(key.accountId, key.chatKey, intent.id);
      const reason = !config.enabled ? 'exploration-disabled' : previous ? 'exploration-already-attempted'
        : config.usage.runs >= config.maxDailyRuns || config.usage.reservedTokens + config.maxRunTokens > config.maxDailyTokens
          ? 'exploration-budget-exhausted' : '';
      if (reason) { this.db.exec('RELEASE social_interest_budget'); return { ok: false, reason }; }
      this.db.prepare('INSERT INTO social_exploration_budget VALUES (?,?,?,?,?,?)').run(key.accountId, key.chatKey, intent.id, dayOf(now), config.maxRunTokens, now);
      this.db.exec('RELEASE social_interest_budget');
      return { ok: true, maxRunTokens: config.maxRunTokens, maxModelCalls: config.maxModelCalls };
    } catch (error) {
      this.db.exec('ROLLBACK TO social_interest_budget; RELEASE social_interest_budget');
      throw error;
    }
  }
}
