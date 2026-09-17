import fs from 'node:fs';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { execFileSync } from 'node:child_process';
import { hostname, isPublicIPv4 } from '../server/src/config.ts';

if (process.getuid?.() !== 0) throw new Error('Execute como root na VM.');
const [vm, appArg, turnArg] = process.argv.slice(2);
const app = hostname(appArg), turn = hostname(turnArg);
for (const value of [app, turn]) {
  if (!value || isIP(value) || !value.includes('.') || /replace|example\.(com|org|net)$/i.test(value)) throw new Error('Substitua os placeholders por domínios próprios.');
}
if (app === turn) throw new Error('Verdant e TURN precisam de domínios distintos.');
const records = await lookup(hostname(vm), { family: 4, all: true });
if (records.length !== 1 || !isPublicIPv4(records[0].address)) throw new Error('Host da VM deve resolver para um IPv4 público estável.');
const publicIp = records[0].address;
const route = JSON.parse(execFileSync('ip', ['-j', '-4', 'route', 'get', publicIp], { encoding: 'utf8' }))[0];
const localIp = route?.prefsrc ?? route?.src;
if (isIP(localIp ?? '') !== 4) throw new Error('Não foi possível identificar IPv4 da interface; configure TURN_LISTEN_IP manualmente.');
const file = '/etc/verdant/verdant.env';
let content = fs.readFileSync(file, 'utf8');
const values = { NODE_ENV: 'production', PUBLIC_ORIGIN: `https://${app}`, MEDIASOUP_ANNOUNCED_ADDRESS: publicIp,
  TURN_HOST: turn, TURN_REALM: app, TURN_LISTEN_IP: localIp };
for (const [key, value] of Object.entries(values)) {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  content = pattern.test(content) ? content.replace(pattern, `${key}=${value}`) : `${content}\n${key}=${value}\n`;
}
fs.copyFileSync(file, `${file}.before-prepare-${Date.now()}`);
fs.writeFileSync(file, content, { mode: 0o640 }); fs.chmodSync(file, 0o640);
console.log('Origem, IPv4 anunciado e interface TURN configurados. DNS/ACME e mídia ainda exigem validação.');
