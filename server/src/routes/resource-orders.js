const express = require('express');
const { pool } = require('../db');
const { ApiError, asyncHandler } = require('../utils');
const { requireCoupleId } = require('./couple-access');

const router = express.Router();

router.post('/orders/:id/accept', asyncHandler(async (req, res) => {
  const coupleId = requireCoupleId(req);
  const [result] = await pool.query(
    `UPDATE orders SET status='accepted',accepted_by=?,accepted_by_user_id=?,accepted_at=NOW()
     WHERE id=? AND couple_id=? AND author_id<>? AND status='pending'`,
    [req.userRow.name, req.userRow.id, req.params.id, coupleId, req.userRow.id]
  );
  if (result.affectedRows) return res.json({ success: true, data: null });
  const [rows] = await pool.query(
    'SELECT author_id,status FROM orders WHERE id=? AND couple_id=? LIMIT 1',
    [req.params.id, coupleId]
  );
  if (!rows[0]) throw new ApiError(404, '点单不存在');
  if (String(rows[0].author_id) === String(req.userRow.id)) throw new ApiError(403, '不能接自己的点单');
  throw new ApiError(409, rows[0].status === 'accepted' ? '这份点单已经有人接了' : '点单状态已变化');
}));

async function markReady(req, res) {
  const coupleId = requireCoupleId(req);
  const [result] = await pool.query(
    `UPDATE orders SET status='ready',ready_at=COALESCE(ready_at,NOW())
     WHERE id=? AND couple_id=? AND accepted_by_user_id=? AND status='accepted'`,
    [req.params.id, coupleId, req.userRow.id]
  );
  if (result.affectedRows) return res.json({ success: true, data: { status: 'ready' } });
  const [rows] = await pool.query(
    'SELECT status,accepted_by_user_id FROM orders WHERE id=? AND couple_id=? LIMIT 1',
    [req.params.id, coupleId]
  );
  if (!rows[0]) throw new ApiError(404, '点单不存在');
  if (rows[0].status === 'ready') throw new ApiError(409, '这份点单已经做好了');
  if (rows[0].status === 'completed') throw new ApiError(409, '这份点单已经完成');
  if (String(rows[0].accepted_by_user_id || '') !== String(req.userRow.id)) {
    throw new ApiError(403, '只有接单人可以标记已做好');
  }
  throw new ApiError(409, '请先接单');
}

router.post('/orders/:id/complete', asyncHandler(markReady));
router.post('/orders/:id/ready', asyncHandler(markReady));

router.post('/orders/:id/confirm', asyncHandler(async (req, res) => {
  const coupleId = requireCoupleId(req);
  const [result] = await pool.query(
    `UPDATE orders SET status='completed',completed_at=NOW()
     WHERE id=? AND couple_id=? AND author_id=? AND status='ready'`,
    [req.params.id, coupleId, req.userRow.id]
  );
  if (result.affectedRows) return res.json({ success: true, data: { status: 'completed' } });
  const [rows] = await pool.query(
    'SELECT author_id,status FROM orders WHERE id=? AND couple_id=? LIMIT 1',
    [req.params.id, coupleId]
  );
  if (!rows[0]) throw new ApiError(404, '点单不存在');
  if (rows[0].status === 'completed') throw new ApiError(409, '这份点单已经确认完成');
  if (String(rows[0].author_id) !== String(req.userRow.id)) throw new ApiError(403, '只有下单人可以确认收到');
  throw new ApiError(409, rows[0].status === 'accepted' ? '请等待对方做好' : '请先等待对方接单');
}));

module.exports = router;
