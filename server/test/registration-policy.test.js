const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../src/app');

test('public registration route is not present', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/auth.js'), 'utf8');
  const profileSource = fs.readFileSync(path.join(__dirname, '../src/routes/profile.js'), 'utf8');
  assert.equal(source.includes("post('/register'"), false);
  assert.equal(profileSource.includes('router.use(requireAuth)'), false);
  assert.equal(profileSource.includes("router.patch('/profile'"), true);
});

test('registration endpoint responds with 404', async () => {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/couple-space/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'forbidden', password: 'forbidden' })
    });
    assert.equal(response.status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('profile update endpoint is registered and protected', async () => {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/couple-space/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '测试昵称', gender: 'other' })
    });
    assert.equal(response.status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
