const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');
const { ApiError, asyncHandler } = require('../utils');
const {
  assertMediaKeyForCouple,
  collectMediaKeys,
  removeMediaKeysIfUnreferenced
} = require('../media');

const router = express.Router();

const definitions = {
  countdown: {
    table: 'countdowns',
    order: 'event_date ASC',
    fields: { title: 'title', date: 'event_date', description: 'description', isAnniversary: 'is_anniversary', isTop: 'is_top' }
  },
  album: {
    table: 'albums',
    order: 'created_at DESC',
    join: 'LEFT JOIN tasks linked_task ON linked_task.id=r.task_id AND linked_task.couple_id=r.couple_id',
    select: ',linked_task.title task_title',
    fields: { imgUrl: 'image_url', fileID: 'storage_key', description: 'description', date: 'photo_date', taskId: 'task_id' },
    extras: row => ({ taskTitle: row.task_title || '' })
  },
  tasks: {
    table: 'tasks',
    order: 'created_at DESC',
    fields: { title: 'title', description: 'description', status: 'status', completed: 'status', completedAt: 'completed_at' }
  },
  menus: {
    table: 'menus',
    order: 'created_at DESC',
    json: ['dishes'],
    fields: { name: 'name', mealType: 'meal_type', dishes: 'dishes', imageUrl: 'image_url', imgUrl: 'image_url' }
  },
  orders: {
    table: 'orders',
    order: 'created_at DESC',
    json: ['dishes', 'menuNames'],
    fields: { dishes: 'dishes', menuNames: 'menu_names', mealType: 'meal_type', orderBy: 'order_by', note: 'note', status: 'status', acceptedBy: 'accepted_by', acceptedTime: 'accepted_at', completedAt: 'completed_at' }
  }
};

const bools = new Set(['is_anniversary', 'is_top']);
const mealTypes = new Set(['breakfast', 'lunch', 'dinner', 'snack']);
const orderStatuses = new Set(['pending', 'accepted', 'completed']);

function definition(name) {
  const value = definitions[name];
  if (!value) throw new ApiError(404, '资源不存在');
  return value;
}

function parseJson(value, fallback = []) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function output(row, definitionValue) {
  const item = {
    _id: String(row.id),
    coupleId: String(row.couple_id),
    authorId: String(row.author_id),
    author: row.author_name || '',
    createTime: row.created_at,
    createdAt: row.created_at
  };
  for (const [client, column] of Object.entries(definitionValue.fields)) {
    let value = row[column];
    if (definitionValue.json?.includes(client)) value = parseJson(value);
    if (bools.has(column)) value = Boolean(value);
    if (client === 'completed') value = row.status === 'completed';
    item[client] = value;
  }
  if (definitionValue.extras) Object.assign(item, definitionValue.extras(row));
  return item;
}

function cleanDishes(value, coupleId) {
  const dishes = parseJson(value);
  if (!Array.isArray(dishes) || dishes.length > 100) throw new ApiError(400, '菜品数据无效');
  return dishes.map((dish, index) => {
    const name = String(dish?.name || '').trim();
    if (!name || name.length > 100) throw new ApiError(400, `第${index + 1}道菜名称无效`);
    const image = String(dish.imageKey || dish.image || '');
    assertMediaKeyForCouple(image, coupleId);
    return {
      ...dish,
      id: String(dish.id || `${Date.now()}-${index}`).slice(0, 80),
      name,
      image,
      imageKey: undefined
    };
  });
}

function normalizeBody(resource, body, coupleId) {
  const normalized = { ...(body || {}) };
  if (resource === 'album') {
    if (normalized.fileID !== undefined || normalized.imgUrl !== undefined) {
      const key = String(normalized.fileID || normalized.imgUrl || '');
      assertMediaKeyForCouple(key, coupleId, { allowEmpty: false });
      normalized.imgUrl = key;
      normalized.fileID = key;
    }
  }
  if (resource === 'menus' || resource === 'orders') {
    if (normalized.dishes !== undefined) normalized.dishes = cleanDishes(normalized.dishes, coupleId);
    if (normalized.mealType !== undefined && !mealTypes.has(String(normalized.mealType))) {
      throw new ApiError(400, '餐别无效');
    }
  }
  if (resource === 'orders' && normalized.status !== undefined && !orderStatuses.has(String(normalized.status))) {
    throw new ApiError(400, '订单状态无效');
  }
  if (resource === 'countdown') {
    if (normalized.title !== undefined && (!String(normalized.title).trim() || String(normalized.title).trim().length > 100)) {
      throw new ApiError(400, '纪念日标题无效');
    }
    if (normalized.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(normalized.date))) {
      throw new ApiError(400, '纪念日日期无效');
    }
  }
  if (resource === 'tasks' && normalized.title !== undefined) {
    normalized.title = String(normalized.title).trim();
    if (!normalized.title || normalized.title.length > 150) throw new ApiError(400, '清单标题无效');
  }
  if (resource === 'menus' && normalized.name !== undefined) {
    normalized.name = String(normalized.name).trim();
    if (!normalized.name || normalized.name.length > 100) throw new ApiError(400, '菜单名称无效');
  }
  return normalized;
}

