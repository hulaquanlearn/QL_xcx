const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createUploadQueue } = require('../miniprogram/services/upload-queue');

const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('photo queue keeps successful photos and retries only the failed upload', async () => {
  const uploads = [];
  const saves = [];
  let failed = false;
  let latest;
  const queue = createUploadQueue({
    upload: async name => {
      uploads.push(name);
      if (name === 'b' && !failed) { failed = true; throw new Error('network'); }
      return { key: name };
    },
    save: async key => saves.push(key),
    onChange: items => { latest = items; }
  });
  await queue.add(['a', 'b']);
  assert.deepEqual(latest.map(item => item.status), ['ready', 'failed']);
  await queue.retry('2');
  assert.deepEqual(uploads, ['a', 'b', 'b']);
  assert.deepEqual(saves, ['a', 'b']);
  assert.deepEqual(latest.map(item => item.status), ['ready', 'ready']);
});

test('photo queue reuses approved media after a save failure and resumes a pending check', async () => {
  let uploads = 0;
  let saves = 0;
  let reviews = 0;
  const queue = createUploadQueue({
    upload: async () => { uploads += 1; const error = new Error('审核仍在进行'); error.checkId = 'check-1'; throw error; },
    waitForReview: async id => { assert.equal(id, 'check-1'); reviews += 1; return { key: 'approved-key' }; },
    save: async key => { assert.equal(key, 'approved-key'); saves += 1; if (saves === 1) throw new Error('save timeout'); }
  });
  await queue.add(['photo']);
  await queue.retry('1');
  await queue.retry('1');
  assert.equal(uploads, 1);
  assert.equal(reviews, 1);
  assert.equal(saves, 2);
});

test('photo queue caps workers and does not save an upload that finishes after pause', async () => {
  const upload = deferred();
  let uploads = 0;
  const saves = [];
  let latest;
  const queue = createUploadQueue({
    concurrency: 2,
    upload: async name => { uploads += 1; await upload.promise; return { key: name }; },
    save: async key => saves.push(key),
    onChange: items => { latest = items; }
  });
  const complete = queue.add(['a', 'b', 'c']);
  assert.equal(uploads, 2);
  queue.pause();
  upload.resolve();
  await complete;
  assert.equal(saves.length, 0);
  assert.deepEqual(latest.map(item => item.status), ['paused', 'paused', 'paused']);
  await queue.resume();
  assert.equal(uploads, 3);
  assert.equal(saves.length, 3);
});

function loadMedia() {
  const requests = [];
  let token = 'session-a';
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/services/media.js'), 'utf8'), {
    module, exports: module.exports, Map, Set, Promise,
    require: name => name === './auth' ? { getToken: () => token } : name === '../config' ? { apiBaseUrl: 'https://example.test', requestTimeout: 1000 } : {},
    wx: { downloadFile: options => { requests.push(options); return { abort: () => options.fail(new Error('aborted')) }; } }
  });
  return { media: module.exports, requests, changeToken: value => { token = value; } };
}

test('protected images use a global four-worker cap and publish each completed image immediately', async () => {
  const { media, requests } = loadMedia();
  const key = number => `server-media:1:${String(number).padStart(32, '0')}.jpg`;
  const delivered = [];
  const done = media.resolveFiles([1, 2, 3, 4, 5, 6].map(key), { onResolved: (id, file) => delivered.push([id, file]) });
  const duplicate = media.resolveFiles([key(1)]);
  await flush();
  assert.equal(requests.length, 4);
  assert.equal(requests[0].header.Authorization, 'Bearer session-a');
  requests[0].success({ statusCode: 200, tempFilePath: '/tmp/a' });
  await flush();
  assert.equal(delivered.length, 1);
  assert.equal(requests.length, 5);
  requests[1].success({ statusCode: 200, tempFilePath: '/tmp/b' });
  await flush();
  assert.equal(requests.length, 6);
  requests.slice(2).forEach((request, index) => request.success({ statusCode: 200, tempFilePath: `/tmp/${index}` }));
  await Promise.all([done, duplicate]);
  assert.equal(delivered.length, 6);
  assert.equal(requests.length, 6);
});

