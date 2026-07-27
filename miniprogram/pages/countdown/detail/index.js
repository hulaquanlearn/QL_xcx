// pages/countdown/detail/index.js
const app = getApp()
const dateUtils = require('../../../utils/date')

Page({
  data: {
    countdown: null,
    countdownId: '',
    relativeLabel: '距所选日期',
    relativeText: '',
    annualText: '',
    loading: false
  },
  
  onLoad: function(options) {
    this.checkLogin();
    if (options.id) {
      this.setData({ countdownId: options.id });
    }
  },

  // 从编辑页返回时重新获取数据，避免继续显示编辑前的年份。
  onShow: function() {
    if (this.data.countdownId && this.checkLogin()) this.loadCountdown(this.data.countdownId);
  },
  
  // 检查登录状态
  checkLogin: function() {
    if (!app.globalData.openid || !app.globalData.coupleId) {
      wx.redirectTo({ url: '/pages/index/index' });
      return false;
    }
    return true;
  },
  
  // 加载纪念日详情
  loadCountdown: function(id) {
    this.setData({ loading: true });
    const db = wx.cloud.database();
    db.collection('countdown').doc(id).get().then(res => {
      if (res.data) {
        const countdown = res.data;
        
        // 格式化日期显示
        countdown.dateText = this.formatDate(countdown.date);
        
        // 优先使用当前会话中的最新个人资料，避免昵称修改后仍展示旧值。
        countdown.creator = this.resolveCreatorName(countdown);
        
        // 格式化创建时间（可能是 createdAt 或 createTime）
        const createTime = countdown.createdAt || countdown.createTime;
        if (createTime) {
          countdown.createTimeText = this.formatDateTime(createTime);
        } else {
          countdown.createTimeText = '未知';
        }
        
        const status = dateUtils.getDateStatus(countdown.date);
        const annualStatus = dateUtils.getNextAnnualStatus(countdown.date);
        this.setData({
          countdown: countdown,
          relativeLabel: '日期状态',
          relativeText: status.text,
          annualText: annualStatus.text,
          loading: false
        });
      }
    }).catch(err => {
      console.error('获取纪念日详情失败：', err);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },
  
  // 格式化日期
  formatDate: function(dateStr) {
    return dateUtils.formatDate(dateStr);
  },

  resolveCreatorName: function(countdown) {
    const authorId = String(countdown.authorId || '');
    const user = app.globalData.userInfo || {};
    const partner = app.globalData.partnerInfo || {};
    const userId = String(user.id || user._id || '');
    const partnerId = String(partner.id || partner._id || '');

    if (authorId && authorId === userId && user.name) return user.name;
    if (authorId && authorId === partnerId && partner.name) return partner.name;
    return countdown.author || countdown.creator || '未知';
  },
  
  // 格式化日期时间
  formatDateTime: function(dateObj) {
    if (!dateObj) return '';
    const date = new Date(dateObj);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}`;
  },
  
  // 编辑纪念日
  editCountdown: function() {
    const id = this.data.countdown._id;
    wx.navigateTo({ url: `/pages/countdown/add/index?id=${id}` });
  },
  
  // 删除纪念日
  deleteCountdown: function() {
    const id = this.data.countdown._id;
    const that = this;
    
    wx.showModal({
      title: '删除纪念日',
      content: '确定要删除这个纪念日吗？',
      success: res => {
        if (res.confirm) {
          const db = wx.cloud.database();
          db.collection('countdown').doc(id).remove().then(() => {
            wx.showToast({ title: '删除成功', icon: 'success' });
            wx.navigateBack();
          }).catch(err => {
            console.error('删除失败：', err);
            wx.showToast({ title: '删除失败', icon: 'none' });
          });
        }
      }
    });
  },
  
  // 返回
  goBack: function() {
    wx.navigateBack();
  }
})
