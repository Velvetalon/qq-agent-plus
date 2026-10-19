#!/usr/bin/env bash
# ARCHIVED INCOMPLETE IMPLEMENTATION: NOT A DEPLOYMENT ENTRY POINT.
printf "Archived snapshot only. Read README and revalidate before materializing executable code.\n" >&2
exit 64
# BEGIN PRESERVED IMPLEMENTATION BODY (sanitized paths)
set -euo pipefail
MAINT=/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY
[ "$(id -un)" = ubuntu ]
[ "$(id -u)" = 1000 ]
[ "$(readlink -f "$MAINT")" = "$MAINT" ]
command -v flock
bash -n "$MAINT/apply-update.sh"
python3 - <<'PY'
import subprocess,pathlib,json
root=pathlib.Path('/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY')
passed=[]
for fd,name in [(8,'mock-launch.lock'),(9,'mock-rollout.lock')]:
 lock=root/name
 held=f'exec {fd}>"{lock}"\nflock --nonblock {fd}\nprintf "LOCK_HELD\\n"\nread -r RELEASE\n'
 # The holder waits on controlled stdin; no live service operation is executed.
 p=subprocess.Popen(['bash','-e','-c',held],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 assert p.stdout.readline().strip()=='LOCK_HELD'
 attempt=f'exec {fd}>"{lock}"\nflock --nonblock {fd}\nprintf DUPLICATE_ALLOWED\n'
 other=subprocess.run(['bash','-se','-c',attempt],capture_output=True,text=True,timeout=10)
 assert other.returncode!=0 and 'DUPLICATE_ALLOWED' not in other.stdout
 p.stdin.write('release\n');p.stdin.flush();p.stdin.close();assert p.wait(timeout=10)==0
 after=subprocess.run(['bash','-se','-c',attempt],capture_output=True,text=True,timeout=10)
 assert after.returncode==0
 passed.append(name)
print(json.dumps({'atomicLockCases':len(passed),'concurrentSecondProcessRejected':True,'releaseAllowsNextProcess':True}))
PY
printf 'ORIGINAL_SERVICE_STATE\n'; systemctl --user show qq-agent-linux.service --property=ActiveState,SubState,MainPID --no-pager
[ ! -e "$MAINT/update-result.json" ]
[ ! -e /mnt/data/qq-agent/data/.deploy.lock ]
printf 'PRELAUNCH_CHECK=PASS\n'
