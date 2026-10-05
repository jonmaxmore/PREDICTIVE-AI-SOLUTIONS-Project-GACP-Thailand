/**
 * Document Numbering — Format + Parse helpers for financial documents
 *
 * System deep-dive Tier 13 — Backend + Compliance + DBA (2026-05-15).
 *
 * Implements the numbering schemes specified in
 * `docs/financial-documents/RECEIPT-DESIGN-SPEC.md §5`:
 *
 *   | Document Type             | Format                  | Example                |
 *   |---------------------------|-------------------------|------------------------|
 *   | DTAM revenue receipt      | RCP-DTAM-{พศ}-{seq6}    | RCP-DTAM-2569-000123   |
 *   | Platform tax invoice      | TAX-PRD-{ค.ศ.}-{seq6}   | TAX-PRD-2026-000123    |
 *   | Platform receipt          | RCP-PRD-{ค.ศ.}-{seq6}   | RCP-PRD-2026-000123    |
 *
 * Three separate numbering streams because:
 *   - DTAM uses Thai Buddhist Era (พ.ศ.) per government convention
 *   - Platform uses Christian Era (ค.ศ.) per Revenue Department (สรรพากร)
 *     filing requirements
 *   - Tax invoice + Receipt run as separate streams (each with its own
 *     yearly sequence) so a customer's tax invoice number and the receipt
 *     number for the same payment are distinct (allowed under ม.105
 *     ป.รัษฎากร when issued as separate documents)
 *
 * Year-boundary policy
 * ────────────────────
 * Sequences reset annually. Default: **calendar year** (1 January boundary):
 *   - DTAM: 1 ม.ค. starts a new พ.ศ. range
 *   - Platform: 1 ม.ค. starts a new ค.ศ. range
 *
 * Note: Thai government fiscal year is actually 1 ต.ค. — 30 ก.ย. (ปีถัดไป).
 * If Finance/DTAM later confirm they want DTAM receipt numbers to use the
 * fiscal-year boundary instead of the calendar-year boundary, override the
 * `referenceDate` -> year computation via the `FISCAL_YEAR_BOUNDARY` env
 * config. This file does NOT guess — it defaults to calendar year and
 * documents the alternative clearly.
 *
 * Sequence allocation
 * ───────────────────
 * This file is purely a **format / parse** helper. Sequence ALLOCATION
 * (atomic counter that survives concurrent invoice creation) is a separate
 * concern — see Tier 13 handoff: a future Tier 14 will add Postgres
 * SEQUENCE-backed allocator (mirroring the `gacp_certificate_seq` pattern
 * from Tier 2). Until then, callers MUST provide the `sequence` parameter
 * themselves (e.g. via `count() + 1` with concurrency caveats, or via a
 * dedicated `Counter` table row with `UPDATE ... RETURNING`).
 *
 * Backward compatibility
 * ──────────────────────
 * This file is ADDITIVE. The legacy `buildInvoiceNumber` in
 * `application-phase-invoice-methods.js` (format `INV-P1-ST-2569-...`)
 * is NOT removed by Tier 13 — existing invoices in the DB with the old
 * format continue to work. Tier 13 introduces these helpers so new code
 * + future migrations can adopt the canonical scheme. The legacy code
 * is annotated with a deprecation hint pointing to this file.
 */

const { localYear } = require('../utils/working-days');

const SCHEMES = Object.freeze({
    DTAM_RECEIPT: 'DTAM_RECEIPT',
    PLATFORM_TAX_INVOICE: 'PLATFORM_TAX_INVOICE',
    PLATFORM_RECEIPT: 'PLATFORM_RECEIPT',
});

// Default sequence-padding width. 6 digits = up to 999,999 documents/year/stream.
// Tier 12 spec §5 specifies 6 digits explicitly; configurable so a future
// jurisdiction (e.g. tax-invoice volume exceeds 6 digits) can extend without
// breaking format-parse symmetry.
const DEFAULT_SEQUENCE_PADDING = 6;

// Strict format regex per scheme — used by `parseDocumentNumber`.
// Year is constrained to 4 digits so a malformed input doesn't pass parsing.
const PARSE_REGEX = Object.freeze({
    [SCHEMES.DTAM_RECEIPT]: /^RCP-DTAM-(\d{4})-(\d{6,})$/,
    [SCHEMES.PLATFORM_TAX_INVOICE]: /^TAX-PRD-(\d{4})-(\d{6,})$/,
    [SCHEMES.PLATFORM_RECEIPT]: /^RCP-PRD-(\d{4})-(\d{6,})$/,
});

// ────────────────────────────────────────────────────────────────────────────
// Year helpers — pure functions for testability
// ────────────────────────────────────────────────────────────────────────────

