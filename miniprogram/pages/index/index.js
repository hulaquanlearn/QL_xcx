//index.js
//获取应用实例
const app = getApp()
const api = require('../../services/api')
const auth = require('../../services/auth')

Page({
  data: {
    isLoggedIn: false,
    coupleId: '',
    loveDays: 0,
    avatars: {},
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
    const targetDate = new Date(dateStr);
    const now = new Date();

    // 重置时间为当天的00:00:00
    const target = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const diffTime = today - target;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    return diffDays;
  },

  // 加载头像
  loadAvatars: function() {
    const db = wx.cloud.database();
    const coupleId = this.data.coupleId || app.globalData.coupleId;
    
    if (!coupleId) return;
    
    db.collection('avatars').where({
      coupleId: coupleId
    }).get().then(res => {
      if (res.data.length > 0) {
        const avatarsData = res.data[0];
        const fileIDs = [];
        if (avatarsData.male) fileIDs.push(avatarsData.male);
        if (avatarsData.female) fileIDs.push(avatarsData.female);
        
        if (fileIDs.length > 0) {
          wx.cloud.getTempFileURL({
            fileList: fileIDs
          }).then(tempRes => {
            const tempURLs = {};
            tempRes.fileList.forEach(item => {
              if (avatarsData.male === item.fileID) {
                tempURLs.male = item.tempFileURL;
              }
              if (avatarsData.female === item.fileID) {
                tempURLs.female = item.tempFileURL;
              }
            });
            this.setData({ 
              avatars: avatarsData,
              maleAvatar: tempURLs.male || '',
              femaleAvatar: tempURLs.female || ''
            });
          }).catch(err => {
            console.error('获取临时URL失败：', err);
            this.setData({ 
              avatars: avatarsData,
              maleAvatar: avatarsData.male || '',
              femaleAvatar: avatarsData.female || ''
            });
          });
        } else {
          this.setData({ 
            avatars: avatarsData,
            maleAvatar: '',
            femaleAvatar: ''
          });
        }
      } else {
        this.setData({ 
          avatars: {},
          maleAvatar: '',
          femaleAvatar: ''
        });
      }
    }).catch(err => {
      console.error('获取头像失败：', err);
    });
  },
  
  // 上传头像
  uploadAvatar: function(e) {
    const gender = e.currentTarget.dataset.gender;
    const that = this;
    
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: function(res) {
        const tempFilePath = res.tempFilePaths[0];
        that.uploadAvatarToCloud(tempFilePath, gender);
      }
    });
  },
  
  // 上传头像到云存储
  uploadAvatarToCloud: function(tempFilePath, gender) {
    const coupleId = this.data.coupleId || app.globalData.coupleId;
    const cloudPath = `avatars/${coupleId}_${gender}_${Date.now()}.jpg`;
    
    this.setData({ uploading: true });
    
    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: tempFilePath,
      success: res => {
        this.updateAvatarInDB(res.fileID, gender);
      },
      fail: err => {
        console.error('上传头像失败：', err);
        this.setData({ uploading: false });
        wx.showToast({ title: '上传失败', icon: 'none' });
      }
    });
  },
  
  // 更新头像到数据库
  updateAvatarInDB: function(fileID, gender) {
    const db = wx.cloud.database();
    const coupleId = this.data.coupleId || app.globalData.coupleId;
    
    db.collection('avatars').where({
      coupleId: coupleId
    }).get().then(res => {
      if (res.data.length > 0) {
        // 已存在头像记录，更新
        const avatarData = {};
        avatarData[gender] = fileID;
        
        db.collection('avatars').doc(res.data[0]._id).update({
          data: avatarData
        }).then(() => {
          this.loadAvatars();
          this.setData({ uploading: false });
          wx.showToast({ title: '头像更新成功', icon: 'success' });
        });
      } else {
        // 不存在头像记录，创建
        const avatarData = {
          coupleId: coupleId,
          [gender]: fileID,
          createdAt: db.serverDate()
        };
        
        db.collection('avatars').add({
          data: avatarData
        }).then(() => {
          this.loadAvatars();
          this.setData({ uploading: false });
          wx.showToast({ title: '头像设置成功', icon: 'success' });
        });
      }
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
      this.setData({ albumList: res.data });
    }).catch(err => {
      console.error('获取相册失败：', err);
    });
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
        const targetDate = new Date(item.date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        targetDate.setHours(0, 0, 0, 0);
        const diffTime = targetDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        let dateText = '';
        if (diffDays > 0) {
          dateText = `还有${diffDays}天`;
        } else if (diffDays === 0) {
          dateText = '今天';
        } else {
          dateText = `已过${Math.abs(diffDays)}天`;
        }
        
        return {
          ...item,
          dateText: dateText
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
  imgError: function(e) {
    console.log('图片加载失败', e);
  },
})
