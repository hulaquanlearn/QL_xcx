const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relative) {
  return fs.readFileSync(path.join(__dirname, relative), 'utf8');
}

test('asynchronous media checks quarantine files until a signed callback approves them', () => {
  const checks = source('../src/media-checks.js');
  const routes = source('../src/routes/content-safety.js');

  assert.equal(checks.includes("status='pending'"), true);
  assert.equal(checks.includes("status='approved'"), true);
  assert.equal(checks.includes('submitMediaCheck'), true);
  assert.equal(routes.includes('verifyMessageSignature'), true);
  assert.equal(routes.includes("send('success')"), true);
});

test('the current V2 content interfaces replace the retired synchronous image API', () => {
  const safety = source('../src/content-safety.js');

  assert.equal(safety.includes('/wxa/msg_sec_check'), true);
  assert.equal(safety.includes('/wxa/media_check_async'), true);
  assert.equal(safety.includes('/wxa/img_sec_check'), false);
  assert.equal(safety.includes('version: 2'), true);
  assert.equal(safety.includes('openid'), true);
});

test('the V2.5 migration adds WeChat identity fields and durable media review tasks', () => {
  const migration = source('../sql/migrate-v2.5.0.sql');

  assert.equal(migration.includes('wechat_openid'), true);
  assert.equal(migration.includes('wechat_seen_at'), true);
  assert.equal(migration.includes('CREATE TABLE IF NOT EXISTS media_checks'), true);
  assert.equal(migration.includes('uq_media_checks_trace'), true);
});

test('finished checks clean abandoned files and older avatar callbacks cannot overwrite newer uploads', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/media-checks.js'), 'utf8');
  assert.equal(source.includes('await cleanupFinishedChecks()'), true);
  assert.equal(source.includes("checked_at<=DATE_SUB(NOW(),INTERVAL 24 HOUR)"), true);
  assert.equal(source.includes("WHERE user_id=? AND purpose='avatar' ORDER BY id DESC LIMIT 1"), true);
  assert.equal(source.includes("await closeCheck(row, 'expired')"), true);
  assert.equal(source.includes('startCleanupScheduler'), true);
  assert.equal(source.includes("status IN ('rejected','failed','expired')"), true);
});

test('media cleanup scheduler runs without waiting for another upload', async () => {
  const { pool } = require('../src/db');
  const checks = require('../src/media-checks');
  const originalQuery = pool.query;
  const statements = [];
  pool.query = async sql => {
    statements.push(String(sql));
    return String(sql).trim().startsWith('SELECT') ? [[]] : [{ affectedRows: 0 }];
  };
  try {
    checks.startCleanupScheduler(60_000);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(statements.some(sql => sql.includes("status='pending'")), true);
    assert.equal(statements.some(sql => sql.includes("status='approved'")), true);
    assert.equal(statements.some(sql => sql.includes("status IN ('rejected','failed','expired')")), true);
  } finally {
    checks.stopCleanupScheduler();
    pool.query = originalQuery;
  }
});
