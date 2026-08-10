const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const preset = require('../miniprogram/data/family-menu-preset');

test('family menu preset contains eight named dishes without bundled photos', () => {
  assert.equal(preset.name, '家庭常用菜');
  assert.equal(preset.dishes.length, 8);
  assert.equal(new Set(preset.dishes.map(dish => dish.name)).size, 8);

  for (const dish of preset.dishes) {
    assert.ok(dish.id);
    assert.ok(dish.name);
    assert.equal(dish.imagePath, undefined);
  }
});

test('bundled image and audio resources stay below the 200 KiB audit limit', () => {
  const root = path.join(__dirname, '..', 'miniprogram');
  const mediaPattern = /\.(?:png|jpe?g|gif|webp|svg|mp3|wav|aac|m4a|ogg|flac|wma)$/i;
  let total = 0;
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (mediaPattern.test(entry.name)) total += fs.statSync(fullPath).size;
    }
  };
  visit(root);
  assert.ok(total < 200 * 1024, `bundled media totals ${total} bytes`);
});
