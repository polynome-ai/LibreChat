import { createHmac } from 'crypto';
import { WebhookReceiver } from 'livekit-server-sdk';
import { logger } from '@librechat/data-schemas';
import { getLiveKitConfig } from './config';

export function verifyWebhookSignature(rawBody: Buffer, authHeader: string): boolean {
  const { webhookSecret } = getLiveKitConfig();
  if (!webhookSecret) {
    logger.warn('[LiveKit] LIVEKIT_WEBHOOK_SECRET not set — skipping verification');
    return true;
  }
  try {
    const receiver = new WebhookReceiver(getLiveKitConfig().apiKey, getLiveKitConfig().apiSecret);
    receiver.receive(rawBody.toString('utf8'), authHeader);
    return true;
  } catch {
    const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    return expected === authHeader;
  }
}
