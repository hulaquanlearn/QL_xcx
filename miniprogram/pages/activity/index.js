// pages/activity/index.js
const app = getApp()
const api = require('../../services/api')
const mediaService = require('../../services/media')
const dateUtils = require('../../utils/date')
const auth = require('../../services/auth')
const { createUploadQueue } = require('../../services/upload-queue')

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
    timelineLoading: false,
    tasksCursor: '', tasksHasMore: false, timelineCursor: '', timelineHasMore: false,
    tasksError: '', timelineError: '', totalCount: 0,
    photoUploads: [], uploadTaskTitle: '',
    uploadLabels: { queued: '等待上传', uploading: '上传中', moderating: '审核中', saving: '保存中', ready: '已添加', failed: '未完成', paused: '已暂停' }
  },

  onLoad(options) {
    this.checkLogin();
  },

  onShow() {
    this._visible = true;
    this.getTasksList();
    this.loadTimeline();
    if (this._photoQueue) this._photoQueue.resume();
  },

  onHide() { this._visible = false; this._taskSequence = (this._taskSequence || 0) + 1; this._timelineSequence = (this._timelineSequence || 0) + 1; if (this._photoQueue) this._photoQueue.pause(); },
  onUnload() { this.onHide(); },
  onReachBottom() { this.data.viewMode === 'timeline' ? this.moreTimeline() : this.moreTasks(); },
  moreTasks() { if (!this.data.loading && this.data.tasksHasMore) return this.getTasksList(true); },
  moreTimeline() { if (!this.data.timelineLoading && this.data.timelineHasMore) return this.loadTimeline(true); },

  onPullDownRefresh() {
    Promise.all([this.getTasksList(), this.loadTimeline()]).finally(() => wx.stopPullDownRefresh());
  },

  switchView: function(e) {
    this.setData({ viewMode: e.currentTarget.dataset.view });
  },

  loadTimeline: function(append = false) {
    append = append === true;
    if (!app.globalData.coupleId) return Promise.resolve();
    const sequence = this._timelineSequence = (this._timelineSequence || 0) + 1;
    this.setData({ timelineLoading: true, timelineError: '' });
    return api.timelinePage({ limit: 30, ...(append && this.data.timelineCursor ? { cursor: this.data.timelineCursor } : {}) }).then(result => {
      if (sequence !== this._timelineSequence || this._visible === false) return;
      const events = result.items || [];
      const existing = append ? this.data.timeline : [];
      const byId = new Map(existing.map(item => [item.id, item]));
      events.forEach(event => byId.set(event.id, { ...event, dateText: this.formatTimelineDate(event.eventAt), imageUrls: [] }));
      this.setData({ timeline: [...byId.values()], timelineLoading: false, timelineCursor: result.nextCursor || '', timelineHasMore: Boolean(result.hasMore) });
      const keys = events.flatMap(event => event.images || []).filter(Boolean);
      const resolved = {};
      return mediaService.resolveFiles(keys, {
        variant: 'thumbnail',
        isCancelled: () => sequence !== this._timelineSequence || this._visible === false,
        onResolved: (key, url) => {
          if (sequence !== this._timelineSequence || this._visible === false) return;
          resolved[key] = url;
          this.setData({ timeline: this.data.timeline.map(event => events.some(incoming => incoming.id === event.id)
            ? { ...event, imageUrls: (event.images || []).map(image => resolved[image]).filter(Boolean) } : event) });
        }
      });
    }).catch(error => {
      if (sequence !== this._timelineSequence || this._visible === false) return;
      console.error('获取共同时间线失败：', error);
      this.setData({ timelineLoading: false, timelineError: error.message || '读取失败，请重试' });
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
    wx.showLoading({ title: '加载原图' });
    mediaService.resolveFiles(event.images || []).then(files => {
      if (this._visible === false) return;
      const urls = (event.images || []).map(key => files[key]).filter(Boolean);
      if (urls.length) wx.previewImage({ current: urls[Math.max(0, event.imageUrls.indexOf(e.currentTarget.dataset.url))] || urls[0], urls });
      else wx.showToast({ title: '原图加载失败，请重试', icon: 'none' });
    }).finally(() => wx.hideLoading());
  },

  checkLogin: function() {
    if (!app.globalData.userId || !app.globalData.coupleId) {
      wx.reLaunch({ url: '/pages/index/index' });
      return false;
    }
    return true;
  },

  getTasksList: function(append = false) {
    append = append === true;
    const coupleId = app.globalData.coupleId;
    
    if (!coupleId) {
      this.setData({ 
        tasksList: [],
        filteredTasksList: [],
        completedCount: 0,
        pendingCount: 0
      });
      return Promise.resolve();
    }

    const sequence = this._taskSequence = (this._taskSequence || 0) + 1;
    const status = this.data.currentFilter;
    this.setData({ loading: true, tasksError: '' });
    return api.listPage('tasks', { limit: 30, ...(status !== 'all' ? { status } : {}), ...(append && this.data.tasksCursor ? { cursor: this.data.tasksCursor } : {}) }).then(result => {
      if (sequence !== this._taskSequence || this._visible === false) return;
      const rows = result.items || [];
      const currentById = new Map(this.data.tasksList.map(item => [String(item.id), item]));
      const incoming = rows.map(item => ({
        ...item,
        id: item._id,
        photos: currentById.get(String(item._id))?.photos || [],
        photoPreview: currentById.get(String(item._id))?.photoPreview || [],
        photoCount: item.photoCount !== undefined ? Number(item.photoCount) : currentById.get(String(item._id))?.photoCount || 0
      }));
      const byId = new Map((append ? this.data.tasksList : []).map(item => [item.id, item]));
      incoming.forEach(item => byId.set(item.id, item));
      const tasksList = [...byId.values()];
      const completedCount = tasksList.filter(t => t.completed).length;
      const pendingCount = tasksList.length - completedCount;

      this.setData({
        tasksList: tasksList,
        completedCount: result.counts ? result.counts.completed : completedCount,
        pendingCount: result.counts ? result.counts.pending : pendingCount,
        totalCount: result.counts ? result.counts.all : tasksList.length,
        tasksCursor: result.nextCursor || '', tasksHasMore: Boolean(result.hasMore),
        loading: false
      });
      this.applyFilter();
      this.loadTaskPhotos(incoming, sequence);
    }).catch(err => {
      if (sequence !== this._taskSequence || this._visible === false) return;
      console.error('获取任务失败：', err);
      this.setData({ loading: false, tasksError: err.message || '获取任务失败' });
      wx.showToast({ title: '获取任务失败', icon: 'none' });
    });
  },

  loadTaskPhotos: function(tasksList, sequence = this._taskSequence) {
    if (!tasksList.length) return Promise.resolve();
    return api.list('album', { taskIds: tasksList.map(item => item.id).join(','), linkedTasks: 1, limit: 200 }).then(rows => {
      const linkedPhotos = rows.filter(photo => photo.taskId);
      const photosByTask = new Map();
      linkedPhotos.forEach(photo => {
        const taskId = String(photo.taskId);
        if (!photosByTask.has(taskId)) photosByTask.set(taskId, []);
        if (photosByTask.get(taskId).length < 4) photosByTask.get(taskId).push({ ...photo, storageKey: photo.fileID || photo.imgUrl, imgUrl: '' });
      });
      const previews = [...photosByTask.values()].flat();
      const keys = previews.map(photo => photo.storageKey).filter(Boolean);
      const updatePhotos = () => {
        if (sequence !== this._taskSequence || this._visible === false) return;
        const loadedIds = new Set(tasksList.map(task => String(task.id)));
        this.setData({ tasksList: this.data.tasksList.map(task => loadedIds.has(String(task.id)) ? { ...task, photoPreview: photosByTask.get(String(task.id)) || [] } : task) });
        this.applyFilter();
      };
      updatePhotos();
      return mediaService.resolveFiles(keys, {
        variant: 'thumbnail',
        isCancelled: () => sequence !== this._taskSequence || this._visible === false,
        onResolved: (key, url) => { previews.forEach(photo => { if (photo.storageKey === key) photo.imgUrl = url; }); updatePhotos(); }
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
    if (!['all', 'pending', 'completed'].includes(filter) || filter === this.data.currentFilter) return;
    this.setData({ currentFilter: filter, tasksList: [], filteredTasksList: [], tasksCursor: '' });
    this.getTasksList();
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
    if (this._photoQueue && this._photoTaskId !== String(task.id) && this.data.photoUploads.some(item => item.status !== 'ready')) {
      wx.showToast({ title: '请先重试或收起上一组照片', icon: 'none' });
      return;
    }
    wx.chooseImage({
      count: 9,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: result => this.uploadTaskPhotos(task, result.tempFilePaths || [])
    });
  },

  uploadTaskPhotos: function(task, filePaths) {
    if (!filePaths.length) return;
    if (!this._photoQueue || this._photoTaskId !== String(task.id)) {
      const token = auth.getToken();
      this._photoTaskId = String(task.id);
      this._photoQueue = createUploadQueue({
        concurrency: 2,
        isCancelled: () => this._visible === false || auth.getToken() !== token,
        upload: (path, controls) => mediaService.upload(path, 'album', controls),
        waitForReview: (id, controls) => api.waitForMediaCheck(id, controls),
        save: key => api.attachTaskPhotos(task.id, [key], task.title),
        onChange: (items, busy) => {
          if (this._visible !== false && auth.getToken() === token) this.setData({ photoUploads: items, uploadingTaskId: busy ? String(task.id) : '', uploadTaskTitle: task.title });
        }
      });
    }
    return this._photoQueue.add(filePaths).then(() => {
      if (this._visible !== false) { this.getTasksList(); this.loadTimeline(); }
    });
  },

  retryTaskPhoto(event) {
    if (this._photoQueue) return this._photoQueue.retry(event.currentTarget.dataset.id).then(() => { if (this._visible !== false) this.getTasksList(); });
  },

  closePhotoQueue() {
    if (this.data.uploadingTaskId) return;
    const clear = () => {
      if (this._photoQueue) this._photoQueue.pause();
      this._photoQueue = null;
      this._photoTaskId = '';
      this.setData({ photoUploads: [], uploadTaskTitle: '' });
    };
    if (this.data.photoUploads.some(item => item.status !== 'ready')) {
      wx.showModal({ title: '收起上传记录？', content: '已成功添加的照片会保留；未完成的照片需要重新选择。', success: result => { if (result.confirm) clear(); } });
    } else clear();
  },

  previewTaskPhotos: function(e) {
    const taskId = String(e.currentTarget.dataset.id || '');
    if (taskId) wx.navigateTo({ url: `/pages/album/index?taskId=${encodeURIComponent(taskId)}` });
  }
})
