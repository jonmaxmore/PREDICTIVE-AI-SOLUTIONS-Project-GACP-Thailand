/**
 * Tests for trial-balance-service.js (B19-B, 2026-05-16).
 *
 * Verifies the TFRS for NPAEs ch.5 (Accounting Cycle) trial-balance
 * invariant: sum of debit columns MUST equal sum of credit columns.
 * Anchored on the journal-line schema (JournalLine.debit/credit
 * Decimal(15,2)) emitted by services/journal-entry-service.js.
 *
 * Anti-regression rules:
 *   - 9xxx suspense accounts MUST be excluded (DTAM state revenue
 *     is OFF the platform's books per the B16-C collection-agent
 *     model — owner-confirmed 2026-05-16).
 *   - Unbalanced inputs MUST surface `balanced: false` plus a
 *     `discrepancy` value, not silently pass.
 */

'use strict';

const createPrismaMock = () => ({
    journalLine: { findMany: jest.fn() },
    journalEntry: { findMany: jest.fn() },
});

function loadServiceWithMocks(prismaMock) {
    jest.doMock('../../services/prisma-database', () => ({ prisma: prismaMock }));
    return require('../../services/trial-balance-service');
}

describe('[B19-B] trial-balance-service — pure aggregator', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('empty journal-line list → empty rows, balanced=true (vacuously)', () => {
        const { aggregateLines } = require('../../services/trial-balance-service');
        const result = aggregateLines([]);
        expect(result.rows).toEqual([]);
        expect(result.totalDebit).toBe(0);
        expect(result.totalCredit).toBe(0);
        expect(result.balanced).toBe(true);
    });

    test('classifies account types by first digit (TFRS for NPAEs ch. 2)', () => {
        const { getAccountType } = require('../../services/trial-balance-service');
        expect(getAccountType('1110-001')).toBe('ASSET');
        expect(getAccountType('2151-001')).toBe('LIABILITY');
        expect(getAccountType('3110-001')).toBe('EQUITY');
        expect(getAccountType('4110-001')).toBe('REVENUE');
        expect(getAccountType('5210-001')).toBe('EXPENSE');
        expect(getAccountType('9999-001')).toBe('SUSPENSE');
        expect(getAccountType('xyz')).toBe('UNKNOWN');
    });

    test('one PLATFORM payment (535 cash → 500 revenue + 35 output VAT) balances', () => {
        const { aggregateLines } = require('../../services/trial-balance-service');
        const lines = [
            // Dr Cash 535
            { accountCode: '1110-001', accountName: 'เงินสด', debit: 535, credit: 0 },
            // Cr Revenue 500
            { accountCode: '4110-001', accountName: 'รายได้ค่าบริการ', debit: 0, credit: 500 },
            // Cr Output VAT 35
            { accountCode: '2131-001', accountName: 'ภาษีขาย', debit: 0, credit: 35 },
        ];
        const result = aggregateLines(lines);
        expect(result.rows).toHaveLength(3);
        expect(result.totalDebit).toBe(535);
        expect(result.totalCredit).toBe(535);
        expect(result.balanced).toBe(true);

        // Display: assets/expenses go on debit side; liab/equity/revenue on credit side.
        const cash = result.rows.find((r) => r.accountCode === '1110-001');
        expect(cash.debit).toBe(535);
        expect(cash.credit).toBe(0);
        expect(cash.balance).toBe(535);

        const revenue = result.rows.find((r) => r.accountCode === '4110-001');
        expect(revenue.debit).toBe(0);
        expect(revenue.credit).toBe(500);
        expect(revenue.balance).toBe(500);

        const vat = result.rows.find((r) => r.accountCode === '2131-001');
        expect(vat.credit).toBe(35);
    });

    test('multiple payments aggregated correctly into one row per account', () => {
        const { aggregateLines } = require('../../services/trial-balance-service');
        const lines = [
            // Payment 1
            { accountCode: '1110-001', accountName: 'เงินสด', debit: 535, credit: 0 },
            { accountCode: '4110-001', accountName: 'รายได้', debit: 0, credit: 500 },
            { accountCode: '2131-001', accountName: 'ภาษีขาย', debit: 0, credit: 35 },
            // Payment 2
            { accountCode: '1110-001', accountName: 'เงินสด', debit: 2675, credit: 0 },
            { accountCode: '4110-001', accountName: 'รายได้', debit: 0, credit: 2500 },
            { accountCode: '2131-001', accountName: 'ภาษีขาย', debit: 0, credit: 175 },
        ];
        const result = aggregateLines(lines);
        // 3 distinct accounts → 3 rows
        expect(result.rows).toHaveLength(3);

        const cash = result.rows.find((r) => r.accountCode === '1110-001');
        expect(cash.debit).toBe(3210);
        const revenue = result.rows.find((r) => r.accountCode === '4110-001');
        expect(revenue.credit).toBe(3000);
        const vat = result.rows.find((r) => r.accountCode === '2131-001');
        expect(vat.credit).toBe(210);

        expect(result.totalDebit).toBe(3210);
        expect(result.totalCredit).toBe(3210);
        expect(result.balanced).toBe(true);
    });

    test('9xxx SUSPENSE rows are excluded (DTAM state revenue off-platform)', () => {
        const { aggregateLines } = require('../../services/trial-balance-service');
        const lines = [
            { accountCode: '1110-001', accountName: 'เงินสด', debit: 535, credit: 0 },
            { accountCode: '4110-001', accountName: 'รายได้', debit: 0, credit: 500 },
            { accountCode: '2131-001', accountName: 'ภาษีขาย', debit: 0, credit: 35 },
            // DTAM state-fee suspense — must NOT appear in the trial balance
            { accountCode: '9999-DTAM', accountName: 'STATE_FEE_SUSPENSE', debit: 5000, credit: 0 },
            { accountCode: '9999-DTAM', accountName: 'STATE_FEE_SUSPENSE', debit: 0, credit: 5000 },
        ];
        const result = aggregateLines(lines);
        expect(result.rows.find((r) => r.accountCode.startsWith('9'))).toBeUndefined();
        // Total includes only the platform rows; 9xxx is filtered out.
        expect(result.totalDebit).toBe(535);
        expect(result.totalCredit).toBe(535);
    });

    test('discrepancy detection: unbalanced input → balanced=false', () => {
        const { aggregateLines } = require('../../services/trial-balance-service');
        const lines = [
            { accountCode: '1110-001', accountName: 'เงินสด', debit: 100, credit: 0 },
            // Missing matching credit — books torn
            { accountCode: '4110-001', accountName: 'รายได้', debit: 0, credit: 80 },
        ];
        const result = aggregateLines(lines);
        expect(result.balanced).toBe(false);
        expect(result.totalDebit).toBe(100);
        expect(result.totalCredit).toBe(80);
    });

    test('zero-balance rows excluded by default; included when flag set', () => {
        const { aggregateLines } = require('../../services/trial-balance-service');
        const lines = [
            // Account that nets to zero
            { accountCode: '1110-001', accountName: 'เงินสด', debit: 100, credit: 100 },
            { accountCode: '4110-001', accountName: 'รายได้', debit: 50, credit: 50 },
        ];
        const def = aggregateLines(lines);
        expect(def.rows).toHaveLength(0);
        const incl = aggregateLines(lines, { includeZeroBalances: true });
        expect(incl.rows.length).toBeGreaterThan(0);
    });

    test('rows sorted by accountCode (1xxx → 2xxx → 4xxx)', () => {
        const { aggregateLines } = require('../../services/trial-balance-service');
        const lines = [
            { accountCode: '4110-001', accountName: 'รายได้', debit: 0, credit: 500 },
            { accountCode: '1110-001', accountName: 'เงินสด', debit: 535, credit: 0 },
            { accountCode: '2131-001', accountName: 'ภาษีขาย', debit: 0, credit: 35 },
        ];
        const result = aggregateLines(lines);
        expect(result.rows[0].accountCode).toBe('1110-001');
        expect(result.rows[1].accountCode).toBe('2131-001');
        expect(result.rows[2].accountCode).toBe('4110-001');
    });
});

