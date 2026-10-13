import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SocialStateStore } from '../src/conversation/state.js';

const ACCOUNT = 'account-1';
const CHAT = 'group:42';
const BASE = 1_800_000_000_000;

function makeStore({ db = new DatabaseSync(':memory:'), now = () => BASE, maxTopics = 8 } = {}) {
  return { db, store: new SocialStateStore({ db, now, maxTopics }) };
}

function incoming(id, senderId, ts, text, extra = {}) {
  return { id, mid: 'mid-' + id, ts, senderId, senderName: senderId.toUpperCase(), text, ...extra };
}

test('scene observation is lazy, scoped, idempotent, linked, and semantically reroutable', () => {
  const { db, store } = makeStore();
  try {
    assert.equal(SocialStateStore.isInitialized(db), false);
    assert.equal(SocialStateStore.isInitialized(db), false, 'read-only presence check does not create tables');
    const observed = store.observe({ accountId: ACCOUNT, chatKey: CHAT, messages: [
      incoming(1, 'alice', BASE - 3000, 'Did you try the new build?'),
      incoming(2, 'bob', BASE - 2000, 'Yes, it looks good.', { reply: { messageId: 'mid-1' } }),
      incoming(3, 'carol', BASE - 1000, 'Anyone around for lunch?')
    ] });
    assert.equal(SocialStateStore.isInitialized(db), true);
    assert.equal(observed.topics.length, 2);
    const linked = observed.topics.find((topic) => topic.messageIds.includes('1'));
    const separate = observed.topics.find((topic) => topic.messageIds.includes('3'));
    assert.ok(linked);
    assert.ok(separate);
    assert.notEqual(linked.id, separate.id);
    const entries = store.topicMessages({ accountId: ACCOUNT, chatKey: CHAT, topicId: linked.id });
    assert.deepEqual(entries.map((message) => message.id), ['1', '2']);
    assert.equal(entries[0].senderName, 'ALICE');
    assert.equal(entries[1].replyToMid, 'mid-1');

    const revision = observed.revision;
    const rerouted = store.assignTopic({ accountId: ACCOUNT, chatKey: CHAT, topicId: linked.id, messageIds: ['3'], topic: 'Build discussion', expectedRevision: revision });
    assert.ok(rerouted.messageIds.includes('3'));
    assert.throws(() => store.assignTopic({ accountId: ACCOUNT, chatKey: CHAT, topicId: linked.id, messageIds: ['3'], expectedRevision: revision }), { code: 'STALE_REVISION' });

    const afterDuplicate = store.snapshot({ accountId: ACCOUNT, chatKey: CHAT });
    const idempotent = store.observe({ accountId: ACCOUNT, chatKey: CHAT, messages: [incoming(1, 'mallory', BASE + 5000, 'rewritten')] });
    assert.equal(idempotent.revision, afterDuplicate.revision);
    assert.equal(store.topicMessages({ accountId: ACCOUNT, chatKey: CHAT, topicId: linked.id })[0].text, 'Did you try the new build?');
    assert.equal(store.snapshot({ accountId: 'another-account', chatKey: CHAT }).topics.length, 0);
  } finally {
    db.close();
  }
});

