printf '%s\n' 'Archived snapshot only; execution blocked'
exit 64
#!/usr/bin/env bash
set -euo pipefail
umask 077
[ "$(id -un)" = ubuntu ]
[ "$(id -u)" = 1000 ]
MAINT=/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY
APP=/mnt/data/qq-agent/app
DATA=/mnt/data/qq-agent/data
NODE=$APP/.runtime/node-v22.23.2-linux-x64/bin/node
SERVICE=qq-agent-linux
STOPPED=false
DEPLOY_FINISHED=false
[ "$(readlink -f "$MAINT")" = "$MAINT" ]
[ ! -L "$MAINT/rollout.lock" ]
exec 9>"$MAINT/rollout.lock"
flock --nonblock 9
[ ! -e "$MAINT/update-result.json" ]
printf '{"status":"RUNNING"}\n' > "$MAINT/update-result.json"
fail_update() {
  local code=$?
  trap - ERR INT TERM
  printf '{"status":"FAILED","exitCode":%s,"serviceStoppedForUpdate":%s,"deployFinished":%s}\n' "$code" "$STOPPED" "$DEPLOY_FINISHED" > "$MAINT/update-result.json"
  if [[ "$STOPPED" == true ]]; then
    systemctl --user stop "$SERVICE.service" >/dev/null 2>&1 || true
    # Never automatically open possibly migrated data with old code or discard
    # post-start durable effects. Internal rollback plus snapshots stay available.
    printf 'SERVICE_HELD_FOR_COORDINATOR_RECOVERY\n'
  fi
  exit "$code"
}
trap fail_update ERR INT TERM
[ "$(readlink -f "$MAINT")" = "$MAINT" ]
[ "$(readlink -f "$APP")" = "$APP" ]
[ "$(readlink -f "$DATA")" = "$DATA" ]
[ ! -e "$DATA/.deploy.lock" ]
[ ! -e "$MAINT/application-backup" ]
[ ! -e "$MAINT/data-backup" ]
if systemctl --user is-active --quiet "$SERVICE-update.service"; then
  printf 'CONCURRENT_UPDATE_REFUSED\n' >&2
  false
fi
systemctl --user is-active --quiet "$SERVICE.service"
[ -z "$(systemctl --user show "$SERVICE.service" --property=DropInPaths --value)" ]
python3 - <<'PY'
import pathlib,json
r=pathlib.Path('/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY')
assert json.loads((r/'validation-91beebbcc3'/'linux-unit-summary.json').read_text())['exitCode']==0
assert len(json.loads((r/'validation-91beebbcc3'/'offline-checks.json').read_text())['results'])==8
assert all(v['exitCode']==0 for v in json.loads((r/'validation-91beebbcc3'/'offline-checks.json').read_text())['results'])
assert json.loads((r/'validation-91beebbcc3'/'python-cleanup-summary.json').read_text())['exitCode']==0
a=pathlib.Path('/mnt/data/qq-agent/app');d=json.loads((a/'.deployment.json').read_text());c=json.loads((pathlib.Path(d['data'])/'config.json').read_text())
assert d['root']==str(a) and d['data']=='/mnt/data/qq-agent/data' and d['service']=='qq-agent-linux'
assert (pathlib.Path(d['data'])/'deployed-revision').read_text().strip()=='059eba574a5e440fb9c385de5305f7afcc585a82'
assert c['runtime']['mode']=='active' and c['runtime'].get('paused') is False
assert c['conversation']['mode']=='lifecycle' and c['server']['host']=='0.0.0.0' and c['server']['port']==3210
assert c['api']['baseUrl'].rstrip('/')=='https://nano-gpt.com/api/v1'
assert c['providerKeys'].get(c['api']['provider']) and c['autoUpdate'].get('enabled') is False
raw=c.get('selfEvolution') or c.get('plugins',{}).get('selfEvolution') or c.get('plugins',{}).get('self-evolution') or {}
assert raw.get('enabled') is True and raw.get('retrieval',{}).get('enabled') is True and raw.get('reflection',{}).get('enabled') is True,'existing memory switches changed'
assert raw.get('retrieval',{}).get('embedding',{}).get('enabled') is not True,'embedding already changed by another operator'
probe=json.loads((r/'production-embedding-probe-transport.json').read_text())
assert probe.get('ok') is True and probe.get('dimension')==2560 and probe.get('model')=='Qwen/Qwen3-Embedding-4B'
assert probe.get('gateway')=='https://api.nano-gpt.com/api/v1','unexpected embedding destination'
PY
# Preserve all prior snapshots before deploy.sh's documented rotation.
cp -a "$DATA/deploy-backups" "$MAINT/prior-deploy-backups"
printf 'PRIOR_SNAPSHOTS_PRESERVED\n'
systemctl --user stop "$SERVICE.service"
STOPPED=true
if systemctl --user is-active --quiet "$SERVICE.service"; then
  printf 'SERVICE_DID_NOT_STOP\n' >&2
  false
