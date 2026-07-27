const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { checkDatabase, pool } = require('./db');
const { requireAuth } = require('./auth');
const { asyncHandler } = require('./utils');
const {
  decodeImage,
  parseMediaKey,
  legacyAvatarFilename,
  mediaPath,
  writeMedia,
  removeMediaIfUnreferenced
} = require('./media');
const { version } = require('../package.json');

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: false }));
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, msg: '图片上传过于频繁，请稍后再试' }
});
const imageJson = express.json({ limit: '6mb' });
const defaultJson = express.json({ limit: '1mb' });
const postOnly = middleware => (req, res, next) => req.method === 'POST' ? middleware(req, res, next) : next();
app.use('/api/couple-space/avatars/file', postOnly(requireAuth), postOnly(uploadLimiter), postOnly(imageJson));
app.use('/api/couple-space/media/file', postOnly(requireAuth), postOnly(uploadLimiter), postOnly(imageJson));
app.use((req, res, next) => {
  const imageUpload = req.method === 'POST' && (
    req.path === '/api/couple-space/avatars/file' ||
    req.path === '/api/couple-space/media/file'
  );
  return imageUpload ? next() : defaultJson(req, res, next);
});

app.get('/api/couple-space/health', async (_req, res) => {
  try {
    await checkDatabase();
    res.json({ success: true, data: { database: 'connected', version } });
  } catch {
    res.status(503).json({ success: false, msg: '数据库不可用' });
  }
});

app.use('/api/couple-space/auth', require('./routes/auth'));
app.use('/api/couple-space/resources', require('./routes/resources'));
app.use('/api/couple-space', require('./routes/profile'));

app.get('/api/couple-space/avatars', requireAuth, asyncHandler(async (req, res) => {
  if (!req.userRow.couple_id) return res.json({ success: true, data: [] });
  const [rows] = await pool.query(
    `SELECT u.id user_id,u.name,u.gender,
      COALESCE(
        NULLIF(u.avatar_key,''),
        CASE
          WHEN u.gender='female' THEN NULLIF(a.female_url,'')
          ELSE NULLIF(a.male_url,'')
        END
      ) avatar_key
     FROM users u
     LEFT JOIN avatars a ON a.couple_id=u.couple_id
     WHERE u.couple_id=?
     ORDER BY u.id`,
    [req.userRow.couple_id]
  );
  return res.json({
    success: true,
    data: rows.map(row => ({
      _id: String(row.user_id),
      userId: String(row.user_id),
      name: row.name,
      gender: row.gender,
      key: row.avatar_key || ''
    }))
  });
}));

app.post('/api/couple-space/avatars/file', asyncHandler(async (req, res) => {
  if (!req.userRow.couple_id) return res.status(409).json({ success: false, msg: '请先绑定情侣' });
  const { buffer, type } = decodeImage(req.body.data);

  await fs.promises.mkdir(config.avatarDir, { recursive: true });
  const filename = `${crypto.randomBytes(16).toString('hex')}.${type.extension}`;
  const filePath = path.join(config.avatarDir, filename);
  const key = `server-avatar:${filename}`;
  const [previousRows] = await pool.query(
    'SELECT avatar_key FROM users WHERE id=? LIMIT 1',
    [req.userRow.id]
  );

  await fs.promises.writeFile(filePath, buffer, { flag: 'wx' });
  try {
    await pool.query('UPDATE users SET avatar_key=? WHERE id=?', [key, req.userRow.id]);
  } catch (error) {
    await fs.promises.unlink(filePath).catch(() => {});
    throw error;
  }

  const previousKey = previousRows[0]?.avatar_key;
  const previousFilename = legacyAvatarFilename(previousKey);
  if (previousFilename) {
    const [references] = await pool.query('SELECT id FROM users WHERE avatar_key=? LIMIT 1', [previousKey]);
    if (!references.length) {
      await fs.promises.unlink(path.join(config.avatarDir, previousFilename)).catch(() => {});
    }
  } else {
    await removeMediaIfUnreferenced(pool, previousKey).catch(() => {});
  }
  return res.status(201).json({ success: true, data: { key } });
}));

