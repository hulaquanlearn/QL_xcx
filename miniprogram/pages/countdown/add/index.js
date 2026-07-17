// pages/countdown/add/index.js
const app = getApp()

Page({
  data: {
    title: '',
    date: '',
    dateText: '',
    description: '',
    isAnniversary: false,
    countdownId: '',
    isEdit: false
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
    if (!app.globalData.openid || !app.globalData.coupleId) {
      wx.redirectTo({ url: '/pages/index/index' });
      return false;
    }
    return true;
  },
  
  // 加载纪念日详情
  loadCountdown: function(id) {
    const db = wx.cloud.database();
    db.collection('countdown').doc(id).get().then(res => {
      if (res.data) {
        this.setData({
          title: res.data.title,
          date: res.data.date,
          dateText: res.data.date,
          description: res.data.description || '',
          isAnniversary: res.data.isAnniversary
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
    
    const db = wx.cloud.database();
    const userInfo = app.globalData.userInfo;
    const coupleId = app.globalData.coupleId;
    
    console.log('保存纪念日，coupleId:', coupleId);
    console.log('保存纪念日，userInfo:', userInfo);
    
    if (!coupleId) {
      wx.showToast({ title: '请先绑定情侣', icon: 'none' });
      return;
    }
    
    if (this.data.countdownId) {
      // 更新纪念日
      db.collection('countdown').doc(this.data.countdownId).update({
        data: {
          title: title,
          date: date,
          description: description,
          isAnniversary: this.data.isAnniversary
        }
      }).then(() => {
        wx.showToast({ title: '更新成功', icon: 'success' });
        wx.navigateBack();
      }).catch(err => {
        console.error('更新失败：', err);
        wx.showToast({ title: '更新失败', icon: 'none' });
      });
    } else {
      // 添加纪念日
      db.collection('countdown').add({
        data: {
          title: title,
          date: date,
          description: description,
          isAnniversary: this.data.isAnniversary,
          coupleId: coupleId,
          author: userInfo ? userInfo.name : '',
          createdAt: db.serverDate()
        }
      }).then(() => {
        console.log('添加纪念日成功');
        wx.showToast({ title: '添加成功', icon: 'success' });
        wx.navigateBack();
      }).catch(err => {
        console.error('添加失败：', err);
        wx.showToast({ title: '添加失败', icon: 'none' });
      });
    }
  },
  
  // 返回
  goBack: function() {
    wx.navigateBack();
  }
})
