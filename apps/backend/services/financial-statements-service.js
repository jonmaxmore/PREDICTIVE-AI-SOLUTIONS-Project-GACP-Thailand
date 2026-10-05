/**
 * Financial Statements Service — งบกำไรขาดทุน + งบแสดงฐานะการเงิน.
 *
 * Generates the two primary statements that follow the trial balance
 * in the Thai accounting cycle (TFRS for NPAEs ch. 5):
 *
 *   1. Profit & Loss (งบกำไรขาดทุน) — revenue minus expenses for a period.
 *      Reference: TFRS for NPAEs ch. 18 (รายได้) + ch. 19 (ค่าใช้จ่าย).
 *      The P&L is a PERIOD statement (startDate → endDate), unlike the
 *      Balance Sheet which is a POINT-IN-TIME statement (asOfDate).
 *
 *   2. Balance Sheet (งบแสดงฐานะการเงิน) — assets, liabilities, equity
 *      at a date. Reference: TFRS for NPAEs ch. 6 (รายงานทางการเงิน) +
 *      TAS 1 (Presentation of Financial Statements).
 *      The accounting equation must hold:
 *        Assets = Liabilities + Equity (including current-period net profit)
 *      Net profit is computed up to asOfDate and rolled into equity as
 *      retained earnings — this is how the BS "closes" the books even
 *      without an explicit year-end closing entry.
 *
 * Boundary discipline:
 *   - Reads ONLY from JournalEntry + JournalLine.
 *   - Excludes 9xxx suspense accounts (DTAM state revenue is OFF the
 *     platform's books per the collection-agent model — owner-confirmed
 *     2026-05-16, see journal-entry-service.js header).
 *   - Excludes soft-deleted JournalEntry rows (TFRS for NPAEs requires
 *     reversing entries, not deletes; isDeleted=true means the row was
 *     orphaned and should not be reported).
 *
 * @module services/financial-statements-service
 */

'use strict';

const logger = require('../shared/logger');
const { parseLocalIsoDate, startOfLocalCalendarDay } = require('../utils/working-days');
const {
    generateTrialBalance,
    aggregateLines,
    getAccountType,
    round2,
    parseAsOfDate,
} = require('./trial-balance-service');

let prismaModule;
try {
    prismaModule = require('./prisma-database');
} catch (_e) {
    prismaModule = { prisma: null };
}

function resolvePrisma() {
    const client = prismaModule && prismaModule.prisma;
    if (!client) {
        return null;
    }
    const entryDelegate = client.journalEntry;
    if (!entryDelegate
        || typeof entryDelegate !== 'object'
        || typeof entryDelegate.findMany !== 'function') {
        return null;
    }
    return client;
}

/**
 * Parse a date input into the start of that Bangkok day (for `gte` bounds).
 * Throws VALIDATION_ERROR on garbage.
 */
function parseStartDate(value) {
    if (!value) {
        return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw Object.assign(new Error(`invalid date: ${value}`), { code: 'VALIDATION_ERROR' });
    }
    // A bare "YYYY-MM-DD" is a Bangkok day: it starts at 00:00 in Bangkok.
    const day = parseLocalIsoDate(value);
    if (day) {
        return startOfLocalCalendarDay(day.year, day.month, day.day);
    }
    return date;
}

async function fetchEntriesInRange({ startDate, endDate, organizationId }) {
    const prisma = resolvePrisma();
    if (!prisma) {
        return [];
    }
    const where = { isDeleted: false };
    if (startDate || endDate) {
        where.entryDate = {};
        if (startDate) {where.entryDate.gte = startDate;}
        if (endDate) {where.entryDate.lte = endDate;}
    }
    if (organizationId) {
        where.organizationId = organizationId;
    }
    const entries = await prisma.journalEntry.findMany({
        where,
        include: { lines: true },
        orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
    });
    return entries;
}

