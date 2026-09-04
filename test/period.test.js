const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const helper = require('../miniprogram/utils/period');

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

test('period page binds every handler, clears health state and ignores stale responses when switching views', async () => {
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
    page.switchView({ currentTarget: { dataset: { view: 'partner' } } });
    pending[1]({ available: false });
    await Promise.resolve();
    pending[0]({ available: true, records: [{ id: '1', startDate: '2026-08-01', endDate: null, flow: 'heavy' }], today: '2026-08-04', summary: {} });
    await first;
    assert.deepEqual(page.data.records, []);
    assert.equal(page.data.available, false);
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
