#!/usr/bin/env bash
# Isolated real systemd/backup test. Never points at production paths or data.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Execute com sudo para testar systemd localmente.' >&2; exit 1; }
src="$(cd -- "$(dirname -- "$0")/.." && pwd)"
node_bin="${VERDANT_QA_NODE:?Informe o caminho absoluto do Node 24 usado no build}"
qa=/opt/verdant-local-qa
data=/var/lib/verdant-local-qa
unit=/run/systemd/system/verdant-local-qa.service
for target in "$qa" "$data" "$unit"; do
  [[ ! -e "$target" ]] || { echo "QA recusado: caminho existente $target" >&2; exit 1; }
done
! id verdant-local-qa >/dev/null 2>&1 || { echo 'Usuário de QA já existe.' >&2; exit 1; }
cleanup() {
  systemctl stop verdant-local-qa-cert.timer verdant-local-qa-cert.service verdant-local-qa-turn.service >/dev/null 2>&1 || true
  systemctl stop verdant-local-qa.service >/dev/null 2>&1 || true
  rm -f "$unit"
  rm -f /run/systemd/system/verdant-local-qa-turn.service /run/systemd/system/verdant-local-qa-cert.service /run/systemd/system/verdant-local-qa-cert.timer
  systemctl daemon-reload
  userdel verdant-local-qa >/dev/null 2>&1 || true
  rm -rf -- "$qa" "$data"
}
trap cleanup EXIT
install -d -m 0755 "$qa/current" "$qa/node/bin"
install -m 0755 "$node_bin" "$qa/node/bin/node"
node_bin="$qa/node/bin/node"
useradd --system --home-dir "$data" --shell /usr/sbin/nologin verdant-local-qa
install -d -o verdant-local-qa -g verdant-local-qa -m 0750 "$data" "$data/uploads"
rsync -a --exclude=.git --exclude=data --exclude=uploads --exclude=logs --exclude=test-results --exclude=backups --exclude='*.env' --exclude='.env*' --exclude='*.pem' --exclude='*.key' --exclude='node_modules/mediasoup/worker/out/Release/build' "$src/" "$qa/current/"
export VERDANT_QA_ROOT="$qa"
"$node_bin" --input-type=module <<'JS'
import fs from 'node:fs';
const qa=process.env.VERDANT_QA_ROOT;
const source=fs.readFileSync(`${qa}/current/deploy/verdant.service`,'utf8');
const unit=source.replaceAll('/opt/verdant/current',`${qa}/current`).replaceAll('/opt/verdant-node',`${qa}/node`)
 .replaceAll('/etc/verdant/verdant.env',`${qa}/qa.env`).replaceAll('/var/lib/verdant','/var/lib/verdant-local-qa')
 .replace(/^User=verdant$/m,'User=verdant-local-qa').replace(/^Group=verdant$/m,'Group=verdant-local-qa')
 .replace(/^StateDirectory=verdant$/m,'StateDirectory=verdant-local-qa').replace(/^RuntimeDirectory=verdant$/m,'RuntimeDirectory=verdant-local-qa');
fs.writeFileSync('/run/systemd/system/verdant-local-qa.service',unit);
fs.writeFileSync(`${qa}/qa.env`, `NODE_ENV=development
VERDANT_HOST=127.0.0.1
VERDANT_PORT=43911
PUBLIC_ORIGIN=http://127.0.0.1:43911
MEDIASOUP_LISTEN_IP=127.0.0.1
MEDIASOUP_PORT=43912
DATA_DIR=/var/lib/verdant-local-qa
DATABASE_PATH=/var/lib/verdant-local-qa/verdant.sqlite
UPLOAD_PATH=/var/lib/verdant-local-qa/uploads
VERDANT_JOURNAL_ONLY=true
TURN_ENABLED=false
TURN_SECRET=local-qa-redaction-sentinel
`,{mode:0o640});
JS
chown root:verdant-local-qa "$qa/qa.env"
systemd-analyze verify "$unit"
systemctl daemon-reload
systemctl start verdant-local-qa.service
export VERDANT_ENV_FILE="$qa/qa.env" VERDANT_NODE="$node_bin" VERDANT_SERVICE=verdant-local-qa
"$qa/current/deploy/health.sh"
systemctl show verdant-local-qa -p User -p ProtectSystem -p ProtectHome -p ActiveState
"$node_bin" --input-type=module <<'JS'
import assert from 'node:assert/strict'; import fs from 'node:fs';
const base='http://127.0.0.1:43911';
const r=await fetch(base+'/api/servers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Systemd QA',ownerName:'QA'})});
assert.equal(r.status,201); const b=await r.json();
const channel=b.channels.find(c=>c.type==='text');
const file=await fetch(`${base}/api/channels/${channel.id}/files?name=backup-qa.txt`,{method:'POST',headers:{'x-verdant-session':b.session.token},body:'Verdant backup payload'});
assert.equal(file.status,201);
fs.writeFileSync(process.env.VERDANT_QA_ROOT+'/fixture.json',JSON.stringify({serverId:b.server.id,channelId:channel.id,file:(await file.json()).file}),{mode:0o600});
console.log('QA fixture: server and attachment created through running service');
JS
before_pid="$(systemctl show verdant-local-qa -p MainPID --value)"
worker_pid="$(pgrep -P "$before_pid" -f '/mediasoup-worker')"
kill -KILL "$worker_pid"
for attempt in {1..20}; do
  after_pid="$(systemctl show verdant-local-qa -p MainPID --value)"
  if [[ $after_pid != 0 && $after_pid != "$before_pid" ]]; then break; fi
  sleep 1
