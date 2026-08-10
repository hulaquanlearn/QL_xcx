const crypto = require('node:crypto');
const { ApiError } = require('./utils');
const config = require('./config');

const TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token';
const CODE_SESSION_URL = 'https://api.weixin.qq.com/sns/jscode2session';
const TEXT_CHECK_URL = 'https://api.weixin.qq.com/wxa/msg_sec_check';
const MEDIA_CHECK_URL = 'https://api.weixin.qq.com/wxa/media_check_async';
const TOKEN_RETRY_CODES = new Set([40001, 40014, 42001]);
const IDENTITY_CODES = new Set([40003, 40029, 43104, 61010]);
const RISK_CODE = 87014;
const MAX_TEXT_LENGTH = 2500;
const MAX_MEDIA_CHECK_BYTES = 4 * 1024 * 1024;

let cachedToken = '';
let tokenExpiresAt = 0;

function isConfigured() {
  return Boolean(config.wechat.appId && config.wechat.appSecret);
}

function isMediaConfigured() {
  return Boolean(isConfigured() && config.wechat.publicBaseUrl && config.wechat.messageToken);
}

function assertConfigured() {
  if (!isConfigured()) {
    throw new ApiError(503, '内容安全检测暂不可用，请稍后重试');
  }
}

function assertOpenid(openid) {
  const value = String(openid || '').trim();
  if (!value) throw new ApiError(409, '请重新打开小程序后再试');
  return value;
}

function unavailableError(code = 0) {
  const numericCode = Number(code || 0);
  const error = IDENTITY_CODES.has(numericCode)
    ? new ApiError(409, '微信身份已过期，请重新打开小程序后再试')
    : new ApiError(503, '内容安全检测暂不可用，请稍后重试');
  if (numericCode) error.wechatCode = numericCode;
  return error;
}

async function parseWechatResponse(response) {
  let result;
  try {
    result = await response.json();
  } catch {
    throw unavailableError();
  }
  return result || {};
}

async function getAccessToken(forceRefresh = false) {
  assertConfigured();
  if (!forceRefresh && cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const query = new URLSearchParams({
    grant_type: 'client_credential',
    appid: config.wechat.appId,
    secret: config.wechat.appSecret
  });
  let response;
  try {
    response = await fetch(`${TOKEN_URL}?${query.toString()}`, {
      method: 'GET',
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    throw unavailableError();
  }
  const result = await parseWechatResponse(response);
  if (!response.ok || !result.access_token) throw unavailableError(result.errcode);
  cachedToken = result.access_token;
  tokenExpiresAt = Date.now() + Math.max(60, Number(result.expires_in || 7200) - 300) * 1000;
  return cachedToken;
}

function inspectCheckResult(result) {
  const code = Number(result.errcode || 0);
  const suggestion = String(result.result?.suggest || '').toLowerCase();
  if (code === RISK_CODE || suggestion === 'risky' || suggestion === 'review') {
    throw new ApiError(400, '内容包含违规信息，请修改后重试');
  }
  if (code !== 0) throw unavailableError(code);
}

async function callWithToken(requestFactory, retried = false) {
  const token = await getAccessToken(retried);
  let response;
  try {
    response = await requestFactory(token);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unavailableError();
  }
  const result = await parseWechatResponse(response);
  const code = Number(result.errcode || 0);
  if (!retried && TOKEN_RETRY_CODES.has(code)) {
    resetTokenCache();
    return callWithToken(requestFactory, true);
  }
  if (!response.ok && code === 0) throw unavailableError();
  inspectCheckResult(result);
  return result;
}

async function exchangeLoginCode(code) {
  assertConfigured();
  const value = String(code || '').trim();
  if (!value) throw new ApiError(400, '微信登录凭证不能为空');
  const query = new URLSearchParams({
    appid: config.wechat.appId,
    secret: config.wechat.appSecret,
    js_code: value,
    grant_type: 'authorization_code'
  });
  let response;
  try {
    response = await fetch(`${CODE_SESSION_URL}?${query.toString()}`, {
      method: 'GET',
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    throw unavailableError();
  }
  const result = await parseWechatResponse(response);
  if (!response.ok || result.errcode || !result.openid) throw unavailableError(result.errcode);
  return { openid: String(result.openid), unionid: String(result.unionid || '') };
}

async function checkText(content, options = {}) {
  const value = String(content || '').trim();
  if (!value) return;
  if (value.length > MAX_TEXT_LENGTH) {
    for (let offset = 0; offset < value.length; offset += MAX_TEXT_LENGTH) {
      await checkText(value.slice(offset, offset + MAX_TEXT_LENGTH), options);
    }
    return;
  }
  const openid = assertOpenid(options.openid);
  const scene = Number(options.scene || 4);
  if (![1, 2, 3, 4].includes(scene)) throw new ApiError(400, '内容安全场景无效');
  const body = { content: value, version: 2, scene, openid };
  for (const key of ['title', 'nickname', 'signature']) {
    const optional = String(options[key] || '').trim();
    if (optional) body[key] = optional;
  }
  await callWithToken(token => fetch(`${TEXT_CHECK_URL}?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  }));
}

async function submitMediaCheck(mediaUrl, openid, scene = 4) {
  if (!isMediaConfigured()) throw unavailableError();
  const url = String(mediaUrl || '').trim();
  if (!/^https:\/\//i.test(url)) throw new ApiError(500, '媒体检测地址配置无效');
  const result = await callWithToken(token => fetch(
    `${MEDIA_CHECK_URL}?access_token=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_url: url,
        media_type: 2,
        version: 2,
        scene: Number(scene || 4),
        openid: assertOpenid(openid)
      }),
      signal: AbortSignal.timeout(15000)
    }
  ));
  if (!result.trace_id) throw unavailableError();
  return String(result.trace_id);
}

function verifyMessageSignature(signature, timestamp, nonce) {
  if (!config.wechat.messageToken) return false;
  const expected = crypto
    .createHash('sha1')
    .update([config.wechat.messageToken, String(timestamp || ''), String(nonce || '')].sort().join(''))
    .digest('hex');
  const actual = String(signature || '').toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(actual)) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

function resetTokenCache() {
  cachedToken = '';
  tokenExpiresAt = 0;
}

module.exports = {
  isConfigured,
  isMediaConfigured,
  exchangeLoginCode,
  checkText,
  submitMediaCheck,
  verifyMessageSignature,
  resetTokenCache,
  MAX_TEXT_LENGTH,
  MAX_MEDIA_CHECK_BYTES
};
