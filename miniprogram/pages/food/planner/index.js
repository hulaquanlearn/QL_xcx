const app = getApp();
const api = require('../../../services/api');
const mediaService = require('../../../services/media');

const mealTypes = [
  { value: 'lunch', label: '午餐' },
  { value: 'dinner', label: '晚餐' }
];
const dayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function pad(value) { return String(value).padStart(2, '0'); }
function dateOnly(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function mondayOf(date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  return result;
}

Page({
  data: {
    weekStart: '',
    weekLabel: '',
    days: [],
    menus: [],
    menuOptions: [{ id: '', label: '暂不安排' }],
    plans: [],
    shopping: [],
    shoppingDone: 0,
    newShoppingName: '',
    loading: false,
    loadError: '',
    saving: false,
    generating: false,
    dirty: false,
    sourceRecipe: null,
    sourceRecipeLoading: false,
    mealTypes
  },

  onLoad() {
    if (!app.globalData.userId || !app.globalData.coupleId) {
      wx.reLaunch({ url: '/pages/index/index' });
      return;
    }
    this.setWeek(mondayOf(new Date()));
  },

  onShow() { if (this.data.weekStart && !this.data.dirty) this.loadData(); },
  onPullDownRefresh() {
    this.confirmDiscardChanges().then(confirmed => confirmed ? this.loadData() : null)
      .finally(() => wx.stopPullDownRefresh());
  },

  setDirty(dirty) {
    this.setData({ dirty });
    if (dirty && typeof wx.enableAlertBeforeUnload === 'function') {
      wx.enableAlertBeforeUnload({ message: '本周安排还没有保存，确定离开吗？' });
    } else if (!dirty && typeof wx.disableAlertBeforeUnload === 'function') {
      wx.disableAlertBeforeUnload();
    }
  },

  confirmDiscardChanges() {
    if (this.data.saving || this.data.generating) return Promise.resolve(false);
    if (!this.data.dirty) return Promise.resolve(true);
    return new Promise(resolve => wx.showModal({
      title: '安排还没有保存',
      content: '继续会放弃本次修改。你也可以先返回保存。',
      confirmText: '放弃修改',
      cancelText: '继续编辑',
      success: result => resolve(Boolean(result.confirm)),
      fail: () => resolve(false)
    }));
  },

  setWeek(monday) {
    this._loadSequence = (this._loadSequence || 0) + 1;
    this._shoppingSequence = (this._shoppingSequence || 0) + 1;
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    this.setData({
      weekStart: dateOnly(monday),
      plans: [], shopping: [], shoppingDone: 0, newShoppingName: '', sourceRecipe: null, loadError: '',
      weekLabel: `${pad(monday.getMonth() + 1)}.${pad(monday.getDate())} — ${pad(sunday.getMonth() + 1)}.${pad(sunday.getDate())}`,
      days: dayLabels.map((label, index) => {
        const date = new Date(monday);
        date.setDate(monday.getDate() + index);
        return { index, label, date: `${pad(date.getMonth() + 1)}.${pad(date.getDate())}`, lunch: '', dinner: '' };
      })
    });
    this.setDirty(false);
  },

  changeWeek(e) {
    if (this.data.saving || this.data.generating) {
      wx.showToast({ title: '请等待本次操作完成', icon: 'none' });
      return Promise.resolve();
    }
    const offset = Number(e.currentTarget.dataset.offset || 0);
    const originalWeek = this.data.weekStart;
    return this.confirmDiscardChanges().then(confirmed => {
      if (!confirmed || originalWeek !== this.data.weekStart) return;
      const monday = new Date(`${this.data.weekStart}T00:00:00`);
      monday.setDate(monday.getDate() + offset * 7);
      this.setWeek(monday);
      return this.loadData();
    });
  },

  loadData() {
    const weekStart = this.data.weekStart;
    const sequence = this._loadSequence = (this._loadSequence || 0) + 1;
    this._shoppingSequence = (this._shoppingSequence || 0) + 1;
    const isCurrent = () => !this._unloaded && sequence === this._loadSequence && weekStart === this.data.weekStart;
    this.setData({ loading: true, loadError: '' });
    return Promise.all([api.list('menus', { limit: 200 }), api.getWeekPlan(weekStart)])
      .then(([menus, week]) => {
        if (!isCurrent()) return;
        const menuOptions = [{ id: '', label: '暂不安排' }].concat(menus.map(menu => ({ id: menu._id, label: menu.name })));
        const plans = week.plans || [];
        const bySlot = new Map(plans.map(item => [`${item.dayIndex}:${item.mealType}`, item.menuName]));
        const days = this.data.days.map(day => ({
          ...day,
          lunch: bySlot.get(`${day.index}:lunch`) || '',
          dinner: bySlot.get(`${day.index}:dinner`) || ''
        }));
        const shopping = week.shopping || [];
        this.setData({ menus, menuOptions, plans, days, shopping, shoppingDone: shopping.filter(item => item.checked).length, loading: false });
        this.setDirty(false);
      }).catch(error => {
        if (!isCurrent()) return;
        this.setData({ loading: false, loadError: error.message || '周菜单加载失败' });
        wx.showToast({ title: error.message || '周菜单加载失败', icon: 'none' });
      });
  },

  selectPlanMenu(e) {
    if (this.data.loading || this.data.loadError || this.data.saving || this.data.generating) return;
    const dayIndex = Number(e.currentTarget.dataset.day);
    const mealType = e.currentTarget.dataset.meal;
    const option = this.data.menuOptions[Number(e.detail.value)] || this.data.menuOptions[0];
    const plans = this.data.plans.filter(item => !(item.dayIndex === dayIndex && item.mealType === mealType));
    if (option.id) plans.push({ dayIndex, mealType, menuId: option.id, menuName: option.label });
    const days = this.data.days.map(day => day.index === dayIndex ? { ...day, [mealType]: option.id ? option.label : '' } : day);
    this.setData({ plans, days });
    this.setDirty(true);
  },

  savePlan() {
    if (this.data.loading || this.data.loadError || this.data.saving || this.data.generating) return Promise.resolve();
    const weekStart = this.data.weekStart;
    this.setData({ saving: true });
    const entries = this.data.plans.map(({ dayIndex, mealType, menuId }) => ({ dayIndex, mealType, menuId }));
    return api.saveWeekPlan(weekStart, entries)
      .then(() => {
        if (this._unloaded || weekStart !== this.data.weekStart) return;
        this.setDirty(false);
        wx.showToast({ title: '本周安排已保存', icon: 'success' });
      })
      .catch(error => wx.showToast({ title: error.message || '保存失败', icon: 'none' }))
      .finally(() => { if (!this._unloaded) this.setData({ saving: false }); });
  },

  generateShopping() {
    if (this.data.loading || this.data.loadError || this.data.saving || this.data.generating) return Promise.resolve();
    const weekStart = this.data.weekStart;
    this.setData({ generating: true });
    const entries = this.data.plans.map(({ dayIndex, mealType, menuId }) => ({ dayIndex, mealType, menuId }));
    return api.saveWeekPlan(weekStart, entries).then(() => {
      if (!this._unloaded && weekStart === this.data.weekStart) this.setDirty(false);
      return api.generateShopping(weekStart);
    }).then(result => {
      if (this._unloaded || weekStart !== this.data.weekStart) return;
      wx.showToast({ title: result.count ? `生成${result.count}项` : '菜品还没有食材说明', icon: 'none' });
      return this.refreshShopping(weekStart);
    }).catch(error => wx.showToast({ title: error.message || '生成失败', icon: 'none' }))
      .finally(() => { if (!this._unloaded) this.setData({ generating: false }); });
  },

  refreshShopping(weekStart = this.data.weekStart) {
    if (this._unloaded || weekStart !== this.data.weekStart) return Promise.resolve();
    const sequence = this._shoppingSequence = (this._shoppingSequence || 0) + 1;
    return api.getWeekPlan(weekStart).then(week => {
      if (this._unloaded || weekStart !== this.data.weekStart || sequence !== this._shoppingSequence) return;
      const shopping = week.shopping || [];
      this.setData({ shopping, shoppingDone: shopping.filter(item => item.checked).length });
    });
  },

  onShoppingInput(e) { this.setData({ newShoppingName: e.detail.value }); },
  addShopping() {
    if (this.data.loading || this._addingShopping) return;
    const weekStart = this.data.weekStart;
    const name = this.data.newShoppingName.trim();
    if (!name) return wx.showToast({ title: '请输入要买的东西', icon: 'none' });
    this._addingShopping = true;
    return api.addShopping(weekStart, name).then(() => {
      if (this._unloaded || weekStart !== this.data.weekStart) return;
      if (this.data.newShoppingName.trim() === name) this.setData({ newShoppingName: '' });
      return this.refreshShopping(weekStart);
    }).catch(error => wx.showToast({ title: error.message || '添加失败', icon: 'none' }))
      .finally(() => { this._addingShopping = false; });
  },
  toggleShopping(e) {
    if (this.data.loading) return;
    const item = this.data.shopping.find(value => value.id === String(e.currentTarget.dataset.id));
    if (!item) return;
    const weekStart = this.data.weekStart;
    if (!this._shoppingPending) this._shoppingPending = new Set();
    if (this._shoppingPending.has(item.id)) return;
    this._shoppingPending.add(item.id);
    return api.updateShopping(item.id, !item.checked).then(() => this.refreshShopping(weekStart))
      .catch(error => wx.showToast({ title: error.message || '操作失败', icon: 'none' }))
      .finally(() => this._shoppingPending.delete(item.id));
  },
  deleteShopping(e) {
    if (this.data.loading) return;
    const weekStart = this.data.weekStart;
    return api.deleteShopping(String(e.currentTarget.dataset.id)).then(() => this.refreshShopping(weekStart))
      .catch(error => wx.showToast({ title: error.message || '删除失败', icon: 'none' }));
  },

  openShoppingRecipe(e) {
    const { menuid, dishid } = e.currentTarget.dataset;
    const menu = this.data.menus.find(item => String(item._id) === String(menuid))
      || this.data.plans.find(item => String(item.menuId) === String(menuid));
    const dish = (menu?.dishes || []).find(item => String(item.id || item.name) === String(dishid));
    if (!dish) return wx.showToast({ title: '菜品已更新，请刷新本周安排', icon: 'none' });
    const token = this._recipeToken = (this._recipeToken || 0) + 1;
    const key = dish.recipeImageKey || dish.recipeImage || '';
    this.setData({ sourceRecipe: { ...dish, menuName: menu.name || menu.menuName, recipeImage: '' }, sourceRecipeLoading: Boolean(key) });
    if (!key) return Promise.resolve();
    return mediaService.resolveFiles([key]).then(urls => {
      if (this._unloaded || token !== this._recipeToken || !this.data.sourceRecipe) return;
      this.setData({ 'sourceRecipe.recipeImage': urls[key] || '' });
    }).catch(() => {
      if (token === this._recipeToken) wx.showToast({ title: '说明图暂时无法加载', icon: 'none' });
    }).finally(() => {
      if (!this._unloaded && token === this._recipeToken) this.setData({ sourceRecipeLoading: false });
    });
  },
  closeShoppingRecipe() { this._recipeToken = (this._recipeToken || 0) + 1; this.setData({ sourceRecipe: null, sourceRecipeLoading: false }); },
  preventBubble() {},
  previewRecipeImage() {
    const image = this.data.sourceRecipe?.recipeImage;
    if (image) wx.previewImage({ current: image, urls: [image] });
  },
  onUnload() {
    this._unloaded = true;
  }
});

module.exports = { dateOnly, mondayOf };