test('clearing a session cancels queued image downloads and suppresses old image callbacks', async () => {
  const { media, requests, changeToken } = loadMedia();
  const keys = [1, 2, 3, 4, 5].map(number => `server-media:1:${String(number).padStart(32, '0')}.jpg`);
  let callbacks = 0;
  const done = media.resolveFiles(keys, { onResolved: () => { callbacks += 1; } });
  await flush();
  assert.equal(requests.length, 4);
  changeToken('session-b');
  media.clearCaches();
  await done;
  assert.equal(callbacks, 0);
  assert.equal(requests.length, 4);
});

test('authenticated thumbnail and original caches remain separate', async () => {
  const { media, requests } = loadMedia();
  const key = `server-media:1:${'1'.repeat(32)}.jpg`;
  const thumbnail = media.resolveFiles([key], { variant: 'thumbnail' });
  await flush();
  assert.match(requests[0].url, /\?variant=thumbnail$/);
  requests[0].success({ statusCode: 200, tempFilePath: '/tmp/thumbnail' });
  await thumbnail;
  const original = media.resolveFiles([key]);
  await flush();
  assert.equal(requests.length, 2);
  assert.doesNotMatch(requests[1].url, /variant=/);
  requests[1].success({ statusCode: 200, tempFilePath: '/tmp/original' });
  const originals = await original;
  const thumbnails = await media.resolveFiles([key], { variant: 'thumbnail' });
  assert.equal(originals[key], '/tmp/original');
  assert.equal(thumbnails[key], '/tmp/thumbnail');
  assert.equal(requests.length, 2);
});

test('invalid image keys resolve to a visible failure instead of an endless placeholder', async () => {
  const { media, requests } = loadMedia();
  const results = [];
  await media.resolveFiles(['https://untrusted.example/image.jpg'], { onResolved: (key, file) => results.push(file) });
  assert.deepEqual(results, ['']);
  assert.equal(requests.length, 0);
});

test('logout before queued download startup never sends an old bearer token', async () => {
  const { media, requests, changeToken } = loadMedia();
  const pending = media.resolveFiles([`server-media:1:${'2'.repeat(32)}.jpg`]);
  changeToken('');
  media.clearCaches();
  await pending;
  assert.equal(requests.length, 0);
});

function loadAlbum(api, media) {
  let page;
  let token = 'session-a';
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/album/index.js'), 'utf8'), {
    getApp: () => ({ globalData: { userId: '1', coupleId: '1' } }),
    Page: value => { page = value; },
    console, setTimeout, clearTimeout, Map, Set,
    wx: { reLaunch() {}, pageScrollTo() {}, showToast() {}, stopPullDownRefresh() {} },
    require: name => {
      if (name.endsWith('/api')) return api;
      if (name.endsWith('/auth')) return { getToken: () => token };
      if (name.endsWith('/media')) return media;
      if (name.endsWith('/upload-queue')) return { createUploadQueue };
      return require('../miniprogram/utils/date');
    }
  });
  page.data = JSON.parse(JSON.stringify(page.data));
  page.setData = value => Object.assign(page.data, value);
  page.onLoad();
  return { page, changeToken: value => { token = value; } };
}

test('album rows show before image downloads finish and native preview return does not reload', async () => {
  let calls = 0;
  let imageOptions;
  const { page } = loadAlbum({ listPage: async () => {
    calls += 1;
    return { items: [{ _id: '1', fileID: 'stored', createTime: '2026-09-01 12:00:00' }], hasMore: false };
  } }, { resolveFiles: (keys, options) => { imageOptions = options; return new Promise(() => {}); } });
  await page.loadAlbums(true);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.albumList.length, 1);
  assert.equal(page.data.albumList[0].imgUrl, '');
  imageOptions.onResolved('stored', '/tmp/one.jpg');
  assert.equal(page.data.albumList[0].imgUrl, '/tmp/one.jpg');
  page.onPageScroll({ scrollTop: 600 });
  page.onShow();
  assert.equal(calls, 1);
  assert.equal(page._scrollTop, 600);
});

