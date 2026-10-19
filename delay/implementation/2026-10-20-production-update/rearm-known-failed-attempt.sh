#!/usr/bin/env bash
# ARCHIVED INCOMPLETE IMPLEMENTATION: NOT A DEPLOYMENT ENTRY POINT.
printf "Archived snapshot only. Read README and revalidate before materializing executable code.\n" >&2
exit 64
# BEGIN PRESERVED IMPLEMENTATION BODY (sanitized paths)
set -euo pipefail
umask 077
[ "$(id -un)" = ubuntu ]
[ "$(id -u)" = 1000 ]
python3 - <<'PY'
import pathlib,json,os,fcntl,subprocess
r=pathlib.Path('/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY');assert r.resolve()==r
handles=[]
for name in ['launch.lock','rollout.lock']:
 p=r/name;assert not p.is_symlink() and p.resolve().parent==r
 h=p.open('a+');fcntl.flock(h,fcntl.LOCK_EX|fcntl.LOCK_NB);handles.append(h)
state=json.loads((r/'update-result.json').read_text());assert state['status']=='FAILED' and state['serviceStoppedForUpdate'] is False and state['deployFinished'] is False
pid=int((r/'update.pid').read_text())
try:os.kill(pid,0)
except ProcessLookupError:pass
else:raise RuntimeError('previous process still exists; refusing rearm')
for name in ['application-backup','data-backup','prior-deploy-backups']:assert not (r/name).exists(),'previous attempt performed backup work'
assert pathlib.Path('/mnt/data/qq-agent/data/deployed-revision').read_text().strip()=='059eba574a5e440fb9c385de5305f7afcc585a82'
assert subprocess.check_output(['systemctl','--user','show','qq-agent-linux.service','--property=MainPID','--value'],text=True).strip()=='2774819'
probe=json.loads((r/'production-embedding-probe-transport.json').read_text());assert probe['ok'] is True and probe['dimension']==2560
archive=r/'attempts'/'01-prestop-guard';archive.mkdir(parents=True,mode=0o700);assert archive.resolve().parent.parent==r
for name in ['update-result.json','update.pid','apply-update.log']:
 src=r/name;dst=archive/name
 assert src.resolve().parent==r and not src.is_symlink()
 assert dst.parent.resolve()==archive.resolve() and not dst.exists()
 src.rename(dst)
print(json.dumps({'knownFailedAttemptArchived':True,'previousProcessExited':True,'originalServiceStillRunning':True,'nextAttemptAllowed':True}))
PY
