import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  ReflectionStore,
  hashBasePersona,
  openReflectionStore,
  reflectionDatabasePath
} from '../src/plugins/self-evolution/index.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-lsr1-profile-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const ACCOUNT_ID = 'lsr1-account';
const OTHER_ACCOUNT_ID = 'lsr1-other';
const BASE_PERSONA = {
  roleText: 'stable base',
  behaviorProfile: 'legacy',
  botName: 'lsr1-bot',
  selfNickname: 'lsr1-bot',
  customRules: 'grounded'
};

function event(sessionId, accountId = ACCOUNT_ID) {
  return {
    eventId: `event-${sessionId}`,
    observerId: 'self-evolution.reflection',
    observerPluginId: 'self-evolution',
    accountId,
    sessionId,
    runId: `run-${sessionId}`,
    chatKey: 'group:100',
    pluginGeneration: 1,
    resultClass: 'done',
    actionSummary: {
      sentCount: 1,
      finishReason: 'finish',
      outboundAttempted: true,
      participation: { mode: 'auto', decision: 'reply', reasonCode: 'normal' },
      termination: { kind: 'finish' },
      outbound: { attempted: 1, succeeded: 1, failed: 0, unknown: 0, held: 0 }
    },
    sourceMessageIds: [`message-${sessionId}`],
    completedAt: 1000
  };
}

