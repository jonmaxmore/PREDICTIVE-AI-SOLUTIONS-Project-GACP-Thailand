/**
 * Tests for financial-statements-service.js (B19-B, 2026-05-16).
 *
 * Verifies the two primary TFRS for NPAEs statements:
 *
 *   - Profit & Loss (งบกำไรขาดทุน) — TFRS for NPAEs ch. 18 + ch. 19
 *     Revenue (4xxx) minus Expense (5xxx) over a date range.
 *
 *   - Balance Sheet (งบแสดงฐานะการเงิน) — TFRS for NPAEs ch. 6
 *     Assets (1xxx) = Liabilities (2xxx) + Equity (3xxx)
 *                                          + Retained Earnings (4xxx − 5xxx)
 *
 * Anti-regression rules:
 *   - 9xxx suspense rows MUST be excluded from P&L revenue (collection-
 *     agent model, owner-confirmed 2026-05-16).
 *   - Balance Sheet equation MUST hold for balanced inputs; mocked
 *     unbalanced inputs MUST flag `balanced: false`.
 */

'use strict';

const createPrismaMock = () => ({
    // Both delegates must be present: financial-statements-service relies on
    // trial-balance-service.resolvePrisma() which checks journalLine, while
    // the data-load path goes through journalEntry.findMany. Mocking both
    // makes both services' resolvePrisma() return our mock client.
    journalEntry: { findMany: jest.fn() },
    journalLine: { findMany: jest.fn() },
});

function loadServiceWithMocks(prismaMock) {
    jest.doMock('../../services/prisma-database', () => ({ prisma: prismaMock }));
    return {
        statements: require('../../services/financial-statements-service'),
        trialBalance: require('../../services/trial-balance-service'),
    };
}

describe('[B19-B] financial-statements-service — Profit & Loss', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('rejects when startDate or endDate is missing', async () => {
        const prismaMock = createPrismaMock();
        const { statements } = loadServiceWithMocks(prismaMock);
        await expect(statements.generateProfitAndLoss({}))
            .rejects.toThrow(/startDate and endDate are required/);
        await expect(statements.generateProfitAndLoss({ startDate: '2026-05-01' }))
            .rejects.toThrow(/startDate and endDate are required/);
    });

    test('rejects when startDate > endDate', async () => {
        const prismaMock = createPrismaMock();
        const { statements } = loadServiceWithMocks(prismaMock);
        await expect(statements.generateProfitAndLoss({
            startDate: '2026-05-31',
            endDate: '2026-05-01',
        })).rejects.toThrow(/startDate must be on or before endDate/);
    });

    test('empty period → revenue 0, expense 0, netProfit 0, warning surfaced', async () => {
        const prismaMock = createPrismaMock();
        prismaMock.journalEntry.findMany.mockResolvedValue([]);
        const { statements } = loadServiceWithMocks(prismaMock);
        const report = await statements.generateProfitAndLoss({
            startDate: '2026-05-01',
            endDate: '2026-05-31',
            organizationId: 'org-1',
        });
        expect(report.revenue.total).toBe(0);
        expect(report.expense.total).toBe(0);
        expect(report.netProfit).toBe(0);
        expect(report.warnings).toHaveLength(1);
    });

    test('revenue total + expense total + netProfit', async () => {
        const prismaMock = createPrismaMock();
        prismaMock.journalEntry.findMany.mockResolvedValue([
            {
                id: 'e1',
                entryDate: new Date('2026-05-05T00:00:00Z'),
                lines: [
                    // Dr Cash 535
                    { accountCode: '1110-001', accountName: 'เงินสด', debit: 535, credit: 0 },
                    // Cr Revenue 500
                    { accountCode: '4110-001', accountName: 'รายได้ค่าบริการ', debit: 0, credit: 500 },
                    // Cr Output VAT 35
                    { accountCode: '2131-001', accountName: 'ภาษีขาย', debit: 0, credit: 35 },
                ],
            },
            {
                id: 'e2',
                entryDate: new Date('2026-05-10T00:00:00Z'),
                lines: [
                    // Dr Expense 200 / Cr Cash 200
                    { accountCode: '5210-001', accountName: 'ค่าใช้จ่ายดำเนินงาน', debit: 200, credit: 0 },
                    { accountCode: '1110-001', accountName: 'เงินสด', debit: 0, credit: 200 },
                ],
            },
        ]);
        const { statements } = loadServiceWithMocks(prismaMock);
        const report = await statements.generateProfitAndLoss({
            startDate: '2026-05-01',
            endDate: '2026-05-31',
            organizationId: 'org-1',
        });
        expect(report.revenue.total).toBe(500);
        expect(report.revenue.lines).toHaveLength(1);
        expect(report.revenue.lines[0].accountCode).toBe('4110-001');
        expect(report.revenue.lines[0].amount).toBe(500);
        expect(report.expense.total).toBe(200);
        expect(report.expense.lines).toHaveLength(1);
        expect(report.expense.lines[0].accountCode).toBe('5210-001');
        expect(report.netProfit).toBe(300);
        expect(report.organizationId).toBe('org-1');
    });

    test('9xxx suspense rows excluded from revenue (collection-agent model)', async () => {
        const prismaMock = createPrismaMock();
        prismaMock.journalEntry.findMany.mockResolvedValue([
            {
                id: 'e1',
                entryDate: new Date('2026-05-05T00:00:00Z'),
                lines: [
                    { accountCode: '1110-001', accountName: 'เงินสด', debit: 535, credit: 0 },
                    { accountCode: '4110-001', accountName: 'รายได้', debit: 0, credit: 500 },
                    { accountCode: '2131-001', accountName: 'ภาษีขาย', debit: 0, credit: 35 },
                    // DTAM state-fee suspense — MUST NOT appear in revenue
                    { accountCode: '9999-DTAM', accountName: 'STATE_FEE', debit: 0, credit: 5000 },
                    { accountCode: '9999-DTAM-CASH', accountName: 'STATE_FEE_CASH', debit: 5000, credit: 0 },
                ],
            },
        ]);
        const { statements } = loadServiceWithMocks(prismaMock);
        const report = await statements.generateProfitAndLoss({
            startDate: '2026-05-01',
            endDate: '2026-05-31',
            organizationId: 'org-1',
        });
        // Only platform revenue 500, NOT 5,500
        expect(report.revenue.total).toBe(500);
        expect(report.revenue.lines.find((l) => l.accountCode.startsWith('9'))).toBeUndefined();
    });
});

