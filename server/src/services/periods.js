const { ApiError } = require('../utils');
const DAY = 86400000;
const FLOW = ['unknown', 'light', 'medium', 'heavy'];
const PAIN = ['unknown', 'none', 'mild', 'moderate', 'severe'];
const SYMPTOMS = ['cramps', 'fatigue', 'headache', 'backache', 'bloating', 'mood'];

function todayDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function dayNumber(value) {
  const match = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match || Number(match[1]) < 1900) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) return null;
  return date.getTime() / DAY;
}

function normalizeRecord(body, today = todayDate()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, '记录格式无效');
  const startDate = body.startDate;
  const endDate = body.endDate === '' || body.endDate == null ? null : body.endDate;
  const start = dayNumber(startDate);
  const end = endDate === null ? null : dayNumber(endDate);
  if (start === null || start > dayNumber(today)) throw new ApiError(400, '开始日期无效，不能记录未来日期');
  if (endDate !== null && (end === null || end < start || end > dayNumber(today))) {
    throw new ApiError(400, '结束日期须在开始日期与今天之间');
  }
  if (end !== null && end - start >= 90) throw new ApiError(400, '单条记录最多90天，请核对日期');
  const flow = body.flow === undefined ? 'unknown' : body.flow;
  const pain = body.pain === undefined ? 'unknown' : body.pain;
  const symptoms = body.symptoms === undefined ? [] : body.symptoms;
  if (!FLOW.includes(flow) || !PAIN.includes(pain)) throw new ApiError(400, '经量或不适程度选项无效');
  if (!Array.isArray(symptoms) || symptoms.length > SYMPTOMS.length || symptoms.some(item => !SYMPTOMS.includes(item))) {
    throw new ApiError(400, '身体感受选项无效');
  }
  return { startDate, endDate, flow, pain, symptoms: [...new Set(symptoms)] };
}

function publicRecord(row, own) {
  const record = { id: String(row.id), startDate: row.start_date, endDate: row.end_date || null };
  if (own) {
    let symptoms = row.symptoms;
    if (typeof symptoms === 'string') {
      try { symptoms = JSON.parse(symptoms); } catch { symptoms = []; }
    }
    Object.assign(record, { flow: row.flow, pain: row.pain, symptoms: Array.isArray(symptoms) ? symptoms.filter(item => SYMPTOMS.includes(item)) : [] });
  }
  return record;
}

function median(numbers) {
  if (!numbers.length) return null;
  const sorted = numbers.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}

function summarize(records, today = todayDate()) {
  const sorted = records.slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
  const recent = sorted.slice(-7);
  const intervals = recent.slice(1).map((item, index) => dayNumber(item.startDate) - dayNumber(recent[index].startDate));
  const last = sorted[sorted.length - 1];
  const active = last && !last.endDate;
  const result = {
    recordCount: sorted.length,
    intervalCount: intervals.length,
    typicalCycle: median(intervals),
    activeId: active ? last.id : '',
    activeDays: active ? dayNumber(today) - dayNumber(last.startDate) + 1 : 0,
    predictedDate: '',
    daysUntil: null,
    predictionState: 'insufficient'
  };
  // Conservative product guardrails, not a clinical definition of a normal cycle.
  if (intervals.length < 3) return result;
  if (intervals.some(days => days < 15 || days > 90) || Math.max(...intervals) - Math.min(...intervals) > 10) {
    result.predictionState = 'variable';
    return result;
  }
  const predictedDay = dayNumber(last.startDate) + result.typicalCycle;
  result.predictedDate = new Date(predictedDay * DAY).toISOString().slice(0, 10);
  result.daysUntil = predictedDay - dayNumber(today);
  result.predictionState = result.daysUntil < 0 ? 'overdue' : 'estimated';
  return result;
}

module.exports = { dayNumber, normalizeRecord, publicRecord, summarize, todayDate };
