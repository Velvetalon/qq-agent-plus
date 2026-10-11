import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  ReflectionError,
  ReflectionStore
} from '../src/plugins/self-evolution/reflection-store.js';

const USAGE = [
  'Usage:',
  '  node scripts/learned-self-profile.mjs audit --database ABS_PATH --account ID',
  '  node scripts/learned-self-profile.mjs reset --database ABS_PATH --account ID --expected-revision N',
  '  node scripts/learned-self-profile.mjs reset ... --apply --confirm --actor NAME --reason TEXT',
  '  node scripts/learned-self-profile.mjs rollback --database ABS_PATH --account ID',
  '    --target-revision N --expected-revision N --base-persona-hash SHA256',
  '  node scripts/learned-self-profile.mjs rollback ... --apply --confirm --actor NAME --reason TEXT'
].join('\n');

const COMMANDS = new Set(['audit', 'reset', 'rollback']);
const VALUE_FLAGS = new Set([
  '--database',
  '--account',
  '--revision',
  '--expected-revision',
  '--target-revision',
  '--base-persona-hash',
  '--actor',
  '--reason'
]);
const BOOL_FLAGS = new Set(['--apply', '--confirm']);

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.has(command)) fail('CLI_USAGE', USAGE);
  const result = { command, values: {}, booleans: new Set() };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (BOOL_FLAGS.has(flag)) {
      result.booleans.add(flag);
      continue;
    }
    if (!VALUE_FLAGS.has(flag) || rest[index + 1] === undefined
      || String(rest[index + 1]).startsWith('--')) {
      fail('CLI_USAGE', `invalid or missing argument: ${flag}\n${USAGE}`);
    }
    result.values[flag.slice(2)] = rest[++index];
  }
  return result;
}

function required(values, name) {
  const value = String(values[name] ?? '').trim();
  if (!value) fail('CLI_USAGE', `--${name} is required\n${USAGE}`);
  return value;
}

