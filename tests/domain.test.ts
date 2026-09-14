import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPermission, normalizeName, validateDisplayName } from '../shared/src/domain.ts';

test('normalização de nomes impede duplicação trivial por caixa e unicode', () => {
  assert.equal(normalizeName('  URIEL  '), 'uriel');
  assert.equal(normalizeName('ＵＲＩＥＬ'), 'uriel');
  assert.equal(normalizeName('João   Silva'), 'joão silva');
});

test('validação de nome mantém forma de exibição e limita comprimento', () => {
  const ok = validateDisplayName(' Uriel ');
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value, 'Uriel');
    assert.equal(ok.normalized, 'uriel');
  }
  assert.equal(validateDisplayName('').ok, false);
  assert.equal(validateDisplayName('x'.repeat(33)).ok, false);
});

test('cargos básicos têm permissões coerentes', () => {
  assert.equal(hasPermission('owner', 'roles.assign'), true);
  assert.equal(hasPermission('moderator', 'channels.create'), true);
  assert.equal(hasPermission('member', 'channels.create'), false);
  assert.equal(hasPermission('member', 'chat.send'), true);
  assert.equal(hasPermission('member', 'screen.share'), true);
  assert.equal(hasPermission('moderator', 'streams.manage'), true);
  assert.equal(hasPermission('owner', 'streams.manage'), true);
});
