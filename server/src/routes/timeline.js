const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');
const { asyncHandler } = require('../utils');
const { requireCoupleId } = require('./couple-access');

const router = express.Router();
router.use(requireAuth);

function dateOnly(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${month}-${day}`;
  }
  return String(value || '').slice(0, 10);
}

router.get('/', asyncHandler(async (req, res) => {
  const coupleId = requireCoupleId(req);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const [[tasks], [photos], [orders]] = await Promise.all([
    pool.query(
      `SELECT t.id,t.title,t.description,t.completed_at event_at,u.name author_name
       FROM tasks t JOIN users u ON u.id=t.author_id
       WHERE t.couple_id=? AND t.status='completed'
       ORDER BY t.completed_at DESC LIMIT 100`,
      [coupleId]
    ),
    pool.query(
      `SELECT a.id,a.task_id,a.image_url,a.description,a.photo_date,a.created_at event_at,u.name author_name
       FROM albums a JOIN users u ON u.id=a.author_id
       WHERE a.couple_id=?
       ORDER BY a.id DESC LIMIT 200`,
      [coupleId]
    ),
    pool.query(
      `SELECT o.id,o.menu_names,o.dishes,o.completed_at event_at,u.name author_name,
              COALESCE(accepted.name,o.accepted_by,'') accepted_name
       FROM orders o
       JOIN users u ON u.id=o.author_id
       LEFT JOIN users accepted ON accepted.id=o.accepted_by_user_id AND accepted.couple_id=o.couple_id
       WHERE o.couple_id=? AND o.status='completed'
       ORDER BY o.completed_at DESC LIMIT 100`,
      [coupleId]
    )
  ]);
  const linked = new Map();
  for (const photo of photos) {
    if (!photo.task_id) continue;
    const key = String(photo.task_id);
    if (!linked.has(key)) linked.set(key, []);
    linked.get(key).push(photo.image_url);
  }
  const events = tasks.map(task => ({
    id: `task:${task.id}`,
    type: 'task',
    title: task.title,
    description: task.description || '一起完成了一件计划',
    author: task.author_name,
    eventAt: task.event_at,
    images: linked.get(String(task.id)) || []
  }));
  for (const photo of photos.filter(item => !item.task_id)) {
    events.push({
      id: `album:${photo.id}`,
      type: 'album',
      title: photo.description || '收藏了一张照片',
      description: photo.photo_date ? `拍摄于 ${dateOnly(photo.photo_date)}` : '',
      author: photo.author_name,
      eventAt: photo.event_at,
      images: [photo.image_url]
    });
  }
  for (const order of orders) {
    let menuNames = [];
    let dishes = [];
    try { menuNames = Array.isArray(order.menu_names) ? order.menu_names : JSON.parse(order.menu_names || '[]'); } catch {}
    try { dishes = Array.isArray(order.dishes) ? order.dishes : JSON.parse(order.dishes || '[]'); } catch {}
    events.push({
      id: `order:${order.id}`,
      type: 'order',
      title: menuNames.length ? `完成了${menuNames.join('、')}` : '一起完成了一份点单',
      description: dishes.map(item => item.name).filter(Boolean).join('、'),
      author: `${order.author_name} 点单 · ${order.accepted_name || '对方'} 制作`,
      eventAt: order.event_at,
      images: dishes.map(item => item.image || item.imageKey).filter(Boolean).slice(0, 4)
    });
  }
  events.sort((a, b) => new Date(b.eventAt).getTime() - new Date(a.eventAt).getTime());
  res.json({ success: true, data: events.slice(0, limit) });
}));

module.exports = router;
