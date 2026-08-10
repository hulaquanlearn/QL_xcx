const api = require('./api');
const media = require('./media');

function upload(filePath) {
  return media.compress(filePath, 'avatar')
    .then(media.readBase64)
    .then(data => api.uploadAvatarFile({ data }))
    .catch(error => {
      if (error && error.statusCode === 404) throw new Error('头像同步服务尚未部署');
      throw error;
    });
}

module.exports = {
  upload,
  resolveFiles: media.resolveFiles
};