function safeInteger(values, name, minimum = 0) {
  const raw = required(values, name);
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) {
    fail('CLI_USAGE', `--${name} must be a non-negative integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail('CLI_USAGE', `--${name} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function hashText(value) {
  return `h_${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)}`;
}

function redactEntry(entry) {
  return {
    key: String(entry.key || ''),
    scope: String(entry.scope || ''),
    chatKey: entry.chatKey ? hashText(entry.chatKey) : '',
    valueLength: String(entry.value || '').length,
    valueFingerprint: hashText(entry.value || ''),
    evidenceRefs: Array.isArray(entry.evidenceRefs)
      ? entry.evidenceRefs.map(hashText)
      : [],
    createdAt: Number(entry.createdAt) || 0,
    updatedAt: Number(entry.updatedAt) || 0,
    sourceRevision: Number(entry.sourceRevision) || 0
  };
}

function redactEntries(entries) {
  return Array.isArray(entries) ? entries.map(redactEntry) : [];
}

function redactProfile(profile) {
  return {
    accountId: hashText(profile.accountId),
    headRevision: Number(profile.headRevision) || 0,
    revision: Number(profile.revision) || 0,
    parentRevision: Number(profile.parentRevision) || 0,
    basePersonaHash: profile.basePersonaHash
      ? hashText(profile.basePersonaHash)
      : '',
    appliedBy: profile.appliedBy ? hashText(profile.appliedBy) : '',
    createdAt: Number(profile.createdAt) || 0,
    entries: redactEntries(profile.entries)
  };
}

function redactReset(result) {
  return {
    accountId: hashText(result.accountId),
    mode: String(result.mode || 'quarantine_all'),
    currentRevision: Number(result.currentRevision) || 0,
    revision: Number(result.revision ?? result.nextRevision) || 0,
    nextRevision: Number(result.nextRevision ?? result.revision) || 0,
    rollbackTargetRevision: Number(result.rollbackTargetRevision) || 0,
    removedCount: Number(result.removedCount) || 0,
    retainedCount: Number(result.retainedCount) || 0,
    noOp: result.noOp === true,
    removedEntries: redactEntries(result.removedEntries),
    retainedEntries: redactEntries(result.retainedEntries)
  };
}

function redactRollback(result) {
  return {
    accountId: hashText(result.accountId),
    rolledBack: result.rolledBack === true,
    targetRevision: Number(result.targetRevision) || 0,
    revision: Number(result.revision) || 0,
    parentRevision: Number(result.parentRevision) || 0,
    basePersonaHash: result.basePersonaHash ? hashText(result.basePersonaHash) : ''
  };
}

function openExisting(filename, readOnly) {
  if (!path.isAbsolute(filename)) fail('CLI_USAGE', '--database must be an absolute path');
  if (!fs.existsSync(filename)) fail('REFLECTION_NOT_FOUND', 'database does not exist');
  const store = new ReflectionStore({
    filename,
    create: false,
    readOnly
  });
  if (!store.openState) fail('REFLECTION_NOT_FOUND', 'database could not be opened');
  return store;
}

function ensureNoUnexpectedFlags(parsed, allowed) {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(parsed.values)) {
    if (!allowedSet.has(key)) fail('CLI_USAGE', `flag --${key} is not valid for ${parsed.command}`);
  }
  for (const flag of parsed.booleans) {
    if (!allowedSet.has(flag.slice(2))) {
      fail('CLI_USAGE', `flag ${flag} is not valid for ${parsed.command}`);
    }
  }
}

function run(parsed) {
  const values = parsed.values;
  const account = required(values, 'account');
  const database = required(values, 'database');
  if (parsed.command === 'audit') {
    ensureNoUnexpectedFlags(parsed, ['database', 'account', 'revision']);
    const store = openExisting(database, true);
    try {
      const revision = values.revision === undefined
        ? undefined
        : safeInteger(values, 'revision', 1);
      return redactProfile(store.auditProfile({ accountId: account, revision }));
    } finally {
      store.close();
    }
  }
  ensureNoUnexpectedFlags(parsed, [
    'database',
    'account',
    'expected-revision',
    'target-revision',
    'base-persona-hash',
    'actor',
    'reason',
    'apply',
    'confirm'
  ]);
  const expectedCurrentRevision = safeInteger(values, 'expected-revision', 0);
  const apply = parsed.booleans.has('--apply');
  const confirm = parsed.booleans.has('--confirm');
  if (confirm && !apply) fail('CLI_USAGE', '--confirm requires --apply');
  if (apply) {
    if (!confirm) fail('CLI_CONFIRM_REQUIRED', '--apply requires --confirm');
    required(values, 'actor');
    required(values, 'reason');
  }
  if (parsed.command === 'reset') {
    if (values['target-revision'] !== undefined || values['base-persona-hash'] !== undefined) {
      fail('CLI_USAGE', 'reset does not accept target/base-persona flags');
    }
    const store = openExisting(database, apply === true ? false : true);
    try {
      if (!apply) {
        return redactReset(store.previewProfileReset({
          accountId: account,
          expectedCurrentRevision
        }));
      }
      return redactReset(store.resetProfile({
        accountId: account,
        expectedCurrentRevision,
        actor: values.actor,
        reason: values.reason,
        confirm: true
      }));
    } finally {
      store.close();
    }
  }
  if (values['target-revision'] === undefined || values['base-persona-hash'] === undefined) {
    fail('CLI_USAGE', 'rollback requires --target-revision and --base-persona-hash');
  }
  const targetRevision = safeInteger(values, 'target-revision', 1);
  const basePersonaHash = required(values, 'base-persona-hash');
  if (!/^[a-f0-9]{64}$/i.test(basePersonaHash)) {
    fail('CLI_USAGE', '--base-persona-hash must be a SHA-256 hash');
  }
  const store = openExisting(database, apply === true ? false : true);
  try {
    if (!apply) {
      const current = store.auditProfile({ accountId: account });
      if (current.headRevision !== expectedCurrentRevision) {
        fail('REFLECTION_CAS_CONFLICT', 'Learned Self revision changed');
      }
      const target = store.auditProfile({ accountId: account, revision: targetRevision });
      if (target.basePersonaHash.toLowerCase() !== basePersonaHash.toLowerCase()) {
        fail('REFLECTION_BASE_PERSONA_CHANGED',
          'target profile was learned against a different Base Persona');
      }
      return {
        accountId: hashText(account),
        dryRun: true,
        targetRevision,
        expectedCurrentRevision,
        basePersonaHash: hashText(basePersonaHash),
        target: redactProfile(target)
      };
    }
    return redactRollback(store.rollbackProfile({
      accountId: account,
      targetRevision,
      expectedCurrentRevision,
      basePersonaHash,
      actor: values.actor,
      reason: values.reason
    }));
  } finally {
    store.close();
  }
}

try {
  const parsed = parseArgs(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(run(parsed))}\n`);
} catch (error) {
  const code = String(error?.code || 'CLI_ERROR');
  const message = String(error?.message || error);
  process.stderr.write(`${JSON.stringify({ ok: false, code, message, details: error?.details || {} })}\n`);
  process.stderr.write(`${USAGE}\n`);
  process.exitCode = 1;
}
