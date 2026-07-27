const api = require('./api');

const names = { countdown: 'countdown', album: 'album', tasks: 'tasks', menus: 'menus', orders: 'orders' };
class Query {
  constructor(name, id) { this.name = names[name] || name; this.id = id; this.filters = {}; this.max = 100; }
  where(filters = {}) { this.filters = filters; return this; }
  orderBy() { return this; }
  limit(value) { this.max = value; return this; }
  async get() { if (this.name === 'avatars') return { data: await api.getAvatars() }; const data = this.id ? await api.get(this.name, this.id) : await api.list(this.name, { limit: this.max }); return { data: this.id ? data : this.apply(data) }; }
  async count() { const data = await api.list(this.name, { limit: 200 }); return { total: this.apply(data).length }; }
  add({ data }) { if (this.name === 'avatars') return Promise.reject(new Error('头像必须通过头像上传接口保存')); return api.create(this.name, clean(data)).then(result => ({ _id: result._id })); }
  update({ data }) { if (this.name === 'avatars') return Promise.reject(new Error('头像必须通过头像上传接口保存')); return api.update(this.name, this.id, clean(data)).then(() => ({ stats: { updated: 1 } })); }
  remove() { return api.remove(this.name, this.id).then(() => ({ stats: { removed: 1 } })); }
  doc(id) { return new Query(this.name, id); }
  apply(rows) { return rows.filter(row => Object.keys(this.filters).every(key => key === 'coupleId' || matches(row[key], this.filters[key]))); }
}
function matches(value, expected) { if (expected && expected.__op === 'neq') return value !== expected.value; return value === expected; }
function clean(data) { const out = { ...data }; delete out.coupleId; delete out.author; delete out.createdAt; delete out.createTime; Object.keys(out).forEach(k => { if (out[k] && out[k].__serverDate) out[k] = new Date().toISOString(); }); return out; }
module.exports = function database() { return { collection: name => new Query(name), serverDate: () => ({ __serverDate: true }), command: { neq: value => ({ __op: 'neq', value }) } }; };
