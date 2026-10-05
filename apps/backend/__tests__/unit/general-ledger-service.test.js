/**
 * Tests for general-ledger-service.js (B19-B, 2026-05-16).
 *
 * Verifies the TFRS for NPAEs ch.5 (Accounting Cycle) drill-down per
 * account — สมุดบัญชีแยกประเภท. The auditor uses this to reconcile a
 * trial-balance figure back to the journal entries that built it.
 *
 * Anti-regression rules:
 *   - Period lines MUST be returned in chronological order so an
 *     auditor can follow the running balance.
 *   - Running balance MUST accumulate per-line using the natural sign
 *     of the account (debit-natural for 1xxx/5xxx, credit-natural for
 *     2xxx/3xxx/4xxx).
 *   - The opening balance MUST equal the closing balance MINUS the
 *     period net (or equivalently, the closing balance equals opening
 *     + period net). This is the running-balance closure invariant.
 */

'use strict';

const createPrismaMock = () => ({
    journalEntry: { findMany: jest.fn() },
});

function loadServiceWithMocks(prismaMock) {
    jest.doMock('../../services/prisma-database', () => ({ prisma: prismaMock }));
    return require('../../services/general-ledger-service');
}

describe('[B19-B] general-ledger-service — pure helpers', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('computeOpeningBalance: debit-natural account (1xxx) → debit - credit', () => {
        const { computeOpeningBalance } = require('../../services/general-ledger-service');
        const lines = [
            { debit: 100, credit: 0 },
            { debit: 200, credit: 50 },
        ];
        expect(computeOpeningBalance({ accountCode: '1110-001', lines })).toBe(250);
    });

    test('computeOpeningBalance: credit-natural account (4xxx) → credit - debit', () => {
        const { computeOpeningBalance } = require('../../services/general-ledger-service');
        const lines = [
            { debit: 0, credit: 500 },
            { debit: 0, credit: 200 },
        ];
        expect(computeOpeningBalance({ accountCode: '4110-001', lines })).toBe(700);
    });

    test('applyLine: debit-natural balance += debit - credit', () => {
        const { applyLine } = require('../../services/general-ledger-service');
        const next = applyLine({
            accountCode: '1110-001',
            runningBalance: 100,
            debit: 50,
            credit: 0,
        });
        expect(next).toBe(150);
    });

    test('applyLine: credit-natural balance += credit - debit', () => {
        const { applyLine } = require('../../services/general-ledger-service');
        const next = applyLine({
            accountCode: '4110-001',
            runningBalance: 100,
            debit: 0,
            credit: 50,
        });
        expect(next).toBe(150);
    });
});

