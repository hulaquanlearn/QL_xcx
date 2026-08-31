const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('v2.9 schema normalizes dishes and adds weekly planning', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../sql/schema.sql'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '../sql/migrate-v2.9.0.sql'), 'utf8');
  for (const table of ['dishes', 'menu_items', 'weekly_menu_plans', 'shopping_items']) {
    assert.equal(schema.includes(`CREATE TABLE IF NOT EXISTS ${table}`), true);
    assert.equal(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), true);
  }
  assert.equal(schema.includes('uq_weekly_plan_slot'), true);
  assert.equal(schema.includes('fk_menu_items_dish'), true);
});

test('planning validation rejects invalid slots and accepts a monday', () => {
  const planning = require('../src/routes/planning')._test;
  assert.equal(planning.weekStart('2026-08-17'), '2026-08-17');
  assert.throws(() => planning.weekStart('2026-08-18'), /星期一/);
  assert.deepEqual(planning.normalizeEntries([{ dayIndex: 0, mealType: 'lunch', menuId: '12' }]), [
    { dayIndex: 0, mealType: 'lunch', menuId: '12' }
  ]);
  assert.throws(() => planning.normalizeEntries([
    { dayIndex: 0, mealType: 'lunch', menuId: '12' },
    { dayIndex: 0, mealType: 'lunch', menuId: '13' }
  ]), /只能安排一个菜单/);
  assert.deepEqual(planning.splitIngredients('鸡蛋 2个、番茄 2个\n盐 少许'), ['鸡蛋 2个', '番茄 2个', '盐 少许']);
});

test('menu normalization keeps a compatibility fallback for legacy JSON', () => {
  const store = require('../src/services/menu-store');
  assert.deepEqual(store.parseLegacyDishes('[{"name":"番茄炒蛋"}]'), [{ name: '番茄炒蛋' }]);
  assert.deepEqual(store.parseLegacyDishes('not-json'), []);
});
