const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const createListMethods = require('../miniprogram/pages/food/modules/lists');
const createDisplayMethods = require('../miniprogram/pages/food/modules/display');

const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setData(patch) {
  for (const [key, value] of Object.entries(patch)) {
    const segments = key.split('.');
    let target = this.data;
    while (segments.length > 1) target = target[segments.shift()];
    target[segments[0]] = value;
  }
}
function planner(api = {}, wxOverrides = {}, media = {}) {
  let definition;
  const file = path.join(__dirname, '../miniprogram/pages/food/planner/index.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: name => name.endsWith('/api') ? api : media,
    getApp: () => ({ globalData: { userId: '1', coupleId: '1' } }),
    Page: value => { definition = value; },
    module: { exports: {} },
    Date,
    wx: { showToast() {}, disableAlertBeforeUnload() {}, enableAlertBeforeUnload() {}, ...wxOverrides }
  }, { filename: file });
  const context = { ...definition, data: clone(definition.data), setData };
  context.setWeek(new Date('2026-08-31T00:00:00'));
  return context;
}
function foodLists(api, media) {
  const app = { globalData: { coupleId: '1', userId: '1' } };
  return {
    ...createDisplayMethods({ app, mediaService: media, dateUtils: { parseDateTime: value => new Date(value) } }),
    ...createListMethods({ app, api }),
    data: { activeMenuId: 'all', menus: [], orders: [], orderStatus: 'all', ordersHasMore: true, ordersLoading: false, ordersNextCursor: '' },
    setData
  };
}

function foodPage(api, media) {
  let definition;
  const file = path.join(__dirname, '../miniprogram/pages/food/index.js');
  const localRequire = createRequire(file);
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: name => name === '../../services/api' ? api : name === '../../services/media' ? media : localRequire(name),
    getApp: () => ({ globalData: { userId: '1', coupleId: '1' } }),
    Page: value => { definition = value; },
    Date,
    console: { error() {} },
    wx: { showToast() {} }
  }, { filename: file });
  return { ...definition, data: clone(definition.data), setData };
}

test('weekly planner ignores an older week response and saves only the current week data', async () => {
  const old = deferred();
  const next = deferred();
  const saved = [];
  const page = planner({
    list: async () => [],
    getWeekPlan: week => week === '2026-08-31' ? old.promise : next.promise,
    saveWeekPlan: async (week, entries) => saved.push({ week, entries: clone(entries) })
  });
  const first = page.loadData();
  page.setWeek(new Date('2026-09-07T00:00:00'));
  const second = page.loadData();
  next.resolve({ plans: [{ dayIndex: 0, mealType: 'lunch', menuId: '2', menuName: '新的一周' }] });
  await second;
  old.resolve({ plans: [{ dayIndex: 0, mealType: 'lunch', menuId: '1', menuName: '上一周' }] });
  await first;
  assert.equal(page.data.days[0].lunch, '新的一周');
  await page.savePlan();
  assert.deepEqual(saved, [{ week: '2026-09-07', entries: [{ dayIndex: 0, mealType: 'lunch', menuId: '2' }] }]);
});

test('weekly planner cannot save while loading or after a failed week load', async () => {
  const request = deferred();
  let saves = 0;
  const page = planner({ list: async () => [], getWeekPlan: () => request.promise, saveWeekPlan: async () => { saves += 1; } });
  const loading = page.loadData();
  await page.savePlan();
  assert.equal(saves, 0);
  request.reject(new Error('网络断开'));
  await loading;
  assert.equal(page.data.loadError, '网络断开');
  await page.savePlan();
  assert.equal(saves, 0);
});

test('shopping generation captures the saved week before awaiting and prevents normal week switches', async () => {
  const saving = deferred();
  const weeks = [];
  const page = planner({
    saveWeekPlan: () => saving.promise,
    generateShopping: async week => { weeks.push(week); return { count: 1 }; }
  });
  const generated = page.generateShopping();
  await page.changeWeek({ currentTarget: { dataset: { offset: 1 } } });
  assert.equal(page.data.weekStart, '2026-08-31');
  // Even an external state change cannot redirect the second half of this operation.
  page.setWeek(new Date('2026-09-07T00:00:00'));
  saving.resolve();
  await generated;
  assert.deepEqual(weeks, ['2026-08-31']);
});

