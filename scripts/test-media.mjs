import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

console.log('Preparando build para o E2E obrigatório das Fases 4 e 5...');
const build = spawnSync(process.execPath, [path.join(root, 'scripts', 'build.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
});
if (build.status !== 0) process.exit(build.status ?? 1);

console.log('Executando dois navegadores reais contra o mediasoup SFU (voz + tela/áudio)...');
const test = spawnSync(process.execPath, [
  '--experimental-strip-types',
  '--test',
  path.join(root, 'tests', 'media-browser.test.ts')
], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, REQUIRE_MEDIA_E2E: '1' }
});
process.exit(test.status ?? 1);
