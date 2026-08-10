const crypto = require('node:crypto');
const config = require('./config');
const { pool } = require('./db');
const { ApiError, asyncHandler } = require('./utils');

const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
const publicUser = row => ({
  _id: String(row.id),
  id: String(row.id),
  account: row.account,
  name: row.name,
  gender: row.gender,
  avatarKey: row.avatar_key || '',
  inviteCode: row.invite_code,
  coupleId: row.couple_id ? String(row.couple_id) : '',
  partnerOpenid: row.partner_id ? String(row.partner_id) : ''
});
const publicPartner = row => row.partner_id ? ({
  _id: String(row.partner_id),
  id: String(row.partner_id),
  name: row.partner_name,
  gender: row.partner_gender,
  avatarKey: row.partner_avatar_key || ''
}) : null;

async function recentSessionIdentity(userId) {
  const [rows] = await pool.query(
    `SELECT wechat_openid,wechat_seen_at FROM sessions
     WHERE user_id=? AND wechat_openid IS NOT NULL
       AND wechat_seen_at>DATE_SUB(NOW(),INTERVAL 2 HOUR)
     ORDER BY wechat_seen_at DESC LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function createSession(userId, identity = null) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 86400000);
  const effectiveIdentity = identity?.openid
    ? { wechat_openid: String(identity.openid), wechat_seen_at: new Date() }
    : await recentSessionIdentity(userId);
  await pool.query(
    `INSERT INTO sessions(user_id,token_hash,wechat_openid,wechat_seen_at,expires_at)
     VALUES(?,?,?,?,?)`,
    [
      userId,
      tokenHash(token),
      effectiveIdentity?.wechat_openid || null,
      effectiveIdentity?.wechat_seen_at || null,
      expires
    ]
  );
  return token;
}

const requireAuth = asyncHandler(async (req, _res, next) => {
  const match = String(req.get('authorization') || '').match(/^Bearer\s+([A-Za-z0-9_-]{40,100})$/);
  if (!match) throw new ApiError(401, '请先登录');
  const [rows] = await pool.query(
    `SELECT u.*,s.id session_id,
      s.wechat_openid session_wechat_openid,s.wechat_seen_at session_wechat_seen_at,
      p.id partner_id,p.name partner_name,p.gender partner_gender,p.avatar_key partner_avatar_key
     FROM sessions s
     JOIN users u ON u.id=s.user_id
     LEFT JOIN users p ON p.couple_id=u.couple_id AND p.id<>u.id
     WHERE s.token_hash=? AND s.expires_at>NOW() LIMIT 1`,
    [tokenHash(match[1])]
  );
  if (!rows[0]) throw new ApiError(401, '登录已过期，请重新登录');
  const row = rows[0];
  row.wechat_openid = row.session_wechat_openid || '';
  row.wechat_seen_at = row.session_wechat_seen_at || null;
  req.userRow = row;
  req.user = publicUser(row);
  req.sessionId = row.session_id;
  next();
});

module.exports = {
  publicUser,
  publicPartner,
  createSession,
  requireAuth
};
