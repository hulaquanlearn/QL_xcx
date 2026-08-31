const express = require('express');
const { pool } = require('../db');
const { checkText } = require('../content-safety');
const { assertMediaKeyForCouple, collectMediaKeys, removeMediaKeysIfUnreferenced } = require('../media');
const { ApiError, asyncHandler } = require('../utils');
const { requireCoupleId, requireCoupleTask } = require('./couple-access');

const router = express.Router();

function validDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3]);
}

function imageKeys(images, coupleId, maximum, message) {
  if (!Array.isArray(images) || !images.length || images.length > maximum) throw new ApiError(400, message);
  return images.map(value => {
    const key = String(value || '');
    assertMediaKeyForCouple(key, coupleId, { allowEmpty: false });
    return key;
  });
}

async function insertPhotos(req, res, task = null) {
  const coupleId = requireCoupleId(req);
  const keys = imageKeys(req.body?.images, coupleId, 9, task ? '每次可以关联1至9张照片' : '每次可以保存1至9张照片');
  const description = String(req.body?.description || task?.title || '').trim().slice(0, 300);
  const photoDate = task ? '' : String(req.body?.photoDate || '').trim();
  if (photoDate && !validDate(photoDate)) throw new ApiError(400, '照片日期无效');
  await checkText(description, { openid: req.userRow.wechat_openid, scene: 4 });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const ids = [];
    for (const key of keys) {
      const [created] = await connection.query(
        `INSERT INTO albums(couple_id,author_id,task_id,image_url,storage_key,description,photo_date)
         VALUES(?,?,?,?,?,?,?)`,
        [coupleId, req.userRow.id, task?.id || null, key, key, description, photoDate || null]
      );
      ids.push(String(created.insertId));
    }
    await connection.commit();
    return res.status(201).json({ success: true, data: { ids, count: ids.length } });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

router.post('/albums/batch', asyncHandler((req, res) => insertPhotos(req, res)));
router.post('/albums/task-photos', asyncHandler(async (req, res) => {
  const coupleId = requireCoupleId(req);
  const task = await requireCoupleTask(pool, coupleId, req.body?.taskId);
  return insertPhotos(req, res, task);
}));

router.delete('/albums/batch', asyncHandler(async (req, res) => {
  const coupleId = requireCoupleId(req);
  const sourceIds = req.body?.ids;
  if (!Array.isArray(sourceIds)) throw new ApiError(400, '照片列表无效');
  const ids = Array.from(new Set(sourceIds.map(value => String(value || '').trim())));
  if (!ids.length || ids.length > 50 || ids.some(id => !/^\d+$/.test(id))) {
    throw new ApiError(400, '每次可以删除1至50张照片');
  }
  const connection = await pool.getConnection();
  let oldMediaKeys = [];
  try {
    await connection.beginTransaction();
    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await connection.query(
      `SELECT image_url,storage_key FROM albums WHERE couple_id=? AND id IN (${placeholders}) FOR UPDATE`,
      [coupleId, ...ids]
    );
    if (rows.length !== ids.length) throw new ApiError(404, '部分照片不存在，请刷新后重试');
    oldMediaKeys = rows.flatMap(row => [...collectMediaKeys([row.image_url, row.storage_key])]);
    await connection.query(`DELETE FROM albums WHERE couple_id=? AND id IN (${placeholders})`, [coupleId, ...ids]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  await removeMediaKeysIfUnreferenced(pool, oldMediaKeys);
  res.json({ success: true, data: { count: ids.length } });
}));

module.exports = router;
