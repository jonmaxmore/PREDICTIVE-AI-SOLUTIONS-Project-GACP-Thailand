/**
 * Tests for receipt-numbering-service.
 *
 * Batch 16-D (2026-05-16). Covers:
 *   1. toThaiNumerals — digit substitution incl. zero + padded zeros + mixed
 *   2. toBuddhistYear / toChristianYear — Date + idempotency for already-BE/CE input
 *   3. formatReceiptNumber — Arabic + Thai-numeral output, padding, edge cases
 *   4. allocateReceiptNumber — DTAM (Thai numerals + BE) and PLATFORM (Arabic + CE)
 *   5. resolveIssuerForServiceType — STATE_FEE → DTAM, PLATFORM_FEE → PLATFORM
 *   6. formatReceiptVariablesForIssuer — full Thai-date string for DTAM
 *   7. Prisma-backed allocator — happy path + concurrent serialisation via mock
 *
 * R5-B (2026-05-17): the in-memory fallback path has been removed from the
 * service. All allocations flow through the Prisma upsert path. The default
 * prisma-database mock therefore provides a working `receiptSequence` delegate
 * that simulates serialisable-transaction semantics via an in-test counter Map.
 * Tests that previously asserted fallback behaviour now assert the canonical
 * Prisma path. A new test exercises 5 concurrent allocations and asserts the
 * resulting sequences are 5 unique sequential integers (no duplicates).
 */

const path = require('path');

// R5-B (2026-05-17): default prisma-database mock simulates a working
// ReceiptSequence delegate with serialisable-transaction semantics. The
// allocator no longer has an in-process fallback — production AND tests both
// require the delegate to be present. Counters live on `globalThis` so the
// jest.mock factory (which is hoisted and cannot close over module-scope
// bindings) can still reach them, and so multiple `loadService()` calls share
// state inside one describe block. Tests reset the counters in beforeEach.
globalThis.__mockReceiptCounters__ = globalThis.__mockReceiptCounters__ || new Map();
function _resetDefaultCounters() {
    globalThis.__mockReceiptCounters__.clear();
}
jest.mock('../../services/prisma-database', () => {
    const counters = globalThis.__mockReceiptCounters__;
    const prismaMock = {
        $transaction: async (fn) => fn({
            receiptSequence: {
                upsert: async ({ where, create }) => {
                    const key = `${where.prefix_year.prefix}-${where.prefix_year.year}`;
                    const next = (counters.get(key) || 0) + 1;
                    counters.set(key, next);
                    return { counter: next, prefix: create.prefix, year: create.year };
                },
            },
        }),
        receiptSequence: {
            upsert: () => { throw new Error('use $transaction path'); },
            count: async () => counters.size,
        },
    };
    return { prisma: prismaMock };
});

// We dynamically require so each `describe` block can isolate the in-test
// counter Map (it lives in the test-file module scope).
function loadService() {
    delete require.cache[require.resolve(path.join(__dirname, '..', '..', 'services', 'receipt-numbering-service'))];
    return require(path.join(__dirname, '..', '..', 'services', 'receipt-numbering-service'));
}

describe('[B16-D] receipt-numbering-service — toThaiNumerals', () => {
    const svc = loadService();
    const { toThaiNumerals } = svc;

    it('converts digits in a string', () => {
        expect(toThaiNumerals('123')).toBe('๑๒๓');
    });

    it('converts a number argument', () => {
        expect(toThaiNumerals(123)).toBe('๑๒๓');
    });

    it('handles zero', () => {
        expect(toThaiNumerals(0)).toBe('๐');
        expect(toThaiNumerals('0')).toBe('๐');
    });

    it('preserves padding (leading zeros)', () => {
        expect(toThaiNumerals('00001')).toBe('๐๐๐๐๑');
    });

    it('preserves non-digit characters', () => {
        expect(toThaiNumerals('RCP-DTAM-2569-000001'))
            .toBe('RCP-DTAM-๒๕๖๙-๐๐๐๐๐๑');
    });

    it('returns empty string for null/undefined', () => {
        expect(toThaiNumerals(null)).toBe('');
        expect(toThaiNumerals(undefined)).toBe('');
    });

    it('converts the canonical BE year 2569 correctly', () => {
        expect(toThaiNumerals(2569)).toBe('๒๕๖๙');
    });

    it('covers all ten digits', () => {
        expect(toThaiNumerals('0123456789')).toBe('๐๑๒๓๔๕๖๗๘๙');
    });
});

