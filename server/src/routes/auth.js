const express = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { ApiError, asyncHandler } = require('../utils');
const { verifyPassword } = require('../password');
const {
  publicUser,
  publicPartner,
  createSession,
  requireAuth
} = require('../auth');
const { exchangeLoginCode } = require('../content-safety');

const router = express.Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: { success: false, msg: '尝试次数过多，请稍后再试' }
});
const identityLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  message: { success: false, msg: '微信身份刷新过于频繁，请稍后再试' }
});

async function findLoginUser(account) {
  const [rows] = await pool.query(
    `SELECT u.*,p.id partner_id,p.name partner_name,p.gender partner_gender,
      p.avatar_key partner_avatar_key
     FROM users u
     LEFT JOIN users p ON p.couple_id=u.couple_id AND p.id<>u.id
     WHERE u.account=? LIMIT 1`,
    [account]
  );
  return rows[0] || null;
}

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const account = String(req.body.account || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = await findLoginUser(account);
  if (password.length > 128 || !user || !await verifyPassword(password, user.password_hash)) {
    throw new ApiError(401, '账号或密码错误');
  }
  const wechatCode = String(req.body.wechatCode || '').trim();
  const identity = wechatCode ? await exchangeLoginCode(wechatCode) : null;
  const token = await createSession(user.id, identity);
  res.json({
    success: true,
    data: { token, user: publicUser(user), partner: publicPartner(user) }
  });
}));

router.post('/wechat/refresh', requireAuth, identityLimiter, asyncHandler(async (req, res) => {
  const identity = await exchangeLoginCode(req.body.code);
  await pool.query(
    'UPDATE sessions SET wechat_openid=?,wechat_seen_at=NOW() WHERE id=?',
    [identity.openid, req.sessionId]
  );
  res.json({ success: true, data: { refreshed: true } });
}));

router.get('/me', requireAuth, (req, res) => res.json({
  success: true,
  data: { user: req.user, partner: publicPartner(req.userRow) }
}));

router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM sessions WHERE id=?', [req.sessionId]);
  res.json({ success: true, data: null });
}));

module.exports = router;
