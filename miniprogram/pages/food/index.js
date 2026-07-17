// pages/food/index.js
const app = getApp()

Page({
  data: {
    activeTab: 'upload',
    menuName: '',
    dishes: [],
    newDishName: '',
    menus: [],
    menuIndex: 0,
    selectedMenu: null,
    selectedDishes: [],
    orderResult: null,
    uploading: false,
    editingMenu: null,
    mealType: 'lunch',
    mealTypes: [
      { value: 'breakfast', label: '早餐', icon: '早' },
      { value: 'lunch', label: '午餐', icon: '午' },
      { value: 'dinner', label: '晚餐', icon: '晚' },
      { value: 'snack', label: '零食', icon: '食' }
    ],
    orders: []
  },

  onLoad(options) {
    // 如果传入 tab 参数，切换到对应标签（白名单验证）
    const validTabs = ['upload', 'order', 'orders'];
    if (options.tab && validTabs.includes(options.tab)) {
      this.setData({ activeTab: options.tab });
    }
    // 检查登录状态
    this.checkLogin();
    // 并行加载菜单和订单数据
    this.loadPageData();
  },
  
  onShow() {
    this.checkLogin();
    // 页面显示时刷新订单数据
    this.loadOrders();
  },

  // 检查登录状态
  checkLogin: function() {
    if (!app.globalData.openid || !app.globalData.coupleId) {
      wx.redirectTo({ url: '/pages/index/index' });
      return false;
    }
    return true;
  },

  // 统一加载页面数据（解决竞态条件）
  loadPageData: function() {
    Promise.all([
      this.loadMenus(),
      this.loadOrders()
    ]).catch(err => {
      console.error('加载数据失败：', err);
      wx.showToast({
        title: '数据加载失败',
        icon: 'none'
      });
    });
  },

  loadMenus: function() {
    const db = wx.cloud.database();
    const coupleId = app.globalData?.coupleId || app.globalData?.userInfo?.coupleId;

    if (!coupleId || !app.globalData) {
      const menus = wx.getStorageSync('menus') || [];
      this.setData({ menus: menus });
      return Promise.resolve(menus);
    }

    return db.collection('menus').where({
      coupleId: coupleId
    }).orderBy('createTime', 'desc').get().then(res => {
      this.setData({ menus: res.data });
      return res.data;
    }).catch(err => {
      console.error('获取菜单失败：', err);
      const menus = wx.getStorageSync('menus') || [];
      this.setData({ menus: menus });
      return menus;
    });
  },

  loadOrders: function() {
    const db = wx.cloud.database();
    const coupleId = app.globalData?.coupleId || app.globalData?.userInfo?.coupleId;

    if (!coupleId || !app.globalData) {
      const orders = wx.getStorageSync('orders') || [];
      const formattedOrders = this.formatOrdersTime(orders);
      this.setData({ orders: formattedOrders });
      return Promise.resolve(formattedOrders);
    }

    return db.collection('orders').where({
      coupleId: coupleId
    }).orderBy('createTime', 'desc').get().then(res => {
      const formattedOrders = this.formatOrdersTime(res.data);
      this.setData({ orders: formattedOrders });
      return formattedOrders;
    }).catch(err => {
      console.error('获取订单失败：', err);
      const orders = wx.getStorageSync('orders') || [];
      const formattedOrders = this.formatOrdersTime(orders);
      this.setData({ orders: formattedOrders });
      return formattedOrders;
    });
  },

  // 格式化订单时间
  formatOrdersTime: function(orders) {
    return orders.map(order => {
      let timeStr = '';
      if (order.createTime) {
        // 处理云数据库返回的日期对象
        if (typeof order.createTime === 'object' && order.createTime.toDate) {
          const date = order.createTime.toDate();
          timeStr = this.formatDate(date);
        } else if (typeof order.createTime === 'string') {
          timeStr = order.createTime;
        } else {
          timeStr = this.formatDate(new Date(order.createTime));
        }
      }
      return {
        ...order,
        menuName: Array.isArray(order.menuNames) ? order.menuNames.join('、') : (order.menuName || ''),
        formattedTime: timeStr
      };
    });
  },

  // 格式化日期
  formatDate: function(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
      return '未知时间';
    }

    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${month}-${day} ${hours}:${minutes}`;
  },

  switchTab: function(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
  },

  // 选择现有菜单
  selectExistingMenu: function(e) {
    const index = e.detail.value;
    const selectedMenu = this.data.menus[index];
    this.setData({
      editingMenu: selectedMenu,
      menuName: selectedMenu.name,
      dishes: selectedMenu.dishes.map(d => ({...d}))
    });
  },

  // 显示新建菜单弹窗
  showCreateMenuModal: function() {
    this.setData({
      showMenuModal: true,
      modalMenuName: ''
    });
  },

  // 关闭新建菜单弹窗
  closeMenuModal: function() {
    this.setData({
      showMenuModal: false,
      modalMenuName: ''
    });
  },

  // 弹窗输入菜单名称
  onModalMenuNameInput: function(e) {
    this.setData({ modalMenuName: e.detail.value });
  },

  // 确认新建菜单
  confirmCreateMenu: function() {
    const name = this.data.modalMenuName.trim();
    if (!name) {
      wx.showToast({ title: '请输入菜单名称', icon: 'none' });
      return;
    }
    
    this.setData({
      editingMenu: null,
      menuName: name,
      dishes: [],
      showMenuModal: false,
      modalMenuName: ''
    });
    
    wx.showToast({ title: '请添加菜品', icon: 'none' });
  },

  // 删除菜单
  deleteMenu: function() {
    const editingMenu = this.data.editingMenu;
    if (!editingMenu) {
      wx.showToast({ title: '请先选择菜单', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认删除',
      content: `确定要删除菜单"${editingMenu.name}"吗？`,
      success: (res) => {
        if (res.confirm) {
          const db = wx.cloud.database();
          db.collection('menus').doc(editingMenu._id).remove().then(() => {
            wx.showToast({ title: '删除成功', icon: 'success' });
            this.setData({
              editingMenu: null,
              menuName: '',
              dishes: []
            });
            this.loadMenus();
          }).catch(err => {
            console.error('删除菜单失败：', err);
            wx.showToast({ title: '删除失败', icon: 'none' });
          });
        }
      }
    });
  },

  onMenuNameInput: function(e) {
    this.setData({ menuName: e.detail.value });
  },

  onNewDishNameInput: function(e) {
    this.setData({ newDishName: e.detail.value });
  },

  // 选择餐别
  selectMealType: function(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({ mealType: type });
  },

  addDish: function() {
    const name = this.data.newDishName.trim();
    if (!name) {
      wx.showToast({ title: '请输入菜品名称', icon: 'none' });
      return;
    }

    const newDish = {
      id: Date.now().toString(),
      name: name,
      image: ''
    };

    this.setData({
      dishes: [...this.data.dishes, newDish],
      newDishName: ''
    });
  },

  removeDish: function(e) {
    const index = e.currentTarget.dataset.index;
    const dishes = this.data.dishes.filter((item, i) => i !== index);
    this.setData({ dishes: dishes });
  },

  chooseDishImage: function(e) {
    const index = e.currentTarget.dataset.index;
    const that = this;
    
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: function(res) {
        const tempFilePath = res.tempFilePaths[0];
        that.uploadDishImage(tempFilePath, index);
      }
    });
  },

  uploadDishImage: function(tempFilePath, index) {
    // 防止重复上传
    if (this.data.uploading) {
      wx.showToast({ title: '正在上传中，请稍候', icon: 'none' });
      return;
    }

    const coupleId = app.globalData?.coupleId || app.globalData?.userInfo?.coupleId;

    if (!coupleId) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      this.setData({ uploading: false });
      return;
    }

    const cloudPath = `dishes/${coupleId}_${Date.now()}_${index}.jpg`;

    this.setData({ uploading: true });

    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: tempFilePath,
      success: res => {
        const dishes = [...this.data.dishes];
        dishes[index].image = res.fileID;
        this.setData({
          dishes: dishes,
          uploading: false
        });
        wx.showToast({ title: '上传成功', icon: 'success' });
      },
      fail: err => {
        console.error('上传图片失败：', err);
        this.setData({ uploading: false });
        wx.showToast({ title: '上传失败', icon: 'none' });
      }
    });
  },

  uploadMenu: function() {
    const { menuName, dishes, editingMenu } = this.data;

    if (!menuName.trim()) {
      wx.showToast({ title: '请输入菜单名称', icon: 'none' });
      return;
    }

    if (dishes.length === 0) {
      wx.showToast({ title: '请添加至少一个菜品', icon: 'none' });
      return;
    }

    const validDishes = dishes.filter(d => d.name.trim());
    if (validDishes.length === 0) {
      wx.showToast({ title: '请输入有效的菜品', icon: 'none' });
      return;
    }

    const coupleId = app.globalData?.coupleId || app.globalData?.userInfo?.coupleId;

    if (!coupleId) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    const db = wx.cloud.database();
    
    if (editingMenu) {
      // 更新现有菜单
      db.collection('menus').doc(editingMenu._id).update({
        data: {
          name: menuName.trim(),
          dishes: validDishes,
          updateTime: db.serverDate()
        }
      }).then(() => {
        wx.showToast({ title: '菜单更新成功', icon: 'success' });
        this.setData({ 
          editingMenu: null,
          menuName: '', 
          dishes: []
        });
        this.loadMenus();
      }).catch(err => {
        console.error('更新菜单失败：', err);
        wx.showToast({ title: '更新失败', icon: 'none' });
      });
    } else {
      // 创建新菜单
      const newMenu = {
        name: menuName.trim(),
        dishes: validDishes,
        coupleId: coupleId,
        createTime: db.serverDate()
      };
      
      db.collection('menus').add({
        data: newMenu
      }).then(res => {
        wx.showToast({ title: '菜单上传成功', icon: 'success' });
        this.setData({ 
          menuName: '', 
          dishes: []
        });
        this.loadMenus();
      }).catch(err => {
        console.error('上传菜单失败：', err);
        wx.showToast({ title: '上传失败', icon: 'none' });
      });
    }
  },

  bindMenuChange: function(e) {
    const index = e.detail.value;
    const selectedMenu = this.data.menus[index];
    this.setData({ 
      menuIndex: index,
      selectedMenu: selectedMenu
    });
  },

  toggleDish: function(e) {
    const dish = e.currentTarget.dataset.dish;
    const menuId = e.currentTarget.dataset.menuid;
    const menuName = e.currentTarget.dataset.menuname;
    const selectedDishes = this.data.selectedDishes;

    // 查找是否已选中该菜品（跨菜单唯一标识：menuId + dish.name）
    const index = selectedDishes.findIndex(d => d.menuId === menuId && d.name === dish.name);
    let newSelectedDishes;

    if (index > -1) {
      // 移除选中的菜品
      newSelectedDishes = selectedDishes.filter((_, i) => i !== index);
    } else {
      // 添加新选中的菜品
      newSelectedDishes = [...selectedDishes, {
        ...dish,
        menuId: menuId,
        menuName: menuName
      }];
    }

    this.setData({
      selectedDishes: newSelectedDishes
    });
  },

  // 检查菜品是否被选中（跨菜单）
  isDishSelected: function(menuId, dishName) {
    return this.data.selectedDishes.some(d => d.menuId === menuId && d.name === dishName);
  },

  submitOrder: function() {
    const { selectedDishes, mealType, mealTypes } = this.data;

    if (selectedDishes.length === 0) {
      wx.showToast({ title: '请选择菜品', icon: 'none' });
      return;
    }

    // 获取当前选择的餐别名称
    const mealTypeObj = mealTypes.find(m => m.value === mealType);
    const mealTypeLabel = mealTypeObj ? mealTypeObj.label : '午餐';
    const mealTypeIcon = mealTypeObj ? mealTypeObj.icon : '午';

    // 按菜单分组统计菜品
    const menuGroups = {};
    selectedDishes.forEach(dish => {
      if (!menuGroups[dish.menuName]) {
        menuGroups[dish.menuName] = [];
      }
      menuGroups[dish.menuName].push(dish);
    });

    // 构建确认内容，每行一个信息
    let confirmContent = `${mealTypeIcon} ${mealTypeLabel}\n`;
    Object.keys(menuGroups).forEach(menuName => {
      menuGroups[menuName].forEach(dish => {
        const dishName = dish.name || dish.dishName || '未命名';
        confirmContent += `菜单${menuName}:${dishName}\n`;
      });
    });

    wx.showModal({
      title: '确认订单',
      content: confirmContent,
      confirmText: '确认提交',
      cancelText: '再想想',
      success: (res) => {
        if (res.confirm) {
          this.doSubmitOrder();
        }
      }
    });
  },

  // 实际提交订单
  doSubmitOrder: function() {
    const { selectedDishes, mealType } = this.data;
    const coupleId = app.globalData?.coupleId || app.globalData?.userInfo?.coupleId;

    if (!coupleId) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    const db = wx.cloud.database();

    // 按菜单分组统计
    const menuGroups = {};
    selectedDishes.forEach(dish => {
      if (!menuGroups[dish.menuName]) {
        menuGroups[dish.menuName] = [];
      }
      menuGroups[dish.menuName].push(dish);
    });

    const orderData = {
      menuNames: Object.keys(menuGroups),
      dishes: selectedDishes,
      mealType: mealType,
      coupleId: coupleId,
      createTime: db.serverDate(),
      orderBy: app.globalData.userInfo ? app.globalData.userInfo.name || '我' : '我'
    };

    db.collection('orders').add({
      data: orderData
    }).then(() => {
      wx.showToast({ title: '订单提交成功', icon: 'success' });
      this.setData({
        orderResult: orderData,
        selectedDishes: [],
        selectedMenu: null
      });
      this.loadOrders();
    }).catch(err => {
      console.error('提交订单失败：', err);
      wx.showToast({ title: '提交失败', icon: 'none' });
    });
  },

  // 接单
  acceptOrder: function(e) {
    const orderId = e.currentTarget.dataset.id;
    const db = wx.cloud.database();
    const userName = app.globalData.userInfo ? app.globalData.userInfo.name || '我' : '我';
    
    wx.showModal({
      title: '确认接单',
      content: '确定要接这个订单吗？',
      success: (res) => {
        if (res.confirm) {
          db.collection('orders').doc(orderId).update({
            data: {
              acceptedBy: userName,
              acceptedTime: db.serverDate(),
              status: 'accepted'
            }
          }).then(() => {
            wx.showToast({ title: '接单成功', icon: 'success' });
            this.loadOrders();
          }).catch(err => {
            console.error('接单失败：', err);
            wx.showToast({ title: '接单失败', icon: 'none' });
          });
        }
      }
    });
  },

  // 删除订单
  deleteOrder: function(e) {
    const orderId = e.currentTarget.dataset.id;
    const orders = this.data.orders;
    const order = orders.find(o => o._id === orderId);

    if (!order) {
      wx.showToast({ title: '订单不存在', icon: 'none' });
      return;
    }

    // 检查是否为订单创建者
    const userName = app.globalData?.userInfo?.name || '我';
    if (order.orderBy !== userName) {
      wx.showToast({ title: '只能删除自己的订单', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个订单吗？',
      success: (res) => {
        if (res.confirm) {
          const db = wx.cloud.database();
          db.collection('orders').doc(orderId).remove().then(() => {
            wx.showToast({ title: '删除成功', icon: 'success' });
            this.loadOrders();
          }).catch(err => {
            console.error('删除订单失败：', err);
            wx.showToast({ title: '删除失败', icon: 'none' });
          });
        }
      }
    });
  },

  shareOrder: function() {
    const { orderResult } = this.data;
    if (!orderResult) {
      wx.showToast({ title: '暂无订单可分享', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '分享订单',
      content: '请点击右上角菜单按钮，选择「转发」或「分享到朋友圈」',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  goBack: function() {
    wx.navigateBack({ delta: 1 });
  },

  onShareAppMessage() {
    const { orderResult } = this.data;
    
    if (orderResult) {
      const dishNames = orderResult.dishes.map(d => d.name).join('、');
      const mealTypeLabel = this.data.mealTypes.find(t => t.value === orderResult.mealType)?.label || '';
      return {
        title: `我点了${mealTypeLabel}`,
        path: '/pages/food/index',
        desc: `我点了${orderResult.menuName}的这些菜：${dishNames}`
      };
    }
    
    return {
      title: '今天吃什么',
      path: '/pages/food/index',
      desc: '上传菜单，让对方点菜'
    };
  }
})
