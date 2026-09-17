#!/usr/bin/env bash
set -euo pipefail
exec "${VERDANT_NODE:-/opt/verdant-node/bin/node}" --input-type=module - <<'JS'
import fs from 'node:fs'; import {parseEnv} from 'node:util';
const e=parseEnv(fs.readFileSync(process.env.VERDANT_ENV_FILE||'/etc/verdant/verdant.env','utf8'));
const host=new URL(e.PUBLIC_ORIGIN).host;
for(let i=0;i<20;i++) {
 try { const r=await fetch(`http://127.0.0.1:${e.VERDANT_PORT||43110}/api/health`,{headers:{host},signal:AbortSignal.timeout(2000)}); const b=await r.json(); if(r.ok&&b.ok){console.log(JSON.stringify(b));process.exit(0);} } catch{}
 await new Promise(r=>setTimeout(r,1000));
}
console.error('Healthcheck falhou; journalctl -u verdant -n 80');process.exit(1);
JS