done
[[ $after_pid != 0 && $after_pid != "$before_pid" ]]
"$qa/current/deploy/health.sh"
echo 'Worker crash: systemd restarted the application and native worker'
export BACKUP_DIR="$qa/backups"
"$node_bin" "$qa/current/deploy/backup.mjs"
"$qa/current/deploy/health.sh"
install -d "$qa/restored"
archive=("$qa"/backups/*.tar.gz)
[[ ${#archive[@]} == 1 ]]
[[ $(stat -c %a "${archive[0]}") == 600 ]]
tar -xzf "${archive[0]}" -C "$qa/restored"
[[ $(sqlite3 "$qa/restored/verdant.sqlite" 'PRAGMA integrity_check;') == ok ]]
! rg -q 'local-qa-redaction-sentinel|TURN_SECRET' "$qa/restored/config-without-secrets.json"
systemctl stop verdant-local-qa.service
mv "$data" "$qa/before-restore"
install -d -o verdant-local-qa -g verdant-local-qa -m 0750 "$data"
cp "$qa/restored/verdant.sqlite" "$data/verdant.sqlite"
cp -a "$qa/restored/uploads" "$data/uploads"
chown -R verdant-local-qa:verdant-local-qa "$data"
systemctl start verdant-local-qa.service
"$qa/current/deploy/health.sh"
"$node_bin" --input-type=module <<'JS'
import assert from 'node:assert/strict'; import fs from 'node:fs';
const f=JSON.parse(fs.readFileSync(process.env.VERDANT_QA_ROOT+'/fixture.json','utf8')), base='http://127.0.0.1:43911';
const r=await fetch(`${base}/api/servers/${f.serverId}/join`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'QA'})});
assert.equal(r.status,200); const session=(await r.json()).session;
const history=await (await fetch(`${base}/api/channels/${f.channelId}/messages`,{headers:{'x-verdant-session':session.token}})).json();
assert.equal(history.messages.length,1); assert.equal(history.messages[0].attachment.id,f.file.id);
const files=fs.readdirSync('/var/lib/verdant-local-qa/uploads').filter(n=>n.endsWith('.blob'));
assert.equal(files.length,1); assert.equal(fs.readFileSync('/var/lib/verdant-local-qa/uploads/'+files[0],'utf8'),'Verdant backup payload');
console.log('Restore: persisted server, attachment history and original file bytes verified');
JS
systemctl stop verdant-local-qa.service
[[ $(systemctl show verdant-local-qa -p ExecMainStatus --value) == 0 ]]
export VERDANT_ENV_FILE="$qa/turn.env" VERDANT_CADDY_STORAGE="$qa/caddy-certs" VERDANT_TURN_TLS_DIR="$qa/turn-tls" VERDANT_TURN_SERVICE=verdant-local-qa-turn
"$node_bin" --input-type=module <<'JS'
import fs from 'node:fs'; import {execFileSync} from 'node:child_process'; import {randomBytes} from 'node:crypto';
const qa=process.env.VERDANT_QA_ROOT;
const override=fs.readFileSync(`${qa}/current/deploy/coturn.override.conf`,'utf8')
 .replace('/etc/verdant/turnserver.conf',`${qa}/turn.conf`).replaceAll('/run/coturn','/run/verdant-local-qa-turn')
 .replace('RuntimeDirectory=coturn','RuntimeDirectory=verdant-local-qa-turn');
fs.writeFileSync('/run/systemd/system/verdant-local-qa-turn.service','[Unit]\nDescription=Verdant isolated Coturn QA\n'+override);
fs.writeFileSync(`${qa}/turn.env`,`TURN_ENABLED=true\nTURN_TLS_ENABLED=true\nTURN_HOST=localhost\nTURN_REALM=verdant.test\nTURN_SECRET=${randomBytes(32).toString('hex')}\n`,{mode:0o600});
const certService=fs.readFileSync(`${qa}/current/deploy/turn-cert-sync.service`,'utf8')
 .replace('After=caddy.service','After=verdant-local-qa-turn.service').replaceAll('/opt/verdant-node',`${qa}/node`).replaceAll('/opt/verdant/current',`${qa}/current`)
 .replace('[Service]',`[Service]\nEnvironment=VERDANT_ENV_FILE=${qa}/turn.env\nEnvironment=VERDANT_CADDY_STORAGE=${qa}/caddy-certs\nEnvironment=VERDANT_TURN_TLS_DIR=${qa}/turn-tls\nEnvironment=VERDANT_TURN_SERVICE=verdant-local-qa-turn`);
fs.writeFileSync('/run/systemd/system/verdant-local-qa-cert.service',certService);
fs.writeFileSync('/run/systemd/system/verdant-local-qa-cert.timer',fs.readFileSync(`${qa}/current/deploy/turn-cert-sync.timer`,'utf8').replaceAll('turn-cert-sync.service','verdant-local-qa-cert.service'));
fs.mkdirSync(`${qa}/caddy-certs/qa-issuer/localhost`,{recursive:true});
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','3','-subj','/CN=wrong.invalid','-keyout',`${qa}/caddy-certs/qa-issuer/localhost/localhost.key`,'-out',`${qa}/caddy-certs/qa-issuer/localhost/localhost.crt`],{stdio:'ignore'});
JS
systemctl daemon-reload
if "$node_bin" "$qa/current/deploy/sync-turn-cert.mjs" >/dev/null 2>&1; then echo 'Invalid certificate was accepted' >&2; exit 1; fi
openssl req -x509 -newkey rsa:2048 -nodes -days 3 -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1 -keyout "$qa/caddy-certs/qa-issuer/localhost/localhost.key" -out "$qa/caddy-certs/qa-issuer/localhost/localhost.crt" >/dev/null 2>&1
"$node_bin" "$qa/current/deploy/sync-turn-cert.mjs"
[[ $(stat -c '%a %U %G' "$qa/turn-tls/privkey.pem") == '640 root turnserver' ]]
"$node_bin" --input-type=module <<'JS'
import fs from 'node:fs'; import {parseEnv} from 'node:util'; import {execFileSync} from 'node:child_process';
const qa=process.env.VERDANT_QA_ROOT, env=parseEnv(fs.readFileSync(`${qa}/turn.env`,'utf8'));
const {turnTlsSettings}=await import(`${qa}/current/deploy/turn-tls.mjs`);
const values={TURN_PORT:43978,TURN_TLS_PORT:43979,TURN_LISTEN_IP:'127.0.0.1',PUBLIC_IP:'127.0.0.1',RELAY_MIN:44000,RELAY_MAX:44030,
 TURN_REALM:env.TURN_REALM,TURN_HOST:env.TURN_HOST,TURN_SECRET:env.TURN_SECRET,TLS_SETTINGS:turnTlsSettings(true,execFileSync('turnserver',['-h'],{encoding:'utf8'}),`${qa}/turn-tls/fullchain.pem`,`${qa}/turn-tls/privkey.pem`)};
fs.writeFileSync(`${qa}/turn.conf`,fs.readFileSync(`${qa}/current/deploy/turnserver.conf.example`,'utf8').replace(/@@([A-Z_]+)@@/g,(_,k)=>String(values[k]))+'\nallow-loopback-peers\nrelay-threads=1\n',{mode:0o640});
JS
chown root:turnserver "$qa/turn.conf"
systemd-analyze verify /run/systemd/system/verdant-local-qa-turn.service /run/systemd/system/verdant-local-qa-cert.service /run/systemd/system/verdant-local-qa-cert.timer
systemctl start verdant-local-qa-turn.service
sleep 1
"$node_bin" --input-type=module <<'JS'
import fs from 'node:fs'; import {parseEnv} from 'node:util';
const qa=process.env.VERDANT_QA_ROOT, env=parseEnv(fs.readFileSync(`${qa}/turn.env`,'utf8'));
const {TurnCredentials}=await import(`${qa}/current/server/src/turn.ts`), {checkTurnRelay}=await import(`${qa}/current/tests/helpers/turn-client.ts`);
for(const mode of ['udp','tcp','tls']) await checkTurnRelay({mode,port:mode==='tls'?43979:43978,ca:fs.readFileSync(`${qa}/turn-tls/fullchain.pem`),...new TurnCredentials(env).issue().iceServers[0]});
console.log('Coturn systemd sandbox: UDP/TCP/TLS ChannelData relay verified');
JS
turn_pid="$(systemctl show verdant-local-qa-turn -p MainPID --value)"
systemctl start verdant-local-qa-cert.service
[[ $(systemctl show verdant-local-qa-turn -p MainPID --value) == "$turn_pid" ]]
openssl req -x509 -newkey rsa:2048 -nodes -days 3 -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1 -keyout "$qa/caddy-certs/qa-issuer/localhost/localhost.key" -out "$qa/caddy-certs/qa-issuer/localhost/localhost.crt" >/dev/null 2>&1
systemctl start verdant-local-qa-cert.service
[[ $(systemctl show verdant-local-qa-turn -p MainPID --value) != "$turn_pid" ]]
systemctl start verdant-local-qa-cert.timer
systemctl is-active --quiet verdant-local-qa-cert.timer
echo 'Certificate sync: wrong hostname rejected, permissions enforced, unchanged cert avoids restart, renewed cert restarts Coturn; timer active'
echo 'PASS: local systemd, worker recovery, backup/restore, Coturn and certificate sync; QA resources cleaned on exit'
