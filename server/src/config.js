require('dotenv').config();
const number = (name, fallback) => Number.isFinite(Number(process.env[name])) ? Number(process.env[name]) : fallback;
module.exports = {
  host: process.env.HOST || '127.0.0.1',
  port: number('PORT', 3001),
  sessionDays: number('SESSION_DAYS', 30),
  mysql: { host: process.env.DB_HOST || '127.0.0.1', port: number('DB_PORT', 3306), user: process.env.DB_USER || 'couple_space', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'couple_space', connectionLimit: 10, charset: 'utf8mb4', dateStrings: true }
};
