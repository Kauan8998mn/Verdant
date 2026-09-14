import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLightBackground, normalizeHex } from '../client/src/client-preferences.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('pré-Fase 6.1 sem áudio: mensagens criam links sem innerHTML e preview externo é opt-in', () => {
  const main = fs.readFileSync(path.join(root, 'client/src/main.ts'), 'utf8');
  assert.match(main, /anchor\.rel = 'noopener noreferrer'/);
  assert.match(main, /clientPreferences\.externalMediaPreviews/);
  assert.doesNotMatch(main, /\.innerHTML\s*=/);
});

test('pré-Fase 6.1 sem áudio: tema troca para texto escuro quando o fundo passa de 50% de luminosidade', () => {
  assert.equal(isLightBackground('#ffffff'), true);
  assert.equal(isLightBackground('#ffb6d9'), true);
  assert.equal(isLightBackground('#000000'), false);
  assert.equal(isLightBackground('#08100f'), false);
  assert.equal(normalizeHex('#abc'), '#aabbcc');
});

test('superstress: ganho/monitor antigos continuam ausentes apesar do novo supressor', () => {
  const voice = fs.readFileSync(path.join(root, 'client/src/voice.ts'), 'utf8');
  assert.doesNotMatch(voice, /verdant\.remoteVolume\./);
  assert.doesNotMatch(voice, /setInputGain\(/);
  assert.doesNotMatch(voice, /toggleMicTest\(/);
});