test('send guard uses topic activity after the planning baseline and exempts ordinary acknowledgements', () => {
  const { db, store } = makeStore();
  try {
    let snapshot = store.observe({ accountId: ACCOUNT, chatKey: CHAT, messages: [
      incoming(1, 'alice', BASE - 2000, 'Tell me what you think about this release.'),
      incoming(2, 'bob', BASE - 1000, 'It is stable.', { reply: { messageId: 'mid-1' } }),
      incoming(3, 'carol', BASE - 500, 'Unrelated game question.')
    ] });
    const topicId = snapshot.topics.find((topic) => topic.messageIds.includes('1')).id;
    assert.equal(store.eligibleToSend({ accountId: ACCOUNT, chatKey: CHAT, topicId, targetMessageId: '1', snapshotRevision: snapshot.revision, text: 'A substantial answer about the release.' }).allowed, true,
      'an earlier target remains valid when later context was already known at planning time');

    const baseline = snapshot.revision;
    snapshot = store.observe({ accountId: ACCOUNT, chatKey: CHAT, messages: [incoming(4, 'dave', BASE, 'A separate topic.') ] });
    assert.equal(store.eligibleToSend({ accountId: ACCOUNT, chatKey: CHAT, topicId, targetMessageId: '1', snapshotRevision: baseline, text: 'A substantial answer about the release.' }).allowed, true,
      'unrelated global chatter does not invalidate this topic');

    const currentBaseline = snapshot.revision;
    store.observe({ accountId: ACCOUNT, chatKey: CHAT, messages: [incoming(5, 'alice', BASE + 1000, 'One more release detail.') ] });
    assert.deepEqual(store.eligibleToSend({ accountId: ACCOUNT, chatKey: CHAT, topicId, targetMessageId: '1', snapshotRevision: currentBaseline, text: 'A substantial answer about the release.' }), { allowed: false, reason: 'newer-human-message-in-topic' });

    const currentTopic = store.snapshot({ accountId: ACCOUNT, chatKey: CHAT }).topics.find((topic) => topic.messageIds.includes('5'));
    const ack = store.recordOutcome({ accountId: ACCOUNT, chatKey: CHAT, topicId: currentTopic.id, targetMessageId: '5', action: 'reply', sent: ['好的！'], runId: 'ack-run' });
    assert.equal(ack.duplicate, false);
    assert.equal(store.eligibleToSend({ accountId: ACCOUNT, chatKey: CHAT, topicId: currentTopic.id, targetMessageId: '5', text: '好的' }).allowed, true);

    const sent = store.recordOutcome({ accountId: ACCOUNT, chatKey: CHAT, topicId: currentTopic.id, targetMessageId: '5', action: 'reply', sent: ['A clear and useful answer.'], runId: 'answer-run' });
    const replay = store.recordOutcome({ accountId: ACCOUNT, chatKey: CHAT, topicId: currentTopic.id, targetMessageId: '5', action: 'reply', sent: ['changed text is ignored for this run'], runId: 'answer-run' });
    assert.equal(replay.duplicate, true);
    assert.equal(replay.id, sent.id);
    assert.deepEqual(store.eligibleToSend({ accountId: ACCOUNT, chatKey: CHAT, topicId: currentTopic.id, targetMessageId: '5', text: 'A clear and useful answer.' }), { allowed: false, reason: 'duplicate-target-content' });
    assert.deepEqual(store.eligibleToSend({ accountId: ACCOUNT, chatKey: CHAT, topicId: currentTopic.id, targetMessageId: '5', direct: true, text: 'A clear and useful answer.' }), { allowed: false, reason: 'duplicate-target-content' });
  } finally {
    db.close();
  }
});

