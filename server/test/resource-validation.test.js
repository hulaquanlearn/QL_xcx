const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');
const resources = require('../src/routes/resources');
const { pool } = require('../src/db');

const token = 'a'.repeat(43);

test('resource validation rejects empty dishes and impossible calendar dates', () => {
  const helpers = resources._test;
  assert.throws(() => helpers.cleanDishes([], 1), /至少需要一道菜/);
  assert.equal(helpers.isValidDateOnly('2026-02-28'), true);
  assert.equal(helpers.isValidDateOnly('2026-02-30'), false);
  assert.equal(helpers.isValidDateOnly('2026-13-01'), false);
  assert.throws(
    () => helpers.normalizeBody('orders', { menuNames: {} }, 1),
    /菜单来源数据无效/
  );
});

test('invalid create requests return 400 before a database write', async () => {
  const originalQuery = pool.query;
  let writeCount = 0;
  pool.query = async sql => {
    const text = String(sql);
    if (text.includes('FROM sessions s')) {
      return [[{
        id: 1,
        account: 'tester',
        name: '测试账号',
        gender: 'other',
        invite_code: 'ABCDEFGH',
        avatar_key: '',
        couple_id: 9,
        session_id: 7,
        session_wechat_openid: 'openid-for-test',
        session_wechat_seen_at: new Date(),
        partner_id: 2,
        partner_name: '伴侣',
        partner_gender: 'other',
        partner_avatar_key: ''
      }]];
    }
    writeCount += 1;
    throw new Error(`unexpected database query: ${text}`);
  };

  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/couple-space/resources`;
  const request = (path, body) => fetch(`${base}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  try {
    const cases = [
      ['orders', { dishes: [] }],
      ['menus', { name: '空菜单', dishes: [] }],
      ['countdown', { title: '日期缺失' }],
      ['countdown', { title: '无效日期', date: '2026-02-30' }],
      ['tasks', {}]
    ];
    for (const [path, body] of cases) {
      const response = await request(path, body);
      assert.equal(response.status, 400, `${path} should reject ${JSON.stringify(body)}`);
    }
    assert.equal(writeCount, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    pool.query = originalQuery;
  }
});
