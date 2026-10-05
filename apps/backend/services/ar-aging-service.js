/**
 * AR Aging Report (รายงานลูกหนี้ค้างชำระ) — B20-D, 2026-05-16.
 *
 * Why this exists:
 *   The finance team needs to prioritise collection by how long an
 *   invoice has been outstanding. The canonical AR-aging convention
 *   buckets PENDING invoices by `asOfDate - dueDate`:
 *     - NOT_YET_DUE  → dueDate is in the future
 *     - 0_30         → 0..30 days past due
 *     - 31_60        → 31..60 days past due
 *     - 61_90        → 61..90 days past due
 *     - OVER_90      → > 90 days past due
 *
 *   On GACP, the AR ledger is in two parts:
 *     - DTAM side    — STATE invoices the applicant owes to กรมบัญชีกลาง.
 *                      Reviewed by ACCOUNT_DTAM. The platform never holds
 *                      this cash; ageing here just tracks which applicants
 *                      have not yet wired to Treasury.
 *     - PLATFORM side — Predictive AI invoices (platform fee + VAT 7%).
 *                       Reviewed by ACCOUNT_PLATFORM. This is the
 *                       commercial AR proper (TFRS for NPAEs ch. 14 —
 *                       ลูกหนี้การค้า).
 *
 *   `bookSide` is REQUIRED — same discipline as
 *   bank-reconciliation-service. The two sides are tracked in DIFFERENT
 *   ledgers by DIFFERENT teams; there is no sensible default.
 *
 * Compliance basis:
 *   - TFRS for NPAEs ch. 14 (ลูกหนี้การค้า) — disclosure of overdue
 *     receivables by ageing band is the standard NPAE disclosure for
 *     trade receivables.
 *   - กรมพัฒนาธุรกิจการค้า (DBD) guidance — same buckets used by
 *     Thai accountants for monthly close-out.
 *   - Thai e-Transactions Act §31 — every export is itself audit-
 *     logged at the route layer.
 *
 * Boundary discipline:
 *   - READ-ONLY from Invoice + Application + User.
 *   - Org-scoped (`organizationId` required).
 *   - PDPA: applicant healthId always returned MASKED — full ID is
 *     never shipped from this service.
 *
 * @module services/ar-aging-service
 */

'use strict';

const customerStatementService = require('./customer-statement-service');
const { neutralizeCsvFormula } = require('../shared/csv-utils'); // C5-04 formula-injection guard
const { getZonedParts } = require('../utils/working-days');

const {
    classifyServiceType,
    maskHealthId,
    maskName,
    round2,
} = customerStatementService._internals;
const { BOOK_SIDES } = customerStatementService;

// Prisma resolved lazily — same pattern as customer-statement-service.
let _prismaModule;
function _resolvePrisma() {
    if (!_prismaModule) {
        try {
            _prismaModule = require('./prisma-database');
        } catch (_e) {
            _prismaModule = { prisma: null };
        }
    }
    return _prismaModule.prisma;
}

// ── Bucket definitions ────────────────────────────────────────────────

const BUCKETS = Object.freeze({
    NOT_YET_DUE: 'NOT_YET_DUE',
    DAYS_0_30: '0_30',
    DAYS_31_60: '31_60',
    DAYS_61_90: '61_90',
    OVER_90: 'OVER_90',
});

const BUCKET_ORDER = [
    BUCKETS.NOT_YET_DUE,
    BUCKETS.DAYS_0_30,
    BUCKETS.DAYS_31_60,
    BUCKETS.DAYS_61_90,
    BUCKETS.OVER_90,
];

function bucketForDaysOverdue(days) {
    if (days < 0) { return BUCKETS.NOT_YET_DUE; }
    if (days <= 30) { return BUCKETS.DAYS_0_30; }
    if (days <= 60) { return BUCKETS.DAYS_31_60; }
    if (days <= 90) { return BUCKETS.DAYS_61_90; }
    return BUCKETS.OVER_90;
}

