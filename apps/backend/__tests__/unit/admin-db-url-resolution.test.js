'use strict';
const { resolveAdminDbUrl } = require('../../scripts/lib/admin-db-url');
describe('resolveAdminDbUrl', () => {
  test('prefers ADMIN_DATABASE_URL', () => {
    expect(resolveAdminDbUrl({ ADMIN_DATABASE_URL: 'postgres://super@h/db', DATABASE_URL: 'postgres://app@h/db' }))
      .toEqual({ url: 'postgres://super@h/db', usedFallback: false });
  });
  test('falls back to DATABASE_URL with a warning flag when ADMIN unset', () => {
    expect(resolveAdminDbUrl({ DATABASE_URL: 'postgres://app@h/db' }))
      .toEqual({ url: 'postgres://app@h/db', usedFallback: true });
  });
  test('throws when neither is set', () => {
    expect(() => resolveAdminDbUrl({})).toThrow(/ADMIN_DATABASE_URL/);
  });
});
