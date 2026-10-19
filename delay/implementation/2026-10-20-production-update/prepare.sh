#!/usr/bin/env bash
# ARCHIVED INCOMPLETE IMPLEMENTATION: NOT A DEPLOYMENT ENTRY POINT.
printf "Archived snapshot only. Read README and revalidate before materializing executable code.\n" >&2
exit 64
# BEGIN PRESERVED IMPLEMENTATION BODY (sanitized paths)
set -eu
[ "$(id -u)" = 1000 ]
[ "$(id -un)" = ubuntu ]
MAINT=/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY
[ "$(readlink -f /home/ubuntu)" = /home/ubuntu ]
[ ! -e "$MAINT" ]
[ "$(readlink -f /mnt/data/qq-agent/app)" = /mnt/data/qq-agent/app ]
[ "$(readlink -f /mnt/data/qq-agent/data)" = /mnt/data/qq-agent/data ]
[ ! -e /mnt/data/qq-agent/data/.deploy.lock ]
if systemctl --user is-active --quiet qq-agent-linux-update.service; then
  printf 'CONCURRENT_UPDATE_REFUSED\n' >&2
  false
fi
mkdir -m 700 "$MAINT"
printf 'MAINTENANCE_DIRECTORY=%s\n' "$MAINT"
printf 'DROP_INS='; systemctl --user show qq-agent-linux.service --property=DropInPaths --value
printf '\nMEMORY\n'; free -m
printf '\nBACKUP_PATH_VERIFICATION\n'
python3 - <<'PY'
import pathlib,json
root=pathlib.Path('/mnt/data/qq-agent/data/deploy-backups')
assert root.resolve()==root and not root.is_symlink()
entries=[]
for p in root.iterdir():
 assert not p.is_symlink() and p.resolve().parent==root
 entries.append({'name':p.name,'directory':p.is_dir()})
print(json.dumps({'backupRootVerified':True,'entries':entries}))
PY
