// pages/food/index.js
const app = getApp();
const api = require('../../services/api');
const mediaService = require('../../services/media');
const familyMenuPreset = require('../../data/family-menu-preset');
const dateUtils = require('../../utils/date');
const createDisplayMethods = require('./modules/display');

Page({
  ...createDisplayMethods({ app, dateUtils, mediaService }),
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
    showRecipeModal: false,
    recipeDishIndex: -1,
    recipeOriginalKey: '',
    recipeUploading: false,
    recipeDraft: {
      name: '',
      ingredients: '',
      steps: '',
      tips: '',
      recipeImage: '',
      recipeImageKey: ''
    },
    familyMenuPreset,
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
    this.temporaryMediaKeys = new Set();
    this.pageUnloading = false;
    const tabMap = { upload: 'manage', manage: 'manage', order: 'order', orders: 'orders' };
    this.setData({ activeTab: tabMap[options.tab] || 'order' });
  },

  onShow() {
    if (this.checkLogin()) this.loadPageData();
  },

  checkLogin() {
    if (!app.globalData.userId || !app.globalData.coupleId) {
      wx.redirectTo({ url: '/pages/index/index' });
      return false;
    }
    return true;
  },

  loadPageData() {
    let request;
    if (this.data.activeTab === 'orders') request = this.loadOrders();
    else request = this.loadMenus();
    return Promise.resolve(request).catch(err => {
      console.error('加载菜单页数据失败：', err);
      wx.showToast({ title: '数据加载失败', icon: 'none' });
    });
  },

  loadMenus() {
    const coupleId = app.globalData.coupleId || app.globalData.userInfo?.coupleId;
    if (!coupleId) return Promise.resolve([]);

    return api.list('menus', { limit: 200 }).then(rows => {
      const sourceMenus = rows.map(menu => ({
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
        return resolvedMenus;
      });
    }).catch(err => {
      console.error('获取菜单失败：', err);
      throw err;
    });
  },

  loadOrders() {
    const coupleId = app.globalData.coupleId || app.globalData.userInfo?.coupleId;
    if (!coupleId) return Promise.resolve([]);

    return api.list('orders', { limit: 50 }).then(rows => {
      const sourceOrders = this.formatOrdersTime(rows);
      const orders = this.prepareRecordsForDisplay(sourceOrders, this.data.orders);
      this.setData({ orders });
      return this.resolveRecordImages(sourceOrders).then(resolvedOrders => {
        this.setData({ orders: resolvedOrders });
        return resolvedOrders;
      });
    }).catch(err => {
      console.error('获取订单失败：', err);
      throw err;
    });
  },

  switchTab(e) {
    const activeTab = e.currentTarget.dataset.tab;
    this.setData({ activeTab });
    if (activeTab === 'orders') this.loadOrders();
    if (activeTab === 'order') this.loadMenus().catch(() => {});
  },

  openMenuManager() {
    this.setData({ activeTab: 'manage' });
  },

  openPlanner() {
    wx.navigateTo({ url: '/pages/food/planner/index' });
  },

  leaveMenuManager() {
    if (this.data.uploading || this.data.recipeUploading) {
      wx.showToast({ title: '请等待图片上传完成', icon: 'none' });
      return;
    }
    this.cleanupTemporaryMediaKeys();
    this.setData({
      activeTab: 'order',
      editingMenu: null,
      menuName: '',
      dishes: [],
      newDishName: '',
      showRecipeModal: false
    });
    this.loadMenus().catch(() => {});
  },

  selectMenuFilter(e) {
    this.setData({ activeMenuId: e.currentTarget.dataset.id });
  },

  selectMealType(e) {
    this.setData({ mealType: e.currentTarget.dataset.type });
  },

  selectExistingMenu(e) {
    if (this.data.uploading || this.data.recipeUploading) {
      wx.showToast({ title: '请等待图片上传完成', icon: 'none' });
      return;
    }
    const index = Number(e.detail.value);
    const selectedMenu = this.data.menus[index];
    if (!selectedMenu) return;
    this.cleanupTemporaryMediaKeys();
    this.setData({
      menuIndex: index,
      editingMenu: selectedMenu,
      menuName: selectedMenu.name,
      dishes: selectedMenu.dishes.map(dish => ({ ...dish }))
    });
  },

  showCreateMenuModal() {
    if (this.data.uploading || this.data.recipeUploading) {
      wx.showToast({ title: '请等待图片上传完成', icon: 'none' });
      return;
    }
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

  trackTemporaryMediaKey(key) {
    if (!key) return;
    if (!this.temporaryMediaKeys) this.temporaryMediaKeys = new Set();
    this.temporaryMediaKeys.add(key);
  },

  releaseTemporaryMediaKey(key) {
    if (key && this.temporaryMediaKeys) this.temporaryMediaKeys.delete(key);
  },

  removeTemporaryMediaKey(key) {
    if (!key || !this.temporaryMediaKeys?.has(key)) return Promise.resolve();
    this.temporaryMediaKeys.delete(key);
    return mediaService.remove(key);
  },

  cleanupTemporaryMediaKeys() {
    const keys = [...(this.temporaryMediaKeys || [])];
    if (this.temporaryMediaKeys) this.temporaryMediaKeys.clear();
    return Promise.all(keys.map(key => mediaService.remove(key))).catch(() => {});
  },

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
      const dishNameKeys = dishNames.map(value => value.toLocaleLowerCase());
      if (new Set(dishNameKeys).size !== dishNameKeys.length) {
        throw new Error(`第${menuIndex + 1}行存在重名菜品`);
      }
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

  importFamilyMenuPreset() {
    if (this.data.importingMenus) return;
    if (this.menuNameExists(familyMenuPreset.name)) {
      wx.showToast({ title: '家庭常用菜已存在', icon: 'none' });
      return;
    }

    const dishes = familyMenuPreset.dishes.map(dish => ({
      id: dish.id,
      name: dish.name,
      image: ''
    }));
    this.setData({ importingMenus: true });
    wx.showLoading({ title: '导入菜单' });
    api.batchCreateMenus([{
      name: familyMenuPreset.name,
      mealType: this.data.mealType,
      dishes
    }])
      .then(() => {
        wx.hideLoading();
        this.setData({ showBatchModal: false, batchMenuText: '' });
        wx.showToast({ title: '菜单已导入', icon: 'success' });
        return this.loadMenus();
      })
      .catch(error => {
        wx.hideLoading();
        wx.showToast({ title: error.message || '模板导入失败', icon: 'none' });
      })
      .finally(() => {
        this.setData({ importingMenus: false });
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
    this.cleanupTemporaryMediaKeys();
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
    const nameKey = name.toLocaleLowerCase();
    if (this.data.dishes.some(dish => String(dish.name || '').trim().toLocaleLowerCase() === nameKey)) {
      wx.showToast({ title: '同一菜单不能有重名菜品', icon: 'none' });
      return;
    }
    this.setData({
      dishes: [...this.data.dishes, { id: `${Date.now()}-${this.data.dishes.length}`, name, image: '', imageKey: '' }],
      newDishName: ''
    });
  },

  removeDish(e) {
    const index = Number(e.currentTarget.dataset.index);
    const removedDish = this.data.dishes[index] || {};
    const removedKeys = [removedDish.imageKey, removedDish.recipeImageKey].filter(Boolean);
    this.setData({ dishes: this.data.dishes.filter((_, dishIndex) => dishIndex !== index) });
    removedKeys.forEach(key => this.removeTemporaryMediaKey(key));
  },

  openRecipeEditor(e) {
    const index = Number(e.currentTarget.dataset.index);
    const dish = this.data.dishes[index];
    if (!dish) return;
    this.setData({
      showRecipeModal: true,
      recipeDishIndex: index,
      recipeOriginalKey: dish.recipeImageKey || '',
      recipeDraft: {
        name: dish.name,
        ingredients: dish.ingredients || '',
        steps: dish.steps || '',
        tips: dish.tips || '',
        recipeImage: dish.recipeImage || '',
        recipeImageKey: dish.recipeImageKey || ''
      }
    });
    const recipeKey = dish.recipeImageKey || '';
    if (recipeKey && !dish.recipeImage) {
      mediaService.resolveFiles([recipeKey]).then(urls => {
        if (!this.data.showRecipeModal || this.data.recipeDishIndex !== index) return;
        if (this.data.recipeUploading) return;
        if (this.data.recipeDraft.recipeImageKey !== recipeKey) return;
        this.setData({ 'recipeDraft.recipeImage': urls[recipeKey] || '' });
      }).catch(() => {});
    }
  },

  closeRecipeEditor() {
    if (this.data.recipeUploading) return;
    const draftKey = this.data.recipeDraft.recipeImageKey || '';
    if (draftKey && draftKey !== this.data.recipeOriginalKey) this.removeTemporaryMediaKey(draftKey);
    this.resetRecipeEditor();
  },

  resetRecipeEditor() {
    this.setData({
      showRecipeModal: false,
      recipeDishIndex: -1,
      recipeOriginalKey: '',
      recipeUploading: false,
      recipeDraft: {
        name: '',
        ingredients: '',
        steps: '',
        tips: '',
        recipeImage: '',
        recipeImageKey: ''
      }
    });
  },

  onRecipeInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!['ingredients', 'steps', 'tips'].includes(field)) return;
    this.setData({ [`recipeDraft.${field}`]: e.detail.value });
  },

  chooseRecipeImage() {
    if (this.data.recipeUploading) return;
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: res => this.uploadRecipeImage(res.tempFilePaths[0])
    });
  },

  uploadRecipeImage(tempFilePath) {
    const previousDraftKey = this.data.recipeDraft.recipeImageKey || '';
    const previousDraftImage = this.data.recipeDraft.recipeImage || '';
    this.setData({
      recipeUploading: true,
      'recipeDraft.recipeImage': tempFilePath
    });
    mediaService.upload(tempFilePath, 'recipe').then(result => {
      this.trackTemporaryMediaKey(result.key);
      if (this.pageUnloading) {
        this.removeTemporaryMediaKey(result.key);
        return;
      }
      this.setData({
        'recipeDraft.recipeImage': tempFilePath,
        'recipeDraft.recipeImageKey': result.key
      });
      if (previousDraftKey && previousDraftKey !== this.data.recipeOriginalKey && previousDraftKey !== result.key) {
        this.removeTemporaryMediaKey(previousDraftKey);
      }
    }).catch(error => {
      if (!this.pageUnloading) {
        this.setData({ 'recipeDraft.recipeImage': previousDraftImage });
        wx.showToast({ title: error.message || '说明图上传失败', icon: 'none' });
      }
    }).finally(() => {
      if (!this.pageUnloading) this.setData({ recipeUploading: false });
    });
  },

  clearRecipeImage() {
    if (this.data.recipeUploading) return;
    const draftKey = this.data.recipeDraft.recipeImageKey || '';
    if (draftKey && draftKey !== this.data.recipeOriginalKey) this.removeTemporaryMediaKey(draftKey);
    this.setData({
      'recipeDraft.recipeImage': '',
      'recipeDraft.recipeImageKey': ''
    });
  },

  saveRecipeEditor() {
    if (this.data.recipeUploading) {
      wx.showToast({ title: '请等待说明图上传完成', icon: 'none' });
      return;
    }
    const index = this.data.recipeDishIndex;
    if (!this.data.dishes[index]) return;
    const draft = this.data.recipeDraft;
    const dishes = this.data.dishes.map((dish, dishIndex) => dishIndex === index
      ? {
          ...dish,
          ingredients: String(draft.ingredients || '').trim(),
          steps: String(draft.steps || '').trim(),
          tips: String(draft.tips || '').trim(),
          recipeImage: draft.recipeImage || '',
          recipeImageKey: draft.recipeImageKey || ''
        }
      : dish);
    this.setData({ dishes });
    this.resetRecipeEditor();
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
      this.trackTemporaryMediaKey(result.key);
      if (this.pageUnloading || !this.data.dishes.some(dish => dish.id === targetId)) {
        this.removeTemporaryMediaKey(result.key);
        return;
      }
      const dishes = this.data.dishes.map(dish => dish.id === targetId
        ? { ...dish, imageKey: result.key, image: tempFilePath, imageUploading: false }
        : dish);
      this.setData({ dishes });
      if (previousKey && previousKey !== result.key) this.removeTemporaryMediaKey(previousKey);
    }).catch(err => {
      console.error('上传菜品图片失败：', err);
      if (!this.pageUnloading) {
        this.setData({
          dishes: this.data.dishes.map(dish => dish.id === targetId
            ? { ...dish, imageKey: previousKey, image: previousImage, imageUploading: false }
            : dish)
        });
        wx.showToast({ title: err.message || '图片上传失败', icon: 'none' });
      }
    }).finally(() => {
      this.pendingImageUploads = Math.max(0, (this.pendingImageUploads || 1) - 1);
      if (!this.pageUnloading) this.setData({ uploading: this.pendingImageUploads > 0 });
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
      image: dish.imageKey || '',
      recipeImage: dish.recipeImageKey || '',
      ingredients: String(dish.ingredients || '').trim(),
      steps: String(dish.steps || '').trim(),
      tips: String(dish.tips || '').trim()
    }));
    if (!name) {
      wx.showToast({ title: '请先新建或选择菜单', icon: 'none' });
      return;
    }
    if (!validDishes.length) {
      wx.showToast({ title: '请添加至少一道菜', icon: 'none' });
      return;
    }
    const dishNameKeys = validDishes.map(dish => dish.name.toLocaleLowerCase());
    if (new Set(dishNameKeys).size !== dishNameKeys.length) {
      wx.showToast({ title: '同一菜单不能有重名菜品', icon: 'none' });
      return;
    }
    if (this.menuNameExists(name, editingMenu?._id || '')) {
      wx.showToast({ title: '菜单名称不能重复', icon: 'none' });
      return;
    }

    const request = editingMenu
      ? api.update('menus', editingMenu._id, { name, mealType, dishes: validDishes })
      : api.create('menus', { name, mealType, dishes: validDishes });

    wx.showLoading({ title: editingMenu ? '保存中' : '创建中' });
    request.then(() => {
      validDishes.forEach(dish => {
        this.releaseTemporaryMediaKey(dish.image);
        this.releaseTemporaryMediaKey(dish.recipeImage);
      });
      this.cleanupTemporaryMediaKeys();
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
    if (this.data.uploading || this.data.recipeUploading) {
      wx.showToast({ title: '请等待图片上传完成', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '删除菜单',
      content: `确定删除“${editingMenu.name}”吗？`,
      confirmColor: '#B6544B',
      success: res => {
        if (!res.confirm) return;
        api.remove('menus', editingMenu._id).then(() => {
          this.cleanupTemporaryMediaKeys();
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
    const dishId = String(dish.id || dish.name);
    const selectedDishes = [...this.data.selectedDishes];
    const index = selectedDishes.findIndex(item =>
      String(item.menuId) === menuId && String(item.id || item.name) === dishId
    );
    if (index >= 0) selectedDishes.splice(index, 1);
    else {
      const sameName = selectedDishes.some(item =>
        String(item.name || '').trim().toLocaleLowerCase() === String(dish.name || '').trim().toLocaleLowerCase()
      );
      if (sameName) {
        wx.showToast({ title: '这道菜已经选过了', icon: 'none' });
        return;
      }
      selectedDishes.push({ ...dish, menuId, menuName });
    }
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
      image: dish.imageKey || '',
      recipeImage: dish.recipeImageKey || '',
      ingredients: dish.ingredients || '',
      steps: dish.steps || '',
      tips: dish.tips || ''
    }));
    const orderData = {
      menuNames,
      dishes: storedDishes,
      mealType
    };
    wx.showLoading({ title: '发送中' });
    api.create('orders', orderData).then(() => {
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
          return this.loadOrders().then(() => {
            wx.showModal({
              title: '已接下这份点单',
              content: '现在去看看食材和制作说明吧。',
              cancelText: '稍后查看',
              confirmText: '查看制作',
              success: modalResult => {
                if (modalResult.confirm) this.navigateToOrder(orderId);
              }
            });
          });
        }).catch(err => {
          console.error('接单失败：', err);
          wx.showToast({ title: err.message || '接单失败', icon: 'none' });
        });
      }
    });
  },

  markOrderReady(e) {
    const orderId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '已经做好了？',
      content: '确认后会通知下单人来确认收到。',
      confirmText: '已做好',
      success: res => {
        if (!res.confirm) return;
        api.readyOrder(orderId).then(() => {
          wx.showToast({ title: '已通知 TA', icon: 'success' });
          return this.loadOrders();
        }).catch(err => {
          wx.showToast({ title: err.message || '操作失败', icon: 'none' });
        });
      }
    });
  },

  confirmOrder(e) {
    const orderId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认收到',
      content: '确认收到后，这份点单将标记为已完成。',
      confirmText: '收到啦',
      success: res => {
        if (!res.confirm) return;
        api.confirmOrder(orderId).then(() => {
          wx.showToast({ title: '订单已完成', icon: 'success' });
          return this.loadOrders();
        }).catch(err => {
          wx.showToast({ title: err.message || '确认失败', icon: 'none' });
        });
      }
    });
  },

  navigateToOrder(orderId) {
    wx.navigateTo({ url: `/pages/food/order-detail/index?id=${encodeURIComponent(orderId)}` });
  },

  openOrderDetail(e) {
    this.navigateToOrder(e.currentTarget.dataset.id);
  },

  deleteOrder(e) {
    const orderId = e.currentTarget.dataset.id;
    const order = this.data.orders.find(item => item._id === orderId);
    if (!order) return;
    if (!order.isMine && order.authorId) {
      wx.showToast({ title: '只能删除自己发起的点单', icon: 'none' });
      return;
    }
    if (['accepted', 'ready'].includes(order.status)) {
      wx.showToast({ title: order.status === 'ready' ? '请先确认收到' : '对方已接单，暂不能删除', icon: 'none' });
      return;
    }
    wx.showModal({
      title: order.status === 'pending' ? '撤回点单' : '删除已完成记录',
      content: order.status === 'pending' ? '撤回后对方将无法接单，确定继续吗？' : '删除后无法恢复，确定继续吗？',
      confirmColor: '#B6544B',
      success: res => {
        if (!res.confirm) return;
        api.remove('orders', orderId).then(() => {
          wx.showToast({ title: order.status === 'pending' ? '已撤回' : '已删除', icon: 'success' });
          return this.loadOrders();
        }).catch(err => {
          console.error('删除点单失败：', err);
          wx.showToast({ title: '删除失败', icon: 'none' });
        });
      }
    });
  },

  onUnload() {
    this.pageUnloading = true;
    this.cleanupTemporaryMediaKeys();
  },

  onShareAppMessage() {
    return {
      title: '今天吃什么',
      path: '/pages/food/index'
    };
  }
});