function daysBetween(asOf, dueDate) {
    if (!dueDate) { return 0; }
    const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
    if (Number.isNaN(due.getTime())) { return 0; }
    // Whole Bangkok calendar days between the two dates: each end is read as
    // its Bangkok day (the day the invoice says), then counted as plain dates.
    const dayMs = 24 * 60 * 60 * 1000;
    const dayNumber = (d) => {
        const { year, month, day } = getZonedParts(d);
        return Date.UTC(year, month - 1, day) / dayMs;
    };
    return Math.floor(dayNumber(asOf) - dayNumber(due));
}

function freshBucketTotals() {
    const out = {};
    for (const key of BUCKET_ORDER) {
        out[key] = { amount: 0, count: 0 };
    }
    return out;
}

function normalizeBookSide(value) {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === BOOK_SIDES.DTAM || normalized === BOOK_SIDES.PLATFORM) {
        return normalized;
    }
    return null;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Build the AR Aging report for one book-side.
 *
 * @param {object} args
 * @param {Date|string} args.asOfDate            — REQUIRED report cutoff
 * @param {'DTAM'|'PLATFORM'} args.bookSide      — REQUIRED side filter
 * @param {string} args.organizationId           — REQUIRED tenant scope
 * @param {object} [args.prisma]                 — inject for tests
 * @returns {Promise<object>}
 */
async function generateArAgingReport(args = {}) {
    const {
        asOfDate,
        bookSide,
        organizationId,
        prisma: prismaArg = null,
    } = args;

    if (!asOfDate) {
        const err = new Error('generateArAgingReport: asOfDate required');
        err.code = 'VALIDATION_ERROR';
        throw err;
    }
    const normalizedSide = normalizeBookSide(bookSide);
    if (!normalizedSide) {
        const err = new Error(
            'generateArAgingReport: bookSide is required (DTAM | PLATFORM)',
        );
        err.code = 'BOOK_SIDE_REQUIRED';
        throw err;
    }
    if (!organizationId) {
        const err = new Error('generateArAgingReport: organizationId required');
        err.code = 'VALIDATION_ERROR';
        throw err;
    }

    const asOf = asOfDate instanceof Date ? asOfDate : new Date(asOfDate);
    if (Number.isNaN(asOf.getTime())) {
        const err = new Error(`generateArAgingReport: invalid asOfDate "${asOfDate}"`);
        err.code = 'VALIDATION_ERROR';
        throw err;
    }

    const prisma = prismaArg || _resolvePrisma();

    // 1) Pull PENDING (or OVERDUE) invoices for this tenant only.
    //    The DB filter cannot narrow by bookSide because that's a
    //    derived property of serviceType — we filter post-fetch
    //    (same approach as bank-reconciliation-service).
    const pendingInvoices = await prisma.invoice.findMany({
        where: {
            organizationId,
            isDeleted: false,
            status: { in: ['pending', 'PENDING', 'overdue', 'OVERDUE'] },
            createdAt: { lte: asOf },
        },
        orderBy: { dueDate: 'asc' },
        include: {
            application: {
                select: {
                    id: true,
                    applicationNumber: true,
                    healthId: true,
                    // C2-class: Application's applicant relation is `applicant`,
                    // not `farmer` → include of `farmer` 500s the AR-aging report.
                    applicant: {
                        select: {
                            firstName: true,
                            lastName: true,
                        },
                    },
                },
            },
        },
    });

    // 2) Bucket + total.
    const totalsByBucket = freshBucketTotals();
    let totalOutstanding = 0;
    const rows = [];

    for (const invoice of pendingInvoices) {
        const rowSide = classifyServiceType(invoice.serviceType);
        if (rowSide !== normalizedSide) { continue; }

        const daysOverdue = daysBetween(asOf, invoice.dueDate);
        const bucket = bucketForDaysOverdue(daysOverdue);
        const amount = round2(invoice.totalAmount);

        totalsByBucket[bucket].amount = round2(totalsByBucket[bucket].amount + amount);
        totalsByBucket[bucket].count += 1;
        totalOutstanding = round2(totalOutstanding + amount);

        const applicant = invoice.application?.applicant || null;
        rows.push({
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            applicantHealthIdMasked: maskHealthId(invoice.application?.healthId || invoice.healthId),
            applicantNameMasked: applicant
                ? maskName([applicant.firstName, applicant.lastName].filter(Boolean).join(' ').trim() || null)
                : null,
            applicationId: invoice.application?.id || null,
            applicationNumber: invoice.application?.applicationNumber || null,
            invoiceDate: invoice.createdAt,
            dueDate: invoice.dueDate,
            daysOverdue,
            bucket,
            amount,
            serviceType: invoice.serviceType,
        });
    }

    return {
        asOfDate: asOf,
        bookSide: normalizedSide,
        organizationId,
        totalsByBucket,
        totalOutstanding,
        rowCount: rows.length,
        rows,
    };
}

