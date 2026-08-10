const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(fullPath) : [fullPath];
  });
}

test('mini-program runtime has no cloud development dependency', () => {
  const root = path.join(__dirname, '../miniprogram');
  const sources = filesUnder(root)
    .filter(file => /\.(?:js|json|wxml|wxss)$/.test(file))
    .map(file => fs.readFileSync(file, 'utf8'))
    .join('\n');

  assert.equal(sources.includes('wx.cloud'), false);
  assert.equal(sources.includes('cloud://'), false);
  assert.equal(fs.existsSync(path.join(root, 'services/database.js')), false);
});