test('unsaved weekly plans are preserved when cancelling a week change', async () => {
  let confirmation;
  const page = planner({}, { showModal: options => { confirmation = options; } });
  page.data.menuOptions = [{ id: '', label: '暂不安排' }, { id: '1', label: '家常菜' }];
  page.selectPlanMenu({ currentTarget: { dataset: { day: 0, meal: 'lunch' } }, detail: { value: 1 } });
  assert.equal(page.data.dirty, true);
  const changing = page.changeWeek({ currentTarget: { dataset: { offset: 1 } } });
  confirmation.success({ confirm: false });
  await changing;
  assert.equal(page.data.weekStart, '2026-08-31');
  assert.equal(page.data.plans[0].menuId, '1');
});

test('shopping-only refresh preserves a local weekly draft and ignores another week', async () => {
  let requests = 0;
  const page = planner({ getWeekPlan: async () => {
    requests += 1;
    return { plans: [], shopping: [{ id: '1', checked: true, sources: [] }] };
  } });
  page.data.plans = [{ dayIndex: 0, mealType: 'lunch', menuId: 'new-local' }];
  page.setDirty(true);
  await page.refreshShopping();
  assert.equal(page.data.plans[0].menuId, 'new-local');
  assert.equal(page.data.dirty, true);
  assert.equal(page.data.shoppingDone, 1);
  await page.refreshShopping('2026-08-24');
  assert.equal(requests, 1);
});

test('failed shopping toggle can be retried instead of remaining permanently locked', async () => {
  let attempts = 0;
  const page = planner({
    updateShopping: async () => { attempts += 1; if (attempts === 1) throw new Error('offline'); },
    getWeekPlan: async () => ({ shopping: [{ id: '1', checked: true }] })
  });
  page.data.shopping = [{ id: '1', checked: false }];
  const event = { currentTarget: { dataset: { id: '1' } } };
  await page.toggleShopping(event);
  await page.toggleShopping(event);
  assert.equal(attempts, 2);
  assert.equal(page.data.shoppingDone, 1);
});

test('shopping recipe sheet uses the source dish and ignores a late image after closing', async () => {
  const image = deferred();
  const page = planner({}, {}, { resolveFiles: () => image.promise });
  page.data.menus = [{ _id: '3', name: '午餐', dishes: [{ id: '4', name: '番茄炒蛋', ingredients: '鸡蛋 2 个', steps: '翻炒', recipeImage: 'private-key' }] }];
  const opening = page.openShoppingRecipe({ currentTarget: { dataset: { menuid: '3', dishid: '4' } } });
  assert.equal(page.data.sourceRecipe.name, '番茄炒蛋');
  assert.equal(page.data.sourceRecipe.steps, '翻炒');
  page.closeShoppingRecipe();
  image.resolve({ 'private-key': 'local-file' });
  await opening;
  assert.equal(page.data.sourceRecipe, null);
});

test('menu text appears before media resolves and older media cannot overwrite a newer refresh', async () => {
  const olderImage = deferred();
  let listCalls = 0;
  const page = foodLists({ list: async () => [{ _id: '1', name: ++listCalls === 1 ? '旧菜单' : '新菜单', dishes: [{ id: '1', image: listCalls === 1 ? 'old' : 'new' }] }] }, {
    resolveFiles: keys => keys.includes('old') ? olderImage.promise : Promise.resolve({ new: 'new-local-file' })
  });
  await page.loadMenus();
  assert.equal(page.data.menusLoading, false);
  assert.equal(page.data.menus[0].name, '旧菜单');
  await page.loadMenus();
  await tick();
  olderImage.resolve({ old: 'old-local-file' });
  await tick();
  assert.equal(page.data.menus[0].name, '新菜单');
  assert.equal(page.data.menus[0].dishes[0].image, 'new-local-file');
});

test('older menu network response cannot replace a newer menu response', async () => {
  const older = deferred();
  let calls = 0;
  const page = foodLists({ list: () => ++calls === 1 ? older.promise : Promise.resolve([{ _id: '2', name: '最新', dishes: [] }]) }, { resolveFiles: async () => ({}) });
  const first = page.loadMenus();
  await page.loadMenus();
  older.resolve([{ _id: '1', name: '过期', dishes: [] }]);
  await first;
  assert.equal(page.data.menus[0].name, '最新');
});

