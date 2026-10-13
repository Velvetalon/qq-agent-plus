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
    assert.equal(store.interactionForMessage({ accountId: ACCOUNT, chatKey: CHAT, messageId: '3' }).topicId, linked.id);
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

test('persistent interaction identity follows explicit replies without mixing platform and local ids', () => {
  const { db, store } = makeStore();
  try {
    const snapshot = store.observe({ accountId: ACCOUNT, chatKey: CHAT, messages: [
      incoming('77', 'alice', BASE - 5000, 'Here is the release question.', { mid: '700' }),
      incoming('700', 'bob', BASE - 4000, 'Separate local ID collision.', { mid: '800' }),
      incoming('78', 'alice', BASE - 3000, 'A direct continuation.', { mid: '701', reply: { messageId: '700' } })
    ] });
    const first = store.topicMessages({ accountId: ACCOUNT, chatKey: CHAT, topicId: snapshot.topics.find((item) => item.messageIds.includes('77')).id });
    assert.deepEqual(first.map((item) => item.id), ['77', '78']);
    assert.equal(first[0].interactionId, first[1].interactionId);
    assert.notEqual(store.interactionIdForMessage({ accountId: ACCOUNT, chatKey: CHAT, messageId: '700' }), first[0].interactionId,
      'a platform mid collision does not resolve as a local message ID');
    store.observe({ accountId: ACCOUNT, chatKey: CHAT, messages: [
      incoming('80', 'carol', BASE - 2000, 'Quoting the same original point.', { mid: '702', reply: { messageId: '700' } }),
      incoming('81', 'dave', BASE - 1000, 'Another quote of that same point.', { mid: '703', reply: { messageId: '700' } })
    ] });
    assert.equal(store.interactionIdForMessage({ accountId: ACCOUNT, chatKey: CHAT, messageId: '80' }), first[0].interactionId);
    assert.equal(store.interactionIdForMessage({ accountId: ACCOUNT, chatKey: CHAT, messageId: '81' }), first[0].interactionId);
    assert.equal(store.interactionForMessage({ accountId: ACCOUNT, chatKey: CHAT, messageId: '81' }).causalRootId, '77');

    const next = store.observe({ accountId: ACCOUNT, chatKey: CHAT, messages: [
      incoming('79', 'alice', BASE + 60 * 60 * 1000, 'A genuinely new question.', { mid: '704' })
    ] });
    const newTopic = next.topics.find((item) => item.messageIds.includes('79'));
    assert.ok(newTopic, JSON.stringify(next.topics));
    assert.notEqual(store.interactionIdForMessage({ accountId: ACCOUNT, chatKey: CHAT, messageId: '79' }), first[0].interactionId);
  } finally {
    db.close();
  }
});

test('external observations are scoped, expiring host sources rather than model-created IDs', () => {
  const { db, store } = makeStore();
  try {
    const snapshot = store.observe({ accountId: ACCOUNT, chatKey: CHAT, messages: [incoming(1, 'alice', BASE - 1000, 'I like astronomy.') ] });
    const topicId = snapshot.topics[0].id;
    const observation = store.recordExternalObservation({
      accountId: ACCOUNT,
      chatKey: CHAT,
      sourceId: 'web:astronomy:1',
      topicId,
      sourceRefs: [{ kind: 'web', id: 'public-result-1', revision: 1 }],
      contentText: 'A scoped public astronomy observation.',
      expiresAt: BASE + 60_000,
      now: BASE
    });
    assert.deepEqual(store.validateSourceRefs({ accountId: ACCOUNT, chatKey: CHAT, refs: [observation], now: BASE }), {
      valid: [observation],
      invalidRefs: []
    });
    assert.equal(store.validateSourceRefs({ accountId: 'other', chatKey: CHAT, refs: [observation], now: BASE }).invalidRefs.length, 1);
    assert.equal(store.validateSourceRefs({ accountId: ACCOUNT, chatKey: CHAT, refs: [observation], now: BASE + 60_000 }).invalidRefs.length, 1);
    assert.equal(store.validateSourceRefs({ accountId: ACCOUNT, chatKey: CHAT, refs: [{ ...observation, id: 'model-asserted' }], now: BASE }).invalidRefs.length, 1);
    const input = {
      accountId: ACCOUNT, chatKey: CHAT, sourceId: observation.id, topicId,
      sourceRefs: [{ kind: 'web', id: 'public-result-1', revision: 1 }],
      contentText: 'A scoped public astronomy observation.',
      expiresAt: BASE + 120_000, now: BASE + 1000
    };
    assert.deepEqual(store.recordExternalObservation(input), observation);
    assert.equal(db.prepare('SELECT expires_at FROM social_external_observations WHERE source_id=?')
      .get(observation.id).expires_at, BASE + 60_000, 'duplicate recording cannot extend source TTL');
    assert.throws(() => store.recordExternalObservation({ ...input, contentText: 'Replaced content.' }),
      { code: 'EXTERNAL_OBSERVATION_IMMUTABLE' });
    assert.throws(() => store.recordExternalObservation({ ...input, now: BASE + 60_000 }),
      { code: 'EXTERNAL_OBSERVATION_EXPIRED' });
  } finally {
    db.close();
  }
});

