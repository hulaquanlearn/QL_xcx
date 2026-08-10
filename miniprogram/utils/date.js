const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateTime(value) {
  if (value && typeof value.toDate === 'function') return parseDateTime(value.toDate());
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const text = String(value || '').trim();
  const local = text.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/
  );
  if (local) {
    const milliseconds = Number(String(local[7] || '').padEnd(3, '0'));
    const date = new Date(
      Number(local[1]),
      Number(local[2]) - 1,
      Number(local[3]),
      Number(local[4] || 0),
      Number(local[5] || 0),
      Number(local[6] || 0),
      milliseconds
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const iso = text.includes(' ') ? text.replace(' ', 'T') : text;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(iso)) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateOnly(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function toDateInputValue(value) {
  const date = parseDateOnly(value);
  if (!date) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatDate(value) {
  const date = parseDateOnly(value);
  if (!date) return '';
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function dayNumber(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

function differenceFromToday(value, now = new Date()) {
  const target = parseDateOnly(value);
  if (!target) return null;
  return dayNumber(target) - dayNumber(now);
}

function getDateStatus(value, now = new Date()) {
  const difference = differenceFromToday(value, now);
  if (difference === null) return { days: 0, daysNum: '--', daysUnit: '', text: '日期无效' };
  if (difference > 0) return { days: difference, daysNum: difference, daysUnit: '天后', text: `还有${difference}天` };
  if (difference < 0) {
    const passed = Math.abs(difference);
    return { days: difference, daysNum: passed, daysUnit: '天前', text: `已过${passed}天` };
  }
  return { days: 0, daysNum: '今天', daysUnit: '', text: '今天' };
}

function getNextAnnualStatus(value, now = new Date()) {
  const source = parseDateOnly(value);
  if (!source) return { days: 0, text: '日期无效' };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(today.getFullYear(), source.getMonth(), source.getDate());
  if (next < today) next = new Date(today.getFullYear() + 1, source.getMonth(), source.getDate());
  const days = dayNumber(next) - dayNumber(today);
  return { days, text: days === 0 ? '今天' : `还有${days}天` };
}

module.exports = {
  parseDateTime,
  parseDateOnly,
  toDateInputValue,
  formatDate,
  differenceFromToday,
  getDateStatus,
  getNextAnnualStatus
};
