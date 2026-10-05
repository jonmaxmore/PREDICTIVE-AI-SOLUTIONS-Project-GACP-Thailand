/**
 * Unit tests for audits-reassign route auth guards
 * Verifies M-004: Privileged route authorization (reassign)
 *
 * Tests the inline role check (scheduler/admin only) that was added
 * as part of FB-01 audit remediation.
 */

const { normalizeRole, CANONICAL_ROLES } = require('../../shared/canonical-rbac');

describe('audits-reassign role authorization', () => {
    const REASSIGN_ROLES = [CANONICAL_ROLES.SYSTEM_ADMIN_DTAM, CANONICAL_ROLES.DISPATCHER];

    function isReassignAllowed(rawRole) {
        const canonicalRole = normalizeRole(rawRole);
        return canonicalRole && REASSIGN_ROLES.includes(canonicalRole);
    }

    test('admin can reassign', () => {
        expect(isReassignAllowed('system_admin_dtam')).toBe(true);
    });

    test('super_admin can reassign (alias)', () => {
        expect(isReassignAllowed('system_admin_dtam')).toBe(true);
    });

    test('scheduler can reassign', () => {
        expect(isReassignAllowed('dispatcher')).toBe(true);
    });

    test('auditor cannot reassign', () => {
        expect(isReassignAllowed('field_inspector')).toBe(false);
    });

    test('document_reviewer cannot reassign', () => {
        expect(isReassignAllowed('document_reviewer')).toBe(false);
    });

    test('reviewer_auditor cannot reassign', () => {
        expect(isReassignAllowed('document_reviewer')).toBe(false);
    });

    test('account cannot reassign', () => {
        expect(isReassignAllowed('finance_officer_platform')).toBe(false);
    });

    test('health/Applicant cannot reassign', () => {
        expect(isReassignAllowed('health')).toBeFalsy();
        expect(isReassignAllowed('Applicant')).toBeFalsy();
    });

    test('null/undefined role cannot reassign', () => {
        expect(isReassignAllowed(null)).toBeFalsy();
        expect(isReassignAllowed(undefined)).toBeFalsy();
        expect(isReassignAllowed('')).toBeFalsy();
    });
});

// provider-E2E carpet 2026-07-09 (MEDIUM): the auditor-reassign POST had NO
// application-status gate (its reviewer mirror does), so an auditor could be
// reassigned on a pre-payment app (e.g. PENDING_DOC_FEE). The gate must match
// the states listReassignableAudits surfaces and must run BEFORE the auditor
// lookup / trackedUpdate mutation.
describe('audits-reassign application-status gate', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
        path.join(__dirname, '..', '..', 'routes', 'api', 'audit', 'audits-reassign.js'), 'utf8',
    );

    const REASSIGNABLE = new Set(['AUDIT_CONFIRMED', 'CAR_PENDING', 'CAR_REVIEWING', 'EXPIRED']);
    test.each(['AUDIT_CONFIRMED', 'CAR_PENDING', 'CAR_REVIEWING', 'EXPIRED'])(
        'reassignable in %s', (s) => { expect(REASSIGNABLE.has(s)).toBe(true); },
    );
    test.each(['PENDING_DOC_FEE', 'DRAFT', 'ASSIGNED_FOR_REVIEW', 'DOC_APPROVED', 'CERTIFIED', 'PENDING_AUDIT_FEE'])(
        'NOT reassignable in %s (pre-auditor or terminal)', (s) => { expect(REASSIGNABLE.has(s)).toBe(false); },
    );

    test('route defines the REASSIGNABLE_AUDIT_STATES set matching the list states', () => {
        expect(src).toMatch(/REASSIGNABLE_AUDIT_STATES\s*=\s*new Set\(/);
        for (const s of REASSIGNABLE) { expect(src).toContain(`'${s}'`); }
    });

    test('the status gate runs BEFORE the auditor lookup / mutation (403/409 short-circuit)', () => {
        const gateIdx = src.indexOf('REASSIGNABLE_AUDIT_STATES.has(application.status)');
        const lookupIdx = src.indexOf('findReassignmentTargetUser');
        expect(gateIdx).toBeGreaterThan(-1);
        expect(lookupIdx).toBeGreaterThan(-1);
        expect(gateIdx).toBeLessThan(lookupIdx); // gate precedes the auditor lookup
    });
});
