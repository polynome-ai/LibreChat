import { AccessToken } from 'livekit-server-sdk';
import { getLiveKitConfig } from './config';

export interface ParticipantGrant {
  identity: string;
  name: string;
  roomName: string;
  canPublish: boolean;
  canSubscribe: boolean;
}

export async function generateParticipantToken(grant: ParticipantGrant): Promise<string> {
  const cfg = getLiveKitConfig();
  const token = new AccessToken(cfg.apiKey, cfg.apiSecret, {
    identity: grant.identity,
    name: grant.name,
    ttl: cfg.tokenTtlSecs,
  });
  token.addGrant({
    roomJoin: true,
    room: grant.roomName,
    canPublish: grant.canPublish,
    canSubscribe: grant.canSubscribe,
    canPublishData: true,
  });
  return token.toJwt();
}
