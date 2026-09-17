// Offline migration of legacy nickname ownership; run with Verdant stopped.
import fs from 'node:fs'; import {parseEnv} from 'node:util'; import {DatabaseSync} from 'node:sqlite'; import {spawnSync} from 'node:child_process';
if(process.getuid?.()!==0) throw new Error('Execute como root.');
if(spawnSync('systemctl',['is-active','--quiet','verdant']).status===0) throw new Error('Pare Verdant antes de vincular identidades.');
const [server,name,principal]=process.argv.slice(2);
if(!server||!name||!/^[a-zA-Z0-9_-]{1,64}$/.test(principal??'')) throw new Error('Uso: node deploy/bind-identity.mjs SERVER_UUID "Apelido" login_caddy');
const env=parseEnv(fs.readFileSync('/etc/verdant/verdant.env','utf8'));
const db=new DatabaseSync(env.DATABASE_PATH);
const normalized=name.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('pt-BR');
if(!db.prepare('SELECT 1 FROM role_bindings WHERE server_id=? AND normalized_name=?').get(server,normalized)) throw new Error('Apelido/cargo legado não encontrado.');
db.exec('CREATE TABLE IF NOT EXISTS member_identities(server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,normalized_name TEXT NOT NULL,principal TEXT NOT NULL,PRIMARY KEY(server_id,normalized_name),UNIQUE(server_id,principal)) STRICT;');
db.prepare('INSERT INTO member_identities(server_id,normalized_name,principal) VALUES(?,?,?)').run(server,normalized,principal);
db.close();console.log('Identidade vinculada sem alterar mensagens ou cargo.');
