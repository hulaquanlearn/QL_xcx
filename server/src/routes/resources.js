const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');
const { ApiError, asyncHandler } = require('../utils');
const {
  assertMediaKeyForCouple,
  collectMediaKeys,
  removeMediaKeysIfUnreferenced
} = require('../media');
const { checkText } = require('../content-safety');
const { requireCoupleId, requireCoupleTask } = require('./couple-access');
const {
  attachNormalizedDishes,
  removeOrphanDishes,
  syncMenuDishes
} = require('../services/menu-store');

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
    join: 'LEFT JOIN users accepted_user ON accepted_user.id=r.accepted_by_user_id AND accepted_user.couple_id=r.couple_id',
    select: ',accepted_user.name accepted_user_name',
    json: ['dishes', 'menuNames'],
    fields: { dishes: 'dishes', menuNames: 'menu_names', mealType: 'meal_type', orderBy: 'order_by', note: 'note', status: 'status', acceptedBy: 'accepted_by', acceptedByUserId: 'accepted_by_user_id', acceptedTime: 'accepted_at', readyAt: 'ready_at', completedAt: 'completed_at' },
    extras: row => ({ acceptedBy: row.accepted_user_name || row.accepted_by || '' })
  }
};

const bools = new Set(['is_anniversary', 'is_top']);
const mealTypes = new Set(['breakfast', 'lunch', 'dinner', 'snack']);
const orderStatuses = new Set(['pending', 'accepted', 'ready', 'completed']);
const taskStatuses = new Set(['pending', 'completed']);

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

function isValidDateOnly(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
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
    if (client === 'acceptedByUserId' && value) value = String(value);
    item[client] = value;
  }
  if (definitionValue.extras) Object.assign(item, definitionValue.extras(row));
  return item;
}

function cleanDishes(value, coupleId) {
  const dishes = parseJson(value);
  if (!Array.isArray(dishes) || !dishes.length || dishes.length > 100) {
    throw new ApiError(400, '至少需要一道菜，且每份最多100道菜');
  }
  const names = new Set();
  const ids = new Set();
  return dishes.map((dish, index) => {
    const name = String(dish?.name || '').trim();
    if (!name || name.length > 100) throw new ApiError(400, `第${index + 1}道菜名称无效`);
    const nameKey = name.toLocaleLowerCase();
    if (names.has(nameKey)) throw new ApiError(400, `菜品名称不能重复：${name}`);
    names.add(nameKey);
    const id = String(dish.id || `${Date.now()}-${index}`).slice(0, 80);
    if (ids.has(id)) throw new ApiError(400, `第${index + 1}道菜标识重复`);
    ids.add(id);
    const image = String(dish.imageKey || dish.image || '');
    const recipeImage = String(dish.recipeImageKey || dish.recipeImage || '');
    assertMediaKeyForCouple(image, coupleId);
    assertMediaKeyForCouple(recipeImage, coupleId);
    const ingredients = String(dish.ingredients || '').trim();
    const steps = String(dish.steps || '').trim();
    const tips = String(dish.tips || '').trim();
    if (ingredients.length > 1200) throw new ApiError(400, `第${index + 1}道菜食材说明过长`);
    if (steps.length > 4000) throw new ApiError(400, `第${index + 1}道菜制作步骤过长`);
    if (tips.length > 1000) throw new ApiError(400, `第${index + 1}道菜小贴士过长`);
    return {
      id,
      name,
      image,
      recipeImage,
      ingredients,
      steps,
      tips
    };
  });
}

function cleanMenuNames(value) {
  const source = parseJson(value);
  if (!Array.isArray(source) || source.length > 20) throw new ApiError(400, '菜单来源数据无效');
  const names = [];
  const seen = new Set();
  source.forEach((item, index) => {
    const name = String(item || '').trim();
    if (!name || name.length > 100) throw new ApiError(400, `第${index + 1}个菜单名称无效`);
    const key = name.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  });
  return names;
}

function assertTextLength(value, maximum, message) {
  if (value !== undefined && String(value || '').trim().length > maximum) {
    throw new ApiError(400, message);
  }
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
  if (resource === 'orders') {
    if (normalized.menuNames !== undefined) normalized.menuNames = cleanMenuNames(normalized.menuNames);
    assertTextLength(normalized.note, 500, '点单备注不能超过500字');
  }
  if (resource === 'orders' && normalized.status !== undefined && !orderStatuses.has(String(normalized.status))) {
    throw new ApiError(400, '订单状态无效');
  }
  if (resource === 'countdown') {
    if (normalized.title !== undefined && (!String(normalized.title).trim() || String(normalized.title).trim().length > 100)) {
      throw new ApiError(400, '纪念日标题无效');
    }
    if (normalized.date !== undefined && !isValidDateOnly(normalized.date)) {
      throw new ApiError(400, '纪念日日期无效');
    }
    assertTextLength(normalized.description, 500, '纪念日说明不能超过500字');
  }
  if (resource === 'tasks') {
    if (normalized.title !== undefined) {
      normalized.title = String(normalized.title).trim();
      if (!normalized.title || normalized.title.length > 150) throw new ApiError(400, '清单标题无效');
    }
    if (normalized.status !== undefined && !taskStatuses.has(String(normalized.status))) {
      throw new ApiError(400, '清单状态无效');
    }
    assertTextLength(normalized.description, 500, '清单说明不能超过500字');
  }
  if (resource === 'menus' && normalized.name !== undefined) {
    normalized.name = String(normalized.name).trim();
    if (!normalized.name || normalized.name.length > 100) throw new ApiError(400, '菜单名称无效');
  }
  if (resource === 'album') assertTextLength(normalized.description, 300, '照片说明不能超过300字');
  return normalized;
}

