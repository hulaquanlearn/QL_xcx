const api = require('./api');
const auth = require('./auth');
const config = require('../config');

const mediaKeyPattern = /^server-media:(\d+):([a-f0-9]{32}\.(?:jpg|png|webp))$/;
const avatarKeyPattern = /^server-avatar:([a-f0-9]{32}\.(?:jpg|png|webp))$/;
const migrationCache = new Map();
const resolvedFileCache = new Map();

function compress(filePath) {
  return new Promise(resolve => {
    wx.compressImage({
      src: filePath,
      quality: 76,
      success: result => resolve(result.tempFilePath || filePath),
      fail: () => resolve(filePath)
    });
  });
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
  return compress(filePath)
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

function resolveCloudFiles(keys, output, scope) {
  if (!keys.length) return Promise.resolve(output);
  return wx.cloud.getTempFileURL({ fileList: keys }).then(result => {
    result.fileList.forEach(item => {
      output[item.fileID] = item.tempFileURL || '';
      if (output[item.fileID]) resolvedFileCache.set(scopedCacheKey(item.fileID, scope), output[item.fileID]);
    });
    return output;
  }).catch(() => {
    keys.forEach(key => { output[key] = ''; });
    return output;
  });
}

function resolveFiles(values) {
  const keys = Array.from(new Set((values || []).filter(Boolean)));
  const scope = auth.getToken() || 'anonymous';
  const output = {};
  const cloudKeys = [];
  const downloads = [];
  keys.forEach(key => {
    const cached = resolvedFileCache.get(scopedCacheKey(key, scope));
    if (cached) {
      output[key] = cached;
      return;
    }
    if (parseMediaKey(key) || parseAvatarKey(key)) {
      downloads.push(downloadStoredFile(key)
        .then(filePath => {
          output[key] = filePath;
          if (filePath) resolvedFileCache.set(scopedCacheKey(key, scope), filePath);
        })
        .catch(() => { output[key] = ''; }));
    } else if (String(key).startsWith('cloud://')) {
      cloudKeys.push(key);
    }
  });
  return Promise.all(downloads).then(() => resolveCloudFiles(cloudKeys, output, scope));
}

function downloadCloudFile(fileID) {
  return wx.cloud.getTempFileURL({ fileList: [fileID] })
    .then(result => {
      const url = result.fileList?.[0]?.tempFileURL;
      if (!url) throw new Error('旧图片无访问权限');
      return new Promise((resolve, reject) => {
        wx.downloadFile({
          url,
          timeout: config.requestTimeout,
          success: response => response.statusCode === 200
            ? resolve(response.tempFilePath)
            : reject(new Error(`旧图片下载失败（${response.statusCode}）`)),
          fail: reject
        });
      });
    });
}

function migrateCloudFile(fileID, purpose) {
  if (!String(fileID || '').startsWith('cloud://')) return Promise.resolve(fileID);
  const cacheKey = `${scopedCacheKey(fileID, auth.getToken() || 'anonymous')}:${purpose}`;
  if (!migrationCache.has(cacheKey)) {
    migrationCache.set(cacheKey, downloadCloudFile(fileID)
      .then(filePath => upload(filePath, purpose))
      .then(result => result.key)
      .catch(error => {
        migrationCache.delete(cacheKey);
        throw error;
      }));
  }
  return migrationCache.get(cacheKey);
}

function remove(key) {
  const parsed = parseMediaKey(key);
  if (!parsed) return Promise.resolve();
  return api.deleteMediaFile(parsed.coupleId, parsed.filename).catch(() => {});
}

module.exports = {
  upload,
  resolveFiles,
  migrateCloudFile,
  remove,
  parseMediaKey,
  parseAvatarKey,
  readBase64,
  compress,
  downloadCloudFile
};
