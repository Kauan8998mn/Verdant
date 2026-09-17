#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Execute com sudo na VM.' >&2; exit 1; }
mode=update
if [[ ${1:-} == --install ]]; then mode=install; shift; fi
src="$(realpath "${1:-$(dirname "$0")/..}")"
[[ -f "$src/package-lock.json" ]] || { echo 'Informe um checkout completo.' >&2; exit 1; }
exec 9>/run/lock/verdant-maintenance.lock
flock -n 9 || { echo 'Outra manutenção está em execução.' >&2; exit 1; }
release="/opt/verdant/releases/$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -o verdant-build -g verdant-build -m 0755 "$release"
rsync -a --exclude=.git --exclude=node_modules --exclude=data --exclude=uploads --exclude=logs --exclude=dist --exclude='.env*' --exclude='*.env' --exclude='*.key' --exclude='*.pem' --exclude=backups --exclude=test-results "$src/" "$release/"
chown -R verdant-build:verdant-build "$release"
runuser -u verdant-build -- env HOME=/var/cache/verdant-build PATH=/opt/verdant-node/bin:/usr/bin:/bin MEDIASOUP_MAX_CORES=2 bash -ec 'cd "$1"; npm ci --no-audit --no-fund; npm run build' bash "$release"
[[ -x "$release/node_modules/mediasoup/worker/out/Release/mediasoup-worker" ]] || { echo 'Worker mediasoup ausente.' >&2; exit 1; }
runuser -u verdant-build -- env PATH=/opt/verdant-node/bin:/usr/bin:/bin bash -c 'cd "$1"; node --input-type=module -e '\''import {createWorker} from "mediasoup"; const w=await createWorker(); w.close();'\''' bash "$release"
chown -R root:root "$release"
chmod -R go-w "$release"
previous="$(readlink -f /opt/verdant/current || true)"
if [[ $mode == update ]]; then "$release/deploy/backup.sh" --locked; fi
ln -s "$release" /opt/verdant/current.next
mv -Tf /opt/verdant/current.next /opt/verdant/current
if [[ $mode == update ]]; then
  systemctl restart verdant
  if ! "$release/deploy/health.sh"; then
    echo 'Healthcheck falhou. Código anterior preservado; não reverta banco automaticamente.' >&2
    if [[ -n $previous ]]; then echo "Versão anterior: $previous" >&2; fi
    exit 1
  fi
fi
echo "Release instalada: $release"
