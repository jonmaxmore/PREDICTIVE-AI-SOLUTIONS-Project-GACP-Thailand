/**
 * Receipt Numbering Service — Canonical allocator + Thai-numeral formatter
 *
 * Batch 16-D (PDF / document engineer, 2026-05-16).
 *
 * Responsibility:
 *   - Allocate a strictly-monotonic receipt number per (prefix, year) bucket,
 *     using the `ReceiptSequence` table introduced by B16-A.
 *   - Format the allocated number per issuer convention:
 *       DTAM       → `RCP-DTAM-๒๕๖๙-๐๐๐๐๐๑` (Thai numerals + Buddhist Era year)
 *       PLATFORM   → `TAX-PRD-2026-000001`    (Arabic numerals + Common Era year)
 *   - Expose pure utility functions (`toThaiNumerals`, `toBuddhistYear`,
 *     `formatReceiptNumber`) for use by the PDF template layer.
 *
 * Why two number streams (DTAM vs PLATFORM):
 *   - DTAM receipts are government revenue documents (ใบเสร็จเงินรายได้แผ่นดิน).
 *     Convention says they should be presented in Thai numerals with the
 *     Buddhist Era year — it's a finance-statute-driven aesthetic and matches
 *     other government documents farmers/auditors see.
 *   - PLATFORM tax invoices (ใบกำกับภาษีเต็มรูป) are commercial documents that
 *     a B2B customer may need to export to FlowAccount, foreign exchange
 *     bookkeeping, or auditor PDFs. Keeping them in Arabic numerals + CE year
 *     means no transliteration step on import.
 *
 * Concurrency model:
 *   The Prisma-backed path performs `prisma.receiptSequence.upsert(...)` inside
 *   a serializable transaction. The `(prefix, year)` row gets a ROW EXCLUSIVE
 *   lock for the duration of the increment, so two concurrent allocators
 *   serialise rather than collide. The first allocator that lands on a new
 *   (prefix, year) pair creates the row at counter=1; subsequent allocators
 *   on the same bucket bump the counter atomically.
 *
 * Database-only allocation (R5-B, 2026-05-17):
 *   The historical in-memory fallback Map has been removed. All allocations
 *   now flow through `_allocateFromPrisma`. When the Prisma delegate is
 *   unavailable the allocator throws `RECEIPT_SEQUENCE_DB_UNAVAILABLE`
 *   instead of silently issuing duplicate-prone numbers — every environment
 *   that issues receipts (test, dev, staging, production) MUST have the
 *   ReceiptSequence migration applied. Use `assertCanonicalAllocator()` at
 *   boot to fail loud rather than at first receipt.
 *
 * @module services/receipt-numbering-service
 */

const { createLogger } = require('../shared/logger');
const {
    buildDtamReceiptNumber,
    buildPlatformTaxInvoiceNumber,
    buildPlatformReceiptNumber,
    getBuddhistYear,
    getChristianYear,
    SCHEMES,
} = require('./document-numbering');

const { allocateSequenceCounter } = require('./receipt-sequence-counter');

const logger = createLogger('receipt-numbering-service');

// ── Issuer constants ─────────────────────────────────────────────────────────
const ISSUER = Object.freeze({
    DTAM: 'DTAM',
    PLATFORM: 'PLATFORM',
    PLATFORM_RECEIPT: 'PLATFORM_RECEIPT', // ใบเสร็จรับเงิน (non-tax-invoice) variant
    // B20-A (2026-05-16): Credit Note (ใบลดหนี้) ม.86/10 + Debit Note
    // (ใบเพิ่มหนี้) ม.86/9. Platform-side only — DTAM state-fee
    // corrections happen via the กรมบัญชีกลาง refund process, not via
    // CN/DN on the platform's books, so there is no DTAM_* counterpart.
    CREDIT_NOTE_PLATFORM: 'CREDIT_NOTE_PLATFORM',
    DEBIT_NOTE_PLATFORM: 'DEBIT_NOTE_PLATFORM',
});

const ISSUER_TO_PREFIX = Object.freeze({
    [ISSUER.DTAM]: 'RCP-DTAM',
    [ISSUER.PLATFORM]: 'TAX-PRD',
    [ISSUER.PLATFORM_RECEIPT]: 'RCP-PRD',
    [ISSUER.CREDIT_NOTE_PLATFORM]: 'CN-PRD',
    [ISSUER.DEBIT_NOTE_PLATFORM]: 'DN-PRD',
});

// Which issuers render the number in Thai numerals (cultural convention).
// CN/DN are PLATFORM-side commercial documents (FlowAccount + auditor
// friendly) — Arabic numerals + CE year, same as TAX-PRD-*.
const ISSUERS_USING_THAI_NUMERALS = new Set([ISSUER.DTAM]);

