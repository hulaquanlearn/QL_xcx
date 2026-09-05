const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const config = require('../src/config');
const { createThumbnailService, MAX_INPUT_PIXELS } = require('../src/services/media-thumbnails');

const filename = `${'a'.repeat(32)}.jpg`;
async function workspace(work) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'couple-thumbnail-test-'));
  try { await work(root); } finally {
    const resolved = path.resolve(root);
    const prefix = `${path.resolve(os.tmpdir())}${path.sep}couple-thumbnail-test-`;
    assert.ok(resolved.startsWith(prefix), 'Only delete this test-owned temporary directory');
    await fs.rm(resolved, { recursive: true, force: true });
  }
}
async function original(root, name = filename, width = 2000, height = 1000, orientation) {
  const directory = path.join(root, '9');
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, name);
  let image = sharp({ create: { width, height, channels: 3, background: '#b68068' } });
  if (orientation) image = image.withMetadata({ orientation });
  await image.jpeg().toFile(file);
  return file;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(condition) {
  for (let attempt = 0; attempt < 300 && !condition(); attempt += 1) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(condition(), 'Expected asynchronous operation to reach its checkpoint');
}

test('private thumbnails preserve aspect ratio, reuse the mtime cache and leave the original unchanged', async () => workspace(async root => {
  const source = await original(root);
  const before = await fs.readFile(source);
  const service = createThumbnailService({ mediaDir: root });
  const preview = await service.resolve('9', filename);
  assert.ok(preview.startsWith(path.join(root, '.thumbnails', '9') + path.sep));
  const metadata = await sharp(preview).metadata();
  assert.equal(metadata.width, 960);
  assert.equal(metadata.height, 480);
  assert.equal(metadata.format, 'jpeg');
  const firstStat = await fs.stat(preview);
  assert.equal(await service.resolve('9', filename), preview);
  assert.equal((await fs.stat(preview)).mtimeMs, firstStat.mtimeMs);
  assert.deepEqual(await fs.readFile(source), before);
}));

test('small images are not enlarged and EXIF orientation is applied before resizing', async () => workspace(async root => {
  const service = createThumbnailService({ mediaDir: root });
  await original(root, filename, 48, 96);
  let metadata = await sharp(await service.resolve('9', filename)).metadata();
  assert.equal(metadata.width, 48);
  assert.equal(metadata.height, 96);
  const rotated = `${'b'.repeat(32)}.jpg`;
  await original(root, rotated, 120, 80, 6);
  metadata = await sharp(await service.resolve('9', rotated)).metadata();
  assert.equal(metadata.width, 80);
  assert.equal(metadata.height, 120);
  assert.equal(metadata.orientation, undefined);
}));

test('mtime changes invalidate thumbnails and deletion clears only this original derivatives', async () => workspace(async root => {
  const service = createThumbnailService({ mediaDir: root });
  const source = await original(root);
  const first = await service.resolve('9', filename);
  const later = new Date(Date.now() + 10000);
  await fs.utimes(source, later, later);
  const second = await service.resolve('9', filename);
  assert.notEqual(second, first);
  const other = `${'c'.repeat(32)}.jpg`;
  await original(root, other, 40, 40);
  const otherPreview = await service.resolve('9', other);
  const pendingDirectory = path.join(root, 'pending-media');
  await fs.mkdir(pendingDirectory);
  const pendingFile = path.join(pendingDirectory, filename);
  await fs.copyFile(source, pendingFile);
  await fs.unlink(source);
  assert.equal(await service.resolve('9', filename), null, 'A cache hit still needs its original');
  await service.remove('9', filename);
  await assert.rejects(fs.access(first));
  await assert.rejects(fs.access(second));
  await fs.access(otherPreview);
  await fs.access(pendingFile);
  assert.equal(await service.resolve('../pending-media', filename), null);
  assert.equal(await service.resolve('9', '../pending-media/file.jpg'), null);
}));

test('corrupt files and excessive pixel dimensions safely skip thumbnail generation', async () => workspace(async root => {
  const service = createThumbnailService({ mediaDir: root });
  const source = await original(root, filename, 10, 10);
  await fs.writeFile(source, Buffer.from([0xff, 0xd8, 0xff, 0x00]));
  assert.equal(await service.resolve('9', filename), null);
  const large = `${'d'.repeat(32)}.jpg`;
  await original(root, large, 7000, 3500);
  assert.ok(7000 * 3500 > MAX_INPUT_PIXELS);
  assert.equal(await service.resolve('9', large), null);
  assert.deepEqual(await fs.readdir(path.join(root, '.thumbnails', '9')), []);
}));

