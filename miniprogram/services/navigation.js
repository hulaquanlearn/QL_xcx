const auth = require('./auth');

function syncTabBar(page, selected, visible = Boolean(auth.getToken())) {
  if (typeof page.getTabBar !== 'function') return;
  const bar = page.getTabBar();
  if (bar) bar.setData({ selected, visible });
}

module.exports = { syncTabBar };
