const app = getApp();
const api = require('../../services/api');
const auth = require('../../services/auth');
const mediaService = require('../../services/media');
const { createUploadQueue } = require('../../services/upload-queue');
const dateUtils = require('../../utils/date');

const uploadLabels = {
  queued: '等待上传', uploading: '上传中', moderating: '微信审核中',
  saving: '正在保存', ready: '已保存', failed: '未完成', paused: '已暂停'
};

Page({
  data: {
    albumList: [], groupedAlbumList: [], selectedPhotos: [], selectMode: false,
    loading: false, loadingMore: false, loadError: '', hasMore: true, nextCursor: '',
    month: '', monthOptions: [{ month: '', label: '全部月份' }], monthIndex: 0,
    favoriteOnly: false, taskId: '', uploadItems: [], uploading: false, uploadPaused: false,
    uploadSummary: '', hasUploadFailures: false, deleting: false,
    previewVisible: false, previewPhotos: [], previewIndex: 0
  },

  onLoad(options = {}) {
    this._alive = true;
    this._scope = auth.getToken();
    this._loadGeneration = 0;
    this._favoriteBusy = new Set();
    if (/^\d+$/.test(String(options.taskId || ''))) this.setData({ taskId: String(options.taskId) });
    this.checkLogin();
  },

  onShow() {
    if (!this.checkLogin()) return;
    // Returning from preview keeps the rows and scroll position. Refresh is explicit.
    if (!this._hasLoaded) {
      this.loadAlbums(true);
      this.loadMonths();
    }
  },

  onPageScroll(event) { this._scrollTop = event.scrollTop; },

  onUnload() {
    this._alive = false;
    this._loadGeneration += 1;
    if (this._uploadQueue) this._uploadQueue.pause();
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
  },

  isCurrent() { return this._alive !== false && this._scope === auth.getToken(); },

  checkLogin() {
    if (!app.globalData.userId || !app.globalData.coupleId || !this.isCurrent()) {
      wx.reLaunch({ url: '/pages/index/index' });
      return false;
    }
    return true;
  },

  async loadMonths() {
    const favoriteOnly = this.data.favoriteOnly;
    const taskId = this.data.taskId;
    const generation = this._monthGeneration = (this._monthGeneration || 0) + 1;
    try {
      const months = await api.albumMonths(favoriteOnly, taskId);
      if (!this.isCurrent() || generation !== this._monthGeneration || favoriteOnly !== this.data.favoriteOnly || taskId !== this.data.taskId) return;
      const monthOptions = [{ month: '', label: '全部月份' }, ...(months || []).map(item => ({
        month: item.month, label: `${item.month.replace('-', '年')}月 · ${item.count}张`
      }))];
      if (this.data.month && !monthOptions.some(item => item.month === this.data.month)) {
        monthOptions.push({ month: this.data.month, label: `${this.data.month.replace('-', '年')}月` });
      }
      this.setData({ monthOptions, monthIndex: Math.max(0, monthOptions.findIndex(item => item.month === this.data.month)) });
    } catch (error) { console.warn('获取相册月份失败：', error.message); }
  },

  loadAlbums(reset = true) {
    if (!this.isCurrent()) return Promise.resolve();
    if (!reset && (this.albumRequest || !this.data.hasMore)) return this.albumRequest || Promise.resolve();
    if (reset) this._loadGeneration += 1;
    const generation = this._loadGeneration;
    const isCancelled = () => !this.isCurrent() || generation !== this._loadGeneration;
    const params = { limit: 30 };
    if (this.data.month) params.month = this.data.month;
    if (this.data.favoriteOnly) params.favoriteOnly = 1;
    if (this.data.taskId) params.taskIds = this.data.taskId;
    if (!reset && this.data.nextCursor) params.cursor = this.data.nextCursor;
    this.setData({ loading: reset, loadingMore: !reset, loadError: '' });
    const request = api.listPage('album', params).then(page => {
      if (isCancelled()) return;
      const oldImages = new Map(this.data.albumList.map(item => [item.storageKey, item.imgUrl]));
      const rows = (page.items || []).map(item => {
        const storageKey = item.fileID || item.imageUrl || item.imgUrl;
        const imgUrl = oldImages.get(storageKey) || '';
        return { ...item, storageKey, imgUrl, imageState: imgUrl ? 'ready' : 'loading', favorite: Boolean(item.favorite) };
      });
      const albumList = reset ? rows : this.data.albumList.concat(rows.filter(row => !this.data.albumList.some(old => old._id === row._id)));
      this._hasLoaded = true;
      this.setData({ albumList, groupedAlbumList: this.groupByDate(albumList), hasMore: Boolean(page.hasMore), nextCursor: page.nextCursor || '' });
      // Metadata appears first; each protected image fills in independently.
      mediaService.resolveFiles(rows.map(item => item.storageKey), {
        variant: 'thumbnail',
        isCancelled,
        onResolved: (key, filePath) => {
          if (isCancelled()) return;
          const updated = this.data.albumList.map(item => item.storageKey === key
            ? { ...item, imgUrl: filePath, imageState: filePath ? 'ready' : 'failed' } : item);
          this.setData({ albumList: updated, groupedAlbumList: this.groupByDate(updated) });
        }
      }).catch(() => {});
    }).catch(error => {
      if (!isCancelled()) {
        this._failedLoadWasReset = reset;
        this.setData({ loadError: error.message || '获取相册失败，请重试' });
      }
    }).finally(() => {
      if (this.albumRequest === request) this.albumRequest = null;
      if (!isCancelled()) this.setData({ loading: false, loadingMore: false });
    });
    this.albumRequest = request;
    return request;
  },

  groupByDate(albumList) {
    const groups = {};
    albumList.forEach(item => {
      const date = this.formatDate(item.date || item.createTime);
      if (!groups[date]) groups[date] = [];
      groups[date].push(item);
    });
    return Object.keys(groups).map(date => ({ date, photos: groups[date] }));
  },

  formatDate(value) {
    const date = dateUtils.parseDateTime(value);
    if (!date) return '日期未知';
    return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月${String(date.getDate()).padStart(2, '0')}日`;
  },

  changeMonth(event) {
    const monthIndex = Number(event.detail.value);
    const option = this.data.monthOptions[monthIndex];
    if (!option || option.month === this.data.month) return;
    this.setData({ month: option.month, monthIndex });
    this.resetFilter();
  },

  changeFavorites() {
    this.setData({ favoriteOnly: !this.data.favoriteOnly });
    this.resetFilter();
    this.loadMonths();
  },

  clearTaskFilter() {
    this.setData({ taskId: '' });
    this.resetFilter();
    this.loadMonths();
  },

  resetFilter() {
    this.setData({ albumList: [], groupedAlbumList: [], selectedPhotos: [], selectMode: false, nextCursor: '', hasMore: true });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    return this.loadAlbums(true);
  },

  async toggleFavorite(event) {
    const id = String(event.currentTarget.dataset.id);
    if (this._favoriteBusy.has(id)) return;
    const photo = this.data.albumList.find(item => String(item._id) === id);
    if (!photo) return;
    this._favoriteBusy.add(id);
    try {
      const result = await api.setAlbumFavorite(id, !photo.favorite);
      if (!this.isCurrent()) return;
      let albumList = this.data.albumList.map(item => String(item._id) === id ? { ...item, favorite: Boolean(result.favorite) } : item);
      if (this.data.favoriteOnly) albumList = albumList.filter(item => item.favorite);
      this.setData({ albumList, groupedAlbumList: this.groupByDate(albumList) });
      this.loadMonths();
    } catch (error) {
      if (this.isCurrent()) wx.showToast({ title: error.message || '收藏操作失败', icon: 'none' });
    } finally { this._favoriteBusy.delete(id); }
  },

  retryImage(event) {
    const photo = this.data.albumList.find(item => String(item._id) === String(event.currentTarget.dataset.id));
    if (!photo) return;
    const generation = this._loadGeneration;
    const albumList = this.data.albumList.map(item => item._id === photo._id ? { ...item, imageState: 'loading' } : item);
    this.setData({ albumList, groupedAlbumList: this.groupByDate(albumList) });
    return mediaService.resolveFiles([photo.storageKey], { variant: 'thumbnail', onResolved: (key, path) => {
      if (!this.isCurrent() || generation !== this._loadGeneration) return;
      const updated = this.data.albumList.map(item => item.storageKey === key ? { ...item, imgUrl: path, imageState: path ? 'ready' : 'failed' } : item);
      this.setData({ albumList: updated, groupedAlbumList: this.groupByDate(updated) });
    } });
  },

  imageFailed(event) {
    const id = String(event.currentTarget.dataset.id);
    const photo = this.data.albumList.find(item => String(item._id) === id);
    if (!photo) return;
    mediaService.forgetFile(photo.storageKey, { variant: 'thumbnail' });
    const albumList = this.data.albumList.map(item => String(item._id) === id ? { ...item, imgUrl: '', imageState: 'failed' } : item);
    this.setData({ albumList, groupedAlbumList: this.groupByDate(albumList) });
  },

  toggleSelectMode() { this.setData({ selectMode: !this.data.selectMode, selectedPhotos: [] }); },

  toggleSelect(event) {
    const id = event.currentTarget.dataset.id;
    const selectedPhotos = this.data.selectedPhotos.slice();
    const index = selectedPhotos.indexOf(id);
    if (index >= 0) selectedPhotos.splice(index, 1);
    else if (selectedPhotos.length < 50) selectedPhotos.push(id);
    else wx.showToast({ title: '每次最多选择50张照片', icon: 'none' });
    this.setData({ selectedPhotos });
  },

  batchDeletePhotos() {
    const ids = this.data.selectedPhotos.slice();
    if (!ids.length || this.data.deleting) return;
    wx.showModal({ title: '删除照片', content: `确定删除这${ids.length}张共同照片吗？对方也将无法查看。`, success: async result => {
      if (!result.confirm || !this.isCurrent()) return;
      this.setData({ deleting: true });
      try {
        await api.batchDeleteAlbums(ids);
        if (!this.isCurrent()) return;
        this.setData({ selectMode: false, selectedPhotos: [] });
        await this.loadAlbums(true);
        this.loadMonths();
      } catch (error) {
        if (this.isCurrent()) wx.showToast({ title: error.message || '删除失败', icon: 'none' });
      } finally { if (this.isCurrent()) this.setData({ deleting: false }); }
    } });
  },

  chooseImage() {
    if (!this.checkLogin()) return;
    if (this.data.uploading) return wx.showToast({ title: '这一批照片还在处理，可先查看进度', icon: 'none' });
    wx.chooseImage({ count: 9, sizeType: ['original'], sourceType: ['album', 'camera'], success: result => {
      if (this.isCurrent()) this.uploadImages(result.tempFilePaths);
    } });
  },

  uploadImages(paths) {
    if (!this._uploadQueue) this._uploadQueue = createUploadQueue({
      concurrency: 2,
      isCancelled: () => !this.isCurrent(),
      upload: (path, options) => mediaService.upload(path, 'album', options),
      waitForReview: (checkId, options) => api.waitForMediaCheck(checkId, options),
      save: (key, item) => item.context && item.context.taskId
        ? api.attachTaskPhotos(item.context.taskId, [key], '')
        : api.batchCreateAlbums([key]),
      onChange: (items, uploading) => {
        if (!this.isCurrent()) return;
        const ready = items.filter(item => item.status === 'ready').length;
        const uploadItems = items.map(item => ({ ...item, label: uploadLabels[item.status] || item.status }));
        this.setData({ uploadItems, uploading, uploadSummary: `${ready}/${items.length} 张已保存`,
          uploadPaused: items.some(item => item.status === 'paused'),
          hasUploadFailures: items.some(item => item.status === 'failed') });
      },
      onSaved: () => {
        if (!this.isCurrent()) return;
        if (this._refreshTimer) clearTimeout(this._refreshTimer);
        this._refreshTimer = setTimeout(() => { if (this.isCurrent()) { this.loadAlbums(true); this.loadMonths(); } }, 500);
      }
    });
    this._uploadQueue.clearFinished();
    return this._uploadQueue.add(paths, { taskId: this.data.taskId });
  },

  retryUpload(event) { if (this._uploadQueue) return this._uploadQueue.retry(event.currentTarget.dataset.id); },
  pauseUploads() { if (this._uploadQueue) this._uploadQueue.pause(); },
  resumeUploads() { if (this._uploadQueue) return this._uploadQueue.resume(); },
  clearFinishedUploads() { if (this._uploadQueue) this._uploadQueue.clearFinished(); },

  previewImage(event) {
    if (this.data.selectMode) return this.toggleSelect(event);
    const previewIndex = this.data.albumList.findIndex(item => String(item._id) === String(event.currentTarget.dataset.id));
    if (previewIndex < 0) return;
    this._previewGeneration = (this._previewGeneration || 0) + 1;
    const previewPhotos = this.data.albumList.map(item => ({
      _id: item._id, storageKey: item.storageKey, thumbnail: item.imgUrl,
      original: '', loading: false, error: false
    }));
    this.setData({ previewVisible: true, previewPhotos, previewIndex });
    return this.loadPreviewOriginal(previewIndex);
  },

  async loadPreviewOriginal(index) {
    const photo = this.data.previewPhotos[index];
    if (!photo || photo.original || photo.loading) return;
    const generation = this._previewGeneration;
    const update = changes => {
      if (!this.isCurrent() || !this.data.previewVisible || generation !== this._previewGeneration) return;
      const previewPhotos = this.data.previewPhotos.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item);
      this.setData({ previewPhotos });
    };
    update({ loading: true, error: false });
    try {
      const urls = await mediaService.resolveFiles([photo.storageKey]);
      update({ original: urls[photo.storageKey] || '', loading: false, error: !urls[photo.storageKey] });
    } catch { update({ loading: false, error: true }); }
  },

  changePreview(event) {
    const previewIndex = Number(event.detail.current);
    this.setData({ previewIndex });
    return this.loadPreviewOriginal(previewIndex);
  },

  retryPreview() { return this.loadPreviewOriginal(this.data.previewIndex); },

  zoomPreview() {
    const photo = this.data.previewPhotos[this.data.previewIndex];
    if (photo && photo.original) wx.previewImage({ current: photo.original, urls: [photo.original] });
  },

  previewImageFailed(event) {
    const index = Number(event.currentTarget.dataset.index);
    const photo = this.data.previewPhotos[index];
    if (!photo) return;
    if (photo.original) mediaService.forgetFile(photo.storageKey);
    else mediaService.forgetFile(photo.storageKey, { variant: 'thumbnail' });
    const previewPhotos = this.data.previewPhotos.map((item, itemIndex) => itemIndex === index
      ? { ...item, original: '', thumbnail: '', loading: false, error: true } : item);
    this.setData({ previewPhotos });
  },

  closePreview() {
    this._previewGeneration = (this._previewGeneration || 0) + 1;
    this.setData({ previewVisible: false, previewPhotos: [] });
  },

  preventScroll() {},

  onPullDownRefresh() {
    this.loadMonths();
    return Promise.resolve(this.loadAlbums(true)).finally(() => wx.stopPullDownRefresh());
  },
  retryLoad() { return this.loadAlbums(this._failedLoadWasReset !== false); },
  onReachBottom() { return this.loadAlbums(false); }
});
