'use strict';

/**
 * Hardening batch 2026-07-09 — waiver anomaly report (ticketed in the
 * 2026-07-08 decision doc, three places: risk #6 "collusion/rubber-stamp" →
 * approver×farmer repeat pairs; §5.5 deliberately NO quota engine — an
 * eyeball-able report instead; §7.5 per-farmer aggregate as backlog).
 *
 * Read-only ops script scripts/ops/waiver-anomaly-report.js with a PURE
 * exported computeWaiverAnomalies(requests, opts) — tested here on fixtures.
 */

jest.mock('../../services/prisma-database', () => ({ prisma: {} }));
jest.mock('../../services/tenant-context', () => ({ withoutTenantScope: (fn) => fn() }));
jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const { computeWaiverAnomalies } = require('../../scripts/ops/waiver-anomaly-report');

const NOW = new Date('2026-07-09T12:00:00.000Z');
const TEN_WORKING_DAYS_AGO = new Date('2026-06-24T12:00:00.000Z');
const YESTERDAY = new Date('2026-07-08T12:00:00.000Z');

let seq = 0;
function req(overrides = {}) {
    seq += 1;
    return {
        id: `REQ-${seq}`,
        applicationId: overrides.applicationId || `APP-${seq}`,
        organizationId: 'org-1',
        requestedBy: 'inspector-1',
        requesterRole: 'document_reviewer',
        expiredFromState: 'REVISION_REQUESTED',
        reasonCode: 'LENIENCY',
        status: 'APPROVED',
        decidedBy: 'acct-1',
        decidedAt: YESTERDAY,
        createdAt: YESTERDAY,
        decisionNote: null,
        application: {
            applicationNumber: overrides.applicationNumber || `GACP-${seq}`,
            healthId: overrides.healthId || `tok-farmer-${seq}`,
            status: overrides.applicationStatus || 'REVISION_REQUESTED',
        },
        ...overrides,
    };
}

beforeEach(() => { seq = 0; });

describe('computeWaiverAnomalies', () => {
    test('(1) repeat approver×farmer pairs flagged at ≥2 distinct apps; single pair not flagged', () => {
        const rows = [
            req({ healthId: 'tok-farmer-A', decidedBy: 'acct-9' }),
            req({ healthId: 'tok-farmer-A', decidedBy: 'acct-9' }), // same pair, 2nd app
            req({ healthId: 'tok-farmer-B', decidedBy: 'acct-9' }), // different farmer — no repeat
        ];
        const r = computeWaiverAnomalies(rows, { now: NOW });
        expect(r.repeatApproverFarmerPairs).toHaveLength(1);
        expect(r.repeatApproverFarmerPairs[0]).toMatchObject({ decidedBy: 'acct-9', count: 2 });
    });

    test('(2) per-farmer approved-LENIENCY across ≥2 distinct applications flagged', () => {
        const rows = [
            req({ healthId: 'tok-farmer-C', decidedBy: 'acct-1' }),
            req({ healthId: 'tok-farmer-C', decidedBy: 'acct-2' }), // different approver, same farmer, 2nd app
        ];
        const r = computeWaiverAnomalies(rows, { now: NOW });
        expect(r.perFarmerLeniencyAggregate).toHaveLength(1);
        expect(r.perFarmerLeniencyAggregate[0].distinctApplications).toBe(2);
    });

    test('(3) self-decided LENIENCY flagged; the by-design system_batch WRONGFUL_EXPIRY lane is NOT', () => {
        const rows = [
            req({ requestedBy: 'user-X', decidedBy: 'user-X' }), // LENIENCY self-decide = gate regression
            req({
                requestedBy: 'ops-1', decidedBy: 'ops-1',
                reasonCode: 'WRONGFUL_EXPIRY', requesterRole: 'system_batch',
                decisionNote: 'BATCH:BUG-123',
            }),
        ];
        const r = computeWaiverAnomalies(rows, { now: NOW });
        expect(r.selfDecidedLeniency).toHaveLength(1);
        expect(r.selfDecidedLeniency[0].requestId).toBe('REQ-1');
    });

    test('(4) >1 APPROVED LENIENCY on one application = partial-unique invariant breach', () => {
        const rows = [
            req({ applicationId: 'APP-DUP', healthId: 'tok-D' }),
            req({ applicationId: 'APP-DUP', healthId: 'tok-D' }),
        ];
        const r = computeWaiverAnomalies(rows, { now: NOW });
        expect(r.multiApprovedLeniencyPerApplication).toHaveLength(1);
        expect(r.multiApprovedLeniencyPerApplication[0].count).toBe(2);
    });

    test('(5) approved-then-re-EXPIRED applications surface (burned reopen)', () => {
        const rows = [
            req({ applicationStatus: 'EXPIRED' }),
            req({ applicationStatus: 'CERTIFIED' }), // healthy outcome — not flagged
        ];
        const r = computeWaiverAnomalies(rows, { now: NOW });
        expect(r.reopenedThenReExpired).toHaveLength(1);
    });

    test('(7) PENDING older than 5 working days = past decision SLA; fresh PENDING is not', () => {
        const rows = [
            req({ status: 'PENDING', decidedBy: null, createdAt: TEN_WORKING_DAYS_AGO }),
            req({ status: 'PENDING', decidedBy: null, createdAt: YESTERDAY }),
        ];
        const r = computeWaiverAnomalies(rows, { now: NOW });
        expect(r.pendingPastSla).toHaveLength(1);
        expect(r.pendingPastSla[0].requestId).toBe('REQ-1');
    });

    test('PII-inert: no report row echoes reason/decisionNote free text; healthId tokens truncated', () => {
        const rows = [
            req({ healthId: 'tok-farmer-AAAAAAAAAAAAAAAAAAAAAAAA', reason: 'เกษตรกรโทรมา 1234567890123', decidedBy: 'acct-9' }),
            req({ healthId: 'tok-farmer-AAAAAAAAAAAAAAAAAAAAAAAA', reason: 'ข้อความอ่อนไหว', decidedBy: 'acct-9' }),
        ];
        const r = computeWaiverAnomalies(rows, { now: NOW });
        const serialized = JSON.stringify(r);
        expect(serialized).not.toContain('เกษตรกรโทรมา');
        expect(serialized).not.toContain('ข้อความอ่อนไหว');
        expect(serialized).not.toContain('tok-farmer-AAAAAAAAAAAAAAAAAAAAAAAA'); // truncated
    });
});
