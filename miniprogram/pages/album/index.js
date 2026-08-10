// pages//album/index.js
const app = getApp()
const api = require('../../services/api')
const mediaService = require('../../services/media')
const dateUtils = require('../../utils/date')

Page({
  data: {
    albumList: [],
    groupedAlbumList: [],
    selectedPhotos: [],
    selectMode: false,
    loading: false,
    loadingMore: false,
    hasMore: true,
    nextCursor: ''
  },
  
  onLoad: function() {
    this.checkLogin();
  },
  
  // 页面显示时刷新数据
  onShow: function() {
    this.loadAlbums(true);
  },
  
  // 检查登录状态
  checkLogin: function() {
    if (!app.globalData.userId || !app.globalData.coupleId) {
      wx.redirectTo({ url: '/pages/index/index' });
      return false;
    }
    return true;
  },
  
  // 加载相册
  loadAlbums: function(reset = true) {
    if (this.albumRequest) return this.albumRequest;
    const coupleId = app.globalData.coupleId;
    
    if (!coupleId) {
      this.setData({ 
        albumList: [],
        groupedAlbumList: [],
        loading: false,
        loadingMore: false,
        hasMore: false,
        nextCursor: ''
      });
      return Promise.resolve();
    }

    if (!reset && !this.data.hasMore) return Promise.resolve();
    this.setData(reset ? { loading: true } : { loadingMore: true });
    const params = { limit: 30 };
    if (!reset && this.data.nextCursor) params.cursor = this.data.nextCursor;

    this.albumRequest = api.listPage('album', params).then(page => {
      const rows = page.items || [];
      const keys = rows.map(item => item.fileID || item.imageUrl || item.imgUrl).filter(Boolean);
      return mediaService.resolveFiles(keys).then(urls => {
        const resolvedRows = rows.map(item => {
          const storageKey = item.fileID || item.imageUrl || item.imgUrl;
          return { ...item, storageKey, imgUrl: urls[storageKey] || '' };
        });
        const albumList = reset ? resolvedRows : [...this.data.albumList, ...resolvedRows];
        this.setData({
          albumList,
          groupedAlbumList: this.groupByDate(albumList),
          hasMore: Boolean(page.hasMore),
          nextCursor: page.nextCursor || ''
        });
      });
    }).catch(err => {
      console.error('获取相册失败：', err);
      wx.showToast({ title: '获取相册失败', icon: 'none' });
    }).finally(() => {
      this.albumRequest = null;
      this.setData({ loading: false, loadingMore: false });
    });
    return this.albumRequest;
  },
  
  // 按日期分组
  groupByDate: function(albumList) {
    const groups = {};
    albumList.forEach(item => {
      const date = this.formatDate(item.createTime);
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(item);
    });
    
    const result = [];
    for (const date in groups) {
      result.push({
        date: date,
        photos: groups[date]
      });
    }
    return result;
  },
  
  // 格式化日期
  formatDate: function(dateStr) {
    const date = dateUtils.parseDateTime(dateStr);
    if (!date) return '日期未知';
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}年${month}月${day}日`;
  },
  
  // 切换选择模式
  toggleSelectMode: function() {
    this.setData({
      selectMode: !this.data.selectMode,
      selectedPhotos: []
    });
  },
  
  // 切换选择
  toggleSelect: function(e) {
    const id = e.currentTarget.dataset.id;
    const selectedPhotos = this.data.selectedPhotos.slice();
    const index = selectedPhotos.indexOf(id);
    
    if (index > -1) {
      selectedPhotos.splice(index, 1);
    } else {
      selectedPhotos.push(id);
    }
    
    this.setData({ selectedPhotos });
  },
  
  // 批量删除照片
  batchDeletePhotos: function() {
    const selectedPhotos = this.data.selectedPhotos;
    if (selectedPhotos.length === 0) return;
    
    const that = this;
    wx.showModal({
      title: '删除照片',
      content: `确定要删除${selectedPhotos.length}张照片吗？`,
      success: res => {
        if (res.confirm) {
          that.setData({ loading: true });
          api.batchDeleteAlbums(selectedPhotos).then(() => {
            that.setData({ 
              loading: false,
              selectMode: false,
              selectedPhotos: []
            });
            wx.showToast({ title: '删除成功', icon: 'success' });
            that.loadAlbums(true);
          }).catch(err => {
            console.error('批量删除失败：', err);
            that.setData({ loading: false });
            wx.showToast({ title: '删除失败', icon: 'none' });
          });
        }
      }
    });
  },
  
  // 选择图片
  chooseImage: function() {
    const that = this;
    wx.chooseImage({
      count: 9,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: function(res) {
        that.uploadImages(res.tempFilePaths);
      }
    });
  },
  
  // 上传图片
  uploadImages: function(tempFilePaths) {
    this.setData({ loading: true });
    const uploadedKeys = [];
    this.uploadPhotoFiles(tempFilePaths, uploadedKeys).then(fileIDs => {
      this.saveImages(fileIDs);
    }).catch(err => {
      console.error('上传图片失败：', err);
      Promise.all(uploadedKeys.map(key => mediaService.remove(key))).catch(() => {});
      this.setData({ loading: false });
      wx.showToast({ title: '上传失败', icon: 'none' });
    });
  },
  
  // 保存图片到数据库
  saveImages: function(fileIDs) {
    api.batchCreateAlbums(fileIDs).then(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '上传成功', icon: 'success' });
      this.loadAlbums(true);
    }).catch(err => {
      console.error('保存图片失败：', err);
      Promise.all(fileIDs.map(fileID => mediaService.remove(fileID))).catch(() => {});
      this.setData({ loading: false });
      wx.showToast({ title: '保存失败', icon: 'none' });
    });
  },

  uploadPhotoFiles: function(filePaths, uploadedKeys) {
    const queue = filePaths.slice();
    let firstError = null;
    const worker = () => {
      if (firstError) return Promise.resolve();
      const filePath = queue.shift();
      if (!filePath) return Promise.resolve();
      return mediaService.upload(filePath, 'album').then(result => {
        uploadedKeys.push(result.key);
      }).catch(error => {
        firstError = error;
      }).then(worker);
    };
    const workerCount = Math.min(3, queue.length);
    return Promise.all(Array.from({ length: workerCount }, worker)).then(() => {
      if (firstError) throw firstError;
      return uploadedKeys.slice();
    });
  },
  
  // 删除图片
  deleteImage: function(e) {
    const photoId = e.currentTarget.dataset.id;
    const that = this;
    
    wx.showModal({
      title: '删除图片',
      content: '确定要删除这张图片吗？',
      success: res => {
        if (res.confirm) {
          that.setData({ loading: true });
          api.remove('album', photoId).then(() => {
            that.setData({ loading: false });
            wx.showToast({ title: '删除成功', icon: 'success' });
            that.loadAlbums(true);
          }).catch(err => {
            console.error('删除失败：', err);
            that.setData({ loading: false });
            wx.showToast({ title: '删除失败', icon: 'none' });
          });
        }
      }
    });
  },
  
  // 图片预览
  previewImage: function(e) {
    const images = this.data.albumList.map(item => item.imgUrl).filter(Boolean);
    const current = e.currentTarget.dataset.imgurl;
    
    wx.previewImage({
      current: current,
      urls: images
    });
  },
  
  // 下拉刷新
  onPullDownRefresh: function() {
    Promise.resolve(this.loadAlbums(true)).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom: function() {
    this.loadAlbums(false);
  }
})