function input(body, definitionValue) {
  const result = {};
  for (const [client, column] of Object.entries(definitionValue.fields)) {
    if (body[client] === undefined) continue;
    let value = body[client];
    if (client === 'completed') value = value ? 'completed' : 'pending';
    if (definitionValue.json?.includes(client)) value = JSON.stringify(value || []);
    if (bools.has(column)) value = value ? 1 : 0;
    result[column] = value;
  }
  return result;
}

function mediaKeysFromRow(resource, row) {
  if (!row) return [];
  if (resource === 'album') return [...collectMediaKeys([row.image_url, row.storage_key])];
  if (resource === 'menus' || resource === 'orders') return [...collectMediaKeys(parseJson(row.dishes))];
  return [];
}

function ensureCouple(req) {
  if (!req.userRow.couple_id) throw new ApiError(409, '请先绑定情侣');
  return req.userRow.couple_id;
}

async function ensureMenuNameAvailable(executor, coupleId, name, excludeId = null) {
  const params = [coupleId, name];
  let sql = 'SELECT id FROM menus WHERE couple_id=? AND name=?';
  if (excludeId !== null) {
    sql += ' AND id<>?';
    params.push(excludeId);
  }
  sql += ' LIMIT 1';
  const [rows] = await executor.query(sql, params);
  if (rows[0]) throw new ApiError(409, '同一情侣空间内不能有重名菜单');
}

async function ensureTaskForCouple(executor, coupleId, taskId) {
  const [rows] = await executor.query(
    'SELECT id,title FROM tasks WHERE id=? AND couple_id=? LIMIT 1',
    [taskId, coupleId]
  );
  if (!rows[0]) throw new ApiError(404, '关联清单不存在');
  return rows[0];
}

function rethrowMenuDuplicate(error) {
  if (error?.code === 'ER_DUP_ENTRY') throw new ApiError(409, '同一情侣空间内不能有重名菜单');
  throw error;
}

router.use(requireAuth);

router.get('/:resource', asyncHandler(async (req, res) => {
  const definitionValue = definition(req.params.resource);
  const coupleId = ensureCouple(req);
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
  const [rows] = await pool.query(
    `SELECT r.*,u.name author_name${definitionValue.select || ''}
     FROM ${definitionValue.table} r
     JOIN users u ON u.id=r.author_id
     ${definitionValue.join || ''}
     WHERE r.couple_id=?
     ORDER BY ${definitionValue.order}
     LIMIT ?`,
    [coupleId, limit]
  );
  res.json({ success: true, data: rows.map(row => output(row, definitionValue)) });
}));

router.get('/:resource/:id', asyncHandler(async (req, res) => {
  const definitionValue = definition(req.params.resource);
  const coupleId = ensureCouple(req);
  const [rows] = await pool.query(
    `SELECT r.*,u.name author_name${definitionValue.select || ''}
     FROM ${definitionValue.table} r
     JOIN users u ON u.id=r.author_id
     ${definitionValue.join || ''}
     WHERE r.id=? AND r.couple_id=?
     LIMIT 1`,
    [req.params.id, coupleId]
  );
  if (!rows[0]) throw new ApiError(404, '数据不存在');
  res.json({ success: true, data: output(rows[0], definitionValue) });
}));

router.post('/orders/:id/accept', asyncHandler(async (req, res) => {
  const coupleId = ensureCouple(req);
  const [result] = await pool.query(
    `UPDATE orders
     SET status='accepted',accepted_by=?,accepted_at=NOW()
     WHERE id=? AND couple_id=? AND author_id<>? AND status='pending'`,
    [req.userRow.name, req.params.id, coupleId, req.userRow.id]
  );
  if (result.affectedRows) {
    return res.json({ success: true, data: null });
  }

  const [rows] = await pool.query(
    'SELECT author_id,status FROM orders WHERE id=? AND couple_id=? LIMIT 1',
    [req.params.id, coupleId]
  );
  if (!rows[0]) throw new ApiError(404, '点单不存在');
  if (String(rows[0].author_id) === String(req.userRow.id)) {
    throw new ApiError(403, '不能接自己的点单');
  }
  throw new ApiError(409, rows[0].status === 'accepted' ? '这份点单已经有人接了' : '点单状态已变化');
}));

