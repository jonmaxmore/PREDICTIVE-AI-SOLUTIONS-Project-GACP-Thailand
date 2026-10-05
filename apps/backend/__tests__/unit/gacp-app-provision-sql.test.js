'use strict';
const fs = require('fs');
const path = require('path');
const SQL = fs.readFileSync(path.resolve(__dirname, '../../scripts/rls/gacp-app-provision.sql'), 'utf8');

describe('gacp-app-provision.sql — Phase 1 (role decouple, policy untouched)', () => {
  test('grants ALL public base tables, not the RLS-enabled allow-list', () => {
    expect(SQL).toMatch(/relkind\s*=\s*'r'/);
    expect(SQL).toMatch(/nspname\s*=\s*'public'/);
    expect(SQL).not.toMatch(/relrowsecurity\s*=\s*true/); // the bug we are fixing
  });
  test('is drift-proof: ALTER DEFAULT PRIVILEGES for future tables + sequences', () => {
    expect(SQL).toMatch(/ALTER DEFAULT PRIVILEGES[\s\S]*ON TABLES TO gacp_app/i);
    expect(SQL).toMatch(/ALTER DEFAULT PRIVILEGES[\s\S]*ON SEQUENCES TO gacp_app/i);
  });
  test('does NOT enforce: no policy flip, no FORCE (Phase 1 keeps SELECT TRUE)', () => {
    expect(SQL).not.toMatch(/FORCE ROW LEVEL SECURITY/i);
    // no enforcing body: the prototype's enforcing function reads app.tenant_id in the body
    expect(SQL).not.toMatch(/CREATE OR REPLACE FUNCTION\s+rls_observe_check/i);
  });
  test('role is least-privilege', () => {
    expect(SQL).toMatch(/NOSUPERUSER/);
    expect(SQL).toMatch(/NOBYPASSRLS/);
  });
});
