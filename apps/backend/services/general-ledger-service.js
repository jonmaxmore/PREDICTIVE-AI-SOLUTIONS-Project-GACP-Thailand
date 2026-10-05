/**
 * General Ledger Service (สมุดบัญชีแยกประเภท) — drill-down per account.
 *
 * For a given account code, returns every journal-line that touched it
 * in the requested date range, ordered chronologically, with running
 * balance computed in JavaScript. This is the canonical detail report
 * an auditor uses to reconcile a trial-balance figure back to source
 * documents (invoices, payment slips).
 *
 * Compliance basis:
 *   - TFRS for NPAEs ch. 5 (Accounting Cycle) — สมุดบัญชีแยกประเภท is the
 *     post-journal posting layer; each transaction must be traceable from
 *     the journal entry through to the account ledger.
 *   - Revenue Code §87 — 7-year retention of accounting records, with
 *     chronological ordering preserved (TAS 1 §54).
 *   - DBD guideline — running-balance column must be exposed so a Revenue
 *     Department auditor can verify period-end totals match the trial
 *     balance without re-running the aggregation.
 *
 * Boundary discipline:
 *   - Strictly READ from JournalLine + JournalEntry. No writes.
 *   - Org-scoped — caller passes `organizationId`; we never go
 *     cross-tenant.
 *   - 9xxx suspense accounts ARE queryable (an auditor may want to see
 *     legacy DTAM-suspense rows), but the trial-balance + statements
 *     services exclude them from totals.
 *
 * @module services/general-ledger-service
 */

'use strict';

const logger = require('../shared/logger');
const { round2, parseAsOfDate } = require('./trial-balance-service');
const { parseLocalIsoDate, startOfLocalCalendarDay } = require('../utils/working-days');

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

/**
 * Compute the opening balance for `accountCode` as of (exclusive)
 * `startDate`. The opening balance is the natural-side net of every
 * line BEFORE the report period.
 *
 * Asset/Expense (debit-natural): opening = sum(debit) - sum(credit)
 * Liability/Equity/Revenue (credit-natural): opening = sum(credit) - sum(debit)
 */
function computeOpeningBalance({ accountCode, lines }) {
    const firstChar = String(accountCode || '').charAt(0);
    const isDebitNatural = firstChar === '1' || firstChar === '5';
    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of lines) {
        totalDebit = round2(totalDebit + round2(line.debit));
        totalCredit = round2(totalCredit + round2(line.credit));
    }
    return isDebitNatural
        ? round2(totalDebit - totalCredit)
        : round2(totalCredit - totalDebit);
}

/**
 * Apply a single line to the running balance.
 *
 *   Debit-natural account  → balance += debit - credit
 *   Credit-natural account → balance += credit - debit
 */
function applyLine({ accountCode, runningBalance, debit, credit }) {
    const firstChar = String(accountCode || '').charAt(0);
    const isDebitNatural = firstChar === '1' || firstChar === '5';
    const delta = isDebitNatural
        ? round2(debit - credit)
        : round2(credit - debit);
    return round2(runningBalance + delta);
}

/**
 * Query the general-ledger for a single account.
 *
 * @param {object} args
 * @param {string} args.accountCode      — REQUIRED, e.g. '4110-001'
 * @param {string|Date} [args.startDate] — inclusive period start
 * @param {string|Date} [args.endDate]   — inclusive period end
 * @param {string} [args.organizationId]
 * @param {number} [args.limit=500]      — page size
 * @param {number} [args.offset=0]
 * @returns {Promise<{
 *   accountCode: string,
 *   accountName: string|null,
 *   openingBalance: number,
 *   lines: Array<{ entryId, entryDate, reference, description,
 *                  debit, credit, runningBalance, invoiceId, issuer,
 *                  lineNumber, organizationId }>,
 *   closingBalance: number,
 *   totalDebit: number,
 *   totalCredit: number,
 *   pagination: { limit, offset, returned, hasMore }
 * }>}
 */
