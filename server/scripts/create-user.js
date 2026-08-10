require('dotenv').config();
const crypto = require('crypto');
const { pool } = require('../src/db');
const { hashPassword } = require('../src/password');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`请在.env中临时填写${name}`);
  return value;
}

function inviteCode() {
  return crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'A').slice(0, 8).toUpperCase();
}

async function uniqueInviteCode() {
  for (let i = 0; i < 10; i += 1) {
    const code = inviteCode();
    const [rows] = await pool.query('SELECT id FROM users WHERE invite_code = ? LIMIT 1', [code]);
    if (!rows.length) return code;
  }
  throw new Error('邀请码生成失败，请重试');
}

async function main() {
  const account = required('CREATE_USER_ACCOUNT').toLowerCase();
  const password = required('CREATE_USER_PASSWORD');
  const name = required('CREATE_USER_NAME');
  const gender = String(process.env.CREATE_USER_GENDER || 'other').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(account)) throw new Error('账号需为3-20位字母、数字或下划线');
  if (password.length < 8) throw new Error('密码至少8位');
  if (password.length > 128) throw new Error('密码不能超过128位');
  if (name.length > 40) throw new Error('昵称不能超过40个字符');
  if (!['male', 'female', 'other'].includes(gender)) throw new Error('性别只能是male、female或other');
  const [existing] = await pool.query('SELECT id FROM users WHERE account = ? LIMIT 1', [account]);
  if (existing.length) throw new Error(`账号${account}已存在，脚本不会覆盖`);
  const passwordHash = await hashPassword(password);
  const code = await uniqueInviteCode();
  await pool.query(
    'INSERT INTO users(account,password_hash,name,gender,invite_code) VALUES(?,?,?,?,?)',
    [account, passwordHash, name, gender, code]
  );
  console.log(`账号${account}创建成功，邀请码：${code}`);
  console.log('请立即从.env删除CREATE_USER_PASSWORD及其他CREATE_USER_*临时配置，并重启服务。');
}

main()
  .catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(() => pool.end());
