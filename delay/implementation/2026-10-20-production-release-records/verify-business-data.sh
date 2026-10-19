printf '%s\n' 'Archived snapshot only; execution blocked'
exit 64
set -euo pipefail
umask 077
[ "$(id -un)" = ubuntu ]
[ "$(id -u)" = 1000 ]
/mnt/data/qq-agent/app/.runtime/node-v22.23.2-linux-x64/bin/node --input-type=module <<'JS'
import fs from 'node:fs';import {DatabaseSync} from 'node:sqlite';
const root='/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY',before=JSON.parse(fs.readFileSync(root+'/before-data-counts.json','utf8'));
const summaries={};
for(const [label,file] of [['live','/mnt/data/qq-agent/data/messages.sqlite'],['backup',root+'/data-backup/messages.sqlite']]){
 const db=new DatabaseSync(file,{readOnly:true});const check=db.prepare('PRAGMA quick_check').all();if(JSON.stringify(check)!=='[{"quick_check":"ok"}]')throw new Error(label+' SQLite integrity failed');const counts={};
 for(const name of ['messages','outbox','conversation_threads'])if(name in before){const n=Number(db.prepare(`SELECT count(*) AS n FROM "${name}"`).get().n);if(n<before[name])throw new Error(label+' durable row count decreased: '+name);counts[name]=n;}db.close();summaries[label]={quickCheck:'ok',counts};
}
const s={status:'PASS',before,summaries,durableCountsNotDecreased:true,backupAndLiveSQLiteValid:true,notebookCountObservedSeparately:293};fs.writeFileSync(root+'/business-data-verification.json',JSON.stringify(s,null,2),{mode:0o600});console.log(JSON.stringify(s));
JS
