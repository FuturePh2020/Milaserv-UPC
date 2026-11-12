import assert from 'node:assert/strict';
import { test } from 'node:test';
import { merchantProfileSchema, normalizePhone, usernameSchema } from '../../src/shared/schemas.ts';

test('usernames are NFKC-normalized, trimmed and lowercased, then validated', () => {
  assert.equal(usernameSchema.parse('  Admin.One '), 'admin.one');
  assert.equal(usernameSchema.parse('ＡＤＭＩＮ1'), 'admin1'); // full-width letters (NFKC)
  for (const bad of ['ab', '_admin', 'admin one', 'أحمد', 'a'.repeat(33), 'admin@x']) assert.equal(usernameSchema.safeParse(bad).success, false, bad);
});

test('phones: Arabic-Indic digits and separators normalized; Egyptian mobile or E.164', () => {
  assert.equal(normalizePhone('٠١٠ ١٢٣٤-٥٦٧٨'), '01012345678');
  assert.equal(normalizePhone('(010) 1234 5678'), '01012345678');
  const base = { businessName: 'شركة الخير', contactName: 'أحمد', governorate: 'القاهرة', address: '12 شارع النصر' };
  assert.equal(merchantProfileSchema.parse({ ...base, phone: '٠١٠١٢٣٤٥٦٧٨' }).phone, '01012345678');
  assert.equal(merchantProfileSchema.parse({ ...base, phone: '+201012345678' }).phone, '+201012345678');
  for (const bad of ['0101234567', '01312345678', '12345', '+0123456789']) assert.equal(merchantProfileSchema.safeParse({ ...base, phone: bad }).success, false, bad);
});

test('profile: text trimmed, optional email empty -> null, unknown fields rejected', () => {
  const p = merchantProfileSchema.parse({ businessName: '  شركة الخير ', contactName: 'أحمد', phone: '01012345678', governorate: 'الجيزة', address: '5 شارع الهرم', email: '' });
  assert.equal(p.businessName, 'شركة الخير');
  assert.equal(p.email, null);
  assert.equal(merchantProfileSchema.parse({ ...p, email: ' Ops@Example.COM ' }).email, 'ops@example.com');
  assert.equal(merchantProfileSchema.safeParse({ ...p, email: 'not-an-email' }).success, false);
  assert.equal(merchantProfileSchema.safeParse({ ...p, role: 'admin' }).success, false);
  assert.equal(merchantProfileSchema.safeParse({ ...p, address: 'abc' }).success, false);
});
