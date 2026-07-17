// pages//album/index.js
const app = getApp()

Page({
  data: {
    albums: [],
    albumList: [],
    groupedAlbumList: [],
    selectedPhotos: [],
    selectMode: false,
    loading: false
  },
  
  onLoad: function() {
    this.checkLogin();
    this.loadAlbums();
  },
  
  // 页面显示时刷新数据
  onShow: function() {
    this.loadAlbums();
  },
  
  // 检查登录状态
  checkLogin: function() {
    if (!app.globalData.openid || !app.globalData.coupleId) {
      wx.redirectTo({ url: '/pages/index/index' });
      return false;
    }
    return true;
  },
  
  // 加载相册
  loadAlbums: function() {
    this.setData({ loading: true });
    const db = wx.cloud.database();
    const coupleId = app.globalData.coupleId;
    
    console.log('加载相册，coupleId:', coupleId);
    
    if (!coupleId) {
      console.log('coupleId为空，无法加载相册');
      this.setData({ 
        albums: [],
        albumList: [],
        groupedAlbumList: [],
        loading: false 
      });
      return;
    }
    
    db.collection('album').where({
      coupleId: coupleId
    }).orderBy('createTime', 'desc').get().then(res => {
      console.log('获取相册成功:', res.data);
      
      // 格式化数据，确保字段名一致
      const albumList = res.data.map(item => ({
        ...item,
        imgUrl: item.imageUrl || item.imgUrl
      }));
      
      // 按日期分组
      const groupedAlbumList = this.groupByDate(albumList);
      
      this.setData({ 
        albums: res.data,
        albumList: albumList,
        groupedAlbumList: groupedAlbumList,
        loading: false 
      });
    }).catch(err => {
      console.error('获取相册失败：', err);
      this.setData({ loading: false });
    });
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
    const date = new Date(dateStr);
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
          const db = wx.cloud.database();
          
          const promises = selectedPhotos.map(id => {
            return db.collection('album').doc(id).remove();
          });
          
          Promise.all(promises).then(() => {
            const fileList = that.data.albumList
              .filter(item => selectedPhotos.includes(item._id))
              .map(item => item.imgUrl)
              .filter(url => typeof url === 'string' && url.indexOf('cloud://') === 0);
            if (fileList.length) wx.cloud.deleteFile({ fileList }).catch(() => {});
            that.setData({ 
              loading: false,
              selectMode: false,
              selectedPhotos: []
            });
            wx.showToast({ title: '删除成功', icon: 'success' });
            that.loadAlbums();
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
    const uploadPromises = [];
    const coupleId = app.globalData.coupleId;
    
    tempFilePaths.forEach((tempFilePath, index) => {
      const cloudPath = `album/${coupleId}_${Date.now()}_${index}.jpg`;
      uploadPromises.push(
        new Promise((resolve, reject) => {
          wx.cloud.uploadFile({
            cloudPath: cloudPath,
            filePath: tempFilePath,
            success: res => {
              resolve(res.fileID);
            },
            fail: err => {
              reject(err);
            }
          });
        })
      );
    });
    
    Promise.all(uploadPromises).then(fileIDs => {
      this.saveImages(fileIDs);
    }).catch(err => {
      console.error('上传图片失败：', err);
      this.setData({ loading: false });
      wx.showToast({ title: '上传失败', icon: 'none' });
    });
  },
  
  // 保存图片到数据库
  saveImages: function(fileIDs) {
    const db = wx.cloud.database();
    const userInfo = app.globalData.userInfo;
    const coupleId = app.globalData.coupleId;
    
    const promises = fileIDs.map(fileID => {
      return db.collection('album').add({
        data: {
          imageUrl: fileID,
          coupleId: coupleId,
          author: userInfo ? userInfo.name : '',
          createTime: db.serverDate()
        }
      });
    });
    
    Promise.all(promises).then(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '上传成功', icon: 'success' });
      this.loadAlbums();
    }).catch(err => {
      console.error('保存图片失败：', err);
      this.setData({ loading: false });
      wx.showToast({ title: '保存失败', icon: 'none' });
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
          const db = wx.cloud.database();
          
          db.collection('album').doc(photoId).remove().then(() => {
            that.setData({ loading: false });
            wx.showToast({ title: '删除成功', icon: 'success' });
            that.loadAlbums();
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
    const images = this.data.albumList.map(item => item.imgUrl);
    const current = e.currentTarget.dataset.imgurl;
    
    wx.previewImage({
      current: current,
      urls: images
    });
  },
  
  // 下拉刷新
  onPullDownRefresh: function() {
    this.loadAlbums();
    wx.stopPullDownRefresh();
  }
})
