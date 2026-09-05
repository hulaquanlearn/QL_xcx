const api = require('../../services/api');
const auth = require('../../services/auth');
const helper = require('../../utils/period');
const { syncTabBar } = require('../../services/navigation');
const confirm = (title, content) => new Promise(resolve => wx.showModal({ title, content, success: result => resolve(result.confirm), fail: () => resolve(false) }));

Page({
  data: {
    view: '', role: '', available: false, loading: false, error: '', busy: false,
    records: [], summary: {}, sharing: false, today: '', month: '', cells: [],
    weekdays: ['一', '二', '三', '四', '五', '六', '日'],
    showEditor: false, editId: '', form: {}, flows: helper.flows, pains: helper.pains,
    symptomOptions: [], flowIndex: 0, painIndex: 0
  },
  onShow() {
    this._visible = true;
    if (!auth.getToken()) { wx.reLaunch({ url: '/pages/index/index' }); return; }
    syncTabBar(this, 1);
    this.load();
  },
  onHide() { this.clearPrivateState(); },
  onUnload() { this.clearPrivateState(); },
  clearPrivateState() {
    this._visible = false;
    this._sequence = (this._sequence || 0) + 1;
    this.setData({ role: '', view: '', records: [], summary: {}, cells: [], form: {}, symptomOptions: [], showEditor: false, available: false, sharing: false });
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    const sequence = this._sequence = (this._sequence || 0) + 1;
    this.setData({ loading: true, error: '', role: '', view: '', available: false, records: [], summary: {}, cells: [], sharing: false, showEditor: false, form: {} });
    try {
      const result = await api.periods();
      if (!this._visible || sequence !== this._sequence) return;
      if (!['female', 'male', 'unspecified'].includes(result.role)) throw new Error('请先部署 v2.10.1 服务端后使用经期功能');
      const month = this.data.month || (result.today || '').slice(0, 7);
      this.setData({ role: result.role, view: result.role === 'female' ? 'self' : 'partner', available: Boolean(result.available), sharing: result.role === 'female' && Boolean(result.sharing), today: result.today || '',
        records: helper.decorate(result.records || [], result.today), summary: result.summary || {}, month,
        cells: result.available ? helper.calendar(month, result.records || [], result.today, result.summary?.predictedDate) : [] });
    } catch (error) {
      if (this._visible && sequence === this._sequence) this.setData({ error: error.message || '读取失败，请重试', available: false, records: [], summary: {}, cells: [] });
    } finally {
      if (this._visible && sequence === this._sequence) this.setData({ loading: false });
    }
  },
  openProfile() { wx.switchTab({ url: '/pages/mine/index' }); },
  changeMonth(event) {
    const month = helper.moveMonth(this.data.month, Number(event.currentTarget.dataset.delta));
    this.setData({ month, cells: helper.calendar(month, this.data.records, this.data.today, this.data.summary.predictedDate) });
  },
  openEditor(event) {
    if (this.data.view !== 'self' || this.data.busy || !this.data.available) return;
    const id = event?.currentTarget?.dataset?.id;
    const record = id ? this.data.records.find(item => item.id === id) : null;
    if (id && !record) return;
    const form = record ? { startDate: record.startDate, endDate: record.endDate || '', ongoing: !record.endDate, flow: record.flow, pain: record.pain, symptoms: record.symptoms || [] }
      : { startDate: this.data.today, endDate: this.data.today, ongoing: !event?.currentTarget?.dataset?.history, flow: 'unknown', pain: 'unknown', symptoms: [] };
    this.setData({ showEditor: true, editId: id || '', form,
      flowIndex: Math.max(0, helper.flowValues.indexOf(form.flow)), painIndex: Math.max(0, helper.painValues.indexOf(form.pain)),
      symptomOptions: helper.symptoms.map(item => ({ ...item, selected: form.symptoms.includes(item.value) })) });
  },
  closeEditor() { if (!this.data.busy) this.setData({ showEditor: false, form: {}, symptomOptions: [] }); },
  noop() {},
  setDate(event) {
    const key = event.currentTarget.dataset.field;
    if (key === 'startDate' || key === 'endDate') this.setData({ [`form.${key}`]: event.detail.value });
  },
  setOngoing(event) { this.setData({ 'form.ongoing': event.detail.value, 'form.endDate': this.data.form.endDate || this.data.today }); },
  setFlow(event) { const index = Number(event.detail.value); this.setData({ flowIndex: index, 'form.flow': helper.flowValues[index] }); },
  setPain(event) { const index = Number(event.detail.value); this.setData({ painIndex: index, 'form.pain': helper.painValues[index] }); },
  toggleSymptom(event) {
    const value = event.currentTarget.dataset.value;
    const selected = this.data.form.symptoms.includes(value) ? this.data.form.symptoms.filter(item => item !== value) : [...this.data.form.symptoms, value];
    this.setData({ 'form.symptoms': selected, symptomOptions: helper.symptoms.map(item => ({ ...item, selected: selected.includes(item.value) })) });
  },
  async save() {
    if (this.data.busy || this.data.view !== 'self') return;
    const form = this.data.form;
    if (!form.startDate || form.startDate > this.data.today || (!form.ongoing && (!form.endDate || form.endDate < form.startDate || form.endDate > this.data.today))) {
      wx.showToast({ title: '请核对开始和结束日期', icon: 'none' }); return;
    }
    this.setData({ busy: true });
    try {
      if (!this.data.records.length && !await confirm('保存私密记录', '经期日期和身体感受将保存在本项目服务器，默认仅此账号可查看。你可以逐条删除；不会进入共同时间线。是否保存？')) return;
      if (!this._visible) return;
      await api.savePeriod(this.data.editId, { ...form, endDate: form.ongoing ? null : form.endDate });
      if (!this._visible) return;
      this.setData({ showEditor: false, form: {}, symptomOptions: [] });
      wx.showToast({ title: '已保存', icon: 'success' });
      await this.load();
    } catch (error) { if (this._visible) wx.showToast({ title: error.message || '保存失败', icon: 'none' }); }
    finally { this.setData({ busy: false }); }
  },
  async finish() {
    const active = this.data.records.find(item => item.id === this.data.summary.activeId);
    if (!active || this.data.busy || this.data.view !== 'self') return;
    this.setData({ busy: true });
    try {
      if (!await confirm('结束本次记录', `结束日期记为 ${this.data.today}，之后仍可修改。`) || !this._visible) return;
      await api.savePeriod(active.id, { ...active, endDate: this.data.today });
      if (this._visible) await this.load();
    } catch (error) { if (this._visible) wx.showToast({ title: error.message || '保存失败', icon: 'none' }); }
    finally { this.setData({ busy: false }); }
  },
  async remove(event) {
    if (this.data.busy || this.data.view !== 'self') return;
    const id = event.currentTarget.dataset.id;
    this.setData({ busy: true });
    try {
      if (!await confirm('删除这条记录？', '删除后无法恢复，周期估算也会重新计算。') || !this._visible) return;
      await api.deletePeriod(id);
      if (this._visible) await this.load();
    } catch (error) { if (this._visible) wx.showToast({ title: error.message || '删除失败', icon: 'none' }); }
    finally { this.setData({ busy: false }); }
  },
  async toggleSharing() {
    if (this.data.busy || this.data.view !== 'self') return;
    const enabled = !this.data.sharing;
    this.setData({ busy: true });
    try {
      const message = enabled ? '开启后，当前绑定的伴侣可查看全部已记录日期和周期估算，但不能修改，也看不到经量、不适程度及身体感受。是否开启？' : '关闭后，伴侣将无法继续获取记录；已被对方看到或保存的内容无法收回。';
      if (!await confirm(enabled ? '向伴侣共享日期？' : '停止共享？', message) || !this._visible) return;
      await api.sharePeriods(enabled);
      if (this._visible) await this.load();
    } catch (error) { if (this._visible) wx.showToast({ title: error.message || '设置失败', icon: 'none' }); }
    finally { this.setData({ busy: false }); }
  }
});