// ──────────────────────────────────────────────────────────────────────────
// Profit & Loss (งบกำไรขาดทุน)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Generate the P&L statement for a period.
 *
 *   Revenue (4xxx) — credit balances aggregated → revenue.lines
 *   Expense (5xxx) — debit  balances aggregated → expense.lines
 *   Net Profit     — revenue.total - expense.total
 *
 * Per TFRS for NPAEs ch. 18:
 *   - Revenue is recognised at the point of sale (invoice → paid → journal).
 *   - 9xxx suspense rows are NOT revenue — they are DTAM state-fee
 *     proxies that never flow through the platform's books.
 *
 * @param {object} args
 * @param {string|Date} args.startDate
 * @param {string|Date} args.endDate
 * @param {string} [args.organizationId]
 * @returns {Promise<{
 *   period: { startDate, endDate },
 *   organizationId: string|null,
 *   revenue: { lines, total },
 *   expense: { lines, total },
 *   netProfit: number,
 *   warnings: string[]
 * }>}
 */
async function generateProfitAndLoss({ startDate, endDate, organizationId = null } = {}) {
    if (!startDate || !endDate) {
        throw Object.assign(
            new Error('startDate and endDate are required for P&L'),
            { code: 'VALIDATION_ERROR' },
        );
    }
    const from = parseStartDate(startDate);
    const to = parseAsOfDate(endDate);
    if (from && to && from.getTime() > to.getTime()) {
        throw Object.assign(
            new Error('startDate must be on or before endDate'),
            { code: 'VALIDATION_ERROR' },
        );
    }

    const entries = await fetchEntriesInRange({ startDate: from, endDate: to, organizationId });
    const lines = entries.flatMap((e) => e.lines || []);

    // Group revenue (4xxx) and expense (5xxx) lines using the
    // shared aggregator from trial-balance-service.
    const { rows } = aggregateLines(lines, { includeZeroBalances: false });

    const revenueLines = [];
    const expenseLines = [];
    for (const row of rows) {
        const type = getAccountType(row.accountCode);
        if (type === 'REVENUE') {
            // Revenue accounts are credit-natural: balance > 0 means a
            // credit balance (real revenue). For the P&L we surface the
            // positive amount.
            const amount = round2(row.balance);
            if (amount === 0) {continue;}
            revenueLines.push({
                accountCode: row.accountCode,
                accountName: row.accountName,
                amount,
            });
        } else if (type === 'EXPENSE') {
            const amount = round2(row.balance);
            if (amount === 0) {continue;}
            expenseLines.push({
                accountCode: row.accountCode,
                accountName: row.accountName,
                amount,
            });
        }
        // 9xxx SUSPENSE already excluded by aggregateLines; 1xxx/2xxx/
        // 3xxx are balance-sheet accounts and don't belong on the P&L.
    }

    const revenueTotal = round2(revenueLines.reduce((s, l) => s + l.amount, 0));
    const expenseTotal = round2(expenseLines.reduce((s, l) => s + l.amount, 0));
    const netProfit = round2(revenueTotal - expenseTotal);

    const warnings = [];
    if (entries.length === 0) {
        warnings.push('No journal entries found in the period. The P&L is empty (net profit = 0).');
    }

    return {
        period: {
            startDate: from.toISOString(),
            endDate: to.toISOString(),
        },
        organizationId,
        revenue: { lines: revenueLines, total: revenueTotal },
        expense: { lines: expenseLines, total: expenseTotal },
        netProfit,
        warnings,
    };
}

// ──────────────────────────────────────────────────────────────────────────
// Balance Sheet (งบแสดงฐานะการเงิน)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Generate the Balance Sheet at `asOfDate`.
 *
 * The Balance Sheet displays the accounting equation:
 *
 *   Assets = Liabilities + Equity
 *
 * Where:
 *   - Assets (1xxx)      = sum(debit) - sum(credit)  per account
 *   - Liabilities (2xxx) = sum(credit) - sum(debit)  per account
 *   - Equity (3xxx)      = sum(credit) - sum(debit)  per account
 *                          + Retained Earnings (sum of revenue - expense
 *                          up to asOfDate — TFRS for NPAEs ch. 6)
 *
 * Retained earnings is included because the books are not closed until
 * year-end; the current-period net profit is "running" inside the equity
 * section until a closing entry rolls it into a 3xxx retained-earnings
 * account. TAS 1 §54 + TFRS for NPAEs ch. 6 §6.1.
 *
 * @param {object} args
 * @param {string|Date} args.asOfDate
 * @param {string} [args.organizationId]
 * @returns {Promise<{
 *   asOfDate: string,
 *   organizationId: string|null,
 *   assets: { lines, total },
 *   liabilities: { lines, total },
 *   equity: { lines, total, retainedEarnings },
 *   totalLiabilityEquity: number,
 *   balanced: boolean,
 *   discrepancy: number|null,
 *   warnings: string[]
 * }>}
 */
