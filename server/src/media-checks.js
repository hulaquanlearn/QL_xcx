const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { pool } = require('./db');
const { ApiError } = require('./utils');
const contentSafety = require('./content-safety');
const {
  legacyAvatarFilename,
  mediaPath,
  removeMediaIfUnreferenced
} = require('./media');

const filenamePattern = /^[a-f0-9]{32}\.(?:jpg|png|webp)$/;
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
let cleanupTimer = null;

function pendingPath(filename) {
  if (!filenamePattern.test(String(filename || ''))) throw new ApiError(500, '待审核图片路径无效');
  return path.join(config.pendingMediaDir, filename);
}

async function beginCheck(userRow, purpose, decoded) {
  if (!['avatar', 'album', 'dish', 'recipe'].includes(purpose)) throw new ApiError(400, '图片用途无效');
  if (!userRow?.couple_id) throw new ApiError(409, '请先绑定情侣');
  if (!userRow.wechat_openid) throw new ApiError(409, '请重新打开小程序后再试');
  if (decoded.buffer.length > contentSafety.MAX_MEDIA_CHECK_BYTES) {
    throw new ApiError(413, '图片不能超过4MB');
  }

  await cleanupExpiredChecks();
  await cleanupFinishedChecks();
  await fs.promises.mkdir(config.pendingMediaDir, { recursive: true });
  const filename = `${crypto.randomBytes(16).toString('hex')}.${decoded.type.extension}`;
  const accessToken = crypto.randomBytes(32).toString('base64url');
  const filePath = pendingPath(filename);
  await fs.promises.writeFile(filePath, decoded.buffer, { flag: 'wx' });

  let checkId;
  try {
    const [created] = await pool.query(
      `INSERT INTO media_checks(
        user_id,couple_id,purpose,status,access_token_hash,pending_filename,expires_at
       ) VALUES(?,?,?,'pending',?,?,DATE_ADD(NOW(),INTERVAL 35 MINUTE))`,
      [userRow.id, userRow.couple_id, purpose, tokenHash(accessToken), filename]
    );
    checkId = created.insertId;
    const mediaUrl = `${config.wechat.publicBaseUrl}/api/couple-space/content-safety/media/${checkId}/${accessToken}`;
    const traceId = await contentSafety.submitMediaCheck(mediaUrl, userRow.wechat_openid, purpose === 'avatar' ? 1 : 4);
    await pool.query(
      "UPDATE media_checks SET trace_id=? WHERE id=? AND status='pending'",
      [traceId, checkId]
    );
    return { checkId: String(checkId), status: 'pending' };
  } catch (error) {
    await fs.promises.unlink(filePath).catch(() => {});
    if (checkId) await pool.query('DELETE FROM media_checks WHERE id=?', [checkId]).catch(() => {});
    throw error;
  }
}

async function findPublicFile(id, token) {
  const [rows] = await pool.query(
    `SELECT pending_filename FROM media_checks
     WHERE id=? AND access_token_hash=? AND status='pending' AND expires_at>NOW()
     LIMIT 1`,
    [id, tokenHash(String(token || ''))]
  );
  if (!rows[0]) throw new ApiError(404, '待审核图片不存在');
  const filePath = pendingPath(rows[0].pending_filename);
  await fs.promises.access(filePath, fs.constants.R_OK).catch(() => {
    throw new ApiError(404, '待审核图片不存在');
  });
  return filePath;
}

async function getCheck(userId, id) {
  const [rows] = await pool.query(
    `SELECT id,status,final_key,expires_at FROM media_checks
     WHERE id=? AND user_id=? LIMIT 1`,
    [id, userId]
  );
  const row = rows[0];
  if (!row) throw new ApiError(404, '图片审核任务不存在');
  if (row.status === 'pending' && new Date(row.expires_at).getTime() <= Date.now()) {
    await expireCheck(id);
    return { checkId: String(id), status: 'expired', message: '图片审核超时，请重新上传' };
  }
  const result = { checkId: String(row.id), status: row.status };
  if (row.status === 'approved') result.key = row.final_key;
  if (row.status === 'rejected') result.message = '内容包含违规信息，请修改后重试';
  if (row.status === 'failed') result.message = '内容安全检测暂不可用，请稍后重试';
  if (row.status === 'expired') result.message = '图片审核超时，请重新上传';
  return result;
}

async function handleWechatResult(payload) {
  if (String(payload?.Event || payload?.event || '') !== 'wxa_media_check') return;
  const appid = String(payload.appid || payload.AppId || '');
  if (appid !== config.wechat.appId) throw new ApiError(403, '回调应用无效');
  const traceId = String(payload.trace_id || '');
  if (!traceId) throw new ApiError(400, '回调任务无效');
  const [rows] = await pool.query(
    'SELECT * FROM media_checks WHERE trace_id=? LIMIT 1',
    [traceId]
  );
  const row = rows[0];
  if (!row) throw new ApiError(503, '审核任务尚未就绪');
  if (row.status !== 'pending') return;

  const errorCode = Number(payload.errcode || 0);
  const suggestion = String(payload.result?.suggest || '').toLowerCase();
  if (errorCode === 0 && suggestion === 'pass') {
    await approveCheck(row);
    return;
  }
  await closeCheck(row, suggestion === 'risky' || suggestion === 'review' ? 'rejected' : 'failed', errorCode);
}

