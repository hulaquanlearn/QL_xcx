const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');
const { ApiError, asyncHandler } = require('../utils');
const { normalizeRecord, publicRecord, summarize, todayDate } = require('../services/periods');
const router = express.Router();

router.use(requireAuth);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/', asyncHandler(async (req, res) => {
  const own = req.query.view !== 'partner';
  let ownerId = req.userRow.id;
  let sharing = false;
  let rows;
  if (!own) {
    if (!req.userRow.couple_id) return res.json({ success: true, data: { available: false } });
    const [shared] = await pool.query(
      `SELECT u.id owner_id,r.id,r.start_date,r.end_date
       FROM users u JOIN period_settings s ON s.user_id=u.id
       LEFT JOIN period_records r ON r.user_id=u.id
       WHERE u.couple_id=? AND u.id<>? AND s.share_with_partner=1 AND s.shared_couple_id=u.couple_id
       ORDER BY r.start_date DESC LIMIT 240`,
      [req.userRow.couple_id, req.userRow.id]
    );
    if (!shared[0]) return res.json({ success: true, data: { available: false } });
    rows = shared.filter(row => row.id != null);
  } else {
    const [settings] = await pool.query('SELECT share_with_partner,shared_couple_id FROM period_settings WHERE user_id=?', [ownerId]);
    sharing = Boolean(settings[0]?.share_with_partner && req.userRow.couple_id
      && String(settings[0].shared_couple_id) === String(req.userRow.couple_id));
    [rows] = await pool.query(
      'SELECT id,start_date,end_date,flow,pain,symptoms FROM period_records WHERE user_id=? ORDER BY start_date DESC LIMIT 240', [ownerId]
    );
  }
  const records = rows.map(row => publicRecord(row, own));
  const today = todayDate();
  res.json({ success: true, data: { available: true, own, sharing, today, records, summary: summarize(records, today) } });
}));

router.patch('/settings', asyncHandler(async (req, res) => {
  const enabled = req.body?.shareWithPartner;
  if (typeof enabled !== 'boolean') throw new ApiError(400, '共享设置无效');
  if (enabled && !req.userRow.couple_id) throw new ApiError(409, '请先绑定伴侣');
  await pool.query(
    `INSERT INTO period_settings(user_id,share_with_partner,shared_couple_id) VALUES(?,?,?)
     ON DUPLICATE KEY UPDATE share_with_partner=VALUES(share_with_partner),shared_couple_id=VALUES(shared_couple_id)`,
    [req.userRow.id, enabled ? 1 : 0, enabled ? req.userRow.couple_id : null]
  );
  res.json({ success: true, data: null });
}));

async function saveRecord(req, res) {
  const body = normalizeRecord(req.body);
  const id = req.params.id;
  if (id && !/^\d+$/.test(id)) throw new ApiError(404, '记录不存在');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Serializes concurrent inserts/edits for this owner, including first insert.
    await connection.query('SELECT id FROM users WHERE id=? FOR UPDATE', [req.userRow.id]);
    if (id) {
      const [owned] = await connection.query('SELECT id FROM period_records WHERE id=? AND user_id=? FOR UPDATE', [id, req.userRow.id]);
      if (!owned[0]) throw new ApiError(404, '记录不存在');
    }
    const [overlaps] = await connection.query(
      `SELECT id FROM period_records WHERE user_id=? AND id<>?
       AND start_date<=? AND COALESCE(end_date,'9999-12-31')>=? LIMIT 1`,
      [req.userRow.id, id || 0, body.endDate || '9999-12-31', body.startDate]
    );
    if (overlaps[0]) throw new ApiError(409, '日期与已有记录重叠，请先结束或修改上一条记录');
    const values = [body.startDate, body.endDate, body.flow, body.pain, JSON.stringify(body.symptoms)];
    let savedId = id;
    if (id) {
      await connection.query(
        'UPDATE period_records SET start_date=?,end_date=?,flow=?,pain=?,symptoms=? WHERE id=? AND user_id=?',
        [...values, id, req.userRow.id]
      );
    } else {
      const [created] = await connection.query(
        'INSERT INTO period_records(start_date,end_date,flow,pain,symptoms,user_id) VALUES(?,?,?,?,?,?)',
        [...values, req.userRow.id]
      );
      savedId = String(created.insertId);
    }
    await connection.commit();
    res.status(id ? 200 : 201).json({ success: true, data: { id: String(savedId) } });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') throw new ApiError(409, '该开始日期已记录');
    throw error;
  } finally { connection.release(); }
}

router.post('/', asyncHandler(saveRecord));
router.put('/:id', asyncHandler(saveRecord));
router.delete('/:id', asyncHandler(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) throw new ApiError(404, '记录不存在');
  const [result] = await pool.query('DELETE FROM period_records WHERE id=? AND user_id=?', [req.params.id, req.userRow.id]);
  if (!result.affectedRows) throw new ApiError(404, '记录不存在');
  res.json({ success: true, data: null });
}));

// Never log SQL errors with sensitive date/symptom parameters.
router.use((error, _req, res, next) => {
  if (error.status) return next(error);
  console.error('Period storage request failed');
  return res.status(500).json({ success: false, msg: '经期记录暂时无法保存或读取，请稍后重试' });
});
module.exports = router;