// ── Thai-numeral conversion ──────────────────────────────────────────────────

// U+0E50..U+0E59 are the Thai digits ๐..๙. Mapping is positional with
// Arabic 0..9, so a single charCode shift converts an entire string in O(n).
const THAI_DIGITS = ['๐', '๑', '๒', '๓', '๔', '๕', '๖', '๗', '๘', '๙'];

/**
 * Convert all Arabic digits in a number/string to Thai digits.
 *
 *   toThaiNumerals(0)        → '๐'
 *   toThaiNumerals(123)      → '๑๒๓'
 *   toThaiNumerals('2569')   → '๒๕๖๙'
 *   toThaiNumerals('00001')  → '๐๐๐๐๑'   (preserves padding)
 *   toThaiNumerals('A-12-B') → 'A-๑๒-B'  (only digits substituted)
 *
 * @param {string|number} input
 * @returns {string}
 */
function toThaiNumerals(input) {
    if (input === null || input === undefined) { return ''; }
    const s = String(input);
    let out = '';
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c >= 48 && c <= 57) {
            out += THAI_DIGITS[c - 48];
        } else {
            out += s[i];
        }
    }
    return out;
}

// ── Calendar helpers ─────────────────────────────────────────────────────────

/**
 * Convert a Date (or year) to Buddhist Era. Accepts:
 *   - a Date instance        → year + 543
 *   - a CE year number       → year + 543
 *   - a BE year number ≥2500 → returned unchanged (idempotent)
 *
 * Idempotency keeps the helper safe to call twice without doubling 543.
 *
 * @param {Date|number} input
 * @returns {number}
 */
function toBuddhistYear(input) {
    if (input instanceof Date) {
        return getBuddhistYear(input);
    }
    if (Number.isInteger(input)) {
        if (input >= 2500 && input <= 9999) { return input; }  // already BE
        if (input >= 1900 && input < 2500) { return input + 543; }
    }
    throw new TypeError(
        `[receipt-numbering] toBuddhistYear: invalid input ${String(input)}`,
    );
}

/**
 * Convert a Date (or year) to Common Era. Symmetric with toBuddhistYear.
 *   - Date                       → calendar year
 *   - CE year number             → unchanged
 *   - BE year number (≥2500)     → year - 543
 *
 * @param {Date|number} input
 * @returns {number}
 */
function toChristianYear(input) {
    if (input instanceof Date) {
        return getChristianYear(input);
    }
    if (Number.isInteger(input)) {
        if (input >= 1900 && input < 2500) { return input; }   // already CE
        if (input >= 2500 && input <= 9999) { return input - 543; }
    }
    throw new TypeError(
        `[receipt-numbering] toChristianYear: invalid input ${String(input)}`,
    );
}

// ── Pure formatter (no allocation, no DB) ────────────────────────────────────

/**
 * Format a receipt number from its three components. Pure — no side effects.
 *
 *   formatReceiptNumber('RCP-DTAM', 2569, 1)                   → 'RCP-DTAM-2569-000001'
 *   formatReceiptNumber('RCP-DTAM', 2569, 1, { useThaiNumerals: true })
 *     → 'RCP-DTAM-๒๕๖๙-๐๐๐๐๐๑'
 *   formatReceiptNumber('TAX-PRD', 2026, 1)                    → 'TAX-PRD-2026-000001'
 *
 * @param {string} prefix
 * @param {number} year   already-resolved (BE for DTAM, CE for PLATFORM)
 * @param {number} sequence
 * @param {object} [opts]
 * @param {boolean} [opts.useThaiNumerals=false]   convert year + sequence to Thai numerals
 * @param {number}  [opts.padding=6]
 * @returns {string}
 */
function formatReceiptNumber(prefix, year, sequence, opts = {}) {
    if (typeof prefix !== 'string' || !prefix) {
        throw new TypeError('[receipt-numbering] formatReceiptNumber: prefix required');
    }
    if (!Number.isInteger(year)) {
        throw new TypeError('[receipt-numbering] formatReceiptNumber: year must be integer');
    }
    if (!Number.isInteger(sequence) || sequence < 1) {
        throw new RangeError('[receipt-numbering] formatReceiptNumber: sequence must be a positive integer');
    }
    const padding = opts.padding || 6;
    const paddedSeq = String(sequence).padStart(padding, '0');
    if (opts.useThaiNumerals) {
        return `${prefix}-${toThaiNumerals(year)}-${toThaiNumerals(paddedSeq)}`;
    }
    return `${prefix}-${year}-${paddedSeq}`;
}

// ── Canonical allocator ──────────────────────────────────────────────────────