async function generateBalanceSheet({ asOfDate, organizationId = null } = {}) {
    if (!asOfDate) {
        throw Object.assign(new Error('asOfDate is required for Balance Sheet'), { code: 'VALIDATION_ERROR' });
    }

    // Reuse the trial-balance aggregator — it already excludes 9xxx and
    // groups by accountCode in the natural sign convention.
    const tb = await generateTrialBalance({ asOfDate, organizationId, includeZeroBalances: false });

    const assetLines = [];
    const liabilityLines = [];
    const equityLines = [];
    let revenueTotal = 0;
    let expenseTotal = 0;

    for (const row of tb.rows) {
        switch (row.accountType) {
            case 'ASSET':
                // Asset balance = debit - credit; surface absolute on debit side.
                if (row.balance !== 0) {
                    assetLines.push({
                        accountCode: row.accountCode,
                        accountName: row.accountName,
                        amount: round2(row.balance),
                    });
                }
                break;
            case 'LIABILITY':
                if (row.balance !== 0) {
                    liabilityLines.push({
                        accountCode: row.accountCode,
                        accountName: row.accountName,
                        amount: round2(row.balance),
                    });
                }
                break;
            case 'EQUITY':
                if (row.balance !== 0) {
                    equityLines.push({
                        accountCode: row.accountCode,
                        accountName: row.accountName,
                        amount: round2(row.balance),
                    });
                }
                break;
            case 'REVENUE':
                revenueTotal = round2(revenueTotal + row.balance);
                break;
            case 'EXPENSE':
                expenseTotal = round2(expenseTotal + row.balance);
                break;
            // SUSPENSE already excluded by aggregateLines (9xxx).
            default:
                break;
        }
    }

    const retainedEarnings = round2(revenueTotal - expenseTotal);

    const assetTotal = round2(assetLines.reduce((s, l) => s + l.amount, 0));
    const liabilityTotal = round2(liabilityLines.reduce((s, l) => s + l.amount, 0));
    const equityExplicitTotal = round2(equityLines.reduce((s, l) => s + l.amount, 0));
    const equityTotal = round2(equityExplicitTotal + retainedEarnings);

    const totalLiabilityEquity = round2(liabilityTotal + equityTotal);
    // Accounting equation: Assets = Liabilities + Equity (TFRS for NPAEs
    // ch. 6 §6.1, TAS 1 §54). Tolerate sub-satang FP error.
    const balanced = Math.abs(assetTotal - totalLiabilityEquity) < 0.005;
    const discrepancy = balanced ? null : round2(assetTotal - totalLiabilityEquity);

    const warnings = [];
    if (!balanced) {
        const warning = `Balance Sheet UNBALANCED — Assets ${assetTotal} != Liab+Equity ${totalLiabilityEquity} (diff ${discrepancy}). `
            + 'Per TFRS for NPAEs ch.6 the accounting equation must hold. '
            + 'Inspect the trial balance for torn writes.';
        warnings.push(warning);
        logger.error(`[balance-sheet] ${warning}`, { organizationId, asOfDate });
    }

    return {
        asOfDate: tb.asOfDate,
        organizationId,
        assets: { lines: assetLines, total: assetTotal },
        liabilities: { lines: liabilityLines, total: liabilityTotal },
        equity: {
            lines: equityLines,
            total: equityTotal,
            // Retained earnings shown separately so the auditor sees the
            // P&L roll-up explicitly (TFRS for NPAEs ch. 6 §6.1.2).
            retainedEarnings,
        },
        totalLiabilityEquity,
        balanced,
        discrepancy,
        warnings,
    };
}

module.exports = {
    generateProfitAndLoss,
    generateBalanceSheet,
    // Re-export helpers tests reach for.
    parseStartDate,
};
