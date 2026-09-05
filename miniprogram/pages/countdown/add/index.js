// pages/countdown/add/index.js
const app = getApp()
const api = require('../../../services/api')
const dateUtils = require('../../../utils/date')

Page({
  data: {
    title: '',
    date: '',
    dateText: '',
    description: '',
    isAnniversary: false,
    countdownId: '',
    isEdit: false,
    loading: false
  },
  
  onLoad: function(options) {
    this.checkLogin();
    if (options.id) {
      this.setData({ countdownId: options.id, isEdit: true });
      this.loadCountdown(options.id);
    }
  },
  
  // 检查登录状态
  checkLogin: function() {
    if (!app.globalData.userId || !app.globalData.coupleId) {
      wx.reLaunch({ url: '/pages/index/index' });
      return false;
    }
    return true;
  },
  
  // 加载纪念日详情
  loadCountdown: function(id) {
    api.get('countdown', id).then(item => {
      if (item) {
        const date = dateUtils.toDateInputValue(item.date);
        this.setData({
          title: item.title,
          date: date,
          dateText: date,
          description: item.description || '',
          isAnniversary: item.isAnniversary
        });
      }
    }).catch(err => {
      console.error('获取纪念日详情失败：', err);
    });
  },
  
  // 输入标题
  onTitleInput: function(e) {
    this.setData({ title: e.detail.value });
  },
  
  // 选择日期
  onDateChange: function(e) {
    this.setData({ 
      date: e.detail.value,
      dateText: e.detail.value
    });
  },
  
  // 输入描述
  onDescriptionInput: function(e) {
    this.setData({ description: e.detail.value });
  },
  
  // 切换纪念日状态
  toggleAnniversary: function(e) {
    this.setData({ isAnniversary: e.detail.value });
  },
  
  // 保存纪念日
  saveCountdown: function() {
    if (this.data.loading) return;
    const title = this.data.title.trim();
    const date = this.data.date;
    const description = this.data.description.trim();
    
    if (!title) {
      wx.showToast({ title: '请输入标题', icon: 'none' });
      return;
    }
    
    if (!date) {
      wx.showToast({ title: '请选择日期', icon: 'none' });
      return;
    }
    
    const coupleId = app.globalData.coupleId;
    
    if (!coupleId) {
      wx.showToast({ title: '请先绑定情侣', icon: 'none' });
      return;
    }
    
    this.setData({ loading: true });

    if (this.data.countdownId) {
      // 更新纪念日
      api.update('countdown', this.data.countdownId, {
        title: title,
        date: date,
        description: description,
        isAnniversary: this.data.isAnniversary
      }).then(() => {
        this.setData({ loading: false });
        wx.showToast({ title: '更新成功', icon: 'success' });
        wx.navigateBack();
      }).catch(err => {
        console.error('更新失败：', err);
        this.setData({ loading: false });
        wx.showToast({ title: '更新失败', icon: 'none' });
      });
    } else {
      // 添加纪念日
      api.create('countdown', {
        title: title,
        date: date,
        description: description,
        isAnniversary: this.data.isAnniversary
      }).then(() => {
        this.setData({ loading: false });
        wx.showToast({ title: '添加成功', icon: 'success' });
        wx.navigateBack();
      }).catch(err => {
        console.error('添加失败：', err);
        this.setData({ loading: false });
        wx.showToast({ title: '添加失败', icon: 'none' });
      });
    }
  },
  
  // 返回
  goBack: function() {
    wx.navigateBack();
  }
})
