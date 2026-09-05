const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../src/services/periods');
const app = require('../src/app');
const { pool } = require('../src/db');

test('period validation rejects impossible, future and reversed dates and arbitrary health text', () => {
  const today = '2026-09-04';
  for (const startDate of ['2026-02-30', '2025-02-29', '2026-09-05', '2026-9-01', null]) {
    assert.throws(() => service.normalizeRecord({ startDate }, today));
  }
  assert.equal(service.dayNumber('2024-02-29') + 1, service.dayNumber('2024-03-01'));
  assert.throws(() => service.normalizeRecord({ startDate: today, endDate: '2026-09-03' }, today));
  assert.throws(() => service.normalizeRecord({ startDate: '2026-01-01', endDate: today }, today));
  assert.throws(() => service.normalizeRecord({ startDate: today, flow: 'custom' }, today));
  assert.throws(() => service.normalizeRecord({ startDate: today, symptoms: ['free text'] }, today));
  const valid = service.normalizeRecord({ userId: 99, startDate: today, symptoms: ['fatigue', 'fatigue'] }, today);
  assert.deepEqual(valid, { startDate: today, endDate: null, flow: 'unknown', pain: 'unknown', symptoms: ['fatigue'] });
});

test('period predictions require sufficient stable history and never roll overdue dates forward', () => {
  const records = ['2026-05-01', '2026-05-29', '2026-06-26', '2026-07-24'].map((startDate, i) => ({ id: String(i + 1), startDate, endDate: startDate }));
  assert.equal(service.summarize(records.slice(0, 3), '2026-08-01').predictedDate, '');
  assert.equal(service.summarize(records, '2026-08-01').predictedDate, '2026-08-21');
  const overdue = service.summarize(records, '2026-09-04');
  assert.equal(overdue.predictionState, 'overdue');
  assert.equal(overdue.predictedDate, '2026-08-21');
  const variable = [...records.slice(0, 3), { id: '4', startDate: '2026-08-30', endDate: null }];
  assert.equal(service.summarize(variable, '2026-09-04').predictionState, 'variable');
  assert.equal(service.summarize(variable, '2026-09-04').activeDays, 6);
});

test('partner projection never includes flow, pain or symptoms', () => {
  const row = { id: 5, start_date: '2026-08-01', end_date: '2026-08-06', flow: 'heavy', pain: 'mild', symptoms: '["fatigue"]' };
  assert.deepEqual(service.publicRecord(row, false), { id: '5', startDate: '2026-08-01', endDate: '2026-08-06' });
  assert.deepEqual(service.publicRecord(row, true).symptoms, ['fatigue']);
});