test('thumbnail decoding runs at most two jobs and a full bounded queue falls back immediately', async () => workspace(async root => {
  const releases = [];
  let active = 0;
  let peak = 0;
  let blocking = true;
  const slowSharp = (file, options) => {
    assert.equal(options.limitInputPixels, MAX_INPUT_PIXELS);
    const image = sharp(file, options);
    const chain = {};
    for (const method of ['rotate', 'resize', 'flatten', 'jpeg']) chain[method] = (...args) => { image[method](...args); return chain; };
    chain.toFile = async output => {
      active += 1;
      peak = Math.max(peak, active);
      if (blocking) await new Promise(resolve => releases.push(resolve));
      try { return await image.toFile(output); } finally { active -= 1; }
    };
    return chain;
  };
  const service = createThumbnailService({ mediaDir: root, sharpFactory: slowSharp, maxQueued: 1 });
  const names = ['1', '2', '3', '4'].map(value => `${value.repeat(32)}.jpg`);
  for (const name of names) await original(root, name, 30, 20);
  let fallbacks = 0;
  const requests = names.map(name => service.resolve('9', name).then(value => { if (!value) fallbacks += 1; return value; }));
  await until(() => releases.length === 2 && fallbacks === 1);
  assert.equal(peak, 2);
  blocking = false;
  releases.forEach(release => release());
  const values = await Promise.all(requests);
  assert.equal(values.filter(Boolean).length, 3);
  assert.equal(peak, 2);
}));

test('deleting an original during an active conversion cannot recreate its thumbnail', async () => workspace(async root => {
  let release;
  const slowSharp = (file, options) => {
    const image = sharp(file, options);
    const chain = {};
    for (const method of ['rotate', 'resize', 'flatten', 'jpeg']) chain[method] = (...args) => { image[method](...args); return chain; };
    chain.toFile = async output => {
      await image.toFile(output);
      await new Promise(resolve => { release = resolve; });
    };
    return chain;
  };
  const source = await original(root, filename, 120, 80);
  const service = createThumbnailService({ mediaDir: root, sharpFactory: slowSharp });
  const generating = service.resolve('9', filename);
  await until(() => Boolean(release));
  await fs.unlink(source);
  const removing = service.remove('9', filename);
  release();
  assert.equal(await generating, null);
  await removing;
  assert.deepEqual(await fs.readdir(path.join(root, '.thumbnails', '9')), []);
}));

test('thumbnail HTTP access is authenticated, couple-scoped, private and deleted with the original', async () => workspace(async root => {
  const { pool } = require('../src/db');
  const previousQuery = pool.query;
  const previousMediaDir = config.mediaDir;
  let currentCouple = 9;
  config.mediaDir = root;
  pool.query = async sql => sql.includes('FROM sessions s')
    ? [[{ id: 1, name: '测试', couple_id: currentCouple, session_id: 1 }]]
    : [[]];
  const app = require('../src/app');
  const source = await original(root);
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}/api/couple-space`;
  const headers = { Authorization: `Bearer ${'a'.repeat(43)}` };
  const url = `${base}/media/file/9/${filename}?variant=thumbnail`;
  try {
    assert.equal((await fetch(url)).status, 401);
    currentCouple = 10;
    assert.equal((await fetch(url, { headers })).status, 404);
    await assert.rejects(fs.access(path.join(root, '.thumbnails')), 'Denied requests never generate a cache');
    currentCouple = 9;
    const response = await fetch(url, { headers });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /^private,/);
    assert.match(response.headers.get('content-type'), /^image\/jpeg/);
    const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    assert.equal(metadata.width, 960);
    const cachedFiles = await fs.readdir(path.join(root, '.thumbnails', '9'));
    assert.equal(cachedFiles.length, 1);
    currentCouple = 10;
    assert.equal((await fetch(url, { headers })).status, 404, 'A generated cache does not bypass couple authorization');
    currentCouple = 9;
    assert.equal((await fetch(`${base}/media/file/.thumbnails/${filename}`, { headers })).status, 404);
    assert.equal((await fetch(`${base}/media/file/9/${filename}`, { method: 'DELETE', headers })).status, 200);
    await assert.rejects(fs.access(source));
    assert.deepEqual(await fs.readdir(path.join(root, '.thumbnails', '9')), []);
    assert.equal((await fetch(url, { headers })).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    pool.query = previousQuery;
    config.mediaDir = previousMediaDir;
  }
}));

test('thumbnail generation failures serve the authorized original instead of failing the request', async () => workspace(async root => {
  const { pool } = require('../src/db');
  const previousQuery = pool.query;
  const previousMediaDir = config.mediaDir;
  config.mediaDir = root;
  pool.query = async () => [[{ id: 1, couple_id: 9, session_id: 1 }]];
  const app = require('../src/app');
  const source = await original(root, filename, 8, 8);
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  await fs.writeFile(source, bytes);
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/couple-space/media/file/9/${filename}?variant=thumbnail`, {
      headers: { Authorization: `Bearer ${'a'.repeat(43)}` }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.match(response.headers.get('cache-control'), /^private,/);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    pool.query = previousQuery;
    config.mediaDir = previousMediaDir;
  }
}));
