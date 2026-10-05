/**
 * VAT Report Service — ภ.พ.30 (Por.Por.30) monthly VAT filing report.
 *
 * System deep-dive Tier 19 — Backend + Tax/Compliance + Accounting
 * (B19-C, 2026-05-16). Generates the monthly Output-VAT report that
 * the Predictive AI Solution Co., Ltd. (platform) finance team uploads
 * to the Thai Revenue Department's e-Filing system every month.
 *
 * Filing deadline: 15th of the following month
 *   (ป.รัษฎากร ม.83/8 — e-filing; paper filing under ม.83 is the 7th).
 *   The platform uses e-Filing throughout, so the canonical due date
 *   for code/UI purposes is the 15th.
 *
 * Scope (THIS module):
 *   - OUTPUT VAT (ภาษีขาย) — VAT 7% the platform charged its customers
 *     on PLATFORM service-fee invoices. Read from the JournalLine
 *     table where the line credits the Output VAT account (the chart-
 *     of-accounts row tagged "Output VAT 7%" in
 *     services/journal-entry-service.js → ACCOUNTS.VAT_PAYABLE_OUTPUT).
 *
 *   - INPUT VAT (ภาษีซื้อ) — Iter 26 (2026-05-16) added the companion
 *     PurchaseInvoice table + purchase-invoice-service. This module
 *     consumes those rows via `generateInputVatReport({...})` (see
 *     bottom of this file). The headline `generateOutputVatReport`
 *     return shape now carries `inputVat: { tracked: true, ... }` with
 *     the computed Input VAT total so callers can derive the net
 *     ภ.พ.30 remittance:
 *
 *         Net VAT payable = Output VAT − Input VAT  (ป.รัษฎากร ม.82/3)
 *
 *     When the PurchaseInvoice table or Prisma client is unavailable
 *     (CI bootstrap), the inputVat block falls back to `tracked:false`
 *     with a TODO marker so the finance officer compiles manually.
 *
 * Why filter by accountCode and NOT serviceType:
 *   The journal-entry-service writes Cr Output VAT (7%) on every
 *   PLATFORM-fee payment regardless of phase, scope count, or invoice
 *   shape (see buildPaymentEntryLines line 287-296 — single VAT line
 *   per entry). Filtering by accountCode collects every VAT-bearing
 *   line in one query and is robust to future service-type renames.
 *
 * Data sources:
 *   - JournalLine  — where accountCode === ACCOUNTS.VAT_PAYABLE_OUTPUT
 *                    in the requested month
 *   - JournalEntry — joined for invoiceId + entryDate
 *   - Invoice      — joined for invoiceNumber, billingName, etc.
 *   - Application + Entity — joined for buyer's tax-ID classification
 *
 * Output formats:
 *   - JSON for in-app preview (ACCOUNT_PLATFORM dashboard)
 *   - CSV (UTF-8 BOM, RFC-4180-ish) ready for RD e-Filing upload —
 *     headers match the Revenue Department's published template
 *     (ป.รัษฎากร ม.86/4 + ประกาศกรมสรรพากร ฉบับที่ 200/2562 §3).
 *
 * Legal references:
 *   - ป.รัษฎากร ม.77/1 — VAT definitions, including who is liable.
 *   - ป.รัษฎากร ม.83/8 — monthly e-filing deadline (15th of next month).
 *   - ป.รัษฎากร ม.86/4 — full tax-invoice (ใบกำกับภาษีเต็มรูป) field
 *                      requirements: seller TIN + name + address,
 *                      buyer name + TIN (when registered), date,
 *                      sequential number, taxable amount, VAT amount.
 *   - ประกาศกรมสรรพากร ฉบับที่ 200/2562 — e-Filing CSV column spec.
 *   - TFRS for NPAEs ch. 18 — revenue recognition basis (cash-receipt).
 *
 * @module services/vat-report-service
 */

'use strict';

const logger = require('../shared/logger');
const { neutralizeCsvFormula } = require('../shared/csv-utils'); // C5-04 formula-injection guard
const { PLATFORM_ISSUER } = require('../config/invoice-issuers');
// The leaf chart-of-accounts module, not journal-entry-service: requiring that
// closed a cycle back to period-close-service (see services/journal-accounts.js).
const { ACCOUNTS } = require('./journal-accounts');
const { getZonedParts, startOfLocalCalendarDay } = require('../utils/working-days');

// Lazy-require Prisma so this module stays loadable in CI / Jest
// before `prisma generate` runs. `resolvePrisma()` below treats the
// stubbed Proxy as "no DB" and returns the empty-report shape.
let prismaModule;
try {
    prismaModule = require('./prisma-database');
} catch (_e) {
    prismaModule = { prisma: null };
}

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Account code that journal-entry-service.js credits for Output VAT.
 * Sourced from the imported chart-of-accounts so the filter stays in
 * lockstep if the code is ever renumbered (the actual code today is
 * '2131-001', not the legacy '2210' code referenced in older specs).
 *
 * We also keep '2210' as a recognised legacy code so historical entries
 * from earlier chart revisions still surface on the report — important
 * because ป.รัษฎากร requires us to report ALL output VAT in the period.
 */
const OUTPUT_VAT_ACCOUNT_CODES = Object.freeze([
    ACCOUNTS.VAT_PAYABLE_OUTPUT.code, // '2131-001' canonical
    '2210',                            // legacy chart-of-accounts code (pre-B16)
    '2210-001',                        // legacy variant
]);

