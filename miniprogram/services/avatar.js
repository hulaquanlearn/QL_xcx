const api = require('./api');
const media = require('./media');

function upload(filePath) {
  return media.compress(filePath)
    .then(media.readBase64)
    .then(data => api.uploadAvatarFile({ data }))
    .catch(error => {
      if (error && error.statusCode === 404) throw new Error('头像同步服务尚未部署');
      throw error;
    });
}

function migrateLegacy(key) {
  if (!String(key || '').startsWith('cloud://')) return Promise.resolve(key);
  return media.downloadCloudFile(key).then(upload).then(result => result.key);
}

module.exports = {
  upload,
  migrateLegacy,
  resolveFiles: media.resolveFiles
};
