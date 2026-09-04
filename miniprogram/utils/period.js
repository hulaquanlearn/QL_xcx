const DAY = 86400000;
const flows = ['未填写', '偏少', '适中', '偏多'];
const flowValues = ['unknown', 'light', 'medium', 'heavy'];
const pains = ['未填写', '无不适', '轻微', '中等', '明显'];
const painValues = ['unknown', 'none', 'mild', 'moderate', 'severe'];
const symptoms = [
  { value: 'cramps', label: '腹部不适' }, { value: 'fatigue', label: '疲倦' },
  { value: 'headache', label: '头痛' }, { value: 'backache', label: '腰酸' },
  { value: 'bloating', label: '腹胀' }, { value: 'mood', label: '情绪变化' }
];
function day(value) {
  const parts = String(value || '').split('-').map(Number);
  return Date.UTC(parts[0], parts[1] - 1, parts[2]) / DAY;
}
function calendar(month, records, today, predictedDate) {
  const [year, number] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, number - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push({ key: `blank${i}`, label: '' });
  for (let i = 1; i <= count; i++) {
    const date = `${month}-${String(i).padStart(2, '0')}`;
    const recorded = records.some(record => date >= record.startDate && date <= (record.endDate || today));
    cells.push({ key: date, label: i, today: date === today, recorded, predicted: date === predictedDate });
  }
  return cells;
}
function moveMonth(month, delta) {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, number - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
function decorate(records, today) {
  return records.map(record => ({
    ...record,
    duration: day(record.endDate || today) - day(record.startDate) + 1,
    detail: [flows[flowValues.indexOf(record.flow)], pains[painValues.indexOf(record.pain)],
      ...symptoms.filter(item => (record.symptoms || []).includes(item.value)).map(item => item.label)]
      .filter(item => item && item !== '未填写').join(' · ')
  }));
}
module.exports = { calendar, moveMonth, decorate, flows, flowValues, pains, painValues, symptoms };
