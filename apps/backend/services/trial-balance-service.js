/**
 * Trial Balance Service (งบทดลอง) — TFRS for NPAEs core financial report.
 *
 * Aggregates every `JournalLine` row up to `asOfDate` and produces the
 * unsigned debit / credit balances per `accountCode`. This is the first
 * statement the accountant produces at month-end; it is the precondition
 * for the P&L and Balance Sheet — if the trial balance is unbalanced
 * (totalDebit != totalCredit) the books cannot be closed.
 *
 * Compliance basis:
 *   - TFRS for NPAEs ch. 5 (Accounting Cycle) — งบทดลอง is the canonical
 *     periodic close-out step. Sum of debits MUST equal sum of credits;
 *     any discrepancy signals a torn write in the journal layer.
 *   - TAS 1 (Presentation of Financial Statements) §54 — every account
 *     must be identifiable by code + name; debit / credit columns shown
 *     separately, not netted, so an auditor can re-derive the balance.
 *   - กรมพัฒนาธุรกิจการค้า (DBD) accounting-standard guidance — Thai
 *     practice is to display balances on the natural side (assets/expenses
 *     on the debit side, liabilities/equity/revenue on the credit side)
 *     and the column totals at the bottom.
 *
 * Boundary discipline (B19-B owner):
 *   - Strictly READ from JournalEntry + JournalLine. No writes.
 *   - We do NOT touch Invoice / Quote / PaymentSlip — those belong to
 *     other batches. The trial balance is the journal layer's view of
 *     the books.
 *   - Org-scoped — caller must pass `organizationId`; we never go
 *     cross-tenant. The route layer is responsible for org-scoping via
 *     `req.user.organizationId`.
 *   - DTAM 9xxx suspense accounts are off-platform (collection-agent
 *     model: STATE-fee cash flows applicant → Treasury, never platform
 *     books). The trial balance therefore EXCLUDES 9xxx rows so the
 *     platform's books match the bank statement.
 *
 * @module services/trial-balance-service
 */

'use strict';

const logger = require('../shared/logger');
const { neutralizeCsvFormula } = require('../shared/csv-utils'); // C5-04 formula-injection guard
const { parseLocalIsoDate, startOfLocalCalendarDay } = require('../utils/working-days');

// Lazy-require Prisma so the service stays loadable in test/CI bootstrap
// environments where the client hasn't been generated yet. Mirrors the
// pattern in journal-entry-service.js.
let prismaModule;
try {
    prismaModule = require('./prisma-database');
} catch (_e) {
    prismaModule = { prisma: null };
}

// ──────────────────────────────────────────────────────────────────────────
// Account classification helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Thai Chart of Accounts hierarchy (TFRS for NPAEs ch. 2):
 *   1xxx — Assets        (debit-natural)
 *   2xxx — Liabilities   (credit-natural)
 *   3xxx — Equity        (credit-natural)
 *   4xxx — Revenue       (credit-natural)
 *   5xxx — Expenses      (debit-natural)
 *   9xxx — Suspense / off-book (e.g. DTAM state revenue — NOT on platform books)
 */
function getAccountType(accountCode) {
    const code = String(accountCode || '');
    const firstChar = code.charAt(0);
    switch (firstChar) {
        case '1': return 'ASSET';
        case '2': return 'LIABILITY';
        case '3': return 'EQUITY';
        case '4': return 'REVENUE';
        case '5': return 'EXPENSE';
        case '9': return 'SUSPENSE';
        default: return 'UNKNOWN';
    }
}

/**
 * Debit-natural account = balance = debit - credit (display positive on debit side).
 * Credit-natural account = balance = credit - debit (display positive on credit side).
 *
 * TFRS for NPAEs / TAS 1 §54 convention.
 */
function isDebitNatural(accountCode) {
    const type = getAccountType(accountCode);
    return type === 'ASSET' || type === 'EXPENSE';
}

/**
 * Round to 2 decimal places (THB satang). All Decimal(15,2) values from
 * Prisma must be coerced to Number AND rounded at the application boundary.
 */
function round2(n) {
    if (n === null || n === undefined) {
        return 0;
    }
    // Prisma Decimal exposes `.toNumber()` / `.toString()`. Number() handles
    // both Decimal instances (via valueOf) and raw numbers.
    const value = typeof n === 'object' && typeof n.toNumber === 'function'
        ? n.toNumber()
        : Number(n);
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.round(value * 100) / 100;
}

