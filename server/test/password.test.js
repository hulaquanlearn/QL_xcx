const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../src/password');

test('passwords are salted and verifiable', async () => {
  const first = await hashPassword('a-secure-password');
  const second = await hashPassword('a-secure-password');
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('a-secure-password', first), true);
  assert.equal(await verifyPassword('wrong-password', first), false);
});
