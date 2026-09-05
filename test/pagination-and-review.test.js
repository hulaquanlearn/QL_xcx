const test = require('node:test');
const assert = require('node:assert/strict');

test('media review propagates rejection and cancellation without retrying the upload', async () => {
  const api = require('../miniprogram/services/api');
  const auth = require('../miniprogram/services/auth');
  const previousWx = global.wx;
  const oldToken = auth.getToken;
  let calls = 0;
  try {
    auth.getToken = () => 'test-session';
    global.wx = { request(options) { calls += 1; options.success({ statusCode: 200, data: { success: true, data: { status: 'rejected', message: '图片未通过内容安全检测' } } }); } };
    await assert.rejects(api.waitForMediaCheck('check-1'), error => error.rejected && error.checkId === 'check-1');
    await assert.rejects(api.waitForMediaCheck('check-2', { isCancelled: () => true }), error => error.cancelled);
    assert.equal(calls, 1);
    global.wx.request = options => options.success({ statusCode: 200, data: { success: true, data: { status: 'approved', key: 'approved-key' } } });
    const events = [];
    assert.equal((await api.waitForMediaCheck('check-3', { onStatus: event => events.push(event) })).key, 'approved-key');
    assert.deepEqual(events, [{ status: 'moderating', checkId: 'check-3' }]);
  } finally { global.wx = previousWx; auth.getToken = oldToken; }
});

test('task paging ignores old filters, preserves all-page counts and deduplicates rows', async () => {
  const api = require('../miniprogram/services/api');
  const oldList = api.listPage;
  const oldPage = global.Page;
  const oldGetApp = global.getApp;
  const oldWx = global.wx;
  let definition;
  global.getApp = () => ({ globalData: { coupleId: '1' } });
  global.Page = value => { definition = value; };
  global.wx = { showToast() {} };
  const pagePath = require.resolve('../miniprogram/pages/activity/index');
  try {
    delete require.cache[pagePath];
    require(pagePath);
    const page = { ...definition, _visible: true, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); }, loadTaskPhotos() {} };
    const pending = [];
    api.listPage = () => new Promise(resolve => pending.push(resolve));
    const first = page.getTasksList();
    page.data.currentFilter = 'completed';
    const second = page.getTasksList();
    pending[1]({ items: [{ _id: '2', completed: true }], counts: { all: 31, pending: 20, completed: 11 }, hasMore: true, nextCursor: '2' });
    await second;
    pending[0]({ items: [{ _id: '3', completed: false }], hasMore: false });
    await first;
    assert.deepEqual(page.data.tasksList.map(item => item.id), ['2']);
    assert.equal(page.data.totalCount, 31);
    const third = page.getTasksList(true);
    pending[2]({ items: [{ _id: '2', completed: true }, { _id: '1', completed: true }], counts: { all: 31, pending: 20, completed: 11 }, hasMore: false });
    await third;
    assert.deepEqual(page.data.tasksList.map(item => item.id), ['2', '1']);
    assert.equal(page.data.tasksHasMore, false);
  } finally { api.listPage = oldList; global.Page = oldPage; global.getApp = oldGetApp; global.wx = oldWx; delete require.cache[pagePath]; }
});
