import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tlsDir = path.join(root, 'data', 'tls');
const caKey = path.join(tlsDir, 'verdant-lan-ca.key');
const caCert = path.join(tlsDir, 'verdant-lan-ca.crt');
const serverKey = path.join(tlsDir, 'verdant-lan-server.key');
const serverCsr = path.join(tlsDir, 'verdant-lan-server.csr');
const serverCert = path.join(tlsDir, 'verdant-lan-server.crt');
const extFile = path.join(tlsDir, 'verdant-lan-server.ext');
const serialFile = path.join(tlsDir, 'verdant-lan-ca.srl');

const check = spawnSync('openssl', ['version'], { encoding: 'utf8' });
if (check.status !== 0) {
  console.error('OpenSSL não foi encontrado. Instale openssl e execute novamente: npm run tls:generate');
  process.exit(1);
}

fs.mkdirSync(tlsDir, { recursive: true, mode: 0o700 });
const addresses = detectAddresses();
const sans = ['DNS:localhost', 'IP:127.0.0.1', ...addresses.map(ip => `IP:${ip}`)];

if (!fs.existsSync(caKey) || !fs.existsSync(caCert)) {
  run(['genrsa', '-out', caKey, '3072']);
  run([
    'req', '-x509', '-new', '-sha256', '-nodes', '-key', caKey,
    '-days', '3650', '-out', caCert,
    '-subj', '/CN=Verdant LAN Local CA/O=Verdant LAN'
  ]);
  chmodPrivate(caKey);
  console.log('CA local criada.');
} else {
  console.log('Reutilizando CA local existente.');
}

run(['genrsa', '-out', serverKey, '2048']);
run([
  'req', '-new', '-key', serverKey, '-out', serverCsr,
  '-subj', '/CN=Verdant LAN Host/O=Verdant LAN'
]);
fs.writeFileSync(extFile, [
  'basicConstraints=CA:FALSE',
  'keyUsage=digitalSignature,keyEncipherment',
  'extendedKeyUsage=serverAuth',
  `subjectAltName=${sans.join(',')}`,
  ''
].join('\n'));
run([
  'x509', '-req', '-in', serverCsr, '-CA', caCert, '-CAkey', caKey,
  '-CAcreateserial', '-out', serverCert, '-days', '825', '-sha256', '-extfile', extFile
]);
chmodPrivate(serverKey);
for (const temporary of [serverCsr, extFile, serialFile]) {
  try { fs.rmSync(temporary, { force: true }); } catch {}
}

console.log('\nCertificado HTTPS do Verdant LAN gerado.');
console.log(`CA para confiar nos clientes: ${path.relative(root, caCert)}`);
console.log(`Certificado do host:           ${path.relative(root, serverCert)}`);
console.log(`Chave do host:                 ${path.relative(root, serverKey)}`);
console.log(`SANs: ${sans.join(', ')}`);
console.log('\nIMPORTANTE: compartilhe apenas o arquivo .crt da CA com os seus próprios clientes.');
console.log('Nunca compartilhe verdant-lan-ca.key nem verdant-lan-server.key.');
console.log('Se o IP LAN/Hamachi do host mudar, execute este comando novamente para renovar o certificado do host.');

function run(args) {
  try {
    execFileSync('openssl', args, { stdio: ['ignore', 'ignore', 'inherit'] });
  } catch {
    console.error(`Falhou: openssl ${args.join(' ')}`);
    process.exit(1);
  }
}

function detectAddresses() {
  const output = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    if (!entries) continue;
    const lowered = name.toLowerCase();
    if (/docker|br-|veth|virbr|podman|loopback/.test(lowered)) continue;
    for (const entry of entries) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      output.push(entry.address);
    }
  }
  return [...new Set(output)].sort();
}

function chmodPrivate(file) {
  if (process.platform !== 'win32') {
    try { fs.chmodSync(file, 0o600); } catch {}
  }
}
