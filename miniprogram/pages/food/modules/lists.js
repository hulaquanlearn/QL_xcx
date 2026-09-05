// List requests have their own generation so late network/image responses cannot
// replace a newer refresh, filter, or account's data.
function createListMethods({ app, api }) {
  const coupleId = () => String(app.globalData.coupleId || app.globalData.userInfo?.coupleId || '');
  return {
    loadMenus() {
      const owner = coupleId();
      if (!owner) return Promise.resolve([]);
      const sequence = this._menuSequence = (this._menuSequence || 0) + 1;
      const current = () => !this.pageUnloading && sequence === this._menuSequence && owner === coupleId();
      this.setData({ menusLoading: true });
      return api.list('menus', { limit: 200 }).then(rows => {
        if (!current()) return [];
        const source = rows.map(menu => ({ ...menu, dishes: Array.isArray(menu.dishes) ? menu.dishes : [] }));
        const menus = this.prepareRecordsForDisplay(source, this.data.menus);
        const activeMenuId = this.data.activeMenuId !== 'all' && !menus.some(menu => String(menu._id) === String(this.data.activeMenuId))
          ? 'all' : this.data.activeMenuId;
        this.setData({ menus, activeMenuId, menusLoading: false });
        this.resolveRecordImages(source).then(resolved => {
          if (current()) this.setData({ menus: resolved });
        }).catch(() => {});
        return menus;
      }).catch(error => {
        if (current()) throw error;
        return [];
      }).finally(() => {
        if (current()) this.setData({ menusLoading: false });
      });
    },

    loadOrders(reset = true) {
      const owner = coupleId();
      if (!owner || (!reset && (this.data.ordersLoading || !this.data.ordersHasMore))) return Promise.resolve([]);
      if (reset) this._orderSequence = (this._orderSequence || 0) + 1;
      const sequence = this._orderSequence;
      const status = this.data.orderStatus || 'all';
      const current = () => !this.pageUnloading && sequence === this._orderSequence
        && status === this.data.orderStatus && owner === coupleId();
      const params = { limit: 20 };
      if (status !== 'all') params.status = status;
      if (!reset && this.data.ordersNextCursor) params.cursor = this.data.ordersNextCursor;
      this.setData({ ordersLoading: true, ordersError: '' });
      return api.listPage('orders', params).then(page => {
        if (!current()) return [];
        const source = this.formatOrdersTime(Array.isArray(page.items) ? page.items : []);
        const prepared = this.prepareRecordsForDisplay(source, this.data.orders);
        const previous = reset ? [] : this.data.orders;
        const known = new Set(previous.map(order => String(order._id)));
        const orders = previous.concat(prepared.filter(order => !known.has(String(order._id))));
        this.setData({ orders, ordersHasMore: Boolean(page.hasMore), ordersNextCursor: page.nextCursor || '', ordersLoading: false });
        this.resolveRecordImages(source).then(resolved => {
          if (!current()) return;
          const imagesById = new Map(resolved.map(order => [String(order._id), order]));
          this.setData({ orders: this.data.orders.map(order => imagesById.get(String(order._id)) || order) });
        }).catch(() => {});
        return orders;
      }).catch(error => {
        if (current()) {
          this._ordersRetryReset = reset;
          this.setData({ ordersError: error.message || '订单加载失败' });
        }
        return [];
      }).finally(() => {
        if (current()) this.setData({ ordersLoading: false });
      });
    },

    loadMoreOrders() { return this.loadOrders(false); },
    retryOrders() { return this.loadOrders(this._ordersRetryReset !== false); },
    selectOrderStatus(e) {
      const status = String(e.currentTarget.dataset.status || 'all');
      if (!['all', 'pending', 'accepted', 'ready', 'completed'].includes(status) || status === this.data.orderStatus) return;
      this.setData({ orderStatus: status, orders: [], ordersNextCursor: '', ordersHasMore: true });
      return this.loadOrders();
    },
    onReachBottom() {
      if (this.data.activeTab === 'orders') return this.loadMoreOrders();
    }
  };
}

module.exports = createListMethods;
