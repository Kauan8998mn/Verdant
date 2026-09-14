import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceRegistry } from '../server/src/voice-registry.ts';

test('VoiceRegistry mantém estados separados e localiza nomes sem diferenciar caixa', () => {
  const registry = new VoiceRegistry();
  registry.join({ token: 'a', serverId: 's1', channelId: 'v1', displayName: 'Uriel', role: 'owner' });
  registry.join({ token: 'b', serverId: 's1', channelId: 'v1', displayName: 'Alice', role: 'member' });
  registry.join({ token: 'c', serverId: 's1', channelId: 'v2', displayName: 'Bob', role: 'member' });

  registry.updateSelf('b', { selfMuted: true, deafened: true });
  registry.setAdminMuted('c', true);

  assert.equal(registry.findByName('s1', 'ALICE')?.token, 'b');
  assert.equal(registry.listChannel('s1', 'v1').length, 2);
  assert.equal(registry.get('b')?.selfMuted, true);
  assert.equal(registry.get('b')?.deafened, true);
  assert.equal(registry.get('c')?.adminMuted, true);
});

test('VoiceRegistry sincroniza cargo durante chamada e remove participante ao sair', () => {
  const registry = new VoiceRegistry();
  registry.join({ token: 'a', serverId: 's1', channelId: 'v1', displayName: 'Alice', role: 'member' });
  registry.syncSession('a', { role: 'moderator' });
  assert.equal(registry.get('a')?.role, 'moderator');
  assert.equal(registry.leave('a')?.displayName, 'Alice');
  assert.equal(registry.get('a'), undefined);
});