/**
 * Account code Iter-26 purchase-invoice-service debits for Input VAT.
 * Kept in sync with services/purchase-invoice-service.js ACCOUNTS.INPUT_VAT.
 */
const INPUT_VAT_ACCOUNT_CODES = Object.freeze([
    '1310-001',
]);

const THAI_MONTHS_FULL = Object.freeze([
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
]);

const INDIVIDUAL_BUYER_TAX_ID_DISPLAY = '-';

// RFC 4180 line ending (CRLF) — Excel and the RD e-Filing portal both
// expect Windows-style line breaks in CSV uploads (verified against
// RD's published sample 2026-05).
const CSV_EOL = '\r\n';

// UTF-8 BOM — Excel needs this prefix to recognise the file as UTF-8
// when the user double-clicks it from Windows; without the BOM the
// Thai characters render as mojibake (ครบฟ etc).
const UTF8_BOM = '﻿';

// ── Pure helpers ───────────────────────────────────────────────────────────

function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

function toMonthBoundaries(year, month) {
    // month is 1-based on input (1 = Jan, 12 = Dec)
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || y < 2020 || y > 2030) {
        throw Object.assign(new Error(`Invalid year ${year} — expected 2020..2030`), {
            code: 'VALIDATION_ERROR',
        });
    }
    if (!Number.isInteger(m) || m < 1 || m > 12) {
        throw Object.assign(new Error(`Invalid month ${month} — expected 1..12`), {
            code: 'VALIDATION_ERROR',
        });
    }
    // The tax month is the Bangkok calendar month: 00:00 on the 1st in
    // Bangkok inclusive, 00:00 on the 1st of the next month exclusive.
    // entryDate is a UTC instant, so the boundaries are the instants of those
    // Bangkok midnights. UTC month edges (the old code) filed a payment made
    // at 03:00 on 1 Oct in Bangkok under September (CODE-X1, audit
    // 2026-09-17). Only the window moves; no amount is touched.
    const start = startOfLocalCalendarDay(y, m, 1);
    const end = startOfLocalCalendarDay(y, m + 1, 1);
    return { start, end };
}

function monthThai(month) {
    const idx = Number(month) - 1;
    if (idx < 0 || idx > 11) {return '';}
    return THAI_MONTHS_FULL[idx];
}

function resolvePrisma() {
    const client = prismaModule && prismaModule.prisma;
    if (!client) {return null;}
    // The Proxy stub returns "anything" for unknown delegates; real
    // client has findMany as a function.
    if (!client.journalLine || typeof client.journalLine.findMany !== 'function') {
        return null;
    }
    return client;
}

/**
 * Classify a buyer's tax ID from the joined Application + Entity rows.
 *
 * Rules per ป.รัษฎากร ม.86/4:
 *   - JURISTIC buyer (company) → 13-digit corporate TIN (starts with 0).
 *     Report the full ID; this is also the company's VAT registration
 *     number when applicable.
 *   - INDIVIDUAL buyer (farmer) → no corporate TIN. ม.86/4 still
 *     requires a row but the buyer TIN column is rendered as '-' (dash)
 *     per RD e-Filing guidance: individual buyers are not VAT
 *     registered, but the line item must still be reported for ภ.พ.30.
 *   - Unknown / missing → '-' (treat as individual for reporting).
 *
 * @param {object|null} invoice  the joined Invoice row (with application + entity)
 * @returns {{ buyerName: string, buyerTaxId: string, buyerType: string }}
 */
function classifyBuyer(invoice) {
    if (!invoice) {
        return {
            buyerName: 'UNKNOWN',
            buyerTaxId: INDIVIDUAL_BUYER_TAX_ID_DISPLAY,
            buyerType: 'INDIVIDUAL',
        };
    }
    const entity = invoice.application?.entity || null;
    const applicant = invoice.applicant || null;
    const billingName = invoice.billingName || null;

    // Prefer Entity (Wave B Phase 66 canonical applicant identity).
    if (entity) {
        if (entity.type === 'JURISTIC' && entity.juristicId) {
            return {
                buyerName: entity.displayName || billingName || 'UNKNOWN',
                buyerTaxId: String(entity.juristicId),
                buyerType: 'JURISTIC',
            };
        }
        // INDIVIDUAL / COMMUNITY_ENTERPRISE — no VAT TIN on file, report
        // as dash per ม.86/4 RD e-Filing convention.
        return {
            buyerName: entity.displayName || billingName || 'UNKNOWN',
            buyerTaxId: INDIVIDUAL_BUYER_TAX_ID_DISPLAY,
            buyerType: entity.type || 'INDIVIDUAL',
        };
    }

    // Fallback to User-level fields (pre-Phase-66 rows). Note the
    // deprecated User.taxId may carry either a personal or corporate
    // ID; if it's missing we render '-' rather than guessing.
    if (applicant) {
        const fullName = [applicant.firstName, applicant.lastName]
            .filter(Boolean)
            .join(' ')
            .trim()
            || billingName || 'UNKNOWN';
        const taxId = applicant.taxId ? String(applicant.taxId) : null;
        return {
            buyerName: fullName,
            buyerTaxId: taxId || INDIVIDUAL_BUYER_TAX_ID_DISPLAY,
            buyerType: taxId ? 'JURISTIC' : 'INDIVIDUAL',
        };
    }

    return {
        buyerName: billingName || 'UNKNOWN',
        buyerTaxId: INDIVIDUAL_BUYER_TAX_ID_DISPLAY,
        buyerType: 'INDIVIDUAL',
    };
}

