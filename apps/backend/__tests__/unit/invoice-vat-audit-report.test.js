/**
 * Tests for invoice VAT audit report script (read-only Finance diagnostic).
 *
 * System deep-dive Tier 11 — DBA + Backend + Compliance + QA (2026-05-15).
 *
 * Covers:
 *   1. parseArgs — boundary validation
 *   2. classifyInvoice — 6 mutually-exclusive categories matching the
 *      Finance review priorities (backfill candidates + underbilling rows)
 *   3. runAudit — orchestration with cursor pagination, sample capture,
 *      summary aggregation
 *   4. CANONICAL_TOTALS anchor (5,000 / 535 / 25,000 / 2,675)
 */

const path = require('path');

const {
    PLATFORM_SERVICE_TYPES,
    STATE_SERVICE_TYPES,
    CANONICAL_TOTALS,
    parseArgs,
    classifyInvoice,
    runAudit,
} = require(path.join(__dirname, '..', '..', 'scripts', 'audit', 'invoice-vat-audit-report'));

describe('[Tier 11] audit report — constants', () => {
    it('PLATFORM_SERVICE_TYPES frozen + only 2 entries', () => {
        expect([...PLATFORM_SERVICE_TYPES].sort()).toEqual([
            'PHASE_1_PLATFORM_FEE', 'PHASE_2_PLATFORM_FEE',
        ].sort());
        expect(Object.isFrozen(PLATFORM_SERVICE_TYPES)).toBe(true);
    });

    it('STATE_SERVICE_TYPES frozen + only 2 entries', () => {
        expect([...STATE_SERVICE_TYPES].sort()).toEqual([
            'PHASE_1_STATE_FEE', 'PHASE_2_STATE_FEE',
        ].sort());
        expect(Object.isFrozen(STATE_SERVICE_TYPES)).toBe(true);
    });

    it('CANONICAL_TOTALS match the canonical fee table', () => {
        // Phase 1: state 5,000 / platform 535 (500 + 35 VAT)
        // Phase 2: state 25,000 / platform 2,675 (2,500 + 175 VAT)
        expect(CANONICAL_TOTALS.PHASE_1_STATE_FEE).toBe(5000);
        expect(CANONICAL_TOTALS.PHASE_1_PLATFORM_FEE).toBe(535);
        expect(CANONICAL_TOTALS.PHASE_2_STATE_FEE).toBe(25000);
        expect(CANONICAL_TOTALS.PHASE_2_PLATFORM_FEE).toBe(2675);
        expect(Object.isFrozen(CANONICAL_TOTALS)).toBe(true);
    });
});

describe('[Tier 11] parseArgs', () => {
    it('returns defaults when no flags given', () => {
        expect(parseArgs([])).toEqual({ maxRows: Infinity, batchSize: 200 });
    });

    it('parses --max-rows / --batch-size', () => {
        expect(parseArgs(['--max-rows', '500']).maxRows).toBe(500);
        expect(parseArgs(['--batch-size', '50']).batchSize).toBe(50);
    });

    it('rejects invalid --max-rows / --batch-size', () => {
        expect(() => parseArgs(['--max-rows', '0'])).toThrow();
        expect(() => parseArgs(['--batch-size', '5001'])).toThrow();
        expect(() => parseArgs(['--batch-size', 'abc'])).toThrow();
    });

    it('rejects unknown flags', () => {
        expect(() => parseArgs(['--invalid'])).toThrow(/Unknown arg/);
    });
});

