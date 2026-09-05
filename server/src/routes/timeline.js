const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');
const { ApiError, asyncHandler } = require('../utils');
const { requireCoupleId } = require('./couple-access');

const router = express.Router();
router.use(requireAuth);

function decodeCursor(value) {
  if (!value) return null;
  try {
    if (String(value).length > 256) throw new Error();
    const cursor = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(cursor.at)
      || !['task', 'album', 'order'].includes(cursor.type) || !/^\d+$/.test(cursor.id)) throw new Error();
    return cursor;
  } catch {
    throw new ApiError(400, '时间线游标无效');
  }
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify({ at: row.event_at, type: row.event_type, id: String(row.event_id) })).toString('base64url');
}

function arrayJson(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item === 'object') : [];
  } catch { return []; }
}

async function rowsByIds(table, alias, ids, coupleId, columns, joins = '') {
  if (!ids.length) return [];
  const [rows] = await pool.query(
    `SELECT ${columns} FROM ${table} ${alias}
     JOIN users u ON u.id=${alias}.author_id ${joins}
     WHERE ${alias}.couple_id=? AND ${alias}.id IN (${ids.map(() => '?').join(',')})`,
    [coupleId, ...ids]
  );
  return rows;
}

router.get('/', asyncHandler(async (req, res) => {
  const coupleId = requireCoupleId(req);
  const paged = String(req.query.paged || '') === '1';
  const limit = Math.min(Math.max(Math.floor(Number(req.query.limit)) || 30, 1), 100);
  const cursor = paged ? decodeCursor(req.query.cursor) : null;
  const after = cursor
    ? 'WHERE event_at<? OR (event_at=? AND event_type<?) OR (event_at=? AND event_type=? AND event_id<?)'
    : '';
  // This composite cursor retains events sharing a second-resolution timestamp.
  // Legacy missing completion dates use creation dates and are labelled below;
  // do not rewrite historical data with fabricated completion timestamps.
  const [candidates] = await pool.query(
    `SELECT event_type,event_id,event_at FROM (
       SELECT 'task' event_type,id event_id,DATE_FORMAT(COALESCE(completed_at,created_at),'%Y-%m-%d %H:%i:%s') event_at
       FROM tasks WHERE couple_id=? AND status='completed'
       UNION ALL
       SELECT 'album',id,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s')
       FROM albums WHERE couple_id=? AND task_id IS NULL
       UNION ALL
       SELECT 'order',id,DATE_FORMAT(COALESCE(completed_at,created_at),'%Y-%m-%d %H:%i:%s')
       FROM orders WHERE couple_id=? AND status='completed'
     ) events ${after} ORDER BY event_at DESC,event_type DESC,event_id DESC LIMIT ?`,
    [coupleId, coupleId, coupleId,
      ...(cursor ? [cursor.at, cursor.at, cursor.type, cursor.at, cursor.type, cursor.id] : []),
      paged ? limit + 1 : limit]
  );
  const hasMore = paged && candidates.length > limit;
  const selected = candidates.slice(0, limit);
  const ids = type => selected.filter(row => row.event_type === type).map(row => String(row.event_id));
  const taskIds = ids('task');
  const [tasks, photos, orders] = await Promise.all([
    rowsByIds('tasks', 't', taskIds, coupleId, 't.id,t.title,t.description,t.completed_at,u.name author_name'),
    rowsByIds('albums', 'a', ids('album'), coupleId, 'a.id,a.image_url,a.description,a.photo_date,u.name author_name'),
    rowsByIds('orders', 'o', ids('order'), coupleId,
      "o.id,o.menu_names,o.dishes,o.completed_at,u.name author_name,COALESCE(accepted.name,o.accepted_by,'') accepted_name",
      'LEFT JOIN users accepted ON accepted.id=o.accepted_by_user_id AND accepted.couple_id=o.couple_id')
  ]);
  const linked = new Map();
  if (taskIds.length) {
    const [linkedPhotos] = await pool.query(
      `SELECT task_id,image_url FROM albums WHERE couple_id=? AND task_id IN (${taskIds.map(() => '?').join(',')}) ORDER BY id DESC`,
      [coupleId, ...taskIds]
    );
    for (const photo of linkedPhotos) {
      const key = String(photo.task_id);
      if (!linked.has(key)) linked.set(key, []);
      if (linked.get(key).length < 4) linked.get(key).push(photo.image_url);
    }
  }
  const events = new Map();
  for (const task of tasks) events.set(`task:${task.id}`, {
    id: `task:${task.id}`, type: 'task', title: task.title,
    description: task.description || '一起完成了一件计划', author: task.author_name,
    timeEstimated: !task.completed_at, images: linked.get(String(task.id)) || []
  });
  for (const photo of photos) events.set(`album:${photo.id}`, {
    id: `album:${photo.id}`, type: 'album', title: photo.description || '收藏了一张照片',
    description: photo.photo_date ? `拍摄于 ${String(photo.photo_date).slice(0, 10)}` : '',
    author: photo.author_name, images: [photo.image_url]
  });
  for (const order of orders) {
    let menuNames = [];
    try {
      const names = typeof order.menu_names === 'string' ? JSON.parse(order.menu_names) : order.menu_names;
      if (Array.isArray(names)) menuNames = names.filter(name => typeof name === 'string');
    } catch {}
    const dishes = arrayJson(order.dishes);
    events.set(`order:${order.id}`, {
      id: `order:${order.id}`, type: 'order',
      title: menuNames.length ? `完成了${menuNames.join('、')}` : '一起完成了一份点单',
      description: dishes.map(item => item.name).filter(Boolean).join('、'),
      author: `${order.author_name} 点单 · ${order.accepted_name || '对方'} 制作`,
      timeEstimated: !order.completed_at,
      images: dishes.map(item => item.image || item.imageKey).filter(Boolean).slice(0, 4)
    });
  }
  const items = selected.map(row => {
    const event = events.get(`${row.event_type}:${row.event_id}`);
    return event ? { ...event, eventAt: row.event_at } : null;
  }).filter(Boolean);
  res.json({ success: true, data: paged ? {
    items, hasMore, nextCursor: hasMore && selected.length ? encodeCursor(selected[selected.length - 1]) : ''
  } : items });
}));

module.exports = router;
module.exports._test = { decodeCursor, encodeCursor };