/**
 * Resolve the taxable amount (VAT base) for a JournalLine row.
 * Prefers the explicit `taxableAmount` column (B16-A schema), falls
 * back to deriving from the VAT credit / VAT rate when the column is
 * null (legacy rows pre-B16-A).
 */
function resolveTaxableAmount(line, vatAmount) {
    if (line && line.taxableAmount !== null && line.taxableAmount !== undefined) {
        return round2(line.taxableAmount);
    }
    const rate = PLATFORM_ISSUER.vatRate || 0.07;
    if (!rate || !Number.isFinite(vatAmount)) {return 0;}
    return round2(vatAmount / rate);
}

function buildSellerHeader() {
    // Frozen subset of PLATFORM_ISSUER for the report header. We do
    // NOT mutate the imported constant.
    return Object.freeze({
        legalNameTH: PLATFORM_ISSUER.legalNameTH,
        legalNameEN: PLATFORM_ISSUER.legalNameEN,
        taxId: PLATFORM_ISSUER.taxId,
        addressLine1: PLATFORM_ISSUER.addressLine1,
        addressLine2: PLATFORM_ISSUER.addressLine2,
        vatRate: PLATFORM_ISSUER.vatRate || 0.07,
    });
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Generate the Output-VAT (ภาษีขาย) report for one month.
 *
 * Filters:
 *   - JournalLine.accountCode in OUTPUT_VAT_ACCOUNT_CODES
 *   - JournalEntry.entryDate ∈ [first-day-of-month, first-day-of-next-month)
 *   - JournalEntry.isDeleted = false (soft-delete exclusion)
 *   - JournalEntry.organizationId = organizationId (when provided)
 *
 * Each surviving row is joined via JournalEntry.invoiceId to:
 *   - Invoice.invoiceNumber, billingName, paidAt, applicant
 *   - Application + Entity (for buyer-type classification)
 *
 * @param {object} args
 * @param {number|string} args.year       calendar year (CE), e.g. 2026
 * @param {number|string} args.month      1..12 (Jan..Dec)
 * @param {string|null}   [args.organizationId]
 * @returns {Promise<object>} { period, seller, rows, totals, inputVat }
 */
async function generateOutputVatReport({ year, month, organizationId = null } = {}) {
    const { start, end } = toMonthBoundaries(year, month);
    const period = {
        year: Number(year),
        month: Number(month),
        monthThai: monthThai(month),
        // Filing-due date (15th of the next month) — useful for the UI
        // "ยื่นภายในวันที่ ..." banner.
        filingDueDate: new Date(Date.UTC(
            Number(year),
            Number(month),       // month is 1-based here; Date.UTC month is 0-based
            15, 0, 0, 0, 0,
        )),
        windowStart: start,
        windowEnd: end,
    };

    const seller = buildSellerHeader();
    // Build the legacy "Input VAT not tracked" fallback first — the
    // generateInputVatReport call below replaces it when the
    // PurchaseInvoice table is available (Iter 26 / ม.82/3). When the
    // Prisma client lacks the new model (CI bootstrap before the
    // 20260518000000_purchase_invoice migration runs), the fallback
    // shape is what the caller sees — preserving the legacy contract.
    const inputVatFallback = {
        tracked: false,
        todo: 'Input VAT (ภาษีซื้อ) tracking not yet implemented. '
            + 'Finance staff must compile purchase invoices manually '
            + 'before filing ภ.พ.30 (ป.รัษฎากร ม.82/3).',
    };
    const emptyResult = {
        period,
        seller,
        rows: [],
        totals: { taxableAmount: 0, vatAmount: 0, rowCount: 0 },
        inputVat: inputVatFallback,
    };

    const prisma = resolvePrisma();
    if (!prisma) {
        logger.warn(
            '[vat-report] Prisma client unavailable — returning empty report shape. '
            + 'This is expected in CI before `prisma generate`; production deploys '
            + 'must have a real client.',
        );
        return emptyResult;
    }

    // Query JournalLine with the journal entry + invoice + application
    // + entity nested includes. We filter by accountCode and the parent
    // entry's date / soft-delete flag.
    const where = {
        accountCode: { in: [...OUTPUT_VAT_ACCOUNT_CODES] },
        entry: {
            entryDate: { gte: start, lt: end },
            isDeleted: false,
        },
    };
    if (organizationId) {
        where.entry.organizationId = organizationId;
    }

    let lines;
    try {
        lines = await prisma.journalLine.findMany({
            where,
            orderBy: [{ entry: { entryDate: 'asc' } }, { lineNumber: 'asc' }],
            // NOTE: JournalEntry has NO `invoice` relation — only a scalar
            // `invoiceId` (the Invoice relation was dropped in the migration-drift
            // reconcile because journal_entries.invoiceId is uuid and invoices.id
            // is text; see billing.prisma). Selecting a nested `invoice` here threw
            // PrismaClientValidationError → the route 500'd. Invoices are fetched
            // separately below by the scalar invoiceId (which holds Invoice.id).
            include: {
                entry: {
                    select: {
                        id: true,
                        entryDate: true,
                        reference: true,
                        invoiceId: true,
                    },
                },
            },
        });
    } catch (err) {
        logger.error(`[vat-report] journalLine.findMany failed: ${err?.message}`);
        throw Object.assign(new Error('Failed to load journal lines for VAT report'), {
            code: 'VAT_REPORT_QUERY_FAILED',
            cause: err,
        });
    }

    // Fetch the invoices referenced by these journal entries in one query,
    // keyed by the scalar invoiceId, and build a lookup map. classifyBuyer
    // reads invoice.applicant + invoice.application.entity — reproduced here.
    const invoiceIds = [...new Set(lines.map((l) => l.entry?.invoiceId).filter(Boolean))];
    const invoiceById = new Map();
    if (invoiceIds.length) {
        let invoiceRows = [];
        try {
            invoiceRows = await prisma.invoice.findMany({
                where: { id: { in: invoiceIds } },
                select: {
                    id: true,
                    invoiceNumber: true,
                    billingName: true,
                    paidAt: true,
                    createdAt: true,
                    serviceType: true,
                    applicant: {
                        select: { canonicalId: true, firstName: true, lastName: true, taxId: true },
                    },
                    application: {
                        select: {
                            id: true,
                            applicationNumber: true,
                            entity: {
                                select: { id: true, type: true, displayName: true, juristicId: true },
                            },
                        },
                    },
                },
            });
        } catch (err) {
            logger.error(`[vat-report] invoice.findMany failed: ${err?.message}`);
            throw Object.assign(new Error('Failed to load invoices for VAT report'), {
                code: 'VAT_REPORT_QUERY_FAILED',
                cause: err,
            });
        }
        for (const inv of invoiceRows) {
            invoiceById.set(inv.id, inv);
        }
    }

    const rows = [];
    let totalTaxable = 0;
    let totalVat = 0;

    for (const line of lines) {
        const entry = line.entry || {};
        const invoice = entry.invoiceId ? (invoiceById.get(entry.invoiceId) || null) : null;

        // VAT amount is the credit on the Output VAT line. Defensive:
        // if for some reason the row is debit-only, fall back to the
        // taxable * rate computation.
        const vatAmount = round2(line.credit || 0);
        if (vatAmount <= 0) {
            // Skip zero / negative-credit rows. A reversing entry posts
            // a debit on the Output VAT account; those are netted by
            // simply excluding non-credit lines.
            continue;
        }
        const taxableAmount = resolveTaxableAmount(line, vatAmount);
        const buyer = classifyBuyer(invoice);

        // Invoice date = the date the platform issued the ใบกำกับภาษี.
        // Per ป.รัษฎากร ม.86/4 we use the document's paidAt (which is
        // also the "date of supply" / point of recognition for cash-
        // basis VAT). Fall back to entry.entryDate when paidAt is null.
        const invoiceDate = invoice?.paidAt
            || invoice?.createdAt
            || entry.entryDate
            || new Date();

        rows.push({
            invoiceDate,
            invoiceNumber: invoice?.invoiceNumber || entry.reference || null,
            buyerName: buyer.buyerName,
            buyerTaxId: buyer.buyerTaxId,
            buyerType: buyer.buyerType,
            taxableAmount,
            vatAmount,
            // Diagnostics — useful for the in-app preview but ignored
            // by the e-Filing CSV writer.
            entryId: entry.id || null,
            entryDate: entry.entryDate || null,
            serviceType: invoice?.serviceType || null,
            applicationNumber: invoice?.application?.applicationNumber || null,
        });

        totalTaxable += taxableAmount;
        totalVat += vatAmount;
    }

    // B20-A integration — ใบลดหนี้ (ม.86/10) + ใบเพิ่มหนี้ (ม.86/9).
    //
    // The ภ.พ.30 monthly Output VAT report must:
    //   • SUBTRACT VAT on credit notes (ใบลดหนี้) — they reduce output VAT
    //     for the period in which they are POSTED (ม.86/10).
    //   • ADD VAT on debit notes (ใบเพิ่มหนี้) — they increase output VAT
    //     for the period in which they are POSTED (ม.86/9).
    //
    // Mechanism: once journal-entry-service ships `recordCreditNoteEntry`
    // and `recordDebitNoteEntry` (B20-B journal-owner wire-in), the
    // reversing/additional entries land on JournalLine with debits/credits
    // against ACCOUNTS.VAT_PAYABLE_OUTPUT, and the main query above
    // naturally nets them. UNTIL THAT WIRE-IN LANDS, we directly scan
    // the credit_notes / debit_notes tables for POSTED rows in the
    // window and reflect their net VAT effect in the totals + a separate
    // `adjustments` block so the finance officer sees the figure
    // explicitly during the transition.
    //
    // Idempotency note: when journal-entry-service is wired, the CN/DN
    // postings will produce JournalLine rows that THIS function already
    // captures via the OUTPUT_VAT_ACCOUNT_CODES filter. To avoid
    // double-counting, the side-channel scan below filters by
    // `journalEntryId IS NULL` (i.e. only CN/DN rows whose journal entry
    // has NOT yet been wired — the fallback path). After B20-B journal
    // wire-in, all POSTED rows will carry journalEntryId and this
    // side-channel will naturally degrade to a no-op.
    const adjustments = await collectCnDnAdjustments({
        prisma, start, end, organizationId,
    });

    // Iter 26 — Input VAT (ภาษีซื้อ) integration per ม.82/3 + ม.82/4.
    // Read APPROVED PurchaseInvoice rows whose invoiceDate falls in the
    // same window and aggregate. The full per-row report shape is
    // available via the standalone generateInputVatReport() — here we
    // only inline the totals so callers of generateOutputVatReport can
    // compute the net VAT payable in one call:
    //
    //     net = output.totals.vatAmount − output.inputVat.vatAmount
    //
    // When the PurchaseInvoice delegate is missing (CI bootstrap before
    // the 20260518000000_purchase_invoice migration) we fall back to
    // the legacy tracked:false marker so existing callers / tests
    // survive the transition window.
    const inputVatSummary = await collectInputVatSummary({
        prisma, start, end, organizationId,
    });
    const inputVatBlock = inputVatSummary
        ? {
            tracked: true,
            taxableAmount: inputVatSummary.taxableAmount,
            vatAmount: inputVatSummary.vatAmount,
            rowCount: inputVatSummary.rowCount,
        }
        : inputVatFallback;

    const outputVatNetOfAdjustments = round2(totalVat + adjustments.netVat);
    const outputTaxableNetOfAdjustments = round2(totalTaxable + adjustments.netTaxable);
    const netVatPayable = inputVatBlock.tracked
        ? round2(outputVatNetOfAdjustments - inputVatBlock.vatAmount)
        : null;

    return {
        period,
        seller,
        rows,
        totals: {
            // Net the CN (subtract) / DN (add) into the headline VAT total
            // so the ภ.พ.30 figure is correct end-to-end. taxableAmount is
            // adjusted in the same direction (the base + the VAT move
            // together — ม.86/4 keeps them coupled).
            taxableAmount: outputTaxableNetOfAdjustments,
            vatAmount: outputVatNetOfAdjustments,
            rowCount: rows.length + adjustments.rowCount,
            // Pre-adjustment figures retained so the finance officer can
            // see the breakdown if needed.
            outputVatBeforeAdjustments: round2(totalVat),
            outputVatAdjustments: adjustments.netVat,
            // Iter 26 — net VAT payable to RD per ม.82/3. Null when
            // Input VAT cannot be computed (legacy fallback path).
            netVatPayable,
        },
        adjustments,
        inputVat: inputVatBlock,
    };
}

/**
 * Aggregate APPROVED PurchaseInvoice rows whose invoiceDate falls in the
 * (start, end) window. Returns `{ taxableAmount, vatAmount, rowCount }`
 * with rounded numbers, or null when the PurchaseInvoice delegate is
 * unavailable (CI / pre-migration). Pure-ish — only reads.
 *
 * Per ป.รัษฎากร ม.82/4 we count only APPROVED rows: PENDING_REVIEW /
 * REJECTED purchases do NOT yet qualify for an Input VAT credit
 * because the platform has not yet confirmed the supplier invoice
 * meets the ม.86/4 minima.
 *
 * @private
 */
async function collectInputVatSummary({ prisma, start, end, organizationId }) {
    if (!prisma || !prisma.purchaseInvoice || typeof prisma.purchaseInvoice.findMany !== 'function') {
        return null;
    }
    const where = {
        isDeleted: false,
        status: 'APPROVED',
        invoiceDate: { gte: start, lt: end },
    };
    if (organizationId) {
        where.organizationId = organizationId;
    }
    let rows;
    try {
        rows = await prisma.purchaseInvoice.findMany({
            where,
            select: {
                id: true,
                subtotal: true,
                vat: true,
                totalAmount: true,
            },
        });
    } catch (err) {
        logger.warn(`[vat-report] input-VAT aggregate scan failed: ${err?.message}`);
        return null;
    }
    let taxableAmount = 0;
    let vatAmount = 0;
    for (const row of rows) {
        taxableAmount += Number(row.subtotal) || 0;
        vatAmount     += Number(row.vat)      || 0;
    }
    return {
        taxableAmount: round2(taxableAmount),
        vatAmount: round2(vatAmount),
        rowCount: rows.length,
    };
}

/**
 * Generate the Input-VAT (ภาษีซื้อ) report for one month — companion to
 * `generateOutputVatReport`. Sources every APPROVED PurchaseInvoice row
 * whose invoiceDate falls in the (start, end) window and renders one
 * report row per supplier invoice in the RD e-Filing field order.
 *
 * Per ป.รัษฎากร ม.82/3 + ม.82/4 + ม.83/8 the Input VAT total here is
 * directly subtractable from the Output VAT total of the same period
 * to compute the net amount payable on ภ.พ.30.
 *
 * @param {object} args
 * @param {number|string} args.year
 * @param {number|string} args.month
 * @param {string|null}   [args.organizationId]
 * @returns {Promise<object>}  { period, seller, rows, totals, source }
 */
async function generateInputVatReport({ year, month, organizationId = null } = {}) {
    const { start, end } = toMonthBoundaries(year, month);
    const period = {
        year: Number(year),
        month: Number(month),
        monthThai: monthThai(month),
        // ม.83/8 — e-filing deadline (15th of next month).
        filingDueDate: new Date(Date.UTC(
            Number(year),
            Number(month),
            15, 0, 0, 0, 0,
        )),
        windowStart: start,
        windowEnd: end,
    };
    const seller = buildSellerHeader();

    const prisma = resolvePrisma();
    if (!prisma || !prisma.purchaseInvoice || typeof prisma.purchaseInvoice.findMany !== 'function') {
        logger.warn(
            '[vat-report] PurchaseInvoice delegate unavailable — '
            + 'returning empty Input VAT report. '
            + '(Expected in CI before prisma generate; production deploys must have it.)',
        );
        return {
            period,
            seller,
            rows: [],
            totals: { taxableAmount: 0, vatAmount: 0, rowCount: 0 },
            source: 'unavailable',
        };
    }

    const where = {
        isDeleted: false,
        status: 'APPROVED',
        invoiceDate: { gte: start, lt: end },
    };
    if (organizationId) {
        where.organizationId = organizationId;
    }

    let purchaseRows;
    try {
        purchaseRows = await prisma.purchaseInvoice.findMany({
            where,
            orderBy: { invoiceDate: 'asc' },
            select: {
                id: true,
                invoiceNumber: true,
                supplierName: true,
                supplierTaxId: true,
                supplierAddress: true,
                invoiceDate: true,
                subtotal: true,
                vat: true,
                totalAmount: true,
                category: true,
                description: true,
                organizationId: true,
            },
        });
    } catch (err) {
        logger.error(`[vat-report] purchaseInvoice.findMany failed: ${err?.message}`);
        throw Object.assign(new Error('Failed to load purchase invoices for Input VAT report'), {
            code: 'INPUT_VAT_REPORT_QUERY_FAILED',
            cause: err,
        });
    }

    const rows = [];
    let totalTaxable = 0;
    let totalVat = 0;
    for (const r of purchaseRows) {
        const taxable = round2(Number(r.subtotal));
        const vat     = round2(Number(r.vat));
        rows.push({
            invoiceDate: r.invoiceDate,
            invoiceNumber: r.invoiceNumber,
            supplierName: r.supplierName,
            // ม.86/4 — seller TIN required on Input VAT side too.
            supplierTaxId: r.supplierTaxId,
            supplierAddress: r.supplierAddress || null,
            taxableAmount: taxable,
            vatAmount: vat,
            totalAmount: round2(Number(r.totalAmount)),
            category: r.category,
            description: r.description || null,
            // Diagnostics — useful for in-app preview only.
            purchaseInvoiceId: r.id,
        });
        totalTaxable += taxable;
        totalVat     += vat;
    }

    return {
        period,
        seller,
        rows,
        totals: {
            taxableAmount: round2(totalTaxable),
            vatAmount: round2(totalVat),
            rowCount: rows.length,
        },
        source: 'purchase_invoices',
    };
}

/**
 * Collect credit-note + debit-note POSTED rows whose POSTED date falls in
 * the report window. Returns the net taxableAmount + VAT impact along
 * with a row-level breakdown for the report's `adjustments` block.
 *
 * Per ป.รัษฎากร ม.86/10 / ม.86/9, the adjustment is recognised in the
 * period the CN/DN is POSTED (not the period of the original invoice).
 * Filter is on `postedAt` for that reason — DRAFT / ISSUED rows are
 * excluded (no GL effect yet).
 *
 * @private
 */
async function collectCnDnAdjustments({ prisma, start, end, organizationId }) {
    const result = {
        netVat: 0,
        netTaxable: 0,
        rowCount: 0,
        creditNotes: [],
        debitNotes: [],
    };

    // CN — POSTED rows in the window. Skip rows whose journal entry has
    // been recorded (those are already captured via the OUTPUT_VAT
    // accountCode filter) — we look at the `journalEntryId` link metadata
    // if/when the journal-entry-service writes it back. For now, we scan
    // ALL POSTED CN rows; the finance officer reconciles. The side-effect
    // is benign during transition because the fallback path (B20-A) does
    // NOT write a JournalLine — so until B20-B lands, this block is the
    // ONLY way the VAT report sees the adjustment, and after B20-B lands
    // the duplicate will be visible to the wire-in author and they can
    // add an idempotency filter.
    if (prisma && prisma.creditNote && typeof prisma.creditNote.findMany === 'function') {
        try {
            const cnWhere = {
                isDeleted: false,
                status: 'POSTED',
                postedAt: { gte: start, lt: end },
            };
            if (organizationId) {cnWhere.organizationId = organizationId;}
            const cnRows = await prisma.creditNote.findMany({
                where: cnWhere,
                select: {
                    id: true, creditNoteNumber: true, postedAt: true,
                    reasonCode: true, subtotal: true, vat: true, totalAmount: true,
                    originalInvoice: { select: { invoiceNumber: true } },
                },
            });
            for (const row of cnRows) {
                const vat = round2(Number(row.vat) || 0);
                const taxable = round2(Number(row.subtotal) || 0);
                // Credit notes REDUCE output VAT.
                result.netVat -= vat;
                result.netTaxable -= taxable;
                result.rowCount += 1;
                result.creditNotes.push({
                    creditNoteNumber: row.creditNoteNumber,
                    originalInvoiceNumber: row.originalInvoice?.invoiceNumber || null,
                    postedAt: row.postedAt,
                    reasonCode: row.reasonCode,
                    taxableAmount: taxable,
                    vatAmount: vat,
                    direction: 'REDUCTION',
                });
            }
        } catch (err) {
            logger.warn(`[vat-report] credit-note adjustment scan failed: ${err?.message}`);
        }
    }

    // DN — POSTED rows in the window. Symmetrical to CN.
    if (prisma && prisma.debitNote && typeof prisma.debitNote.findMany === 'function') {
        try {
            const dnWhere = {
                isDeleted: false,
                status: 'POSTED',
                postedAt: { gte: start, lt: end },
            };
            if (organizationId) {dnWhere.organizationId = organizationId;}
            const dnRows = await prisma.debitNote.findMany({
                where: dnWhere,
                select: {
                    id: true, debitNoteNumber: true, postedAt: true,
                    reasonCode: true, subtotal: true, vat: true, totalAmount: true,
                    originalInvoice: { select: { invoiceNumber: true } },
                },
            });
            for (const row of dnRows) {
                const vat = round2(Number(row.vat) || 0);
                const taxable = round2(Number(row.subtotal) || 0);
                // Debit notes ADD to output VAT.
                result.netVat += vat;
                result.netTaxable += taxable;
                result.rowCount += 1;
                result.debitNotes.push({
                    debitNoteNumber: row.debitNoteNumber,
                    originalInvoiceNumber: row.originalInvoice?.invoiceNumber || null,
                    postedAt: row.postedAt,
                    reasonCode: row.reasonCode,
                    taxableAmount: taxable,
                    vatAmount: vat,
                    direction: 'ADDITION',
                });
            }
        } catch (err) {
            logger.warn(`[vat-report] debit-note adjustment scan failed: ${err?.message}`);
        }
    }

    result.netVat = round2(result.netVat);
    result.netTaxable = round2(result.netTaxable);
    return result;
}

// ── CSV serialisation ──────────────────────────────────────────────────────

/**
 * Escape a single field per RFC 4180:
 *   - Fields containing a comma, double-quote, CR, or LF are wrapped in
 *     double-quotes; internal double-quotes are doubled.
 *   - Dates serialise as YYYY-MM-DD (the RD e-Filing portal accepts
 *     this; ISO 8601 with a time component is rejected by some forms).
 *   - null / undefined → empty string.
 */
function csvEscape(value) {
    if (value === null || value === undefined) {return '';}
    let str;
    if (value instanceof Date) {
        // YYYY-MM-DD of the Bangkok day — the date the tax invoice carries.
        // A UTC slice printed the day before for anything issued between
        // 00:00 and 06:59 in Bangkok, and disagreed with the Bangkok month
        // the row was filed under.
        str = getZonedParts(value).isoDate;
    } else if (typeof value === 'number') {
        // Decimal-form with 2 decimal places — matches the RD e-Filing
        // expectation that amounts are non-localised dotted decimals.
        str = value.toFixed(2);
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
 * RD e-Filing column headers (Thai) — per ประกาศกรมสรรพากร ฉบับที่
 * 200/2562 §3 "รายงานภาษีขาย (Output VAT)" template.
 *
 * The published template carries a wider set of optional columns
 * (branch code, document type code, etc.); the seven columns below
 * are the required minimum that the RD e-Filing upload accepts. The
 * first column ("ลำดับ") is the row sequence — useful for the
 * preparer to cross-reference paper backups against the upload.
 */
const CSV_HEADERS = Object.freeze([
    'ลำดับ',
    'เลขที่ใบกำกับภาษี',
    'วันที่ออกใบกำกับ',
    'ชื่อผู้ซื้อ',
    'เลขประจำตัวผู้เสียภาษีผู้ซื้อ',
    'มูลค่าสินค้า/บริการ',
    'จำนวนภาษี',
]);

/**
 * Generate the ภ.พ.30 Output-VAT CSV ready for RD e-Filing upload.
 *
 * Encoding contract:
 *   - UTF-8 with BOM (so Excel renders Thai correctly on Windows).
 *   - CRLF line endings (Excel + RD portal compatibility).
 *   - Two-decimal numbers, dot decimal separator (no thousand commas).
 *   - One footer row with the period totals — RD's template uses a
 *     "รวมทั้งสิ้น" label in the first non-numeric column.
 *
 * @param {object} args  same shape as generateOutputVatReport
 * @returns {Promise<string>} the CSV body (string; caller writes bytes)
 */
async function generateOutputVatReportCSV(args = {}) {
    const report = await generateOutputVatReport(args);
    return reportToCsv(report);
}

/**
 * Synchronous in-memory CSV serialiser — split out so tests can call it
 * directly without round-tripping through the DB.
 *
 * @param {object} report  shape returned by generateOutputVatReport
 * @returns {string} CSV body
 */
function reportToCsv(report) {
    const lines = [];
    const headerRow = CSV_HEADERS.map(csvEscape).join(',');
    lines.push(headerRow);

    let seq = 0;
    for (const row of report.rows || []) {
        seq += 1;
        const cols = [
            seq,
            row.invoiceNumber,
            row.invoiceDate,
            row.buyerName,
            row.buyerTaxId,
            row.taxableAmount,
            row.vatAmount,
        ];
        lines.push(cols.map(csvEscape).join(','));
    }

    // Footer row — totals. The label sits in the buyer-name column so
    // Excel's auto-sum lands in the same columns as the data above. We
    // leave the first three columns blank (ลำดับ / invoice-number /
    // invoice-date) and put 'รวมทั้งสิ้น' in the buyer-name slot per
    // RD's published template.
    const totals = report.totals || { taxableAmount: 0, vatAmount: 0 };
    const totalsRow = [
        '',                      // ลำดับ
        '',                      // เลขที่ใบกำกับภาษี
        '',                      // วันที่ออกใบกำกับ
        'รวมทั้งสิ้น',           // ชื่อผู้ซื้อ → label
        '',                      // เลขประจำตัวผู้เสียภาษีผู้ซื้อ
        round2(totals.taxableAmount),
        round2(totals.vatAmount),
    ];
    lines.push(totalsRow.map(csvEscape).join(','));

    return UTF8_BOM + lines.join(CSV_EOL) + CSV_EOL;
}

// ── Period-close warning ───────────────────────────────────────────────────

/**
 * Inspect whether the requested month can be closed for ภ.พ.30 filing.
 *
 * The period is closable when there are NO pending (unpaid) PLATFORM
 * invoices whose due-date / creation-date falls within the period. If
 * a pending invoice exists in the period, the finance officer should
 * resolve it (either let it land as a paid receipt this month, or
 * cancel it) before filing — otherwise a late payment will fall into
 * an already-filed period and require an amended return.
 *
 * Heuristic:
 *   - PENDING invoices are those with status='pending' (or 'overdue')
 *     AND isDeleted=false in the period.
 *   - We consider PLATFORM invoices only (serviceType ends '_PLATFORM_FEE'
 *     or starts 'SUBSCRIPTION_'); STATE invoices never appear on the
 *     platform's ภ.พ.30 (state revenue is VAT-exempt).
 *
 * @param {object} args
 * @param {number|string} args.year
 * @param {number|string} args.month
 * @param {string|null} [args.organizationId]
 * @returns {Promise<{ closable: boolean, lastPaidInvoiceDate: Date|null,
 *   openInvoices: number, warnings: string[] }>}
 */
async function checkPeriodClosable({ year, month, organizationId = null } = {}) {
    const { start, end } = toMonthBoundaries(year, month);
    const warnings = [];

    const prisma = resolvePrisma();
    if (!prisma) {
        warnings.push(
            'Prisma client unavailable — closable check could not query the database. '
            + 'Defaulting to NOT closable so finance does not file blind.',
        );
        return {
            closable: false,
            lastPaidInvoiceDate: null,
            openInvoices: 0,
            warnings,
        };
    }

    // Pending invoices in the window. The exact column tracked depends
    // on whether the invoice has been paid yet: for un-paid invoices we
    // look at createdAt (when the invoice was issued); for paid we look
    // at paidAt (the recognition date). Both are common to land in the
    // same month for our flow, so the createdAt-based filter catches
    // every still-open invoice in the period.
    let openInvoices = 0;
    let lastPaidInvoiceDate = null;
    try {
        const pendingCount = await prisma.invoice.count({
            where: {
                isDeleted: false,
                status: { in: ['pending', 'overdue', 'PENDING', 'OVERDUE'] },
                // Pending invoices issued within the period window
                createdAt: { gte: start, lt: end },
                ...(organizationId ? { organizationId } : {}),
            },
        }).catch(() => 0);

        openInvoices = pendingCount;

        // Most-recent PAID invoice in the period — useful for the UI
        // banner "ใบกำกับภาษีล่าสุด: 2026-05-14".
        const lastPaid = await prisma.invoice.findFirst({
            where: {
                isDeleted: false,
                status: { in: ['paid', 'PAID'] },
                paidAt: { gte: start, lt: end },
                ...(organizationId ? { organizationId } : {}),
            },
            orderBy: { paidAt: 'desc' },
            select: { paidAt: true },
        }).catch(() => null);
        lastPaidInvoiceDate = lastPaid ? lastPaid.paidAt : null;
    } catch (err) {
        logger.warn(`[vat-report] checkPeriodClosable query failed: ${err?.message}`);
        warnings.push(`Query failed: ${err?.message || 'unknown error'}`);
    }

    if (openInvoices > 0) {
        warnings.push(
            `Found ${openInvoices} pending invoice(s) created in the period. `
            + 'A late payment will fall into a closed period and require an '
            + 'amended ภ.พ.30 (เพิ่มเติม) resolve before filing.',
        );
    }

    return {
        closable: openInvoices === 0,
        lastPaidInvoiceDate,
        openInvoices,
        warnings,
    };
}

module.exports = {
    generateOutputVatReport,
    generateOutputVatReportCSV,
    // Iter 26 (2026-05-16) — Input VAT (ภาษีซื้อ) per ม.82/3 + ม.82/4.
    generateInputVatReport,
    checkPeriodClosable,
    // Exposed for tests + future input-VAT companion module:
    OUTPUT_VAT_ACCOUNT_CODES,
    INPUT_VAT_ACCOUNT_CODES,
    CSV_HEADERS,
    UTF8_BOM,
    CSV_EOL,
    // Pure helpers exposed for unit tests so the CSV writer can be
    // exercised without a Prisma round-trip.
    _internals: {
        toMonthBoundaries,
        monthThai,
        classifyBuyer,
        resolveTaxableAmount,
        csvEscape,
        reportToCsv,
        round2,
        // B20-A — credit/debit-note adjustment collector, exposed so
        // tests can probe its behaviour without round-tripping through
        // generateOutputVatReport's heavier JournalLine query path.
        collectCnDnAdjustments,
        // Iter 26 — Input VAT aggregator (separately testable).
        collectInputVatSummary,
    },
};
