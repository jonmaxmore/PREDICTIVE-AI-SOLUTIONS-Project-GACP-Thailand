/**
 * Bug 6.3 — INVERTED 2026-09-05 (T10b), not deleted.
 *
 * The original bug was real: both lot write paths derived
 * `testStatus = labTestReportUrl ? 'PASSED' : ...`, so merely attaching a URL
 * auto-PASSED the lot and FAILED could not be expressed at all. The 2026-06 fix
 * made the claim explicit — the farmer had to self-attest — which was the most
 * honest version of a model where the farmer is the source of the lab claim.
 *
 * That model is gone. A COA is now a file issued by a laboratory, attached to the
 * harvest BATCH (T9/T10) and verified by an officer (T13); the public scan reads
 * that, and the five typed fields are refused at the lot doors
 * (services/lot-lab-claim-guard.js). Self-attestation is not a smaller permission
 * than it was — it is no permission, because there is no longer anywhere to type it.
 *
 * Two things follow, and this file now pins both:
 *
 *   normalizeLotTestStatus still behaves exactly as Bug 6.3 left it. It is
 *   unreachable from any farmer-facing door, but the migration and repair scripts
 *   still call it, and a helper that normalises a stored enum should not change
 *   meaning just because its busiest caller went away.
 *
 *   The public resolver no longer derives anything from lot.testStatus. Its own
 *   word about itself is not evidence, so `labTest` comes from the batch's real
 *   reports. The three tests below used to assert the derivation; they now assert
 *   that a lot claiming PASSED with no report on file is published as UNTESTED —
 *   which is the whole point of moving the claim off the lot.
 */

'use strict';

// traceability-service imports prisma-database (process.exit(1) w/o DATABASE_URL)
// + several other DB-touching modules — mock them so the pure helper loads.
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));
jest.mock('../../services/user-lookup-service', () => ({ findUserByHealthIdSecurely: jest.fn() }));

describe('normalizeLotTestStatus — unchanged, and now reachable only from scripts', () => {
    const { normalizeLotTestStatus } = require('../../services/traceability-service');

    test('absent status → PENDING (a report URL does NOT auto-PASS)', () => {
        expect(normalizeLotTestStatus(undefined)).toBe('PENDING');
        expect(normalizeLotTestStatus(null)).toBe('PENDING');
        expect(normalizeLotTestStatus('')).toBe('PENDING');
    });

    test('explicit PASSED → PASSED (no door sends this any more; the repair scripts do)', () => {
        expect(normalizeLotTestStatus('PASSED')).toBe('PASSED');
        expect(normalizeLotTestStatus('passed')).toBe('PASSED');
    });

    test('explicit FAILED → FAILED (now representable)', () => {
        expect(normalizeLotTestStatus('FAILED')).toBe('FAILED');
        expect(normalizeLotTestStatus('failed')).toBe('FAILED');
    });

    test('explicit PENDING → PENDING', () => {
        expect(normalizeLotTestStatus('PENDING')).toBe('PENDING');
    });

    test('invalid value → throws (validated enum)', () => {
        expect(() => normalizeLotTestStatus('GREEN')).toThrow();
        expect(() => normalizeLotTestStatus('OK')).toThrow();
    });
});

describe('T10b — the lot\'s own testStatus decides NOTHING on the public page', () => {
    // This block has been rewritten twice, and both moves are worth keeping visible:
    // 2026-08-21 it stopped asserting `labTest.passed`/`labTest.status` (R9: the
    // public page carries no pass/fail summary) and asserted `tested`, derived from
    // lot.testStatus. 2026-09-05 the derivation itself goes: `tested` now means
    // "a lab report exists on this lot's batch", and a lot that says PASSED while
    // its batch holds no report is published as UNTESTED. That is not a regression
    // in what the page shows — it is the page refusing to repeat an unbacked claim.
    // Load the resolver with common.js mocked (same DB-import gotcha pattern as
    // trace-generic-pii-redaction.test.js).
    jest.mock('../../server', () => ({ prisma: {} }));
    jest.mock('../../services/trace-service/common', () => ({
        prisma: {
            plantingCycle: { findFirst: jest.fn() },
            harvestBatch: { findFirst: jest.fn() },
            lot: { findFirst: jest.fn() },
        },
        logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
        qrcodeService: { verifyTraceIntegrity: jest.fn(async () => ({ available: false, valid: null })) },
        formatCultivationType: (x) => x,
        formatThaiDate: (x) => (x ? String(x) : null),
        SAFETY_DISCLAIMER: 'disclaimer',
        FDA_REFERRAL: 'fda',
        TRACE_NOT_FOUND_MESSAGE: 'not found',
        evaluateCertGate: jest.requireActual('../../services/trace-service/common').evaluateCertGate,
    }));

    const common = require('../../services/trace-service/common');
    const { resolveTraceByGenericQr } = require('../../services/trace-service/resolve-generic');

    const ctx = { requestIp: '127.0.0.1', userAgent: 'jest' };

    function lotRow(testStatus, labTestReportUrl) {
        return {
            lotNumber: 'L1', packageType: 'BOX', quantity: 1, unitWeight: 1,
            status: 'PACKAGED', packagedAt: null, expiryDate: null,
            testStatus, thcContent: null, cbdContent: null, moistureContent: null,
            labTestReportUrl: labTestReportUrl || null,
            batch: {
                batchNumber: 'B1', harvestDate: null, plantingDate: null,
                farm: { farmName: 'F', farmType: 'OUTDOOR', district: 'd', province: 'p', status: 'ACTIVE' },
                plant: { code: 'C' },
                cycle: { certificate: null },
            },
        };
    }

    beforeEach(() => {
        jest.clearAllMocks();
        common.prisma.plantingCycle.findFirst.mockResolvedValue(null);
        common.prisma.harvestBatch.findFirst.mockResolvedValue(null);
        common.prisma.lot.findFirst.mockResolvedValue(null);
        common.qrcodeService.verifyTraceIntegrity.mockResolvedValue({ available: false, valid: null });
    });

    test('a lot that says PASSED, with no report on its batch, is published as UNTESTED', async () => {
        common.prisma.lot.findFirst.mockResolvedValue(lotRow('PASSED', 'https://lab.example/report.pdf'));
        const out = await resolveTraceByGenericQr('L1', ctx);
        expect(out.status).toBe(200);
        expect(out.body.data.lot.labTest.lot).toMatchObject({ subject: 'LOT', tested: false });
        expect(out.body.data.lot.labTest.lot.latest).toBeNull();
    });

    test('FAILED and PENDING read the same way — the word on the lot is simply not consulted', async () => {
        for (const claimed of ['FAILED', 'PENDING', null]) {
            common.prisma.lot.findFirst.mockResolvedValue(lotRow(claimed, 'https://lab.example/report.pdf'));
            const out = await resolveTraceByGenericQr('L1', ctx);
            expect(out.body.data.lot.labTest.lot.tested).toBe(false);
        }
    });

    test('the lot\'s self-declared words never reach the page under any spelling', async () => {
        common.prisma.lot.findFirst.mockResolvedValue(lotRow('PASSED', 'https://lab.example/report.pdf'));
        const out = await resolveTraceByGenericQr('L1', ctx);
        const serialized = JSON.stringify(out.body);
        expect(serialized).not.toContain('testStatus');
        expect(serialized).not.toContain('PASSED');
        // and no flattened boolean anyone could mistake for a verdict
        expect(serialized).not.toContain('passed');
        expect(out.body.data.lot.labTest.lot.reports).toEqual([]);
    });
});
