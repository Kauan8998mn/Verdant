import test from 'node:test';
import assert from 'node:assert/strict';
import { isMessageScrollPinned, nextMessageScrollTop } from '../client/src/chat-scroll.ts';

test('chat: detecta quando o usuário está próximo do fim', () => {
  assert.equal(isMessageScrollPinned(2000, 1400, 600), true);
  assert.equal(isMessageScrollPinned(2000, 900, 600), false);
});

test('chat: rerender preserva posição quando o usuário está lendo mensagens antigas', () => {
  const top = nextMessageScrollTop({
    channelId: 'geral',
    scrollTop: 730,
    scrollHeight: 2200,
    clientHeight: 600,
    pinned: false
  }, 'geral', 3400, 600);
  assert.equal(top, 730);
});

test('chat: usuário no fim continua no fim após mensagem longa aumentar a altura', () => {
  const top = nextMessageScrollTop({
    channelId: 'geral',
    scrollTop: 1600,
    scrollHeight: 2200,
    clientHeight: 600,
    pinned: true
  }, 'geral', 5000, 600);
  assert.equal(top, 4400);
});

test('chat: trocar de canal abre o novo histórico no fim', () => {
  const top = nextMessageScrollTop({
    channelId: 'geral',
    scrollTop: 500,
    scrollHeight: 2200,
    clientHeight: 600,
    pinned: false
  }, 'jogos', 1800, 600);
  assert.equal(top, 1200);
});
