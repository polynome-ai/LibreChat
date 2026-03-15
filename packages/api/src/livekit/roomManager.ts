import { RoomServiceClient } from 'livekit-server-sdk';
import { logger } from '@librechat/data-schemas';
import { getLiveKitConfig } from './config';

function toHttpUrl(url: string): string {
  return url.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
}

function getRoomClient(): RoomServiceClient {
  const cfg = getLiveKitConfig();
  return new RoomServiceClient(toHttpUrl(cfg.serverUrl), cfg.apiKey, cfg.apiSecret);
}

export function roomNameFromConversationId(conversationId: string): string {
  return `bridge-${conversationId}`;
}

export async function createRoom(conversationId: string): Promise<{ roomName: string; roomSid: string }> {
  const cfg = getLiveKitConfig();
  const roomName = roomNameFromConversationId(conversationId);
  const client = getRoomClient();
  const room = await client.createRoom({
    name: roomName,
    emptyTimeout: cfg.roomEmptyTimeoutSecs,
    metadata: JSON.stringify({ conversationId }),
  });
  logger.info(`[LiveKit] Room created: ${roomName} (sid=${room.sid})`);
  return { roomName, roomSid: room.sid ?? '' };
}

export async function deleteRoom(roomName: string): Promise<void> {
  const client = getRoomClient();
  await client.deleteRoom(roomName);
  logger.info(`[LiveKit] Room deleted: ${roomName}`);
}

export async function listParticipants(roomName: string): Promise<string[]> {
  const client = getRoomClient();
  const participants = await client.listParticipants(roomName);
  return participants.map((p) => p.identity);
}