describe('[B16-D] receipt-numbering-service — calendar conversion', () => {
    const { toBuddhistYear, toChristianYear } = loadService();

    it('toBuddhistYear converts a Date to BE', () => {
        expect(toBuddhistYear(new Date('2026-05-16T00:00:00Z'))).toBe(2569);
    });

    it('toBuddhistYear converts a CE year number', () => {
        expect(toBuddhistYear(2026)).toBe(2569);
        expect(toBuddhistYear(2025)).toBe(2568);
    });

    it('toBuddhistYear is idempotent for BE input (no double-add)', () => {
        expect(toBuddhistYear(2569)).toBe(2569);
        expect(toBuddhistYear(2500)).toBe(2500);
    });

    it('toChristianYear is symmetric — accepts BE or CE', () => {
        expect(toChristianYear(2569)).toBe(2026);
        expect(toChristianYear(2026)).toBe(2026);
        expect(toChristianYear(new Date('2026-05-16T00:00:00Z'))).toBe(2026);
    });

    it('throws on invalid input', () => {
        expect(() => toBuddhistYear('abc')).toThrow(TypeError);
        expect(() => toChristianYear({})).toThrow(TypeError);
    });
});

describe('[B16-D] receipt-numbering-service — formatReceiptNumber', () => {
    const { formatReceiptNumber } = loadService();

    it('formats DTAM in Arabic by default', () => {
        expect(formatReceiptNumber('RCP-DTAM', 2569, 1))
            .toBe('RCP-DTAM-2569-000001');
    });

    it('formats DTAM with Thai numerals when requested', () => {
        expect(formatReceiptNumber('RCP-DTAM', 2569, 1, { useThaiNumerals: true }))
            .toBe('RCP-DTAM-๒๕๖๙-๐๐๐๐๐๑');
    });

    it('formats PLATFORM tax invoice (Arabic + CE)', () => {
        expect(formatReceiptNumber('TAX-PRD', 2026, 1))
            .toBe('TAX-PRD-2026-000001');
    });

    it('pads sequence to 6 digits by default', () => {
        expect(formatReceiptNumber('RCP-DTAM', 2569, 42))
            .toBe('RCP-DTAM-2569-000042');
    });

    it('respects custom padding', () => {
        expect(formatReceiptNumber('RCP-DTAM', 2569, 42, { padding: 4 }))
            .toBe('RCP-DTAM-2569-0042');
    });

    it('rejects non-integer sequence', () => {
        expect(() => formatReceiptNumber('RCP-DTAM', 2569, 0)).toThrow(RangeError);
        expect(() => formatReceiptNumber('RCP-DTAM', 2569, -1)).toThrow(RangeError);
        expect(() => formatReceiptNumber('RCP-DTAM', 2569, 1.5)).toThrow(RangeError);
    });

    it('rejects bad prefix/year', () => {
        expect(() => formatReceiptNumber('', 2569, 1)).toThrow(TypeError);
        expect(() => formatReceiptNumber('RCP-DTAM', 'abc', 1)).toThrow(TypeError);
    });

    it('Thai numeral format covers high sequence values', () => {
        expect(formatReceiptNumber('RCP-DTAM', 2569, 123456, { useThaiNumerals: true }))
            .toBe('RCP-DTAM-๒๕๖๙-๑๒๓๔๕๖');
    });
});

