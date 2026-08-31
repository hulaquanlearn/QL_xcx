const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../miniprogram');

test('all local mini-program image references exist', () => {
  const sourceFiles = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (/\.(?:wxml|wxss|js|json)$/.test(entry.name)) sourceFiles.push(fullPath);
    }
  };
  walk(root);
  const missing = [];
  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/["'](\/images\/[^"']+)["']/g)) {
      const asset = path.join(root, match[1].replace(/^\//, ''));
      if (!fs.existsSync(asset)) missing.push(`${path.relative(root, file)} -> ${match[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});
