const express = require('express');
const { pool } = require('../db');
const { requireAuth, publicUser } = require('../auth');
const { ApiError, asyncHandler } = require('../utils');
const { removeCoupleMedia } = require('../media');

const router = express.Router();

const updateProfile = asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const gender = String(req.body.gender || '');

  if (!name) throw new ApiError(400, '昵称不能为空');
  if (!['male', 'female', 'other'].includes(gender)) throw new ApiError(400, '性别无效');

  await pool.query(
    'UPDATE users SET name=?,gender=? WHERE id=?',
    [name.slice(0, 40), gender, req.userRow.id]
  );
  const [rows] = await pool.query(
    'SELECT u.*,p.id partner_id,p.avatar_key partner_avatar_key FROM users u LEFT JOIN users p ON p.couple_id=u.couple_id AND p.id<>u.id WHERE u.id=? LIMIT 1',
    [req.userRow.id]
  );
  res.json({ success: true, data: { user: publicUser(rows[0]) } });
});

// app.js 将本路由挂载在 /api/couple-space，因此这里必须包含 /profile。
router.patch('/profile', requireAuth, updateProfile);
router.put('/profile', requireAuth, updateProfile);

router.post('/partner/bind', requireAuth, asyncHandler(async (req, res) => {
  const code = String(req.body.inviteCode || '').trim().toUpperCase();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [mine] = await connection.query('SELECT * FROM users WHERE id=? FOR UPDATE', [req.userRow.id]);
    const [theirs] = await connection.query(
      'SELECT * FROM users WHERE invite_code=? AND id<>? FOR UPDATE',
      [code, req.userRow.id]
    );
    if (!theirs[0]) throw new ApiError(404, '邀请码不存在');
    if (mine[0].couple_id || theirs[0].couple_id) throw new ApiError(409, '其中一方已绑定情侣');

    const [created] = await connection.query('INSERT INTO couples() VALUES()');
    await connection.query(
      'UPDATE users SET couple_id=? WHERE id IN (?,?)',
      [created.insertId, mine[0].id, theirs[0].id]
    );
    await connection.commit();
    res.json({
      success: true,
      data: {
        coupleId: String(created.insertId),
        partner: {
          _id: String(theirs[0].id),
          id: String(theirs[0].id),
          name: theirs[0].name,
          gender: theirs[0].gender,
          avatarKey: theirs[0].avatar_key || ''
        }
      }
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.post('/partner/unbind', requireAuth, asyncHandler(async (req, res) => {
  if (!req.userRow.couple_id) throw new ApiError(409, '当前未绑定情侣');
  const coupleId = req.userRow.couple_id;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [locked] = await connection.query('SELECT id FROM couples WHERE id=? FOR UPDATE', [coupleId]);
    if (!locked[0]) throw new ApiError(404, '情侣空间不存在');
    await connection.query('UPDATE users SET couple_id=NULL WHERE couple_id=?', [coupleId]);
    await connection.query('DELETE FROM couples WHERE id=?', [coupleId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  await removeCoupleMedia(coupleId).catch(() => {});
  res.json({ success: true, data: null });
}));

module.exports = router;
