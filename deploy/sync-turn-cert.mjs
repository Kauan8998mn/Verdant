import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { bool, hostname } from '../server/src/config.ts';
import { X509Certificate, createPrivateKey } from 'node:crypto';
if(process.getuid?.()!==0) throw new Error('Execute como root.');
const e=parseEnv(fs.readFileSync(process.env.VERDANT_ENV_FILE || '/etc/verdant/verdant.env','utf8'));
if(!bool(e.TURN_ENABLED)||!bool(e.TURN_TLS_ENABLED ?? 'true')) process.exit(0);
const host=hostname(e.TURN_HOST);
if(!/^[a-z0-9.-]+$/.test(host??'')) throw new Error('TURN_HOST inválido.');
const storage=process.env.VERDANT_CADDY_STORAGE || '/var/lib/caddy/.local/share/caddy/certificates';
const service=process.env.VERDANT_TURN_SERVICE || 'coturn';
if(!/^[a-zA-Z0-9_-]+$/.test(service)) throw new Error('Nome de serviço inválido.');
let pair;
for(const issuer of fs.existsSync(storage)?fs.readdirSync(storage):[]) {
 const dir=path.join(storage,issuer,host);
 const cert=path.join(dir,host+'.crt'), key=path.join(dir,host+'.key');
 if(!fs.existsSync(cert)||!fs.existsSync(key)) continue;
 try {
  const certificate=new X509Certificate(fs.readFileSync(cert));
  if(!certificate.checkHost(host) || Date.parse(certificate.validTo) < Date.now()+86400_000 ||
     !certificate.checkPrivateKey(createPrivateKey(fs.readFileSync(key)))) continue;
  pair={cert,key}; break;
 } catch{}
}
if(!pair) throw new Error('Certificado TURN válido ainda indisponível. Verifique DNS/80/443 e journalctl -u caddy; depois repita configure.sh.');
const dir=process.env.VERDANT_TURN_TLS_DIR || '/etc/verdant/turn-tls'; fs.mkdirSync(dir,{recursive:true,mode:0o750});
fs.chmodSync(dir,0o750);
execFileSync('chown',['root:turnserver',dir]);
let changed=false;
for(const [source,name] of [[pair.cert,'fullchain.pem'],[pair.key,'privkey.pem']]) {
 const data=fs.readFileSync(source), dest=path.join(dir,name);
 if(fs.existsSync(dest)&&data.equals(fs.readFileSync(dest))) {
  fs.chmodSync(dest,0o640); execFileSync('chown',['root:turnserver',dest]); continue;
 }
 fs.writeFileSync(dest+'.next',data,{mode:0o640}); execFileSync('chown',['root:turnserver',dest+'.next']); fs.renameSync(dest+'.next',dest); changed=true;
}
if(changed) execFileSync('systemctl',['try-restart',service]);
console.log('Certificado TURN conferido; chaves não exibidas.');
