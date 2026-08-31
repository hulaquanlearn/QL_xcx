const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');
const { checkText } = require('../content-safety');
const { ApiError, asyncHandler } = require('../utils');
const { requireCoupleId } = require('./couple-access');
const { attachNormalizedDishes } = require('../services/menu-store');

const router = express.Router();
const mealTypes = new Set(['breakfast', 'lunch', 'dinner', 'snack']);

function validDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3]);
}

function weekStart(value) {
  const text = String(value || '');
  if (!validDate(text)) throw new ApiError(400, '周开始日期无效');
  const date = new Date(`${text}T00:00:00Z`);
  if (date.getUTCDay() !== 1) throw new ApiError(400, '周开始日期必须是星期一');
  return text;
}

function normalizeEntries(value) {
  if (!Array.isArray(value) || value.length > 28) throw new ApiError(400, '周菜单数据无效');
  const slots = new Set();
  return value.map((entry, index) => {
    const dayIndex = Number(entry?.dayIndex);
    const mealType = String(entry?.mealType || '');
    const menuId = String(entry?.menuId || '');
    if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) {
      throw new ApiError(400, `第${index + 1}项日期无效`);
    }
    if (!mealTypes.has(mealType) || !/^\d+$/.test(menuId)) {
      throw new ApiError(400, `第${index + 1}项菜单无效`);
    }
    const slot = `${dayIndex}:${mealType}`;
    if (slots.has(slot)) throw new ApiError(400, '同一天同一餐别只能安排一个菜单');
    slots.add(slot);
    return { dayIndex, mealType, menuId };
  });
}