// The (prefix, year) counter itself lives in receipt-sequence-counter.js (no logger,
// no formatter) so number schemes that are not receipts can share the series.
const _allocateFromPrisma = allocateSequenceCounter;

/**
 * Allocate the next canonical receipt number for an issuer.
 *
 *   await allocateReceiptNumber({ issuer: 'DTAM', dateOrYear: new Date('2026-05-16') })
 *     → 'RCP-DTAM-๒๕๖๙-๐๐๐๐๐๑'    (Thai numerals — government convention)
 *
 *   await allocateReceiptNumber({ issuer: 'PLATFORM', dateOrYear: new Date('2026-05-16') })
 *     → 'TAX-PRD-2026-000001'      (Arabic — B2B / FlowAccount-friendly)
 *
 *   await allocateReceiptNumber({ issuer: 'PLATFORM_RECEIPT', dateOrYear: 2026 })
 *     → 'RCP-PRD-2026-000001'
 *
 * @param {object} args
 * @param {string} args.issuer            'DTAM' | 'PLATFORM' | 'PLATFORM_RECEIPT'
 * @param {Date|number} [args.dateOrYear] defaults to new Date()
 * @param {object} [args.prismaClient]    inject for test isolation
 * @returns {Promise<{ number: string, prefix: string, year: number, sequence: number, useThaiNumerals: boolean }>}
 */
async function allocateReceiptNumber({ issuer, dateOrYear, prismaClient } = {}) {
    const prefix = ISSUER_TO_PREFIX[issuer];
    if (!prefix) {
        throw new TypeError(
            `[receipt-numbering] allocateReceiptNumber: unknown issuer "${issuer}" `
            + `(expected one of: ${Object.keys(ISSUER_TO_PREFIX).join(', ')})`,
        );
    }

    // Resolve the year per issuer convention.
    const useBuddhist = issuer === ISSUER.DTAM;
    let year;
    if (dateOrYear === undefined || dateOrYear === null) {
        year = useBuddhist ? toBuddhistYear(new Date()) : toChristianYear(new Date());
    } else {
        year = useBuddhist ? toBuddhistYear(dateOrYear) : toChristianYear(dateOrYear);
    }

    // Allocate the counter — DB-backed only (R5-B, 2026-05-17). If the Prisma
    // delegate is missing or the transaction errors, throw
    // RECEIPT_SEQUENCE_DB_UNAVAILABLE so the caller fails loud instead of
    // silently issuing duplicate-prone numbers from an in-memory counter.
    let sequence;
    try {
        const prisma = prismaClient || require('./prisma-database').prisma;
        sequence = await _allocateFromPrisma(prisma, prefix, year);
    } catch (err) {
        const reason = err && err.message ? err.message : String(err);
        logger.error(
            `[receipt-numbering] DB allocator failed — refusing to issue receipt number. `
            + `Run \`npx prisma migrate deploy\` to apply the ReceiptSequence migration. `
            + `Underlying: ${reason}`,
        );
        const wrapped = new Error(
            '[receipt-numbering] receipt-sequence DB unavailable — '
            + 'production must have the receipt-sequence migration applied — '
            + 'run `npx prisma migrate deploy`',
        );
        wrapped.code = 'RECEIPT_SEQUENCE_DB_UNAVAILABLE';
        wrapped.cause = err;
        throw wrapped;
    }

    const useThaiNumerals = ISSUERS_USING_THAI_NUMERALS.has(issuer);
    const number = formatReceiptNumber(prefix, year, sequence, { useThaiNumerals });

    return { number, prefix, year, sequence, useThaiNumerals };
}

// ── Service-type → issuer resolution (convenience) ──────────────────────────

/**
 * Map a canonical service type onto the issuer that will be on the receipt.
 *   *STATE_FEE          → DTAM            (government revenue receipt)
 *   *PLATFORM_FEE       → PLATFORM        (tax invoice)
 *   SUBSCRIPTION_*      → PLATFORM        (tax invoice)
 *
 * Tests rely on this so the routing matches `invoice-template-service.js`.
 *
 * @param {string} serviceType
 * @returns {string}  one of ISSUER.* values
 */
function resolveIssuerForServiceType(serviceType) {
    const normalized = String(serviceType || '').toUpperCase();
    if (normalized.includes('STATE_FEE')) { return ISSUER.DTAM; }
    return ISSUER.PLATFORM;
}

// ── Pre-formatted variable map for the PDF template layer ───────────────────