function resolvePrisma() {
    const client = prismaModule && prismaModule.prisma;
    if (!client) {
        return null;
    }
    const lineDelegate = client.journalLine;
    if (!lineDelegate
        || typeof lineDelegate !== 'object'
        || typeof lineDelegate.findMany !== 'function') {
        return null;
    }
    return client;
}

/**
 * Parse a date input ("YYYY-MM-DD" or Date) into the end of that Bangkok day.
 * If null/undefined → null (caller can omit upper bound).
 */
function parseAsOfDate(value) {
    if (!value) {
        return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw Object.assign(new Error(`invalid asOfDate: ${value}`), { code: 'VALIDATION_ERROR' });
    }
    // If a bare date string was passed, pin to end-of-day so a same-day
    // journal entry is included.
    // A bare "YYYY-MM-DD" is a Bangkok day: it ends at 23:59:59.999 in Bangkok.
    const day = parseLocalIsoDate(value);
    if (day) {
        return new Date(startOfLocalCalendarDay(day.year, day.month, day.day + 1).getTime() - 1);
    }
    return date;
}

// ──────────────────────────────────────────────────────────────────────────
// Pure helper — aggregate lines into trial-balance rows
// ──────────────────────────────────────────────────────────────────────────

/**
 * Aggregate a flat list of journal lines into per-account rows.
 *
 * Each row carries:
 *   - accountCode / accountName
 *   - debit  = sum of debit  column for this account
 *   - credit = sum of credit column for this account
 *   - balance = signed natural balance:
 *       debit-natural  → max(debit - credit, 0)  on the debit side
 *       credit-natural → max(credit - debit, 0) on the credit side
 *     (A debit-natural account with a negative balance is shown on the
 *     credit side instead — TAS 1 §54 — but for the trial balance we
 *     surface raw debit/credit columns, and the consumer formats.)
 *
 * Pure function — no I/O. Easy to unit-test with synthetic data.
 */
function aggregateLines(lines, { includeZeroBalances = false } = {}) {
    const byCode = new Map();
    for (const line of lines) {
        const code = String(line.accountCode || '').trim();
        if (!code) {
            continue;
        }
        // EXCLUDE 9xxx SUSPENSE — the platform's books do not carry
        // DTAM state-fee suspense (collection-agent model, owner-confirmed
        // 2026-05-16, see journal-entry-service.js header).
        if (code.startsWith('9')) {
            continue;
        }
        const debit = round2(line.debit);
        const credit = round2(line.credit);
        const existing = byCode.get(code);
        if (existing) {
            existing.debit = round2(existing.debit + debit);
            existing.credit = round2(existing.credit + credit);
        } else {
            byCode.set(code, {
                accountCode: code,
                accountName: line.accountName || code,
                debit,
                credit,
            });
        }
    }

    const rows = [];
    for (const row of byCode.values()) {
        // Net the two columns into a signed balance on the natural side.
        // TAS 1 §54 — assets/expenses appear on the debit column, liab/
        // equity/revenue on the credit column.
        const net = round2(row.debit - row.credit);
        let displayDebit = 0;
        let displayCredit = 0;
        if (isDebitNatural(row.accountCode)) {
            if (net >= 0) {
                displayDebit = net;
            } else {
                displayCredit = round2(-net);
            }
        } else if (net <= 0) {
            displayCredit = round2(-net);
        } else {
            displayDebit = net;
        }

        const balance = isDebitNatural(row.accountCode) ? net : round2(-net);

        if (!includeZeroBalances && displayDebit === 0 && displayCredit === 0) {
            continue;
        }

        rows.push({
            accountCode: row.accountCode,
            accountName: row.accountName,
            accountType: getAccountType(row.accountCode),
            debit: displayDebit,
            credit: displayCredit,
            // `balance` is on the natural side (positive when the account
            // has a balance on its natural side; negative when reversed).
            balance,
        });
    }

    // Sort by accountCode so the output is deterministic and matches the
    // chart-of-accounts hierarchy 1xxx → 2xxx → 3xxx → 4xxx → 5xxx.
    rows.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

    const totalDebit = round2(rows.reduce((s, r) => s + r.debit, 0));
    const totalCredit = round2(rows.reduce((s, r) => s + r.credit, 0));
    // TFRS for NPAEs ch. 5: totalDebit MUST equal totalCredit. Sub-satang
    // FP error tolerated up to 0.005 THB.
    const balanced = Math.abs(totalDebit - totalCredit) < 0.005;

    return { rows, totalDebit, totalCredit, balanced };
}

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────

