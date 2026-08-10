const TOKEN_KEY = 'couple_space_token';
const USER_KEY = 'couple_space_user';

function getToken() { return wx.getStorageSync(TOKEN_KEY) || ''; }
function getUser() { return wx.getStorageSync(USER_KEY) || null; }
function setSession(token, user) {
  wx.setStorageSync(TOKEN_KEY, token);
  wx.setStorageSync(USER_KEY, user);
}
function clearSession() {
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync(USER_KEY);
  wx.removeStorageSync('loginInfo');
}

function isExpiredSessionError(error) {
  return Number(error && error.statusCode) === 401;
}

module.exports = { getToken, getUser, setSession, clearSession, isExpiredSessionError };