describe('[B19-B] general-ledger-service — queryGeneralLedger', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('rejects when accountCode is missing', async () => {
        const prismaMock = createPrismaMock();
        const service = loadServiceWithMocks(prismaMock);
        await expect(service.queryGeneralLedger({})).rejects.toThrow(/accountCode is required/);
    });

    test('rejects when startDate > endDate', async () => {
        const prismaMock = createPrismaMock();
        const service = loadServiceWithMocks(prismaMock);
        await expect(service.queryGeneralLedger({
            accountCode: '4110-001',
            startDate: '2026-05-31',
            endDate: '2026-05-01',
        })).rejects.toThrow(/startDate must be on or before endDate/);
    });

    test('returns chronological lines for an account', async () => {
        const prismaMock = createPrismaMock();
        // findMany returns entries — first call is the "prior" (opening
        // balance) lookup, second is the period lookup. We mock both.
        prismaMock.journalEntry.findMany
            .mockResolvedValueOnce([]) // no prior period entries
            .mockResolvedValueOnce([
                {
                    id: 'e1',
                    entryDate: new Date('2026-05-05T00:00:00Z'),
                    reference: 'INV-001',
                    description: 'Payment 1',
                    invoiceId: 'inv-1',
                    organizationId: 'org-1',
                    lines: [
                        {
                            lineNumber: 1,
                            accountCode: '4110-001',
                            accountName: 'รายได้ค่าบริการ',
                            debit: 0,
                            credit: 500,
                            issuer: 'PLATFORM',
                        },
                    ],
                },
                {
                    id: 'e2',
                    entryDate: new Date('2026-05-10T00:00:00Z'),
                    reference: 'INV-002',
                    description: 'Payment 2',
                    invoiceId: 'inv-2',
                    organizationId: 'org-1',
                    lines: [
                        {
                            lineNumber: 2,
                            accountCode: '4110-001',
                            accountName: 'รายได้ค่าบริการ',
                            debit: 0,
                            credit: 2500,
                            issuer: 'PLATFORM',
                        },
                    ],
                },
            ]);
        const service = loadServiceWithMocks(prismaMock);
        const report = await service.queryGeneralLedger({
            accountCode: '4110-001',
            startDate: '2026-05-01',
            endDate: '2026-05-31',
            organizationId: 'org-1',
        });
        expect(report.accountCode).toBe('4110-001');
        expect(report.accountName).toBe('รายได้ค่าบริการ');
        expect(report.lines).toHaveLength(2);
        // Chronological order
        expect(report.lines[0].reference).toBe('INV-001');
        expect(report.lines[1].reference).toBe('INV-002');
        // Running balance accumulates correctly (credit-natural 4xxx)
        expect(report.openingBalance).toBe(0);
        expect(report.lines[0].runningBalance).toBe(500);
        expect(report.lines[1].runningBalance).toBe(3000);
        expect(report.closingBalance).toBe(3000);
        expect(report.totalDebit).toBe(0);
        expect(report.totalCredit).toBe(3000);
    });

    test('opening balance from prior period rolls into running balance', async () => {
        const prismaMock = createPrismaMock();
        prismaMock.journalEntry.findMany
            // PRIOR period: one entry on 2026-04-15 with credit 1000.
            .mockResolvedValueOnce([
                {
                    id: 'e0',
                    entryDate: new Date('2026-04-15T00:00:00Z'),
                    lines: [
                        { accountCode: '4110-001', debit: 0, credit: 1000 },
                    ],
                },
            ])
            // CURRENT period: one entry on 2026-05-05 with credit 500.
            .mockResolvedValueOnce([
                {
                    id: 'e1',
                    entryDate: new Date('2026-05-05T00:00:00Z'),
                    reference: 'INV-003',
                    description: 'Payment',
                    invoiceId: 'inv-3',
                    organizationId: 'org-1',
                    lines: [
                        {
                            lineNumber: 1,
                            accountCode: '4110-001',
                            accountName: 'รายได้',
                            debit: 0,
                            credit: 500,
                        },
                    ],
                },
            ]);
        const service = loadServiceWithMocks(prismaMock);
        const report = await service.queryGeneralLedger({
            accountCode: '4110-001',
            startDate: '2026-05-01',
            endDate: '2026-05-31',
            organizationId: 'org-1',
        });
        // Opening balance = prior period net = +1000 (credit-natural)
        expect(report.openingBalance).toBe(1000);
        // First period line takes the opening + line credit = 1500
        expect(report.lines[0].runningBalance).toBe(1500);
        expect(report.closingBalance).toBe(1500);
    });

    test('date range filter: omitting startDate skips opening-balance lookup', async () => {
        const prismaMock = createPrismaMock();
        // Only one findMany call expected (no prior-period lookup).
        prismaMock.journalEntry.findMany.mockResolvedValueOnce([
            {
                id: 'e1',
                entryDate: new Date('2026-05-05T00:00:00Z'),
                reference: 'INV-001',
                description: 'P',
                invoiceId: 'inv-1',
                organizationId: 'org-1',
                lines: [
                    { lineNumber: 1, accountCode: '4110-001', accountName: 'รายได้', debit: 0, credit: 500 },
                ],
            },
        ]);
        const service = loadServiceWithMocks(prismaMock);
        const report = await service.queryGeneralLedger({
            accountCode: '4110-001',
            endDate: '2026-05-31',
            organizationId: 'org-1',
        });
        expect(report.openingBalance).toBe(0);
        expect(report.lines).toHaveLength(1);
        // The "opening" findMany should NOT have been called (only the period one).
        expect(prismaMock.journalEntry.findMany).toHaveBeenCalledTimes(1);
    });

    test('pagination: limit + offset slice + hasMore flag', async () => {
        const prismaMock = createPrismaMock();
        const periodLines = [];
        // 5 entries, each with one matching line.
        for (let i = 0; i < 5; i += 1) {
            periodLines.push({
                id: `e${i}`,
                entryDate: new Date(`2026-05-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
                reference: `INV-${i}`,
                description: 'Payment',
                invoiceId: `inv-${i}`,
                organizationId: 'org-1',
                lines: [
                    {
                        lineNumber: 1,
                        accountCode: '4110-001',
                        accountName: 'รายได้',
                        debit: 0,
                        credit: 100,
                    },
                ],
            });
        }
        prismaMock.journalEntry.findMany
            .mockResolvedValueOnce([]) // prior
            .mockResolvedValueOnce(periodLines);
        const service = loadServiceWithMocks(prismaMock);
        const report = await service.queryGeneralLedger({
            accountCode: '4110-001',
            startDate: '2026-05-01',
            endDate: '2026-05-31',
            organizationId: 'org-1',
            limit: 2,
            offset: 0,
        });
        expect(report.lines).toHaveLength(2);
        expect(report.pagination.returned).toBe(2);
        expect(report.pagination.hasMore).toBe(true);
        expect(report.pagination.totalRows).toBe(5);
        // Closing balance includes ALL 5 rows (500), not just the page.
        expect(report.closingBalance).toBe(500);
    });

    test('debit-natural account 1xxx: running balance increases with debits', async () => {
        const prismaMock = createPrismaMock();
        prismaMock.journalEntry.findMany
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
                {
                    id: 'e1',
                    entryDate: new Date('2026-05-05T00:00:00Z'),
                    reference: 'INV-001',
                    description: 'Cash in',
                    invoiceId: 'inv-1',
                    organizationId: 'org-1',
                    lines: [
                        { lineNumber: 1, accountCode: '1110-001', accountName: 'เงินสด', debit: 535, credit: 0 },
                    ],
                },
                {
                    id: 'e2',
                    entryDate: new Date('2026-05-10T00:00:00Z'),
                    reference: 'EXP-001',
                    description: 'Expense paid in cash',
                    invoiceId: null,
                    organizationId: 'org-1',
                    lines: [
                        { lineNumber: 2, accountCode: '1110-001', accountName: 'เงินสด', debit: 0, credit: 200 },
                    ],
                },
            ]);
        const service = loadServiceWithMocks(prismaMock);
        const report = await service.queryGeneralLedger({
            accountCode: '1110-001',
            startDate: '2026-05-01',
            endDate: '2026-05-31',
            organizationId: 'org-1',
        });
        // Debit-natural: 0 + 535 - 200 = 335
        expect(report.lines[0].runningBalance).toBe(535);
        expect(report.lines[1].runningBalance).toBe(335);
        expect(report.closingBalance).toBe(335);
        expect(report.totalDebit).toBe(535);
        expect(report.totalCredit).toBe(200);
    });

    test('returns empty result when Prisma is unavailable (CI bootstrap)', async () => {
        // Use a mock that fails the typeof check so resolvePrisma returns null
        jest.doMock('../../services/prisma-database', () => ({ prisma: null }));
        const service = require('../../services/general-ledger-service');
        const report = await service.queryGeneralLedger({
            accountCode: '4110-001',
            startDate: '2026-05-01',
            endDate: '2026-05-31',
            organizationId: 'org-1',
        });
        expect(report.lines).toEqual([]);
        expect(report.openingBalance).toBe(0);
        expect(report.closingBalance).toBe(0);
    });
});