describe('[B16-D] receipt-numbering-service — allocateReceiptNumber (Prisma-backed)', () => {
    let svc;

    beforeEach(() => {
        _resetDefaultCounters();
        svc = loadService();
    });

    it('DTAM first allocation in BE 2569 → Thai-numeral format', async () => {
        const result = await svc.allocateReceiptNumber({
            issuer: 'DTAM',
            dateOrYear: new Date('2026-05-16T00:00:00Z'),
        });
        expect(result.number).toBe('RCP-DTAM-๒๕๖๙-๐๐๐๐๐๑');
        expect(result.prefix).toBe('RCP-DTAM');
        expect(result.year).toBe(2569);
        expect(result.sequence).toBe(1);
        expect(result.useThaiNumerals).toBe(true);
    });

    it('DTAM subsequent allocations increment monotonically', async () => {
        const r1 = await svc.allocateReceiptNumber({ issuer: 'DTAM', dateOrYear: new Date('2026-05-16') });
        const r2 = await svc.allocateReceiptNumber({ issuer: 'DTAM', dateOrYear: new Date('2026-05-16') });
        const r3 = await svc.allocateReceiptNumber({ issuer: 'DTAM', dateOrYear: new Date('2026-05-16') });
        expect(r1.sequence).toBe(1);
        expect(r2.sequence).toBe(2);
        expect(r3.sequence).toBe(3);
        expect(r2.number).toBe('RCP-DTAM-๒๕๖๙-๐๐๐๐๐๒');
        expect(r3.number).toBe('RCP-DTAM-๒๕๖๙-๐๐๐๐๐๓');
    });

    it('PLATFORM allocations use Arabic numerals + CE year', async () => {
        const result = await svc.allocateReceiptNumber({
            issuer: 'PLATFORM',
            dateOrYear: new Date('2026-05-16T00:00:00Z'),
        });
        expect(result.number).toBe('TAX-PRD-2026-000001');
        expect(result.useThaiNumerals).toBe(false);
        expect(result.year).toBe(2026);
    });

    it('PLATFORM_RECEIPT uses RCP-PRD prefix + Arabic + CE', async () => {
        const result = await svc.allocateReceiptNumber({
            issuer: 'PLATFORM_RECEIPT',
            dateOrYear: new Date('2026-05-16T00:00:00Z'),
        });
        expect(result.number).toBe('RCP-PRD-2026-000001');
    });

    it('DTAM and PLATFORM counters are independent', async () => {
        const d1 = await svc.allocateReceiptNumber({ issuer: 'DTAM', dateOrYear: new Date('2026-05-16') });
        const p1 = await svc.allocateReceiptNumber({ issuer: 'PLATFORM', dateOrYear: new Date('2026-05-16') });
        const d2 = await svc.allocateReceiptNumber({ issuer: 'DTAM', dateOrYear: new Date('2026-05-16') });
        expect(d1.sequence).toBe(1);
        expect(p1.sequence).toBe(1);  // independent stream
        expect(d2.sequence).toBe(2);
    });

    it('year-boundary creates a fresh counter bucket', async () => {
        const a = await svc.allocateReceiptNumber({ issuer: 'DTAM', dateOrYear: new Date('2025-12-31T00:00:00Z') });
        const b = await svc.allocateReceiptNumber({ issuer: 'DTAM', dateOrYear: new Date('2026-01-01T00:00:00Z') });
        expect(a.year).toBe(2568);
        expect(b.year).toBe(2569);
        expect(a.sequence).toBe(1);
        expect(b.sequence).toBe(1);  // new year, new counter
    });

    it('rejects unknown issuer', async () => {
        await expect(svc.allocateReceiptNumber({ issuer: 'BOGUS' })).rejects.toThrow(TypeError);
    });
});

describe('[B16-D] receipt-numbering-service — resolveIssuerForServiceType', () => {
    const { resolveIssuerForServiceType, ISSUER } = loadService();

    it('routes STATE_FEE → DTAM', () => {
        expect(resolveIssuerForServiceType('PHASE_1_STATE_FEE')).toBe(ISSUER.DTAM);
        expect(resolveIssuerForServiceType('PHASE_2_STATE_FEE')).toBe(ISSUER.DTAM);
    });

    it('routes PLATFORM_FEE → PLATFORM', () => {
        expect(resolveIssuerForServiceType('PHASE_1_PLATFORM_FEE')).toBe(ISSUER.PLATFORM);
        expect(resolveIssuerForServiceType('PHASE_2_PLATFORM_FEE')).toBe(ISSUER.PLATFORM);
    });

    it('routes SUBSCRIPTION_* → PLATFORM', () => {
        expect(resolveIssuerForServiceType('SUBSCRIPTION_PREMIUM_MONTHLY')).toBe(ISSUER.PLATFORM);
        expect(resolveIssuerForServiceType('SUBSCRIPTION_ENTERPRISE_YEARLY')).toBe(ISSUER.PLATFORM);
    });

    it('routes unknown / legacy types to PLATFORM by default', () => {
        expect(resolveIssuerForServiceType('APPLICATION_FEE')).toBe(ISSUER.PLATFORM);
        expect(resolveIssuerForServiceType(null)).toBe(ISSUER.PLATFORM);
        expect(resolveIssuerForServiceType('')).toBe(ISSUER.PLATFORM);
    });
});

