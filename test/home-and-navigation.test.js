const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { selectHomeAnniversary } = require('../miniprogram/utils/home');

test('home title, date and days always come from the same selected anniversary', () => {
  const rows = [{ title: '相识', date: '2025-01-01', isAnniversary: true }, { title: '旅行', date: '2026-09-10', isTop: true }];
  const selected = selectHomeAnniversary(rows, new Date(2026, 8, 5));
  assert.equal(selected.pinnedAnniversary.title, '旅行');
  assert.equal(selected.loveDays, 5);
  assert.equal(selected.daysUnit, '天后');
  assert.equal(selectHomeAnniversary(rows, new Date(2026, 8, 10)).loveDays, '今天');
  assert.equal(selectHomeAnniversary(rows, new Date(2026, 8, 11)).daysUnit, '天前');
  assert.equal(selectHomeAnniversary([{ date: 'bad', isTop: true }]).pinnedAnniversary, null);
});

test('custom tab bar synchronizes all three root pages and hides for signed-out sessions', () => {
  const auth = require('../miniprogram/services/auth');
  const oldToken = auth.getToken;
  const { syncTabBar } = require('../miniprogram/services/navigation');
  const updates = [];
  const page = { getTabBar: () => ({ setData: value => updates.push(value) }) };
  try {
    auth.getToken = () => 'session';
    syncTabBar(page, 1);
    assert.deepEqual(updates.pop(), { selected: 1, visible: true });
    auth.getToken = () => '';
    syncTabBar(page, 0);
    assert.deepEqual(updates.pop(), { selected: 0, visible: false });
    syncTabBar({}, 0);
    for (const name of ['index', 'period', 'mine']) {
      const source = fs.readFileSync(path.join(__dirname, `../miniprogram/pages/${name}/index.js`), 'utf8');
      assert.match(source, /syncTabBar\(this,/);
    }
  } finally { auth.getToken = oldToken; }
});
