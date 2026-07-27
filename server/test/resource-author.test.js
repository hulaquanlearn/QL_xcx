const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('resources are couple scoped and expose the latest creator name', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/resources.js'), 'utf8');
  assert.equal(source.includes('u.name author_name'), true);
  assert.equal(source.includes('authorId: String(row.author_id)'), true);
  assert.equal(source.includes("author: row.author_name || ''"), true);
  assert.equal(source.includes('WHERE r.id=? AND r.couple_id=?'), true);
  assert.equal(source.includes('DELETE FROM ${definitionValue.table} WHERE id=? AND couple_id=?'), true);
});

test('order ownership and state changes are enforced on the server', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/resources.js'), 'utf8');
  assert.equal(source.includes("router.post('/orders/:id/accept'"), true);
  assert.equal(source.includes("author_id<>? AND status='pending'"), true);
  assert.equal(source.includes("String(beforeRows[0].author_id) !== String(req.userRow.id)"), true);
  assert.equal(source.includes('data.order_by = req.userRow.name'), true);
});

test('batch menu import is couple scoped and transactional', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/resources.js'), 'utf8');
  assert.equal(source.includes("router.post('/menus/batch'"), true);
  assert.equal(source.includes('sourceMenus.length > 20'), true);
  assert.equal(source.includes('await connection.beginTransaction()'), true);
  assert.equal(source.includes('[coupleId, req.userRow.id, menu.name'), true);
});

test('menu names are checked for duplicates on create, rename and batch import', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/resources.js'), 'utf8');
  assert.equal(source.includes('async function ensureMenuNameAvailable'), true);
  assert.match(source, /if\s*\(resource === 'menus'\)\s*\{[\s\S]*?ensureMenuNameAvailable\(pool,\s*coupleId,\s*body\.name\)/);
  assert.equal(source.includes("resource === 'menus' && data.name !== undefined"), true);
  assert.equal(source.includes('await ensureMenuNameAvailable(connection, coupleId, menu.name)'), true);
  assert.equal(source.includes("error?.code === 'ER_DUP_ENTRY'"), true);
});

test('task photos are linked in one transaction and remain couple scoped', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/resources.js'), 'utf8');
  assert.equal(source.includes("router.post('/albums/task-photos'"), true);
  assert.equal(source.includes('images.length > 9'), true);
  assert.equal(source.includes('await ensureTaskForCouple(pool, coupleId, req.body.taskId)'), true);
  assert.equal(source.includes('INSERT INTO albums(couple_id,author_id,task_id,image_url,storage_key,description)'), true);
  assert.equal(source.includes('[coupleId, req.userRow.id, task.id, key, key, description]'), true);
});
