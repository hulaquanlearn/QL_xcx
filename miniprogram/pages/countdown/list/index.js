// pages/countdown/list/index.js
const app = getApp()
const api = require('../../../services/api')
const dateUtils = require('../../../utils/date')

Page({
  data: {
    countdowns: [],
    loading: false,
    startX: 0,
    startY: 0,
    topCount: 0,
    upcomingCount: 0
  },
  
  onLoad: function() {
    this.checkLogin();
  },
  
  // 页面显示时刷新数据
  onShow: function() {
    if (this.checkLogin()) this.loadCountdowns();
  },
  
  // 检查登录状态
  checkLogin: function() {
    if (!app.globalData.userId || !app.globalData.coupleId) {
      wx.reLaunch({ url: '/pages/index/index' });
      return false;
    }
    return true;
  },
  
  // 加载纪念日
  loadCountdowns: function() {
    this.setData({ loading: true });
    const coupleId = app.globalData.coupleId;
    
    if (!coupleId) {
      this.setData({ 
        countdowns: [],
        loading: false 
      });
      return;
    }
    
    return api.list('countdown', { limit: 200 }).then(rows => {
      // 使用完整的年月日计算，修改年份后展示会同步变化。
      const countdowns = rows.map(item => {
        const status = dateUtils.getDateStatus(item.date);

        return {
          ...item,
          days: status.days,
          daysText: status.text,
          daysNum: status.daysNum,
          daysUnit: status.daysUnit,
          dateText: dateUtils.formatDate(item.date),
          slide: false
        };
      });

      // 计算统计数据
      const topCount = countdowns.filter(item => item.isTop).length;
      const upcomingCount = countdowns.filter(item => item.days >= 0 && item.days <= 30).length;

      this.setData({
        countdowns: countdowns,
        topCount: topCount,
        upcomingCount: upcomingCount,
        loading: false
      });
    }).catch(err => {
      console.error('获取纪念日失败：', err);
      this.setData({ loading: false });
    });
  },
  
  // 跳转到添加页面
  goToAdd: function() {
    wx.navigateTo({ url: '/pages/countdown/add/index' });
  },
  
  // 跳转到详情页面
  goToDetail: function(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/countdown/detail/index?id=${id}` });
  },
  
  // 触摸开始
  touchStart: function(e) {
    this.setData({
      startX: e.changedTouches[0].clientX,
      startY: e.changedTouches[0].clientY
    });
  },
  
  // 触摸移动
  touchMove: function(e) {
    const index = e.currentTarget.dataset.index;
    const startX = this.data.startX;
    const moveX = e.changedTouches[0].clientX;
    const diffX = startX - moveX;
    
    // 左滑超过50px显示操作按钮
    if (diffX > 50) {
      const countdowns = this.data.countdowns;
      countdowns[index].slide = true;
      this.setData({ countdowns });
    } else if (diffX < -50) {
      // 右滑隐藏操作按钮
      const countdowns = this.data.countdowns;
      countdowns[index].slide = false;
      this.setData({ countdowns });
    }
  },
  
  // 触摸结束
  touchEnd: function(e) {
    // 触摸结束不做处理
  },
  
  // 置顶/取消置顶
  toggleHomeDisplay: function(e) {
    const id = e.currentTarget.dataset.id;
    
    // 找到当前项
    const item = this.data.countdowns.find(c => c._id === id);
    const isTop = item.isTop || false;
    
    api.update('countdown', id, {
      isTop: !isTop
    }).then(() => {
      wx.showToast({ title: isTop ? '已取消置顶' : '已置顶', icon: 'success' });
      this.loadCountdowns();
    }).catch(err => {
      console.error('置顶失败：', err);
      wx.showToast({ title: '操作失败', icon: 'none' });
    });
  },
  
  // 长按删除
  longPressDelete: function(e) {
    const id = e.currentTarget.dataset.id;
    const that = this;
    
    wx.showModal({
      title: '删除纪念日',
      content: '确定要删除这个纪念日吗？',
      success: res => {
        if (res.confirm) {
          that.setData({ loading: true });
          api.remove('countdown', id).then(() => {
            that.setData({ loading: false });
            wx.showToast({ title: '删除成功', icon: 'success' });
            that.loadCountdowns();
          }).catch(err => {
            console.error('删除失败：', err);
            that.setData({ loading: false });
            wx.showToast({ title: '删除失败', icon: 'none' });
          });
        }
      }
    });
  },
  
  // 删除纪念日
  deleteCountdown: function(e) {
    const id = e.currentTarget.dataset.id;
    const that = this;
    
    wx.showModal({
      title: '删除纪念日',
      content: '确定要删除这个纪念日吗？',
      success: res => {
        if (res.confirm) {
          that.setData({ loading: true });
          api.remove('countdown', id).then(() => {
            that.setData({ loading: false });
            wx.showToast({ title: '删除成功', icon: 'success' });
            that.loadCountdowns();
          }).catch(err => {
            console.error('删除失败：', err);
            that.setData({ loading: false });
            wx.showToast({ title: '删除失败', icon: 'none' });
          });
        }
      }
    });
  },
  
  // 切换纪念日状态
  toggleAnniversary: function(e) {
    const id = e.currentTarget.dataset.id;
    const isAnniversary = e.currentTarget.dataset.anniversary;
    api.update('countdown', id, {
      isAnniversary: !isAnniversary
    }).then(() => {
      // 刷新数据
      this.loadCountdowns();
    }).catch(err => {
      console.error('更新失败：', err);
    });
  },
  
  // 下拉刷新
  onPullDownRefresh: function() {
    Promise.resolve(this.loadCountdowns()).finally(() => wx.stopPullDownRefresh());
  }
})
