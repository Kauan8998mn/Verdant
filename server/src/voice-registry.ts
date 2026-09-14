import type { Role } from '../../shared/src/domain.ts';
import type { VoiceMemberState } from './media-contract.ts';

export class VoiceRegistry {
  #members = new Map<string, VoiceMemberState>();

  join(input: {
    token: string;
    serverId: string;
    channelId: string;
    displayName: string;
    role: Role;
  }): VoiceMemberState {
    const current = this.#members.get(input.token);
    const next: VoiceMemberState = {
      token: input.token,
      serverId: input.serverId,
      channelId: input.channelId,
      displayName: input.displayName,
      role: input.role,
      selfMuted: current?.selfMuted ?? false,
      deafened: current?.deafened ?? false,
      adminMuted: current?.adminMuted ?? false
    };
    this.#members.set(input.token, next);
    return { ...next };
  }

  syncSession(token: string, patch: Partial<Pick<VoiceMemberState, 'displayName' | 'role'>>): VoiceMemberState | undefined {
    const member = this.#members.get(token);
    if (!member) return undefined;
    if (typeof patch.displayName === 'string') member.displayName = patch.displayName;
    if (patch.role) member.role = patch.role;
    return { ...member };
  }

  leave(token: string): VoiceMemberState | undefined {
    const member = this.#members.get(token);
    if (!member) return undefined;
    this.#members.delete(token);
    return { ...member };
  }

  get(token: string): VoiceMemberState | undefined {
    const member = this.#members.get(token);
    return member ? { ...member } : undefined;
  }

  updateSelf(token: string, patch: Partial<Pick<VoiceMemberState, 'selfMuted' | 'deafened'>>): VoiceMemberState | undefined {
    const member = this.#members.get(token);
    if (!member) return undefined;
    if (typeof patch.selfMuted === 'boolean') member.selfMuted = patch.selfMuted;
    if (typeof patch.deafened === 'boolean') member.deafened = patch.deafened;
    return { ...member };
  }

  setAdminMuted(token: string, muted: boolean): VoiceMemberState | undefined {
    const member = this.#members.get(token);
    if (!member) return undefined;
    member.adminMuted = muted;
    return { ...member };
  }

  findByName(serverId: string, displayName: string): VoiceMemberState | undefined {
    const target = displayName.normalize('NFKC').trim().toLocaleLowerCase('pt-BR');
    for (const member of this.#members.values()) {
      if (member.serverId !== serverId) continue;
      if (member.displayName.normalize('NFKC').trim().toLocaleLowerCase('pt-BR') === target) return { ...member };
    }
    return undefined;
  }

  listServer(serverId: string): VoiceMemberState[] {
    return [...this.#members.values()]
      .filter(member => member.serverId === serverId)
      .map(member => ({ ...member }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));
  }

  listChannel(serverId: string, channelId: string): VoiceMemberState[] {
    return this.listServer(serverId).filter(member => member.channelId === channelId);
  }
}
