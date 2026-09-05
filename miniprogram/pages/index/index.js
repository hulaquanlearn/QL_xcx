//index.js
//获取应用实例
const app = getApp()
const api = require('../../services/api')
const auth = require('../../services/auth')
const avatarService = require('../../services/avatar')
const mediaService = require('../../services/media')
const dateUtils = require('../../utils/date')
const { syncTabBar } = require('../../services/navigation')
const { selectHomeAnniversary } = require('../../utils/home')

Page({
  data: {
    isLoggedIn: false,
    coupleId: '',
    loveDays: 0,
    daysUnit: '',
    userAvatar: '',
    partnerAvatar: '',
    userInitial: '我',
    partnerInitial: 'TA',
    albumList: [],
    countdownList: [],
    pinnedAnniversary: null,
    account: '',
    password: '',
    uploading: false,
    avatarStatus: '',
    loggingIn: false
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
      syncTabBar(this, 0, false);
      return;
    }
    app.autoLogin((success, _user, error) => {
      if (!success) {
        const useCachedSession = Boolean(auth.getToken() && app.globalData.userInfo);
        this.setData({
          isLoggedIn: useCachedSession,
          coupleId: useCachedSession ? (app.globalData.coupleId || '') : ''
        });
        syncTabBar(this, 0, useCachedSession);
        if (useCachedSession && error) {
          wx.showToast({ title: '网络暂时不可用，登录状态已保留', icon: 'none' });
        }
        return;
      }
      this.setData({ isLoggedIn: true, coupleId: app.globalData.coupleId });
      syncTabBar(this, 0, true);
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
    if (this.data.loggingIn) return;
    const { account, password } = this.data;
    
    if (!account.trim()) {
      wx.showToast({ title: '请输入账号', icon: 'none' });
      return;
    }
    
    if (!password.trim()) {
      wx.showToast({ title: '请输入密码', icon: 'none' });
      return;
    }
    
    this.setData({ loggingIn: true });
    wx.showLoading({ title: '登录中...' });
    
    api.login({ account: account.trim(), password }).then(({ token, user, partner }) => {
      mediaService.clearCaches();
      auth.setSession(token, user);
      app.globalData.userId = user.id;
      app.globalData.userInfo = user;
      app.globalData.coupleId = user.coupleId;
      app.globalData.partnerInfo = partner || null;
      app.globalData.manualLogout = false;
      app.saveLoginStatus({ userId: user.id, coupleId: user.coupleId, userInfo: user, partnerInfo: partner || null });
      this.setData({ isLoggedIn: true, coupleId: user.coupleId });
      syncTabBar(this, 0, true);
      wx.showToast({ title: '登录成功', icon: 'success' });
      if (user.coupleId) this.loadData();
    }).catch(err => {
      wx.showToast({ title: err.message || '登录失败', icon: 'none' });
    }).finally(() => {
      wx.hideLoading();
      this.setData({ loggingIn: false });
    });
  },

  // 加载数据
  loadData: function() {
    this.loadCountdownData();
    this.loadAvatars();
    this.loadAlbum();
  },
  
  // 一次请求同时刷新恋爱天数、纪念日列表和首页置顶项。
  loadCountdownData: function() {
    const coupleId = this.data.coupleId || app.globalData.coupleId;
    if (!coupleId) return;

    const sequence = this._countdownSequence = (this._countdownSequence || 0) + 1;
    return api.list('countdown', { limit: 200 }).then(rows => {
      if (sequence !== this._countdownSequence || coupleId !== app.globalData.coupleId) return;
      const countdownList = rows.map(item => ({
        ...item,
        dateText: dateUtils.getDateStatus(item.date).text
      }));
      const { pinnedAnniversary, loveDays, daysUnit } = selectHomeAnniversary(countdownList);
      this.setData({
        loveDays,
        daysUnit,
        countdownList,
        pinnedAnniversary
      });
    }).catch(err => {
      console.error('获取纪念日失败：', err);
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
      const userId = String(app.globalData.userInfo?.id || app.globalData.userId || '');
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
      });
    }).catch(err => {
      console.error('获取头像失败：', err);
      this.setData({ userAvatar: '', partnerAvatar: '' });
    });
  },
  
  // 上传头像
  uploadAvatar: function() {
    if (this.data.uploading) {
      wx.showToast({ title: '头像正在上传，请稍候', icon: 'none' });
      return;
    }
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
    this.setData({ uploading: true, avatarStatus: '正在处理头像…' });
    avatarService.upload(tempFilePath, { onStatus: event => this.setData({ avatarStatus: event.status === 'moderating' ? '头像审核中，请稍候…' : '头像上传中…' }) }).then(() => {
      return this.loadAvatars();
    }).then(() => {
      this.setData({ uploading: false, avatarStatus: '' });
      wx.showToast({ title: '头像已同步', icon: 'success' });
    }).catch(err => {
      console.error('上传头像失败：', err);
      this.setData({ uploading: false, avatarStatus: '' });
      wx.showToast({ title: err.message || '上传失败', icon: 'none' });
    });
  },
  
  // 加载相册
  loadAlbum: function() {
    const coupleId = this.data.coupleId || app.globalData.coupleId;
    
    if (!coupleId) return;
    
    const sequence = this._albumSequence = (this._albumSequence || 0) + 1;
    return api.list('album', { limit: 9 }).then(rows => {
      if (sequence !== this._albumSequence || coupleId !== app.globalData.coupleId) return;
      const keys = rows.map(item => item.fileID || item.imgUrl).filter(Boolean);
      this.setData({ albumList: rows.map(item => ({ ...item, storageKey: item.fileID || item.imgUrl, imgUrl: '' })) });
      return mediaService.resolveFiles(keys, {
        variant: 'thumbnail',
        isCancelled: () => sequence !== this._albumSequence || coupleId !== app.globalData.coupleId,
        onResolved: (key, url) => {
          if (sequence !== this._albumSequence || coupleId !== app.globalData.coupleId) return;
          const patch = {};
          this.data.albumList.forEach((item, index) => { if (item.storageKey === key) patch[`albumList[${index}].imgUrl`] = url; });
          this.setData(patch);
        }
      });
    }).catch(err => {
      console.error('获取相册失败：', err);
    });
  },

  // 页面显示时刷新数据
  onShow: function() {
    syncTabBar(this, 0, this.data.isLoggedIn);
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
    wx.switchTab({ url: '/pages/mine/index' });
  },

  goToPeriod: function() {
    wx.switchTab({ url: '/pages/period/index' });
  },

  // 图片加载失败
  imgError: function() {},
})