function validateCreateBody(resource, body) {
  if (resource === 'countdown' && (!body.title || !body.date)) {
    throw new ApiError(400, '纪念日标题和日期不能为空');
  }
  if (resource === 'album' && !body.imgUrl) throw new ApiError(400, '相册图片不能为空');
  if (resource === 'tasks' && !body.title) throw new ApiError(400, '清单标题不能为空');
  if (resource === 'menus' && (!body.name || !Array.isArray(body.dishes) || !body.dishes.length)) {
    throw new ApiError(400, '菜单名称和菜品不能为空');
  }
  if (resource === 'orders' && (!Array.isArray(body.dishes) || !body.dishes.length)) {
    throw new ApiError(400, '点单至少需要一道菜');
  }
}

function moderationText(resource, body) {
  const values = [];
  const add = value => {
    const text = String(value || '').trim();
    if (text) values.push(text);
  };
  if (resource === 'countdown') {
    add(body.title);
    add(body.description);
  } else if (resource === 'album') {
    add(body.description);
  } else if (resource === 'tasks') {
    add(body.title);
    add(body.description);
  } else if (resource === 'menus') {
    add(body.name);
    (body.dishes || []).forEach(dish => {
      add(dish?.name);
      add(dish?.ingredients);
      add(dish?.steps);
      add(dish?.tips);
    });
  } else if (resource === 'orders') {
    add(body.note);
    (body.dishes || []).forEach(dish => {
      add(dish?.name);
      add(dish?.ingredients);
      add(dish?.steps);
      add(dish?.tips);
    });
    const menuNames = Array.isArray(body.menuNames) ? body.menuNames : parseJson(body.menuNames);
    (menuNames || []).forEach(add);
  }
  return values.join('\n');
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
  return requireCoupleId(req);
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
  return requireCoupleTask(executor, coupleId, taskId);
}

function rethrowMenuDuplicate(error) {
  if (error?.code === 'ER_DUP_ENTRY') throw new ApiError(409, '同一情侣空间内不能有重名菜单');
  throw error;
}

router.use(requireAuth);
router.use(require('./resource-orders'));
router.use(require('./resource-albums'));

router.get('/:resource', asyncHandler(async (req, res) => {
  const resource = req.params.resource;
  const definitionValue = definition(resource);
  const coupleId = ensureCouple(req);
  const pagedAlbum = resource === 'album' && String(req.query.paged || '') === '1';
  const limitMaximum = pagedAlbum ? 50 : 200;
  const limit = Math.min(Math.max(Number(req.query.limit) || (pagedAlbum ? 30 : 100), 1), limitMaximum);
  const cursor = pagedAlbum && /^\d+$/.test(String(req.query.cursor || ''))
    ? String(req.query.cursor)
    : '';
  const conditions = ['r.couple_id=?'];
  const params = [coupleId];
  if (cursor) {
    conditions.push('r.id<?');
    params.push(cursor);
  }
  if (resource === 'album' && String(req.query.linkedTasks || '') === '1') {
    conditions.push('r.task_id IS NOT NULL');
  }
  const requestedRows = pagedAlbum ? limit + 1 : limit;
  let [rows] = await pool.query(
    `SELECT r.*,u.name author_name${definitionValue.select || ''}
     FROM ${definitionValue.table} r
     JOIN users u ON u.id=r.author_id
     ${definitionValue.join || ''}
     WHERE ${conditions.join(' AND ')}
     ORDER BY ${pagedAlbum ? 'r.id DESC' : definitionValue.order}
     LIMIT ?`,
    [...params, requestedRows]
  );
  if (resource === 'menus') rows = await attachNormalizedDishes(pool, coupleId, rows);
  if (pagedAlbum) {
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items = pageRows.map(row => output(row, definitionValue));
    return res.json({
      success: true,
      data: {
        items,
        hasMore,
        nextCursor: hasMore && pageRows.length ? String(pageRows[pageRows.length - 1].id) : ''
      }
    });
  }
  return res.json({ success: true, data: rows.map(row => output(row, definitionValue)) });
}));

