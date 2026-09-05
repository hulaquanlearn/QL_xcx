const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const helper = require('../miniprogram/utils/period');

test('home navigation places the period icon between home and profile without a duplicate card', () => {
  const template = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/index/index.wxml'), 'utf8');
  const navigation = fs.readFileSync(path.join(__dirname, '../miniprogram/custom-tab-bar/index.js'), 'utf8');
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../miniprogram/app.json'), 'utf8'));
  assert.ok(navigation.indexOf('/images/icons/首页.png') < navigation.indexOf('/images/icons/田园犬.png'));
  assert.ok(navigation.indexOf('/images/icons/田园犬.png') < navigation.indexOf('/images/icons/我的.png'));
  assert.equal(config.tabBar.custom, true);
  assert.deepEqual(config.tabBar.list.map(item => item.pagePath), ['pages/index/index', 'pages/period/index', 'pages/mine/index']);
  assert.match(navigation, /wx.switchTab/);
  assert.doesNotMatch(template, /class="bottom-nav"/);
  assert.doesNotMatch(template, /class="period-entry"/);
  assert.ok(fs.existsSync(path.join(__dirname, '../miniprogram/images/icons/田园犬.png')));
});

test('period calendar handles leap days, cross-month records and predicted markers without string Date parsing', () => {
  const records = [{ startDate: '2024-02-28', endDate: '2024-03-03' }];
  const february = helper.calendar('2024-02', records, '2024-03-04', '2024-03-27');
  assert.equal(february.filter(cell => cell.label).length, 29);
  assert.equal(february.find(cell => cell.label === 29).recorded, true);
  const march = helper.calendar('2024-03', records, '2024-03-04', '2024-03-27');
  assert.equal(march.find(cell => cell.label === 3).recorded, true);
  assert.equal(march.find(cell => cell.label === 4).recorded, false);
  assert.equal(march.find(cell => cell.label === 4).today, true);
  assert.equal(march.find(cell => cell.label === 27).predicted, true);
  assert.equal(helper.moveMonth('2026-01', -1), '2025-12');
  assert.equal(helper.decorate([{ startDate: '2024-02-28', endDate: '2024-03-01' }], '2024-03-04')[0].duration, 3);
});

test('period page follows server roles, clears health state and ignores stale responses', async () => {
  const oldPage = global.Page;
  const oldGetApp = global.getApp;
  global.getApp = () => ({ globalData: {} });
  let definition;
  global.Page = value => { definition = value; };
  const api = require('../miniprogram/services/api');
  const oldPeriods = api.periods;
  try {
    require('../miniprogram/pages/period/index');
    const template = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/period/index.wxml'), 'utf8');
    for (const match of template.matchAll(/(?:bind|catch)(?:tap|change|touchmove)="(\w+)"/g)) assert.equal(typeof definition[match[1]], 'function', match[1]);
    const page = { ...definition, _visible: true, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
    const pending = [];
    api.periods = () => new Promise(resolve => pending.push(resolve));
    const first = page.load();
    const second = page.load();
    pending[1]({ available: false, role: 'male' });
    await Promise.resolve();
    pending[0]({ available: true, role: 'female', records: [{ id: '1', startDate: '2026-08-01', endDate: null, flow: 'heavy' }], today: '2026-08-04', summary: {} });
    await first;
    await second;
    assert.deepEqual(page.data.records, []);
    assert.equal(page.data.available, false);
    assert.equal(page.data.view, 'partner');
    assert.equal(page.data.sharing, false);
    page.openEditor();
    assert.equal(page.data.showEditor, false);
    assert.doesNotMatch(template, /bindtap="switchView"/);
    api.periods = async () => ({ available: false, role: 'unspecified' });
    await page.load();
    assert.equal(page.data.role, 'unspecified');
    api.periods = async () => ({ available: true, role: 'female', records: [], today: '2026-09-04', summary: {} });
    await page.load();
    assert.equal(page.data.view, 'self');
    page.openEditor();
    assert.equal(page.data.showEditor, true);
    api.periods = async () => ({ available: true, records: [] });
    await page.load();
    assert.equal(page.data.available, false);
    assert.match(page.data.error, /v2.10.1/);
    page.data.form = { flow: 'heavy' };
    page.data.summary = { activeDays: 5 };
    page.clearPrivateState();
    assert.deepEqual(page.data.form, {});
    assert.deepEqual(page.data.summary, {});
    assert.equal(page._visible, false);
    const source = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/period/index.js'), 'utf8');
    assert.doesNotMatch(source, /setStorage|onShareAppMessage/);
  } finally {
    api.periods = oldPeriods;
    global.Page = oldPage;
    global.getApp = oldGetApp;
  }
});
