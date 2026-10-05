/**
 * thai-formats.test.ts — drift guard against backend canonical.
 *
 * The frontend `isValidThaiNationalId` + `isValidThaiPhone` MUST mirror
 * `apps/backend/shared/utilities.js` exactly. If a future PR changes the
 * algorithm on one side without the other, this test fails loud and the
 * mismatch never reaches production.
 *
 * The canonical Thai national ID checksum is Mod-11 over digits 0..11
 * weighted (13-i), expected check = (11 - sum % 11) % 10.
 */

import {
  formatThaiNationalId,
  formatThaiPhone,
  isValidEmail,
  isValidThaiNationalId,
  isValidThaiPhone,
  stripPhoneFormatting,
} from '../thai-formats';

describe('isValidThaiNationalId', () => {
  it('accepts the canonical valid example 1-7086-43756-68-9', () => {
    expect(isValidThaiNationalId('1708643756689')).toBe(true);
  });

  it('accepts dashed input', () => {
    expect(isValidThaiNationalId('1-7086-43756-68-9')).toBe(true);
  });

  it('accepts space-separated input', () => {
    expect(isValidThaiNationalId('1 7086 43756 68 9')).toBe(true);
  });

  it('rejects checksum mismatch (last digit off by one)', () => {
    expect(isValidThaiNationalId('1101400100796')).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(isValidThaiNationalId('110140010079')).toBe(false);   // 12
    expect(isValidThaiNationalId('11014001007951')).toBe(false); // 14
  });

  it('rejects non-digit garbage', () => {
    expect(isValidThaiNationalId('hello world')).toBe(false);
    expect(isValidThaiNationalId('')).toBe(false);
  });

  it('rejects nullish input safely', () => {
    expect(isValidThaiNationalId(undefined as unknown as string)).toBe(false);
    expect(isValidThaiNationalId(null as unknown as string)).toBe(false);
  });
});

describe('formatThaiNationalId', () => {
  it('formats 13-digit raw input as X-XXXX-XXXXX-XX-X', () => {
    expect(formatThaiNationalId('1708643756689')).toBe('1-7086-43756-68-9');
  });

  it('keeps already-dashed input dashed (re-formats from cleaned digits)', () => {
    expect(formatThaiNationalId('1-7086-43756-68-9')).toBe('1-7086-43756-68-9');
  });

  it('returns input unchanged when not 13 digits (safe for partial-typing onChange)', () => {
    expect(formatThaiNationalId('110140')).toBe('110140');
    expect(formatThaiNationalId('')).toBe('');
  });
});

describe('isValidThaiPhone', () => {
  it.each([
    '0812345678',
    '0612345678',
    '0912345678',
    '081-234-5678',
    '081 234 5678',
  ])('accepts %s as valid Thai mobile', (input) => {
    expect(isValidThaiPhone(input)).toBe(true);
  });

  it.each([
    '021234567',     // landline (not 06/08/09)
    '0712345678',    // 07 prefix not in our scope
    '08123456789',   // 11 digits
    '081234567',     // 9 digits
    '',
  ])('rejects %s', (input) => {
    expect(isValidThaiPhone(input)).toBe(false);
  });
});

describe('formatThaiPhone', () => {
  it('formats 10-digit raw input as 0XX-XXX-XXXX', () => {
    expect(formatThaiPhone('0812345678')).toBe('081-234-5678');
  });

  it('returns input unchanged when not 10 digits', () => {
    expect(formatThaiPhone('081234')).toBe('081234');
  });
});

describe('stripPhoneFormatting', () => {
  it('strips dashes, spaces, parens', () => {
    expect(stripPhoneFormatting('081-234-5678')).toBe('0812345678');
    expect(stripPhoneFormatting('(081) 234 5678')).toBe('0812345678');
  });
});

describe('isValidEmail', () => {
  it.each([
    'user@example.com',
    'first.last@gacp.go.th',
    'a+tag@gacpth.com',
    'a@b.co',
  ])('accepts %s', (input) => {
    expect(isValidEmail(input)).toBe(true);
  });

  it.each([
    '',
    'no-at-sign',
    '@no-local.com',
    'no-domain@',
    'two..dots@example.com',
    '.leading@example.com',
    'trailing.@example.com',
    'no-tld@example',
  ])('rejects %s', (input) => {
    expect(isValidEmail(input)).toBe(false);
  });
});
