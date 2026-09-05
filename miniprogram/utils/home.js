const dateUtils = require('./date');

function selectHomeAnniversary(rows, now = new Date()) {
  const valid = (Array.isArray(rows) ? rows : []).filter(item => item && dateUtils.parseDateOnly(item.date));
  const pinnedAnniversary = valid.find(item => item.isTop) || valid.find(item => item.isAnniversary) || valid[0] || null;
  if (!pinnedAnniversary) return { pinnedAnniversary: null, loveDays: 0, daysUnit: '' };
  const status = dateUtils.getDateStatus(pinnedAnniversary.date, now);
  return { pinnedAnniversary, loveDays: status.daysNum, daysUnit: status.daysUnit };
}

module.exports = { selectHomeAnniversary };