describe('[B16-D] receipt-numbering-service — formatReceiptVariablesForIssuer', () => {
    const { formatReceiptVariablesForIssuer, ISSUER } = loadService();

    it('DTAM: Thai numerals on receipt number + full พุทธศักราช date', () => {
        const out = formatReceiptVariablesForIssuer(ISSUER.DTAM, {
            receiptNumber: 'RCP-DTAM-2569-000001',
            issueDate: new Date('2026-05-16T00:00:00Z'),
            amount: 5535,
        });
        expect(out.receiptNumber).toBe('RCP-DTAM-๒๕๖๙-๐๐๐๐๐๑');
        expect(out.issueDate).toBe('๑๖ พฤษภาคม พุทธศักราช ๒๕๖๙');
        expect(out.amountText).toBe('ห้าพันห้าร้อยสามสิบห้าบาทถ้วน');
    });

    it('PLATFORM: Arabic doc number + compact Thai date + Thai amount text', () => {
        const out = formatReceiptVariablesForIssuer(ISSUER.PLATFORM, {
            receiptNumber: 'TAX-PRD-2026-000001',
            issueDate: new Date('2026-05-16T00:00:00Z'),
            amount: 535,
        });
        expect(out.receiptNumber).toBe('TAX-PRD-2026-000001');
        expect(out.issueDate).toBe('16 พฤษภาคม 2569');
        expect(out.amountText).toBe('ห้าร้อยสามสิบห้าบาทถ้วน');
    });

    it('handles missing fields gracefully (null instead of empty strings)', () => {
        const out = formatReceiptVariablesForIssuer(ISSUER.DTAM, {});
        expect(out.receiptNumber).toBeNull();
        expect(out.issueDate).toBeNull();
        expect(out.amountText).toBeNull();
    });

    it('handles fractional amounts (สตางค์)', () => {
        const out = formatReceiptVariablesForIssuer(ISSUER.DTAM, { amount: 5535.50 });
        expect(out.amountText).toBe('ห้าพันห้าร้อยสามสิบห้าบาทห้าสิบสตางค์');
    });
});

describe('[B16-D] receipt-numbering-service — Prisma-backed allocator (injected mock)', () => {
    let svc;

    beforeEach(() => {
        svc = loadService();
    });

    /**
     * Build a Prisma mock that simulates the upsert semantics: each call on a
     * given (prefix, year) bucket returns the next counter. Concurrent calls
     * within the same transaction reuse the same incremented value (the
     * serializable isolation is what makes this safe in real PG).
     */
    function makePrismaMock() {
        const counters = new Map();
        return {
            $transaction: async (fn) => fn({
                receiptSequence: {
                    upsert: async ({ where, create }) => {
                        const key = `${where.prefix_year.prefix}-${where.prefix_year.year}`;
                        const next = (counters.get(key) || 0) + 1;
                        counters.set(key, next);
                        return { counter: next, prefix: create.prefix, year: create.year };
                    },
                },
            }),
            receiptSequence: {
                upsert: () => { throw new Error('use $transaction path'); },
                count: async () => counters.size,
            },
        };
    }

    it('DTAM allocation uses prisma.receiptSequence.upsert when available', async () => {
        const prismaClient = makePrismaMock();
        const r1 = await svc.allocateReceiptNumber({
            issuer: 'DTAM',
            dateOrYear: new Date('2026-05-16'),
            prismaClient,
        });
        expect(r1.number).toBe('RCP-DTAM-๒๕๖๙-๐๐๐๐๐๑');
    });

    it('Prisma path increments through the upsert delegate (sequential calls)', async () => {
        const prismaClient = makePrismaMock();
        for (let i = 1; i <= 3; i++) {
            const r = await svc.allocateReceiptNumber({
                issuer: 'DTAM',
                dateOrYear: new Date('2026-05-16'),
                prismaClient,
            });
            expect(r.sequence).toBe(i);
        }
    });

    it('assertCanonicalAllocator returns ok when receiptSequence is wired', async () => {
        const prismaClient = makePrismaMock();
        const result = await svc.assertCanonicalAllocator(prismaClient);
        expect(result.ok).toBe(true);
    });

    it('assertCanonicalAllocator returns ok:false with reason when missing', async () => {
        const result = await svc.assertCanonicalAllocator({});
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/receiptSequence/);
    });
});

