const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { ApiError } = require('./utils');
const { removeThumbnails } = require('./services/media-thumbnails');

const MEDIA_KEY_RE = /^server-media:(\d+):([a-f0-9]{32}\.(?:jpg|png|webp))$/;
const LEGACY_AVATAR_KEY_RE = /^server-avatar:([a-f0-9]{32}\.(?:jpg|png|webp))$/;

function imageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: 'jpg', contentType: 'image/jpeg' };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) {
    return { extension: 'png', contentType: 'image/png' };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') {
    return { extension: 'webp', contentType: 'image/webp' };
  }
  return null;
}

function decodeImage(value, maxBytes = 4 * 1024 * 1024) {
  const encoded = String(value || '');
  if (!encoded || !/^[A-Za-z0-9+/=\r\n]+$/.test(encoded)) {
    throw new ApiError(400, '图片数据无效');
  }
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length || buffer.length > maxBytes) {
    throw new ApiError(413, '图片不能超过4MB');
  }
  const type = imageType(buffer);
  if (!type) throw new ApiError(400, '仅支持 JPG、PNG 或 WebP 图片');
  return { buffer, type };
}

function parseMediaKey(value) {
  const match = String(value || '').match(MEDIA_KEY_RE);
  return match ? { coupleId: match[1], filename: match[2] } : null;
}

function legacyAvatarFilename(value) {
  const match = String(value || '').match(LEGACY_AVATAR_KEY_RE);
  return match ? match[1] : '';
}

function assertMediaKeyForCouple(value, coupleId, { allowEmpty = true } = {}) {
  const key = String(value || '');
  if (!key && allowEmpty) return;
  const parsed = parseMediaKey(key);
  if (parsed) {
    if (parsed.coupleId !== String(coupleId)) throw new ApiError(403, '图片不属于当前情侣空间');
    return;
  }
  if (legacyAvatarFilename(key)) return;
  throw new ApiError(400, '图片地址无效');
}

function collectMediaKeys(value, output = new Set()) {
  if (typeof value === 'string') {
    if (parseMediaKey(value)) output.add(value);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectMediaKeys(item, output));
    return output;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(item => collectMediaKeys(item, output));
  }
  return output;
}

function coupleDirectory(coupleId) {
  return path.join(config.mediaDir, String(coupleId));
}

function mediaPath(coupleId, filename) {
  return path.join(coupleDirectory(coupleId), filename);
}

async function deleteMediaKey(key) {
  const parsed = parseMediaKey(key);
  if (!parsed) return false;
  await fs.promises.unlink(mediaPath(parsed.coupleId, parsed.filename)).catch(() => {});
  await removeThumbnails(parsed.coupleId, parsed.filename);
  return true;
}

async function isMediaReferenced(pool, key) {
  const checks = await Promise.all([
    pool.query('SELECT id FROM users WHERE avatar_key=? LIMIT 1', [key]),
    pool.query('SELECT id FROM albums WHERE image_url=? OR storage_key=? LIMIT 1', [key, key]),
    pool.query('SELECT id FROM dishes WHERE image_key=? OR recipe_image_key=? LIMIT 1', [key, key]),
    pool.query("SELECT id FROM menus WHERE JSON_SEARCH(dishes,'one',?) IS NOT NULL LIMIT 1", [key]),
    pool.query("SELECT id FROM orders WHERE JSON_SEARCH(dishes,'one',?) IS NOT NULL LIMIT 1", [key])
  ]);
  return checks.some(([rows]) => rows.length > 0);
}

async function removeMediaIfUnreferenced(pool, key) {
  if (!parseMediaKey(key)) return false;
  if (await isMediaReferenced(pool, key)) return false;
  return deleteMediaKey(key);
}

async function removeMediaKeysIfUnreferenced(pool, keys) {
  for (const key of new Set(keys || [])) {
    await removeMediaIfUnreferenced(pool, key);
  }
}

module.exports = {
  MEDIA_KEY_RE,
  LEGACY_AVATAR_KEY_RE,
  imageType,
  decodeImage,
  parseMediaKey,
  legacyAvatarFilename,
  assertMediaKeyForCouple,
  collectMediaKeys,
  mediaPath,
  isMediaReferenced,
  removeMediaIfUnreferenced,
  removeMediaKeysIfUnreferenced
};