// ── CSV serialization ────────────────────────────────────────────────

const UTF8_BOM = '﻿';
const CRLF = '\r\n';

function escapeCsv(value) {
    if (value === null || value === undefined) { return ''; }
    let str;
    if (value instanceof Date) {
        // ISO-8601 of the Bangkok day — Excel-Thai handles this with the
        // locale-aware date column; raw ISO sorts correctly regardless.
        str = getZonedParts(value).isoDate;
    } else {
        str = String(value);
    }
    str = neutralizeCsvFormula(str); // C5-04: defuse =,+,-,@ formula triggers before quoting
    if (/[",\r\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

/**
 * CSV variant. RFC 4180 + UTF-8 BOM + CRLF line endings so Excel-Thai
 * opens the file with the right encoding by default (the BOM is the
 * canonical hint Excel uses to auto-select UTF-8 instead of the legacy
 * CP874 codepage that would mangle the Thai column headers).
 *
 * Column names are bilingual (Thai + English) for the finance team's
 * Excel templates which are already keyed off the Thai labels.
 *
 * @param {object} args  — same as generateArAgingReport
 * @returns {Promise<string>}
 */
async function generateArAgingReportCSV(args = {}) {
    const report = await generateArAgingReport(args);

    const headers = [
        'เลขใบแจ้งหนี้ / Invoice No.',
        'เลขที่ใบสมัคร / Application No.',
        'เลขประจำตัว / Health ID (masked)',
        'ชื่อผู้สมัคร / Applicant (masked)',
        'วันที่ใบแจ้งหนี้ / Invoice Date',
        'วันครบกำหนด / Due Date',
        'จำนวนวันค้าง / Days Overdue',
        'ช่วงอายุ / Aging Bucket',
        'จำนวนเงิน (บาท) / Amount (THB)',
        'ประเภทบริการ / Service Type',
    ];

    const lines = [headers.map(escapeCsv).join(',')];
    for (const row of report.rows) {
        lines.push([
            escapeCsv(row.invoiceNumber),
            escapeCsv(row.applicationNumber),
            escapeCsv(row.applicantHealthIdMasked),
            escapeCsv(row.applicantNameMasked),
            escapeCsv(row.invoiceDate),
            escapeCsv(row.dueDate),
            escapeCsv(row.daysOverdue),
            escapeCsv(row.bucket),
            escapeCsv(row.amount.toFixed(2)),
            escapeCsv(row.serviceType),
        ].join(','));
    }
    // Totals row at the bottom — finance team's Excel template
    // expects it (no header row delimiter — they sub-total via the
    // bucket column instead).
    lines.push([
        'TOTAL',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        escapeCsv(report.totalOutstanding.toFixed(2)),
        '',
    ].join(','));

    return UTF8_BOM + lines.join(CRLF) + CRLF;
}

module.exports = {
    generateArAgingReport,
    generateArAgingReportCSV,
    BUCKETS,
    BUCKET_ORDER,
    BOOK_SIDES,
    // Exposed for tests
    _internals: {
        bucketForDaysOverdue,
        daysBetween,
        normalizeBookSide,
        freshBucketTotals,
    },
};
