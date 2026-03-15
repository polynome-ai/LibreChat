const express = require('express');
const { requireJwtAuth } = require('~/server/middleware');
const voice = require('./voice');
const stream = require('./stream');
const message = require('./message');
const webhook = require('./webhook');
const internal = require('./internal');

const router = express.Router();

/** Webhook — HMAC auth only, no JWT */
router.use('/webhook', webhook);

/** Internal server-to-server API — X-Bridge-Secret auth, no JWT */
router.use('/', internal);

/** Promote ?token=<jwt> → Authorization: Bearer for SSE (EventSource can't set headers) */
router.use((req, _res, next) => {
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
});

router.use(requireJwtAuth);
router.use('/', voice);
router.use('/', stream);
router.use('/', message);

module.exports = router;
