/**
 * Unit tests for status-machine.js
 * Verifies M-005: Canonical status dictionary + transition validation
 */

const {
    APPLICATION_STATUSES,
    WORKFLOW_STATES: _WORKFLOW_STATES,
    ALLOWED_TRANSITIONS: _ALLOWED_TRANSITIONS,
    validateTransition,
    InvalidTransitionError,
    normalizeWorkflowStateInput,
} = require('../../shared/status-machine');

describe('status-machine', () => {
    describe('APPLICATION_STATUSES', () => {
        test('contains all workflow states', () => {
            expect(Object.keys(APPLICATION_STATUSES).length).toBeGreaterThanOrEqual(15);
            expect(APPLICATION_STATUSES.DRAFT).toBe('DRAFT');
            expect(APPLICATION_STATUSES.SUBMITTED).toBe('SUBMITTED');
            expect(APPLICATION_STATUSES.APPROVED).toBe('APPROVED');
            expect(APPLICATION_STATUSES.CERTIFIED).toBe('CERTIFIED');
        });

        test('is frozen', () => {
            expect(Object.isFrozen(APPLICATION_STATUSES)).toBe(true);
        });
    });

    describe('normalizeWorkflowStateInput', () => {
        test('normalizes canonical state (case-insensitive)', () => {
            expect(normalizeWorkflowStateInput('draft')).toBe('DRAFT');
            expect(normalizeWorkflowStateInput('SUBMITTED')).toBe('SUBMITTED');
        });

        test('rejects legacy aliases (PR 2c — normalization is fail-closed)', () => {
            // These resolved through STATE_INPUT_ALIASES / STATE_BY_LEGACY_STATUS
            // until PR 2c. With no writer able to produce them and the column
            // canonical-only, resolving them would only hide a defect.
            expect(normalizeWorkflowStateInput('inspection_scheduled')).toBeNull();
            expect(normalizeWorkflowStateInput('final_approved')).toBeNull();
        });

        test('returns null for unknown input', () => {
            expect(normalizeWorkflowStateInput('INVALID')).toBe(null);
            expect(normalizeWorkflowStateInput('')).toBe(null);
            expect(normalizeWorkflowStateInput(null)).toBe(null);
        });
    });

    describe('validateTransition', () => {
        test('allows valid transition DRAFT → SUBMITTED', () => {
            expect(() => validateTransition('application', 'DRAFT', 'SUBMITTED')).not.toThrow();
        });

        test('allows valid transition SUBMITTED → PENDING_DOC_FEE', () => {
            expect(() => validateTransition('application', 'SUBMITTED', 'PENDING_DOC_FEE')).not.toThrow();
        });

        test('blocks invalid transition DRAFT → APPROVED', () => {
            expect(() => validateTransition('application', 'DRAFT', 'APPROVED')).toThrow(InvalidTransitionError);
        });

        test('blocks invalid transition CERTIFIED → DRAFT (terminal)', () => {
            expect(() => validateTransition('application', 'CERTIFIED', 'DRAFT')).toThrow(InvalidTransitionError);
        });

        test('InvalidTransitionError contains metadata', () => {
            try {
                validateTransition('application', 'DRAFT', 'APPROVED');
                throw new Error('Should have thrown');
            } catch (err) {
                expect(err).toBeInstanceOf(InvalidTransitionError);
                expect(err.from).toBe('DRAFT');
                expect(err.to).toBe('APPROVED');
                expect(err.entity).toBe('application');
                expect(Array.isArray(err.allowedTransitions)).toBe(true);
                expect(err.allowedTransitions).toContain('SUBMITTED');
            }
        });

        test('rejects a legacy alias as a source state (PR 2c)', () => {
            // 'inspection_scheduled' used to resolve to AUDIT_CONFIRMED, which
            // CAN reach AUDIT_PASSED — so the transition was permitted on the
            // strength of an alias table. With that gone the unresolvable value
            // is refused, and the error names what the caller actually passed.
            expect(() => validateTransition('application', 'inspection_scheduled', 'AUDIT_PASSED'))
                .toThrow(/INSPECTION_SCHEDULED/);
        });

        test('the canonical source state it aliased still validates', () => {
            expect(() => validateTransition('application', 'AUDIT_CONFIRMED', 'AUDIT_PASSED')).not.toThrow();
        });
    });
});
