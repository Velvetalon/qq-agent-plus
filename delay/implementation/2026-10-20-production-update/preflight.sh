#!/usr/bin/env bash
# ARCHIVED INCOMPLETE IMPLEMENTATION: NOT A DEPLOYMENT ENTRY POINT.
printf "Archived snapshot only. Read README and revalidate before materializing executable code.\n" >&2
exit 64
# BEGIN PRESERVED IMPLEMENTATION BODY (sanitized paths)
set -eu
printf 'USER='; id -un
printf 'UID='; id -u
printf 'HOST='; hostname
printf 'SYSTEM='; uname -srm
printf 'USER_MANAGER='; if systemctl --user show-environment >/dev/null 2>&1; then printf 'available\n'; else printf 'unavailable\n'; fi
printf '\nAGENT_UNITS\n'; systemctl --user list-unit-files 'qq-agent*' --no-pager --no-legend || true
printf '\nKNOWN_INSTALL_PATHS\n'
for p in /data/qq-agent/app /mnt/data/qq-agent/app /home/ubuntu/qq-agent/app /home/qqagent/qq-agent/app /opt/qq-agent/app; do
 if test -d "$p"; then stat -c '%U %G %a %n' "$p"; if test -f "$p/.deployment.json"; then printf 'DEPLOYMENT_METADATA=%s/.deployment.json\n' "$p"; fi; fi
done
printf '\nHOME_CANDIDATES\n'; printf '%s\n' "$HOME"/*qq* "$HOME"/apps/*qq* 2>/dev/null || true
printf '\nDISK\n'; df -h / /data /mnt/data 2>/dev/null || true
