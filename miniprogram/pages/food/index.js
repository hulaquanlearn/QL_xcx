// pages/food/index.js
const app = getApp();
const api = require('../../services/api');
const mediaService = require('../../services/media');

Page({
  data: {
    activeTab: 'order',
    activeMenuId: 'all',
    menuName: '',
    dishes: [],
    newDishName: '',
    menus: [],
    menuIndex: 0,
    selectedDishes: [],
    selectedSummary: '',
    uploading: false,
    editingMenu: null,
    showMenuModal: false,
    modalMenuName: '',
    showBatchModal: false,
    batchMenuText: '',
    importingMenus: false,
    mealType: 'lunch',
    mealTypes: [
      { value: 'breakfast', label: '早餐' },
      { value: 'lunch', label: '午餐' },
      { value: 'dinner', label: '晚餐' },
      { value: 'snack', label: '零食' }
    ],
    orders: []
  },

  onLoad(options = {}) {
    const tabMap = { upload: 'manage', manage: 'manage', order: 'order', orders: 'orders' };
    this.setData({ activeTab: tabMap[options.tab] || 'order' });
  },

  onShow() {
    if (this.checkLogin()) this.loadPageData();
  },

  checkLogin() {
    if (!app.globalData.openid || !app.globalData.coupleId) {
      wx.redirectTo({ url: '/pages/index/index' });
      return false;
    }
    return true;
  },

  loadPageData() {
    let request;
    if (this.data.activeTab === 'orders') request = this.loadOrders();
    else if (this.data.activeTab === 'manage') request = this.loadMenus();
    else request = Promise.all([this.loadMenus(), this.loadOrders()]);
    return Promise.resolve(request).catch(err => {
      console.error('加载菜单页数据失败：', err);
      wx.showToast({ title: '数据加载失败', icon: 'none' });
    });
  },

  loadMenus() {
    const db = wx.cloud.database();
    const coupleId = app.globalData.coupleId || app.globalData.userInfo?.coupleId;
    if (!coupleId) return Promise.resolve([]);

    return db.collection('menus').where({ coupleId }).orderBy('createTime', 'desc').get().then(res => {
      const sourceMenus = (res.data || []).map(menu => ({
        ...menu,
        dishes: Array.isArray(menu.dishes) ? menu.dishes : []
      }));
      const menus = this.prepareRecordsForDisplay(sourceMenus, this.data.menus);
      const activeMenuId = this.data.activeMenuId !== 'all' && !menus.some(menu => menu._id === this.data.activeMenuId)
        ? 'all'
        : this.data.activeMenuId;
      this.setData({ menus, activeMenuId });
      return this.resolveRecordImages(sourceMenus).then(resolvedMenus => {
        this.setData({ menus: resolvedMenus });
        setTimeout(() => this.migrateLegacyImages('menus', sourceMenus), 300);
        return resolvedMenus;
      });
    }).catch(err => {
      console.error('获取菜单失败：', err);
      throw err;
    });
  },

  loadOrders() {
    const db = wx.cloud.database();
    const coupleId = app.globalData.coupleId || app.globalData.userInfo?.coupleId;
    if (!coupleId) return Promise.resolve([]);

    return db.collection('orders').where({ coupleId }).orderBy('createTime', 'desc').limit(30).get().then(res => {
      const sourceOrders = this.formatOrdersTime(res.data || []);
      const orders = this.prepareRecordsForDisplay(sourceOrders, this.data.orders);
      this.setData({ orders });
      return this.resolveRecordImages(sourceOrders).then(resolvedOrders => {
        this.setData({ orders: resolvedOrders });
        setTimeout(() => this.migrateLegacyImages('orders', sourceOrders), 300);
        return resolvedOrders;
      });
    }).catch(err => {
      console.error('获取订单失败：', err);
      throw err;
    });
  },

  resolveRecordImages(records) {
    const keys = [];
    records.forEach(record => {
      (record.dishes || []).forEach(dish => {
        const key = dish.imageKey || dish.image;
        if (key) keys.push(key);
      });
    });
    return mediaService.resolveFiles(keys).then(urls => records.map(record => ({
      ...record,
      dishes: (record.dishes || []).map(dish => {
        const imageKey = dish.imageKey || dish.image || '';
        return { ...dish, imageKey, image: urls[imageKey] || '' };
      })
    })));
  },

  prepareRecordsForDisplay(records, currentRecords) {
    const currentById = new Map((currentRecords || []).map(record => [String(record._id), record]));
    return records.map(record => {
      const current = currentById.get(String(record._id));
      return {
        ...record,
        dishes: (record.dishes || []).map(dish => {
          const imageKey = dish.imageKey || dish.image || '';
          const currentDish = (current?.dishes || []).find(item =>
            String(item.id || item.name) === String(dish.id || dish.name)
          );
          const currentKey = currentDish?.imageKey || '';
          return {
            ...dish,
            imageKey,
            image: currentKey === imageKey ? (currentDish.image || '') : ''
          };
        })
      };
    });
  },

  migrateLegacyImages(resource, records) {
    const flag = `${resource}MigrationRunning`;
    if (this[flag]) return;
    const currentUserId = String(app.globalData.userInfo?.id || app.globalData.openid || '');
    const candidates = (records || []).filter(record =>
      (resource !== 'orders' || String(record.authorId || '') === currentUserId) &&
      (record.dishes || []).some(dish => String(dish.imageKey || dish.image || '').startsWith('cloud://'))
    );
    if (!candidates.length) return;
    this[flag] = true;
    Promise.all(candidates.map(record => Promise.all((record.dishes || []).map(dish => {
      const oldKey = dish.imageKey || dish.image || '';
      if (!String(oldKey).startsWith('cloud://')) return Promise.resolve({ ...dish, image: oldKey, imageKey: undefined });
      return mediaService.migrateCloudFile(oldKey, 'dish')
        .then(newKey => ({ ...dish, image: newKey, imageKey: undefined }));
    })).then(dishes => api.update(resource, record._id, { dishes }))))
      .then(() => resource === 'menus' ? this.loadMenus() : this.loadOrders())
      .catch(() => {})
      .finally(() => { this[flag] = false; });
  },

  formatOrdersTime(orders) {
    return orders.map(order => {
      let date = null;
      if (order.createTime && typeof order.createTime === 'object' && order.createTime.toDate) {
        date = order.createTime.toDate();
      } else if (order.createTime) {
        date = new Date(order.createTime);
      }
      return {
        ...order,
        menuName: Array.isArray(order.menuNames) ? order.menuNames.join('、') : (order.menuName || ''),
        formattedTime: this.formatDate(date),
        isMine: String(order.authorId || '') === String(app.globalData.userInfo?.id || app.globalData.openid || '')
      };
    });
  },

  formatDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '刚刚';
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${month}-${day} ${hours}:${minutes}`;
  },

  switchTab(e) {
    const activeTab = e.currentTarget.dataset.tab;
    this.setData({ activeTab });
    if (activeTab === 'orders') this.loadOrders();
    if (activeTab === 'order') Promise.all([this.loadMenus(), this.loadOrders()]).catch(() => {});
  },

  openMenuManager() {
    this.setData({ activeTab: 'manage' });
  },

  leaveMenuManager() {
    this.setData({ activeTab: 'order' });
  },

  selectMenuFilter(e) {
    this.setData({ activeMenuId: e.currentTarget.dataset.id });
  },

  selectMealType(e) {
    this.setData({ mealType: e.currentTarget.dataset.type });
  },

  selectExistingMenu(e) {
    const index = Number(e.detail.value);
    const selectedMenu = this.data.menus[index];
    if (!selectedMenu) return;
    this.setData({
      menuIndex: index,
      editingMenu: selectedMenu,
      menuName: selectedMenu.name,
      dishes: selectedMenu.dishes.map(dish => ({ ...dish }))
    });
  },

  showCreateMenuModal() {
    this.setData({ showMenuModal: true, modalMenuName: '' });
  },

  closeMenuModal() {
    this.setData({ showMenuModal: false, modalMenuName: '' });
  },

  showBatchImportModal() {
    this.setData({ showBatchModal: true, batchMenuText: '' });
  },

  closeBatchImportModal() {
    if (this.data.importingMenus) return;
    this.setData({ showBatchModal: false, batchMenuText: '' });
  },

  preventBubble() {},

  onModalMenuNameInput(e) {
    this.setData({ modalMenuName: e.detail.value });
  },

  onBatchMenuInput(e) {
    this.setData({ batchMenuText: e.detail.value });
  },

  parseBatchMenus() {
    const lines = String(this.data.batchMenuText || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    if (!lines.length) throw new Error('请先粘贴菜单内容');
    if (lines.length > 20) throw new Error('每次最多导入20个菜单');

    const names = new Set();
    return lines.map((line, menuIndex) => {
      const separator = line.search(/[:：]/);
      if (separator <= 0) throw new Error(`第${menuIndex + 1}行缺少冒号`);
      const name = line.slice(0, separator).trim();
      const dishNames = line.slice(separator + 1)
        .split(/[、,，;；]/)
        .map(value => value.trim())
        .filter(Boolean);
      if (!name) throw new Error(`第${menuIndex + 1}行菜单名称为空`);
      if (!dishNames.length) throw new Error(`第${menuIndex + 1}行没有菜品`);
      if (dishNames.length > 100) throw new Error(`第${menuIndex + 1}行菜品超过100道`);
      const nameKey = name.toLocaleLowerCase();
      if (names.has(nameKey) || this.menuNameExists(name)) {
        throw new Error(`菜单名称重复：${name}`);
      }
      names.add(nameKey);
      return {
        name,
        mealType: this.data.mealType,
        dishes: dishNames.map((dishName, dishIndex) => ({
          id: `batch-${Date.now()}-${menuIndex}-${dishIndex}`,
          name: dishName,
          image: ''
        }))
      };
    });
  },

  importMenus() {
    if (this.data.importingMenus) return;
    let menus;
    try {
      menus = this.parseBatchMenus();
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
      return;
    }
    this.setData({ importingMenus: true });
    api.batchCreateMenus(menus).then(result => {
      this.setData({ showBatchModal: false, batchMenuText: '' });
      wx.showToast({ title: `已导入${result.count}个菜单`, icon: 'success' });
      return this.loadMenus();
    }).catch(error => {
      wx.showToast({ title: error.message || '批量导入失败', icon: 'none' });
    }).finally(() => {
      this.setData({ importingMenus: false });
    });
  },

  confirmCreateMenu() {
    const name = this.data.modalMenuName.trim();
    if (!name) {
      wx.showToast({ title: '请输入菜单名称', icon: 'none' });
      return;
    }
    if (this.menuNameExists(name)) {
      wx.showToast({ title: '菜单名称不能重复', icon: 'none' });
      return;
    }
    this.setData({
      editingMenu: null,
      menuName: name,
      dishes: [],
      newDishName: '',
      showMenuModal: false,
      modalMenuName: ''
    });
  },

  onMenuNameInput(e) {
    this.setData({ menuName: e.detail.value });
  },

  menuNameExists(name, excludeId = '') {
    const key = String(name || '').trim().toLocaleLowerCase();
    return this.data.menus.some(menu =>
      String(menu._id) !== String(excludeId) &&
      String(menu.name || '').trim().toLocaleLowerCase() === key
    );
  },

  onNewDishNameInput(e) {
    this.setData({ newDishName: e.detail.value });
  },

  addDish() {
    const name = this.data.newDishName.trim();
    if (!name) {
      wx.showToast({ title: '请输入菜品名称', icon: 'none' });
      return;
    }
    this.setData({
      dishes: [...this.data.dishes, { id: `${Date.now()}-${this.data.dishes.length}`, name, image: '', imageKey: '' }],
      newDishName: ''
    });
  },

  removeDish(e) {
    const index = Number(e.currentTarget.dataset.index);
    const removedKey = this.data.dishes[index]?.imageKey || '';
    this.setData({ dishes: this.data.dishes.filter((_, dishIndex) => dishIndex !== index) });
    if (removedKey) mediaService.remove(removedKey);
  },

  chooseDishImage(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (this.data.dishes[index]?.imageUploading) return;
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: res => this.uploadDishImage(res.tempFilePaths[0], index)
    });
  },

  uploadDishImage(tempFilePath, index) {
    if (!app.globalData.coupleId) return;
    const target = this.data.dishes[index];
    if (!target) return;
    const targetId = target.id;
    const previousKey = target.imageKey || '';
    const previousImage = target.image || '';
    this.pendingImageUploads = (this.pendingImageUploads || 0) + 1;
    this.setData({
      uploading: true,
      dishes: this.data.dishes.map(dish => dish.id === targetId
        ? { ...dish, image: tempFilePath, imageUploading: true }
        : dish)
    });
    mediaService.upload(tempFilePath, 'dish').then(result => {
      if (!this.data.dishes.some(dish => dish.id === targetId)) {
        mediaService.remove(result.key);
        return;
      }
      const dishes = this.data.dishes.map(dish => dish.id === targetId
        ? { ...dish, imageKey: result.key, image: tempFilePath, imageUploading: false }
        : dish);
      this.setData({ dishes });
      if (previousKey && previousKey !== result.key) mediaService.remove(previousKey);
    }).catch(err => {
      console.error('上传菜品图片失败：', err);
      this.setData({
        dishes: this.data.dishes.map(dish => dish.id === targetId
          ? { ...dish, imageKey: previousKey, image: previousImage, imageUploading: false }
          : dish)
      });
      wx.showToast({ title: err.message || '图片上传失败', icon: 'none' });
    }).finally(() => {
      this.pendingImageUploads = Math.max(0, (this.pendingImageUploads || 1) - 1);
      this.setData({ uploading: this.pendingImageUploads > 0 });
    });
  },

  uploadMenu() {
    if (this.data.uploading) {
      wx.showToast({ title: '请等待菜品图片上传完成', icon: 'none' });
      return;
    }
    const { menuName, dishes, editingMenu, mealType } = this.data;
    const name = menuName.trim();
    const validDishes = dishes.filter(dish => dish.name && dish.name.trim()).map(dish => ({
      id: dish.id,
      name: dish.name.trim(),
      image: dish.imageKey || (String(dish.image || '').startsWith('cloud://') ? dish.image : '')
    }));
    if (!name) {
      wx.showToast({ title: '请先新建或选择菜单', icon: 'none' });
      return;
    }
    if (!validDishes.length) {
      wx.showToast({ title: '请添加至少一道菜', icon: 'none' });
      return;
    }
    if (this.menuNameExists(name, editingMenu?._id || '')) {
      wx.showToast({ title: '菜单名称不能重复', icon: 'none' });
      return;
    }

    const db = wx.cloud.database();
    const request = editingMenu
      ? db.collection('menus').doc(editingMenu._id).update({ data: { name, mealType, dishes: validDishes, updateTime: db.serverDate() } })
      : db.collection('menus').add({ data: { name, mealType, dishes: validDishes, coupleId: app.globalData.coupleId, createTime: db.serverDate() } });

    wx.showLoading({ title: editingMenu ? '保存中' : '创建中' });
    request.then(() => {
      wx.hideLoading();
      wx.showToast({ title: editingMenu ? '菜单已更新' : '菜单已创建', icon: 'success' });
      this.setData({ editingMenu: null, menuName: '', dishes: [], newDishName: '' });
      return this.loadMenus();
    }).catch(err => {
      wx.hideLoading();
      console.error('保存菜单失败：', err);
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    });
  },

  deleteMenu() {
    const { editingMenu } = this.data;
    if (!editingMenu) return;
    wx.showModal({
      title: '删除菜单',
      content: `确定删除“${editingMenu.name}”吗？`,
      confirmColor: '#B6544B',
      success: res => {
        if (!res.confirm) return;
        wx.cloud.database().collection('menus').doc(editingMenu._id).remove().then(() => {
          this.setData({ editingMenu: null, menuName: '', dishes: [] });
          wx.showToast({ title: '菜单已删除', icon: 'success' });
          return this.loadMenus();
        }).catch(err => {
          console.error('删除菜单失败：', err);
          wx.showToast({ title: '删除失败', icon: 'none' });
        });
      }
    });
  },

  toggleDish(e) {
    const dish = e.currentTarget.dataset.dish;
    const menuId = String(e.currentTarget.dataset.menuid);
    const menuName = e.currentTarget.dataset.menuname;
    const selectedDishes = [...this.data.selectedDishes];
    const index = selectedDishes.findIndex(item => String(item.menuId) === menuId && item.name === dish.name);
    if (index >= 0) selectedDishes.splice(index, 1);
    else selectedDishes.push({ ...dish, menuId, menuName });
    this.setData({
      selectedDishes,
      selectedSummary: selectedDishes.map(item => item.name).join('、')
    });
  },

  submitOrder() {
    const { selectedDishes, mealType, mealTypes } = this.data;
    if (!selectedDishes.length) {
      wx.showToast({ title: '先选几道想吃的菜', icon: 'none' });
      return;
    }
    const mealLabel = mealTypes.find(item => item.value === mealType)?.label || '午餐';
    wx.showModal({
      title: `发出${mealLabel}点单`,
      content: selectedDishes.map(item => item.name).join('、'),
      confirmText: '发给 TA',
      cancelText: '再看看',
      success: res => {
        if (res.confirm) this.doSubmitOrder();
      }
    });
  },

  doSubmitOrder() {
    const { selectedDishes, mealType } = this.data;
    const menuNames = [...new Set(selectedDishes.map(item => item.menuName))];
    const storedDishes = selectedDishes.map(dish => ({
      id: dish.id,
      name: dish.name,
      image: dish.imageKey || (String(dish.image || '').startsWith('cloud://') ? dish.image : ''),
      menuId: dish.menuId,
      menuName: dish.menuName
    }));
    const orderData = {
      menuNames,
      dishes: storedDishes,
      mealType,
      coupleId: app.globalData.coupleId,
      createTime: wx.cloud.database().serverDate()
    };
    wx.showLoading({ title: '发送中' });
    wx.cloud.database().collection('orders').add({ data: orderData }).then(() => {
      wx.hideLoading();
      this.setData({ selectedDishes: [], selectedSummary: '', activeTab: 'orders' });
      wx.showToast({ title: '已经发给 TA', icon: 'success' });
      return this.loadOrders();
    }).catch(err => {
      wx.hideLoading();
      console.error('提交点单失败：', err);
      wx.showToast({ title: '发送失败', icon: 'none' });
    });
  },

  acceptOrder(e) {
    const orderId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '接下这份点单',
      content: '接单后，对方会在订单列表中看到。',
      confirmText: '接单',
      success: res => {
        if (!res.confirm) return;
        api.acceptOrder(orderId).then(() => {
          wx.showToast({ title: '已接单', icon: 'success' });
          return this.loadOrders();
        }).catch(err => {
          console.error('接单失败：', err);
          wx.showToast({ title: err.message || '接单失败', icon: 'none' });
        });
      }
    });
  },

  deleteOrder(e) {
    const orderId = e.currentTarget.dataset.id;
    const order = this.data.orders.find(item => item._id === orderId);
    if (!order) return;
    if (!order.isMine && order.authorId) {
      wx.showToast({ title: '只能删除自己发起的点单', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '删除点单',
      content: '删除后无法恢复，确定继续吗？',
      confirmColor: '#B6544B',
      success: res => {
        if (!res.confirm) return;
        wx.cloud.database().collection('orders').doc(orderId).remove().then(() => {
          wx.showToast({ title: '已删除', icon: 'success' });
          return this.loadOrders();
        }).catch(err => {
          console.error('删除点单失败：', err);
          wx.showToast({ title: '删除失败', icon: 'none' });
        });
      }
    });
  },

  onShareAppMessage() {
    return {
      title: '今天吃什么',
      path: '/pages/food/index'
    };
  }
});
