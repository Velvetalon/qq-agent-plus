printf '%s\n' 'Archived snapshot only; execution blocked'
exit 64
set -euo pipefail
[ "$(id -un)" = ubuntu ]
[ "$(id -u)" = 1000 ]
python3 - <<'PY'
import pathlib,os,json,shutil,subprocess
app=pathlib.Path('/mnt/data/qq-agent/app');data=pathlib.Path('/mnt/data/qq-agent/data');maint=pathlib.Path('/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY')
assert app.resolve()==app and data.resolve()==data and maint.resolve()==maint
unreadable=0;files=0
for base in [app,data/'deploy-backups']:
 for root,dirs,names in os.walk(base,followlinks=False):
  if not os.access(root,os.R_OK|os.X_OK):unreadable+=1
  for name in names:
   p=pathlib.Path(root)/name;files+=1
   if not p.is_symlink() and not os.access(p,os.R_OK):unreadable+=1
available=shutil.disk_usage(data).free
assert available>2*1024**3 and unreadable==0,'backup prerequisites not met'
c=json.loads((data/'config.json').read_text());raw=c.get('selfEvolution') or {}
assert c['runtime']['mode']=='active' and c['runtime'].get('paused') is False
assert c['conversation']['mode']=='lifecycle' and c['api']['baseUrl'].rstrip('/')=='https://nano-gpt.com/api/v1'
assert raw.get('enabled') is True and raw.get('retrieval',{}).get('enabled') is True and raw.get('reflection',{}).get('enabled') is True
assert not raw.get('retrieval',{}).get('embedding',{}).get('enabled')
assert not (data/'.deploy.lock').exists() and not (maint/'update.pid').exists() and not (maint/'update-result.json').exists()
for name in ['application-backup','data-backup','original-config.json','units-backup','prior-deploy-backups']:assert not (maint/name).exists(),name
assert subprocess.run(['systemctl','--user','is-active','--quiet','qq-agent-linux-update.service']).returncode!=0
assert subprocess.run(['systemctl','--user','is-active','--quiet','qq-agent-linux.service']).returncode==0
print(json.dumps({'backupFilesReadable':files,'unreadable':unreadable,'freeBytes':available,'originalRevision':(data/'deployed-revision').read_text().strip(),'existingMemoryFlagsPreserved':True,'concurrentDeploymentDetected':False,'newAttemptNotStarted':True}))
PY
