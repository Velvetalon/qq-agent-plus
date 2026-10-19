#!/usr/bin/env bash
# ARCHIVED INCOMPLETE IMPLEMENTATION: NOT A DEPLOYMENT ENTRY POINT.
printf "Archived snapshot only. Read README and revalidate before materializing executable code.\n" >&2
exit 64
# BEGIN PRESERVED IMPLEMENTATION BODY (sanitized paths)
set -eu
MAINT=/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY
python3 - <<'PY'
import pathlib,json,re,os
r=pathlib.Path('/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY')
print('ATTEMPT_RESULT='+ (r/'update-result.json').read_text())
lines=(r/'apply-update.log').read_text(errors='replace').splitlines()
for line in lines[-35:]:
 line=re.sub(r'sk-[A-Za-z0-9_-]{12,}','[REDACTED]',line)
 print('DIAGNOSTIC='+line[:600])
pid=int((r/'update.pid').read_text());alive=True
try:os.kill(pid,0)
except ProcessLookupError:alive=False
print('ATTEMPT_PROCESS_ALIVE='+str(alive))
c=json.loads(pathlib.Path('/mnt/data/qq-agent/data/config.json').read_text())
raw=c.get('selfEvolution') or c.get('plugins',{}).get('selfEvolution') or c.get('plugins',{}).get('self-evolution') or {}
print('MEMORY_FLAGS='+json.dumps({'master':raw.get('enabled'),'retrieval':raw.get('retrieval',{}).get('enabled'),'reflection':raw.get('reflection',{}).get('enabled'),'embedding':raw.get('retrieval',{}).get('embedding',{}).get('enabled')}))
print('MAINTENANCE_ENTRIES='+json.dumps(sorted(p.name for p in r.iterdir())))
PY
systemctl --user show qq-agent-linux.service --property=ActiveState,SubState,MainPID --no-pager
