const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../src/db');
// All tests below exercise real Express routes against an in-memory database
// adapter. Never call production WeChat moderation or MySQL from these tests.
require('../src/content-safety').checkText = async () => {};
const app = require('../src/app');
const shopping = require('../src/services/shopping-plan');
const { listOptions, albumSelection, monthRange } = require('../src/services/resource-list');
const timeline = require('../src/routes/timeline')._test;

async function withHttp(query, connection, work, user = () => ({ id: 1, name: '甲', couple_id: 9 })) {
  const originalQuery = pool.query;
  const originalConnection = pool.getConnection;
  pool.query = async (sql, params) => sql.includes('FROM sessions s') ? [[{ ...user(), session_id: 3 }]] : query(sql, params);
  pool.getConnection = async () => connection;
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const request = (suffix, method = 'GET', body) => fetch(`http://127.0.0.1:${server.address().port}/api/couple-space${suffix}`, {
    method,
    headers: { Authorization: `Bearer ${'a'.repeat(43)}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  try { await work(request); } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    pool.query = originalQuery;
    pool.getConnection = originalConnection;
  }
}

test('order edit and deletion cannot cross a concurrent acceptance', async () => {
  let status = 'pending';
  let deleted = false;
  let updated = false;
  await withHttp(async (sql, params) => {
    if (sql.startsWith('SELECT * FROM orders')) {
      const snapshot = { id: 5, author_id: 1, status, dishes: '[]' };
      status = 'accepted'; // partner accepts after validation but before mutation
      return [[snapshot]];
    }
    if (sql.startsWith('UPDATE orders')) {
      assert.match(sql, /author_id=\? AND status='pending'/);
      assert.equal(params.at(-1), 1);
      updated = status === 'pending';
      return [{ affectedRows: Number(updated) }];
    }
    if (sql.startsWith('DELETE FROM orders')) {
      assert.match(sql, /author_id=\? AND status IN \('pending','completed'\)/);
      assert.equal(params.at(-1), 1);
      deleted = ['pending', 'completed'].includes(status);
      return [{ affectedRows: Number(deleted) }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }, null, async request => {
    assert.equal((await request('/resources/orders/5', 'PATCH', { note: '少盐' })).status, 409);
    status = 'pending';
    assert.equal((await request('/resources/orders/5', 'DELETE')).status, 409);
    assert.equal(updated, false);
    assert.equal(deleted, false);
  });
});

test('task completion records server time once, clears on reopening, and rejects forged timestamps', async () => {
  let status = 'pending';
  let completedAt = null;
  let clock = 0;
  await withHttp(async (sql, params) => {
    if (sql.startsWith('SELECT * FROM tasks')) return [[{ id: 5, author_id: 1, status, completed_at: completedAt }]];
    if (sql.startsWith('UPDATE tasks')) {
      if (params[0] === 'completed') {
        assert.match(sql, /SET completed_at=IF\(status='completed',completed_at,CURRENT_TIMESTAMP\),status=\?/);
        if (status !== 'completed') completedAt = ++clock;
      } else {
        assert.match(sql, /SET completed_at=NULL,status=\?/);
        completedAt = null;
      }
      assert.deepEqual(params.slice(1), ['5', 9]);
      status = params[0];
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }, null, async request => {
    assert.equal((await request('/resources/tasks/5', 'PATCH', { completed: true, completedAt: '1999-01-01' })).status, 200);
    assert.equal(completedAt, 1);
    assert.equal((await request('/resources/tasks/5', 'PATCH', { completed: true })).status, 200);
    assert.equal(completedAt, 1);
    assert.equal((await request('/resources/tasks/5', 'PATCH', { completed: false })).status, 200);
    assert.equal(completedAt, null);
    assert.equal((await request('/resources/tasks/5', 'PATCH', { completed: true })).status, 200);
    assert.equal(completedAt, 2);
    assert.equal((await request('/resources/tasks/5', 'PATCH', { completedAt: '1999-01-01' })).status, 400);
    assert.equal((await request('/resources/tasks/5', 'PATCH', { completed: 'false' })).status, 400);
    assert.equal((await request('/resources/tasks/5', 'PATCH', { completed: true, status: 'pending' })).status, 400);
  });
});

test('shopping regeneration preserves checked items and manual entries and only merges the plan delta', async () => {
  let rows = [
    { id: 1, name: '鸡蛋 2个', quantity: '已买一盒', checked: 1, source: 'plan' },
    { id: 2, name: '旧食材', quantity: '', checked: 0, source: 'plan' },
    { id: 3, name: '牛奶', quantity: '一瓶', checked: 1, source: 'manual' }
  ];
  const connection = { async query(sql, params) {
    if (sql.startsWith('SELECT')) { assert.match(sql, /source='plan' FOR UPDATE/); assert.deepEqual(params, [9, '2026-08-31']); return [rows.filter(row => row.source === 'plan')]; }
    if (sql.startsWith('DELETE')) { assert.match(sql, /id=\? AND couple_id=\? AND source='plan'/); rows = rows.filter(row => row.id !== params[0]); return [{ affectedRows: 1 }]; }
    if (sql.startsWith('INSERT')) { rows.push({ id: 4, name: params[3], checked: 0, quantity: '', source: 'plan' }); return [{ insertId: 4 }]; }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const wanted = [{ name: '鸡蛋 2个' }, { name: '番茄 2个' }];
  assert.deepEqual(await shopping.mergeShoppingPlan(connection, 9, 1, '2026-08-31', wanted), { count: 2, added: 1, removed: 1, preserved: 1 });
  assert.deepEqual(rows.find(row => row.id === 1), { id: 1, name: '鸡蛋 2个', quantity: '已买一盒', checked: 1, source: 'plan' });
  assert.equal(rows.find(row => row.id === 3).checked, 1);
  assert.deepEqual(await shopping.mergeShoppingPlan(connection, 9, 1, '2026-08-31', wanted), { count: 2, added: 0, removed: 0, preserved: 2 });
});

test('shopping ingredients expose deduplicated current recipe sources without guessing quantities', () => {
  const menu = { id: 2, name: '家常菜', dishes: [{ id: 7, name: '炒蛋', ingredients: '鸡蛋 2个、盐 少许' }] };
  const other = { id: 3, name: '早餐', dishes: [{ id: 8, name: '煎蛋', ingredients: '鸡蛋 2个' }] };
  const items = shopping.buildIngredientItems([menu, menu, other]);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].sources, [
    { menuId: '2', menuName: '家常菜', dishId: '7', dishName: '炒蛋' },
    { menuId: '3', menuName: '早餐', dishId: '8', dishName: '煎蛋' }
  ]);
  assert.equal(items[0].name, '鸡蛋 2个');
});

test('resource pagination validates cursors, status, month and private favorites within a couple', () => {
  const album = listOptions('album', { paged: '1', cursor: '11', month: '2026-12', favoriteOnly: '1', taskIds: '2,3' }, 9, 1);
  assert.equal(album.paged, true);
  assert.deepEqual(album.params, [9, '11', '2', '3', '2026-12-01', '2027-01-01', 1]);
  assert.match(album.conditions.join(' '), /r.couple_id=\?.*r.id<\?.*favorite_filter.user_id=\?/);
  assert.deepEqual(albumSelection(1).params, [1]);
  assert.equal(listOptions('orders', { paged: '1', status: 'ready' }, 9, 1).params.at(-1), 'ready');
  assert.throws(() => listOptions('tasks', { status: 'ready' }, 9, 1), /状态/);
  assert.throws(() => listOptions('album', { paged: '1', cursor: '1 OR 1=1' }, 9, 1), /游标/);
  assert.throws(() => monthRange('2026-13'), /月份/);
  assert.throws(() => listOptions('album', { taskIds: '2,a' }, 9, 1), /关联清单/);
});

test('favorite writes are private, idempotent and reject photos outside the current couple', async () => {
  let userId = 1;
  let commits = 0;
  let rollbacks = 0;
  const saved = new Set();
  const connection = {
    async beginTransaction() {}, async commit() { commits++; }, async rollback() { rollbacks++; }, release() {},
    async query(sql, params) {
      if (sql.startsWith('SELECT id FROM albums')) { assert.deepEqual(params.slice(1), [9]); assert.match(sql, /FOR UPDATE/); return [params[0] === '5' ? [{ id: 5 }] : []]; }
      if (sql.startsWith('INSERT INTO album_favorites')) { saved.add(params.join(':')); return [{ affectedRows: 1 }]; }
      if (sql.startsWith('DELETE FROM album_favorites')) { saved.delete(params.join(':')); return [{ affectedRows: 1 }]; }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  await withHttp(async () => { throw new Error('Unexpected direct query'); }, connection, async request => {
    assert.equal((await request('/resources/albums/5/favorite', 'PATCH', { favorite: true, userId: 2 })).status, 200);
    assert.equal((await request('/resources/albums/5/favorite', 'PATCH', { favorite: true })).status, 200);
    assert.deepEqual([...saved], ['5:1']);
    userId = 2;
    assert.equal((await request('/resources/albums/5/favorite', 'PATCH', { favorite: false })).status, 200);
    assert.deepEqual([...saved], ['5:1']);
    assert.equal((await request('/resources/albums/999/favorite', 'PATCH', { favorite: true })).status, 404);
    assert.equal(commits, 3);
    assert.equal(rollbacks, 1);
  }, () => ({ id: userId, couple_id: 9 }));
});

test('album save retries reuse the existing row for the same uploader media key', async () => {
  const key = `server-media:9:${'a'.repeat(32)}.jpg`;
  let created = 0;
  let lockHeld = false;
  const saved = new Map();
  const connection = {
    async beginTransaction() { lockHeld = false; }, async commit() {}, async rollback() {}, release() {},
    async query(sql, params) {
      if (sql.startsWith('SELECT id FROM users')) { assert.match(sql, /FOR UPDATE/); lockHeld = true; return [[{ id: 1 }]]; }
      if (sql.startsWith('SELECT id FROM albums')) { assert.equal(lockHeld, true); assert.deepEqual(params.slice(0, 3), [9, 1, key]); return [saved.has(params[3]) ? [{ id: saved.get(params[3]) }] : []]; }
      if (sql.startsWith('INSERT INTO albums')) { const id = 20 + created++; saved.set(params[2], id); return [{ insertId: id }]; }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  await withHttp(async (sql, params) => {
    if (sql.startsWith('SELECT id,title FROM tasks')) { assert.deepEqual(params, [48, 9]); return [[{ id: 48, title: '旅行' }]]; }
    throw new Error('Unexpected direct query');
  }, connection, async request => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await request('/resources/albums/batch', 'POST', { images: [key] });
      assert.equal(response.status, 201);
      assert.deepEqual((await response.json()).data.ids, ['20']);
    }
    assert.equal(created, 1);
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await request('/resources/albums/task-photos', 'POST', { taskId: 48, images: [key] });
      assert.equal(response.status, 201);
      assert.deepEqual((await response.json()).data.ids, ['21']);
    }
    assert.equal(created, 2);
  });
});

test('paged resource HTTP returns global task counts and keeps album month and favorite filters private', async () => {
  await withHttp(async (sql, params) => {
    if (sql.includes('FROM tasks r')) {
      assert.match(sql, /task_photo.couple_id=r.couple_id/);
      assert.deepEqual(params, [9, 'pending', 2]);
      return [[8, 7].map(id => ({ id, couple_id: 9, author_id: 1, status: 'pending', photo_count: 12 }))];
    }
    if (sql.startsWith('SELECT status,COUNT(*)')) return [[{ status: 'pending', count: 4 }, { status: 'completed', count: 6 }]];
    if (sql.startsWith('SELECT r.*')) {
      assert.deepEqual(params, [1, 9, '2026-09-01', '2026-10-01', 1, 2]);
      return [[{ id: 5, couple_id: 9, author_id: 2, is_favorite: 1 }]];
    }
    if (sql.startsWith('SELECT DATE_FORMAT')) {
      assert.deepEqual(params, [9, '8', 1]);
      return [[{ month: '2026-09', count: 3 }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }, null, async request => {
    const tasks = await (await request('/resources/tasks?paged=1&limit=1&status=pending')).json();
    assert.deepEqual(tasks.data.counts, { all: 10, pending: 4, completed: 6 });
    assert.equal(tasks.data.items[0].photoCount, 12);
    assert.equal(tasks.data.nextCursor, '8');
    assert.equal(tasks.data.hasMore, true);
    const photos = await (await request('/resources/album?paged=1&limit=1&month=2026-09&favoriteOnly=1&userId=2')).json();
    assert.equal(photos.data.items[0].favorite, true);
    const months = await (await request('/resources/albums/months?favoriteOnly=1&taskIds=8')).json();
    assert.deepEqual(months.data, [{ month: '2026-09', count: 3 }]);
  });
});

test('timeline uses a composite cursor and preserves timestamp ties with legacy completion labels', async () => {
  const cursor = timeline.encodeCursor({ event_at: '2026-09-05 12:00:00', event_type: 'task', event_id: 9 });
  assert.deepEqual(timeline.decodeCursor(cursor), { at: '2026-09-05 12:00:00', type: 'task', id: '9' });
  assert.throws(() => timeline.decodeCursor('invalid'), /游标/);
  await withHttp(async (sql, params) => {
    if (sql.startsWith('SELECT event_type')) {
      assert.match(sql, /event_at=\? AND event_type=\? AND event_id<\?/);
      assert.deepEqual(params, [9, 9, 9, '2026-09-05 12:00:00', '2026-09-05 12:00:00', 'task', '2026-09-05 12:00:00', 'task', '9', 2]);
      return [[{ event_type: 'task', event_id: 8, event_at: '2026-09-05 12:00:00' }, { event_type: 'order', event_id: 10, event_at: '2026-09-05 12:00:00' }]];
    }
    if (sql.includes('FROM tasks t')) return [[{ id: 8, title: '旅行', description: '', author_name: '甲', completed_at: null }]];
    if (sql.startsWith('SELECT task_id,image_url')) return [[{ task_id: 8, image_url: 'photo' }]];
    throw new Error(`Unexpected SQL: ${sql}`);
  }, null, async request => {
    const response = await request(`/timeline?paged=1&limit=1&cursor=${cursor}`);
    assert.equal(response.status, 200);
    const data = (await response.json()).data;
    assert.equal(data.hasMore, true);
    assert.equal(data.items[0].id, 'task:8');
    assert.equal(data.items[0].timeEstimated, true);
    assert.equal(timeline.decodeCursor(data.nextCursor).id, '8');
  });
});

test('v2.11 favorites migration is additive and preserves existing completion dates', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../sql/migrate-v2.11.0.sql'), 'utf8');
  const schema = fs.readFileSync(path.join(__dirname, '../sql/schema.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS album_favorites/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS album_favorites/);
  assert.match(migration, /PRIMARY KEY \(album_id,user_id\)/);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|UPDATE)\b/);
});
