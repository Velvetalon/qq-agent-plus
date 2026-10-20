import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const names = ['qq-supervisor.py', 'qq-supervisor.conf'];
const metadataName = 'manifest.json';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function regularFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('QQ supervision asset must be a regular file');
  return fs.readFileSync(file);
}

function assetDirectory(directory) {
  const resolved = path.resolve(directory);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('QQ supervision directory must not be a symlink');
  return resolved;
}

export function verifyQQSupervision(directory) {
  const folder = assetDirectory(directory);
  const metadata = JSON.parse(regularFile(path.join(folder, metadataName)).toString('utf8'));
  if (metadata.version !== 1 || !metadata.files || Object.keys(metadata.files).length !== names.length) {
    throw new Error('Unknown QQ supervision manifest');
  }
  for (const name of names) {
    if (metadata.files[name] !== sha256(regularFile(path.join(folder, name)))) {
      throw new Error(`QQ supervision asset changed outside deployment: ${name}`);
    }
  }
  return metadata;
}

export function installQQSupervision(directory) {
  const target = path.resolve(directory);
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  assetDirectory(target);
  const lockPath = path.join(target, '.install.lock');
  const lock = fs.openSync(lockPath, 'wx', 0o600);
  const previous = new Map();
  const written = [];
  function atomicWrite(name, bytes) {
    const file = path.join(target, name);
    const temporary = path.join(target, `${name}.tmp-${process.pid}`);
    try {
      fs.writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  try {
    const existing = fs.readdirSync(target).filter((name) => name !== '.install.lock');
    if (existing.length) {
      if (existing.some((name) => ![...names, metadataName].includes(name))) {
        throw new Error('Unrecognized files in QQ supervision directory');
      }
      verifyQQSupervision(target);
      for (const name of [...names, metadataName]) previous.set(name, regularFile(path.join(target, name)));
    }
    const content = new Map(names.map((name) => [name, regularFile(path.join(sourceDir, name))]));
    const metadata = { version: 1, files: Object.fromEntries([...content].map(([name, bytes]) => [name, sha256(bytes)])) };
    const encoded = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`);
    if (previous.get(metadataName)?.equals(encoded)) return { ...metadata, changed: false };
    content.set(metadataName, encoded);
    for (const [name, bytes] of content) {
      atomicWrite(name, bytes);
      written.push(name);
    }
    verifyQQSupervision(target);
    return { ...metadata, changed: true };
  } catch (error) {
    for (const name of written.reverse()) {
      if (previous.has(name)) atomicWrite(name, previous.get(name));
      else fs.unlinkSync(path.join(target, name));
    }
    throw error;
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { 'target-dir': { type: 'string' } } });
    if (!values['target-dir']) throw new Error('--target-dir is required');
    console.log(JSON.stringify(installQQSupervision(values['target-dir'])));
  } catch (error) {
    console.error(error instanceof SyntaxError ? 'Malformed QQ supervision metadata' : error.message);
    process.exitCode = 1;
  }
}
