require('dotenv').config();
const path = require('node:path');
const number = (name, fallback) => Number.isFinite(Number(process.env[name])) ? Number(process.env[name]) : fallback;
module.exports = {
  host: process.env.HOST || '127.0.0.1',
  port: number('PORT', 3001),
  sessionDays: number('SESSION_DAYS', 30),
  avatarDir: process.env.AVATAR_DIR || (process.platform === 'win32'
    ? path.join(process.cwd(), 'data', 'avatars')
    : '/opt/couple-space/data/avatars'),
  mediaDir: process.env.MEDIA_DIR || (process.platform === 'win32'
    ? path.join(process.cwd(), 'data', 'media')
    : '/opt/couple-space/data/media'),
  wechat: {
    appId: String(process.env.WECHAT_APP_ID || '').trim(),
    appSecret: String(process.env.WECHAT_APP_SECRET || '').trim(),
    messageToken: String(process.env.WECHAT_MESSAGE_TOKEN || '').trim(),
    publicBaseUrl: String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')
  },
  pendingMediaDir: process.env.PENDING_MEDIA_DIR || (process.platform === 'win32'
    ? path.join(process.cwd(), 'data', 'pending-media')
    : '/opt/couple-space/data/pending-media'),
  mysql: { host: process.env.DB_HOST || '127.0.0.1', port: number('DB_PORT', 3306), user: process.env.DB_USER || 'couple_space', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'couple_space', connectionLimit: 10, charset: 'utf8mb4', dateStrings: true }
};
