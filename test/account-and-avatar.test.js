const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('password length is consistent between provisioning, login API and mini-program input', () => {
  const createUser = fs.readFileSync(path.join(__dirname, '../server/scripts/create-user.js'), 'utf8');
  const authRoute = fs.readFileSync(path.join(__dirname, '../server/src/routes/auth.js'), 'utf8');
  const loginTemplate = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/index/index.wxml'), 'utf8');
  assert.equal(createUser.includes('password.length > 128'), true);
  assert.equal(authRoute.includes('password.length > 128'), true);
  assert.match(loginTemplate, /password[\s\S]*maxlength="128"/);
});

test('avatar picker is blocked while an earlier avatar is still uploading', () => {
  const pagePath = path.join(__dirname, '../miniprogram/pages/index/index.js');
  const previousGetApp = global.getApp;
  const previousPage = global.Page;
  const previousWx = global.wx;
  let page;
  let chooseCalls = 0;
  let toast = '';
  global.getApp = () => ({ globalData: {} });
  global.Page = definition => { page = definition; };
  global.wx = {
    chooseImage: () => { chooseCalls += 1; },
    showToast: options => { toast = options.title; }
  };

  try {
    delete require.cache[require.resolve(pagePath)];
    require(pagePath);
    page.uploadAvatar.call({ data: { uploading: true } });
    assert.equal(chooseCalls, 0);
    assert.equal(toast, '头像正在上传，请稍候');
  } finally {
    delete require.cache[require.resolve(pagePath)];
    global.getApp = previousGetApp;
    global.Page = previousPage;
    global.wx = previousWx;
  }
});
