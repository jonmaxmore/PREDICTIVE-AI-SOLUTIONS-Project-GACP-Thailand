/**
 * backfill-renewal-reminders unit tests — Iter R2 (R2-C).
 *
 * Verifies the one-shot backfill CLI script's contract:
 *   - parseArgs handles --days and --dry-run (positive + negative)
 *   - Walks the 3 cadence tiers (60 / 30 / 15) backwards over the window
 *   - Idempotent: re-running collapses on (certId, reminderType) via the
 *     underlying markRenewalReminderSent service
 *   - --dry-run prints what WOULD be marked without invoking the service
 *   - Per-tier and overall totals reflect scanned / marked / alreadyMarked / errors
 */

'use strict';

const path = require('path');

const scriptPath = path.resolve(__dirname, '../../scripts/backfill-renewal-reminders.js');

function loadScript() {
    jest.resetModules();
    return require(scriptPath);
}

// --- Helpers ---------------------------------------------------------------

function dayMs(n) { return n * 24 * 60 * 60 * 1000; }

function makePrismaStub({ certificates = [] } = {}) {
    return {
        certificate: {
            findMany: jest.fn(async ({ where }) => {
                const startTs = where.expiryDate.gte.getTime();
                const endTs = where.expiryDate.lt.getTime();
                return certificates.filter((cert) => {
                    if (where.isDeleted === false && cert.isDeleted) {return false;}
                    if (where.status && cert.status !== where.status) {return false;}
                    if (!cert.expiryDate) {return false;}
                    const ts = new Date(cert.expiryDate).getTime();
                    return ts >= startTs && ts < endTs;
                });
            }),
        },
    };
}

function makeRenewalServiceStub() {
    const seen = new Set();
    const markRenewalReminderSent = jest.fn(async ({ certificateId, reminderType }) => {
        const key = `${certificateId}::${reminderType}`;
        if (seen.has(key)) {
            return { alreadySent: true, reminderType, applicationId: `app-${certificateId}` };
        }
        seen.add(key);
        return { alreadySent: false, reminderType, applicationId: `app-${certificateId}` };
    });
    return {
        markRenewalReminderSent,
        _seen: seen,
    };
}

// --- parseArgs --------------------------------------------------------------

describe('parseArgs', () => {
    test('defaults: days=90, dryRun=false', () => {
        const { parseArgs } = loadScript();
        expect(parseArgs([])).toEqual({ days: 90, dryRun: false });
    });

    test('parses --dry-run flag', () => {
        const { parseArgs } = loadScript();
        expect(parseArgs(['--dry-run'])).toEqual({ days: 90, dryRun: true });
    });

    test('parses --days NUMBER form', () => {
        const { parseArgs } = loadScript();
        expect(parseArgs(['--days', '30'])).toEqual({ days: 30, dryRun: false });
    });

    test('parses --days=NUMBER form', () => {
        const { parseArgs } = loadScript();
        expect(parseArgs(['--days=15'])).toEqual({ days: 15, dryRun: false });
    });

    test('rejects --days with non-positive value', () => {
        const { parseArgs } = loadScript();
        expect(() => parseArgs(['--days', '0'])).toThrow(/positive integer/);
        expect(() => parseArgs(['--days', '-3'])).toThrow(/positive integer/);
        expect(() => parseArgs(['--days', 'abc'])).toThrow(/positive integer/);
    });

    test('combines --days and --dry-run', () => {
        const { parseArgs } = loadScript();
        expect(parseArgs(['--dry-run', '--days', '7'])).toEqual({ days: 7, dryRun: true });
    });
});

// --- backfill --------------------------------------------------------------