describe('[Tier 11] classifyInvoice — 6 audit categories', () => {
    it('PLATFORM with vat=0 + pending → PLATFORM_PENDING_NEEDS_VAT_BACKFILL', () => {
        const result = classifyInvoice({
            serviceType: 'PHASE_1_PLATFORM_FEE',
            status: 'pending',
            vat: 0,
            totalAmount: 500,
        });
        expect(result.category).toBe('PLATFORM_PENDING_NEEDS_VAT_BACKFILL');
        expect(result.delta).toBe(0);
    });

    it('PLATFORM with vat=0 + paid → PLATFORM_PAID_NEEDS_VAT_BACKFILL', () => {
        const result = classifyInvoice({
            serviceType: 'PHASE_1_PLATFORM_FEE',
            status: 'paid',
            vat: 0,
            totalAmount: 535, // customer paid canonical 535
        });
        expect(result.category).toBe('PLATFORM_PAID_NEEDS_VAT_BACKFILL');
    });

    it('PLATFORM paid + totalAmount < canonical → PLATFORM_PAID_UNDERBILLED_PRE_TIER_8 with delta', () => {
        const result = classifyInvoice({
            serviceType: 'PHASE_1_PLATFORM_FEE',
            status: 'paid',
            vat: 35, // VAT recorded (post-Tier-9) but underbilled overall (pre-Tier-8)
            totalAmount: 500, // canonical is 535 → delta 35
        });
        // Wait: vat=35 not 0, so should NOT be in NEEDS_VAT_BACKFILL category
        // It's in UNDERBILLED because totalAmount(500) < canonical(535)
        expect(result.category).toBe('PLATFORM_PAID_UNDERBILLED_PRE_TIER_8');
        expect(result.delta).toBe(35);
    });

    it('STATE paid + totalAmount < canonical → STATE_PAID_UNDERBILLED_UNEXPECTED (flag for human review)', () => {
        const result = classifyInvoice({
            serviceType: 'PHASE_1_STATE_FEE',
            status: 'paid',
            vat: 0,
            totalAmount: 4500, // canonical 5,000 → delta 500
        });
        expect(result.category).toBe('STATE_PAID_UNDERBILLED_UNEXPECTED');
        expect(result.delta).toBe(500);
    });

    it('PAID at canonical → PAID_AT_CANONICAL_OR_ABOVE (healthy)', () => {
        expect(classifyInvoice({
            serviceType: 'PHASE_1_STATE_FEE',
            status: 'paid', vat: 0, totalAmount: 5000,
        }).category).toBe('PAID_AT_CANONICAL_OR_ABOVE');

        expect(classifyInvoice({
            serviceType: 'PHASE_1_PLATFORM_FEE',
            status: 'paid', vat: 35, totalAmount: 535,
        }).category).toBe('PAID_AT_CANONICAL_OR_ABOVE');
    });

    it('PAID above canonical (e.g. multi-scope) → PAID_AT_CANONICAL_OR_ABOVE', () => {
        // 3-scope Phase 1 PLATFORM: subtotal 1,500 + VAT 105 = 1,605
        // Canonical for single-scope is 535, so 1,605 > 535 → above canonical
        const result = classifyInvoice({
            serviceType: 'PHASE_1_PLATFORM_FEE',
            status: 'paid', vat: 105, totalAmount: 1605,
        });
        expect(result.category).toBe('PAID_AT_CANONICAL_OR_ABOVE');
    });

    it('Pending healthy row → PENDING_HEALTHY', () => {
        expect(classifyInvoice({
            serviceType: 'PHASE_1_PLATFORM_FEE',
            status: 'pending', vat: 35, totalAmount: 535,
        }).category).toBe('PENDING_HEALTHY');
    });

    it('Out-of-scope service types → OUT_OF_SCOPE (defensive)', () => {
        expect(classifyInvoice({
            serviceType: 'UNKNOWN_FEE', status: 'paid', vat: 0, totalAmount: 100,
        }).category).toBe('OUT_OF_SCOPE');
    });

    it('STATE invoice with vat=0 + paid at canonical does NOT flag as needs-backfill (DTAM is VAT-exempt)', () => {
        // CRITICAL: state invoices with vat=0 are correct, not a backfill candidate.
        // The PLATFORM_*_NEEDS_VAT_BACKFILL categories only apply to PLATFORM types.
        const result = classifyInvoice({
            serviceType: 'PHASE_1_STATE_FEE',
            status: 'paid', vat: 0, totalAmount: 5000,
        });
        expect(result.category).toBe('PAID_AT_CANONICAL_OR_ABOVE');
        expect(result.category).not.toBe('PLATFORM_PENDING_NEEDS_VAT_BACKFILL');
        expect(result.category).not.toBe('PLATFORM_PAID_NEEDS_VAT_BACKFILL');
    });
});

