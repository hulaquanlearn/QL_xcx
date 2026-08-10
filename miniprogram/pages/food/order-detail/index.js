const app = getApp();
const api = require('../../../services/api');
const mediaService = require('../../../services/media');
const dateUtils = require('../../../utils/date');

const statusTextMap = {
  pending: '待接单',
  accepted: '制作中',
  ready: '待确认',
  completed: '已完成'
};

const statusStepMap = {
  pending: 0,
  accepted: 1,
  ready: 2,
  completed: 3
};

Page({
  data: {
    orderId: '',
    order: null,
    dishes: [],
    activeDishIndex: 0,
    activeDish: null,
    loading: true,
    isMine: false,
    isAcceptedByMe: false,
    statusText: '',
    progressStep: 0
  },

  onLoad(options = {}) {
    const orderId = String(options.id || '');
    if (!orderId) {
      wx.showToast({ title: '点单不存在', icon: 'none' });
      wx.navigateBack();
      return;
    }
    this.setData({ orderId });
  },

  onShow() {
    if (this.data.orderId) this.loadOrder();
  },

  loadOrder() {
    if (this.orderRequest) return this.orderRequest;
    this.setData({ loading: true });
    this.orderRequest = api.get('orders', this.data.orderId)
      .then(order => this.prepareOrder(order))
      .catch(error => {
        console.error('获取点单详情失败：', error);
        wx.showToast({ title: error.message || '获取详情失败', icon: 'none' });
      })
      .finally(() => {
        this.orderRequest = null;
        this.setData({ loading: false });
        wx.stopPullDownRefresh();
      });
    return this.orderRequest;
  },

  prepareOrder(order) {
    const sourceDishes = Array.isArray(order.dishes) ? order.dishes : [];
    const keys = [];
    sourceDishes.forEach(dish => {
      if (dish.image) keys.push(dish.image);
      if (dish.recipeImage) keys.push(dish.recipeImage);
    });
    return mediaService.resolveFiles(keys).then(urls => {
      const dishes = sourceDishes.map(dish => ({
        ...dish,
        imageKey: dish.image || '',
        image: urls[dish.image] || '',
        recipeImageKey: dish.recipeImage || '',
        recipeImage: urls[dish.recipeImage] || '',
        hasRecipe: Boolean(dish.recipeImage || dish.ingredients || dish.steps || dish.tips)
      }));
      const currentUserId = String(app.globalData.userInfo?.id || app.globalData.userId || '');
      const activeDishIndex = Math.min(this.data.activeDishIndex, Math.max(dishes.length - 1, 0));
      const preparedOrder = {
        ...order,
        menuName: Array.isArray(order.menuNames) && order.menuNames.length
          ? order.menuNames.join('、')
          : '这份点单',
        formattedTime: this.formatTime(order.createTime || order.createdAt)
      };
      this.setData({
        order: preparedOrder,
        dishes,
        activeDishIndex,
        activeDish: dishes[activeDishIndex] || null,
        isMine: String(order.authorId || '') === currentUserId,
        isAcceptedByMe: String(order.acceptedByUserId || '') === currentUserId,
        statusText: statusTextMap[order.status] || '状态未知',
        progressStep: statusStepMap[order.status] || 0
      });
    });
  },

  selectDish(e) {
    const index = Number(e.currentTarget.dataset.index);
    const activeDish = this.data.dishes[index];
    if (!activeDish) return;
    this.setData({ activeDishIndex: index, activeDish });
  },

  previewRecipeImage() {
    const current = this.data.activeDish?.recipeImage;
    if (!current) return;
    wx.previewImage({ current, urls: [current] });
  },

  acceptOrder() {
    wx.showModal({
      title: '接下这份点单',
      content: '接单后就可以按制作说明开始准备。',
      confirmText: '接单',
      success: result => {
        if (!result.confirm) return;
        api.acceptOrder(this.data.orderId).then(() => {
          wx.showToast({ title: '已接单', icon: 'success' });
          return this.loadOrder();
        }).catch(error => wx.showToast({ title: error.message || '接单失败', icon: 'none' }));
      }
    });
  },

  markReady() {
    wx.showModal({
      title: '已经做好了？',
      content: '确认后会进入待确认，由下单人点击“收到啦”完成。',
      confirmText: '已做好',
      success: result => {
        if (!result.confirm) return;
        api.readyOrder(this.data.orderId).then(() => {
          wx.showToast({ title: '已通知 TA', icon: 'success' });
          return this.loadOrder();
        }).catch(error => wx.showToast({ title: error.message || '操作失败', icon: 'none' }));
      }
    });
  },

  confirmReceived() {
    wx.showModal({
      title: '确认收到',
      content: '确认后这份点单将正式完成。',
      confirmText: '收到啦',
      success: result => {
        if (!result.confirm) return;
        api.confirmOrder(this.data.orderId).then(() => {
          wx.showToast({ title: '订单已完成', icon: 'success' });
          return this.loadOrder();
        }).catch(error => wx.showToast({ title: error.message || '确认失败', icon: 'none' }));
      }
    });
  },

  formatTime(value) {
    const date = dateUtils.parseDateTime(value);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}.${month}.${day} ${hours}:${minutes}`;
  },

  onPullDownRefresh() {
    this.loadOrder();
  }
});
