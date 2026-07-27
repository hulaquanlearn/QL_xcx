//index.js
//获取应用实例
const app = getApp()
const api = require('../../services/api')
const auth = require('../../services/auth')
const avatarService = require('../../services/avatar')
const mediaService = require('../../services/media')
const dateUtils = require('../../utils/date')

Page({
  data: {
    isLoggedIn: false,
    coupleId: '',
    loveDays: 0,
    userAvatar: '',
    partnerAvatar: '',
    userInitial: '我',
    partnerInitial: 'TA',
    albumList: [],
    countdownList: [],
    pinnedAnniversary: null,
    account: '',
    password: ''
  },
  
  /**
 * 页面加载时的生命周期钩子函数
 * 在页面加载时自动调用，用于检查用户登录状态
 */
onLoad: function() {
    // 检查登录状态
    this.checkLogin();
  },
  
  // 检查登录状态
  checkLogin: function() {
    if (!auth.getToken()) {
      this.setData({ isLoggedIn: false, coupleId: '' });
      return;
    }
    app.autoLogin(success => {
      if (!success) {
        this.setData({ isLoggedIn: false, coupleId: '' });
        return;
      }
      this.setData({ isLoggedIn: true, coupleId: app.globalData.coupleId });
      if (app.globalData.coupleId) this.loadData();
    });
  },
  
  // 输入账号
  onAccountInput: function(e) {
    this.setData({ account: e.detail.value });
  },
  
  // 输入密码
  onPasswordInput: function(e) {
    this.setData({ password: e.detail.value });
  },

  // 账号密码登录
  login: function() {
    const { account, password } = this.data;
    
    if (!account.trim()) {
      wx.showToast({ title: '请输入账号', icon: 'none' });
      return;
    }
    
    if (!password.trim()) {
      wx.showToast({ title: '请输入密码', icon: 'none' });
      return;
    }
    
    wx.showLoading({ title: '登录中...' });
    
    api.login({ account: account.trim(), password }).then(({ token, user, partner }) => {
      wx.hideLoading();
      auth.setSession(token, user);
      app.globalData.openid = user.id;
      app.globalData.userInfo = user;
      app.globalData.coupleId = user.coupleId;
      app.globalData.partnerInfo = partner || null;
      app.globalData.manualLogout = false;
      app.saveLoginStatus({ openid: user.id, coupleId: user.coupleId, userInfo: user, partnerInfo: partner || null });
      this.setData({ isLoggedIn: true, coupleId: user.coupleId });
      wx.showToast({ title: '登录成功', icon: 'success' });
      if (user.coupleId) this.loadData();
    }).catch(err => {
      wx.hideLoading();
      wx.showToast({ title: err.message || '登录失败', icon: 'none' });
    });
  },

  // 加载数据
  loadData: function() {
    this.loadLoveDays();
    this.loadAvatars();
    this.loadAlbum();
    this.loadCountdown();
  },
  
  // 加载恋爱天数
  loadLoveDays: function() {
    const db = wx.cloud.database();
    const coupleId = this.data.coupleId || app.globalData.coupleId;
    
    if (!coupleId) return;
    
    // 查找isAnniversary为true的纪念日，如果没有则查找第一个纪念日
    db.collection('countdown').where({
      coupleId: coupleId,
      isAnniversary: true
    }).get().then(res => {
      if (res.data.length > 0) {
        const anniversary = res.data[0];
        const diffDays = this.calculateDaysDiff(anniversary.date);
        this.setData({ loveDays: diffDays });
      } else {
        // 如果没有标记为isAnniversary的，查找最早的纪念日
        db.collection('countdown').where({
          coupleId: coupleId
        }).orderBy('date', 'asc').limit(1).get().then(res2 => {
          if (res2.data.length > 0) {
            const anniversary = res2.data[0];
            const diffDays = this.calculateDaysDiff(anniversary.date);
            this.setData({ loveDays: diffDays });
          } else {
            this.setData({ loveDays: 0 });
          }
        });
      }
    }).catch(err => {
      console.error('获取恋爱天数失败：', err);
    });
  },

  // 计算天数差（修复差一天问题）
  calculateDaysDiff: function(dateStr) {
    const difference = dateUtils.differenceFromToday(dateStr);
    return difference === null ? 0 : Math.max(0, -difference);
  },

  // 加载头像
  loadAvatars: function() {
    const coupleId = this.data.coupleId || app.globalData.coupleId;
    if (!coupleId) return;
    return api.getAvatars().then(rows => {
      const userId = String(app.globalData.userInfo?.id || app.globalData.openid || '');
      const partnerId = String(app.globalData.partnerInfo?.id || '');
      const userRow = rows.find(item => String(item.userId) === userId) || {};
      const partnerRow = rows.find(item => String(item.userId) === partnerId) || {};
      const keys = [userRow.key, partnerRow.key].filter(Boolean);
      return avatarService.resolveFiles(keys).then(urls => {
        this.setData({
          userAvatar: urls[userRow.key] || '',
          partnerAvatar: urls[partnerRow.key] || '',
          userInitial: String(userRow.name || app.globalData.userInfo?.name || '我').slice(0, 1),
          partnerInitial: String(partnerRow.name || app.globalData.partnerInfo?.name || 'TA').slice(0, 1)
        });
        if (String(userRow.key || '').startsWith('cloud://') && !this.avatarMigrationRunning) {
          this.avatarMigrationRunning = true;
          avatarService.migrateLegacy(userRow.key)
            .then(() => this.loadAvatars())
            .catch(() => {})
            .finally(() => { this.avatarMigrationRunning = false; });
        }
      });
    }).catch(err => {
      console.error('获取头像失败：', err);
      this.setData({ userAvatar: '', partnerAvatar: '' });
    });
  },
  
  // 上传头像
  uploadAvatar: function() {
    const that = this;
    
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: function(res) {
        const tempFilePath = res.tempFilePaths[0];
        that.uploadAvatarToServer(tempFilePath);
      }
    });
  },
  
  // 上传头像到情侣空间服务器
  uploadAvatarToServer: function(tempFilePath) {
    this.setData({ uploading: true });
    avatarService.upload(tempFilePath).then(() => {
      return this.loadAvatars();
    }).then(() => {
      this.setData({ uploading: false });
      wx.showToast({ title: '头像已同步', icon: 'success' });
    }).catch(err => {
      console.error('上传头像失败：', err);
      this.setData({ uploading: false });
      wx.showToast({ title: err.message || '上传失败', icon: 'none' });
    });
  },
  
  // 加载相册
  loadAlbum: function() {
    const db = wx.cloud.database();
    const coupleId = this.data.coupleId || app.globalData.coupleId;
    
    if (!coupleId) return;
    
    db.collection('album').where({
      coupleId: coupleId
    }).orderBy('createTime', 'desc').limit(9).get().then(res => {
      const rows = res.data || [];
      const keys = rows.map(item => item.fileID || item.imgUrl).filter(Boolean);
      return mediaService.resolveFiles(keys).then(urls => {
        this.setData({
          albumList: rows.map(item => {
            const key = item.fileID || item.imgUrl;
            return { ...item, storageKey: key, imgUrl: urls[key] || '' };
          })
        });
        this.migrateLegacyAlbums(rows);
      });
    }).catch(err => {
      console.error('获取相册失败：', err);
    });
  },

  migrateLegacyAlbums: function(rows) {
    if (this.albumMigrationRunning) return;
    const legacy = (rows || []).filter(item => String(item.fileID || item.imgUrl || '').startsWith('cloud://'));
    if (!legacy.length) return;
    this.albumMigrationRunning = true;
    Promise.all(legacy.map(item => {
      const oldKey = item.fileID || item.imgUrl;
      return mediaService.migrateCloudFile(oldKey, 'album')
        .then(newKey => api.update('album', item._id, { imgUrl: newKey, fileID: newKey }));
    })).then(() => this.loadAlbum())
      .catch(() => {})
      .finally(() => { this.albumMigrationRunning = false; });
  },
  
  // 加载纪念日
  loadCountdown: function() {
    const db = wx.cloud.database();
    const coupleId = this.data.coupleId || app.globalData.coupleId;
    
    if (!coupleId) return;
    
    db.collection('countdown').where({
      coupleId: coupleId
    }).orderBy('date', 'asc').get().then(res => {
      // 计算每个纪念日的日期显示文本
      const countdownList = res.data.map(item => {
        const status = dateUtils.getDateStatus(item.date);
        
        return {
          ...item,
          dateText: status.text
        };
      });
      
      this.setData({ countdownList: countdownList });
      
      // 只显示置顶的纪念日，不再循环滚动
      if (countdownList.length > 0) {
        // 优先显示置顶的纪念日
        let pinnedItem = countdownList.find(item => item.isTop);
        if (!pinnedItem) {
          // 如果没有置顶的，显示第一个
          pinnedItem = countdownList[0];
        }
        
        this.setData({ 
          pinnedAnniversary: pinnedItem
        });
      } else {
        this.setData({ pinnedAnniversary: null });
      }
    }).catch(err => {
      console.error('获取纪念日失败：', err);
    });
  },
  
  // 页面显示时刷新数据
  onShow: function() {
    if (this.data.isLoggedIn) {
      this.loadData();
    }
  },
  
  // 跳转到相册
  goToAlbum: function() {
    wx.navigateTo({ url: '/pages/album/index' });
  },
  
  // 跳转到纪念日
  goToCountdown: function() {
    wx.navigateTo({ url: '/pages/countdown/list/index' });
  },

  // 跳转到恋爱纪念日
  goToAnniversary: function() {
    wx.navigateTo({ url: '/pages/countdown/list/index' });
  },

  // 跳转到活动页面
  goToActivity: function() {
    wx.navigateTo({ url: '/pages/activity/index' });
  },
  
  // 跳转到点菜
  goToFood: function() {
    wx.navigateTo({ url: '/pages/food/index' });
  },

  // 跳转到我的
  goToMine: function() {
    wx.navigateTo({ url: '/pages/mine/index' });
  },

  // 图片加载失败
  imgError: function() {},
})