async function approveCheck(row) {
  if (row.purpose === 'avatar') {
    const [latest] = await pool.query(
      "SELECT id FROM media_checks WHERE user_id=? AND purpose='avatar' ORDER BY id DESC LIMIT 1",
      [row.user_id]
    );
    if (latest[0] && String(latest[0].id) !== String(row.id)) {
      await closeCheck(row, 'expired');
      return;
    }
  }
  const source = pendingPath(row.pending_filename);
  const extension = path.extname(row.pending_filename).slice(1);
  const finalFilename = `${crypto.randomBytes(16).toString('hex')}.${extension}`;
  const avatar = row.purpose === 'avatar';
  const destination = avatar
    ? path.join(config.avatarDir, finalFilename)
    : mediaPath(row.couple_id, finalFilename);
  const finalKey = avatar
    ? `server-avatar:${finalFilename}`
    : `server-media:${row.couple_id}:${finalFilename}`;

  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.copyFile(source, destination, fs.constants.COPYFILE_EXCL);

  const connection = await pool.getConnection();
  let previousAvatarKey = '';
  try {
    await connection.beginTransaction();
    if (avatar) {
      const [users] = await connection.query(
        'SELECT avatar_key FROM users WHERE id=? AND couple_id=? FOR UPDATE',
        [row.user_id, row.couple_id]
      );
      if (!users[0]) throw new ApiError(404, '用户不存在');
      previousAvatarKey = users[0].avatar_key || '';
      await connection.query('UPDATE users SET avatar_key=? WHERE id=?', [finalKey, row.user_id]);
    }
    const [updated] = await connection.query(
      `UPDATE media_checks
       SET status='approved',final_key=?,checked_at=NOW()
       WHERE id=? AND status='pending'`,
      [finalKey, row.id]
    );
    if (!updated.affectedRows) throw new ApiError(409, '图片审核状态已变化');
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    await fs.promises.unlink(destination).catch(() => {});
    throw error;
  } finally {
    connection.release();
  }

  await fs.promises.unlink(source).catch(() => {});
  if (previousAvatarKey) await cleanupPreviousAvatar(previousAvatarKey);
}

async function cleanupPreviousAvatar(key) {
  const filename = legacyAvatarFilename(key);
  if (filename) {
    const [references] = await pool.query('SELECT id FROM users WHERE avatar_key=? LIMIT 1', [key]);
    if (!references.length) {
      await fs.promises.unlink(path.join(config.avatarDir, filename)).catch(() => {});
    }
    return;
  }
  await removeMediaIfUnreferenced(pool, key).catch(() => {});
}

async function closeCheck(row, status, errorCode = 0) {
  await pool.query(
    `UPDATE media_checks SET status=?,error_code=?,checked_at=NOW()
     WHERE id=? AND status='pending'`,
    [status, errorCode || null, row.id]
  );
  await fs.promises.unlink(pendingPath(row.pending_filename)).catch(() => {});
}

async function expireCheck(id) {
  const [rows] = await pool.query(
    "SELECT * FROM media_checks WHERE id=? AND status='pending' LIMIT 1",
    [id]
  );
  if (rows[0]) await closeCheck(rows[0], 'expired');
}

async function cleanupExpiredChecks() {
  const [rows] = await pool.query(
    "SELECT * FROM media_checks WHERE status='pending' AND expires_at<=NOW() LIMIT 100"
  );
  for (const row of rows) await closeCheck(row, 'expired');
}

async function cleanupFinishedChecks() {
  const [rows] = await pool.query(
    `SELECT id,final_key FROM media_checks
     WHERE status='approved' AND checked_at<=DATE_SUB(NOW(),INTERVAL 24 HOUR)
     LIMIT 100`
  );
  for (const row of rows) {
    if (row.final_key) await removeMediaIfUnreferenced(pool, row.final_key).catch(() => {});
    await pool.query("DELETE FROM media_checks WHERE id=? AND status='approved'", [row.id]);
  }
  await pool.query(
    `DELETE FROM media_checks
     WHERE status IN ('rejected','failed','expired')
       AND checked_at<=DATE_SUB(NOW(),INTERVAL 7 DAY)
     LIMIT 500`
  );
}

async function runCleanup() {
  await cleanupExpiredChecks();
  await cleanupFinishedChecks();
}

function startCleanupScheduler(intervalMs = CLEANUP_INTERVAL_MS) {
  if (cleanupTimer) return cleanupTimer;
  const execute = () => runCleanup().catch(error => {
    console.error('Media cleanup failed:', error.message);
  });
  execute();
  cleanupTimer = setInterval(execute, intervalMs);
  if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
  return cleanupTimer;
}

function stopCleanupScheduler() {
  if (!cleanupTimer) return;
  clearInterval(cleanupTimer);
  cleanupTimer = null;
}

module.exports = {
  beginCheck,
  findPublicFile,
  getCheck,
  handleWechatResult,
  cleanupExpiredChecks,
  cleanupFinishedChecks,
  runCleanup,
  startCleanupScheduler,
  stopCleanupScheduler,
  CLEANUP_INTERVAL_MS
};
