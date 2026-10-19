printf '%s\n' 'Archived snapshot only; execution blocked'
exit 64
set -euo pipefail
[ "$(id -un)" = ubuntu ]
[ "$(id -u)" = 1000 ]
python3 - <<'PY'
import pathlib,json,subprocess,urllib.request,datetime,hashlib,sqlite3
r=pathlib.Path('/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY');data=pathlib.Path('/mnt/data/qq-agent/data');app=pathlib.Path('/mnt/data/qq-agent/app');c=json.loads((data/'config.json').read_text())
def unit(name):
 text=subprocess.check_output(['systemctl','--user','show',name,'--property=ActiveState,SubState,UnitFileState,MainPID,ExecMainStatus,NRestarts'],text=True)
 return dict(v.split('=',1) for v in text.splitlines() if '=' in v)
def api(route):
 req=urllib.request.Request('http://127.0.0.1:3210'+route,headers={'x-console-token':c['server']['token']})
 with urllib.request.urlopen(req,timeout=15) as res:return json.loads(res.read())
service=unit('qq-agent-linux.service');state=json.loads((r/'update-result.json').read_text()) if (r/'update-result.json').exists() else None
recovery=json.loads((r/'configuration-recovery-result.json').read_text()) if (r/'configuration-recovery-result.json').exists() else None
backfill=json.loads((r/'existing-note-backfill.json').read_text()) if (r/'existing-note-backfill.json').exists() else None
try:health=api('/healthz')
except Exception as e:health={'ok':False,'errorType':type(e).__name__}
try:
 embedding=api('/api/embedding/settings');public=embedding.get('config',{});v=embedding.get('vector') or {};vector={k:v.get(k) for k in ['reason','configured','dimension','profileId','stats'] if k in v}
except Exception as e:embedding={'state':'unavailable','errorType':type(e).__name__};public={};vector={}
manifest=json.loads((r/'validation-91beebbcc3'/'expected-source-sha256.json').read_text());mismatches=[name for name,h in manifest.items() if not (app/name).is_file() or hashlib.sha256((app/name).read_bytes()).hexdigest()!=h]
notes=data/'plugins'/'self-evolution'/'state.sqlite';note_count=None
if notes.exists():
 db=sqlite3.connect(notes.as_uri()+'?mode=ro',uri=True);note_count=db.execute('select count(*) from notebook_notes').fetchone()[0];db.close()
raw=c.get('selfEvolution') or {};e=raw.get('retrieval',{}).get('embedding') or {};before=json.loads((r/'original-config.json').read_text()) if (r/'original-config.json').exists() else None
result={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'operationStatus':recovery.get('status') if recovery else state.get('status') if state else None,'initialRolloutStatus':state.get('status') if state else None,'configurationRecoverySucceeded':bool(recovery and recovery.get('status')=='SUCCESS'),'authorizedExistingNoteBackfill':backfill,'revision':(data/'deployed-revision').read_text().strip(),'service':service,'timer':unit('qq-agent-linux-update.timer'),'health':health,'controlledSourceFiles':len(manifest),'sourceMismatches':mismatches,'runtime':c.get('runtime'),'conversationMode':c.get('conversation',{}).get('mode'),'chatModel':c.get('api',{}).get('model'),'providerAndKeysPreserved':bool(before and c['api']['provider']==before['api']['provider'] and c.get('providerKeys')==before.get('providerKeys')),'memoryFlags':{'master':raw.get('enabled'),'retrieval':raw.get('retrieval',{}).get('enabled'),'reflection':raw.get('reflection',{}).get('enabled')},'embedding':{'state':embedding.get('state'),'configured':embedding.get('configured'),'model':public.get('model') or e.get('model'),'dimension':public.get('dimension') or e.get('dimension'),'enabled':public.get('enabled') if 'enabled' in public else e.get('enabled'),'allowQuery':public.get('allowQuery'),'allowPrivate':public.get('allowPrivate'),'timeoutMs':e.get('timeoutMs'),'keyPresent':bool(e.get('apiKey')),'lastTest':embedding.get('lastTest'),'vector':vector},'notebookCount':note_count,'backupPresence':{name:(r/name).exists() for name in ['application-backup','data-backup','original-config.json','units-backup','prior-deploy-backups']},'explicitQQTestRequestsIssued':False,'totalLiveSendsMeasured':False}
(r/'post-release-status.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
PY
