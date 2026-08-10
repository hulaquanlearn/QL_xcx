const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('a protected 401 clears storage and the global login state before returning to login', async () => {
  const apiPath = path.join(__dirname, '../miniprogram/services/api.js');
  const authPath = path.join(__dirname, '../miniprogram/services/auth.js');
  const previousWx = global.wx;
  const previousGetApp = global.getApp;
  const storage = new Map();
  let globalCleared = false;
  let relaunchedTo = '';

  global.getApp = () => ({ clearLoginStatus() { globalCleared = true; } });
  global.wx = {
    getStorageSync: key => storage.get(key) || '',
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    request: options => options.success({ statusCode: 401, data: { success: false, msg: '登录已过期' } }),
    reLaunch: options => { relaunchedTo = options.url; }
  };

  try {
    delete require.cache[require.resolve(apiPath)];
    delete require.cache[require.resolve(authPath)];
    const auth = require(authPath);
    auth.setSession('test-token', { id: '1' });
    const api = require(apiPath);
    await assert.rejects(api.list('menus'), /登录已过期/);
    assert.equal(auth.getToken(), '');
    assert.equal(globalCleared, true);
    assert.equal(relaunchedTo, '/pages/index/index');
  } finally {
    delete require.cache[require.resolve(apiPath)];
    delete require.cache[require.resolve(authPath)];
    global.wx = previousWx;
    global.getApp = previousGetApp;
  }
});

test('only a confirmed 401 is treated as an expired local session', () => {
  const authPath = path.join(__dirname, '../miniprogram/services/auth.js');
  const previousWx = global.wx;
  global.wx = {
    getStorageSync: () => '',
    removeStorageSync: () => {},
    setStorageSync: () => {}
  };
  try {
    delete require.cache[require.resolve(authPath)];
    const auth = require(authPath);
    assert.equal(auth.isExpiredSessionError({ statusCode: 401 }), true);
    assert.equal(auth.isExpiredSessionError({ statusCode: 503 }), false);
    assert.equal(auth.isExpiredSessionError(new Error('timeout')), false);
  } finally {
    delete require.cache[require.resolve(authPath)];
    global.wx = previousWx;
  }
});
