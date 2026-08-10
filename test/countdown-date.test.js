const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseDateTime,
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

test('SQL datetime strings are parsed without the iOS-incompatible Date constructor format', () => {
  const value = parseDateTime('2026-07-27 14:50:05');
  assert.equal(value.getFullYear(), 2026);
  assert.equal(value.getMonth(), 6);
  assert.equal(value.getDate(), 27);
  assert.equal(value.getHours(), 14);
  assert.equal(value.getMinutes(), 50);
  assert.equal(value.getSeconds(), 5);
});
