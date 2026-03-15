const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { getMessages } = require('~/models');

const router = express.Router();

const BRIDGE_SECRET = process.env.BRIDGE_SECRET ?? '';

function requireBridgeSecret(req, res, next) {
  if (!BRIDGE_SECRET) {
    logger.warn('[BridgeInternal] BRIDGE_SECRET not set — internal API disabled');
    return res.status(503).json({ error: 'Internal API not configured' });
  }
  if (req.headers['x-bridge-secret'] !== BRIDGE_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/** GET /api/bridge/internal/messages/:conversationId
 *  Returns full message history for a conversation.
 *  Auth: X-Bridge-Secret header (server-to-server only).
 */
router.get('/internal/messages/:conversationId', requireBridgeSecret, async (req, res) => {
  const { conversationId } = req.params;
  try {
    const messages = await getMessages({ conversationId }, '-_id -__v -user');
    res.json(messages ?? []);
  } catch (err) {
    logger.error('[BridgeInternal] getMessages failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
