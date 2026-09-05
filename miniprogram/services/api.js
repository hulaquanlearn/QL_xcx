const config = require('../config');
const auth = require('./auth');
let identityFreshUntil = 0;
let identityRefreshPromise = null;
let authRedirecting = false;

function clearExpiredSession() {
  identityFreshUntil = 0;
  identityRefreshPromise = null;
  auth.clearSession();
  try {
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && typeof app.clearLoginStatus === 'function') app.clearLoginStatus();
  } catch {}
  if (!authRedirecting && typeof wx !== 'undefined' && typeof wx.reLaunch === 'function') {
    authRedirecting = true;
    wx.reLaunch({
      url: '/pages/index/index',
      complete: () => setTimeout(() => { authRedirecting = false; }, 500)
    });
  }
}

function request(path, options = {}) {
  const token = auth.getToken();
  const header = { 'Content-Type': 'application/json' };
  if (token) header.Authorization = `Bearer ${token}`;
  return new Promise((resolve, reject) => wx.request({
    url: `${config.apiBaseUrl}${path}`,
    method: options.method || 'GET',
    data: options.data,
    header,
    timeout: options.timeout || config.requestTimeout,
    success(res) {
      const body = res.data || {};
      if (res.statusCode >= 200 && res.statusCode < 300 && body.success !== false) return resolve(body.data);
      if (res.statusCode === 401 && !options.public) clearExpiredSession();
      const error = new Error(body.msg || `请求失败（${res.statusCode}）`);
      error.statusCode = res.statusCode;
      reject(error);
    },
    fail(err) { reject(new Error(err.errMsg && err.errMsg.includes('timeout') ? '服务器响应超时' : '无法连接情侣空间服务器')); }
  }));
}

function getWechatCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: result => result.code
        ? resolve(result.code)
        : reject(new Error('无法获取微信身份，请重新打开小程序')),
      fail: () => reject(new Error('无法获取微信身份，请重新打开小程序'))
    });
  });
}

function ensureWechatIdentity() {
  if (!auth.getToken()) return Promise.reject(new Error('请先登录'));
  if (Date.now() < identityFreshUntil) return Promise.resolve();
  if (!identityRefreshPromise) {
    identityRefreshPromise = getWechatCode()
      .then(code => request('/auth/wechat/refresh', { method: 'POST', data: { code } }))
      .then(() => { identityFreshUntil = Date.now() + 90 * 60 * 1000; })
      .finally(() => { identityRefreshPromise = null; });
  }
  return identityRefreshPromise;
}

