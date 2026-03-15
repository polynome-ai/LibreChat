import type { LiveKitConfig } from '~/bridge/types';

let _config: LiveKitConfig | null = null;

export function loadLiveKitConfig(): LiveKitConfig {
  const apiKey = process.env.LIVEKIT_API_KEY ?? '';
  const apiSecret = process.env.LIVEKIT_API_SECRET ?? '';
  const serverUrl = process.env.LIVEKIT_SERVER_URL ?? '';
  const webhookSecret = process.env.LIVEKIT_WEBHOOK_SECRET ?? '';

  if (!apiKey || !apiSecret || !serverUrl) {
    throw new Error('[LiveKit] Missing required env vars: LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_SERVER_URL');
  }

  return {
    apiKey,
    apiSecret,
    serverUrl,
    webhookSecret,
    roomEmptyTimeoutSecs: Number(process.env.LIVEKIT_ROOM_TIMEOUT_SECS ?? '3600'),
    tokenTtlSecs: Number(process.env.LIVEKIT_TOKEN_TTL_SECS ?? '86400'),
  };
}

export function getLiveKitConfig(): LiveKitConfig {
  if (!_config) _config = loadLiveKitConfig();
  return _config;
}