describe('[B19-B] trial-balance-service — generateTrialBalance', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('rejects when asOfDate is missing', async () => {
        const prismaMock = createPrismaMock();
        const service = loadServiceWithMocks(prismaMock);
        await expect(service.generateTrialBalance({})).rejects.toThrow(/asOfDate is required/);
    });

    test('rejects garbage asOfDate', async () => {
        const prismaMock = createPrismaMock();
        const service = loadServiceWithMocks(prismaMock);
        await expect(service.generateTrialBalance({ asOfDate: 'not-a-date' }))
            .rejects.toThrow(/invalid asOfDate/);
    });

    test('returns empty rows when no entries exist', async () => {
        const prismaMock = createPrismaMock();
        prismaMock.journalEntry.findMany.mockResolvedValue([]);
        const service = loadServiceWithMocks(prismaMock);
        const report = await service.generateTrialBalance({
            asOfDate: '2026-05-31',
            organizationId: 'org-1',
        });
        expect(report.rows).toEqual([]);
        expect(report.balanced).toBe(true);
        expect(report.totalDebit).toBe(0);
        expect(report.totalCredit).toBe(0);
        expect(report.warnings).toEqual([]);
    });

    test('aggregates entries through Prisma, balanced=true', async () => {
        const prismaMock = createPrismaMock();
        prismaMock.journalEntry.findMany.mockResolvedValue([
            {
                id: 'e1',
                entryDate: new Date('2026-05-01T00:00:00Z'),
                lines: [
                    { accountCode: '1110-001', accountName: 'เงินสด', debit: 535, credit: 0 },
                    { accountCode: '4110-001', accountName: 'รายได้', debit: 0, credit: 500 },
                    { accountCode: '2131-001', accountName: 'ภาษีขาย', debit: 0, credit: 35 },
                ],
            },
        ]);
        const service = loadServiceWithMocks(prismaMock);
        const report = await service.generateTrialBalance({
            asOfDate: '2026-05-31',
            organizationId: 'org-1',
        });
        expect(report.balanced).toBe(true);
        expect(report.totalDebit).toBe(535);
        expect(report.totalCredit).toBe(535);
        expect(report.rows).toHaveLength(3);
        expect(report.organizationId).toBe('org-1');
    });

    test('flags unbalanced entries with discrepancy + warning', async () => {
        const prismaMock = createPrismaMock();
        prismaMock.journalEntry.findMany.mockResolvedValue([
            {
                id: 'e1',
                entryDate: new Date('2026-05-01T00:00:00Z'),
                lines: [
                    { accountCode: '1110-001', accountName: 'เงินสด', debit: 100, credit: 0 },
                    { accountCode: '4110-001', accountName: 'รายได้', debit: 0, credit: 80 },
                ],
            },
        ]);
        const service = loadServiceWithMocks(prismaMock);
        const report = await service.generateTrialBalance({
            asOfDate: '2026-05-31',
            organizationId: 'org-1',
        });
        expect(report.balanced).toBe(false);
        expect(report.discrepancy).toBe(20);
        expect(report.warnings).toHaveLength(1);
        expect(report.warnings[0]).toMatch(/UNBALANCED/);
        expect(report.warnings[0]).toMatch(/TFRS for NPAEs/);
    });

    test('CSV export includes BOM + totals row', async () => {
        const prismaMock = createPrismaMock();
        prismaMock.journalEntry.findMany.mockResolvedValue([
            {
                id: 'e1',
                entryDate: new Date('2026-05-01T00:00:00Z'),
                lines: [
                    { accountCode: '1110-001', accountName: 'เงินสด', debit: 535, credit: 0 },
                    { accountCode: '4110-001', accountName: 'รายได้', debit: 0, credit: 500 },
                    { accountCode: '2131-001', accountName: 'ภาษีขาย', debit: 0, credit: 35 },
                ],
            },
        ]);
        const service = loadServiceWithMocks(prismaMock);
        const csv = await service.generateTrialBalanceCSV({
            asOfDate: '2026-05-31',
            organizationId: 'org-1',
        });
        // BOM for Excel-Windows UTF-8 detection
        expect(csv.charCodeAt(0)).toBe(0xFEFF);
        expect(csv).toMatch(/Account Code/);
        expect(csv).toMatch(/TOTAL/);
        expect(csv).toMatch(/1110-001/);
        expect(csv).toMatch(/535\.00/);
    });

    test('CSV escapes commas and quotes per RFC 4180', () => {
        const { csvField } = require('../../services/trial-balance-service');
        expect(csvField('plain')).toBe('plain');
        expect(csvField('with,comma')).toBe('"with,comma"');
        expect(csvField('with"quote')).toBe('"with""quote"');
        expect(csvField('')).toBe('');
        expect(csvField(null)).toBe('');
    });
});
