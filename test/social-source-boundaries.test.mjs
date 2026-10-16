import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SocialStateStore } from '../src/conversation/state.js';
import { validateSocialDecision, validateSocialInitiative } from '../src/conversation/runtime.js';

const now = 1_800_000_000_000;
const ids = Array.from({ length: 8 }, (_, index) => String(index + 1));
const initiative = { goal: 'Discuss the new release details', sourceMessageIds: ids.slice(0, 4), dueAt: now + 1000, expiresAt: now + 60_000 };
const options = { humanMessageIds: ids, now };

test('initiative rejects overflow and malformed source lists instead of accepting a valid prefix', () => {
  assert.ok(validateSocialInitiative(initiative, options));
  assert.equal(validateSocialInitiative({ ...initiative, sourceMessageIds: [...initiative.sourceMessageIds, 'forged'] }, options), null);
  assert.equal(validateSocialInitiative({ ...initiative, sourceRefs: 'forged' }, options), null);
  assert.equal(validateSocialInitiative({ ...initiative, sourceRefs: {} }, options), null);
});

test('decision rejects combined source/target overflow and malformed human-source lists', () => {
  const decision = { action: 'reply', goal: 'Answer the release question', novelty: 'New release detail', sourceMessageIds: ids, targetMessageIds: ['9'] };
  const context = { knownMessages: [...ids, '9'].map((id) => ({ id, self: false })), snapshot: { topics: [] } };
  assert.equal(validateSocialDecision(JSON.stringify(decision), context).ok, false);
  assert.equal(validateSocialDecision(JSON.stringify({ ...decision, sourceMessageIds: 'forged' }), context).ok, false);
  assert.equal(validateSocialDecision(JSON.stringify({ ...decision, sourceMessageIds: ['9'] }), context).ok, true);
});

test('durable store rejects invalid trailing refs without persisting a partial intent', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = new SocialStateStore({ db, now: () => now });
    const scope = { accountId: 'synthetic-account', chatKey: 'group:synthetic' };
    const snapshot = store.observe({ ...scope, messages: [{ id: '1', mid: 'mid-1', ts: now, senderId: 'member', text: 'Release discussion' }] });
    const topicId = snapshot.topics[0].id;
    const ref = store.sourceRefForMessage({ ...scope, messageId: '1' });
    const overflow = [...Array(8).fill(ref), { ...ref, id: 'forged' }];
    assert.ok(store.validateSourceRefs({ ...scope, refs: overflow }).invalidRefs.length);
    assert.ok(store.validateSourceRefs({ ...scope, refs: 'forged' }).invalidRefs.length);
    const base = { ...scope, topicId, goal: initiative.goal, dueAt: initiative.dueAt, expiresAt: initiative.expiresAt };
    for (const sourceFields of [
      { sourceRefs: overflow }, { sourceRefs: [ref, null] },
      { sourceMessageIds: Array(8).fill('1').concat('forged') },
      { sourceMessageIds: ['1', null] }, { sourceMessageIds: ['1', ''] },
      { sourceMessageIds: ['1'], sourceRefs: 'forged' }
    ]) assert.throws(() => store.addIntent({ ...base, ...sourceFields }), { code: 'INVALID_SOURCES' });
    assert.equal(store.listIntents(scope).length, 0);
    const saved = store.addIntent({ ...base, sourceRefs: [ref] });
    assert.ok(saved.id);
    assert.equal(store.addIntent({ ...base, sourceRefs: [ref] }).id, saved.id);
    assert.equal(store.listIntents(scope).length, 1);
  } finally { db.close(); }
});
