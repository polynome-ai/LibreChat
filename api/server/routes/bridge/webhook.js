const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { getResponseSender } = require('librechat-data-provider');
const { verifyWebhookSignature, TranscriptPipeline, sessionManager } = require('@librechat/api');
const { saveMessage, getConvo, getMessages } = require('~/models');

const router = express.Router();
const transcriptPipeline = new TranscriptPipeline(saveMessage, getMessages);

/**
 * @route POST /api/bridge/webhook/livekit
 * @desc Receive LiveKit webhook events (HMAC auth, no JWT)
 */
router.post(
  '/livekit',
  express.raw({ type: 'application/webhook+json' }),
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const authHeader = String(req.headers['authorization'] ?? '');
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));

    if (!verifyWebhookSignature(rawBody, authHeader)) {
      logger.warn('[BridgeWebhook] Invalid signature');
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    const eventType = payload.event;
    const roomName = payload.room?.name ?? payload.roomName;

    if (roomName) {
      const conversationId = roomName.replace(/^bridge-/, '');

      if (eventType === 'transcript' && payload.transcript) {
        const session = await sessionManager.getSession(conversationId);
        if (session) {
          const { transcript } = payload;
          const isAgent = (payload.participant?.identity ?? '') === session.agentIdentity;
          let agentSender;
          if (isAgent && transcript.isFinal) {
            const convo = await getConvo(session.userId, conversationId).catch(() => null);
            agentSender = getResponseSender({
              model: convo?.model,
              endpoint: convo?.endpoint,
              endpointType: convo?.endpointType,
              modelLabel: convo?.modelLabel,
              chatGptLabel: convo?.chatGptLabel,
              modelDisplayLabel: convo?.modelDisplayLabel,
            }) || undefined;
          }
          await transcriptPipeline.processFragment(session, {
            roomName,
            participantIdentity: payload.participant?.identity ?? '',
            text: transcript.text ?? '',
            kind: transcript.isFinal ? 'final' : 'partial',
            timestamp: transcript.startTime ?? Date.now(),
            sequenceNumber: transcript.index ?? 0,
            utteranceId: transcript.trackSid ?? `${conversationId}-${transcript.startTime}`,
          }, agentSender).catch((err) => logger.error('[BridgeWebhook] processFragment error:', err));
        }
      }

      if (eventType === 'room_finished') {
        transcriptPipeline.removeBuffer(conversationId);
        await sessionManager.updateSession(conversationId, { status: 'ended' }).catch(() => null);
      }
    }

    return res.status(200).json({ ok: true });
  },
);

module.exports = router;