describe('backfill — tier walk + idempotency', () => {
    test('walks 60/30/15 tiers backwards and marks each (cert, tier) at most once', async () => {
        const { backfill } = loadScript();
        const now = new Date('2026-05-17T00:00:00.000Z');

        // Build certificates whose expiryDate falls inside the trigger
        // window for exactly one (backfillDay, tier) pair within the
        // 5-day backfill window we use for this test (offsets 0..5).
        //
        // For backfillDate=today-0, tier=60 → expiry window = today+60.
        // For backfillDate=today-1, tier=30 → expiry window = today+29.
        // For backfillDate=today-2, tier=15 → expiry window = today+13.
        const certificates = [
            {
                id: 'cert-60',
                isDeleted: false,
                status: 'active',
                certificateNumber: 'GACP-60',
                expiryDate: new Date(now.getTime() + dayMs(60)).toISOString(),
            },
            {
                id: 'cert-30',
                isDeleted: false,
                status: 'active',
                certificateNumber: 'GACP-30',
                expiryDate: new Date(now.getTime() + dayMs(29)).toISOString(),
            },
            {
                id: 'cert-15',
                isDeleted: false,
                status: 'active',
                certificateNumber: 'GACP-15',
                expiryDate: new Date(now.getTime() + dayMs(13)).toISOString(),
            },
        ];

        const prisma = makePrismaStub({ certificates });
        const renewalService = makeRenewalServiceStub();

        const result = await backfill({
            days: 5,
            now,
            prisma,
            renewalService,
        });

        expect(result.dryRun).toBe(false);
        expect(result.tiers).toHaveLength(3);
        expect(result.tiers.map((t) => t.tier)).toEqual([60, 30, 15]);

        // Each certificate should have been marked once for its matching tier.
        expect(renewalService.markRenewalReminderSent).toHaveBeenCalledTimes(3);

        const tier60 = result.tiers.find((t) => t.tier === 60);
        const tier30 = result.tiers.find((t) => t.tier === 30);
        const tier15 = result.tiers.find((t) => t.tier === 15);

        expect(tier60.scanned).toBe(1);
        expect(tier60.marked).toBe(1);
        expect(tier60.alreadyMarked).toBe(0);
        expect(tier60.errors).toBe(0);

        expect(tier30.scanned).toBe(1);
        expect(tier30.marked).toBe(1);
        expect(tier30.alreadyMarked).toBe(0);
        expect(tier30.errors).toBe(0);

        expect(tier15.scanned).toBe(1);
        expect(tier15.marked).toBe(1);
        expect(tier15.alreadyMarked).toBe(0);
        expect(tier15.errors).toBe(0);

        expect(result.totals).toEqual({ scanned: 3, marked: 3, alreadyMarked: 0, errors: 0 });
    });

    test('re-running collapses already-marked entries (idempotent)', async () => {
        const { backfill } = loadScript();
        const now = new Date('2026-05-17T00:00:00.000Z');

        const certificates = [
            {
                id: 'cert-30',
                isDeleted: false,
                status: 'active',
                certificateNumber: 'GACP-30',
                expiryDate: new Date(now.getTime() + dayMs(30)).toISOString(),
            },
        ];

        const prisma = makePrismaStub({ certificates });
        const renewalService = makeRenewalServiceStub();

        const first = await backfill({ days: 2, now, prisma, renewalService });
        const tier30First = first.tiers.find((t) => t.tier === 30);
        expect(tier30First.marked).toBe(1);
        expect(tier30First.alreadyMarked).toBe(0);

        const second = await backfill({ days: 2, now, prisma, renewalService });
        const tier30Second = second.tiers.find((t) => t.tier === 30);
        expect(tier30Second.scanned).toBe(1);
        expect(tier30Second.marked).toBe(0);
        expect(tier30Second.alreadyMarked).toBe(1);
        expect(tier30Second.errors).toBe(0);
    });

    test('--dry-run does NOT call markRenewalReminderSent', async () => {
        const { backfill } = loadScript();
        const now = new Date('2026-05-17T00:00:00.000Z');

        const certificates = [
            {
                id: 'cert-60',
                isDeleted: false,
                status: 'active',
                certificateNumber: 'GACP-60',
                expiryDate: new Date(now.getTime() + dayMs(60)).toISOString(),
            },
        ];
        const prisma = makePrismaStub({ certificates });
        const renewalService = makeRenewalServiceStub();
        const logEntries = [];

        const result = await backfill({
            days: 1,
            dryRun: true,
            now,
            prisma,
            renewalService,
            log: (entry) => logEntries.push(entry),
        });

        expect(result.dryRun).toBe(true);
        expect(renewalService.markRenewalReminderSent).not.toHaveBeenCalled();

        const wouldMark = logEntries.filter((e) => e.action === 'would-mark');
        expect(wouldMark.length).toBe(1);
        expect(wouldMark[0]).toMatchObject({
            certificateId: 'cert-60',
            reminderType: 'D60',
        });

        const tier60 = result.tiers.find((t) => t.tier === 60);
        expect(tier60.scanned).toBe(1);
        expect(tier60.marked).toBe(1); // counted as "would-have-marked"
        expect(tier60.alreadyMarked).toBe(0);
        expect(tier60.errors).toBe(0);
    });

    test('per-row errors are counted, not thrown', async () => {
        const { backfill } = loadScript();
        const now = new Date('2026-05-17T00:00:00.000Z');

        const certificates = [
            {
                id: 'cert-bad',
                isDeleted: false,
                status: 'active',
                certificateNumber: 'GACP-BAD',
                expiryDate: new Date(now.getTime() + dayMs(15)).toISOString(),
            },
        ];

        const prisma = makePrismaStub({ certificates });
        const renewalService = {
            markRenewalReminderSent: jest.fn(async () => {
                throw new Error('boom-from-service');
            }),
        };
        const logEntries = [];

        const result = await backfill({
            days: 0,
            now,
            prisma,
            renewalService,
            log: (entry) => logEntries.push(entry),
        });

        const tier15 = result.tiers.find((t) => t.tier === 15);
        expect(tier15.scanned).toBe(1);
        expect(tier15.marked).toBe(0);
        expect(tier15.errors).toBe(1);

        const errorEntry = logEntries.find((e) => e.action === 'error');
        expect(errorEntry).toBeDefined();
        expect(errorEntry.certificateId).toBe('cert-bad');
        expect(errorEntry.error).toBe('boom-from-service');
    });

    test('skips certificates outside the trigger window', async () => {
        const { backfill } = loadScript();
        const now = new Date('2026-05-17T00:00:00.000Z');

        // Cert whose expiryDate falls in NO tier window for the 0-day scan.
        const certificates = [
            {
                id: 'cert-far',
                isDeleted: false,
                status: 'active',
                certificateNumber: 'GACP-FAR',
                expiryDate: new Date(now.getTime() + dayMs(120)).toISOString(),
            },
        ];

        const prisma = makePrismaStub({ certificates });
        const renewalService = makeRenewalServiceStub();

        const result = await backfill({ days: 0, now, prisma, renewalService });

        expect(result.totals).toEqual({ scanned: 0, marked: 0, alreadyMarked: 0, errors: 0 });
        expect(renewalService.markRenewalReminderSent).not.toHaveBeenCalled();
    });
});
