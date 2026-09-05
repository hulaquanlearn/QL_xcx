const { ApiError } = require('../utils');

function monthRange(value) {
  const month = String(value || '');
  if (!month) return null;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 1000) {
    throw new ApiError(400, '照片月份无效');
  }
  const [year, number] = month.split('-').map(Number);
  return [month + '-01', `${number === 12 ? year + 1 : year}-${String(number === 12 ? 1 : number + 1).padStart(2, '0')}-01`];
}

function albumSelection(userId) {
  return {
    sql: ',EXISTS(SELECT 1 FROM album_favorites favorite WHERE favorite.album_id=r.id AND favorite.user_id=?) is_favorite',
    params: [userId]
  };
}

function listOptions(resource, query, coupleId, userId) {
  const paged = ['album', 'orders', 'tasks', 'menus'].includes(resource) && String(query.paged || '') === '1';
  const limit = Math.min(Math.max(Math.floor(Number(query.limit)) || (paged ? 30 : 100), 1), paged ? 50 : 200);
  const conditions = ['r.couple_id=?'];
  const params = [coupleId];
  if (paged && query.cursor) {
    if (!/^\d+$/.test(String(query.cursor))) throw new ApiError(400, '分页游标无效');
    conditions.push('r.id<?');
    params.push(String(query.cursor));
  }
  if (resource === 'album') {
    if (String(query.linkedTasks || '') === '1') conditions.push('r.task_id IS NOT NULL');
    if (query.taskIds) {
      const ids = [...new Set(String(query.taskIds).split(','))];
      if (!ids.length || ids.length > 50 || ids.some(id => !/^\d+$/.test(id))) throw new ApiError(400, '关联清单筛选无效');
      conditions.push(`r.task_id IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
    const range = monthRange(query.month);
    if (range) {
      conditions.push('COALESCE(r.photo_date,r.created_at)>=? AND COALESCE(r.photo_date,r.created_at)<?');
      params.push(...range);
    }
    if (String(query.favoriteOnly || '') === '1') {
      conditions.push('EXISTS(SELECT 1 FROM album_favorites favorite_filter WHERE favorite_filter.album_id=r.id AND favorite_filter.user_id=?)');
      params.push(userId);
    }
  }
  if (['orders', 'tasks'].includes(resource) && query.status) {
    const allowed = resource === 'orders' ? ['pending', 'accepted', 'ready', 'completed'] : ['pending', 'completed'];
    if (!allowed.includes(String(query.status))) throw new ApiError(400, '筛选状态无效');
    conditions.push('r.status=?');
    params.push(String(query.status));
  }
  return { paged, limit, conditions, params };
}

module.exports = { albumSelection, listOptions, monthRange };
