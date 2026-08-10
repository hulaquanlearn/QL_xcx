// app.js
const api = require('./services/api');
const auth = require('./services/auth');
App({
  onLaunch: function () {
    // 检查登录状态
    this.checkLoginStatus();
  },
  
  // 检查登录状态
  checkLoginStatus: function() {
    // 从本地存储获取登录信息
    const loginInfo = wx.getStorageSync('loginInfo');
    const storedUserId = loginInfo && (loginInfo.userId || loginInfo.openid);
    if (auth.getToken() && storedUserId) {
      this.globalData.userId = storedUserId;
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
      userId: loginInfo.userId,
      coupleId: loginInfo.coupleId,
      userInfo: loginInfo.userInfo,
      partnerInfo: loginInfo.partnerInfo
    });
    // 更新全局数据
    this.globalData.userId = loginInfo.userId;
    this.globalData.coupleId = loginInfo.coupleId;
    this.globalData.userInfo = loginInfo.userInfo;
    this.globalData.partnerInfo = loginInfo.partnerInfo;
  },
  
  // 清除登录状态
  clearLoginStatus: function() {
    wx.removeStorageSync('loginInfo');
    this.globalData.userId = '';
    this.globalData.coupleId = '';
    this.globalData.userInfo = null;
    this.globalData.partnerInfo = null;
  },
  
  // 公共方法：自动登录
  autoLogin: function(callback) {
    if (this.globalData.manualLogout || !auth.getToken()) return callback && callback(false, null);
    api.me().then(({ user, partner }) => {
      this.globalData.userId = user.id;
      this.globalData.userInfo = user;
      this.globalData.coupleId = user.coupleId;
      this.globalData.partnerInfo = partner || null;
      this.saveLoginStatus({ userId: user.id, coupleId: user.coupleId, userInfo: user, partnerInfo: partner || null });
      if (callback) callback(true, user);
    }).catch(error => {
      // 只有服务端明确判定会话失效时才删除本地登录信息；断网和超时保留会话。
      if (auth.isExpiredSessionError(error)) {
        auth.clearSession();
        this.clearLoginStatus();
      }
      if (callback) callback(false, null, error);
    });
  },
  
  globalData: {
    userId: '',
    coupleId: '',
    userInfo: null,
    partnerInfo: null,
    manualLogout: false
  }
})