/**
 * Buddhist Era year (พ.ศ.) — Thai government convention.
 * Default: calendar-year boundary (1 January).
 * @param {Date} [referenceDate=new Date()]
 * @returns {number}  4-digit พ.ศ.
 */
function getBuddhistYear(referenceDate = new Date()) {
    if (!(referenceDate instanceof Date) || Number.isNaN(referenceDate.getTime())) {
        throw new TypeError('[document-numbering] referenceDate must be a valid Date');
    }
    // The Bangkok year of the instant, not the process clock's (UTC in the
    // containers): the number year must equal the year the document prints.
    return localYear(referenceDate) + 543;
}

/**
 * Christian Era year (ค.ศ.) — Revenue Department (สรรพากร) convention.
 * @param {Date} [referenceDate=new Date()]
 * @returns {number}  4-digit ค.ศ.
 */
function getChristianYear(referenceDate = new Date()) {
    if (!(referenceDate instanceof Date) || Number.isNaN(referenceDate.getTime())) {
        throw new TypeError('[document-numbering] referenceDate must be a valid Date');
    }
    return localYear(referenceDate);
}

// ────────────────────────────────────────────────────────────────────────────
// Format builders
// ────────────────────────────────────────────────────────────────────────────

/**
 * Defensive sequence validator.
 * Accepts a positive integer; rejects everything else so we never emit a
 * malformed document number (which would break ม.86/4 (4) — invoice number
 * must be sequential and unique).
 */
function _validateSequence(sequence) {
    if (!Number.isInteger(sequence)) {
        throw new TypeError(
            `[document-numbering] sequence must be an integer, got ${typeof sequence}`,
        );
    }
    if (sequence < 1) {
        throw new RangeError(
            `[document-numbering] sequence must be >= 1, got ${sequence}`,
        );
    }
    // Hard cap at 9,999,999 (7-digit) to keep formatted numbers readable
    // even with overflow. Real-world volume nowhere near this.
    if (sequence > 9_999_999) {
        throw new RangeError(
            `[document-numbering] sequence overflow (${sequence}) — sequence stream needs a reset`,
        );
    }
    return sequence;
}

function _padSequence(sequence, padding = DEFAULT_SEQUENCE_PADDING) {
    // Pad to at least `padding` digits; sequences beyond that just get longer.
    return String(sequence).padStart(padding, '0');
}

/**
 * Build DTAM revenue-receipt number.
 * @param {object} args
 * @param {number} [args.year]                 พ.ศ. (default: current)
 * @param {Date}   [args.referenceDate]        if `year` omitted, use this date
 * @param {number} args.sequence               1..9,999,999
 * @param {number} [args.padding=6]
 * @returns {string}  e.g. "RCP-DTAM-2569-000123"
 */
function buildDtamReceiptNumber({ year, referenceDate, sequence, padding = DEFAULT_SEQUENCE_PADDING } = {}) {
    _validateSequence(sequence);
    const resolvedYear = year ?? getBuddhistYear(referenceDate);
    if (!Number.isInteger(resolvedYear) || resolvedYear < 2500 || resolvedYear > 9999) {
        throw new RangeError(
            `[document-numbering] DTAM year must be valid พ.ศ. (>=2500), got ${resolvedYear}`,
        );
    }
    return `RCP-DTAM-${resolvedYear}-${_padSequence(sequence, padding)}`;
}

/**
 * Build Platform tax-invoice number (ใบกำกับภาษีเต็มรูป).
 * @param {object} args
 * @param {number} [args.year]                 ค.ศ. (default: current)
 * @param {Date}   [args.referenceDate]
 * @param {number} args.sequence
 * @param {number} [args.padding=6]
 * @returns {string}  e.g. "TAX-PRD-2026-000123"
 */
function buildPlatformTaxInvoiceNumber({ year, referenceDate, sequence, padding = DEFAULT_SEQUENCE_PADDING } = {}) {
    _validateSequence(sequence);
    const resolvedYear = year ?? getChristianYear(referenceDate);
    if (!Number.isInteger(resolvedYear) || resolvedYear < 1900 || resolvedYear > 9999) {
        throw new RangeError(
            `[document-numbering] Platform year must be valid ค.ศ. (1900-9999), got ${resolvedYear}`,
        );
    }
    return `TAX-PRD-${resolvedYear}-${_padSequence(sequence, padding)}`;
}

/**
 * Build Platform receipt number (ใบเสร็จรับเงิน — ม.105 ป.รัษฎากร).
 * Same format-shape as tax invoice, distinct stream.
 */
