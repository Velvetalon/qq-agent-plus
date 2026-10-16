import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SocialStateStore } from '../src/conversation/state.js';
import { SocialInterestStore } from '../src/conversation/interests.js';

const scope = { accountId: '888', chatKey: 'group:1' };
const config = () => ({ enabled: true, maxDailyRuns: 1, maxDailyTokens: 40000,
  maxRunTokens: 40000, maxModelCalls: 4,
  sources: [{ id: 'astronomy', title: '天文', text: '共同关注新发布的星空观测资料。', enabled: true }] });

test('interest configuration is lazy, scoped, CAS protected and retains disabled source history', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const interests = new SocialInterestStore({ db });
    assert.equal(interests.read(scope).enabled, false);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'social_%'").get().n, 0);
    const saved = interests.save({ ...scope, expectedRevision: 0, config: config() });
    assert.equal(saved.sources[0].revision, 1);
    assert.equal(interests.read({ ...scope, accountId: 'other' }).revision, 0);
    assert.equal(interests.read({ ...scope, chatKey: 'group:2' }).revision, 0);
    assert.throws(() => interests.save({ ...scope, expectedRevision: 0, config: config() }), { code: 'STALE_REVISION' });
    assert.equal(interests.read(scope).revision, 1);
    const ref = interests.ref(scope, 'astronomy');
    const paused = interests.save({ ...scope, expectedRevision: 1, config: { ...saved, enabled: false } });
    assert.equal(interests.ref(scope, 'astronomy'), null);
    interests.save({ ...scope, expectedRevision: paused.revision, config: saved });
    assert.deepEqual(interests.ref(scope, 'astronomy'), ref, 'master pause does not rewrite the source');
    const removed = interests.save({ ...scope, expectedRevision: 3, config: { ...saved, sources: [] } });
    assert.equal(removed.sources[0].enabled, false);
    assert.equal(removed.sources[0].revision, 2);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM social_interest_history').get().n, 4);
    for (const invalid of [{ maxDailyRuns: NaN }, { maxRunTokens: 1 }, { sources: [...config().sources, ...config().sources] }]) {
      assert.throws(() => interests.save({ ...scope, expectedRevision: 4, config: { ...config(), ...invalid } }), { code: 'INVALID_CONFIG' });
    }
  } finally { db.close(); }
});

test('daily budget is durable across connections/restart, never refunds attempts and resets by UTC day', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-interest-budget-'));
  const file = path.join(root, 'host.sqlite');
  let db = new DatabaseSync(file), other = new DatabaseSync(file);
  let now = Date.UTC(2026, 9, 16, 23, 59);
  try {
    let store = new SocialInterestStore({ db, now: () => now });
    store.save({ ...scope, expectedRevision: 0, config: config() });
    assert.equal(store.reserve(scope, { id: 'attempt-1' }).ok, true);
    const concurrent = new SocialInterestStore({ db: other, now: () => now });
    assert.equal(concurrent.reserve(scope, { id: 'attempt-2' }).reason, 'exploration-budget-exhausted');
    db.close(); db = new DatabaseSync(file); store = new SocialInterestStore({ db, now: () => now });
    assert.equal(store.reserve(scope, { id: 'attempt-1' }).reason, 'exploration-already-attempted');
    now += 120000;
    assert.equal(store.reserve(scope, { id: 'attempt-2' }).ok, true);
    assert.equal(store.read(scope).usage.runs, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM social_exploration_budget').get().n, 2);
  } finally { db.close(); other.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('opportunities require a current configured source and shared topic, revoke descendants and retain unknown leases', () => {
  const db = new DatabaseSync(':memory:');
  let now = Date.UTC(2026, 9, 16);
  try {
    const state = new SocialStateStore({ db, now: () => now });
    const scene = state.observe({ ...scope, messages: [{ id: '1', mid: '1', ts: now, senderId: '42', text: 'We discussed astronomy.' }] });
    const saved = state.interests.save({ ...scope, expectedRevision: 0, config: config() });
    const args = { ...scope, sourceId: 'astronomy', sourceRevision: 1, topicId: scene.topics[0].id,
      goal: 'Discuss the new astronomy observations', dueAt: now + 1000, expiresAt: now + 60000 };
    assert.throws(() => state.requestInterestOpportunity({ ...args, accountId: 'other' }), { code: 'INVALID_SOURCES' });
    assert.throws(() => state.requestInterestOpportunity({ ...args, sourceRevision: 2 }), { code: 'INVALID_SOURCES' });
    assert.throws(() => state.requestInterestOpportunity({ ...args, topicId: 'made-up' }), { code: 'UNKNOWN_TOPIC' });
    const intent = state.requestInterestOpportunity(args);
    assert.deepEqual(intent.sourceMessageIds, [], 'configured material is not manufactured human evidence');
    assert.equal(state.requestInterestOpportunity(args).id, intent.id);
    const parent = state.interests.ref(scope, 'astronomy');
    const external = state.recordExternalObservation({ ...scope, sourceId: 'public-result', sourceRefs: [parent], contentText: 'A public observation', expiresAt: now + 50000 });
    state.interests.save({ ...scope, expectedRevision: saved.revision, config: { ...saved,
      sources: [{ ...saved.sources[0], text: 'Updated material' }] } });
    assert.equal(state.validateSourceRefs({ ...scope, refs: [parent, external] }).invalidRefs.length, 2);
    state.cancelIntent({ ...scope, id: intent.id, reason: 'source replaced' });
    const newer = state.requestInterestOpportunity({ ...args, sourceRevision: 2 });
    assert.notEqual(newer.id, intent.id);
    now += 1000;
    const leased = state.claimDue({ ...scope, now, leaseMs: 1000 });
    assert.equal(leased.id, newer.id);
    now += 1001;
    state.claimDue({ ...scope, now, claim: false });
    assert.equal(state.getIntent({ ...scope, id: newer.id }).status, 'held');
    assert.equal(state.claimDue({ ...scope, now }), null);
    assert.throws(() => state.cancelIntent({ ...scope, id: newer.id }), { code: 'INTENT_TERMINAL' });
  } finally { db.close(); }
});
