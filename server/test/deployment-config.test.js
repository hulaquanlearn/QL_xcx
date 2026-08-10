const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Nginx accepts the Base64 JSON size used by image uploads', () => {
  const config = fs.readFileSync(
    path.join(__dirname, '../nginx/couple-space.conf.example'),
    'utf8'
  );
  assert.match(config, /location \/api\/couple-space\/ \{[\s\S]*client_max_body_size\s+6m;/);
});

test('v2.8 removes obsolete user identity columns and the legacy avatar table', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../sql/schema.sql'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '../sql/migrate-v2.8.0.sql'), 'utf8');
  const usersTable = schema.match(/CREATE TABLE IF NOT EXISTS users \([\s\S]*?\) ENGINE=InnoDB;/)?.[0] || '';
  assert.equal(usersTable.includes('wechat_openid'), false);
  assert.equal(usersTable.includes('wechat_seen_at'), false);
  assert.equal(schema.includes('CREATE TABLE IF NOT EXISTS avatars'), false);
  assert.equal(migration.includes('DROP COLUMN wechat_openid'), true);
  assert.equal(migration.includes('DROP COLUMN wechat_seen_at'), true);
  assert.equal(migration.includes('DROP TABLE IF EXISTS avatars'), true);
});
