import test from 'node:test';
import assert from 'node:assert/strict';
import { isPanelNearBottom, nextPanelScrollTop } from '../client/src/panel-scroll.ts';

test('painel de voz: detecta usuário próximo do fim sem tratar painel sem overflow como ancorado', () => {
  assert.equal(isPanelNearBottom(1800, 1104, 600), true);
  assert.equal(isPanelNearBottom(1800, 800, 600), false);
  assert.equal(isPanelNearBottom(500, 0, 600), false);
});

test('painel de voz: preserva posição durante rerender estrutural', () => {
  const next = nextPanelScrollTop({
    key: 'voice-1',
    scrollTop: 640,
    scrollHeight: 1900,
    clientHeight: 600,
    pinnedToBottom: false
  }, 'voice-1', 2400, 600);
  assert.equal(next, 640);
});

test('painel de voz: se estava no fim, continua no fim quando preview é inserido acima', () => {
  const next = nextPanelScrollTop({
    key: 'voice-1',
    scrollTop: 1200,
    scrollHeight: 1800,
    clientHeight: 600,
    pinnedToBottom: true
  }, 'voice-1', 2600, 600);
  assert.equal(next, 2000);
});

test('painel de voz: trocar de canal não herda scroll antigo', () => {
  const next = nextPanelScrollTop({
    key: 'voice-1',
    scrollTop: 700,
    scrollHeight: 1800,
    clientHeight: 600,
    pinnedToBottom: false
  }, 'voice-2', 1700, 600);
  assert.equal(next, 0);
});
