// pages/activity/index.js
const app = getApp()

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
    editingTaskId: null
  },

  onLoad(options) {
    this.checkLogin();
  },

  onShow() {
    this.getTasksList();
  },

  onPullDownRefresh() {
    this.getTasksList();
    wx.stopPullDownRefresh();
  },

  checkLogin: function() {
    if (!app.globalData.openid || !app.globalData.coupleId) {
      wx.redirectTo({ url: '/pages/index/index' });
      return false;
    }
    this.getTasksList();
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
    const db = wx.cloud.database();

    db.collection('tasks').where({
      coupleId: coupleId
    }).orderBy('createTime', 'desc').get().then(res => {
      const tasksList = res.data.map(item => ({
        ...item,
        id: item._id
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
    }).catch(err => {
      console.error('获取任务失败：', err);
      this.setData({ loading: false });
      wx.showToast({ title: '获取任务失败', icon: 'none' });
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
    const openid = app.globalData.openid;

    if (!coupleId) {
      wx.showToast({ title: '请先绑定情侣', icon: 'none' });
      return;
    }

    const db = wx.cloud.database();

    db.collection('tasks').add({
      data: {
        title: title,
        description: '',
        deadline: '',
        completed: false,
        coupleId: coupleId,
        authorOpenid: openid,
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      }
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
    const db = wx.cloud.database();

    db.collection('tasks').doc(taskId).update({
      data: {
        title: title,
        updateTime: db.serverDate()
      }
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
      content: '确定要删除这个必做事项吗？',
      success: (res) => {
        if (res.confirm) {
          this.removeTask(taskId);
        }
      }
    });
  },

  removeTask: function(taskId) {
    const db = wx.cloud.database();

    db.collection('tasks').doc(taskId).remove().then(() => {
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

    const db = wx.cloud.database();
    const newStatus = !task.completed;

    db.collection('tasks').doc(taskId).update({
      data: {
        completed: newStatus,
        updateTime: db.serverDate()
      }
    }).then(() => {
      wx.showToast({ 
        title: newStatus ? '任务完成！' : '已取消完成', 
        icon: 'success' 
      });
      this.getTasksList();
    }).catch(err => {
      console.error('更新状态失败：', err);
      wx.showToast({ title: '操作失败', icon: 'none' });
    });
  }
})
