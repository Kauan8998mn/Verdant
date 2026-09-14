#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${VERDANT_DOMAIN:?Defina VERDANT_DOMAIN, ex.: verdant.exemplo.com}"
: "${VERDANT_PUBLIC_IP:?Defina VERDANT_PUBLIC_IP com o IP público/VPS}"
: "${VERDANT_AUTH_USER:?Defina VERDANT_AUTH_USER}"
: "${VERDANT_AUTH_HASH:?Defina VERDANT_AUTH_HASH gerado por: caddy hash-password}"
command -v caddy >/dev/null || { echo 'Caddy não encontrado.' >&2; exit 1; }
export HOST=127.0.0.1
export MEDIA_LISTEN_IPS=0.0.0.0
export MEDIA_ANNOUNCED_ADDRESS="$VERDANT_PUBLIC_IP"
export MEDIA_EXPOSE_INTERNAL_IP=0
export PUBLIC_ORIGIN="https://$VERDANT_DOMAIN"
export ALLOWED_HOSTS="$VERDANT_DOMAIN,127.0.0.1,localhost"
unset TLS_CERT TLS_KEY

# Caddy gerencia HTTPS público; Verdant fica HTTP apenas em loopback.
caddy run --config "$PWD/Caddyfile.online" --adapter caddyfile &
CADDY_PID=$!
trap 'kill "$CADDY_PID" 2>/dev/null || true' EXIT INT TERM
./run-host-linux.sh
