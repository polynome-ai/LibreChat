const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { GenerationJobManager } = require('@librechat/api');

const router = express.Router();

/** GET /api/bridge/conversation/:id/stream — SSE */
router.get('/conversation/:id/stream', async (req, res) => {
  const { id: conversationId } = req.params;
  const userId = req.user.id;
  const isResume = req.query.resume === 'true';

  const job = await GenerationJobManager.getJob(conversationId);
  if (job && job.metadata?.userId && job.metadata.userId !== userId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  res.setHeader('Content-Encoding', 'identity');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  if (isResume && job) {
    const resumeState = await GenerationJobManager.getResumeState(conversationId);
    if (resumeState && !res.writableEnded) {
      res.write(`event: message\ndata: ${JSON.stringify({ sync: true, resumeState })}\n\n`);
      if (typeof res.flush === 'function') res.flush();
    }
  }

  const result = await GenerationJobManager.subscribe(
    conversationId,
    (event) => {
      if (!res.writableEnded) {
        res.write(`event: message\ndata: ${JSON.stringify(event)}\n\n`);
        if (typeof res.flush === 'function') res.flush();
      }
    },
    (event) => {
      if (!res.writableEnded) {
        res.write(`event: message\ndata: ${JSON.stringify(event)}\n\n`);
        if (typeof res.flush === 'function') res.flush();
        res.end();
      }
    },
    (error) => {
      if (!res.writableEnded) {
        res.write(`event: error\ndata: ${JSON.stringify({ error })}\n\n`);
        if (typeof res.flush === 'function') res.flush();
        res.end();
      }
    },
  );

  if (!result) {
    if (!res.writableEnded) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Stream not found' })}\n\n`);
      res.end();
    }
    return;
  }

  logger.debug(`[BridgeStream] Client subscribed to ${conversationId}`);
  req.on('close', () => {
    logger.debug(`[BridgeStream] Client disconnected from ${conversationId}`);
    result.unsubscribe();
  });
});

module.exports = router;
