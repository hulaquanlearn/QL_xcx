const crypto = require('crypto');
const config = require('./config');
const { pool } = require('./db');
const { ApiError, asyncHandler } = require('./utils');
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
const publicUser = row => ({ _id: String(row.id), id: String(row.id), account: row.account, name: row.name, gender: row.gender, avatarKey: row.avatar_key || '', inviteCode: row.invite_code, coupleId: row.couple_id ? String(row.couple_id) : '', partnerOpenid: row.partner_id ? String(row.partner_id) : '' });
const publicPartner = row => row.partner_id ? ({ _id: String(row.partner_id), id: String(row.partner_id), name: row.partner_name, gender: row.partner_gender, avatarKey: row.partner_avatar_key || '' }) : null;
async function createSession(userId) { const token = crypto.randomBytes(32).toString('base64url'); const expires = new Date(Date.now() + config.sessionDays * 86400000); await pool.query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES(?,?,?)',[userId,tokenHash(token),expires]); return token; }
const requireAuth = asyncHandler(async (req,_res,next) => {
  const match = String(req.get('authorization') || '').match(/^Bearer\s+([A-Za-z0-9_-]{40,100})$/);
  if (!match) throw new ApiError(401,'请先登录');
  const [rows] = await pool.query(`SELECT u.*, s.id session_id, p.id partner_id, p.name partner_name, p.gender partner_gender, p.avatar_key partner_avatar_key FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN users p ON p.couple_id=u.couple_id AND p.id<>u.id WHERE s.token_hash=? AND s.expires_at>NOW() LIMIT 1`,[tokenHash(match[1])]);
  if (!rows[0]) throw new ApiError(401,'登录已过期，请重新登录'); req.userRow=rows[0]; req.user=publicUser(rows[0]); req.sessionId=rows[0].session_id; next();
});
module.exports={ publicUser, publicPartner, createSession, requireAuth };
