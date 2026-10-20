#!/usr/bin/env node
/**
 * 清理不属于当前 embedding profile 的遗留向量索引。
 *
 * 用途：换过 embedding 配置后，旧 profile 会留下一批永远不会被当前 worker
 * 认领的 pending/obsolete 行。那些历史笔记不再纳入向量库，所以这里只删除、
 * 不重新入队，也不会产生新的远程 embedding 调用。
 *
 *   node scripts/purge-stale-embedding-index.mjs --data-dir /mnt/data/qq-agent/data --dry-run
 *   node scripts/purge-stale-embedding-index.mjs --data-dir /mnt/data/qq-agent/data --confirm
 *
 * 边界：只动 notebook_embedding_jobs 与 notebook_embeddings 两张派生表；
 * notebook_notes、notebook_versions、归档状态保持不变。
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { NotebookStore, notebookDatabasePath } from '../src/plugins/self-evolution/notebook-store.js';
import {
  embeddingProfileId,
  normalizeEmbeddingConfig
} from '../src/plugins/self-evolution/embedding-client.js';

const { values } = parseArgs({
  options: {
    'data-dir': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    confirm: { type: 'boolean', default: false }
  }
});

const dataDir = path.resolve(String(values['data-dir'] || process.env.QQ_AGENT_DATA_DIR || ''));
if (!dataDir || dataDir === path.resolve('.')) {
  console.error('必须提供 --data-dir 或 QQ_AGENT_DATA_DIR');
  process.exit(1);
}
if (!values['dry-run'] && !values.confirm) {
  console.error('拒绝执行：加 --dry-run 预览，或加 --confirm 真正清理');
  process.exit(1);
}

const configFile = path.join(dataDir, 'config.json');
if (!fs.existsSync(configFile)) {
  console.error(`找不到配置文件：${configFile}`);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const embedding = config?.selfEvolution?.retrieval?.embedding
  || config?.plugins?.selfEvolution?.retrieval?.embedding
  || null;
if (!embedding || typeof embedding !== 'object') {
  console.error('当前配置没有 embedding 段；先在控制台 Embedding 页保存一次');
  process.exit(1);
}
const normalized = normalizeEmbeddingConfig(embedding);
const profileId = embeddingProfileId(normalized);
if (!normalized.enabled || !normalized.provider || !normalized.model || !(normalized.dimension > 0)) {
  console.error('Embedding 配置不完整，无法确定当前 profile；拒绝清理');
  process.exit(1);
}

const database = notebookDatabasePath(dataDir);
if (!fs.existsSync(database)) {
  console.error(`找不到 Notebook 数据库：${database}`);
  process.exit(1);
}

const store = new NotebookStore({
  dataDir,
  filename: database,
  create: false,
  readOnly: false,
  embeddingConfig: embedding
});
store.open({ create: false });
if (!store.openState) {
  console.error('无法以可写方式打开 Notebook 数据库');
  process.exit(1);
}

const jobStats = (db) => Object.fromEntries(
  db.prepare('SELECT profile_id, status, COUNT(*) AS n FROM notebook_embedding_jobs GROUP BY profile_id, status')
    .all()
    .map((row) => [`${row.profile_id || '(empty)'}:${row.status}`, Number(row.n)])
);
const vectorStats = (db) => Object.fromEntries(
  db.prepare('SELECT profile_id, status, COUNT(*) AS n FROM notebook_embeddings GROUP BY profile_id, status')
    .all()
    .map((row) => [`${row.profile_id || '(empty)'}:${row.status}`, Number(row.n)])
);

try {
  const db = store.db;
  const activeNotes = Number(db.prepare(
    "SELECT COUNT(*) AS n FROM notebook_notes WHERE status='active'"
  ).get()?.n) || 0;
  const beforeJobs = jobStats(db);
  const beforeVectors = vectorStats(db);
  const foreignJobs = Number(db.prepare(
    'SELECT COUNT(*) AS n FROM notebook_embedding_jobs WHERE profile_id<>?'
  ).get(profileId)?.n) || 0;
  const obsoleteJobs = Number(db.prepare(
    "SELECT COUNT(*) AS n FROM notebook_embedding_jobs WHERE profile_id=? AND status='obsolete'"
  ).get(profileId)?.n) || 0;
  const foreignVectors = Number(db.prepare(
    'SELECT COUNT(*) AS n FROM notebook_embeddings WHERE profile_id<>?'
  ).get(profileId)?.n) || 0;
  const keptReady = Number(db.prepare(
    "SELECT COUNT(*) AS n FROM notebook_embeddings WHERE profile_id=? AND status='ready'"
  ).get(profileId)?.n) || 0;

  if (values['dry-run']) {
    console.log(JSON.stringify({
      dryRun: true,
      dataDir,
      database,
      profileId,
      provider: normalized.provider,
      model: normalized.model,
      dimension: normalized.dimension,
      activeNotes,
      willDelete: { foreignJobs, obsoleteJobs, foreignVectors },
      willKeep: { currentProfileReadyVectors: keptReady },
      jobsBefore: beforeJobs,
      vectorsBefore: beforeVectors,
      plan: '删除非当前 profile 的 job/vector 行 + 当前 profile 的 obsolete 行；不重新入队，历史笔记不再纳入向量库'
    }, null, 2));
  } else {
    const deleted = store.purgeEmbeddingIndex({ profileId });
    console.log(JSON.stringify({
      purged: true,
      dataDir,
      profileId,
      activeNotes,
      deleted,
      kept: { currentProfileReadyVectors: keptReady },
      jobsAfter: jobStats(db),
      vectorsAfter: vectorStats(db),
      note: '历史笔记不再纳入向量库；之后新建或更新的笔记会照常按当前 profile 入队'
    }, null, 2));
  }
} finally {
  try { store.close?.(); } catch { /* best effort */ }
}
