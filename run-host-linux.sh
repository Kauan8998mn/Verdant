#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.13+ é necessário." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm é necessário para instalar as dependências de mídia (Fases 4/5)." >&2
  exit 1
fi

major="$(node -p 'process.versions.node.split(".")[0]')"
minor="$(node -p 'process.versions.node.split(".")[1]')"
if (( major < 22 || (major == 22 && minor < 13) )); then
  echo "Node.js 22.13+ é necessário. Encontrado: $(node -v)" >&2
  exit 1
fi

if [[ ! -f node_modules/mediasoup/package.json || ! -f node_modules/mediasoup-client/package.json || ! -x node_modules/.bin/esbuild || ! -x node_modules/mediasoup/worker/out/Release/mediasoup-worker ]]; then
  echo "Dependências de mídia ausentes. Instalando com npm..."
  npm install
fi

if [[ ! -x node_modules/mediasoup/worker/out/Release/mediasoup-worker ]]; then
  echo 'ERRO: o worker do mediasoup não foi criado. Verifique: npm install-scripts ls' >&2
  exit 1
fi

npm run build

TLS_DIR="$PWD/data/tls"
if [[ -z "${TLS_CERT:-}" && -z "${TLS_KEY:-}" && -f "$TLS_DIR/verdant-lan-server.crt" && -f "$TLS_DIR/verdant-lan-server.key" ]]; then
  export TLS_CERT="$TLS_DIR/verdant-lan-server.crt"
  export TLS_KEY="$TLS_DIR/verdant-lan-server.key"
fi

if [[ -z "${TLS_CERT:-}" || -z "${TLS_KEY:-}" ]]; then
  echo
  echo "AVISO: HTTPS ainda não está configurado."
  echo "Voz funciona em http://localhost, mas PCs remotos exigem HTTPS confiável."
  echo "Execute uma vez: npm run tls:generate"
  echo
fi

exec node --experimental-strip-types server/src/index.ts