function seedProfile({ filename, now = 1000 } = {}) {
  // LSR3 intentionally rejects these procedural values before proposal
  // persistence. Seed this isolated fixture directly so LSR1 can exercise
  // quarantine of an already-polluted historical profile.
  const bootstrap = new ReflectionStore({
    filename,
    now: () => now,
    limits: { leaseMs: 60000, workerLeaseMs: 60000, backoffMs: 0 }
  });
  bootstrap.close();
  const db = new DatabaseSync(filename);
  const profile = {
    global: {
      communication_style: {
        value: '简短',
        confidence: 0.9,
        evidenceRefs: ['session:seed-1'],
        updatedAt: now
      },
      expression_preferences: {
        value: '固定表情：🙂',
        confidence: 0.9,
        evidenceRefs: ['session:seed-1'],
        updatedAt: now
      },
      working_habit: {
        value: 'retry queue',
        confidence: 0.9,
        evidenceRefs: ['session:seed-1'],
        updatedAt: now
      }
    },
    chats: {
      'group:100': {
        topic_interests: {
          value: '人呢',
          confidence: 0.9,
          evidenceRefs: ['session:seed-1'],
          updatedAt: now
        },
        language_preference: {
          value: '中文',
          confidence: 0.9,
          evidenceRefs: ['session:seed-1'],
          updatedAt: now
        }
      }
    }
  };
  db.prepare(`
    INSERT INTO learned_self_versions
      (account_id,revision,parent_revision,profile_json,evidence_json,
       base_persona_hash,applied_by,source_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    ACCOUNT_ID,
    1,
    0,
    JSON.stringify(profile),
    JSON.stringify([{ kind: 'legacy-polluted-fixture' }]),
    hashBasePersona(BASE_PERSONA),
    'fixture',
    JSON.stringify([{ kind: 'fixture' }]),
    now
  );
  db.prepare(`
    INSERT INTO learned_self_heads(account_id,revision,updated_at)
    VALUES (?,?,?)
  `).run(ACCOUNT_ID, 1, now);
  db.close();
  return new ReflectionStore({
    filename,
    create: false,
    now: () => now
  });
}

function runCli(args) {
  return spawnSync(process.execPath, [
    path.resolve('scripts/learned-self-profile.mjs'),
    ...args
  ], {
    encoding: 'utf8',
    windowsHide: true
  });
}

test('LSR1 audits trait entries, previews without writes, resets append-only, and rolls back by CAS', () => {
  const filename = reflectionDatabasePath(path.join(root, 'audit'));
  const store = seedProfile({ filename });
  try {
    const before = store.auditProfile({ accountId: ACCOUNT_ID });
    assert.equal(before.revision, 1);
    assert.equal(before.entries.length, 5);
    assert.equal(before.entries.find((entry) => entry.key === 'communication_style').sourceRevision, 1);
    assert.equal(before.entries.find((entry) => entry.key === 'topic_interests').scope, 'chat');
    assert.equal(before.entries.find((entry) => entry.key === 'topic_interests').chatKey, 'group:100');
    assert.equal(before.entries.find((entry) => entry.key === 'working_habit').entry.value, 'retry queue');

    const preview = store.previewProfileReset({
      accountId: ACCOUNT_ID,
      expectedCurrentRevision: 1
    });
    assert.equal(preview.noOp, false);
    assert.equal(preview.nextRevision, 2);
    assert.equal(preview.removedCount, 5);
    assert.equal(store.getLearnedSelfRevision({ accountId: ACCOUNT_ID }), 1);

    const reset = store.resetProfile({
      accountId: ACCOUNT_ID,
      expectedCurrentRevision: 1,
      actor: 'lsr1-test',
      reason: 'quarantine polluted learned self',
      confirm: true
    });
    assert.equal(reset.reset, true);
    assert.equal(reset.revision, 2);
    assert.equal(reset.rollbackTargetRevision, 1);
    assert.equal(reset.removedCount, 5);
    assert.equal(store.getLearnedSelfContext({
      accountId: ACCOUNT_ID,
      basePersona: BASE_PERSONA
    }).context.communication_style, undefined);
    assert.equal(store.listProfileVersions({ accountId: ACCOUNT_ID }).length, 2);
    assert.equal(store.listAudit({ accountId: ACCOUNT_ID })
      .some((row) => row.event === 'profile-reset'
        && row.details.removedCount === 5
        && row.details.beforeRevision === 1
        && row.details.afterRevision === 2), true);

    const rollback = store.rollbackProfile({
      accountId: ACCOUNT_ID,
      targetRevision: 1,
      expectedCurrentRevision: 2,
      basePersona: BASE_PERSONA,
      actor: 'lsr1-test',
      reason: 'verify reversible quarantine'
    });
    assert.equal(rollback.revision, 3);
    assert.equal(store.getLearnedSelfContext({
      accountId: ACCOUNT_ID,
      basePersona: BASE_PERSONA
    }).context.communication_style.value, '简短');
    const rollbackAudit = store.listAudit({ accountId: ACCOUNT_ID })
      .find((row) => row.event === 'profile-rollback');
    assert.equal(rollbackAudit.details.beforeRevision, 2);
    assert.equal(rollbackAudit.details.afterRevision, 3);
    assert.equal(rollbackAudit.details.actor, 'lsr1-test');
    assert.deepEqual(
      store.listProfileVersions({ accountId: ACCOUNT_ID }).map((version) => version.revision),
      [3, 2, 1]
    );
  } finally {
    store.close();
  }
});

test('LSR1 reset is strict, account-scoped, read-only safe, and CAS protected across connections', () => {
  const filename = reflectionDatabasePath(path.join(root, 'cas'));
  const first = seedProfile({ filename });
  const second = new ReflectionStore({ filename, create: false });
  try {
    assert.throws(
      () => first.previewProfileReset({
        accountId: ACCOUNT_ID,
        expectedCurrentRevision: '1'
      }),
      (error) => error.code === 'REFLECTION_INVALID_ARGUMENT'
    );
    assert.throws(
      () => first.resetProfile({
        accountId: ACCOUNT_ID,
        expectedCurrentRevision: 1,
        actor: 'lsr1-test',
        reason: 'missing confirmation',
        confirm: false
      }),
      (error) => error.code === 'REFLECTION_CONFIRM_REQUIRED'
    );
    const preview = first.previewProfileReset({
      accountId: ACCOUNT_ID,
      expectedCurrentRevision: 1
    });
    const applied = second.resetProfile({
      accountId: ACCOUNT_ID,
      expectedCurrentRevision: 1,
      actor: 'lsr1-test',
      reason: 'first connection wins',
      confirm: true
    });
    assert.equal(applied.revision, 2);
    assert.throws(
      () => first.resetProfile({
        accountId: ACCOUNT_ID,
        expectedCurrentRevision: preview.currentRevision,
        actor: 'lsr1-test',
        reason: 'stale reset',
        confirm: true
      }),
      (error) => error.code === 'REFLECTION_CAS_CONFLICT'
    );
    assert.throws(
      () => first.auditProfile({ accountId: OTHER_ACCOUNT_ID, revision: 1 }),
      (error) => error.code === 'REFLECTION_NOT_FOUND'
    );
    assert.throws(
      () => first.rollbackProfile({
        accountId: OTHER_ACCOUNT_ID,
        targetRevision: 1,
        expectedCurrentRevision: 0,
        basePersona: BASE_PERSONA,
        actor: 'lsr1-test'
      }),
      (error) => error.code === 'REFLECTION_NOT_FOUND'
    );
    const empty = first.resetProfile({
      accountId: ACCOUNT_ID,
      expectedCurrentRevision: 2,
      actor: 'lsr1-test',
      reason: 'empty no-op',
      confirm: true
    });
    assert.equal(empty.noOp, true);
    assert.equal(first.getLearnedSelfRevision({ accountId: ACCOUNT_ID }), 2);
  } finally {
    second.close();
    first.close();
  }

  const readOnly = openReflectionStore({ filename });
  try {
    assert.ok(readOnly);
    assert.throws(
      () => readOnly.resetProfile({
        accountId: ACCOUNT_ID,
        expectedCurrentRevision: 2,
        actor: 'lsr1-test',
        reason: 'read only',
        confirm: true
      }),
      (error) => error.code === 'REFLECTION_READ_ONLY'
    );
  } finally {
    readOnly?.close();
  }
});

test('LSR1 CLI is explicit, redacted, dry-run safe, and refuses missing databases', () => {
  const dataDir = path.join(root, 'cli');
  const filename = reflectionDatabasePath(dataDir);
  const store = seedProfile({ filename });
  store.close();

  const audit = runCli([
    'audit',
    '--database',
    filename,
    '--account',
    ACCOUNT_ID
  ]);
  assert.equal(audit.status, 0, audit.stderr);
  const auditJson = JSON.parse(audit.stdout);
  assert.notEqual(auditJson.accountId, ACCOUNT_ID);
  assert.equal(auditJson.entries.length, 5);
  assert.equal(audit.stdout.includes('retry queue'), false);
  assert.equal(audit.stdout.includes('session:seed-1'), false);
  assert.equal(audit.stdout.includes('group:100'), false);

  const dryRun = runCli([
    'reset',
    '--database',
    filename,
    '--account',
    ACCOUNT_ID,
    '--expected-revision',
    '1'
  ]);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).removedCount, 5);
  const check = new ReflectionStore({ filename, create: false, readOnly: true });
  assert.equal(check.getLearnedSelfRevision({ accountId: ACCOUNT_ID }), 1);
  check.close();

  const missingConfirm = runCli([
    'reset',
    '--database',
    filename,
    '--account',
    ACCOUNT_ID,
    '--expected-revision',
    '1',
    '--apply'
  ]);
  assert.notEqual(missingConfirm.status, 0);
  assert.match(missingConfirm.stderr, /CLI_CONFIRM_REQUIRED/);

  const applied = runCli([
    'reset',
    '--database',
    filename,
    '--account',
    ACCOUNT_ID,
    '--expected-revision',
    '1',
    '--apply',
    '--confirm',
    '--actor',
    'lsr1-cli',
    '--reason',
    'approved quarantine'
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(applied.stdout).revision, 2);

  const missing = path.join(root, 'does-not-exist.sqlite');
  const noFile = runCli([
    'audit',
    '--database',
    missing,
    '--account',
    ACCOUNT_ID
  ]);
  assert.notEqual(noFile.status, 0);
  assert.equal(fs.existsSync(missing), false);
});
