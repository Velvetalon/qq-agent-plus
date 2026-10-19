printf '%s\n' 'Archived snapshot only; execution blocked'
exit 64
set -euo pipefail
umask 077
[ "$(id -un)" = ubuntu ]
[ "$(id -u)" = 1000 ]
MAINT=/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY
exec 9>"$MAINT/rollout.lock"
flock --nonblock 9
export QQ_AGENT_DATA_DIR="$MAINT/indexing-module-scratch"
/mnt/data/qq-agent/app/.runtime/node-v22.23.2-linux-x64/bin/node --input-type=module <<'JS'
import fs from 'node:fs';import crypto from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {NotebookStore} from '/mnt/data/qq-agent/app/src/plugins/self-evolution/notebook-store.js';
import {queueEmbedding} from '/mnt/data/qq-agent/app/src/plugins/self-evolution/vector-memory.js';
import {EmbeddingClient,embeddingProfileId} from '/mnt/data/qq-agent/app/src/plugins/self-evolution/embedding-client.js';
import {isRecallableNotebookNote} from '/mnt/data/qq-agent/app/src/plugins/self-evolution/notebook-policy.js';
const root='/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY',file='/mnt/data/qq-agent/data/plugins/self-evolution/state.sqlite';
if(fs.existsSync(root+'/existing-note-backfill.json'))throw new Error('Backfill already recorded; do not blindly repeat');
const cfg=JSON.parse(fs.readFileSync('/mnt/data/qq-agent/data/config.json','utf8'));const proof=JSON.parse(fs.readFileSync(root+'/verified-configured-onebot-identity.json','utf8'));
const account=String(cfg.onebot.selfId||'');if(!account||account!==proof.selfId)throw new Error('Verified configured account missing');
const e=cfg.selfEvolution.retrieval.embedding;if(!e.enabled||!e.allowQuery||e.allowPrivate)throw new Error('Embedding profile differs from authorization');
const client=new EmbeddingClient({config:e});if(!client.configured)throw new Error('Embedding is not configured');const profile=embeddingProfileId(e);
const store=new NotebookStore({filename:file,readOnly:true,create:false,embeddingConfig:e,embeddingClient:client});
const db=new DatabaseSync(file,{allowExtension:true});db.exec('PRAGMA busy_timeout=5000');
const digest=()=>crypto.createHash('sha256').update(JSON.stringify(db.prepare('SELECT * FROM notebook_notes ORDER BY account_id,id').all())).digest('hex');
const counts={examined:0,activeRecallable:0,privacyAllowed:0,queued:0,archivedOrIneligible:0,privacySkipped:0,existingJobsKept:0};
try{
 db.exec('BEGIN IMMEDIATE');const before=digest();const rows=db.prepare('SELECT id FROM notebook_notes WHERE account_id=? ORDER BY updated_at,id LIMIT 500').all(account);
 const existing=db.prepare('SELECT 1 AS present FROM notebook_embedding_jobs WHERE account_id=? AND note_id=? AND note_revision=? AND profile_id=? LIMIT 1');
 for(const row of rows){counts.examined++;const note=store.get({accountId:account,noteId:row.id,admin:true,includeArchived:true});
  if(!note||note.status!=='active'||!isRecallableNotebookNote(note)){counts.archivedOrIneligible++;continue;}counts.activeRecallable++;
  if(!(await client.authorizeNote(note))){counts.privacySkipped++;continue;}counts.privacyAllowed++;
  if(existing.get(account,note.id,note.revision,profile)){counts.existingJobsKept++;continue;}
  if(queueEmbedding(db,note,{profileId:profile}).queued)counts.queued++;
 }
 if(digest()!==before)throw new Error('Authoritative Notebook rows changed during derived queue operation');
 const current=JSON.parse(fs.readFileSync('/mnt/data/qq-agent/data/config.json','utf8')).selfEvolution.retrieval.embedding;
 if(JSON.stringify(current)!==JSON.stringify(e))throw new Error('Embedding settings changed during queue operation');
 db.exec('COMMIT');
 const result={status:'QUEUED_ONLY_ELIGIBLE',profileId:profile,counts,primaryNoteRowsUnchanged:true,accountOrScopeOrRevisionNotModified:true,allowPrivate:false,modelCallsIssuedByQueueOperation:0,workerMayProcessAuthorizedQueue:true};
 fs.writeFileSync(root+'/existing-note-backfill.json',JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));
}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}finally{db.close();store.close();}
JS
