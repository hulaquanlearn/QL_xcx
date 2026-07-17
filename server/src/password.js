const crypto = require('crypto');
const scrypt = (value, salt) => new Promise((resolve, reject) => crypto.scrypt(value, salt, 64, (e, key) => e ? reject(e) : resolve(key)));
async function hashPassword(password) { const salt = crypto.randomBytes(16); const key = await scrypt(password, salt); return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`; }
async function verifyPassword(password, stored = '') { const [, saltHex, hashHex] = stored.split(':'); if (!saltHex || !hashHex) return false; const actual = await scrypt(password, Buffer.from(saltHex, 'hex')); return crypto.timingSafeEqual(actual, Buffer.from(hashHex, 'hex')); }
module.exports = { hashPassword, verifyPassword };
