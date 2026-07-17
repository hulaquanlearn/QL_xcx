const app = getApp();
const api = require('../../services/api');
const auth = require('../../services/auth');

Page({
  data: {
    userInfo: null,
    partnerInfo: null,
    inviteCode: '',
    userAvatar: '',
    partnerAvatar: '',
    userName: '',
    hasPartner: false,
    coupleInfo: null,
    albumCount: 0,
    countdownCount: 0,
    pendingOrderCount: 0,
    cacheSize: '0 KB',
    showInviteModal: false,
    showBindModal: false,
    inputInviteCode: '',
    showEditModal: false,
    editName: '',
    editGender: ''
  },

  onLoad() {
    if (!this.checkLogin()) return;
    this.refreshPage();
  },

  onShow() {
    if (!this.checkLogin()) return;
    this.refreshPage();
  },

  checkLogin() {
    if (auth.getToken() && app.globalData.userInfo) return true;
    wx.reLaunch({ url: '/pages/index/index' });
    return false;
  },

  refreshPage() {
    this.loadUserData();
    Promise.all([this.loadStats(), this.loadAvatars()]).catch(() => {});
  },

  loadUserData() {
    const user = app.globalData.userInfo || {};
    const partner = app.globalData.partnerInfo || null;
    this.setData({
      userInfo: user,
      partnerInfo: partner,
      inviteCode: user.inviteCode || '',
      userName: user.name || user.account || '我的',
      hasPartner: Boolean(user.coupleId && user.partnerOpenid),
      coupleInfo: partner,
      editGender: user.gender || 'other'
    });
    api.me().then(({ user: freshUser, partner: freshPartner }) => {
      app.globalData.userInfo = freshUser;
      app.globalData.coupleId = freshUser.coupleId;
      app.globalData.partnerInfo = freshPartner || null;
      app.saveLoginStatus({ openid: freshUser.id, coupleId: freshUser.coupleId, userInfo: freshUser, partnerInfo: freshPartner || null });
      this.setData({
        userInfo: freshUser,
        partnerInfo: freshPartner || null,
        inviteCode: freshUser.inviteCode || '',
        userName: freshUser.name || freshUser.account || '我的',
        hasPartner: Boolean(freshUser.coupleId && freshUser.partnerOpenid),
        coupleInfo: freshPartner || null,
        editGender: freshUser.gender || 'other'
      });
    }).catch(() => {});
  },

  loadStats() {
    if (!app.globalData.coupleId) {
      this.setData({ albumCount: 0, countdownCount: 0, pendingOrderCount: 0 });
      return Promise.resolve();
    }
    return api.dashboard().then(({ counts }) => this.setData({
      albumCount: Number(counts.album) || 0,
      countdownCount: Number(counts.countdown) || 0,
      pendingOrderCount: Number(counts.orders) || 0
    })).catch(() => this.setData({ albumCount: 0, countdownCount: 0, pendingOrderCount: 0 }));
  },

  loadAvatars() {
    if (!app.globalData.coupleId) return Promise.resolve();
    return api.getAvatars().then(rows => {
      const avatars = rows[0] || {};
      const fileList = [avatars.male, avatars.female].filter(Boolean);
      if (!fileList.length) return this.setData({ userAvatar: '', partnerAvatar: '' });
      return wx.cloud.getTempFileURL({ fileList }).then(result => {
        const urls = {};
        result.fileList.forEach(item => { urls[item.fileID] = item.tempFileURL; });
        const userGender = this.data.userInfo?.gender;
        const partnerGender = this.data.partnerInfo?.gender;
        this.setData({
          userAvatar: urls[userGender === 'female' ? avatars.female : avatars.male] || '',
          partnerAvatar: urls[partnerGender === 'female' ? avatars.female : avatars.male] || ''
        });
      });
    }).catch(() => this.setData({ userAvatar: '', partnerAvatar: '' }));
  },

  goToOrders() { wx.navigateTo({ url: '/pages/food/index?tab=orders' }); },
  goToAlbum() { wx.navigateTo({ url: '/pages/album/index' }); },
  goToCountdown() { wx.navigateTo({ url: '/pages/countdown/list/index' }); },
  goToFood() { wx.navigateTo({ url: '/pages/food/index' }); },
  showInviteCode() { this.setData({ showInviteModal: true }); },
  closeInviteModal() { this.setData({ showInviteModal: false }); },
  showBindModal() { this.setData({ showBindModal: true }); },
  closeBindModal() { this.setData({ showBindModal: false, inputInviteCode: '' }); },
  preventBubble() {},
  onInviteCodeInput(e) { this.setData({ inputInviteCode: String(e.detail.value || '').toUpperCase() }); },

  copyInviteCode() {
    if (!this.data.inviteCode) return wx.showToast({ title: '邀请码暂不可用', icon: 'none' });
    wx.setClipboardData({ data: this.data.inviteCode });
  },

  bindPartner() {
    const code = this.data.inputInviteCode.trim();
    if (!code) return wx.showToast({ title: '请输入邀请码', icon: 'none' });
    if (code === this.data.inviteCode) return wx.showToast({ title: '不能绑定自己的邀请码', icon: 'none' });
    wx.showLoading({ title: '绑定中...' });
    api.bindPartner(code).then(({ coupleId, partner }) => {
      const user = { ...app.globalData.userInfo, coupleId, partnerOpenid: partner.id };
      app.globalData.coupleId = coupleId;
      app.globalData.userInfo = user;
      app.globalData.partnerInfo = partner;
      app.saveLoginStatus({ openid: app.globalData.openid, coupleId, userInfo: user, partnerInfo: partner });
      this.setData({ showBindModal: false, inputInviteCode: '', userInfo: user, partnerInfo: partner, hasPartner: true, coupleInfo: partner });
      this.refreshPage();
      wx.showToast({ title: '绑定成功', icon: 'success' });
    }).catch(error => wx.showToast({ title: error.message || '绑定失败', icon: 'none' })).finally(() => wx.hideLoading());
  },

  clearCache() {
    ['menus', 'orders'].forEach(key => wx.removeStorageSync(key));
    this.setData({ cacheSize: '0 KB' });
    wx.showToast({ title: '缓存已清理', icon: 'success' });
  },

  showEditProfileModal() {
    const user = this.data.userInfo || {};
    this.setData({ showEditModal: true, editName: user.name || '', editGender: user.gender || 'other' });
  },
  closeEditProfileModal() { this.setData({ showEditModal: false }); },
  onEditNameInput(e) { this.setData({ editName: e.detail.value }); },
  selectGender(e) { this.setData({ editGender: e.currentTarget.dataset.gender }); },

  saveProfile() {
    const name = this.data.editName.trim();
    if (!name) return wx.showToast({ title: '请输入昵称', icon: 'none' });
    api.profile({ name, gender: this.data.editGender }).then(({ user }) => {
      const merged = { ...app.globalData.userInfo, ...user };
      app.globalData.userInfo = merged;
      app.saveLoginStatus({ openid: app.globalData.openid, coupleId: app.globalData.coupleId, userInfo: merged, partnerInfo: app.globalData.partnerInfo });
      this.setData({ userInfo: merged, userName: merged.name, showEditModal: false });
      this.loadAvatars();
      wx.showToast({ title: '已保存', icon: 'success' });
    }).catch(error => wx.showToast({ title: error.message || '保存失败', icon: 'none' }));
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新输入账号和密码。',
      success: result => {
        if (!result.confirm) return;
        api.logout().catch(() => {}).finally(() => {
          auth.clearSession();
          app.clearLoginStatus();
          app.globalData.manualLogout = true;
          wx.reLaunch({ url: '/pages/index/index' });
        });
      }
    });
  }
});