router.get('/:resource/:id', asyncHandler(async (req, res) => {
  const definitionValue = definition(req.params.resource);
  const coupleId = ensureCouple(req);
  let [rows] = await pool.query(
    `SELECT r.*,u.name author_name${definitionValue.select || ''}
     FROM ${definitionValue.table} r
     JOIN users u ON u.id=r.author_id
     ${definitionValue.join || ''}
     WHERE r.id=? AND r.couple_id=?
     LIMIT 1`,
    [req.params.id, coupleId]
  );
  if (!rows[0]) throw new ApiError(404, '数据不存在');
  if (req.params.resource === 'menus') rows = await attachNormalizedDishes(pool, coupleId, rows);
  res.json({ success: true, data: output(rows[0], definitionValue) });
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
  await checkText(menus.map(menu => moderationText('menus', menu)).join('\n'), {
    openid: req.userRow.wechat_openid,
    scene: 4
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
      await syncMenuDishes(connection, coupleId, req.userRow.id, created.insertId, menu.dishes);
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
  validateCreateBody(resource, body);
  await checkText(moderationText(resource, body), {
    openid: req.userRow.wechat_openid,
    scene: 4
  });
  if (resource === 'album' && body.taskId) await ensureTaskForCouple(pool, coupleId, body.taskId);
  if (resource === 'menus') {
    if (!body.name) throw new ApiError(400, '菜单名称不能为空');
    await ensureMenuNameAvailable(pool, coupleId, body.name);
  }
  const data = input(body, definitionValue);
  if (resource === 'orders') {
    delete data.accepted_by;
    delete data.accepted_by_user_id;
    delete data.accepted_at;
    delete data.ready_at;
    delete data.completed_at;
    data.status = 'pending';
    data.order_by = req.userRow.name;
  }
  const keys = Object.keys(data);
  if (!keys.length) throw new ApiError(400, '没有可保存的数据');

  let result;
  if (resource === 'menus') {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      [result] = await connection.query(
        `INSERT INTO menus (couple_id,author_id,${keys.join(',')})
         VALUES (?, ?, ${keys.map(() => '?').join(',')})`,
        [coupleId, req.userRow.id, ...keys.map(key => data[key])]
      );
      await syncMenuDishes(connection, coupleId, req.userRow.id, result.insertId, body.dishes);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      rethrowMenuDuplicate(error);
    } finally {
      connection.release();
    }
  } else {
    [result] = await pool.query(
      `INSERT INTO ${definitionValue.table} (couple_id,author_id,${keys.join(',')})
       VALUES (?, ?, ${keys.map(() => '?').join(',')})`,
      [coupleId, req.userRow.id, ...keys.map(key => data[key])]
    );
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
  if (resource === 'orders' && body.status !== undefined) {
    throw new ApiError(400, '请使用接单或完成订单操作');
  }
  await checkText(moderationText(resource, body), {
    openid: req.userRow.wechat_openid,
    scene: 4
  });
  const data = input(body, definitionValue);
  if (resource === 'orders') {
    delete data.order_by;
    delete data.status;
    delete data.accepted_by;
    delete data.accepted_by_user_id;
    delete data.accepted_at;
    delete data.ready_at;
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
    if (changedContent && beforeRows[0].status !== 'pending') {
      throw new ApiError(409, '点单已被接收，不能再修改内容');
    }
  }
  const keys = Object.keys(data);
  const oldMediaKeys = mediaKeysFromRow(resource, beforeRows[0]);

  let result;
  if (resource === 'menus') {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      [result] = await connection.query(
        `UPDATE menus SET ${keys.map(key => `${key}=?`).join(',')} WHERE id=? AND couple_id=?`,
        [...keys.map(key => data[key]), req.params.id, coupleId]
      );
      if (body.dishes !== undefined) {
        await syncMenuDishes(connection, coupleId, req.userRow.id, req.params.id, body.dishes);
        await removeOrphanDishes(connection, coupleId);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      rethrowMenuDuplicate(error);
    } finally {
      connection.release();
    }
  } else {
    [result] = await pool.query(
      `UPDATE ${definitionValue.table}
       SET ${keys.map(key => `${key}=?`).join(',')}
       WHERE id=? AND couple_id=?`,
      [...keys.map(key => data[key]), req.params.id, coupleId]
    );
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
  if (resource === 'orders' && ['accepted', 'ready'].includes(beforeRows[0].status)) {
    throw new ApiError(409, beforeRows[0].status === 'ready'
      ? '对方已经做好，请先确认收到'
      : '对方已接单，请等待做好后再处理');
  }
  const oldMediaKeys = mediaKeysFromRow(resource, beforeRows[0]);
  const [result] = await pool.query(
    `DELETE FROM ${definitionValue.table} WHERE id=? AND couple_id=?`,
    [req.params.id, coupleId]
  );
  if (!result.affectedRows) throw new ApiError(404, '数据不存在');
  if (resource === 'menus') await removeOrphanDishes(pool, coupleId);
  await removeMediaKeysIfUnreferenced(pool, oldMediaKeys);
  res.json({ success: true, data: null });
}));

module.exports = router;
module.exports._test = {
  cleanDishes,
  cleanMenuNames,
  isValidDateOnly,
  normalizeBody,
  validateCreateBody
};
