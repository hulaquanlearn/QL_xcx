const app = getApp();
const api = require('../../../services/api');

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
    saving: false,
    generating: false,
    mealTypes
  },

  onLoad() {
    if (!app.globalData.userId || !app.globalData.coupleId) {
      wx.redirectTo({ url: '/pages/index/index' });
      return;
    }
    this.setWeek(mondayOf(new Date()));
  },

  onShow() { if (this.data.weekStart) this.loadData(); },
  onPullDownRefresh() { Promise.resolve(this.loadData()).finally(() => wx.stopPullDownRefresh()); },

  setWeek(monday) {
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    this.setData({
      weekStart: dateOnly(monday),
      weekLabel: `${pad(monday.getMonth() + 1)}.${pad(monday.getDate())} — ${pad(sunday.getMonth() + 1)}.${pad(sunday.getDate())}`,
      days: dayLabels.map((label, index) => {
        const date = new Date(monday);
        date.setDate(monday.getDate() + index);
        return { index, label, date: `${pad(date.getMonth() + 1)}.${pad(date.getDate())}`, lunch: '', dinner: '' };
      })
    });
  },

  changeWeek(e) {
    const monday = new Date(`${this.data.weekStart}T00:00:00`);
    monday.setDate(monday.getDate() + Number(e.currentTarget.dataset.offset || 0) * 7);
    this.setWeek(monday);
    this.loadData();
  },

  loadData() {
    this.setData({ loading: true });
    return Promise.all([api.list('menus', { limit: 200 }), api.getWeekPlan(this.data.weekStart)])
      .then(([menus, week]) => {
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
      }).catch(error => {
        this.setData({ loading: false });
        wx.showToast({ title: error.message || '周菜单加载失败', icon: 'none' });
      });
  },

  selectPlanMenu(e) {
    const dayIndex = Number(e.currentTarget.dataset.day);
    const mealType = e.currentTarget.dataset.meal;
    const option = this.data.menuOptions[Number(e.detail.value)] || this.data.menuOptions[0];
    const plans = this.data.plans.filter(item => !(item.dayIndex === dayIndex && item.mealType === mealType));
    if (option.id) plans.push({ dayIndex, mealType, menuId: option.id, menuName: option.label });
    const days = this.data.days.map(day => day.index === dayIndex ? { ...day, [mealType]: option.id ? option.label : '' } : day);
    this.setData({ plans, days });
  },

  savePlan() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    const entries = this.data.plans.map(({ dayIndex, mealType, menuId }) => ({ dayIndex, mealType, menuId }));
    api.saveWeekPlan(this.data.weekStart, entries)
      .then(() => wx.showToast({ title: '本周安排已保存', icon: 'success' }))
      .catch(error => wx.showToast({ title: error.message || '保存失败', icon: 'none' }))
      .finally(() => this.setData({ saving: false }));
  },

  generateShopping() {
    if (this.data.generating) return;
    this.setData({ generating: true });
    const entries = this.data.plans.map(({ dayIndex, mealType, menuId }) => ({ dayIndex, mealType, menuId }));
    api.saveWeekPlan(this.data.weekStart, entries).then(() => api.generateShopping(this.data.weekStart)).then(result => {
      wx.showToast({ title: result.count ? `生成${result.count}项` : '菜品还没有食材说明', icon: 'none' });
      return this.loadData();
    }).catch(error => wx.showToast({ title: error.message || '生成失败', icon: 'none' }))
      .finally(() => this.setData({ generating: false }));
  },

  onShoppingInput(e) { this.setData({ newShoppingName: e.detail.value }); },
  addShopping() {
    const name = this.data.newShoppingName.trim();
    if (!name) return wx.showToast({ title: '请输入要买的东西', icon: 'none' });
    return api.addShopping(this.data.weekStart, name).then(() => {
      this.setData({ newShoppingName: '' });
      return this.loadData();
    }).catch(error => wx.showToast({ title: error.message || '添加失败', icon: 'none' }));
  },
  toggleShopping(e) {
    const item = this.data.shopping.find(value => value.id === String(e.currentTarget.dataset.id));
    if (!item) return;
    api.updateShopping(item.id, !item.checked).then(() => this.loadData())
      .catch(error => wx.showToast({ title: error.message || '操作失败', icon: 'none' }));
  },
  deleteShopping(e) {
    api.deleteShopping(String(e.currentTarget.dataset.id)).then(() => this.loadData())
      .catch(error => wx.showToast({ title: error.message || '删除失败', icon: 'none' }));
  }
});

module.exports = { dateOnly, mondayOf };
