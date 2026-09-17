import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { execFileSync, spawnSync } from 'node:child_process';
if(process.getuid?.()!==0) throw new Error('Execute como root.');
process.umask(0o077);
const e=parseEnv(fs.readFileSync(process.env.VERDANT_ENV_FILE || '/etc/verdant/verdant.env','utf8'));
const service=process.env.VERDANT_SERVICE || 'verdant';
if(!/^[a-zA-Z0-9_-]+$/.test(service)) throw new Error('Nome de serviço inválido.');
const database=path.resolve(e.DATABASE_PATH), uploads=path.resolve(e.UPLOAD_PATH);
const dest=path.resolve(process.env.BACKUP_DIR||'/var/backups/verdant');
if(dest===uploads||dest.startsWith(uploads+'/')) throw new Error('Backup deve ficar fora de uploads.');
fs.mkdirSync(dest,{recursive:true,mode:0o700});
const temp=fs.mkdtempSync(path.join(dest,'.in-progress-'));
const wasActive=spawnSync('systemctl',['is-active','--quiet',service]).status===0;
try {
 if(wasActive) execFileSync('systemctl',['stop',service]);
 if(fs.existsSync(database)) {
  execFileSync('sqlite3',[database,`.backup '${temp}/verdant.sqlite'`]);
  const result=execFileSync('sqlite3',[`${temp}/verdant.sqlite`,'PRAGMA integrity_check;'],{encoding:'utf8'}).trim();
  if(result!=='ok') throw new Error('Backup SQLite falhou na verificação.');
 }
 if(fs.existsSync(uploads)) fs.cpSync(uploads,`${temp}/uploads`,{recursive:true,filter:source=>!source.endsWith('.part')});
 const safe=Object.fromEntries(Object.entries(e).filter(([key])=>!/(SECRET|PASSWORD|HASH|TOKEN|KEY|CREDENTIAL)/i.test(key)));
 fs.writeFileSync(`${temp}/config-without-secrets.json`,JSON.stringify(safe,null,2));
 fs.writeFileSync(`${temp}/RESTORE.txt`,'Pare Verdant. Restaure verdant.sqlite e uploads em /var/lib/verdant com dono verdant:verdant. Recrie credenciais Caddy e TURN separadamente. Consulte docs/DEPLOY_ORACLE.md.\n');
 const filename=path.join(dest,`verdant-${new Date().toISOString().replace(/[:.]/g,'-')}.tar.gz`);
 execFileSync('tar',['-czf',filename,'-C',temp,'.']); fs.chmodSync(filename,0o600); console.log(filename);
} finally {
 fs.rmSync(temp,{recursive:true,force:true});
 if(wasActive) execFileSync('systemctl',['start',service]);
}
