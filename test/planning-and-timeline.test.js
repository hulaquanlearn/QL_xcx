const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('weekly planner and shared timeline are reachable from the mini-program', () => {
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../miniprogram/app.json'), 'utf8'));
  const api = fs.readFileSync(path.join(__dirname, '../miniprogram/services/api.js'), 'utf8');
  const food = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/food/index.wxml'), 'utf8');
  const activity = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/activity/index.wxml'), 'utf8');
  assert.equal(app.pages.includes('pages/food/planner/index'), true);
  assert.equal(api.includes('getWeekPlan:'), true);
  assert.equal(api.includes('saveWeekPlan:'), true);
  assert.equal(api.includes('generateShopping:'), true);
  assert.equal(api.includes('timeline:'), true);
  assert.equal(food.includes('bindtap="openPlanner"'), true);
  assert.equal(activity.includes('共同时间线'), true);
});

test('food display helpers live outside the main page controller', () => {
  const main = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/food/index.js'), 'utf8');
  const helper = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/food/modules/display.js'), 'utf8');
  assert.equal(main.includes("require('./modules/display')"), true);
  assert.equal(helper.includes('prepareRecordsForDisplay'), true);
  assert.equal(helper.includes('resolveRecordImages'), true);
});

test('planner and timeline templates only bind existing handlers', () => {
  const previousGetApp = global.getApp;
  const previousPage = global.Page;
  const previousWx = global.wx;
  global.getApp = () => ({ globalData: {} });
  global.wx = {};
  try {
    for (const relative of ['pages/food/planner/index', 'pages/activity/index']) {
      let definition;
      global.Page = value => { definition = value; };
      const pagePath = path.join(__dirname, `../miniprogram/${relative}.js`);
      delete require.cache[require.resolve(pagePath)];
      require(pagePath);
      const template = fs.readFileSync(path.join(__dirname, `../miniprogram/${relative}.wxml`), 'utf8');
      const handlers = [...template.matchAll(/(?:bind|catch)(?:tap|input|change|confirm)="([A-Za-z0-9_]+)"/g)]
        .map(match => match[1]);
      for (const handler of handlers) {
        assert.equal(typeof definition[handler], 'function', `${relative} missing handler ${handler}`);
      }
    }
  } finally {
    global.getApp = previousGetApp;
    global.Page = previousPage;
    global.wx = previousWx;
  }
});
