import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as sqliteVec from 'sqlite-vec';

const db = new DatabaseSync(':memory:', { allowExtension: true });
try {
  sqliteVec.load(db);
  db.enableLoadExtension(false);
  const version = String(db.prepare('SELECT vec_version() AS version').get().version || '');
  const a = Buffer.from(new Float32Array([1, 0]).buffer);
  const b = Buffer.from(new Float32Array([0, 1]).buffer);
  const same = Number(db.prepare(
    'SELECT vec_distance_cosine(?, ?) AS distance'
  ).get(a, a).distance);
  const orthogonal = Number(db.prepare(
    'SELECT vec_distance_cosine(?, ?) AS distance'
  ).get(a, b).distance);
  assert.match(version, /^v?0\.1\.9$/);
  assert.ok(Math.abs(same) < 1e-6);
  assert.ok(Math.abs(orthogonal - 1) < 1e-6);
  assert.throws(() => db.prepare(
    'SELECT vec_distance_cosine(?, ?) AS distance'
  ).get(a, Buffer.from(new Float32Array([1]).buffer)));
  console.log(JSON.stringify({
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    sqlite: db.prepare('SELECT sqlite_version() AS version').get().version,
    sqliteVecVersion: version,
    sameDistance: same,
    orthogonalDistance: orthogonal
  }));
} finally {
  db.close();
}
