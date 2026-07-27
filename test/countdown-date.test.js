const test = require('node:test');
const assert = require('node:assert/strict');
const {
  formatDate,
  getDateStatus,
  toDateInputValue
} = require('../miniprogram/utils/date');

test('date-only values keep their calendar date', () => {
  assert.equal(toDateInputValue('2026-10-03'), '2026-10-03');
  assert.equal(formatDate('2026-10-03'), '2026年10月3日');
});

test('countdown uses the selected year instead of forcing an annual recurrence', () => {
  const today = new Date(2026, 6, 22);
  const oldDate = getDateStatus('2025-10-03', today);
  const futureDate = getDateStatus('2026-10-03', today);

  assert.ok(oldDate.days < 0);
  assert.equal(oldDate.daysUnit, '天前');
  assert.equal(futureDate.days, 73);
  assert.equal(futureDate.daysUnit, '天后');
});
