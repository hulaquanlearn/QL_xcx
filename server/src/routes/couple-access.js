const { ApiError } = require('../utils');

function requireCoupleId(req) {
  if (!req.userRow?.couple_id) throw new ApiError(409, '请先绑定情侣');
  return req.userRow.couple_id;
}

async function requireCoupleMenu(executor, coupleId, menuId) {
  const [rows] = await executor.query(
    'SELECT * FROM menus WHERE id=? AND couple_id=? LIMIT 1',
    [menuId, coupleId]
  );
  if (!rows[0]) throw new ApiError(404, '菜单不存在');
  return rows[0];
}

async function requireCoupleTask(executor, coupleId, taskId) {
  const [rows] = await executor.query(
    'SELECT id,title FROM tasks WHERE id=? AND couple_id=? LIMIT 1',
    [taskId, coupleId]
  );
  if (!rows[0]) throw new ApiError(404, '关联清单不存在');
  return rows[0];
}

module.exports = { requireCoupleId, requireCoupleMenu, requireCoupleTask };
