const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  createRoom,
  deleteRoom,
  generateParticipantToken,
  getLiveKitConfig,
  sessionManager,
  GenerationJobManager,
} = require('@librechat/api');

const router = express.Router();

/** POST /api/bridge/conversation/:id/voice/start */
router.post('/conversation/:id/voice/start', async (req, res) => {
  const { id: conversationId } = req.params;
  const userId = req.user.id;

  try {
    const existing = await sessionManager.getSessionForUser(conversationId, userId);
    if (existing && existing.status === 'active') {
      const cfg = getLiveKitConfig();
      const token = await generateParticipantToken({
        identity: userId,
        name: req.user.name ?? userId,
        roomName: existing.liveKitRoomId,
        canPublish: true,
        canSubscribe: true,
      });
      return res.json({ token, roomName: existing.liveKitRoomId, serverUrl: cfg.serverUrl, sessionId: conversationId });
    }

    const { roomName, roomSid } = await createRoom(conversationId);
    const cfg = getLiveKitConfig();
    const token = await generateParticipantToken({
      identity: userId,
      name: req.user.name ?? userId,
      roomName,
      canPublish: true,
      canSubscribe: true,
    });

    await sessionManager.createSession({
      conversationId,
      userId,
      liveKitRoomId: roomName,
      liveKitRoomSid: roomSid,
      agentIdentity: `agent-${conversationId}`,
      mode: 'voice',
    });

    const hasJob = await GenerationJobManager.hasJob(conversationId);
    if (!hasJob) {
      await GenerationJobManager.createJob(conversationId, userId, conversationId);
    }

    return res.json({ token, roomName, serverUrl: cfg.serverUrl, sessionId: conversationId });
  } catch (err) {
    logger.error('[BridgeVoice] start failed:', err);
    return res.status(500).json({ error: 'Failed to start voice session' });
  }
});

/** POST /api/bridge/conversation/:id/voice/stop */
router.post('/conversation/:id/voice/stop', async (req, res) => {
  const { id: conversationId } = req.params;
  const userId = req.user.id;

  try {
    const session = await sessionManager.getSessionForUser(conversationId, userId);
    if (!session) {
      return res.status(404).json({ error: 'No active voice session' });
    }

    await sessionManager.updateSession(conversationId, { status: 'ending' });
    await deleteRoom(session.liveKitRoomId).catch((err) =>
      logger.warn('[BridgeVoice] deleteRoom failed:', err.message),
    );
    await sessionManager.deleteSession(conversationId);
    await GenerationJobManager.completeJob(conversationId).catch(() => null);

    return res.json({ success: true });
  } catch (err) {
    logger.error('[BridgeVoice] stop failed:', err);
    return res.status(500).json({ error: 'Failed to stop voice session' });
  }
});

module.exports = router;
