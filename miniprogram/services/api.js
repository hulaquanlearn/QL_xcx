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

function waitForMediaCheck(checkId, remaining = 120) {
  return request(`/content-safety/check/${encodeURIComponent(checkId)}`).then(result => {
    if (result.status === 'approved' && result.key) return result;
    if (result.status !== 'pending') throw new Error(result.message || '图片未通过内容安全检测');
    if (remaining <= 0) throw new Error('图片仍在审核中，请稍后重试');
    return delay(1500).then(() => waitForMediaCheck(checkId, remaining - 1));
  });
}

function uploadWithReview(path, data) {
  return safetyRequest(path, { method: 'POST', data, timeout: 60000 }).then(result =>
    result.key ? result : waitForMediaCheck(result.checkId)
  );
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
  uploadAvatarFile: data => uploadWithReview('/avatars/file', data),
  uploadMediaFile: data => uploadWithReview('/media/file', data),
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
  attachTaskPhotos: (taskId, images, description) => safetyRequest('/resources/albums/task-photos', {
    method: 'POST',
    data: { taskId, images, description }
  }),
  update: (resource, id, data) => safetyRequest(`/resources/${resource}/${encodeURIComponent(id)}`, { method: 'PATCH', data }),
  remove: (resource, id) => request(`/resources/${resource}/${encodeURIComponent(id)}`, { method: 'DELETE' })
};
