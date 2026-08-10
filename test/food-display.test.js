const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('menu display preparation supports first-load dishes without images', () => {
  const pagePath = path.join(__dirname, '../miniprogram/pages/food/index.js');
  const previousGetApp = global.getApp;
  const previousPage = global.Page;
  let page;

  global.getApp = () => ({ globalData: {} });
  global.Page = definition => { page = definition; };

  try {
    delete require.cache[require.resolve(pagePath)];
    require(pagePath);

    const records = [{
      _id: 'menu-1',
      name: '家常菜',
      dishes: [{ id: 'dish-1', name: '番茄炒蛋', image: '' }]
    }];
    const prepared = page.prepareRecordsForDisplay(records, []);

    assert.equal(prepared.length, 1);
    assert.equal(prepared[0].dishes.length, 1);
    assert.equal(prepared[0].dishes[0].imageKey, '');
    assert.equal(prepared[0].dishes[0].image, '');
    assert.equal(prepared[0].dishes[0].recipeImageKey, '');
    assert.equal(prepared[0].dishes[0].recipeImage, '');
  } finally {
    delete require.cache[require.resolve(pagePath)];
    global.getApp = previousGetApp;
    global.Page = previousPage;
  }
});

test('order flow exposes recipe detail and two-person completion actions', () => {
  const fs = require('node:fs');
  const appConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../miniprogram/app.json'), 'utf8'));
  const foodSource = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/food/index.js'), 'utf8');
  const detailSource = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/food/order-detail/index.js'), 'utf8');
  const detailTemplate = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/food/order-detail/index.wxml'), 'utf8');

  assert.equal(appConfig.pages.includes('pages/food/order-detail/index'), true);
  assert.equal(foodSource.includes('recipeImage: dish.recipeImageKey'), true);
  assert.equal(foodSource.includes('api.readyOrder(orderId)'), true);
  assert.equal(foodSource.includes('api.confirmOrder(orderId)'), true);
  assert.equal(detailSource.includes("ready: '待确认'"), true);
  assert.equal(detailTemplate.includes('已经做好'), true);
  assert.equal(detailTemplate.includes('收到啦'), true);
});

test('food page templates only bind handlers that exist on their page', () => {
  const fs = require('node:fs');
  const previousGetApp = global.getApp;
  const previousPage = global.Page;

  function loadPage(pagePath) {
    let definition;
    global.getApp = () => ({ globalData: {} });
    global.Page = value => { definition = value; };
    delete require.cache[require.resolve(pagePath)];
    require(pagePath);
    return definition;
  }

  function assertHandlers(pagePath, templatePath) {
    const definition = loadPage(pagePath);
    const template = fs.readFileSync(templatePath, 'utf8');
    const names = [...template.matchAll(/(?:bind|catch)(?:tap|input|change|confirm)="([A-Za-z0-9_]+)"/g)]
      .map(match => match[1]);
    for (const name of names) assert.equal(typeof definition[name], 'function', `missing handler: ${name}`);
  }

  try {
    assertHandlers(
      path.join(__dirname, '../miniprogram/pages/food/index.js'),
      path.join(__dirname, '../miniprogram/pages/food/index.wxml')
    );
    assertHandlers(
      path.join(__dirname, '../miniprogram/pages/food/order-detail/index.js'),
      path.join(__dirname, '../miniprogram/pages/food/order-detail/index.wxml')
    );
  } finally {
    global.getApp = previousGetApp;
    global.Page = previousPage;
  }
});

test('menu and order lists defer recipe poster downloads until the recipe is opened', async () => {
  const pagePath = path.join(__dirname, '../miniprogram/pages/food/index.js');
  const mediaPath = path.join(__dirname, '../miniprogram/services/media.js');
  const previousGetApp = global.getApp;
  const previousPage = global.Page;
  let page;
  global.getApp = () => ({ globalData: {} });
  global.Page = definition => { page = definition; };
  const media = require(mediaPath);
  const previousResolveFiles = media.resolveFiles;
  let requestedKeys = [];
  media.resolveFiles = keys => {
    requestedKeys = keys.slice();
    return Promise.resolve({});
  };

  try {
    delete require.cache[require.resolve(pagePath)];
    require(pagePath);
    await page.resolveRecordImages([{
      _id: 'menu-1',
      dishes: [{ id: 'dish-1', image: 'cover-key', recipeImage: 'recipe-key' }]
    }]);
    assert.deepEqual(requestedKeys, ['cover-key']);
  } finally {
    media.resolveFiles = previousResolveFiles;
    delete require.cache[require.resolve(pagePath)];
    global.getApp = previousGetApp;
    global.Page = previousPage;
  }
});

test('menu editor refuses duplicate dish names', () => {
  const pagePath = path.join(__dirname, '../miniprogram/pages/food/index.js');
  const previousGetApp = global.getApp;
  const previousPage = global.Page;
  const previousWx = global.wx;
  let page;
  let toast = '';
  global.getApp = () => ({ globalData: {} });
  global.Page = definition => { page = definition; };
  global.wx = { showToast: options => { toast = options.title; } };

  try {
    delete require.cache[require.resolve(pagePath)];
    require(pagePath);
    const context = {
      data: { dishes: [{ id: '1', name: '番茄炒蛋' }], newDishName: '番茄炒蛋' },
      setData(patch) { Object.assign(this.data, patch); }
    };
    page.addDish.call(context);
    assert.equal(context.data.dishes.length, 1);
    assert.equal(toast, '同一菜单不能有重名菜品');
  } finally {
    delete require.cache[require.resolve(pagePath)];
    global.getApp = previousGetApp;
    global.Page = previousPage;
    global.wx = previousWx;
  }
});