describe('[R5-B] receipt-numbering-service — DB-only allocator (no fallback)', () => {
    let svc;

    beforeEach(() => {
        svc = loadService();
    });

    /**
     * Build a Prisma mock that simulates a serialisable upsert: every concurrent
     * upsert on the same (prefix, year) bucket goes through a Map under an
     * `await new Promise(setImmediate)` interleave hook so we force realistic
     * async ordering. The Map increment is wrapped in a tiny lock so two
     * concurrent calls cannot read+write the same value (this models the
     * `Serializable` isolation level the real Prisma path provides).
     */
    function makeSerialisablePrismaMock() {
        const counters = new Map();
        // Single shared promise chain — every $transaction awaits the previous
        // one before performing its upsert. This is exactly how Serializable
        // isolation makes concurrent writers serialise on the conflicting row.
        let chain = Promise.resolve();
        return {
            $transaction: (fn) => {
                const next = chain.then(async () => {
                    // Yield once so concurrent callers actually interleave at
                    // the JS scheduler level before we reach the increment.
                    await new Promise((resolve) => setImmediate(resolve));
                    return fn({
                        receiptSequence: {
                            upsert: async ({ where, create }) => {
                                const key = `${where.prefix_year.prefix}-${where.prefix_year.year}`;
                                const value = (counters.get(key) || 0) + 1;
                                counters.set(key, value);
                                return { counter: value, prefix: create.prefix, year: create.year };
                            },
                        },
                    });
                });
                chain = next.catch(() => { /* keep chain alive on error */ });
                return next;
            },
            receiptSequence: {
                upsert: () => { throw new Error('use $transaction path'); },
                count: async () => counters.size,
            },
        };
    }

    it('5 concurrent allocations yield 5 unique sequential numbers (no duplicates)', async () => {
        const prismaClient = makeSerialisablePrismaMock();
        const promises = Array.from({ length: 5 }, () => svc.allocateReceiptNumber({
            issuer: 'DTAM',
            dateOrYear: new Date('2026-05-16'),
            prismaClient,
        }));
        const results = await Promise.all(promises);
        const sequences = results.map((r) => r.sequence).sort((a, b) => a - b);
        expect(sequences).toEqual([1, 2, 3, 4, 5]);
        const uniqueNumbers = new Set(results.map((r) => r.number));
        expect(uniqueNumbers.size).toBe(5);
    });

    it('throws RECEIPT_SEQUENCE_DB_UNAVAILABLE when prisma.receiptSequence delegate is missing', async () => {
        await expect(svc.allocateReceiptNumber({
            issuer: 'DTAM',
            dateOrYear: new Date('2026-05-16'),
            prismaClient: { /* no receiptSequence */ },
        })).rejects.toMatchObject({
            code: 'RECEIPT_SEQUENCE_DB_UNAVAILABLE',
        });
    });

    it('throws RECEIPT_SEQUENCE_DB_UNAVAILABLE when the underlying transaction errors', async () => {
        const failingPrisma = {
            $transaction: async () => { throw new Error('connection refused'); },
            receiptSequence: { upsert: () => {}, count: async () => 0 },
        };
        await expect(svc.allocateReceiptNumber({
            issuer: 'PLATFORM',
            dateOrYear: new Date('2026-05-16'),
            prismaClient: failingPrisma,
        })).rejects.toMatchObject({
            code: 'RECEIPT_SEQUENCE_DB_UNAVAILABLE',
        });
    });

    it('does NOT export the legacy _resetFallbackCountersForTest helper', () => {
        expect(svc._resetFallbackCountersForTest).toBeUndefined();
    });
});