test('external source retention preserves unresolved intent evidence without reviving expired sources', () => {
  const { db, store } = makeStore();
  try {
    const scene = store.observe({
      accountId: ACCOUNT, chatKey: CHAT,
      messages: [incoming(1, 'alice', BASE - 1000, 'We share an interest in astronomy.')]
    });
    const topicId = scene.topics[0].id;
    const source = store.recordExternalObservation({
      accountId: ACCOUNT, chatKey: CHAT, sourceId: 'protected-observation', topicId,
      sourceRefs: [{ kind: 'web', id: 'protected-result', revision: 1 }],
      contentText: 'Original pending initiative material.',
      expiresAt: BASE + 60_000, now: BASE
    });
    const intent = store.addIntent({
      accountId: ACCOUNT, chatKey: CHAT, topicId, sourceRefs: [source],
      goal: 'Consider sharing the specific astronomy update.',
      dueAt: BASE + 90_000, expiresAt: BASE + 120_000, now: BASE
    });
    assert.ok(intent?.id);
    for (let index = 0; index < 65; index += 1) {
      store.recordExternalObservation({
        accountId: ACCOUNT, chatKey: CHAT, sourceId: `new-observation-${index}`,
        sourceRefs: [{ kind: 'web', id: `new-result-${index}`, revision: 1 }],
        contentText: `New independent material ${index}.`,
        expiresAt: BASE + 300_000, now: BASE + 61_000 + index
      });
    }
    const retained = db.prepare('SELECT * FROM social_external_observations WHERE source_id=?')
      .get(source.id);
    assert.equal(retained.content_text, 'Original pending initiative material.');
    assert.equal(store.validateSourceRefs({
      accountId: ACCOUNT, chatKey: CHAT, refs: [source], now: BASE + 59_000
    }).invalidRefs.length, 0, 'valid older sources are not excluded by the current prompt pool');
    assert.equal(store.validateSourceRefs({
      accountId: ACCOUNT, chatKey: CHAT, refs: [source], now: BASE + 62_000
    }).invalidRefs.length, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM social_external_observations').get().n, 65,
      'retention bounds unreferenced sources while preserving unresolved evidence');
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
    assert.deepEqual(store.eligibleToSend({ accountId: ACCOUNT, chatKey: CHAT, topicId, targetMessageId: '1', snapshotRevision: currentBaseline, text: 'A substantial answer about the release.' }), { allowed: true, reason: 'ok' },
      'an unrelated same-topic update does not invalidate the selected target');
    store.observe({ accountId: ACCOUNT, chatKey: CHAT, messages: [
      incoming(6, 'alice', BASE + 1500, 'Never mind, found the answer.', { reply: { messageId: 'mid-1' } })
    ] });
    assert.deepEqual(store.eligibleToSend({ accountId: ACCOUNT, chatKey: CHAT, topicId, targetMessageId: '1', snapshotRevision: currentBaseline, text: 'A substantial answer about the release.' }), { allowed: false, reason: 'target-withdrawn-or-updated' },
      'an explicit target withdrawal invalidates a queued draft');

    const currentTopic = store.snapshot({ accountId: ACCOUNT, chatKey: CHAT }).topics.find((topic) => topic.messageIds.includes('3'));
    const ack = store.recordOutcome({ accountId: ACCOUNT, chatKey: CHAT, topicId: currentTopic.id, targetMessageId: '3', action: 'reply', sent: ['好的！'], runId: 'ack-run' });
    assert.equal(ack.duplicate, false);
    assert.equal(store.eligibleToSend({ accountId: ACCOUNT, chatKey: CHAT, topicId: currentTopic.id, targetMessageId: '3', text: '好的' }).allowed, true);

    const sent = store.recordOutcome({ accountId: ACCOUNT, chatKey: CHAT, topicId: currentTopic.id, targetMessageId: '3', action: 'reply', sent: ['A clear and useful answer.'], runId: 'answer-run' });
    const replay = store.recordOutcome({ accountId: ACCOUNT, chatKey: CHAT, topicId: currentTopic.id, targetMessageId: '3', action: 'reply', sent: ['changed text is ignored for this run'], runId: 'answer-run' });
    assert.equal(replay.duplicate, true);
    assert.equal(replay.id, sent.id);
    assert.deepEqual(store.eligibleToSend({ accountId: ACCOUNT, chatKey: CHAT, topicId: currentTopic.id, targetMessageId: '3', text: 'A clear and useful answer.' }), { allowed: false, reason: 'duplicate-target-content' });
    assert.deepEqual(store.eligibleToSend({ accountId: ACCOUNT, chatKey: CHAT, topicId: currentTopic.id, targetMessageId: '3', direct: true, text: 'A clear and useful answer.' }), { allowed: false, reason: 'duplicate-target-content' });
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
    assert.equal(store.eligibleToSend({ accountId: ACCOUNT, chatKey: CHAT, topicId, targetMessageId: '1', snapshotRevision: snapshot.revision, initiativeId: intent.id, intentLeaseId: lease.leaseId, text: 'A friendly check-in.' }).allowed, true);
    store.recordOutcome({ accountId: ACCOUNT, chatKey: CHAT, topicId, targetMessageId: '1', action: 'reply', sent: ['A friendly check-in.'], runId: 'uncertain-run', initiativeId: intent.id, intentLeaseId: lease.leaseId, outcome: 'unknown' });
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