function buildPlatformReceiptNumber({ year, referenceDate, sequence, padding = DEFAULT_SEQUENCE_PADDING } = {}) {
    _validateSequence(sequence);
    const resolvedYear = year ?? getChristianYear(referenceDate);
    if (!Number.isInteger(resolvedYear) || resolvedYear < 1900 || resolvedYear > 9999) {
        throw new RangeError(
            `[document-numbering] Platform year must be valid ค.ศ. (1900-9999), got ${resolvedYear}`,
        );
    }
    return `RCP-PRD-${resolvedYear}-${_padSequence(sequence, padding)}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Service-type → scheme resolver
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve which numbering scheme applies to a given canonical service type.
 *
 * Mapping:
 *   PHASE_1_STATE_FEE     → DTAM_RECEIPT       (รัฐออกใบเสร็จเงินรายได้)
 *   PHASE_2_STATE_FEE     → DTAM_RECEIPT       (รัฐออกใบเสร็จเงินรายได้)
 *   PHASE_1_PLATFORM_FEE  → PLATFORM_TAX_INVOICE  (Platform ออกใบกำกับภาษี)
 *   PHASE_2_PLATFORM_FEE  → PLATFORM_TAX_INVOICE  (Platform ออกใบกำกับภาษี)
 *
 * Note: PLATFORM_RECEIPT (ใบเสร็จรับเงิน) is a separate stream from the tax
 * invoice. If a single payment generates BOTH a tax invoice AND a receipt
 * (current Thai practice — they can be the same document or two documents),
 * the caller decides which scheme to use. This resolver returns the
 * primary scheme (TAX_INVOICE) — caller switches to PLATFORM_RECEIPT for
 * receipt-only document.
 *
 * @param {string} serviceType
 * @returns {string}  one of SCHEMES.* values
 * @throws TypeError on unknown serviceType
 */
function resolveSchemeFromServiceType(serviceType) {
    const normalized = String(serviceType || '').toUpperCase();
    if (normalized === 'PHASE_1_STATE_FEE' || normalized === 'PHASE_2_STATE_FEE') {
        return SCHEMES.DTAM_RECEIPT;
    }
    if (normalized === 'PHASE_1_PLATFORM_FEE' || normalized === 'PHASE_2_PLATFORM_FEE') {
        return SCHEMES.PLATFORM_TAX_INVOICE;
    }
    throw new TypeError(
        `[document-numbering] Unknown serviceType "${serviceType}". `
        + `Expected one of: PHASE_1_STATE_FEE, PHASE_2_STATE_FEE, `
        + `PHASE_1_PLATFORM_FEE, PHASE_2_PLATFORM_FEE.`,
    );
}

/**
 * Convenience: pick the right builder + format a document number in one call.
 * @param {object} args
 * @param {string} args.serviceType            canonical service type
 * @param {number} args.sequence
 * @param {Date}   [args.referenceDate]
 * @param {boolean} [args.asReceipt=false]     when true and serviceType is
 *                                             a PLATFORM type, returns
 *                                             RCP-PRD-... instead of TAX-PRD-...
 * @returns {string}
 */
function buildDocumentNumberForServiceType({
    serviceType, sequence, referenceDate, asReceipt = false,
} = {}) {
    const scheme = resolveSchemeFromServiceType(serviceType);
    if (scheme === SCHEMES.DTAM_RECEIPT) {
        return buildDtamReceiptNumber({ sequence, referenceDate });
    }
    // PLATFORM
    if (asReceipt) {
        return buildPlatformReceiptNumber({ sequence, referenceDate });
    }
    return buildPlatformTaxInvoiceNumber({ sequence, referenceDate });
}

// ────────────────────────────────────────────────────────────────────────────
// Parse
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse a formatted document number back into its components.
 * Returns null on no-match (callers can use this to test legacy vs canonical).
 *
 * @param {string} documentNumber
 * @returns {{ scheme: string, year: number, sequence: number } | null}
 */
function parseDocumentNumber(documentNumber) {
    const str = String(documentNumber || '');
    for (const [scheme, regex] of Object.entries(PARSE_REGEX)) {
        const m = str.match(regex);
        if (m) {
            return {
                scheme,
                year: Number.parseInt(m[1], 10),
                sequence: Number.parseInt(m[2], 10),
            };
        }
    }
    return null;
}

/**
 * Check whether a string is a valid canonical document number per Tier 12 spec §5.
 * Useful for migration scripts that need to distinguish legacy (INV-P1-ST-...)
 * from canonical (RCP-DTAM-..., TAX-PRD-..., RCP-PRD-...).
 */
function isCanonicalDocumentNumber(documentNumber) {
    return parseDocumentNumber(documentNumber) !== null;
}

module.exports = {
    SCHEMES,
    DEFAULT_SEQUENCE_PADDING,
    PARSE_REGEX,
    getBuddhistYear,
    getChristianYear,
    buildDtamReceiptNumber,
    buildPlatformTaxInvoiceNumber,
    buildPlatformReceiptNumber,
    resolveSchemeFromServiceType,
    buildDocumentNumberForServiceType,
    parseDocumentNumber,
    isCanonicalDocumentNumber,
};
