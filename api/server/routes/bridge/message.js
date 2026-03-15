const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { sessionManager } = require('@librechat/api');

const router = express.Router();

/** GET /api/bridge/conversation/:id/session */
router.get('/conversation/:id/session', async (req, res) => {
  const { id: conversationId } = req.params;
  const userId = req.user.id;

  try {
    const session = await sessionManager.getSessionForUser(conversationId, userId);
    if (!session) return res.json({ active: false });
    return res.json({
      active: session.status === 'active',
      mode: session.mode,
      roomName: session.liveKitRoomId,
      sessionId: session.sessionId,
    });
  } catch (err) {
    logger.error('[BridgeMessage] session lookup failed:', err);
    return res.status(500).json({ error: 'Failed to get session' });
  }
});

module.exports = router;
