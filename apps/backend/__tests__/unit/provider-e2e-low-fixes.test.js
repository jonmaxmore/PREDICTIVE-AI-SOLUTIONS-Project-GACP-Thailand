/**
 * provider-E2E carpet 2026-07-09 — the 3 LOW fixes.
 *   1. 403 AUTHORIZATION_ERROR gets a correct Thai message (not "internal error")
 *   2. auditor inspection-start is gated to AUDITORS + no ADMIN ownership bypass
 *   3. provider/reports is gated to ADMIN+SCHEDULER (revenue SoD)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const BE = path.join(__dirname, '..', '..');

describe('LOW-1 · AUTHORIZATION_ERROR resolves to a real Thai message', () => {
  const { DEFAULT_ERROR_MESSAGES } = require('../../shared/api-response');

  it('maps AUTHORIZATION_ERROR (not falling back to INTERNAL_SERVER_ERROR)', () => {
    expect(DEFAULT_ERROR_MESSAGES.AUTHORIZATION_ERROR).toBeDefined();
    expect(DEFAULT_ERROR_MESSAGES.AUTHORIZATION_ERROR.th).toEqual(expect.any(String));
    expect(DEFAULT_ERROR_MESSAGES.AUTHORIZATION_ERROR.th.length).toBeGreaterThan(0);
    // The bug was the fallback to the internal-error Thai string.
    expect(DEFAULT_ERROR_MESSAGES.AUTHORIZATION_ERROR.th)
      .not.toBe(DEFAULT_ERROR_MESSAGES.INTERNAL_SERVER_ERROR.th);
    expect(DEFAULT_ERROR_MESSAGES.AUTHORIZATION_ERROR.th).not.toContain('ภายในระบบ');
  });
});

describe('LOW-2 · auditor inspection-start SoD gate', () => {
  const src = fs.readFileSync(
    path.join(BE, 'routes', 'api', 'provider', 'handlers', 'auditor-inspection-start-handler.js'), 'utf8',
  );
  it('gates the handler chain with requireRole(ROLE_GROUPS.AUDITORS)', () => {
    expect(src).toMatch(/requireRole\(ROLE_GROUPS\.AUDITORS\)/);
  });
  it('drops the ADMIN ownership carve-out (assigned auditor only)', () => {
    // The old bypass `canonicalRole !== CANONICAL_ROLES.SYSTEM_ADMIN_DTAM && ...` is gone.
    expect(src).not.toMatch(/CANONICAL_ROLES\.ADMIN\s*&&\s*application\.auditorId/);
    expect(src).toMatch(/application\.auditorId !== req\.user\.id/);
  });
});

describe('LOW-3 · provider/reports revenue role gate', () => {
  const src = fs.readFileSync(path.join(BE, 'routes', 'api', 'provider', 'reports.js'), 'utf8');
  it('gates the router to ADMIN+SCHEDULER (ROLE_GROUPS.SCHEDULERS)', () => {
    expect(src).toMatch(/requireRole\(ROLE_GROUPS\.SCHEDULERS\)/);
    // gate is applied at the router level, before the route handlers
    const gateIdx = src.indexOf('requireRole(ROLE_GROUPS.SCHEDULERS)');
    const summaryIdx = src.indexOf("router.get('/summary'");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(summaryIdx);
  });
});
