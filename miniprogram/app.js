// app.js
const api = require('./services/api');
const auth = require('./services/auth');
const database = require('./services/database');
App({
  onLaunch: function () {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      // 初始化云开发环境
      wx.cloud.init({
        env: 'cloud1-5gso6r92dea88025',
        traceUser: true,
      });
      // 业务数据统一走自建 REST API + MySQL；保留云存储用于图片文件。
      wx.cloud.database = database;
    }
    
    // 检查登录状态
    this.checkLoginStatus();
  },
  
  // 检查登录状态
  checkLoginStatus: function() {
    // 从本地存储获取登录信息
    const loginInfo = wx.getStorageSync('loginInfo');
    if (auth.getToken() && loginInfo && loginInfo.openid) {
      this.globalData.openid = loginInfo.openid;
      this.globalData.coupleId = loginInfo.coupleId;
      this.globalData.userInfo = loginInfo.userInfo;
      this.globalData.partnerInfo = loginInfo.partnerInfo;
    } else {
      this.clearLoginStatus();
    }
  },
  
  // 保存登录状态
  saveLoginStatus: function(loginInfo) {
    wx.setStorageSync('loginInfo', {
      openid: loginInfo.openid,
      coupleId: loginInfo.coupleId,
      userInfo: loginInfo.userInfo,
      partnerInfo: loginInfo.partnerInfo
    });
    // 更新全局数据
    this.globalData.openid = loginInfo.openid;
    this.globalData.coupleId = loginInfo.coupleId;
    this.globalData.userInfo = loginInfo.userInfo;
    this.globalData.partnerInfo = loginInfo.partnerInfo;
  },
  
  // 清除登录状态
  clearLoginStatus: function() {
    wx.removeStorageSync('loginInfo');
    this.globalData.openid = '';
    this.globalData.coupleId = '';
    this.globalData.userInfo = null;
    this.globalData.partnerInfo = null;
  },
  
  // 公共方法：自动登录
  autoLogin: function(callback) {
    if (this.globalData.manualLogout || !auth.getToken()) return callback && callback(false, null);
    api.me().then(({ user, partner }) => {
      this.globalData.openid = user.id;
      this.globalData.userInfo = user;
      this.globalData.coupleId = user.coupleId;
      this.globalData.partnerInfo = partner || null;
      this.saveLoginStatus({ openid: user.id, coupleId: user.coupleId, userInfo: user, partnerInfo: partner || null });
      if (callback) callback(true, user);
    }).catch(() => { auth.clearSession(); this.clearLoginStatus(); if (callback) callback(false, null); });
  },
  
  globalData: {
    openid: '',
    coupleId: '',
    userInfo: null,
    partnerInfo: null,
    manualLogout: false
  }
})