/**
 * Convenience for the PDF template service: given a *raw* allocation result
 * (or precomputed components) and an issuer, return the strings that go into
 * `{{RECEIPT_NUMBER}}`, `{{ISSUE_DATE}}` etc. — already converted to the
 * issuer's numeral convention.
 *
 *   formatReceiptVariablesForIssuer('DTAM', {
 *     receiptNumber: 'RCP-DTAM-2569-000001',
 *     issueDate: new Date('2026-05-16'),
 *     amount: 5535,
 *   })
 *     → {
 *         receiptNumber: 'RCP-DTAM-๒๕๖๙-๐๐๐๐๐๑',
 *         issueDate: '๑๖ พฤษภาคม พุทธศักราช ๒๕๖๙',
 *         amountText: 'ห้าพันห้าร้อยสามสิบห้าบาทถ้วน',
 *       }
 *
 * @param {string} issuer
 * @param {object} payload
 * @param {string} [payload.receiptNumber]    canonical (Arabic) form; will be
 *                                            transliterated for DTAM, untouched
 *                                            for PLATFORM
 * @param {Date|string} [payload.issueDate]
 * @param {number} [payload.amount]
 * @returns {{ receiptNumber: string|null, issueDate: string|null, amountText: string|null }}
 */
function formatReceiptVariablesForIssuer(issuer, payload = {}) {
    const { numberToThaiText } = require('../utils/number-to-thai-text');
    const { THAI_MONTHS_FULL } = require('../utils/thai-format');
    const { getZonedParts } = require('../utils/working-days');

    const result = { receiptNumber: null, issueDate: null, amountText: null };

    // 1) Receipt number
    if (payload.receiptNumber) {
        if (ISSUERS_USING_THAI_NUMERALS.has(issuer)) {
            result.receiptNumber = toThaiNumerals(payload.receiptNumber);
        } else {
            result.receiptNumber = String(payload.receiptNumber);
        }
    }

    // 2) Issue date
    if (payload.issueDate !== undefined && payload.issueDate !== null) {
        const d = payload.issueDate instanceof Date
            ? payload.issueDate
            : new Date(payload.issueDate);
        if (!Number.isNaN(d.getTime())) {
            // Printed date only: the Bangkok day of the payment, not the day
            // on the container's UTC clock (CODE-01, audit 2026-09-17).
            const parts = getZonedParts(d);
            if (ISSUERS_USING_THAI_NUMERALS.has(issuer)) {
                // ๑๖ พฤษภาคม พุทธศักราช ๒๕๖๙
                const day = toThaiNumerals(parts.day);
                const month = THAI_MONTHS_FULL[parts.month - 1];
                const year = toThaiNumerals(parts.year + 543);
                result.issueDate = `${day} ${month} พุทธศักราช ${year}`;
            } else {
                // 16 พฤษภาคม 2569 (compact Thai BE — readable for PLATFORM too)
                const day = String(parts.day);
                const month = THAI_MONTHS_FULL[parts.month - 1];
                const year = String(parts.year + 543);
                result.issueDate = `${day} ${month} ${year}`;
            }
        }
    }

    // 3) Amount text — both issuers use Thai script for the "ตัวอักษร"
    //    field. This is a legal requirement (ม.86/4 (5) ป.รัษฎากร — full tax
    //    invoice must show amount in Thai text) and a longstanding convention
    //    for government receipts.
    if (typeof payload.amount === 'number') {
        result.amountText = numberToThaiText(payload.amount);
    }

    return result;
}

/**
 * Boot-time sanity check. Logs a clear warning if the Prisma client doesn't
 * yet expose the `receiptSequence` model. Callers can `await` this in
 * `server.js` startup to make the misconfiguration loud rather than silent.
 *
 * @param {object} [prismaClient]
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function assertCanonicalAllocator(prismaClient) {
    try {
        const prisma = prismaClient || require('./prisma-database').prisma;
        if (!prisma || !prisma.receiptSequence || typeof prisma.receiptSequence.upsert !== 'function') {
            return { ok: false, reason: 'prisma.receiptSequence delegate unavailable' };
        }
        // A non-mutating probe — count() doesn't touch the row but proves the
        // delegate is wired to a real connection.
        await prisma.receiptSequence.count();
        return { ok: true };
    } catch (err) {
        return { ok: false, reason: err && err.message ? err.message : String(err) };
    }
}

module.exports = {
    ISSUER,
    ISSUER_TO_PREFIX,
    SCHEMES,
    toThaiNumerals,
    toBuddhistYear,
    toChristianYear,
    formatReceiptNumber,
    allocateReceiptNumber,
    allocateSequenceCounter,
    resolveIssuerForServiceType,
    formatReceiptVariablesForIssuer,
    assertCanonicalAllocator,
    // Re-export the underlying builders so callers that want a raw string
    // (no DB call, no allocation) can use them directly.
    buildDtamReceiptNumber,
    buildPlatformTaxInvoiceNumber,
    buildPlatformReceiptNumber,
};
