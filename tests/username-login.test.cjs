const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLoginIdentifier, isValidLoginIdentifier, isEmailLoginIdentifier } = require('../.test-build/supabase/functions/username-login/login-utils.js');

test('username normalization trims, applies NFKC, and ignores Latin case', () => {
  assert.equal(normalizeLoginIdentifier('  Ｋhaled.User  '), 'khaled.user');
});

test('valid usernames accept Arabic and common identifier punctuation', () => {
  assert.equal(isValidLoginIdentifier('مستخدم_١'), true);
  assert.equal(isValidLoginIdentifier('cashier-02'), true);
  assert.equal(isValidLoginIdentifier('cashier+02'), true);
  assert.equal(isEmailLoginIdentifier('cashier-02'), false);
});

test('email identifiers remain accepted for compatibility and biometric credentials', () => {
  assert.equal(isValidLoginIdentifier('Old.Login@example.com'), true);
  assert.equal(isEmailLoginIdentifier('Old.Login@example.com'), true);
});

test('invalid whitespace, short, and overlong identifiers are rejected', () => {
  assert.equal(isValidLoginIdentifier('ab'), false);
  assert.equal(isValidLoginIdentifier('cash ier'), false);
  assert.equal(isValidLoginIdentifier('x'.repeat(65)), false);
});
