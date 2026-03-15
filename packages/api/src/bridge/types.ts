export type BridgeMode = 'text' | 'voice' | 'both';

export type SessionStatus = 'active' | 'ending' | 'ended';

/** Redis-persisted bridge session record */
export interface BridgeSession {
  sessionId: string;
  conversationId: string;
  userId: string;
  liveKitRoomId: string;
  liveKitRoomSid: string;
  mode: BridgeMode;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  agentIdentity: string;
}

export type BridgeSessionUpdate = Partial<
  Pick<BridgeSession, 'mode' | 'status' | 'updatedAt' | 'liveKitRoomSid'>
>;

export type TranscriptFragmentKind = 'partial' | 'final';

export interface TranscriptFragment {
  roomName: string;
  participantIdentity: string;
  text: string;
  kind: TranscriptFragmentKind;
  timestamp: number;
  sequenceNumber: number;
  utteranceId: string;
}

export interface UtteranceBuffer {
  utteranceId: string;
  participantIdentity: string;
  fragments: Map<number, string>;
  lastUpdated: number;
  isSealed: boolean;
}

export interface LiveKitConfig {
  apiKey: string;
  apiSecret: string;
  serverUrl: string;
  webhookSecret: string;
  roomEmptyTimeoutSecs: number;
  tokenTtlSecs: number;
}

export interface VoiceStartResponse {
  token: string;
  roomName: string;
  serverUrl: string;
  sessionId: string;
}

export interface VoiceStopResponse {
  success: boolean;
}
