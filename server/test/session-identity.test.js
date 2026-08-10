const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relative) {
  return fs.readFileSync(path.join(__dirname, relative), 'utf8');
}

test('WeChat identity is scoped to a login session and can be shared by local accounts', async () => {
  const auth = source('../src/auth.js');
  const authRoutes = source('../src/routes/auth.js');
  const schema = source('../sql/schema.sql');
  const migration = source('../sql/migrate-v2.5.1.sql');

  assert.equal(auth.includes('INSERT INTO sessions(user_id,token_hash,wechat_openid,wechat_seen_at,expires_at)'), true);
  assert.equal(auth.includes('s.wechat_openid session_wechat_openid'), true);
  assert.equal(auth.includes('recentSessionIdentity(userId)'), true);
  assert.equal(authRoutes.includes('UPDATE sessions SET wechat_openid=?,wechat_seen_at=NOW()'), true);
  assert.equal(authRoutes.includes('UPDATE users SET wechat_openid'), false);
  assert.equal(authRoutes.includes('该微信身份已绑定其他账号'), false);

  assert.equal(schema.includes('INDEX idx_sessions_wechat_seen (user_id,wechat_seen_at)'), true);
  assert.equal(schema.includes('UNIQUE KEY uq_users_wechat_openid'), false);
  assert.equal(migration.includes('ALTER TABLE users DROP INDEX uq_users_wechat_openid'), true);
  assert.equal(migration.includes('UPDATE sessions s'), true);

  const { pool } = require('../src/db');
  const { createSession } = require('../src/auth');
  const originalQuery = pool.query;
  const inserts = [];
  pool.query = async (sql, parameters) => {
    assert.equal(sql.includes('INSERT INTO sessions'), true);
    inserts.push(parameters);
    return [{ insertId: inserts.length }];
  };
  try {
    await createSession(101, { openid: 'same-wechat-openid' });
    await createSession(202, { openid: 'same-wechat-openid' });
  } finally {
    pool.query = originalQuery;
  }
  assert.equal(inserts.length, 2);
  assert.equal(inserts[0][0], 101);
  assert.equal(inserts[1][0], 202);
  assert.equal(inserts[0][2], 'same-wechat-openid');
  assert.equal(inserts[1][2], 'same-wechat-openid');
});
