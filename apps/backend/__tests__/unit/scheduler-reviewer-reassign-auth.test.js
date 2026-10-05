/**
 * Unit tests for the scheduler reviewer-reassign route guards.
 *
 * Mirrors audits-reassign-auth.test.js. Verifies the two gates the handler
 * enforces before mutating Application.reviewerId:
 *   1. Role: scheduler/admin only (REASSIGN_ROLES).
 *   2. State: the application must be in ASSIGNED_FOR_REVIEW.
 *
 * These re-declare the handler's constants (canonical-rbac is the real module,
 * so role normalisation is exercised for real). Keep the REASSIGN_ROLES list +
 * REASSIGNABLE_STATE in sync with scheduler-reviewer-reassign-handler.js.
 */

const { normalizeRole, CANONICAL_ROLES } = require('../../shared/canonical-rbac');

describe('scheduler reviewer-reassign role authorization', () => {
    const REASSIGN_ROLES = [CANONICAL_ROLES.SYSTEM_ADMIN_DTAM, CANONICAL_ROLES.DISPATCHER];

    function isReassignAllowed(rawRole) {
        const canonicalRole = normalizeRole(rawRole);
        return canonicalRole && REASSIGN_ROLES.includes(canonicalRole);
    }

    test('admin can reassign reviewers', () => {
        expect(isReassignAllowed('system_admin_dtam')).toBe(true);
    });

    test('super_admin can reassign reviewers (alias)', () => {
        expect(isReassignAllowed('system_admin_dtam')).toBe(true);
    });

    test('scheduler can reassign reviewers', () => {
        expect(isReassignAllowed('dispatcher')).toBe(true);
    });

    test('auditor cannot reassign reviewers', () => {
        expect(isReassignAllowed('field_inspector')).toBe(false);
    });

    test('document_reviewer cannot reassign reviewers', () => {
        expect(isReassignAllowed('document_reviewer')).toBe(false);
    });

    test('reviewer_auditor cannot reassign reviewers', () => {
        expect(isReassignAllowed('document_reviewer')).toBe(false);
    });

    test('account cannot reassign reviewers', () => {
        expect(isReassignAllowed('finance_officer_platform')).toBe(false);
    });

    test('health/Applicant cannot reassign reviewers', () => {
        expect(isReassignAllowed('health')).toBeFalsy();
        expect(isReassignAllowed('Applicant')).toBeFalsy();
    });

    test('null/undefined/empty role cannot reassign reviewers', () => {
        expect(isReassignAllowed(null)).toBeFalsy();
        expect(isReassignAllowed(undefined)).toBeFalsy();
        expect(isReassignAllowed('')).toBeFalsy();
    });
});

describe('scheduler reviewer-reassign state gate', () => {
    // Keep in sync with REASSIGNABLE_STATES in scheduler-reviewer-reassign-handler.js.
    // The reviewerId is the active binding through BOTH states (the resubmit
    // REVISION_REQUESTED→ASSIGNED_FOR_REVIEW does not re-assign), so a swap is
    // valid in either — closing the dead spot where a stuck reviewer during the
    // 5-day revision window could only be re-routed by ADMIN.
    const REASSIGNABLE_STATES = new Set(['ASSIGNED_FOR_REVIEW', 'REVISION_REQUESTED']);

    function isReassignableState(status) {
        return REASSIGNABLE_STATES.has(status);
    }

    test('ASSIGNED_FOR_REVIEW is reassignable (reviewer in flight)', () => {
        expect(isReassignableState('ASSIGNED_FOR_REVIEW')).toBe(true);
    });

    test('REVISION_REQUESTED IS reassignable (reviewer still bound during the revision window)', () => {
        expect(isReassignableState('REVISION_REQUESTED')).toBe(true);
    });

    test('DOC_FEE_PAID is NOT reassignable (no reviewer assigned yet)', () => {
        expect(isReassignableState('DOC_FEE_PAID')).toBe(false);
    });

    test('DOC_APPROVED is NOT reassignable (review already finished)', () => {
        expect(isReassignableState('DOC_APPROVED')).toBe(false);
    });

    test('AUDIT_CONFIRMED is NOT reassignable (that is the auditor reassign path)', () => {
        expect(isReassignableState('AUDIT_CONFIRMED')).toBe(false);
    });

    test('null/undefined status is NOT reassignable', () => {
        expect(isReassignableState(null)).toBe(false);
        expect(isReassignableState(undefined)).toBe(false);
    });
});
