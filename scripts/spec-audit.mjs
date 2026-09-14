import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const specPath = path.join(root, 'SPEC.md');
const manifestPath = path.join(root, 'IMPLEMENTATION_MANIFEST.json');

// Intencionalmente lê o arquivo inteiro a cada execução, conforme a regra do projeto.
const spec = fs.readFileSync(specPath, 'utf8');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const requestedPhaseArg = process.argv.find(arg => arg.startsWith('--phase='));
const requestedPhase = requestedPhaseArg ? Number(requestedPhaseArg.split('=')[1]) : undefined;

const sha256 = createHash('sha256').update(spec).digest('hex');
const lines = spec.split(/\r?\n/).length;
const failures = [];
const warnings = [];

const foundationalAnchors = [
  '# MISSÃO', '# 1. OBJETIVO PRINCIPAL', '# 2. MODELO CLIENTE/SERVIDOR', '# 3. COMPATIBILIDADE',
  '# 4. IDENTIDADE', '# 5. SERVIDORES', '# 6. CANAIS', '# 7. CARGOS E PERMISSÕES', '# 8. CHAT',
  '# 9. PERSISTÊNCIA', '# 10. ARQUIVOS', '# 11. CHAMADAS DE VOZ', '# 13. COMPARTILHAMENTO DE TELA',
  '# 16. MÚLTIPLAS TRANSMISSÕES', '# 24. PRIVACIDADE', '# 25. SEGURANÇA', '# 27. INTERFACE',
  '# 28. IDENTIDADE VISUAL', '# 39. DESENVOLVIMENTO INCREMENTAL', '# 40. CRITÉRIOS DE ACEITE',
  '# 47. REGRA DE AUTONOMIA', '# 48. REGRA CONTRA FALSA CONCLUSÃO', '# 50. RESULTADO ESPERADO'
];
for (const anchor of foundationalAnchors) if (!spec.includes(anchor)) failures.push(`SPEC sem âncora: ${anchor}`);

const phaseRequirements = {
  0: [
    'monorepo-structure', 'browser-client', 'node-backend', 'typescript-client', 'structured-logging',
    'configuration', 'build-script', 'test-runner'
  ],
  1: [
    'logical-servers', 'text-channels', 'voice-channel-model', 'unique-names-per-server',
    'roles-owner-moderator-member', 'discord-like-layout'
  ],
  2: [
    'websocket-chat', 'typing-indicator', 'presence', 'sqlite-persistence',
    'message-history-pagination', 'websocket-reconnect'
  ],
  3: ['file-upload-500mb'],
  4: ['webrtc-voice', 'mediasoup-sfu'],
  5: ['screen-share', 'screen-audio', 'screen-resolution-presets', 'screen-fps-selection', 'screen-source-selection'],
  6: ['multi-stream-grid', 'adaptive-layers'],
  7: ['performance-optimization'],
  8: ['server-password-memory-hard', 'advanced-permissions', 'rate-limits-hardening'],
  9: ['diagnostics-panel']
};

const implemented = new Set(manifest.implemented ?? []);
const pending = new Set(manifest.pending ?? []);
for (const phase of manifest.completedPhases ?? []) {
  for (const requirement of phaseRequirements[phase] ?? []) {
    if (!implemented.has(requirement)) failures.push(`Fase ${phase} marcada concluída sem: ${requirement}`);
  }
}
for (const item of implemented) if (pending.has(item)) failures.push(`Item simultaneamente implementado e pendente: ${item}`);

if (requestedPhase !== undefined) {
  if (!(manifest.completedPhases ?? []).includes(requestedPhase)) warnings.push(`Fase ${requestedPhase} ainda não está marcada como concluída.`);
  for (const requirement of phaseRequirements[requestedPhase] ?? []) {
    if (!implemented.has(requirement)) failures.push(`Auditoria da Fase ${requestedPhase}: ausente ${requirement}`);
  }
}

for (let phase = 0; phase <= 9; phase += 1) {
  const heading = phase === 0 ? '## Fase 0 — Fundação' : `## Fase ${phase}`;
  if (!spec.includes(heading)) failures.push(`Fase ${phase} não localizada no SPEC.`);
}

console.log(`SPEC relido integralmente: ${lines} linhas`);
console.log(`SHA-256 do SPEC: ${sha256}`);
console.log(`Fases marcadas concluídas: ${(manifest.completedPhases ?? []).join(', ') || 'nenhuma'}`);
for (const warning of warnings) console.warn(`AVISO: ${warning}`);
if (failures.length) {
  for (const failure of failures) console.error(`FALHA: ${failure}`);
  process.exit(1);
}
console.log('Auditoria estrutural: OK');