router.post('/albums/task-photos', asyncHandler(async (req, res) => {
  const coupleId = ensureCouple(req);
  const images = req.body?.images;
  if (!Array.isArray(images) || !images.length || images.length > 9) {
    throw new ApiError(400, '每次可以关联1至9张照片');
  }
  const task = await ensureTaskForCouple(pool, coupleId, req.body.taskId);
  const keys = images.map(value => {
    const key = String(value || '');
    assertMediaKeyForCouple(key, coupleId, { allowEmpty: false });
    return key;
  });
  const description = String(req.body.description || task.title || '').trim().slice(0, 300);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const ids = [];
    for (const key of keys) {
      const [created] = await connection.query(
        `INSERT INTO albums(couple_id,author_id,task_id,image_url,storage_key,description)
         VALUES(?,?,?,?,?,?)`,
        [coupleId, req.userRow.id, task.id, key, key, description]
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
}));

router.post('/menus/batch', asyncHandler(async (req, res) => {
  const coupleId = ensureCouple(req);
  const sourceMenus = req.body?.menus;
  if (!Array.isArray(sourceMenus) || !sourceMenus.length || sourceMenus.length > 20) {
    throw new ApiError(400, '每次可导入1至20个菜单');
  }
  const menus = sourceMenus.map(item => {
    const normalized = normalizeBody('menus', item, coupleId);
    if (!normalized.name) throw new ApiError(400, '菜单名称不能为空');
    if (!Array.isArray(normalized.dishes) || !normalized.dishes.length) {
      throw new ApiError(400, `菜单“${normalized.name || ''}”至少需要一道菜`);
    }
    return {
      name: normalized.name,
      mealType: normalized.mealType || 'lunch',
      dishes: normalized.dishes
    };
  });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const ids = [];
    const batchNames = new Set();
    for (const menu of menus) {
      const nameKey = menu.name.toLocaleLowerCase();
      if (batchNames.has(nameKey)) throw new ApiError(409, `批量内容中存在重名菜单：${menu.name}`);
      batchNames.add(nameKey);
      await ensureMenuNameAvailable(connection, coupleId, menu.name);
      const [created] = await connection.query(
        `INSERT INTO menus(couple_id,author_id,name,meal_type,dishes)
         VALUES(?,?,?,?,?)`,
        [coupleId, req.userRow.id, menu.name, menu.mealType, JSON.stringify(menu.dishes)]
      );
      ids.push(String(created.insertId));
    }
    await connection.commit();
    return res.status(201).json({ success: true, data: { ids, count: ids.length } });
  } catch (error) {
    await connection.rollback();
    rethrowMenuDuplicate(error);
  } finally {
    connection.release();
  }
}));

router.post('/:resource', asyncHandler(async (req, res) => {
  const resource = req.params.resource;
  const definitionValue = definition(resource);
  const coupleId = ensureCouple(req);
  const body = normalizeBody(resource, req.body, coupleId);
  if (resource === 'album' && !body.imgUrl) throw new ApiError(400, '相册图片不能为空');
  if (resource === 'album' && body.taskId) await ensureTaskForCouple(pool, coupleId, body.taskId);
  if (resource === 'menus') {
    if (!body.name) throw new ApiError(400, '菜单名称不能为空');
    await ensureMenuNameAvailable(pool, coupleId, body.name);
  }
  const data = input(body, definitionValue);
  if (resource === 'orders') {
    delete data.accepted_by;
    delete data.accepted_at;
    delete data.completed_at;
    data.status = 'pending';
    data.order_by = req.userRow.name;
  }
  const keys = Object.keys(data);
  if (!keys.length) throw new ApiError(400, '没有可保存的数据');

  let result;
  try {
    [result] = await pool.query(
      `INSERT INTO ${definitionValue.table} (couple_id,author_id,${keys.join(',')})
       VALUES (?, ?, ${keys.map(() => '?').join(',')})`,
      [coupleId, req.userRow.id, ...keys.map(key => data[key])]
    );
  } catch (error) {
    if (resource === 'menus') rethrowMenuDuplicate(error);
    throw error;
  }
  if (resource === 'countdown' && data.is_anniversary === 1) {
    await pool.query('UPDATE countdowns SET is_anniversary=0 WHERE couple_id=? AND id<>?', [coupleId, result.insertId]);
  }
  res.status(201).json({ success: true, data: { _id: String(result.insertId) } });
}));

router.patch('/:resource/:id', asyncHandler(async (req, res) => {
  const resource = req.params.resource;
  const definitionValue = definition(resource);
  const coupleId = ensureCouple(req);
  const body = normalizeBody(resource, req.body, coupleId);
  const data = input(body, definitionValue);
  if (resource === 'orders') {
    delete data.order_by;
    delete data.accepted_by;
    delete data.accepted_at;
    delete data.completed_at;
  }
  const requestedKeys = Object.keys(data);
  if (!requestedKeys.length) throw new ApiError(400, '没有可更新的数据');

  const [beforeRows] = await pool.query(
    `SELECT * FROM ${definitionValue.table} WHERE id=? AND couple_id=? LIMIT 1`,
    [req.params.id, coupleId]
  );
  if (!beforeRows[0]) throw new ApiError(404, '数据不存在');
  if (resource === 'album' && data.task_id) await ensureTaskForCouple(pool, coupleId, data.task_id);
  if (resource === 'menus' && data.name !== undefined) {
    await ensureMenuNameAvailable(pool, coupleId, data.name, req.params.id);
  }
  if (resource === 'orders') {
    const isAuthor = String(beforeRows[0].author_id) === String(req.userRow.id);
    const changedContent = requestedKeys.some(key => key !== 'status');
    if (changedContent && !isAuthor) throw new ApiError(403, '只能修改自己发起的点单');
    if (data.status !== undefined) {
      if (data.status === 'accepted') {
        if (isAuthor) throw new ApiError(403, '不能接自己的点单');
        if (beforeRows[0].status !== 'pending') throw new ApiError(409, '点单状态已变化');
        data.accepted_by = req.userRow.name;
        data.accepted_at = new Date();
      } else if (data.status === 'completed') {
        if (beforeRows[0].status !== 'accepted') throw new ApiError(409, '请先接单');
        data.completed_at = new Date();
      } else if (data.status !== beforeRows[0].status) {
        throw new ApiError(409, '不能恢复之前的点单状态');
      }
    }
  }
  const keys = Object.keys(data);
  const oldMediaKeys = mediaKeysFromRow(resource, beforeRows[0]);

  let result;
  try {
    [result] = await pool.query(
      `UPDATE ${definitionValue.table}
       SET ${keys.map(key => `${key}=?`).join(',')}
       WHERE id=? AND couple_id=?`,
      [...keys.map(key => data[key]), req.params.id, coupleId]
    );
  } catch (error) {
    if (resource === 'menus') rethrowMenuDuplicate(error);
    throw error;
  }
  if (!result.affectedRows) throw new ApiError(404, '数据不存在');
  if (resource === 'countdown' && data.is_anniversary === 1) {
    await pool.query('UPDATE countdowns SET is_anniversary=0 WHERE couple_id=? AND id<>?', [coupleId, req.params.id]);
  }
  await removeMediaKeysIfUnreferenced(pool, oldMediaKeys);
  res.json({ success: true, data: null });
}));

router.delete('/:resource/:id', asyncHandler(async (req, res) => {
  const resource = req.params.resource;
  const definitionValue = definition(resource);
  const coupleId = ensureCouple(req);
  const [beforeRows] = await pool.query(
    `SELECT * FROM ${definitionValue.table} WHERE id=? AND couple_id=? LIMIT 1`,
    [req.params.id, coupleId]
  );
  if (!beforeRows[0]) throw new ApiError(404, '数据不存在');
  if (resource === 'orders' && String(beforeRows[0].author_id) !== String(req.userRow.id)) {
    throw new ApiError(403, '只能删除自己发起的点单');
  }
  const oldMediaKeys = mediaKeysFromRow(resource, beforeRows[0]);
  const [result] = await pool.query(
    `DELETE FROM ${definitionValue.table} WHERE id=? AND couple_id=?`,
    [req.params.id, coupleId]
  );
  if (!result.affectedRows) throw new ApiError(404, '数据不存在');
  await removeMediaKeysIfUnreferenced(pool, oldMediaKeys);
  res.json({ success: true, data: null });
}));

module.exports = router;