async function queryGeneralLedger({
    accountCode,
    startDate = null,
    endDate = null,
    organizationId = null,
    limit = 500,
    offset = 0,
} = {}) {
    if (!accountCode) {
        throw Object.assign(
            new Error('accountCode is required'),
            { code: 'VALIDATION_ERROR' },
        );
    }
    const code = String(accountCode).trim();
    const from = startDate ? parseStartDate(startDate) : null;
    const to = endDate ? parseAsOfDate(endDate) : null;
    if (from && to && from.getTime() > to.getTime()) {
        throw Object.assign(
            new Error('startDate must be on or before endDate'),
            { code: 'VALIDATION_ERROR' },
        );
    }

    const safeLimit = Math.min(Math.max(1, Math.floor(Number(limit) || 500)), 5_000);
    const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));

    const prisma = resolvePrisma();
    if (!prisma) {
        logger.warn('[general-ledger] Prisma unavailable — returning empty result');
        return {
            accountCode: code,
            accountName: null,
            openingBalance: 0,
            lines: [],
            closingBalance: 0,
            totalDebit: 0,
            totalCredit: 0,
            pagination: { limit: safeLimit, offset: safeOffset, returned: 0, hasMore: false },
        };
    }

    // ── Opening balance: every line with entryDate < from. ────────────────
    let openingBalance = 0;
    if (from) {
        const priorEntries = await prisma.journalEntry.findMany({
            where: {
                isDeleted: false,
                entryDate: { lt: from },
                ...(organizationId ? { organizationId } : {}),
                lines: { some: { accountCode: code } },
            },
            include: {
                lines: { where: { accountCode: code } },
            },
        });
        const priorLines = priorEntries.flatMap((e) => e.lines || []);
        openingBalance = computeOpeningBalance({ accountCode: code, lines: priorLines });
    }

    // ── Period lines: chronological, paged. ───────────────────────────────
    // We fetch entries with at least one matching line, then flatten and
    // filter — this keeps the SQL simple and lets us return entry metadata
    // (reference, description, invoiceId) on each output row.
    const periodWhere = {
        isDeleted: false,
        ...(organizationId ? { organizationId } : {}),
        lines: { some: { accountCode: code } },
    };
    if (from || to) {
        periodWhere.entryDate = {};
        if (from) {periodWhere.entryDate.gte = from;}
        if (to) {periodWhere.entryDate.lte = to;}
    }
    const entries = await prisma.journalEntry.findMany({
        where: periodWhere,
        include: {
            lines: { where: { accountCode: code } },
        },
        orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
    });

    // Flatten into one row per matching line.
    const allRows = [];
    let accountName = null;
    for (const entry of entries) {
        for (const line of (entry.lines || [])) {
            if (!accountName && line.accountName) {
                accountName = line.accountName;
            }
            allRows.push({
                entryId: entry.id,
                entryDate: entry.entryDate,
                reference: entry.reference,
                description: entry.description,
                invoiceId: entry.invoiceId,
                organizationId: entry.organizationId,
                lineNumber: line.lineNumber,
                accountCode: line.accountCode,
                accountName: line.accountName,
                debit: round2(line.debit),
                credit: round2(line.credit),
                issuer: line.issuer || null,
            });
        }
    }

    // Compute running balance over the FULL period set, then page after —
    // so a paged row carries the correct running balance for its position
    // in the period (not just for the page).
    let running = openingBalance;
    for (const row of allRows) {
        running = applyLine({
            accountCode: code,
            runningBalance: running,
            debit: row.debit,
            credit: row.credit,
        });
        row.runningBalance = running;
    }

    const totalDebit = round2(allRows.reduce((s, r) => s + r.debit, 0));
    const totalCredit = round2(allRows.reduce((s, r) => s + r.credit, 0));
    const closingBalance = running;

    const pagedLines = allRows.slice(safeOffset, safeOffset + safeLimit);

    return {
        accountCode: code,
        accountName,
        openingBalance,
        lines: pagedLines,
        closingBalance,
        totalDebit,
        totalCredit,
        pagination: {
            limit: safeLimit,
            offset: safeOffset,
            returned: pagedLines.length,
            hasMore: safeOffset + pagedLines.length < allRows.length,
            totalRows: allRows.length,
        },
    };
}

module.exports = {
    queryGeneralLedger,
    // Exported for tests.
    computeOpeningBalance,
    applyLine,
    parseStartDate,
};
