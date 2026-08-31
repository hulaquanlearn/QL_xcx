// pages/activity/index.js
const app = getApp()
const api = require('../../services/api')
const mediaService = require('../../services/media')
const dateUtils = require('../../utils/date')

Page({
  data: {
    tasksList: [],
    filteredTasksList: [],
    loading: false,
    currentFilter: 'all',
    completedCount: 0,
    pendingCount: 0,
    showModal: false,
    modalTitle: '',
    modalValue: '',
    editingTaskId: null,
    uploadingTaskId: '',
    viewMode: 'list',
    timeline: [],
    timelineLoading: false
  },

  onLoad(options) {
    this.checkLogin();
  },

  onShow() {
    this.getTasksList();
    this.loadTimeline();
  },

  onPullDownRefresh() {
    Promise.all([this.getTasksList(), this.loadTimeline()]).finally(() => wx.stopPullDownRefresh());
  },

  switchView: function(e) {
    this.setData({ viewMode: e.currentTarget.dataset.view });
  },

  loadTimeline: function() {
    if (!app.globalData.coupleId) return Promise.resolve();
    this.setData({ timelineLoading: true });
    return api.timeline(60).then(events => {
      const keys = events.flatMap(event => event.images || []).filter(Boolean);
      return mediaService.resolveFiles(keys).then(urls => {
        const timeline = events.map(event => ({
          ...event,
          dateText: this.formatTimelineDate(event.eventAt),
          imageUrls: (event.images || []).map(key => urls[key]).filter(Boolean)
        }));
        this.setData({ timeline, timelineLoading: false });
      });
    }).catch(error => {
      console.error('获取共同时间线失败：', error);
      this.setData({ timelineLoading: false });
    });
  },

  formatTimelineDate: function(value) {
    const date = dateUtils.parseDateTime(value);
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}.${month}.${day}`;
  },

  previewTimeline: function(e) {
    const event = this.data.timeline.find(item => item.id === e.currentTarget.dataset.id);
    if (!event?.imageUrls?.length) return;
    wx.previewImage({ current: e.currentTarget.dataset.url || event.imageUrls[0], urls: event.imageUrls });
  },

  checkLogin: function() {
    if (!app.globalData.userId || !app.globalData.coupleId) {
      wx.redirectTo({ url: '/pages/index/index' });
      return false;
    }
    return true;
  },

  getTasksList: function() {
    const coupleId = app.globalData.coupleId;
    
    if (!coupleId) {
      this.setData({ 
        tasksList: [],
        filteredTasksList: [],
        completedCount: 0,
        pendingCount: 0
      });
      return;
    }

    this.setData({ loading: true });
    return api.list('tasks', { limit: 200 }).then(rows => {
      const currentById = new Map(this.data.tasksList.map(item => [String(item.id), item]));
      const tasksList = rows.map(item => ({
        ...item,
        id: item._id,
        photos: currentById.get(String(item._id))?.photos || [],
        photoPreview: currentById.get(String(item._id))?.photoPreview || [],
        photoCount: currentById.get(String(item._id))?.photoCount || 0
      }));

      const completedCount = tasksList.filter(t => t.completed).length;
      const pendingCount = tasksList.length - completedCount;

      this.setData({
        tasksList: tasksList,
        completedCount: completedCount,
        pendingCount: pendingCount,
        loading: false
      });
      this.applyFilter();
      this.loadTaskPhotos(tasksList);
    }).catch(err => {
      console.error('获取任务失败：', err);
      this.setData({ loading: false });
      wx.showToast({ title: '获取任务失败', icon: 'none' });
    });
  },

  loadTaskPhotos: function(tasksList) {
    return api.list('album', { linkedTasks: 1, limit: 200 }).then(rows => {
      const linkedPhotos = rows.filter(photo => photo.taskId);
      const keys = linkedPhotos.map(photo => photo.fileID || photo.imgUrl).filter(Boolean);
      return mediaService.resolveFiles(keys).then(urls => {
        const photosByTask = new Map();
        linkedPhotos.forEach(photo => {
          const key = photo.fileID || photo.imgUrl;
          const taskId = String(photo.taskId);
          if (!photosByTask.has(taskId)) photosByTask.set(taskId, []);
          photosByTask.get(taskId).push({ ...photo, imgUrl: urls[key] || '' });
        });
        const updated = tasksList.map(task => {
          const photos = photosByTask.get(String(task.id)) || [];
          return {
            ...task,
            photos,
            photoPreview: photos.slice(0, 4),
            photoCount: photos.length
          };
        });
        this.setData({ tasksList: updated });
        this.applyFilter();
      });
    }).catch(error => {
      console.error('加载清单照片失败：', error);
    });
  },

  applyFilter: function() {
    const { tasksList, currentFilter } = this.data;
    let filteredTasksList = [];
    
    if (currentFilter === 'all') {
      filteredTasksList = tasksList;
    } else if (currentFilter === 'pending') {
      filteredTasksList = tasksList.filter(t => !t.completed);
    } else if (currentFilter === 'completed') {
      filteredTasksList = tasksList.filter(t => t.completed);
    }
    
    this.setData({ filteredTasksList: filteredTasksList });
  },

  switchFilter: function(e) {
    const filter = e.currentTarget.dataset.filter;
    this.setData({ currentFilter: filter });
    this.applyFilter();
  },

  addTask: function() {
    this.setData({
      showModal: true,
      modalTitle: '添加必做事项',
      modalValue: '',
      editingTaskId: null
    });
  },

  // 关闭弹窗
  closeModal: function() {
    this.setData({
      showModal: false,
      modalValue: '',
      editingTaskId: null
    });
  },

  // 阻止冒泡
  preventBubble: function() {
    // 什么都不做，只是阻止冒泡
  },

  // 弹窗输入
  onModalInput: function(e) {
    this.setData({ modalValue: e.detail.value });
  },

  // 确认弹窗
  confirmModal: function() {
    const value = this.data.modalValue.trim();
    if (!value) {
      wx.showToast({ title: '请输入标题', icon: 'none' });
      return;
    }

    if (this.data.editingTaskId) {
      this.updateTask(this.data.editingTaskId, value);
    } else {
      this.createTask(value);
    }

    this.setData({
      showModal: false,
      modalValue: '',
      editingTaskId: null
    });
  },

  createTask: function(title) {
    const coupleId = app.globalData.coupleId;

    if (!coupleId) {
      wx.showToast({ title: '请先绑定情侣', icon: 'none' });
      return;
    }

    api.create('tasks', {
      title: title,
      description: '',
      completed: false
    }).then(() => {
      wx.showToast({ title: '添加成功', icon: 'success' });
      this.getTasksList();
    }).catch(err => {
      console.error('添加任务失败：', err);
      wx.showToast({ title: '添加失败', icon: 'none' });
    });
  },

  editTask: function(e) {
    const taskId = e.currentTarget.dataset.id;
    const task = this.data.tasksList.find(item => item.id === taskId);
    if (!task) return;

    this.setData({
      showModal: true,
      modalTitle: '编辑必做事项',
      modalValue: task.title,
      editingTaskId: taskId
    });
  },

  updateTask: function(taskId, title) {
    api.update('tasks', taskId, {
      title: title
    }).then(() => {
      wx.showToast({ title: '更新成功', icon: 'success' });
      this.getTasksList();
    }).catch(err => {
      console.error('更新任务失败：', err);
      wx.showToast({ title: '更新失败', icon: 'none' });
    });
  },

  deleteTask: function(e) {
    const taskId = e.currentTarget.dataset.id;

    wx.showModal({
      title: '确认删除',
      content: '删除清单后，关联照片仍会保留在相册中。确定继续吗？',
      success: (res) => {
        if (res.confirm) {
          this.removeTask(taskId);
        }
      }
    });
  },

  removeTask: function(taskId) {
    api.remove('tasks', taskId).then(() => {
      wx.showToast({ title: '删除成功', icon: 'success' });
      this.getTasksList();
    }).catch(err => {
      console.error('删除任务失败：', err);
      wx.showToast({ title: '删除失败', icon: 'none' });
    });
  },

  toggleTaskStatus: function(e) {
    const taskId = e.currentTarget.dataset.id;
    const task = this.data.tasksList.find(item => item.id === taskId);
    if (!task) return;

    const newStatus = !task.completed;

    api.update('tasks', taskId, {
      completed: newStatus
    }).then(() => {
      wx.showToast({ 
        title: newStatus ? '任务完成！' : '已取消完成', 
        icon: 'success' 
      });
      this.getTasksList();
      if (newStatus) this.promptTaskPhotos(task);
    }).catch(err => {
      console.error('更新状态失败：', err);
      wx.showToast({ title: '操作失败', icon: 'none' });
    });
  },

  promptTaskPhotos: function(task) {
    wx.showModal({
      title: '这件事完成啦',
      content: '要把这次的照片一起留在相册里吗？可以一次选择多张，以后也能继续追加。',
      confirmText: '添加照片',
      cancelText: '暂不添加',
      success: result => {
        if (result.confirm) this.chooseTaskPhotosByTask(task);
      }
    });
  },

  addTaskPhotos: function(e) {
    const taskId = String(e.currentTarget.dataset.id || '');
    const task = this.data.tasksList.find(item => String(item.id) === taskId);
    if (task) this.chooseTaskPhotosByTask(task);
  },

  chooseTaskPhotosByTask: function(task) {
    if (this.data.uploadingTaskId) return;
    wx.chooseImage({
      count: 9,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: result => this.uploadTaskPhotos(task, result.tempFilePaths || [])
    });
  },

  uploadTaskPhotos: function(task, filePaths) {
    if (!filePaths.length) return;
    const uploadedKeys = [];
    this.setData({ uploadingTaskId: String(task.id) });
    wx.showLoading({ title: `上传${filePaths.length}张照片` });
    this.uploadPhotoFiles(filePaths, uploadedKeys)
      .then(keys => api.attachTaskPhotos(task.id, keys, task.title))
      .then(result => {
        wx.hideLoading();
        wx.showToast({ title: `已添加${result.count}张`, icon: 'success' });
        return this.getTasksList();
      }).catch(error => {
        Promise.all(uploadedKeys.map(key => mediaService.remove(key))).catch(() => {});
        wx.hideLoading();
        wx.showToast({ title: error.message || '照片添加失败', icon: 'none' });
      }).finally(() => {
        this.setData({ uploadingTaskId: '' });
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
    return Promise.all(Array.from({ length: workerCount }, worker))
      .then(() => {
        if (firstError) throw firstError;
        return uploadedKeys.slice();
      });
  },

  previewTaskPhotos: function(e) {
    const taskId = String(e.currentTarget.dataset.id || '');
    const current = e.currentTarget.dataset.url;
    const task = this.data.tasksList.find(item => String(item.id) === taskId);
    const urls = (task?.photos || []).map(photo => photo.imgUrl).filter(Boolean);
    if (urls.length) wx.previewImage({ current: current || urls[0], urls });
  }
})
