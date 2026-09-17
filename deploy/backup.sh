#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Execute com sudo na VM.' >&2; exit 1; }
if [[ ${1:-} != --locked ]]; then
  exec 9>/run/lock/verdant-maintenance.lock
  flock -n 9 || { echo 'Outra manutenção está em execução.' >&2; exit 1; }
fi
exec /opt/verdant-node/bin/node /opt/verdant/current/deploy/backup.mjs