test('orders use cursor pagination, deduplicate rows, and stop at the final page', async () => {
  const queries = [];
  const page = foodLists({ listPage: async (_resource, params) => {
    queries.push({ ...params });
    return queries.length === 1
      ? { items: [{ _id: '3', status: 'pending', dishes: [] }, { _id: '2', status: 'pending', dishes: [] }], hasMore: true, nextCursor: '2' }
      : { items: [{ _id: '2', status: 'pending', dishes: [] }, { _id: '1', status: 'pending', dishes: [] }], hasMore: false, nextCursor: '' };
  } }, { resolveFiles: async () => ({}) });
  await page.loadOrders();
  await page.loadMoreOrders();
  await page.loadMoreOrders();
  assert.deepEqual(queries, [{ limit: 20 }, { limit: 20, cursor: '2' }]);
  assert.deepEqual(page.data.orders.map(order => order._id), ['3', '2', '1']);
  assert.equal(page.data.ordersHasMore, false);
});

test('order status filters ignore an older request and send the status to the server', async () => {
  const old = deferred();
  const queries = [];
  const page = foodLists({ listPage: async (_resource, params) => {
    queries.push({ ...params });
    return params.status === 'ready'
      ? { items: [{ _id: '5', status: 'ready', authorId: '1', dishes: [] }], hasMore: false }
      : old.promise;
  } }, { resolveFiles: async () => ({}) });
  const initial = page.loadOrders();
  await page.selectOrderStatus({ currentTarget: { dataset: { status: 'ready' } } });
  old.resolve({ items: [{ _id: '1', status: 'pending', dishes: [] }], hasMore: true, nextCursor: '1' });
  await initial;
  assert.deepEqual(queries[1], { limit: 20, status: 'ready' });
  assert.equal(page.data.orders[0]._id, '5');
  assert.match(page.data.orders[0].nextActionText, /收到啦/);
  assert.equal(page.data.ordersHasMore, false);
});

test('a failed order refresh can retry even when the previously loaded final page has no more rows', async () => {
  let attempts = 0;
  const page = foodLists({ listPage: async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('offline');
    return { items: [{ _id: '2', dishes: [] }], hasMore: false };
  } }, { resolveFiles: async () => ({}) });
  page.data.orders = [{ _id: '1', dishes: [] }];
  page.data.ordersHasMore = false;
  await page.loadOrders();
  assert.equal(page.data.ordersError, 'offline');
  await page.retryOrders();
  assert.equal(attempts, 2);
  assert.equal(page.data.orders[0]._id, '2');
});

test('dish upload shows moderation state and resumes a pending check without uploading again', async () => {
  let uploads = 0;
  let polls = 0;
  let page;
  const pending = Object.assign(new Error('审核未结束'), { pending: true, checkId: 'review-1' });
  page = foodPage({ waitForMediaCheck: async id => {
    polls += 1;
    assert.equal(id, 'review-1');
    return { key: 'new-key' };
  } }, {
    upload: async (_path, _purpose, controls) => {
      uploads += 1;
      controls.onStatus({ status: 'moderating', checkId: 'review-1' });
      assert.equal(page.data.dishes[0].imageUploadStatus, 'moderating');
      throw pending;
    },
    remove: async () => {}
  });
  page.data.dishes = [{ id: '1', name: '番茄炒蛋', image: 'old-local', imageKey: 'old-key' }];
  await page.uploadDishImage('new-local', 0);
  assert.equal(page.data.dishes[0].image, 'old-local');
  assert.equal(page.data.dishes[0].imageUploadCheckId, 'review-1');
  await page.retryDishUpload({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(uploads, 1);
  assert.equal(polls, 1);
  assert.equal(page.data.dishes[0].imageKey, 'new-key');
  assert.equal(page.data.uploading, false);
});

test('recipe upload preserves the old image and does not offer retry for a rejected image', async () => {
  const page = foodPage({}, { upload: async () => { throw Object.assign(new Error('内容未通过审核'), { rejected: true }); } });
  page.data.recipeDraft = { recipeImage: 'old-recipe', recipeImageKey: 'old-key' };
  await page.uploadRecipeImage('new-recipe');
  assert.equal(page.data.recipeDraft.recipeImage, 'old-recipe');
  assert.equal(page.data.recipeDraft.recipeImageKey, 'old-key');
  assert.equal(page.data.recipeUploadRetryPath, '');
  assert.equal(page.data.recipeUploadCheckId, '');
  assert.equal(page.data.recipeUploading, false);
});
