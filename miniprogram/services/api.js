const config = require('../config');
const auth = require('./auth');

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
      if (res.statusCode === 401 && !options.public) auth.clearSession();
      const error = new Error(body.msg || `请求失败（${res.statusCode}）`);
      error.statusCode = res.statusCode;
      reject(error);
    },
    fail(err) { reject(new Error(err.errMsg && err.errMsg.includes('timeout') ? '服务器响应超时' : '无法连接情侣空间服务器')); }
  }));
}

module.exports = {
  login: data => request('/auth/login', { method: 'POST', data, public: true }),
  me: () => request('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST' }),
  dashboard: () => request('/dashboard'),
  profile: data => request('/profile', { method: 'PATCH', data }),
  bindPartner: inviteCode => request('/partner/bind', { method: 'POST', data: { inviteCode } }),
  unbindPartner: () => request('/partner/unbind', { method: 'POST' }),
  getAvatars: () => request('/avatars'),
  updateAvatars: data => request('/avatars', { method: 'PATCH', data }),
  list: (resource, params = {}) => {
    const query = Object.keys(params).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
    return request(`/resources/${resource}${query ? `?${query}` : ''}`);
  },
  get: (resource, id) => request(`/resources/${resource}/${encodeURIComponent(id)}`),
  create: (resource, data) => request(`/resources/${resource}`, { method: 'POST', data }),
  update: (resource, id, data) => request(`/resources/${resource}/${encodeURIComponent(id)}`, { method: 'PATCH', data }),
  remove: (resource, id) => request(`/resources/${resource}/${encodeURIComponent(id)}`, { method: 'DELETE' })
};
