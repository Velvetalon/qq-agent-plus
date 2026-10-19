printf '%s\n' 'Archived snapshot only; execution blocked'
exit 64
set -euo pipefail
[ "$(id -un)" = ubuntu ]
[ "$(id -u)" = 1000 ]
MAINT=/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY
[ "$(readlink -f "$MAINT")" = "$MAINT" ]
[ ! -e "$MAINT/update.pid" ]
[ ! -e "$MAINT/update-result.json" ]
[ ! -e /mnt/data/qq-agent/data/.deploy.lock ]
bash -n "$MAINT/apply-update.sh"
python3 - <<'PY'
import pathlib,hashlib,json
r=pathlib.Path('/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY')
assert hashlib.sha256((r/'apply-update.sh').read_bytes()).hexdigest()=='41278bd1e6bb0efca38f3e9fce56ec745872a920d50c316f6cd0356dffe91e30'
v=r/'validation-91beebbcc3';assert json.loads((v/'linux-unit-summary.json').read_text())['exitCode']==0
assert json.loads((v/'python-cleanup-summary.json').read_text())['exitCode']==0
print(json.dumps({'finalWorkerSHA256Verified':True,'actualRevision':'91beebbcc3a99e725b5f35ac97245a80ca1195ea','candidateGatesPassed':True,'unknownPriorUpdate':False}))
PY
