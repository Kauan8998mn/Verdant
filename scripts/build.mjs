import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client = path.join(root, 'client');
const out = path.join(client, 'dist');
const esbuildBin = process.platform === 'win32'
  ? path.join(root, 'node_modules', '.bin', 'esbuild.cmd')
  : path.join(root, 'node_modules', '.bin', 'esbuild');
const tscBin = process.platform === 'win32'
  ? path.join(root, 'node_modules', '.bin', 'tsc.cmd')
  : path.join(root, 'node_modules', '.bin', 'tsc');

for (const required of [esbuildBin, tscBin]) {
  if (!existsSync(required)) {
    console.error('Dependências de build ausentes. Execute: npm install');
    process.exit(1);
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'assets'), { recursive: true });

const typecheck = spawnSync(tscBin, ['-p', path.join(client, 'tsconfig.json'), '--noEmit'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});
if (typecheck.status !== 0) process.exit(typecheck.status ?? 1);

const bundle = spawnSync(esbuildBin, [
  path.join(client, 'src', 'main.ts'),
  '--bundle',
  '--format=esm',
  '--platform=browser',
  '--target=es2022',
  '--sourcemap',
  '--outfile=' + path.join(out, 'assets', 'main.js')
], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});
if (bundle.status !== 0) process.exit(bundle.status ?? 1);

cpSync(path.join(client, 'public', 'index.html'), path.join(out, 'index.html'));
cpSync(path.join(client, 'public', 'styles.css'), path.join(out, 'styles.css'));
const publicSounds = path.join(client, 'public', 'sounds');
if (existsSync(publicSounds)) cpSync(publicSounds, path.join(out, 'sounds'), { recursive: true });
const publicAudio = path.join(client, 'public', 'audio');
if (existsSync(publicAudio)) cpSync(publicAudio, path.join(out, 'audio'), { recursive: true });
console.log(`Build concluído: ${path.relative(root, out)}`);

const serverBundle = spawnSync(esbuildBin, [
  path.join(root, 'server/src/index.ts'), '--bundle', '--platform=node', '--format=esm',
  '--target=node24', '--packages=external', '--outfile=' + path.join(root, 'dist/server.mjs')
], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (serverBundle.status !== 0) process.exit(serverBundle.status ?? 1);

const configureBundle = spawnSync(esbuildBin, [path.join(root, 'deploy/configure.mjs'),
  '--bundle', '--platform=node', '--format=esm', '--target=node24', '--packages=external',
  '--outfile=' + path.join(root, 'dist/configure.mjs')], { cwd: root, stdio: 'inherit' });
if (configureBundle.status !== 0) process.exit(configureBundle.status ?? 1);