function safetyRequest(path, options = {}) {
  return ensureWechatIdentity().then(() => request(path, options));
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function assertUploadActive(options) {
  if (options.isCancelled && options.isCancelled()) {
    const error = new Error('已停止等待图片审核');
    error.cancelled = true;
    throw error;
  }
}

function waitForMediaCheck(checkId, options = {}, remaining = 120) {
  try { assertUploadActive(options); } catch (error) { error.checkId = checkId; return Promise.reject(error); }
  if (options.onStatus) options.onStatus({ status: 'moderating', checkId });
  return request(`/content-safety/check/${encodeURIComponent(checkId)}`).then(result => {
    assertUploadActive(options);
    if (result.status === 'approved' && result.key) return result;
    if (result.status !== 'pending') {
      const error = new Error(result.message || '图片未通过内容安全检测');
      error.rejected = true;
      throw error;
    }
    if (remaining <= 0) {
      const error = new Error('图片仍在审核中，可稍后继续查询');
      error.pending = true;
      throw error;
    }
    return delay(1500).then(() => waitForMediaCheck(checkId, options, remaining - 1));
  }).catch(error => {
    error.checkId = checkId;
    throw error;
  });
}

function uploadWithReview(path, data, options = {}) {
  return Promise.resolve().then(() => {
    assertUploadActive(options);
    if (options.onStatus) options.onStatus({ status: 'uploading' });
    return safetyRequest(path, { method: 'POST', data, timeout: 60000 });
  }).then(result => {
    if (result.key) return result;
    if (!result.checkId) throw new Error('服务器未返回图片审核编号');
    return waitForMediaCheck(result.checkId, options);
  });
}

module.exports = {
  login: data => getWechatCode()
    .then(wechatCode => request('/auth/login', {
      method: 'POST',
      data: { ...data, wechatCode },
      public: true
    }))
    .then(result => {
      identityFreshUntil = Date.now() + 90 * 60 * 1000;
      return result;
    }),
  me: () => request('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST' }),
  dashboard: () => request('/dashboard'),
  profile: data => safetyRequest('/profile', { method: 'PATCH', data }),
  bindPartner: inviteCode => request('/partner/bind', { method: 'POST', data: { inviteCode } }),
  getAvatars: () => request('/avatars'),
  uploadAvatarFile: (data, options) => uploadWithReview('/avatars/file', data, options),
  uploadMediaFile: (data, options) => uploadWithReview('/media/file', data, options),
  waitForMediaCheck,
  setAlbumFavorite: (id, favorite) => request(`/resources/albums/${encodeURIComponent(id)}/favorite`, { method: 'PATCH', data: { favorite } }),
  albumMonths: (favoriteOnly = false, taskId = '') => request(`/resources/albums/months?favoriteOnly=${favoriteOnly ? '1' : '0'}${taskId ? `&taskIds=${encodeURIComponent(taskId)}` : ''}`),
  deleteMediaFile: (coupleId, filename) => request(`/media/file/${encodeURIComponent(coupleId)}/${encodeURIComponent(filename)}`, { method: 'DELETE' }),
  list: (resource, params = {}) => {
    const query = Object.keys(params).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
    return request(`/resources/${resource}${query ? `?${query}` : ''}`);
  },
  listPage: (resource, params = {}) => {
    const query = { ...params, paged: 1 };
    const text = Object.keys(query).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join('&');
    return request(`/resources/${resource}?${text}`);
  },
  get: (resource, id) => request(`/resources/${resource}/${encodeURIComponent(id)}`),
  create: (resource, data) => safetyRequest(`/resources/${resource}`, { method: 'POST', data }),
  batchCreateMenus: menus => safetyRequest('/resources/menus/batch', { method: 'POST', data: { menus } }),
  batchCreateAlbums: (images, description = '', photoDate = '') => safetyRequest('/resources/albums/batch', {
    method: 'POST',
    data: { images, description, photoDate }
  }),
  batchDeleteAlbums: ids => request('/resources/albums/batch', { method: 'DELETE', data: { ids } }),
  acceptOrder: id => request(`/resources/orders/${encodeURIComponent(id)}/accept`, { method: 'POST' }),
  readyOrder: id => request(`/resources/orders/${encodeURIComponent(id)}/ready`, { method: 'POST' }),
  confirmOrder: id => request(`/resources/orders/${encodeURIComponent(id)}/confirm`, { method: 'POST' }),
  completeOrder: id => request(`/resources/orders/${encodeURIComponent(id)}/complete`, { method: 'POST' }),
  getWeekPlan: weekStart => request(`/planning/week?weekStart=${encodeURIComponent(weekStart)}`),
  saveWeekPlan: (weekStart, entries) => request('/planning/week', { method: 'PUT', data: { weekStart, entries } }),
  generateShopping: weekStart => request('/planning/week/shopping/generate', { method: 'POST', data: { weekStart } }),
  addShopping: (weekStart, name, quantity = '') => safetyRequest('/planning/week/shopping', {
    method: 'POST', data: { weekStart, name, quantity }
  }),
  updateShopping: (id, checked) => request(`/planning/week/shopping/${encodeURIComponent(id)}`, {
    method: 'PATCH', data: { checked }
  }),
  deleteShopping: id => request(`/planning/week/shopping/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  timeline: (limit = 50) => request(`/timeline?limit=${encodeURIComponent(limit)}`),
  timelinePage: (params = {}) => request(`/timeline?${Object.entries({ ...params, paged: 1 }).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`),
  periods: () => request('/periods'),
  savePeriod: (id, data) => request(`/periods${id ? '/' + encodeURIComponent(id) : ''}`, { method: id ? 'PUT' : 'POST', data }),
  deletePeriod: id => request(`/periods/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  sharePeriods: shareWithPartner => request('/periods/settings', { method: 'PATCH', data: { shareWithPartner } }),
  attachTaskPhotos: (taskId, images, description) => safetyRequest('/resources/albums/task-photos', {
    method: 'POST',
    data: { taskId, images, description }
  }),
  update: (resource, id, data) => safetyRequest(`/resources/${resource}/${encodeURIComponent(id)}`, { method: 'PATCH', data }),
  remove: (resource, id) => request(`/resources/${resource}/${encodeURIComponent(id)}`, { method: 'DELETE' })
};
