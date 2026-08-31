const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  decodeImage,
  parseMediaKey,
  assertMediaKeyForCouple,
  collectMediaKeys
} = require('../src/media');

const tinyPng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x00
]);

test('image uploads accept supported image signatures only', () => {
  const decoded = decodeImage(tinyPng.toString('base64'));
  assert.equal(decoded.type.extension, 'png');
  assert.throws(() => decodeImage(Buffer.from('plain text').toString('base64')), /仅支持/);
});

test('media keys are bound to one couple', () => {
  const key = `server-media:12:${'a'.repeat(32)}.jpg`;
  assert.deepEqual(parseMediaKey(key), {
    coupleId: '12',
    filename: `${'a'.repeat(32)}.jpg`
  });
  assert.doesNotThrow(() => assertMediaKeyForCouple(key, 12));
  assert.throws(() => assertMediaKeyForCouple(key, 13), /不属于当前情侣空间/);
  assert.throws(() => assertMediaKeyForCouple('cloud://legacy', 12), /图片地址无效/);
});

test('media cleanup finds keys nested in menu and order dishes', () => {
  const key = `server-media:7:${'b'.repeat(32)}.webp`;
  const keys = collectMediaKeys({ dishes: [{ image: key }, { image: 'legacy-invalid-key' }] });
  assert.deepEqual([...keys], [key]);
});

test('normalized dish media remains protected from orphan cleanup', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/media.js'), 'utf8');
  assert.equal(source.includes('SELECT id FROM dishes WHERE image_key=? OR recipe_image_key=?'), true);
});
