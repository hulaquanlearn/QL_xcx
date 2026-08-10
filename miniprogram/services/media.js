const api = require('./api');
const auth = require('./auth');
const config = require('../config');

const mediaKeyPattern = /^server-media:(\d+):([a-f0-9]{32}\.(?:jpg|png|webp))$/;
const avatarKeyPattern = /^server-avatar:([a-f0-9]{32}\.(?:jpg|png|webp))$/;
const resolvedFileCache = new Map();
const downloadPromiseCache = new Map();
const MAX_CACHE_ENTRIES = 240;
const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;
const compressionProfiles = {
  avatar: {
    targetBytes: 420 * 1024,
    attempts: [
      { quality: 84, maxEdge: 1200 },
      { quality: 76, maxEdge: 960 },
      { quality: 68, maxEdge: 800 }
    ]
  },
  dish: {
    targetBytes: 720 * 1024,
    attempts: [
      { quality: 86, maxEdge: 1600 },
      { quality: 78, maxEdge: 1400 },
      { quality: 70, maxEdge: 1200 }
    ]
  },
  recipe: {
    targetBytes: 1.2 * 1024 * 1024,
    attempts: [
      { quality: 88, maxEdge: 2400 },
      { quality: 82, maxEdge: 2100 },
      { quality: 76, maxEdge: 1800 }
    ]
  },
  album: {
    targetBytes: 1.6 * 1024 * 1024,
    attempts: [
      { quality: 88, maxEdge: 2560 },
      { quality: 82, maxEdge: 2200 },
      { quality: 76, maxEdge: 1920 }
    ]
  }
};

function imageInfo(filePath) {
  return new Promise(resolve => {
    wx.getImageInfo({
      src: filePath,
      success: result => resolve({
        width: Number(result.width) || 0,
        height: Number(result.height) || 0
      }),
      fail: () => resolve({ width: 0, height: 0 })
    });
  });
}

function scaledSize(info, maxEdge) {
  if (!info.width || !info.height) return null;
  const scale = Math.min(1, maxEdge / Math.max(info.width, info.height));
  return {
    width: Math.max(1, Math.round(info.width * scale)),
    height: Math.max(1, Math.round(info.height * scale))
  };
}

function compressOnce(filePath, quality, maxEdge) {
  return imageInfo(filePath).then(info => {
    const size = scaledSize(info, maxEdge);
    return new Promise(resolve => {
      const options = {
        src: filePath,
        quality,
        success: result => resolve(result.tempFilePath || filePath),
        fail: () => resolve(filePath)
      };
      // Omitting both dimensions lets WeChat preserve the original ratio when
      // image metadata is temporarily unavailable.
      if (size) {
        options.compressedWidth = size.width;
        options.compressedHeight = size.height;
      }
      wx.compressImage(options);
    });
  });
}

function fileSize(filePath) {
  return new Promise(resolve => {
    wx.getFileInfo({
      filePath,
      success: result => resolve(Number(result.size) || 0),
      fail: () => resolve(0)
    });
  });
}

async function compress(filePath, purpose = 'album') {
  const profile = compressionProfiles[purpose] || compressionProfiles.album;
  const originalSize = await fileSize(filePath);
  if (originalSize && originalSize <= profile.targetBytes) return filePath;

  let bestPath = filePath;
  let bestSize = originalSize || Number.POSITIVE_INFINITY;
  for (const attempt of profile.attempts) {
    // 每次都从原图压缩，避免连续有损压缩造成明显糊化。
    const candidate = await compressOnce(filePath, attempt.quality, attempt.maxEdge);
    const size = await fileSize(candidate);
    if (size && size < bestSize) {
      bestPath = candidate;
      bestSize = size;
    }
    if (size && size <= profile.targetBytes) return candidate;
  }
  if (bestSize <= MAX_UPLOAD_BYTES) return bestPath;
  throw new Error('图片处理后仍超过3.5MB，请选择尺寸更小的图片');
}

function readBase64(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: result => resolve(result.data),
      fail: reject
    });
  });
}

function upload(filePath, purpose) {
  return compress(filePath, purpose)
    .then(readBase64)
    .then(data => api.uploadMediaFile({ purpose, data }));
}

function parseMediaKey(value) {
  const match = String(value || '').match(mediaKeyPattern);
  return match ? { coupleId: match[1], filename: match[2] } : null;
}

function parseAvatarKey(value) {
  const match = String(value || '').match(avatarKeyPattern);
  return match ? { filename: match[1] } : null;
}

function downloadAuthenticated(url) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      header: { Authorization: `Bearer ${auth.getToken()}` },
      timeout: config.requestTimeout,
      success: result => result.statusCode === 200
        ? resolve(result.tempFilePath)
        : reject(new Error(`图片下载失败（${result.statusCode}）`)),
      fail: reject
    });
  });
}

function downloadStoredFile(key) {
  const media = parseMediaKey(key);
  if (media) {
    return downloadAuthenticated(
      `${config.apiBaseUrl}/media/file/${encodeURIComponent(media.coupleId)}/${encodeURIComponent(media.filename)}`
    );
  }
  const avatar = parseAvatarKey(key);
  if (avatar) {
    return downloadAuthenticated(
      `${config.apiBaseUrl}/avatars/file/${encodeURIComponent(avatar.filename)}`
    );
  }
  return Promise.resolve('');
}

function scopedCacheKey(key, scope) {
  return `${scope || 'anonymous'}:${key}`;
}

function cacheResolved(key, value) {
  resolvedFileCache.set(key, value);
  while (resolvedFileCache.size > MAX_CACHE_ENTRIES) {
    resolvedFileCache.delete(resolvedFileCache.keys().next().value);
  }
}

function resolveStoredFile(key, scope) {
  const cacheKey = scopedCacheKey(key, scope);
  const cached = resolvedFileCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);
  if (downloadPromiseCache.has(cacheKey)) return downloadPromiseCache.get(cacheKey);

  const promise = downloadStoredFile(key)
    .then(filePath => {
      if (filePath) cacheResolved(cacheKey, filePath);
      return filePath;
    })
    .finally(() => downloadPromiseCache.delete(cacheKey));
  downloadPromiseCache.set(cacheKey, promise);
  return promise;
}

function resolveFiles(values) {
  const keys = Array.from(new Set((values || []).filter(Boolean)));
  const scope = auth.getToken() || 'anonymous';
  const output = {};
  const downloads = [];
  keys.forEach(key => {
    if (parseMediaKey(key) || parseAvatarKey(key)) {
      downloads.push(resolveStoredFile(key, scope)
        .then(filePath => { output[key] = filePath; })
        .catch(() => { output[key] = ''; }));
    } else {
      output[key] = '';
    }
  });
  return Promise.all(downloads).then(() => output);
}

function remove(key) {
  const parsed = parseMediaKey(key);
  if (!parsed) return Promise.resolve();
  return api.deleteMediaFile(parsed.coupleId, parsed.filename).catch(() => {});
}

function clearCaches() {
  resolvedFileCache.clear();
  downloadPromiseCache.clear();
}

module.exports = {
  upload,
  resolveFiles,
  remove,
  parseMediaKey,
  parseAvatarKey,
  readBase64,
  compress,
  clearCaches
};
