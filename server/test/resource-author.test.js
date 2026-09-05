const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function routeSource(...files) {
  return files.map(file => fs.readFileSync(path.join(__dirname, `../src/routes/${file}`), 'utf8')).join('\n');
}

test('resources are couple scoped and expose the latest creator name', () => {
  const source = routeSource('resources.js', 'resource-orders.js', 'resource-albums.js');
  assert.equal(source.includes('u.name author_name'), true);
  assert.equal(source.includes('authorId: String(row.author_id)'), true);
  assert.equal(source.includes("author: row.author_name || ''"), true);
  assert.equal(source.includes('WHERE r.id=? AND r.couple_id=?'), true);
  assert.equal(source.includes('DELETE FROM ${definitionValue.table} WHERE id=? AND couple_id=?'), true);
});

test('order ownership and state changes are enforced on the server', () => {
  const source = routeSource('resources.js', 'resource-orders.js');
  assert.equal(source.includes("router.post('/orders/:id/accept'"), true);
  assert.equal(source.includes("router.post('/orders/:id/ready'"), true);
  assert.equal(source.includes("router.post('/orders/:id/confirm'"), true);
  assert.equal(source.includes("router.post('/orders/:id/complete'"), true);
  assert.equal(source.includes("author_id<>? AND status='pending'"), true);
  assert.equal(source.includes("accepted_by_user_id=? AND status='accepted'"), true);
  assert.equal(source.includes("author_id=? AND status='ready'"), true);
  assert.equal(source.includes('只有接单人可以标记已做好'), true);
  assert.equal(source.includes('只有下单人可以确认收到'), true);
  assert.equal(source.includes("String(beforeRows[0].author_id) !== String(req.userRow.id)"), true);
  assert.equal(source.includes("['accepted', 'ready'].includes(beforeRows[0].status)"), true);
  assert.equal(source.includes('data.order_by = req.userRow.name'), true);
  assert.equal(source.includes("changedContent && beforeRows[0].status !== 'pending'"), true);
  assert.equal(source.includes('点单已被接收，不能再修改内容'), true);
});

test('dish recipes validate couple media and user-entered instructions', () => {
  const source = routeSource('resources.js');
  assert.equal(source.includes('assertMediaKeyForCouple(recipeImage, coupleId)'), true);
  assert.equal(source.includes('ingredients.length > 1200'), true);
  assert.equal(source.includes('steps.length > 4000'), true);
  assert.equal(source.includes('tips.length > 1000'), true);
  assert.match(source, /add\(dish\?\.ingredients\)[\s\S]*add\(dish\?\.steps\)[\s\S]*add\(dish\?\.tips\)/);
  assert.equal(source.includes('菜品名称不能重复'), true);
  assert.equal(source.includes('菜标识重复'), true);
});

test('batch menu import is couple scoped and transactional', () => {
  const source = routeSource('resources.js');
  assert.equal(source.includes("router.post('/menus/batch'"), true);
  assert.equal(source.includes('sourceMenus.length > 20'), true);
  assert.equal(source.includes('await connection.beginTransaction()'), true);
  assert.equal(source.includes('[coupleId, req.userRow.id, menu.name'), true);
});

test('menu names are checked for duplicates on create, rename and batch import', () => {
  const source = routeSource('resources.js');
  assert.equal(source.includes('async function ensureMenuNameAvailable'), true);
  assert.match(source, /if\s*\(resource === 'menus'\)\s*\{[\s\S]*?ensureMenuNameAvailable\(pool,\s*coupleId,\s*body\.name\)/);
  assert.equal(source.includes("resource === 'menus' && data.name !== undefined"), true);
  assert.equal(source.includes('await ensureMenuNameAvailable(connection, coupleId, menu.name)'), true);
  assert.equal(source.includes("error?.code === 'ER_DUP_ENTRY'"), true);
});

test('task photos are linked in one transaction and remain couple scoped', () => {
  const source = routeSource('resource-albums.js');
  assert.equal(source.includes("router.post('/albums/task-photos'"), true);
  assert.equal(source.includes('imageKeys(req.body?.images, coupleId, 9'), true);
  assert.equal(source.includes('await requireCoupleTask(pool, coupleId, req.body?.taskId)'), true);
  assert.equal(source.includes('INSERT INTO albums(couple_id,author_id,task_id,image_url,storage_key,description,photo_date)'), true);
  assert.equal(source.includes('[coupleId, req.userRow.id, task?.id || null, key, key, description, photoDate || null]'), true);
});

test('album pages use a couple-scoped cursor and batch inserts are transactional', () => {
  const source = routeSource('resources.js', 'resource-albums.js');
  const { listOptions } = require('../src/services/resource-list');
  const options = listOptions('album', { paged: '1', cursor: '20' }, 9, 1);
  assert.equal(options.paged, true);
  assert.deepEqual(options.conditions, ['r.couple_id=?', 'r.id<?']);
  assert.deepEqual(options.params, [9, '20']);
  assert.equal(source.includes("router.post('/albums/batch'"), true);
  assert.equal(source.includes('nextCursor'), true);
  assert.equal(source.includes("router.delete('/albums/batch'"), true);
  assert.equal(source.includes('部分照片不存在，请刷新后重试'), true);
});

test('v2.6 order receiver identity migration is repeatable', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../sql/schema.sql'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '../sql/migrate-v2.6.0.sql'), 'utf8');
  assert.equal(schema.includes('accepted_by_user_id BIGINT UNSIGNED'), true);
  assert.equal(schema.includes('fk_orders_accepted_by_user'), true);
  assert.equal(migration.includes("COLUMN_NAME='accepted_by_user_id'"), true);
  assert.equal(migration.includes("INDEX_NAME='idx_orders_accepted_by'"), true);
  assert.equal(migration.includes("CONSTRAINT_NAME='fk_orders_accepted_by_user'"), true);
  assert.equal(migration.includes("WHERE o.status IN ('accepted','completed')"), true);
});

test('v2.7 adds the ready handoff without dropping existing order states', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../sql/schema.sql'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '../sql/migrate-v2.7.0.sql'), 'utf8');
  assert.equal(schema.includes("ENUM('pending','accepted','ready','completed')"), true);
  assert.equal(schema.includes('ready_at DATETIME NULL'), true);
  assert.equal(migration.includes("MODIFY COLUMN status ENUM('pending','accepted','ready','completed')"), true);
  assert.equal(migration.includes("MODIFY COLUMN purpose ENUM('avatar','album','dish','recipe')"), true);
  assert.equal(migration.includes("COLUMN_NAME='ready_at'"), true);
});