fi
[ "$(systemctl --user show "$SERVICE.service" --property=MainPID --value)" = 0 ]
cp -a "$APP" "$MAINT/application-backup"
cp -p "$DATA/config.json" "$MAINT/original-config.json"
mkdir -m 700 "$MAINT/units-backup"
for f in "$SERVICE.service" "$SERVICE-update.service" "$SERVICE-update.timer"; do cp -p "$HOME/.config/systemd/user/$f" "$MAINT/units-backup/$f"; done
export QQ_AGENT_DATA_DIR="$DATA"
"$NODE" --input-type=module <<'JS'
import fs from 'node:fs';import path from 'node:path';import {DatabaseSync,backup} from 'node:sqlite';
const data='/mnt/data/qq-agent/data',target='/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY/data-backup';
if(fs.existsSync(target))throw new Error('backup target already exists');fs.mkdirSync(target,{mode:0o700});
const db=new DatabaseSync(path.join(data,'messages.sqlite'),{readOnly:true});
const integrity=db.prepare('PRAGMA quick_check').all();if(JSON.stringify(integrity)!=='[{"quick_check":"ok"}]')throw new Error('source SQLite quick_check failed');
const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(v=>v.name));const counts={};
for(const name of ['messages','outbox','batches','batch_effects','conversation_threads'])if(tables.has(name))counts[name]=Number(db.prepare(`SELECT count(*) AS n FROM "${name}"`).get().n);
try{await backup(db,path.join(target,'messages.sqlite'));}finally{db.close();}
const skip=new Set(['messages.sqlite','messages.sqlite-wal','messages.sqlite-shm','deploy-backups','update-work','update-repository.git','.deploy.lock']);
for(const e of fs.readdirSync(data))if(!skip.has(e))fs.cpSync(path.join(data,e),path.join(target,e),{recursive:true});
const check=new DatabaseSync(path.join(target,'messages.sqlite'),{readOnly:true});if(JSON.stringify(check.prepare('PRAGMA quick_check').all())!=='[{"quick_check":"ok"}]')throw new Error('backup SQLite quick_check failed');check.close();
fs.writeFileSync('/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY/before-data-counts.json',JSON.stringify(counts),{mode:0o600});
console.log(JSON.stringify({dataBackup:true,sqliteQuickCheck:'ok',counts}));
JS
printf 'BACKUP_COMPLETE\n'
unset NODE_OPTIONS QQ_AGENT_CONSOLE_TOKEN QQ_AGENT_ONEBOT_TOKEN QQ_AGENT_ONEBOT_HTTP_TOKEN QQ_AGENT_ONEBOT_WS_URL QQ_AGENT_ONEBOT_HTTP_URL QQ_AGENT_MODEL_BASE_URL QQ_AGENT_MODEL_API_KEY QQ_AGENT_MODEL_KEY_FILE QQ_AGENT_ALLOW_GROUPS QQ_AGENT_ALLOW_PRIVATE
export QQ_AGENT_SOURCE_REVISION=91beebbcc3a99e725b5f35ac97245a80ca1195ea
export QQ_AGENT_MODEL=deepseek/deepseek-v4.1-flash-1017
export QQ_AGENT_REPOSITORY=https://github.com/Velvetalon/qq-agent-plus.git QQ_AGENT_BRANCH=main
cd "/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY/validation-91beebbcc3/source"
bash deploy.sh --install-dir "$APP" --data-dir "$DATA" --service "$SERVICE" --node "$NODE" > "$MAINT/deployment.log" 2>&1
DEPLOY_FINISHED=true
printf 'DEPLOY_COMMAND_SUCCESS\n'
python3 - <<'PY'
import pathlib,json,urllib.request,hashlib,stat,subprocess
r=pathlib.Path('/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY');app=pathlib.Path('/mnt/data/qq-agent/app');data=pathlib.Path('/mnt/data/qq-agent/data')
before=json.loads((r/'original-config.json').read_text());c=json.loads((data/'config.json').read_text());token=c['server']['token']
patch={'api':{'model':'deepseek/deepseek-v4.1-flash-1017','thinking':'on','fallback':{'enabled':False}},'conversation':{'social':{'reviewMaxOutputTokens':2048,'reviewTimeoutMs':45000}},'selfEvolution':{'retrieval':{'embedding':{'timeoutMs':60000}}}}
req=urllib.request.Request('http://127.0.0.1:3210/api/config',data=json.dumps(patch).encode(),headers={'Content-Type':'application/json','x-console-token':token},method='POST')
with urllib.request.urlopen(req,timeout=30) as res:assert res.status==200;res.read()
provider_id=before['api']['provider'];embedding_key=str(before.get('providerKeys',{}).get(provider_id) or before['api'].get('apiKey') or '').strip();assert embedding_key
embedding_patch={'enabled':True,'provider':'NanoGPT','baseUrl':'https://api.nano-gpt.com/api/v1','model':'Qwen/Qwen3-Embedding-4B','dimension':2560,'apiKey':embedding_key,'allowQuery':True,'allowPrivate':False}
def embedding_api(route,body):
 request=urllib.request.Request('http://127.0.0.1:3210'+route,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','x-console-token':token},method='POST')
 with urllib.request.urlopen(request,timeout=90) as response:assert response.status==200;return json.loads(response.read())
try:
 embedding_saved=embedding_api('/api/embedding/settings',embedding_patch);assert embedding_saved.get('ok') is True
 embedding_probe=embedding_api('/api/embedding/test',{})
 assert embedding_probe.get('ok') is True and embedding_probe.get('dimension')==2560,'Embedding validation did not pass'
except Exception:
 indexing_pause_confirmed=False
 try:
  paused=embedding_api('/api/embedding/settings',{'enabled':False})
  indexing_pause_confirmed=paused.get('ok') is True
 except Exception:
  pass
 raise AssertionError('Embedding save/test failed; indexingPauseConfirmed='+str(indexing_pause_confirmed)+'; service will be held for coordinator recovery') from None
c=json.loads((data/'config.json').read_text())
assert c['api']['model']==patch['api']['model'] and c['api']['thinking']=='on' and c['api']['fallback']['enabled'] is False
assert c['conversation']['social']['reviewMaxOutputTokens']==2048 and c['conversation']['social']['reviewTimeoutMs']==45000
for k in ['mode','paused']:assert c['runtime'].get(k)==before['runtime'].get(k),'runtime changed: '+k
for k in ['host','port','token']:assert c['server'].get(k)==before['server'].get(k),'server changed: '+k
for k in ['provider','baseUrl']:assert c['api'].get(k)==before['api'].get(k),'provider binding changed: '+k
assert (c['api'].get('apiKey') or '')==(before['api'].get('apiKey') or ''),'inline key changed'
assert c.get('providerKeys')==before.get('providerKeys'),'provider credentials changed'
for k in ['allow','deny','blocklist','onebot','timeControl']:assert c.get(k)==before.get(k),'protected field changed: '+k
assert c['conversation']['mode']==before['conversation']['mode']=='lifecycle'
assert c.get('autoUpdate',{}).get('enabled')==before.get('autoUpdate',{}).get('enabled') is False
assert stat.S_IMODE((data/'config.json').stat().st_mode)==0o600
assert (data/'deployed-revision').read_text().strip()=='91beebbcc3a99e725b5f35ac97245a80ca1195ea'
manifest_bytes=(r/'validation-91beebbcc3'/'expected-source-sha256.json').read_bytes()
assert hashlib.sha256(manifest_bytes).hexdigest()=='afca77f6d8e867c64498bd6bf7a5eb0db9b84764653b1cbf68c817faf055f7f3','manifest digest mismatch'
manifest=json.loads(manifest_bytes);assert len(manifest)==142,'manifest count mismatch'
mismatches=[p for p,h in manifest.items() if not (app/p).is_file() or hashlib.sha256((app/p).read_bytes()).hexdigest()!=h]
assert not mismatches,'source hash mismatch: '+','.join(mismatches[:8])
with urllib.request.urlopen('http://127.0.0.1:3210/healthz',timeout=10) as res:health=json.loads(res.read());assert res.status==200 and health['ok'] is True
req=urllib.request.Request('http://127.0.0.1:3210/api/embedding/settings',headers={'x-console-token':token})
with urllib.request.urlopen(req,timeout=10) as res:embedding=json.loads(res.read())
public=embedding.get('config') or embedding.get('embedding',{}).get('config') or {}
if not public:
 for v in embedding.values():
  if isinstance(v,dict) and 'model' in v:public=v;break
assert public.get('model')=='Qwen/Qwen3-Embedding-4B' and public.get('dimension')==2560,'embedding preset not preserved'
assert public.get('enabled') is True and public.get('hasApiKey') is True and embedding.get('configured') is True,'authorized embedding not configured'
assert public.get('allowQuery') is True and public.get('allowPrivate') is False,'embedding privacy/query scope differs from consent'
saved_profile=c['selfEvolution']['retrieval']['embedding']
assert saved_profile.get('apiKey')==embedding_key and saved_profile.get('timeoutMs')==60000,'embedding credential/timeout not preserved'
def evolution_flags(cfg):
 raw=cfg.get('selfEvolution') or cfg.get('plugins',{}).get('selfEvolution') or cfg.get('plugins',{}).get('self-evolution') or {}
 master=raw.get('enabled') is True
 return {'master':master,'retrieval':master and raw.get('retrieval',{}).get('enabled') is True,'reflection':master and raw.get('reflection',{}).get('enabled',True) is True}
assert evolution_flags(c)==evolution_flags(before)=={'master':True,'retrieval':True,'reflection':True},'existing memory feature enablement changed'
assert c['selfEvolution'].get('reflection')==before['selfEvolution'].get('reflection'),'reflection settings changed'
for k,v in before.get('autoUpdate',{}).items():assert c.get('autoUpdate',{}).get(k)==v,'autoUpdate state changed: '+k
def unit_status(unit):
 raw=subprocess.check_output(['systemctl','--user','show',unit,'--property=ActiveState,SubState,UnitFileState,MainPID,ExecMainStatus,NRestarts'],text=True)
 return dict(line.split('=',1) for line in raw.splitlines() if '=' in line)
service=unit_status('qq-agent-linux.service');timer=unit_status('qq-agent-linux-update.timer')
assert service.get('ActiveState')=='active' and service.get('SubState')=='running' and service.get('UnitFileState')=='enabled'
assert service.get('ExecMainStatus')=='0' and service.get('NRestarts')=='0' and int(service.get('MainPID','0'))>0,'service unhealthy or restarted'
assert timer.get('ActiveState')=='active' and timer.get('UnitFileState')=='enabled','timer state changed'
node_code='''import fs from "node:fs";import {DatabaseSync} from "node:sqlite";const db=new DatabaseSync("/mnt/data/qq-agent/data/messages.sqlite",{readOnly:true});if(JSON.stringify(db.prepare("PRAGMA quick_check").all())!==\'[{"quick_check":"ok"}]\')throw new Error("SQLite check failed");const before=JSON.parse(fs.readFileSync("/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY/before-data-counts.json","utf8"));const counts={};for(const name of ["messages","outbox"])if(name in before){const n=Number(db.prepare(`SELECT count(*) AS n FROM "${name}"`).get().n);if(n<before[name])throw new Error("history row count decreased: "+name);counts[name]=n;}db.close();console.log(JSON.stringify({sqliteQuickCheck:"ok",historyCountsNotDecreased:true,counts}));'''
database=json.loads(subprocess.check_output(['/mnt/data/qq-agent/app/.runtime/node-v22.23.2-linux-x64/bin/node','--input-type=module','-e',node_code],text=True))
result={'status':'SUCCESS','deployedRevision':(data/'deployed-revision').read_text().strip(),'sourceFilesVerified':len(manifest),'health':health,'runtime':c['runtime'],'conversationMode':c['conversation']['mode'],'model':c['api']['model'],'providerBindingPreserved':True,'credentialsPreserved':True,'protectedSettingsPreserved':True,'configPermissions':'0600','reviewLimits':{'maxOutputTokens':2048,'timeoutMs':45000},'embedding':{'model':public.get('model'),'dimension':public.get('dimension'),'enabled':public.get('enabled'),'state':embedding.get('state'),'configured':embedding.get('configured'),'allowQuery':public.get('allowQuery'),'allowPrivate':public.get('allowPrivate'),'probe':embedding_probe,'vector':embedding.get('vector')},'backupRoot':str(r),'explicitQQTestRequestsIssued':False,'totalLiveSendsMeasured':False,'service':service,'updateTimer':timer,'memoryFeatureFlagsPreserved':True,'database':database}
(r/'update-result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
PY
trap - ERR INT TERM
printf 'UPDATE_AND_VERIFY=PASS\n'
