const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../src/app');

test('private image endpoints require authentication', async () => {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const { port } = server.address();
    const upload = await fetch(`http://127.0.0.1:${port}/api/couple-space/avatars/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gender: 'male', data: 'abc' })
    });
    const download = await fetch(`http://127.0.0.1:${port}/api/couple-space/avatars/file/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg`);
    const mediaUpload = await fetch(`http://127.0.0.1:${port}/api/couple-space/media/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purpose: 'album', data: 'abc' })
    });
    const mediaDownload = await fetch(`http://127.0.0.1:${port}/api/couple-space/media/file/1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg`);
    assert.equal(upload.status, 401);
    assert.equal(download.status, 401);
    assert.equal(mediaUpload.status, 401);
    assert.equal(mediaDownload.status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('avatar and media downloads are scoped to the authenticated couple', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  assert.equal(source.includes('WHERE couple_id=? AND avatar_key=? LIMIT 1'), true);
  assert.equal(source.includes("String(req.userRow.couple_id || '') !== coupleId"), true);
  assert.equal(source.includes("server-avatar:${filename}"), true);
  assert.equal(source.includes("['album', 'dish', 'recipe'].includes(purpose)"), true);
  assert.equal(source.includes("router.patch('/avatars'"), false);
});
