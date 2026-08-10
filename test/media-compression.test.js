const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('mini-program uses purpose-aware image quality without repeated lossy compression', () => {
  const mediaSource = fs.readFileSync(
    path.join(__dirname, '../miniprogram/services/media.js'),
    'utf8'
  );
  const loginSource = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/index/index.js'),
    'utf8'
  );
  const mineSource = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/mine/index.js'),
    'utf8'
  );

  assert.equal(mediaSource.includes('avatar: {'), true);
  assert.equal(mediaSource.includes('dish: {'), true);
  assert.equal(mediaSource.includes('recipe: {'), true);
  assert.equal(mediaSource.includes('targetBytes: 1.2 * 1024 * 1024'), true);
  assert.equal(mediaSource.includes('album: {'), true);
  assert.equal(mediaSource.includes('targetBytes: 1.6 * 1024 * 1024'), true);
  assert.equal(mediaSource.includes('scaledSize(info, maxEdge)'), true);
  assert.equal(mediaSource.includes('if (size) {'), true);
  assert.equal(mediaSource.includes('compressOnce(filePath, attempt.quality, attempt.maxEdge)'), true);
  assert.equal(mediaSource.includes('downloadPromiseCache'), true);
  assert.equal(mediaSource.includes('function clearCaches()'), true);
  assert.equal(loginSource.includes('mediaService.clearCaches()'), true);
  assert.equal(mineSource.includes('mediaService.clearCaches()'), true);
});
