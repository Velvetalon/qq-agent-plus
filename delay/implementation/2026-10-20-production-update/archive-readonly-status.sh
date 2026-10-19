#!/usr/bin/env bash
# ARCHIVED INCOMPLETE IMPLEMENTATION: NOT A DEPLOYMENT ENTRY POINT.
printf "Archived snapshot only. Read README and revalidate before materializing executable code.\n" >&2
exit 64
# BEGIN PRESERVED IMPLEMENTATION BODY (sanitized paths)
set -euo pipefail
[ "$(id -un)" = ubuntu ]
[ "$(id -u)" = 1000 ]
python3 - <<'PY'
import pathlib,json,subprocess,urllib.request,hashlib,sqlite3,datetime
r=pathlib.Path('/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY');app=pathlib.Path('/mnt/data/qq-agent/app');data=pathlib.Path('/mnt/data/qq-agent/data');cfg=json.loads((data/'config.json').read_text());raw=cfg.get('selfEvolution') or {};embedding=raw.get('retrieval',{}).get('embedding') or {}
def unit(name):
 s=subprocess.check_output(['systemctl','--user','show',name,'--property=ActiveState,SubState,UnitFileState,MainPID,ExecMainStatus,NRestarts,ExecMainStartTimestamp'],text=True)
 return dict(line.split('=',1) for line in s.splitlines() if '=' in line)
with urllib.request.urlopen('http://127.0.0.1:3210/healthz',timeout=10) as res:health=json.loads(res.read())
notes=data/'plugins'/'self-evolution'/'state.sqlite';note_count=None
if notes.exists():
 db=sqlite3.connect(notes.as_uri()+'?mode=ro',uri=True);note_count=db.execute('select count(*) from notebook_notes').fetchone()[0];db.close()
old=r/'attempts'/'01-prestop-guard'/'update-result.json'
files={}
for name in ['apply-update.sh','launch.lock','rollout.lock','update-result.json','update.pid','application-backup','data-backup','original-config.json','units-backup','prior-deploy-backups']:
 p=r/name;files[name]={'exists':p.exists()}
 if p.is_file() and name=='apply-update.sh':files[name]['sha256']=hashlib.sha256(p.read_bytes()).hexdigest();files[name]['bytes']=p.stat().st_size
result={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'deployedRevision':(data/'deployed-revision').read_text().strip(),'packageVersion':json.loads((app/'package.json').read_text())['version'],'service':unit('qq-agent-linux.service'),'updateTimer':unit('qq-agent-linux-update.timer'),'updateService':unit('qq-agent-linux-update.service'),'health':health,'runtime':cfg.get('runtime'),'conversationMode':cfg.get('conversation',{}).get('mode'),'chatModel':cfg.get('api',{}).get('model'),'chatCredentialPresent':bool(cfg.get('providerKeys',{}).get(cfg.get('api',{}).get('provider')) or cfg.get('api',{}).get('apiKey')),'embeddingPersisted':{'enabled':embedding.get('enabled'),'model':embedding.get('model'),'dimension':embedding.get('dimension'),'keyPresent':bool(embedding.get('apiKey') or embedding.get('key'))},'existingMemoryFlags':{'master':raw.get('enabled'),'retrieval':raw.get('retrieval',{}).get('enabled'),'reflection':raw.get('reflection',{}).get('enabled')},'notebookCount':note_count,'deploymentLockExists':(data/'.deploy.lock').exists(),'maintenanceFiles':files,'archivedAttempt':json.loads(old.read_text()) if old.exists() else None,'existingDeploymentBackupCount':len(list((data/'deploy-backups').glob('*/')))}
print(json.dumps(result))
PY