describe('[Tier 11] runAudit orchestration', () => {
    const mkInv = (id, overrides = {}) => ({
        id,
        invoiceNumber: `INV-${id}`,
        serviceType: 'PHASE_1_PLATFORM_FEE',
        status: 'pending',
        subtotal: 500,
        vat: 0,
        totalAmount: 500,
        applicationId: `app-${id}`,
        createdAt: new Date(),
        ...overrides,
    });

    it('paginates through invoices and aggregates summary categories', async () => {
        const client = {
            invoice: {
                findMany: jest.fn()
                    .mockResolvedValueOnce([
                        mkInv('a', { status: 'pending', vat: 0 }),  // needs-backfill pending
                        mkInv('b', { status: 'paid', vat: 35, totalAmount: 535 }), // healthy
                    ])
                    .mockResolvedValueOnce([
                        mkInv('c', { status: 'paid', vat: 0, totalAmount: 535 }), // needs-backfill paid
                    ])
                    .mockResolvedValueOnce([]),
            },
        };

        const summary = await runAudit({
            client, batchSize: 2, maxRows: Infinity,
            logger: { log: () => {} },
        });

        expect(summary.rowsScanned).toBe(3);
        expect(summary.byCategory.PLATFORM_PENDING_NEEDS_VAT_BACKFILL.count).toBe(1);
        expect(summary.byCategory.PLATFORM_PAID_NEEDS_VAT_BACKFILL.count).toBe(1);
        expect(summary.byCategory.PAID_AT_CANONICAL_OR_ABOVE.count).toBe(1);
    });

    it('accumulates totalDelta for underbilling categories', async () => {
        const client = {
            invoice: {
                findMany: jest.fn()
                    .mockResolvedValueOnce([
                        mkInv('u1', {
                            serviceType: 'PHASE_1_PLATFORM_FEE',
                            status: 'paid', vat: 35, totalAmount: 500, // canonical 535 → delta 35
                        }),
                        mkInv('u2', {
                            serviceType: 'PHASE_2_PLATFORM_FEE',
                            status: 'paid', vat: 175, totalAmount: 2500, // canonical 2675 → delta 175
                        }),
                    ])
                    .mockResolvedValueOnce([]),
            },
        };

        const summary = await runAudit({
            client, batchSize: 100, maxRows: Infinity,
            logger: { log: () => {} },
        });

        expect(summary.byCategory.PLATFORM_PAID_UNDERBILLED_PRE_TIER_8.count).toBe(2);
        expect(summary.byCategory.PLATFORM_PAID_UNDERBILLED_PRE_TIER_8.totalDelta).toBe(35 + 175);
    });

    it('captures up to 25 samples per anomaly category for Finance review', async () => {
        const underbilledRows = Array.from({ length: 30 }, (_, i) =>
            mkInv(`under-${i}`, {
                status: 'paid', vat: 35, totalAmount: 500,
            }),
        );
        const client = {
            invoice: {
                findMany: jest.fn()
                    .mockResolvedValueOnce(underbilledRows)
                    .mockResolvedValueOnce([]),
            },
        };

        const summary = await runAudit({
            client, batchSize: 100, maxRows: Infinity,
            logger: { log: () => {} },
        });

        expect(summary.byCategory.PLATFORM_PAID_UNDERBILLED_PRE_TIER_8.count).toBe(30);
        // Samples capped at 25
        expect(summary.samples.PLATFORM_PAID_UNDERBILLED_PRE_TIER_8.length).toBe(25);
        // Each sample has the fields Finance needs
        const sample = summary.samples.PLATFORM_PAID_UNDERBILLED_PRE_TIER_8[0];
        expect(sample.invoiceNumber).toBeDefined();
        expect(sample.canonicalTotal).toBe(535);
        expect(sample.delta).toBe(35);
    });

    it('respects --max-rows cap (stops scanning early)', async () => {
        let pos = 0;
        const allRows = Array.from({ length: 100 }, (_, i) => mkInv(`r${i}`));
        const client = {
            invoice: {
                findMany: jest.fn(async (args) => {
                    const slice = allRows.slice(pos, pos + args.take);
                    pos += slice.length;
                    return slice;
                }),
            },
        };

        const summary = await runAudit({
            client, batchSize: 100, maxRows: 5,
            logger: { log: () => {} },
        });

        expect(summary.rowsScanned).toBe(5);
    });

    it('filter applies to PLATFORM + STATE service types only', async () => {
        const client = {
            invoice: {
                findMany: jest.fn().mockResolvedValueOnce([]),
            },
        };

        await runAudit({
            client, batchSize: 100, maxRows: Infinity,
            logger: { log: () => {} },
        });

        const where = client.invoice.findMany.mock.calls[0][0].where;
        expect(where.serviceType.in).toEqual(expect.arrayContaining([
            'PHASE_1_STATE_FEE', 'PHASE_1_PLATFORM_FEE',
            'PHASE_2_STATE_FEE', 'PHASE_2_PLATFORM_FEE',
        ]));
        expect(where.isDeleted).toBe(false);
    });
});
