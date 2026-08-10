const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.WECHAT_APP_ID = 'test-app-id';
process.env.WECHAT_APP_SECRET = 'test-app-secret';
process.env.WECHAT_MESSAGE_TOKEN = 'test-message-token';
process.env.PUBLIC_BASE_URL = 'https://example.test';

const contentSafety = require('../src/content-safety');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

test('content safety obtains a server token and checks text', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/cgi-bin/token')) {
      return jsonResponse({ access_token: 'server-only-token', expires_in: 7200 });
    }
    return jsonResponse({ errcode: 0, errmsg: 'ok' });
  };
  contentSafety.resetTokenCache();
  try {
    await contentSafety.checkText('正常内容', { openid: 'test-openid', scene: 4 });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.method, 'POST');
    const body = JSON.parse(calls[1].options.body);
    assert.deepEqual(body, {
      content: '正常内容',
      version: 2,
      scene: 4,
      openid: 'test-openid'
    });
  } finally {
    global.fetch = originalFetch;
    contentSafety.resetTokenCache();
  }
});

test('content safety rejects risky content with a client-safe error', async () => {
  const originalFetch = global.fetch;
  global.fetch = async url => String(url).includes('/cgi-bin/token')
    ? jsonResponse({ access_token: 'server-only-token', expires_in: 7200 })
    : jsonResponse({ errcode: 0, errmsg: 'ok', result: { suggest: 'risky', label: 20002 } });
  contentSafety.resetTokenCache();
  try {
    await assert.rejects(
      contentSafety.checkText('风险测试内容', { openid: 'test-openid', scene: 4 }),
      error => error?.status === 400 && !String(error.message).includes('20002')
    );
  } finally {
    global.fetch = originalFetch;
    contentSafety.resetTokenCache();
  }
});

test('media safety uses the current asynchronous V2 image interface', async () => {
  const originalFetch = global.fetch;
  let mediaRequest;
  global.fetch = async (url, options = {}) => {
    if (String(url).includes('/cgi-bin/token')) {
      return jsonResponse({ access_token: 'server-only-token', expires_in: 7200 });
    }
    mediaRequest = { url: String(url), options };
    return jsonResponse({ errcode: 0, errmsg: 'ok', trace_id: 'trace-1' });
  };
  contentSafety.resetTokenCache();
  try {
    const traceId = await contentSafety.submitMediaCheck(
      'https://example.test/api/couple-space/content-safety/media/1/token',
      'test-openid',
      1
    );
    assert.equal(traceId, 'trace-1');
    assert.equal(mediaRequest.url.includes('/wxa/media_check_async'), true);
    assert.equal(mediaRequest.url.includes('/wxa/img_sec_check'), false);
    assert.deepEqual(JSON.parse(mediaRequest.options.body), {
      media_url: 'https://example.test/api/couple-space/content-safety/media/1/token',
      media_type: 2,
      version: 2,
      scene: 1,
      openid: 'test-openid'
    });
  } finally {
    global.fetch = originalFetch;
    contentSafety.resetTokenCache();
  }
});

test('message callback signatures are verified without exposing the token', () => {
  const timestamp = '1722120000';
  const nonce = 'nonce';
  const crypto = require('node:crypto');
  const signature = crypto
    .createHash('sha1')
    .update(['test-message-token', timestamp, nonce].sort().join(''))
    .digest('hex');
  assert.equal(contentSafety.verifyMessageSignature(signature, timestamp, nonce), true);
  assert.equal(contentSafety.verifyMessageSignature('0'.repeat(40), timestamp, nonce), false);
});

test('all server-side user-published image and text paths invoke content safety checks', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  const authSource = fs.readFileSync(path.join(__dirname, '../src/routes/auth.js'), 'utf8');
  const profileSource = fs.readFileSync(path.join(__dirname, '../src/routes/profile.js'), 'utf8');
  const resourceSource = fs.readFileSync(path.join(__dirname, '../src/routes/resources.js'), 'utf8');
  const callbackSource = fs.readFileSync(path.join(__dirname, '../src/routes/content-safety.js'), 'utf8');

  assert.equal((appSource.match(/mediaChecks\.beginCheck/g) || []).length, 2);
  assert.equal(authSource.includes("router.post('/wechat/refresh'"), true);
  assert.equal(authSource.includes('UPDATE sessions SET wechat_openid=?,wechat_seen_at=NOW()'), true);
  assert.equal(authSource.includes('该微信身份已绑定其他账号'), false);
  assert.equal(profileSource.includes('openid: req.userRow.wechat_openid'), true);
  assert.ok((resourceSource.match(/await checkText/g) || []).length >= 4);
  assert.equal(appSource.includes('/api/couple-space/content-safety'), true);
  assert.equal(callbackSource.includes("router.post('/callback'"), true);
  assert.equal(callbackSource.includes('assertCallbackSignature(req)'), true);
  assert.equal(callbackSource.includes('回调数据格式必须为JSON'), true);
});