test('grounded intents are deduplicated, audited, bounded, and unknown leases are never replayed after restart', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'social-state-'));
  const filename = path.join(directory, 'host.sqlite');
  let db = new DatabaseSync(filename);
  try {
    let now = BASE;
    let store = new SocialStateStore({ db, now: () => now });
    const snapshot = store.observe({ accountId: ACCOUNT, chatKey: CHAT, messages: [incoming(1, 'alice', BASE - 1000, 'I have a presentation next week.') ] });
    const topicId = snapshot.topics[0].id;
    const draft = { accountId: ACCOUNT, chatKey: CHAT, topicId, sourceMessageIds: ['1'], goal: 'Later ask how the presentation went.', dueAt: BASE + 1000, expiresAt: BASE + 60000 };
    const intent = store.addIntent(draft);
    assert.equal(store.addIntent({ ...draft, dueAt: BASE + 2000 }).id, intent.id, 'same source and goal are idempotently deduplicated');
    assert.throws(() => store.addIntent({ ...draft, goal: 'Run the reply tool later.' }), { code: 'INVALID_GOAL' });
    assert.throws(() => store.addIntent({ ...draft, sourceMessageIds: ['missing'] }), { code: 'INVALID_SOURCES' });
    assert.equal(store.snapshot({ accountId: ACCOUNT, chatKey: CHAT }).unansweredInitiatives, 1);
    assert.equal(store.claimDue({ accountId: ACCOUNT, chatKey: CHAT, now: BASE + 500 }), null);
    const lease = store.claimDue({ accountId: ACCOUNT, chatKey: CHAT, now: BASE + 1000, leaseMs: 3000 });
    assert.equal(lease.status, 'leased');
    assert.equal(store.eligibleToSend({ accountId: ACCOUNT, chatKey: CHAT, topicId, targetMessageId: '1', snapshotRevision: snapshot.revision, initiativeId: intent.id, text: 'A friendly check-in.' }).allowed, true);
    store.recordOutcome({ accountId: ACCOUNT, chatKey: CHAT, topicId, targetMessageId: '1', action: 'reply', sent: ['A friendly check-in.'], runId: 'uncertain-run', initiativeId: intent.id, outcome: 'unknown' });
    assert.equal(store.listIntents({ accountId: ACCOUNT, chatKey: CHAT })[0].status, 'held');
    assert.equal(store.claimDue({ accountId: ACCOUNT, chatKey: CHAT, now: BASE + 10000 }), null);
    db.close();

    db = new DatabaseSync(filename);
    store = new SocialStateStore({ db, now: () => now });
    const restored = store.listIntents({ accountId: ACCOUNT, chatKey: CHAT });
    assert.equal(restored[0].status, 'held');
    assert.equal(store.claimDue({ accountId: ACCOUNT, chatKey: CHAT, now: BASE + 20000 }), null);
    assert.equal(store.snapshot({ accountId: ACCOUNT, chatKey: CHAT }).unansweredInitiatives, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM social_intent_events WHERE account_id=?').get(ACCOUNT).n >= 3, true);
  } finally {
    if (db) db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('expired leases become held and explicit cancellation is auditable', () => {
  const { db, store } = makeStore();
  try {
    const snapshot = store.observe({ accountId: ACCOUNT, chatKey: CHAT, messages: [incoming(1, 'alice', BASE - 1000, 'I am learning piano.') ] });
    const topicId = snapshot.topics[0].id;
    const leased = store.addIntent({ accountId: ACCOUNT, chatKey: CHAT, topicId, sourceMessageIds: ['1'], goal: 'Ask about their piano practice later.', dueAt: BASE + 1000, expiresAt: BASE + 60000 });
    assert.equal(store.claimDue({ accountId: ACCOUNT, chatKey: CHAT, now: BASE + 1000, leaseMs: 1000 }).status, 'leased');
    assert.equal(store.claimDue({ accountId: ACCOUNT, chatKey: CHAT, now: BASE + 2000 }), null);
    assert.equal(store.listIntents({ accountId: ACCOUNT, chatKey: CHAT })[0].status, 'held');
    assert.throws(() => store.cancelIntent({ accountId: ACCOUNT, chatKey: CHAT, id: leased.id }), { code: 'INTENT_TERMINAL' }, 'a terminal held intent is not rewritten as cancelled');

    const pending = store.addIntent({ accountId: ACCOUNT, chatKey: CHAT, topicId, sourceMessageIds: ['1'], goal: 'Ask about the recital result later.', dueAt: BASE + 3000, expiresAt: BASE + 60000 });
    const cancelled = store.cancelIntent({ accountId: ACCOUNT, chatKey: CHAT, id: pending.id, reason: 'operator request' });
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(store.cancelIntent({ accountId: ACCOUNT, chatKey: CHAT, id: pending.id }).status, 'cancelled');
    assert.equal(db.prepare("SELECT reason FROM social_intent_events WHERE intent_id=? AND to_status='cancelled'").get(pending.id).reason, 'operator request');
  } finally {
    db.close();
  }
});
