import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { isIP } from 'node:net';
import { loadConfig, resolveAnnouncedAddress, integer, bool, hostname } from '../server/src/config.ts';
import { TurnCredentials } from '../server/src/turn.ts';
import { turnTlsSettings } from './turn-tls.mjs';

if (process.getuid?.() !== 0) throw new Error('Execute com sudo na VM.');
const root = '/opt/verdant/current';
const env = parseEnv(fs.readFileSync('/etc/verdant/verdant.env','utf8'));
const config = loadConfig(root, env);
if (!config.production || config.mediaDisabled) throw new Error('Deploy exige NODE_ENV=production e mídia habilitada.');
new TurnCredentials(env); // validate without printing or writing temporary credentials
const publicIp = await resolveAnnouncedAddress(config);
const turnEnabled = bool(env.TURN_ENABLED);
const turnHost = hostname(env.TURN_HOST);
const appHost = new URL(config.publicOrigin).hostname;
if (!turnHost || turnHost === appHost || isIP(turnHost) || !turnHost.includes('.')) throw new Error('Use TURN_HOST DNS próprio, diferente do domínio da aplicação.');
if (/example\.(com|org|net)$/.test(appHost) || /example\.(com|org|net)$/.test(turnHost)) throw new Error('Substitua os domínios de exemplo.');
if (!fs.readFileSync('/etc/verdant/caddy-users','utf8').trim()) throw new Error('Crie ao menos um usuário individual: deploy/add-user.py nome.');
const expectedData='/var/lib/verdant';
if (config.databasePath !== `${expectedData}/verdant.sqlite` || config.uploadsDir !== `${expectedData}/uploads`) throw new Error('Units fornecidas esperam DATABASE_PATH e UPLOAD_PATH em /var/lib/verdant.');
const values = {
 APP_HOST: appHost, APP_PORT: config.port, UPLOAD_BYTES: config.uploadMaxBytes,
 TURN_HOST: turnHost, PUBLIC_IP: publicIp,
 TURN_PORT: integer(env.TURN_PORT ?? '3478','TURN_PORT',1,65535),
 TURN_TLS_PORT: integer(env.TURN_TLS_PORT ?? '5349','TURN_TLS_PORT',1,65535),
 TURN_LISTEN_IP: env.TURN_LISTEN_IP,
 RELAY_MIN: integer(env.TURN_RELAY_MIN ?? '40000','TURN_RELAY_MIN',1024,65535),
 RELAY_MAX: integer(env.TURN_RELAY_MAX ?? '40100','TURN_RELAY_MAX',1024,65535),
 TURN_REALM: hostname(env.TURN_REALM), TURN_SECRET: env.TURN_SECRET
};
if (turnEnabled && (isIP(values.TURN_LISTEN_IP ?? '') !== 4 || values.TURN_LISTEN_IP === '0.0.0.0')) throw new Error('TURN_LISTEN_IP deve ser o IPv4 real da interface da VM.');
if (values.RELAY_MAX < values.RELAY_MIN || values.RELAY_MAX-values.RELAY_MIN > 200) throw new Error('Faixa de relay inválida (máximo 201 portas nesta implantação).');
const ports=[80,443,config.port,config.mediaPort,values.TURN_PORT,values.TURN_TLS_PORT];
if (new Set(ports).size !== ports.length || ports.some(p=>p>=values.RELAY_MIN&&p<=values.RELAY_MAX)) throw new Error('Portas de aplicação/mídia/TURN/relay em conflito.');
const tls = bool(env.TURN_TLS_ENABLED ?? 'true');
values.TLS_SETTINGS = turnEnabled ? turnTlsSettings(tls, execFileSync('turnserver', ['-h'], { encoding: 'utf8' })) : 'no-tls';
function render(file) {
 return fs.readFileSync(path.join(root,'deploy',file),'utf8').replace(/@@([A-Z_]+)@@/g,(_,key)=>{
  if (values[key] === undefined) throw new Error(`Configuração ausente: ${key}`);
  if (key !== 'TLS_SETTINGS' && /[\r\n]/.test(String(values[key]))) throw new Error(`Configuração inválida: ${key}`);
  return String(values[key]);
 });
}
function write(file, text, group, mode) {
 if (fs.existsSync(file)) {
  if (fs.readFileSync(file,'utf8') === text) return;
  fs.copyFileSync(file,`${file}.backup-${Date.now()}`);
 }
 const tmp=`${file}.next`;
 fs.writeFileSync(tmp,text,{mode});
 execFileSync('chown',[`root:${group}`,tmp]); fs.chmodSync(tmp,mode); fs.renameSync(tmp,file);
}
const caddy = render('Caddyfile');
const target='/etc/caddy/Caddyfile';
if(fs.existsSync(target)&&!fs.readFileSync(target,'utf8').includes('# Generated with validated settings by configure')&&!process.argv.includes('--replace-caddy')) {
 throw new Error('Caddyfile existente não gerenciado. Revise deploy/Caddyfile; execute configure.sh --replace-caddy para substituí-lo com backup.');
}
fs.writeFileSync('/etc/verdant/Caddyfile.validate',caddy,{mode:0o640});
try { execFileSync('caddy',['validate','--config','/etc/verdant/Caddyfile.validate','--adapter','caddyfile'],{stdio:'inherit'}); }
finally { fs.rmSync('/etc/verdant/Caddyfile.validate',{force:true}); }
write(target,caddy,'caddy',0o640);
execFileSync('systemctl',['enable','--now','caddy']);
execFileSync('systemctl',['reload','caddy']);
if(turnEnabled) {
 write('/etc/verdant/turnserver.conf',render('turnserver.conf.example'),'turnserver',0o640);
 if(tls) execFileSync('/opt/verdant-node/bin/node',[`${root}/deploy/sync-turn-cert.mjs`],{stdio:'inherit'});
 execFileSync('systemctl',['enable','--now','coturn']);
 execFileSync('systemctl',['restart','coturn']);
 execFileSync('systemctl',[tls ? 'enable' : 'disable','--now','turn-cert-sync.timer']);
} else {
 execFileSync('systemctl',['disable','--now','turn-cert-sync.timer']);
 execFileSync('systemctl',['disable','--now','coturn']);
}
execFileSync('systemctl',['enable','--now','verdant']);
execFileSync('systemctl',['restart','verdant']);
execFileSync(`${root}/deploy/health.sh`,[],{stdio:'inherit'});
console.log('Serviços configurados. Validação externa ainda obrigatória: docs/TESTING.md.');
