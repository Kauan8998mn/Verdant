#!/usr/bin/env bash
set -euo pipefail
exec /opt/verdant-node/bin/node /opt/verdant/current/dist/configure.mjs "$@"
