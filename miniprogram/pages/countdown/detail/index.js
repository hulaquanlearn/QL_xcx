// pages/countdown/detail/index.js
const app = getApp()

Page({
  data: {
    countdown: null,
    daysPassed: 0,
    daysThisYear: 0
  },
  
  onLoad: function(options) {
    this.checkLogin();
    if (options.id) {
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
        const countdown = res.data;
        
        // 格式化日期显示
        countdown.dateText = this.formatDate(countdown.date);
        
        // 处理创建人字段（可能是 author 或 creator）
        countdown.creator = countdown.author || countdown.creator || '未知';
        
        // 格式化创建时间（可能是 createdAt 或 createTime）
        const createTime = countdown.createdAt || countdown.createTime;
        if (createTime) {
          countdown.createTimeText = this.formatDateTime(createTime);
        } else {
          countdown.createTimeText = '未知';
        }
        
        this.setData({ countdown: countdown });
        this.calculateDays(countdown.date);
      }
    }).catch(err => {
      console.error('获取纪念日详情失败：', err);
    });
  },
  
  // 格式化日期
  formatDate: function(dateStr) {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}年${month}月${day}日`;
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
  
  // 计算天数相关数据
  calculateDays: function(dateStr) {
    const targetDate = new Date(dateStr);
    const now = new Date();
    
    // 计算已持续天数（从纪念日到今天）
    const diffTime = now - targetDate;
    const daysPassed = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    // 计算今年的纪念日日期
    const thisYear = now.getFullYear();
    const thisYearDate = new Date(thisYear, targetDate.getMonth(), targetDate.getDate());
    
    // 如果今年的纪念日已过，计算明年的
    let daysThisYear;
    if (thisYearDate < now) {
      const nextYearDate = new Date(thisYear + 1, targetDate.getMonth(), targetDate.getDate());
      daysThisYear = Math.ceil((nextYearDate - now) / (1000 * 60 * 60 * 24));
    } else {
      daysThisYear = Math.ceil((thisYearDate - now) / (1000 * 60 * 60 * 24));
    }
    
    this.setData({ 
      daysPassed: daysPassed,
      daysThisYear: daysThisYear
    });
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