describe('[B19-B] financial-statements-service — Balance Sheet', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('rejects when asOfDate is missing', async () => {
        const prismaMock = createPrismaMock();
        const { statements } = loadServiceWithMocks(prismaMock);
        await expect(statements.generateBalanceSheet({})).rejects.toThrow(/asOfDate is required/);
    });

    test('balanced books: Assets = Liabilities + Equity (with retained earnings)', async () => {
        const prismaMock = createPrismaMock();
        // After one platform payment 535 = 500 revenue + 35 VAT:
        //   Assets:      Cash 535
        //   Liabilities: VAT  35
        //   Equity:      Retained Earnings 500 (revenue 500 - expense 0)
        // Equation: 535 = 35 + (0 explicit equity + 500 RE) = 535 (balances)
        prismaMock.journalEntry.findMany.mockResolvedValue([
            {
                id: 'e1',
                entryDate: new Date('2026-05-05T00:00:00Z'),
                lines: [
                    { accountCode: '1110-001', accountName: 'เงินสด', debit: 535, credit: 0 },
                    { accountCode: '4110-001', accountName: 'รายได้', debit: 0, credit: 500 },
                    { accountCode: '2131-001', accountName: 'ภาษีขาย', debit: 0, credit: 35 },
                ],
            },
        ]);
        const { statements } = loadServiceWithMocks(prismaMock);
        const report = await statements.generateBalanceSheet({
            asOfDate: '2026-05-31',
            organizationId: 'org-1',
        });
        expect(report.assets.total).toBe(535);
        expect(report.liabilities.total).toBe(35);
        expect(report.equity.retainedEarnings).toBe(500);
        expect(report.equity.total).toBe(500);
        expect(report.totalLiabilityEquity).toBe(535);
        expect(report.balanced).toBe(true);
        expect(report.discrepancy).toBeNull();
    });

    test('mocked retained earnings: revenue + expense net rolls into equity', async () => {
        const prismaMock = createPrismaMock();
        // Revenue 1000, Expense 300, Cash 700, no VAT.
        prismaMock.journalEntry.findMany.mockResolvedValue([
            {
                id: 'e1',
                entryDate: new Date('2026-05-05T00:00:00Z'),
                lines: [
                    { accountCode: '1110-001', accountName: 'เงินสด', debit: 1000, credit: 0 },
                    { accountCode: '4110-001', accountName: 'รายได้', debit: 0, credit: 1000 },
                ],
            },
            {
                id: 'e2',
                entryDate: new Date('2026-05-06T00:00:00Z'),
                lines: [
                    { accountCode: '5210-001', accountName: 'ค่าใช้จ่าย', debit: 300, credit: 0 },
                    { accountCode: '1110-001', accountName: 'เงินสด', debit: 0, credit: 300 },
                ],
            },
        ]);
        const { statements } = loadServiceWithMocks(prismaMock);
        const report = await statements.generateBalanceSheet({
            asOfDate: '2026-05-31',
            organizationId: 'org-1',
        });
        expect(report.assets.total).toBe(700);
        expect(report.equity.retainedEarnings).toBe(700);
        expect(report.totalLiabilityEquity).toBe(700);
        expect(report.balanced).toBe(true);
    });

    test('explicit equity line + retained earnings sum in equity.total', async () => {
        const prismaMock = createPrismaMock();
        // Initial equity contribution 10,000 + revenue 500 - VAT 35 paid out
        // Cash 10,000 + 535 - 35 = 10,500
        // Equity 10,000 + RE 500 = 10,500
        prismaMock.journalEntry.findMany.mockResolvedValue([
            {
                id: 'e1',
                entryDate: new Date('2026-05-01T00:00:00Z'),
                lines: [
                    { accountCode: '1110-001', accountName: 'เงินสด', debit: 10000, credit: 0 },
                    { accountCode: '3110-001', accountName: 'ทุนจดทะเบียน', debit: 0, credit: 10000 },
                ],
            },
            {
                id: 'e2',
                entryDate: new Date('2026-05-05T00:00:00Z'),
                lines: [
                    { accountCode: '1110-001', accountName: 'เงินสด', debit: 535, credit: 0 },
                    { accountCode: '4110-001', accountName: 'รายได้', debit: 0, credit: 500 },
                    { accountCode: '2131-001', accountName: 'ภาษีขาย', debit: 0, credit: 35 },
                ],
            },
        ]);
        const { statements } = loadServiceWithMocks(prismaMock);
        const report = await statements.generateBalanceSheet({
            asOfDate: '2026-05-31',
            organizationId: 'org-1',
        });
        expect(report.assets.total).toBe(10535);
        expect(report.liabilities.total).toBe(35);
        expect(report.equity.lines).toHaveLength(1);
        expect(report.equity.lines[0].accountCode).toBe('3110-001');
        expect(report.equity.retainedEarnings).toBe(500);
        expect(report.equity.total).toBe(10500);
        expect(report.totalLiabilityEquity).toBe(10535);
        expect(report.balanced).toBe(true);
    });

    test('detects unbalanced trial balance and flags Balance Sheet too', async () => {
        const prismaMock = createPrismaMock();
        // Imbalanced entry — Dr 100, Cr 80
        prismaMock.journalEntry.findMany.mockResolvedValue([
            {
                id: 'e1',
                entryDate: new Date('2026-05-05T00:00:00Z'),
                lines: [
                    { accountCode: '1110-001', accountName: 'เงินสด', debit: 100, credit: 0 },
                    { accountCode: '4110-001', accountName: 'รายได้', debit: 0, credit: 80 },
                ],
            },
        ]);
        const { statements } = loadServiceWithMocks(prismaMock);
        const report = await statements.generateBalanceSheet({
            asOfDate: '2026-05-31',
            organizationId: 'org-1',
        });
        expect(report.balanced).toBe(false);
        expect(report.discrepancy).not.toBeNull();
    });
});