test('album can retry a failed refresh when the previous page was already the last page', async () => {
  let calls = 0;
  const { page } = loadAlbum({ listPage: async () => {
    calls++;
    if (calls === 2) throw new Error('network');
    return { items: [{ _id: String(calls), fileID: 'stored' }], hasMore: false };
  } }, { resolveFiles: async () => ({}) });
  await page.loadAlbums(true);
  await page.loadAlbums(true);
  assert.equal(page.data.loadError, 'network');
  await page.retryLoad();
  assert.equal(calls, 3);
  assert.equal(page.data.albumList[0]._id, '3');
  assert.equal(page.data.loadError, '');
});

test('a stale month response or old image callback cannot overwrite the new album filter', async () => {
  const old = deferred();
  let calls = 0;
  let imageOptions;
  const { page } = loadAlbum({ listPage: async () => {
    calls += 1;
    if (calls === 1) return old.promise;
    return { items: [{ _id: 'new', fileID: 'new-key' }], hasMore: false };
  } }, { resolveFiles: (keys, options) => { imageOptions = options; return Promise.resolve({}); } });
  const first = page.loadAlbums(true);
  page.data.month = '2026-09';
  await page.loadAlbums(true);
  old.resolve({ items: [{ _id: 'old', fileID: 'old-key' }], hasMore: true });
  await first;
  assert.equal(page.data.albumList[0]._id, 'new');
  page.onUnload();
  imageOptions.onResolved('new-key', '/tmp/stale.jpg');
  assert.equal(page.data.albumList[0].imgUrl, '');
});

test('private favorite toggle removes only the current photo from the favorite filter', async () => {
  const { page } = loadAlbum({
    setAlbumFavorite: async (id, favorite) => { assert.equal(id, '1'); assert.equal(favorite, false); return { favorite }; },
    albumMonths: async () => []
  }, {});
  page.data.favoriteOnly = true;
  page.data.albumList = [{ _id: '1', favorite: true }, { _id: '2', favorite: true }];
  await page.toggleFavorite({ currentTarget: { dataset: { id: '1' } } });
  assert.deepEqual(Array.from(page.data.albumList, item => item._id), ['2']);
});

test('album viewer downloads only the current original and ignores results after it closes', async () => {
  const requests = [];
  const response = deferred();
  const { page } = loadAlbum({}, { resolveFiles: keys => { requests.push(keys); return response.promise; } });
  page.data.albumList = [{ _id: '1', storageKey: 'one', imgUrl: '/thumb/1' }, { _id: '2', storageKey: 'two', imgUrl: '/thumb/2' }];
  const opening = page.previewImage({ currentTarget: { dataset: { id: '2' } } });
  assert.equal(page.data.previewVisible, true);
  assert.equal(page.data.previewIndex, 1);
  assert.deepEqual(Array.from(requests[0]), ['two']);
  assert.equal(requests.length, 1);
  page.closePreview();
  response.resolve({ two: '/original/2' });
  await opening;
  assert.equal(page.data.previewVisible, false);
  assert.equal(page.data.previewPhotos.length, 0);
});

test('task photo navigation combines task, month and private favorite filters', async () => {
  let params;
  const { page } = loadAlbum({ listPage: async (resource, value) => { params = value; return { items: [], hasMore: false }; } }, { resolveFiles: async () => ({}) });
  page.onLoad({ taskId: '42' });
  page.data.month = '2026-09';
  page.data.favoriteOnly = true;
  await page.loadAlbums(true);
  assert.equal(params.taskIds, '42');
  assert.equal(params.month, '2026-09');
  assert.equal(params.favoriteOnly, 1);
});

test('upload retry retains its original task context even when the next batch belongs elsewhere', async () => {
  const saved = [];
  let first = true;
  const queue = createUploadQueue({
    upload: async name => ({ key: name }),
    save: async (key, item) => {
      if (first) { first = false; throw new Error('save failed'); }
      saved.push([key, item.context.taskId]);
    }
  });
  await queue.add(['one'], { taskId: '42' });
  await queue.add(['two'], { taskId: '99' });
  await queue.retry('1');
  assert.deepEqual(saved, [['two', '99'], ['one', '42']]);
});
