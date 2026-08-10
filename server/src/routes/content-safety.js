const express = require('express');
const { requireAuth } = require('../auth');
const { asyncHandler, ApiError } = require('../utils');
const config = require('../config');
const contentSafety = require('../content-safety');
const mediaChecks = require('../media-checks');

const router = express.Router();

function assertCallbackSignature(req) {
  const valid = contentSafety.verifyMessageSignature(
    req.query.signature,
    req.query.timestamp,
    req.query.nonce
  );
  if (!valid) throw new ApiError(403, '回调签名无效');
}

router.get('/callback', (req, res) => {
  try {
    assertCallbackSignature(req);
    return res.type('text/plain').send(String(req.query.echostr || ''));
  } catch {
    return res.status(403).send('forbidden');
  }
});

router.post('/callback', asyncHandler(async (req, res) => {
  assertCallbackSignature(req);
  if (req.query.encrypt_type) throw new ApiError(400, '仅支持明文回调模式');
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw new ApiError(415, '回调数据格式必须为JSON');
  }
  await mediaChecks.handleWechatResult(req.body || {});
  return res.type('text/plain').send('success');
}));

router.get('/media/:id/:token', asyncHandler(async (req, res) => {
  const filePath = await mediaChecks.findPublicFile(req.params.id, req.params.token);
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  return res.sendFile(filePath);
}));

router.get('/check/:id', requireAuth, asyncHandler(async (req, res) => {
  const result = await mediaChecks.getCheck(req.userRow.id, req.params.id);
  return res.json({ success: true, data: result });
}));

router.get('/status/configured', (_req, res) => res.json({
  success: true,
  data: {
    appId: Boolean(config.wechat.appId),
    mediaCallback: contentSafety.isMediaConfigured()
  }
}));

module.exports = router;
