// pages/countdown/list/index.js
const app = getApp()

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
    this.loadCountdowns();
  },
  
  // 页面显示时刷新数据
  onShow: function() {
    this.loadCountdowns();
  },
  
  // 检查登录状态
  checkLogin: function() {
    if (!app.globalData.openid || !app.globalData.coupleId) {
      wx.redirectTo({ url: '/pages/index/index' });
      return false;
    }
    return true;
  },
  
  // 加载纪念日
  loadCountdowns: function() {
    this.setData({ loading: true });
    const db = wx.cloud.database();
    const coupleId = app.globalData.coupleId;
    
    console.log('加载纪念日，coupleId:', coupleId);
    
    if (!coupleId) {
      console.log('coupleId为空，无法加载纪念日');
      this.setData({ 
        countdowns: [],
        loading: false 
      });
      return;
    }
    
    db.collection('countdown').where({
      coupleId: coupleId
    }).orderBy('date', 'asc').get().then(res => {
      console.log('获取纪念日成功:', res.data);
      // 计算每个纪念日的天数
      const countdowns = res.data.map(item => {
        const targetDate = new Date(item.date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        targetDate.setHours(0, 0, 0, 0);
        
        // 计算距离下一个纪念日的天数
        const thisYear = today.getFullYear();
        const thisYearDate = new Date(thisYear, targetDate.getMonth(), targetDate.getDate());
        thisYearDate.setHours(0, 0, 0, 0);
        
        let diffDays;
        if (thisYearDate >= today) {
          // 今年的纪念日还没到或就是今天
          diffDays = Math.ceil((thisYearDate - today) / (1000 * 60 * 60 * 24));
        } else {
          // 今年的纪念日已过，计算明年的
          const nextYearDate = new Date(thisYear + 1, targetDate.getMonth(), targetDate.getDate());
          nextYearDate.setHours(0, 0, 0, 0);
          diffDays = Math.ceil((nextYearDate - today) / (1000 * 60 * 60 * 24));
        }

        // 生成显示文本
        let daysText = '';
        let daysNum = '';
        let daysUnit = '';

        if (diffDays > 0) {
          daysText = `还有${diffDays}天`;
          daysNum = diffDays;
          daysUnit = '天后';
        } else if (diffDays === 0) {
          daysText = '今天';
          daysNum = '今天';
          daysUnit = '';
        }

        // 格式化日期显示
        const dateObj = new Date(item.date);
        const dateText = `${dateObj.getFullYear()}年${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;

        return {
          ...item,
          days: diffDays,
          daysText: daysText,
          daysNum: daysNum,
          daysUnit: daysUnit,
          dateText: dateText,
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
    const db = wx.cloud.database();
    
    // 找到当前项
    const item = this.data.countdowns.find(c => c._id === id);
    const isTop = item.isTop || false;
    
    db.collection('countdown').doc(id).update({
      data: {
        isTop: !isTop
      }
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
          const db = wx.cloud.database();
          
          db.collection('countdown').doc(id).remove().then(() => {
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
          const db = wx.cloud.database();
          
          db.collection('countdown').doc(id).remove().then(() => {
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
    const db = wx.cloud.database();
    
    db.collection('countdown').doc(id).update({
      data: {
        isAnniversary: !isAnniversary
      }
    }).then(() => {
      // 刷新数据
      this.loadCountdowns();
    }).catch(err => {
      console.error('更新失败：', err);
    });
  },
  
  // 下拉刷新
  onPullDownRefresh: function() {
    this.loadCountdowns();
    wx.stopPullDownRefresh();
  }
})