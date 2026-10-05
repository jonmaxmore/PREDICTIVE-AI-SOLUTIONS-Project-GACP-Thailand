'use strict';

/**
 * Source guard (workflow audit 2026-06-11) for the auditor audit-decision
 * handler — same convention as auditor-no-scoring-gate.test.js (the handler
 * pulls too many DB deps to instantiate in a unit test, so we pin the
 * behaviour at the source level).
 *
 * Two pinned behaviours:
 *  - HIGH: a CAR (MINOR/MAJOR → CAR_PENDING) must seed the 5-working-day SLA
 *    clock — stamp formData.carDueAt AND seed a RevisionDeadline row — so the
 *    auto-expiry crons fire. Previously this path set neither.
 *  - MEDIUM: MINOR/MAJOR (→ CAR_PENDING, a mandatory-comment target) must
 *    require a justification (notes / reasonCode / findings).
 */
const fs = require('fs');
const path = require('path');

const HANDLER = fs.readFileSync(
    path.resolve(__dirname, '../../routes/api/provider/handlers/auditor-audit-decision-handler.js'),
    'utf8',
);

describe('auditor audit-decision handler — CAR SLA clock + comment gate', () => {
    it('imports the canonical CAR-deadline helper', () => {
        expect(HANDLER).toMatch(/require\(.*services\/car-deadline-service.*\)/);
        expect(HANDLER).toMatch(/computeCarDueDate/);
        expect(HANDLER).toMatch(/seedCarRevisionDeadline/);
    });

    it('computes a CAR due date when entering CAR_PENDING and stamps it into formData', () => {
        expect(HANDLER).toMatch(/carDueAt\s*=\s*nextStatus === 'CAR_PENDING'\s*\?\s*computeCarDueDate/);
        expect(HANDLER).toMatch(/carDueAt:\s*carDueAt\.toISOString\(\)/);
        expect(HANDLER).toMatch(/car_due_at:\s*carDueAt\.toISOString\(\)/);
    });

    it('seeds the RevisionDeadline row after the status write', () => {
        expect(HANDLER).toMatch(/seedCarRevisionDeadline\(\{[\s\S]*applicationId: application\.id/);
    });

    it('requires a justification for a MINOR/MAJOR corrective-action request', () => {
        expect(HANDLER).toMatch(/decision === 'MINOR' \|\| decision === 'MAJOR'\)\s*&&\s*!notes\s*&&\s*!reasonCode\s*&&\s*findings\.length === 0/);
    });
});