/**
 * Generate the trial balance as of `asOfDate` (inclusive). Aggregates
 * every JournalLine up to that date in chronological-by-entry order.
 *
 * @param {object} args
 * @param {string|Date} args.asOfDate           — end-of-period date (REQUIRED)
 * @param {string} [args.organizationId]        — tenant scope (REQUIRED at route layer)
 * @param {boolean} [args.includeZeroBalances]  — keep accounts with 0/0 — false by default
 * @returns {Promise<{
 *   asOfDate: string,
 *   organizationId: string|null,
 *   rows: Array<{ accountCode, accountName, accountType, debit, credit, balance }>,
 *   totalDebit: number,
 *   totalCredit: number,
 *   balanced: boolean,
 *   discrepancy: number|null,
 *   warnings: string[]
 * }>}
 */
async function generateTrialBalance({ asOfDate, organizationId = null, includeZeroBalances = false } = {}) {
    if (!asOfDate) {
        throw Object.assign(new Error('asOfDate is required'), { code: 'VALIDATION_ERROR' });
    }
    const upperBound = parseAsOfDate(asOfDate);

    const prisma = resolvePrisma();
    let lines = [];
    if (prisma) {
        // We join JournalLine → JournalEntry to filter by entryDate +
        // organizationId. Soft-deleted entries are excluded (TFRS for
        // NPAEs requires reversing entries for corrections, not deletes;
        // but if isDeleted is true the row should be ignored).
        const entries = await prisma.journalEntry.findMany({
            where: {
                isDeleted: false,
                entryDate: { lte: upperBound },
                ...(organizationId ? { organizationId } : {}),
            },
            include: {
                lines: true,
            },
            orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
        });
        lines = entries.flatMap((e) => (e.lines || []));
    }

    const { rows, totalDebit, totalCredit, balanced } = aggregateLines(lines, {
        includeZeroBalances,
    });

    const warnings = [];
    let discrepancy = null;
    if (!balanced) {
        discrepancy = round2(totalDebit - totalCredit);
        const warning = `Trial balance UNBALANCED — Dr ${totalDebit} != Cr ${totalCredit} (diff ${discrepancy}). `
            + 'Per TFRS for NPAEs ch.5 the books cannot be closed until this is resolved. '
            + 'Inspect JournalEntry rows for torn writes (rows where totalDebit !== totalCredit).';
        warnings.push(warning);
        logger.error(`[trial-balance] ${warning}`, { organizationId, asOfDate: upperBound.toISOString() });
    }

    return {
        asOfDate: upperBound.toISOString(),
        organizationId,
        rows,
        totalDebit,
        totalCredit,
        balanced,
        discrepancy,
        warnings,
    };
}

/**
 * RFC 4180 CSV export of the trial balance. UTF-8 with BOM so Thai
 * account names render correctly in Excel for Windows.
 *
 * Columns (matches DBD format):
 *   - รหัสบัญชี (Account Code)
 *   - ชื่อบัญชี (Account Name)
 *   - ประเภทบัญชี (Account Type)
 *   - เดบิต (Debit)
 *   - เครดิต (Credit)
 */
async function generateTrialBalanceCSV({ asOfDate, organizationId = null }) {
    const report = await generateTrialBalance({ asOfDate, organizationId, includeZeroBalances: false });
    const lines = [];
    // BOM so Excel for Windows picks up UTF-8 + Thai correctly.
    lines.push('﻿Account Code,Account Name,Account Type,Debit,Credit');
    for (const row of report.rows) {
        lines.push([
            csvField(row.accountCode),
            csvField(row.accountName),
            csvField(row.accountType),
            row.debit.toFixed(2),
            row.credit.toFixed(2),
        ].join(','));
    }
    // Totals row
    lines.push([
        csvField('TOTAL'),
        csvField(''),
        csvField(''),
        report.totalDebit.toFixed(2),
        report.totalCredit.toFixed(2),
    ].join(','));
    if (!report.balanced) {
        lines.push([
            csvField('DISCREPANCY'),
            csvField(`Dr - Cr = ${report.discrepancy}`),
            csvField('UNBALANCED'),
            '',
            '',
        ].join(','));
    }
    return lines.join('\r\n');
}

/**
 * RFC 4180 field escaping: any field containing `,` `"` or CRLF must be
 * quoted; embedded `"` is doubled.
 */
function csvField(value) {
    const str = neutralizeCsvFormula(value === null || value === undefined ? '' : String(value)); // C5-04
    if (/[,"\r\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

module.exports = {
    generateTrialBalance,
    generateTrialBalanceCSV,
    // Exported for tests + downstream services (P&L + BS reuse).
    aggregateLines,
    getAccountType,
    isDebitNatural,
    round2,
    parseAsOfDate,
    csvField,
};