app.get('/api/couple-space/avatars/file/:filename', requireAuth, asyncHandler(async (req, res) => {
  if (!req.userRow.couple_id) return res.status(404).json({ success: false, msg: '头像不存在' });
  const filename = String(req.params.filename || '');
  if (!/^[a-f0-9]{32}\.(?:jpg|png|webp)$/.test(filename)) {
    return res.status(404).json({ success: false, msg: '头像不存在' });
  }
  const key = `server-avatar:${filename}`;
  const [rows] = await pool.query(
    'SELECT id FROM users WHERE couple_id=? AND avatar_key=? LIMIT 1',
    [req.userRow.couple_id, key]
  );
  if (!rows[0]) return res.status(404).json({ success: false, msg: '头像不存在' });
  const filePath = path.join(config.avatarDir, filename);
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
  } catch {
    return res.status(404).json({ success: false, msg: '头像文件不存在' });
  }
  res.set('Cache-Control', 'private, max-age=3600');
  return res.sendFile(filePath);
}));

app.post('/api/couple-space/media/file', asyncHandler(async (req, res) => {
  if (!req.userRow.couple_id) return res.status(409).json({ success: false, msg: '请先绑定情侣' });
  const purpose = String(req.body.purpose || '');
  if (!['album', 'dish'].includes(purpose)) {
    return res.status(400).json({ success: false, msg: '图片用途无效' });
  }
  const created = await writeMedia(req.userRow.couple_id, req.body.data);
  return res.status(201).json({ success: true, data: { key: created.key } });
}));

app.get('/api/couple-space/media/file/:coupleId/:filename', requireAuth, asyncHandler(async (req, res) => {
  const coupleId = String(req.params.coupleId || '');
  const filename = String(req.params.filename || '');
  const key = `server-media:${coupleId}:${filename}`;
  const parsed = parseMediaKey(key);
  if (!parsed || String(req.userRow.couple_id || '') !== coupleId) {
    return res.status(404).json({ success: false, msg: '图片不存在' });
  }
  const filePath = mediaPath(coupleId, filename);
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
  } catch {
    return res.status(404).json({ success: false, msg: '图片不存在' });
  }
  res.set('Cache-Control', 'private, max-age=3600');
  return res.sendFile(filePath);
}));

app.delete('/api/couple-space/media/file/:coupleId/:filename', requireAuth, asyncHandler(async (req, res) => {
  const key = `server-media:${req.params.coupleId}:${req.params.filename}`;
  const parsed = parseMediaKey(key);
  if (!parsed || String(req.userRow.couple_id || '') !== parsed.coupleId) {
    return res.status(404).json({ success: false, msg: '图片不存在' });
  }
  const removed = await removeMediaIfUnreferenced(pool, key);
  if (!removed) return res.status(409).json({ success: false, msg: '图片仍在使用中' });
  return res.json({ success: true, data: null });
}));

app.get('/api/couple-space/dashboard', requireAuth, async (req, res) => {
  const coupleId = req.userRow.couple_id;
  if (!coupleId) return res.json({ success: true, data: { counts: { album: 0, countdown: 0, orders: 0 } } });
  const [[albums], [countdowns], [orders]] = await Promise.all([
    pool.query('SELECT COUNT(*) count FROM albums WHERE couple_id=?', [coupleId]),
    pool.query('SELECT COUNT(*) count FROM countdowns WHERE couple_id=?', [coupleId]),
    pool.query('SELECT COUNT(*) count FROM orders WHERE couple_id=? AND status="pending"', [coupleId])
  ]);
  return res.json({
    success: true,
    data: { counts: { album: albums[0].count, countdown: countdowns[0].count, orders: orders[0].count } }
  });
});

app.use((_req, res) => res.status(404).json({ success: false, msg: '接口不存在' }));
app.use((err, _req, res, _next) => {
  if (!err.status || err.status >= 500) console.error(err);
  res.status(err.status || 500).json({ success: false, msg: err.status ? err.message : '服务器内部错误' });
});

if (require.main === module) {
  checkDatabase()
    .then(() => app.listen(config.port, config.host, () => console.log(`Couple Space API listening on ${config.host}:${config.port}`)))
    .catch(err => {
      console.error('MySQL connection failed:', err.message);
      process.exit(1);
    });
}

module.exports = app;
