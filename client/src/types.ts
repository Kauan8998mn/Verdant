export type Role = 'owner' | 'moderator' | 'member';
export type ChannelType = 'text' | 'voice';
export type ScreenResolutionName = '360p' | '480p' | '540p' | '576p' | '720p' | '900p' | '1080p';
export type ScreenFps = 30 | 60;
export type ScreenSourcePreference = 'any' | 'monitor' | 'window' | 'browser';

export interface ServerInfo {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  inviteCode: string;
  passwordProtected?: boolean;
}

export interface ChannelInfo {
  id: string;
  serverId: string;
  name: string;
  type: ChannelType;
  position: number;
}


export interface IndexedFileInfo {
  id: string;
  serverId: string;
  channelId: string;
  channelName: string;
  uploaderName: string;
  originalName: string;
  size: number;
  mime: string;
  sha256: string;
  createdAt: string;
  excerpt?: string;
}

export interface SessionInfo {
  token: string;
  serverId: string;
  displayName: string;
  role: Role;
}

export interface MemberProfileInfo {
  serverId: string;
  normalizedName: string;
  displayName: string;
  avatarDataUrl?: string | null;
  updatedAt: string;
}

export interface MessageInfo {
  id: string;
  serverId: string;
  channelId: string;
  authorName: string;
  authorRole: Role;
  content: string;
  createdAt: string;
  editedAt?: string;
  kind: 'user' | 'system';
  attachment?: {
    id: string;
    originalName: string;
    size: number;
    mime: string;
    sha256: string;
  };
  replyTo?: {
    id: string;
    authorName: string;
    content: string;
    attachmentName?: string;
  };
}

export interface PresenceInfo {
  displayName: string;
  role: Role;
  connected: boolean;
}

export interface NetworkAddress {
  name: string;
  address: string;
  kind: 'lan' | 'hamachi' | 'vpn' | 'other';
  port: number;
}

export interface MediaBootstrap {
  enabled: boolean;
  port?: number;
  listenAddresses: string[];
}

export interface Bootstrap {
  servers: ServerInfo[];
  addresses: NetworkAddress[];
  secureTransport: boolean;
  mediaSecureContextRequired: boolean;
  media: MediaBootstrap;
  participantLimit: number;
}

export interface VoiceMemberInfo {
  channelId: string;
  displayName: string;
  role: Role;
  selfMuted: boolean;
  deafened: boolean;
  adminMuted: boolean;
}


export interface RemoteScreenInfo {
  shareId: string;
  displayName: string;
  videoProducerId?: string;
  audioProducerId?: string;
  sourceType?: string;
  resolution?: ScreenResolutionName;
  fps?: ScreenFps;
  width?: number;
  height?: number;
  audio: boolean;
  videoPaused: boolean;
  audioMuted: boolean;
  preferredSpatialLayer?: number;
}

export interface ScreenShareStateInfo {
  status: 'idle' | 'starting' | 'sharing' | 'receiving' | 'error';
  resolution: ScreenResolutionName;
  fps: ScreenFps;
  includeAudio: boolean;
  sourcePreference: ScreenSourcePreference;
  bitrateKbps: number;
  localActive: boolean;
  localShareId?: string;
  audioCaptured?: boolean;
  actualWidth?: number;
  actualHeight?: number;
  actualFps?: number;
  sourceType?: string;
  remotes: RemoteScreenInfo[];
  focusedShareId?: string;
  allAudioMuted: boolean;
  lastError?: string;
}

export interface VoiceStateInfo {
  joinedChannelId?: string;
  joinedServerId?: string;
  joinedServerName?: string;
  joinedDisplayName?: string;
  status: 'idle' | 'joining' | 'connected' | 'reconnecting' | 'error';
  muted: boolean;
  deafened: boolean;
  adminMuted: boolean;
  members: VoiceMemberInfo[];
  speaking: Set<string>;
  inputDeviceId?: string;
  outputDeviceId?: string;
  inputDevices: MediaDeviceInfo[];
  outputDevices: MediaDeviceInfo[];
  transportState?: string;
  mediaRtt?: number;
  lastError?: string;
  screen: ScreenShareStateInfo;
}
