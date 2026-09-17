import type { Role } from '../../shared/src/domain.ts';
import type { Session } from './sessions.ts';

export interface MediaSignalSink {
  sendToSession(token: string, payload: unknown): void;
  broadcastToServer(serverId: string, payload: unknown, excludeToken?: string): void;
}

export interface MediaBackend {
  readonly enabled: boolean;
  readonly mediaPort?: number;
  readonly listenAddresses: string[];
  healthy?(): boolean;
  setSignalSink(sink: MediaSignalSink): void;
  handleRequest(session: Session, action: string, data: any): Promise<any>;
  disconnectSession(token: string): Promise<void>;
  close(): Promise<void>;
}

export interface VoiceMemberState {
  token: string;
  serverId: string;
  channelId: string;
  displayName: string;
  role: Role;
  selfMuted: boolean;
  deafened: boolean;
  adminMuted: boolean;
}

export class DisabledMediaBackend implements MediaBackend {
  readonly enabled = false;
  readonly listenAddresses: string[] = [];
  setSignalSink(): void {}
  async handleRequest(): Promise<any> {
    throw new Error('Mídia desativada neste processo.');
  }
  async disconnectSession(): Promise<void> {}
  async close(): Promise<void> {}
}
