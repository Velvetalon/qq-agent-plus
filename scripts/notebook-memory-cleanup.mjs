#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NOTEBOOK_POLICY_VERSION } from '../src/plugins/self-evolution/notebook-policy.js';
import {
  NotebookStore,
  notebookDatabasePath
} from '../src/plugins/self-evolution/notebook-store.js';

function parseArgs(argv) {
  const result = { apply: false, confirm: false, includeArchived: false };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--apply') result.apply = true;
    else if (item === '--confirm') result.confirm = true;
    else if (item === '--include-archived') result.includeArchived = true;
    else if (['--db', '--account', '--manifest', '--actor'].includes(item)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${item} requires a value`);
      result[item.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${item}`);
    }
  }
  if (!result.db) throw new Error('--db is required (use an existing Notebook database)');
  if (!result.account) throw new Error('--account is required');
  if (result.apply && (!result.manifest || !result.confirm || !result.actor)) {
    throw new Error('--apply requires --manifest, --confirm, and --actor');
  }
  return result;
}

function readManifest(filename, account) {
  const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (manifest?.policyVersion !== NOTEBOOK_POLICY_VERSION
    || manifest?.account !== account
    || !Array.isArray(manifest.items)
    || manifest.items.length > 1000) {
    throw new Error('Manifest policy, account, or item list is invalid');
  }
  const seen = new Set();
  for (const item of manifest.items) {
    if (!item || typeof item.id !== 'string'
      || !Number.isSafeInteger(Number(item.revision))
      || Number(item.revision) < 1
      || typeof item.reason !== 'string'
      || !item.reason) {
      throw new Error('Manifest contains an invalid item');
    }
    const key = `${item.id}@${item.revision}`;
    if (seen.has(key)) throw new Error('Manifest contains duplicate note revisions');
    seen.add(key);
  }
  return manifest;
}

function makeManifest(store, account, includeArchived) {
  const items = [];
  let offset = 0;
  while (offset <= 100000) {
    const page = store.listForCleanup({
      accountId: account,
      limit: 500,
      offset,
      includeArchived
    });
    items.push(...page.filter((item) => (
      item.status === 'active' && item.recallable === false
    )).map((item) => ({
      id: item.id,
      revision: item.revision,
      reason: item.policyReason || 'not-recallable'
    })));
    if (page.length < 500) break;
    offset += page.length;
  }
  return {
    policyVersion: NOTEBOOK_POLICY_VERSION,
    account,
    items
  };
}

export function runNotebookMemoryCleanup(argv = process.argv.slice(2), io = console) {
  const options = parseArgs(argv);
  const filename = path.resolve(options.db);
  if (!fs.existsSync(filename)) throw new Error('Notebook database does not exist');
  let store;
  try {
    if (!options.apply) {
      store = NotebookStore.openExisting({
        filename,
        readOnly: true
      });
      if (!store) throw new Error('Notebook database does not exist');
      const manifest = makeManifest(store, options.account, options.includeArchived);
      io.log(JSON.stringify(manifest));
      return { mode: 'dry-run', manifest };
    }

    const manifest = readManifest(options.manifest, options.account);
    store = new NotebookStore({ filename, create: false });
    const outcomes = manifest.items.map((item) => {
      const current = store.get({
        accountId: options.account,
        noteId: item.id,
        includeArchived: false,
        admin: true
      });
      if (!current) return { id: item.id, status: 'not-active' };
      if (current.revision !== Number(item.revision)) {
        return {
          id: item.id,
          status: 'stale',
          expectedRevision: Number(item.revision),
          currentRevision: current.revision
        };
      }
      if (current.recallable !== false || current.policyReason !== item.reason) {
        return { id: item.id, status: 'policy-changed' };
      }
      try {
        const result = store.archive({
          accountId: options.account,
          noteId: item.id,
          expectedRevision: Number(item.revision),
          source: {
            kind: 'system',
            accountId: options.account,
            actor: options.actor
          },
          idempotencyKey: `cleanup:${crypto.createHash('sha256')
            .update(`${options.account}:${item.id}:${item.revision}:${item.reason}`)
            .digest('hex')}`
        });
        return { id: item.id, status: 'archived', revision: result.revision };
      } catch (error) {
        return {
          id: item.id,
          status: error?.code === 'NOTEBOOK_CAS_CONFLICT' ? 'stale' : 'failed',
          code: String(error?.code || 'NOTEBOOK_ERROR')
        };
      }
    });
    const result = {
      mode: 'apply',
      policyVersion: NOTEBOOK_POLICY_VERSION,
      account: options.account,
      outcomes
    };
    io.log(JSON.stringify(result));
    return result;
  } finally {
    store?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    runNotebookMemoryCleanup();
  } catch (error) {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  }
}