function splitIngredients(value) {
  return String(value || '')
    .split(/[\n；;、]+/)
    .map(item => item.replace(/^[-•·\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 80);
}

router.use(requireAuth);

router.get('/week', asyncHandler(async (req, res) => {
  const coupleId = requireCoupleId(req);
  const start = weekStart(req.query.weekStart);
  const [[plans], [shopping]] = await Promise.all([
    pool.query(
      `SELECT p.id,p.day_index,p.meal_type,p.menu_id,m.name menu_name,m.dishes
       FROM weekly_menu_plans p
       JOIN menus m ON m.id=p.menu_id AND m.couple_id=p.couple_id
       WHERE p.couple_id=? AND p.week_start=?
       ORDER BY p.day_index,FIELD(p.meal_type,'breakfast','lunch','dinner','snack')`,
      [coupleId, start]
    ),
    pool.query(
      `SELECT id,name,quantity,source,checked,created_at
       FROM shopping_items
       WHERE couple_id=? AND week_start=?
       ORDER BY checked,created_at,id`,
      [coupleId, start]
    )
  ]);
  const menuRows = plans.map(row => ({ id: row.menu_id, dishes: row.dishes }));
  const hydrated = await attachNormalizedDishes(pool, coupleId, menuRows);
  const dishesByMenu = new Map(hydrated.map(row => [String(row.id), row.dishes]));
  res.json({
    success: true,
    data: {
      weekStart: start,
      plans: plans.map(row => ({
        id: String(row.id),
        dayIndex: row.day_index,
        mealType: row.meal_type,
        menuId: String(row.menu_id),
        menuName: row.menu_name,
        dishes: dishesByMenu.get(String(row.menu_id)) || []
      })),
      shopping: shopping.map(row => ({
        id: String(row.id),
        name: row.name,
        quantity: row.quantity || '',
        source: row.source,
        checked: Boolean(row.checked)
      }))
    }
  });
}));

router.put('/week', asyncHandler(async (req, res) => {
  const coupleId = requireCoupleId(req);
  const start = weekStart(req.body?.weekStart);
  const entries = normalizeEntries(req.body?.entries);
  const menuIds = Array.from(new Set(entries.map(entry => entry.menuId)));
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (menuIds.length) {
      const placeholders = menuIds.map(() => '?').join(',');
      const [menus] = await connection.query(
        `SELECT id FROM menus WHERE couple_id=? AND id IN (${placeholders}) FOR UPDATE`,
        [coupleId, ...menuIds]
      );
      if (menus.length !== menuIds.length) throw new ApiError(404, '周菜单中包含已删除的菜单');
    }
    await connection.query(
      'DELETE FROM weekly_menu_plans WHERE couple_id=? AND week_start=?',
      [coupleId, start]
    );
    for (const entry of entries) {
      await connection.query(
        `INSERT INTO weekly_menu_plans(couple_id,author_id,week_start,day_index,meal_type,menu_id)
         VALUES(?,?,?,?,?,?)`,
        [coupleId, req.userRow.id, start, entry.dayIndex, entry.mealType, entry.menuId]
      );
    }
    await connection.commit();
    res.json({ success: true, data: { count: entries.length } });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.post('/week/shopping/generate', asyncHandler(async (req, res) => {
  const coupleId = requireCoupleId(req);
  const start = weekStart(req.body?.weekStart);
  const [menuRows] = await pool.query(
    `SELECT DISTINCT m.id,m.dishes
     FROM weekly_menu_plans p
     JOIN menus m ON m.id=p.menu_id AND m.couple_id=p.couple_id
     WHERE p.couple_id=? AND p.week_start=?`,
    [coupleId, start]
  );
  const hydrated = await attachNormalizedDishes(pool, coupleId, menuRows);
  const names = [];
  const seen = new Set();
  hydrated.flatMap(menu => menu.dishes || []).flatMap(dish => splitIngredients(dish.ingredients)).forEach(name => {
    const key = name.toLocaleLowerCase();
    if (!seen.has(key) && names.length < 120) {
      seen.add(key);
      names.push(name.slice(0, 150));
    }
  });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `DELETE FROM shopping_items
       WHERE couple_id=? AND week_start=? AND source='plan'`,
      [coupleId, start]
    );
    for (const name of names) {
      await connection.query(
        `INSERT INTO shopping_items(couple_id,author_id,week_start,name,source)
         VALUES(?,?,?,?,"plan")`,
        [coupleId, req.userRow.id, start, name]
      );
    }
    await connection.commit();
    res.status(201).json({ success: true, data: { count: names.length } });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.post('/week/shopping', asyncHandler(async (req, res) => {
  const coupleId = requireCoupleId(req);
  const start = weekStart(req.body?.weekStart);
  const name = String(req.body?.name || '').trim();
  const quantity = String(req.body?.quantity || '').trim();
  if (!name || name.length > 150 || quantity.length > 80) throw new ApiError(400, '采购内容无效');
  await checkText([name, quantity].filter(Boolean).join(' '), { openid: req.userRow.wechat_openid, scene: 4 });
  const [result] = await pool.query(
    `INSERT INTO shopping_items(couple_id,author_id,week_start,name,quantity)
     VALUES(?,?,?,?,?)`,
    [coupleId, req.userRow.id, start, name, quantity]
  );
  res.status(201).json({ success: true, data: { id: String(result.insertId) } });
}));

router.patch('/week/shopping/:id', asyncHandler(async (req, res) => {
  const coupleId = requireCoupleId(req);
  const checked = req.body?.checked;
  if (typeof checked !== 'boolean') throw new ApiError(400, '采购状态无效');
  const [result] = await pool.query(
    'UPDATE shopping_items SET checked=? WHERE id=? AND couple_id=?',
    [checked ? 1 : 0, req.params.id, coupleId]
  );
  if (!result.affectedRows) throw new ApiError(404, '采购项不存在');
  res.json({ success: true, data: null });
}));

router.delete('/week/shopping/:id', asyncHandler(async (req, res) => {
  const coupleId = requireCoupleId(req);
  const [result] = await pool.query(
    'DELETE FROM shopping_items WHERE id=? AND couple_id=?',
    [req.params.id, coupleId]
  );
  if (!result.affectedRows) throw new ApiError(404, '采购项不存在');
  res.json({ success: true, data: null });
}));

module.exports = router;
module.exports._test = { normalizeEntries, splitIngredients, validDate, weekStart };
