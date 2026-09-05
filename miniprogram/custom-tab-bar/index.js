const auth = require('../services/auth');
Component({
  data: {
    selected: 0,
    visible: false,
    tabs: [
      { path: '/pages/index/index', text: '首页', icon: '/images/icons/首页.png' },
      { path: '/pages/period/index', text: '经期', icon: '/images/icons/田园犬.png' },
      { path: '/pages/mine/index', text: '我的', icon: '/images/icons/我的.png' }
    ]
  },
  pageLifetimes: {
    show() {
      const pages = getCurrentPages();
      const route = '/' + (pages[pages.length - 1]?.route || '');
      const selected = this.data.tabs.findIndex(tab => tab.path === route);
      this.setData({ selected: Math.max(0, selected), visible: Boolean(auth.getToken()) });
    }
  },
  methods: {
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index);
      if (!auth.getToken() || !this.data.tabs[index] || index === this.data.selected || this._switching) return;
      this._switching = true;
      wx.switchTab({ url: this.data.tabs[index].path, complete: () => { this._switching = false; } });
    }
  }
});