test('period HTTP authorization, explicit sharing, owner writes and overlap rollback', async () => {
  const originalQuery = pool.query;
  const originalConnection = pool.getConnection;
  let mode = 'private';
  let committed = 0;
  let rolledBack = 0;
  let inserted;
  let updated;
  let sharing;
  let touched = 0;
  let coupleId = 9;
  let gender = 'male';
  pool.query = async (sql, params) => {
    if (sql.includes('FROM sessions s')) return [[{ id: 1, gender, couple_id: coupleId, session_id: 3 }]];
    touched++;
    if (sql.includes('LEFT JOIN period_records')) {
      assert.deepEqual(params, [9, 1]);
      assert.match(sql, /s.share_with_partner=1 AND s.shared_couple_id=u.couple_id/);
      assert.match(sql, /u.gender='female'/);
      assert.doesNotMatch(sql, /r\.(flow|pain|symptoms)/);
      return [mode === 'shared' ? [{ owner_id: 2, id: 10, start_date: '2026-08-01', end_date: '2026-08-04', flow: 'heavy', symptoms: ['fatigue'] }] : []];
    }
    if (sql.startsWith('SELECT share_with_partner')) return [[{ share_with_partner: 1, shared_couple_id: 100 }]];
    if (sql.startsWith('SELECT id,start_date')) { assert.deepEqual(params, [1]); return [[{ id: 10, start_date: '2026-08-01', end_date: '2026-08-04', flow: 'light', pain: 'none', symptoms: '[]' }]]; }
    if (sql.startsWith('INSERT INTO period_settings')) { sharing = params; return [{ affectedRows: 1 }]; }
    if (sql.startsWith('DELETE FROM period_records')) { assert.deepEqual(params, ['88', 1]); return [{ affectedRows: 0 }]; }
    throw new Error('Unexpected query');
  };
  pool.getConnection = async () => ({
    async beginTransaction() {}, async commit() { committed++; }, async rollback() { rolledBack++; }, release() {},
    async query(sql, params) {
      if (sql.startsWith('SELECT id FROM users')) { assert.match(sql, /FOR UPDATE/); assert.deepEqual(params, [1]); return [[{ id: 1 }]]; }
      if (sql.startsWith('SELECT id FROM period_records WHERE id=')) { assert.match(sql, /FOR UPDATE/); assert.equal(params[1], 1); return [mode === 'edit' ? [{ id: 42 }] : []]; }
      if (sql.includes('COALESCE(end_date')) { assert.equal(params[0], 1); return [mode === 'overlap' ? [{ id: 8 }] : []]; }
      if (sql.startsWith('INSERT INTO period_records')) { inserted = params; return [{ insertId: 42 }]; }
      if (sql.startsWith('UPDATE period_records')) { updated = params; return [{ affectedRows: 1 }]; }
      throw new Error('Unexpected transaction query');
    }
  });
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}/api/couple-space/periods`;
  const request = (suffix = '', method = 'GET', body) => fetch(base + suffix, {
    method, headers: { Authorization: `Bearer ${'a'.repeat(43)}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  try {
    assert.equal((await fetch(base)).status, 401);
    let response = await request('?view=partner&userId=999');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await response.json()).data, { available: false, role: 'male' });
    mode = 'shared';
    const shared = (await (await request('?view=partner')).json()).data;
    assert.equal(shared.own, false);
    assert.deepEqual(Object.keys(shared.records[0]).sort(), ['endDate', 'id', 'startDate']);
    // Forged view and gender cannot grant male accounts an owner view or write access.
    const forged = (await (await request('?view=self&gender=female')).json()).data;
    assert.equal(forged.own, false);
    assert.equal(forged.role, 'male');
    for (const blockedGender of ['male', 'other', undefined]) {
      gender = blockedGender;
      const beforeWrite = touched;
      for (const [suffix, method, body] of [
        ['', 'POST', { startDate: '2026-08-01', gender: 'female' }],
        ['/10', 'PUT', { startDate: '2026-08-01' }],
        ['/10', 'DELETE', undefined],
        ['/settings', 'PATCH', { shareWithPartner: true }],
        ['/settings', 'PATCH', { shareWithPartner: false }]
      ]) assert.equal((await request(suffix, method, body)).status, 403);
      assert.equal(touched, beforeWrite);
      if (blockedGender !== 'male') assert.deepEqual((await (await request()).json()).data, { available: false, role: 'unspecified' });
    }
    gender = 'female';
    const own = (await (await request('?userId=999')).json()).data;
    assert.equal(own.role, 'female');
    assert.equal(own.sharing, false, 'sharing from an old couple is not inherited');
    assert.equal(own.records[0].flow, 'light');
    assert.equal((await request('/settings', 'PATCH', { shareWithPartner: true, userId: 99 })).status, 200);
    assert.deepEqual(sharing, [1, 1, 9]);
    assert.equal((await request('/settings', 'PATCH', { shareWithPartner: false })).status, 200);
    assert.deepEqual(sharing, [1, 0, null]);
    coupleId = null;
    gender = 'male';
    const before = touched;
    assert.deepEqual((await (await request('?view=partner')).json()).data, { available: false, role: 'male' });
    assert.equal(touched, before);
    gender = 'female';
    assert.equal((await request('/settings', 'PATCH', { shareWithPartner: true })).status, 409);
    coupleId = 9;
    assert.equal((await request('/88', 'DELETE')).status, 404);
    assert.equal((await request('/88', 'PUT', { startDate: '2026-08-01', endDate: '2026-08-04' })).status, 404);
    assert.equal(rolledBack, 1);
    mode = 'overlap';
    assert.equal((await request('', 'POST', { startDate: '2026-08-01' })).status, 409);
    assert.equal(rolledBack, 2);
    assert.equal(committed, 0);
    mode = 'create';
    response = await request('', 'POST', { startDate: '2026-08-01', endDate: '2026-08-04', userId: 99 });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).data.id, '42');
    assert.equal(inserted.at(-1), 1);
    assert.equal(committed, 1);
    mode = 'edit';
    assert.equal((await request('/42', 'PUT', { startDate: '2026-08-01', endDate: '2026-08-05', flow: 'light', symptoms: ['fatigue'] })).status, 200);
    assert.deepEqual(updated, ['2026-08-01', '2026-08-05', 'light', 'unknown', '["fatigue"]', '42', 1]);
    assert.equal(committed, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
    pool.query = originalQuery;
    pool.getConnection = originalConnection;
  }
});
