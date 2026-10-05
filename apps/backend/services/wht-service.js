/**
 * WHT (Withholding Tax 3%) Service — STUB for corporate-buyer self-withholding.
 *
 * Iter 26 (hardening loop, 2026-05-16). Companion to vat-report-service.js
 * (Output VAT) and credit-note-service.js (ม.86/10 adjustments). This
 * module is intentionally a STUB: it covers data collection + ทบ.50 ทวิ
 * recording on the platform's books, but DOES NOT auto-withhold at point
 * of sale and DOES NOT yet implement the monthly ภ.ง.ด.53 RD-remittance
 * pipeline. See docs/tax/wht-stub-2026-05-16.md for the full scope/
 * out-of-scope breakdown and the future-implementation roadmap.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Legal basis (ประมวลรัษฎากร / Thai Revenue Code)
 * ─────────────────────────────────────────────────────────────────────
 *
 *   - ป.รัษฎากร ม.50 — duty of the payer (ผู้จ่ายเงิน) to withhold tax
 *     when paying for services. For a corporate buyer paying a juristic
 *     supplier the standard withholding rate is 3% of the service fee
 *     (before VAT, by RD practice — VAT is computed on the gross then
 *     WHT computed on the gross excl-VAT).
 *   - ป.รัษฎากร ม.69 ทวิ — issuer of the withholding-tax certificate
 *     (หนังสือรับรองการหักภาษี ณ ที่จ่าย / ทบ.50 ทวิ). The payer is
 *     REQUIRED to issue ทบ.50 ทวิ to the payee at the same time the
 *     deduction is made, in 4 copies: 1 RD, 2 payee, 1 payer.
 *   - ภ.ง.ด.53 — monthly return that aggregates all 3% withholdings made
 *     by a juristic payer against juristic suppliers. Filed by the 7th
 *     of the following month (paper) / 15th (e-Filing) per ป.รัษฎากร
 *     ม.59 + ม.83/8. Out of scope for this stub.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Why this is a STUB (owner direction, ref invoice-issuers.js Tier 9 note)
 * ─────────────────────────────────────────────────────────────────────
 *
 * Owner clarification (Thai, verbatim, 2026-05-15):
 *   "ถ้าหัก 3% แล้วเสี่ยงผิดกฎหมาย หรือเราไม่ได้นำส่ง เอาออกก็ได้"
 *
 * Under Thai tax law the WHT remittance DUTY belongs to the PAYER (the
 * corporate buyer of the GACP-application service), not the platform
 * (the seller). If we were to auto-deduct 3% at point of sale without a
 * functioning monthly ภ.ง.ด.53 pipeline we would (a) hold unremitted
 * collected tax (criminal exposure under ม.50 + ม.91/1) and (b) shift a
 * liability the buyer owes to RD onto the platform's books. Neither is
 * acceptable.
 *
 * Therefore this service:
 *   1. Helps callers DECIDE whether WHT applies for a given buyer
 *      (`isCorporateBuyer`).
 *   2. Computes the indicative 3% / net split for downstream display
 *      (`computeWhtAmount`) — pure math, no persistence.
 *   3. RECORDS a ทบ.50 ทวิ certificate when the corporate buyer mails
 *      one to platform finance (`recordWhtCertificate`). Stored in
 *      Invoice.metadata.whtCertificate (Json) to avoid a Prisma migration.
 *   4. Lists captured certificates for future ภ.ง.ด.53 prep
 *      (`listWhtCertificates`).
 *
 * What this service explicitly DOES NOT do:
 *   - It NEVER deducts 3% at invoice creation or payment time. The
 *     PLATFORM invoice always issues at the FULL gross amount
 *     (subtotal + 7% VAT) — the corporate buyer self-withholds when
 *     they pay, issues ทบ.50 ทวิ back to the platform, and remits the
 *     3% to RD as part of THEIR ภ.ง.ด.53.
 *   - It does NOT emit a ภ.ง.ด.53 file (we are the seller, not the
 *     filer).
 *   - It does NOT generate a ทบ.50 ทวิ PDF — that is the buyer's
 *     responsibility; we only RECORD the cert they send us.
 *
 * Accounting treatment when a ทบ.50 ทวิ is received (optional, gated
 * behind `recordJournal: true`):
 *
 *     Dr. WHT Receivable (1320 — Tax Credit Receivable)   <wht>
 *       Cr. Revenue — Platform Fee (4110-001)                   <wht>
 *
 * Net effect: total revenue stays the same (gross) but a portion of the
 * cash position is reclassified as a prepaid-tax receivable (we will
 * claim it back when filing the platform's own ภ.ง.ด.50 corporate-tax
 * return at year-end). The journal hook is OPT-IN to avoid retroactively
 * editing journal entries already posted by journal-entry-service.js
 * (which has no knowledge of WHT yet — Iter 26 keeps the chart-of-
 * accounts change deferred until the WHT pipeline ships in earnest).
 *
 * @module services/wht-service
 */

'use strict';

const logger = require('../shared/logger');
const { normalizeRole, CANONICAL_ROLES } = require('../shared/canonical-rbac');

// Lazy-require Prisma so the service stays loadable in CI / Jest before
// `prisma generate` runs. Tests stub via jest.doMock; production resolves
// the real client. The "no Prisma" branch returns a structured error
// rather than a silent no-op so callers can surface it.
let prismaModule;
try {
    prismaModule = require('./prisma-database');
} catch (_e) {
    prismaModule = { prisma: null };
}

// Lazy-require the journal layer ONLY when the optional journal hook
// fires. Keeps the test surface small (no need to mock the journal in
// every WHT test) and matches the credit-note-service idiom.
function lazyJournalService() {
    try {
         
        return require('./journal-entry-service');
    } catch (_e) {
        return null;
    }
}

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Standard WHT rate for service fees paid to juristic suppliers under
 * ป.รัษฎากร ม.50 + RD practice 2554 (revised). The rate is intentionally
 * a module constant — Iter 26 does not support per-category overrides
 * (e.g. 5% for rental, 1% for transport) because the GACP platform
 * provides ONE service category (certification fees). Reopen this when
 * the catalogue widens.
 */
const DEFAULT_WHT_RATE = 0.03;

/**
 * Chart-of-accounts code for the WHT Receivable account. Reserved for
 * the future journal posting. NOT YET defined in journal-entry-service.js
 * ACCOUNTS — see header §"Accounting treatment". Adding it would mutate
 * the canonical ACCOUNTS export, which Iter 26 boundary forbids; the
 * code below uses a local descriptor only.
 */
const WHT_RECEIVABLE_ACCOUNT = Object.freeze({
    code: '1320-001',
    name: 'ภาษีหัก ณ ที่จ่ายค้างรับคืน (WHT Receivable)',
});

const PLATFORM_SERVICE_TYPES = new Set([
    'PHASE_1_PLATFORM_FEE',
    'PHASE_2_PLATFORM_FEE',
]);

// ด่านอ่าน — การเงินสองบทบาทเห็นชุดเดียวกัน (operator 2026-09-11) · ด่านเขียนแยกอยู่ข้างล่าง ไม่ขยาย
const READ_ROLES = new Set([
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
]);
// ผู้ตรวจประเมินไม่อยู่ในชุดอ่านเรื่องเงิน (operator 2026-09-27)

const WRITE_ROLES = new Set([
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
]);

// ── Pure helpers ───────────────────────────────────────────────────────────

function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

function makeError(code, message, statusCode = 400) {
    const e = new Error(message);
    e.code = code;
    e.statusCode = statusCode;
    return e;
}

function resolvePrisma(tx) {
    const client = tx || (prismaModule && prismaModule.prisma);
    if (!client) {return null;}
    // The proxy stub returns "anything" for unknown delegates; the real
    // client has invoice.update as a function — duck-type-check.
    if (!client.invoice || typeof client.invoice.update !== 'function') {
        return null;
    }
    return client;
}

// ── Public: classification ─────────────────────────────────────────────────

/**
 * Decide whether an applicant / entity is a corporate buyer for WHT
 * purposes. Only JURISTIC and COMPANY entities self-withhold under
 * ป.รัษฎากร ม.50; individuals (INDIVIDUAL / FARMER / etc.) do NOT have a
 * WHT obligation on service payments.
 *
 * The accepted shapes are flexible so callers from different layers
 * (Application → Entity, Invoice → applicant fallback, raw payload from
 * an admin form) all work without massage:
 *
 *   - `{ type: 'JURISTIC' }`        → true
 *   - `{ entityType: 'COMPANY' }`   → true
 *   - `{ type: 'INDIVIDUAL' }`      → false
 *   - `{ entity: { type: '...' } }` → unwrap once and re-evaluate
 *   - null / undefined              → false (defensive default)
 *
 * Per ป.รัษฎากร ม.50 the duty arises only when BOTH payer AND payee are
 * juristic persons. The platform (Predictive AI Solution Co., Ltd.) is
 * already juristic by definition; this helper checks the buyer side.
 *
 * @param {object|null} applicantOrEntity  flexible buyer descriptor
 * @returns {boolean}
 */
function isCorporateBuyer(applicantOrEntity) {
    if (!applicantOrEntity) {return false;}
    // Unwrap one level: callers commonly pass an Application or Invoice
    // that has the entity nested.
    if (applicantOrEntity.entity && typeof applicantOrEntity.entity === 'object') {
        return isCorporateBuyer(applicantOrEntity.entity);
    }
    const rawType = applicantOrEntity.type
        || applicantOrEntity.entityType
        || applicantOrEntity.buyerType
        || null;
    if (!rawType) {return false;}
    const t = String(rawType).toUpperCase();
    // JURISTIC is the canonical schema value (entity.prisma); COMPANY is
    // a common alias from legacy admin forms / external imports.
    return t === 'JURISTIC' || t === 'COMPANY';
}

// ── Public: math ───────────────────────────────────────────────────────────

/**
 * Compute the 3% WHT and the net amount the seller would receive if the
 * buyer self-withheld at point of payment. Pure math — no persistence.
 *
 * Rounding policy: WHT is rounded to 2 decimal places (THB-satang) using
 * Math.round (half-away-from-zero). Net is derived as gross − wht so the
 * two sides always reconcile exactly (no independent rounding of `net`,
 * which would risk a ฿0.01 drift).
 *
 * Examples (ม.50 standard 3%):
 *   computeWhtAmount(500)        → { wht: 15.00, net: 485.00 }
 *   computeWhtAmount(535)        → { wht: 16.05, net: 518.95 }
 *   computeWhtAmount(2500)       → { wht: 75.00, net: 2425.00 }
 *   computeWhtAmount(2675)       → { wht: 80.25, net: 2594.75 }
 *
 * @param {number}  grossAmount   the pre-WHT amount (typically subtotal
 *                                or subtotal+VAT — caller chooses; the
 *                                math is identical)
 * @param {number}  [rate=0.03]   override rate; default ม.50 service rate
 * @returns {{ wht: number, net: number, gross: number, rate: number }}
 * @throws  on negative gross or rate outside [0, 1]
 */
function computeWhtAmount(grossAmount, rate = DEFAULT_WHT_RATE) {
    const gross = round2(grossAmount);
    if (!Number.isFinite(gross) || gross < 0) {
        throw makeError(
            'INVALID_GROSS_AMOUNT',
            'grossAmount must be a non-negative number',
        );
    }
    const r = Number(rate);
    if (!Number.isFinite(r) || r < 0 || r > 1) {
        throw makeError(
            'INVALID_RATE',
            'rate must be between 0 and 1 (e.g. 0.03 for 3%)',
        );
    }
    const wht = round2(gross * r);
    const net = round2(gross - wht);
    return { wht, net, gross, rate: r };
}

// ── Public: certificate recording ──────────────────────────────────────────

/**
 * Record that a corporate buyer has issued a ทบ.50 ทวิ (withholding-tax
 * certificate) for an already-paid PLATFORM invoice. The cert payload is
 * stored on `Invoice.metadata.whtCertificate` (Json) so we avoid adding
 * a Prisma migration in this stub batch (out-of-scope per task
 * boundary). When the dedicated `wht_certificates` table ships in a
 * future iter, this writer becomes a thin shim.
 *
 * Legal references:
 *   - ป.รัษฎากร ม.50 — duty of payer to deduct.
 *   - ป.รัษฎากร ม.69 ทวิ — duty of payer to issue ทบ.50 ทวิ in 4 copies.
 *   - We are the PAYEE; we only RECEIVE and RECORD the cert.
 *
 * Validations:
 *   - invoice must exist and not be soft-deleted.
 *   - invoice.status must be 'paid' — a buyer cannot have withheld on an
 *     unpaid invoice. (RD practice: WHT is recognised at the moment of
 *     payment per ม.50 + ม.65/2.)
 *   - invoice must be a PLATFORM-issued tax invoice. STATE-fee invoices
 *     do not bear WHT (state revenue is VAT-exempt and not subject to
 *     ม.50; the payer pays Treasury directly).
 *   - certificateNumber is required and unique among recorded certs for
 *     this invoice (idempotency guard against duplicate uploads).
 *   - whtAmount must be > 0 and ≤ invoice.subtotal (cap by RD logic; can
 *     never withhold more than the taxable base).
 *
 * Optional journal posting (when `recordJournal: true`):
 *   - Dr WHT Receivable (1320-001)   <whtAmount>
 *     Cr Revenue — Platform Fee (4110-001) <whtAmount>
 *
 *   This reclassifies a portion of the recognised revenue as a prepaid
 *   tax credit the platform will offset against its own ภ.ง.ด.50
 *   year-end corporate tax. The hook is OPT-IN because (a) the chart
 *   of accounts in journal-entry-service.js does not yet define 1320,
 *   and (b) most use-cases will batch this into a manual journal entry
 *   at month-end. Iter 26 ships the recording side only; the journal
 *   hook is left in-place but currently emits a `[wht][journal-stub]`
 *   log line instead of writing rows. When journal-entry-service gains
 *   `recordWhtEntry()` this stub flips to call it.
 *
 * @param {object} args
 * @param {string} args.invoiceId
 * @param {string} args.certificateNumber  ทบ.50 ทวิ doc-number from buyer
 * @param {string} args.issuedByTaxId      buyer's 13-digit TIN
 * @param {string} args.issuedByName       buyer's legal name
 * @param {Date|string} args.certificateDate  date stamped on the cert
 * @param {number} args.whtAmount          THB withheld (gross × rate)
 * @param {string|null} [args.attachmentId]  Attachment row id for the
 *                                           scanned PDF / image
 * @param {string} [args.actorId]          for audit trail
 * @param {boolean} [args.recordJournal=false]  whether to post the GL
 *                                              reclassification
 * @returns {Promise<object>} { invoiceId, certificateNumber, whtAmount,
 *                              recordedAt, journalRef }
 */
async function recordWhtCertificate({
    invoiceId,
    certificateNumber,
    issuedByTaxId,
    issuedByName,
    certificateDate,
    whtAmount,
    attachmentId = null,
    actorId = null,
    recordJournal = false,
} = {}) {
    // 1) Argument sanity (cheap fail-fast before DB hop).
    if (!invoiceId || typeof invoiceId !== 'string') {
        throw makeError('INVALID_INVOICE_ID', 'invoiceId is required (string)');
    }
    if (!certificateNumber || typeof certificateNumber !== 'string') {
        throw makeError(
            'INVALID_CERTIFICATE_NUMBER',
            'certificateNumber is required (string)',
        );
    }
    if (!issuedByTaxId || !/^\d{13}$/.test(String(issuedByTaxId))) {
        throw makeError(
            'INVALID_BUYER_TAX_ID',
            'issuedByTaxId must be a 13-digit Thai TIN',
        );
    }
    if (!issuedByName || typeof issuedByName !== 'string') {
        throw makeError('INVALID_BUYER_NAME', 'issuedByName is required (string)');
    }
    const certDate = certificateDate ? new Date(certificateDate) : null;
    if (!certDate || Number.isNaN(certDate.getTime())) {
        throw makeError(
            'INVALID_CERTIFICATE_DATE',
            'certificateDate must be a valid date',
        );
    }
    const whtAmt = round2(whtAmount);
    if (!Number.isFinite(whtAmt) || whtAmt <= 0) {
        throw makeError('INVALID_WHT_AMOUNT', 'whtAmount must be > 0');
    }

    // 2) Resolve DB; without it we cannot validate the invoice — fail
    //    loud rather than swallow.
    const prisma = resolvePrisma();
    if (!prisma) {
        throw makeError(
            'DB_UNAVAILABLE',
            'Prisma client is not available — cannot record WHT certificate',
            503,
        );
    }

    // 3) Fetch invoice and validate eligibility.
    const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: {
            id: true,
            invoiceNumber: true,
            serviceType: true,
            status: true,
            subtotal: true,
            isDeleted: true,
            organizationId: true,
            metadata: true,
        },
    });
    if (!invoice) {
        throw makeError('INVOICE_NOT_FOUND', 'Invoice not found', 404);
    }
    if (invoice.isDeleted) {
        throw makeError('INVOICE_DELETED', 'Invoice has been soft-deleted', 410);
    }
    // ม.50 only applies to a paid transaction (the buyer withholds AT
    // the moment of payment). Refuse pending / overdue / cancelled.
    if (String(invoice.status || '').toLowerCase() !== 'paid') {
        throw makeError(
            'INVOICE_NOT_PAID',
            `WHT certificate requires a PAID invoice (current status: ${invoice.status})`,
            409,
        );
    }
    // PLATFORM-only — STATE-fee invoices are VAT-exempt government
    // revenue and DO NOT incur WHT.
    if (!PLATFORM_SERVICE_TYPES.has(String(invoice.serviceType || '').toUpperCase())) {
        throw makeError(
            'NOT_PLATFORM_INVOICE',
            'WHT applies to PLATFORM tax invoices only — STATE-fee invoices '
            + 'are government revenue (ป.รัษฎากร ม.77/1 (10)) and do not '
            + 'bear withholding tax.',
            422,
        );
    }
    // Cap by subtotal so we never record more WHT than the taxable base.
    // Per ม.50 the buyer withholds on the pre-VAT service fee — for
    // ฿500 platform fee that's ฿15 max. We tolerate a 0.005 satang
    // drift so callers passing the gross-incl-VAT amount as the rounding
    // basis don't trip the cap on legitimate edge cases.
    const subtotal = round2(Number(invoice.subtotal) || 0);
    if (subtotal > 0 && whtAmt > subtotal + 0.005) {
        throw makeError(
            'WHT_EXCEEDS_SUBTOTAL',
            `whtAmount ${whtAmt} exceeds invoice subtotal ${subtotal}`,
        );
    }

    // 4) Idempotency: if a cert with this same number is already stored
    //    on this invoice, return it (don't double-record). If a DIFFERENT
    //    cert is stored, refuse — finance must explicitly supersede.
    // BUGHUNT-2.2 (MF-1): a legacy invoice whose metadata was double-encoded to a
    // JSON STRING (old holdInvoice JSON.stringify) would index-by-name into a
    // string → undefined → the dup-guard is bypassed, AND spreading a string
    // below builds a char-indexed garbage object that DROPS the .refund block →
    // a later refund double-refunds. Self-heal the string to an object first
    // (mirrors refund-service._readRefundBlock).
    const meta = typeof invoice.metadata === 'string'
        ? (() => { try { return JSON.parse(invoice.metadata || '{}') || {}; } catch { return {}; } })()
        : (invoice.metadata || {});
    const existing = meta.whtCertificate;
    if (existing && existing.certificateNumber === certificateNumber) {
        return {
            invoiceId,
            certificateNumber,
            whtAmount: existing.whtAmount,
            recordedAt: existing.recordedAt,
            alreadyRecorded: true,
        };
    }
    if (existing && existing.certificateNumber !== certificateNumber) {
        throw makeError(
            'WHT_CERTIFICATE_ALREADY_RECORDED',
            `Invoice already has WHT certificate ${existing.certificateNumber}; `
            + 'supersede via a manual edit before recording a new one.',
            409,
        );
    }

    // 5) Persist on Invoice.metadata.whtCertificate (Json). The shape
    //    mirrors the future wht_certificates table 1:1 so the
    //    eventual Prisma migration is a straight column-extraction.
    const recordedAt = new Date();
    const certPayload = {
        certificateNumber,
        issuedByTaxId: String(issuedByTaxId),
        issuedByName,
        certificateDate: certDate.toISOString(),
        whtAmount: whtAmt,
        rate: DEFAULT_WHT_RATE,
        attachmentId: attachmentId || null,
        recordedAt: recordedAt.toISOString(),
        recordedBy: actorId || null,
        // ม.69 ทวิ — payer issues cert; we are payee, so the source
        // record always carries `source: 'BUYER_ISSUED'`. Reserved for
        // future variants (e.g. amended cert).
        source: 'BUYER_ISSUED',
    };

    const nextMetadata = {
        ...meta, // self-healed object (never a raw string — preserves .refund etc.)
        whtCertificate: certPayload,
    };

    await prisma.invoice.update({
        where: { id: invoiceId },
        data: { metadata: nextMetadata },
    });

    // 6) Optional journal posting. Off by default — see header.
    let journalRef = null;
    if (recordJournal) {
        const journalService = lazyJournalService();
        if (journalService && typeof journalService.recordWhtEntry === 'function') {
            // Hook exists (future iter wired it). Delegate.
            journalRef = await journalService.recordWhtEntry({
                invoiceId,
                whtAmount: whtAmt,
                accountCode: WHT_RECEIVABLE_ACCOUNT.code,
                accountName: WHT_RECEIVABLE_ACCOUNT.name,
                actorId,
            });
        } else {
            // Hook not yet wired — emit a marker log so finance can
            // post a manual journal entry later. NOT an error.
            logger.info(
                '[wht][journal-stub] WHT certificate recorded — manual '
                + 'journal entry required: Dr 1320-001 (WHT Receivable) '
                + `${whtAmt} / Cr 4110-001 (Revenue — Platform Fee) ${whtAmt} `
                + `(invoice=${invoiceId}, cert=${certificateNumber})`,
            );
            journalRef = { stub: true, note: 'manual journal entry required' };
        }
    }

    return {
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        certificateNumber,
        whtAmount: whtAmt,
        recordedAt: recordedAt.toISOString(),
        journalRef,
    };
}

// ── Public: applicability check ────────────────────────────────────────────

/**
 * Quick "does WHT apply to this invoice?" check used by the UI before
 * showing the upload-cert button. Returns a structured answer so the
 * frontend can render the right hint (eligible / not-platform / not-
 * paid / individual-buyer).
 *
 * @param {string} invoiceId
 * @returns {Promise<{
 *   applicable: boolean,
 *   reason: string,
 *   indicativeWht?: number,
 *   alreadyRecorded?: boolean
 * }>}
 */
async function isWhtApplicableForInvoice(invoiceId, { organizationId = null } = {}) {
    const prisma = resolvePrisma();
    if (!prisma) {
        return { applicable: false, reason: 'DB_UNAVAILABLE' };
    }
    const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: {
            id: true,
            organizationId: true,
            serviceType: true,
            status: true,
            subtotal: true,
            isDeleted: true,
            metadata: true,
            application: {
                select: {
                    entity: { select: { type: true } },
                },
            },
            applicant: { select: { taxId: true } },
        },
    });
    if (!invoice || invoice.isDeleted) {
        return { applicable: false, reason: 'INVOICE_NOT_FOUND' };
    }
    // L4 (security review 2026-09-27): another organization's invoice is not
    // found from this caller's point of view (anti-probe 404).
    if (organizationId && invoice.organizationId && invoice.organizationId !== organizationId) {
        throw makeError('INVOICE_NOT_FOUND', 'Invoice not found', 404);
    }
    if (!PLATFORM_SERVICE_TYPES.has(String(invoice.serviceType || '').toUpperCase())) {
        return { applicable: false, reason: 'NOT_PLATFORM_INVOICE' };
    }
    if (String(invoice.status || '').toLowerCase() !== 'paid') {
        return { applicable: false, reason: 'INVOICE_NOT_PAID' };
    }
    // Decide buyer-type — entity first, fall back to applicant.taxId
    // presence (a personal national-ID does NOT trigger WHT; only a
    // juristic TIN does, so a non-13-digit value is "individual").
    const entity = invoice.application?.entity || null;
    const corporate = entity
        ? isCorporateBuyer(entity)
        : false;
    if (!corporate) {
        return { applicable: false, reason: 'INDIVIDUAL_BUYER' };
    }
    const _meta = typeof invoice.metadata === 'string'
        ? (() => { try { return JSON.parse(invoice.metadata || '{}') || {}; } catch { return {}; } })()
        : (invoice.metadata || {});
    const already = !!_meta.whtCertificate;
    const { wht } = computeWhtAmount(Number(invoice.subtotal) || 0);
    return {
        applicable: true,
        reason: 'CORPORATE_BUYER_PLATFORM_PAID',
        indicativeWht: wht,
        alreadyRecorded: already,
    };
}

// ── Public: listing ────────────────────────────────────────────────────────

/**
 * List captured ทบ.50 ทวิ certificates for a date range, optionally
 * scoped to a single organization. Used for the (future) monthly
 * ภ.ง.ด.53 prep view and for audit evidence. Iter 26 ships a simple
 * scan over Invoice.metadata; performance is fine at typical platform
 * volume (corporate buyers are a small minority of GACP applicants).
 *
 * When the dedicated wht_certificates table lands, this becomes a
 * straight findMany on that table.
 *
 * @param {object} args
 * @param {Date|string} [args.startDate]
 * @param {Date|string} [args.endDate]
 * @param {string} [args.organizationId]
 * @returns {Promise<Array<object>>} certificates, oldest first
 */
async function listWhtCertificates({
    startDate, endDate, organizationId = null,
} = {}) {
    const prisma = resolvePrisma();
    if (!prisma) {return [];}

    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    // Filter invoices that PROBABLY carry a WHT cert. We do a coarse
    // server-side filter on status=paid + PLATFORM serviceType and
    // refine in JS because Prisma JSON-path filters are dialect-
    // dependent (PostgreSQL supports them; SQLite test backend does
    // not). The volume at typical platform scale stays small.
    const where = {
        isDeleted: false,
        status: 'paid',
        serviceType: { in: Array.from(PLATFORM_SERVICE_TYPES) },
    };
    if (organizationId) {where.organizationId = organizationId;}

    const invoices = await prisma.invoice.findMany({
        where,
        select: {
            id: true,
            invoiceNumber: true,
            organizationId: true,
            subtotal: true,
            paidAt: true,
            metadata: true,
        },
        orderBy: { paidAt: 'asc' },
    });

    const result = [];
    for (const inv of invoices) {
        const cert = inv.metadata && inv.metadata.whtCertificate;
        if (!cert) {continue;}
        const certDate = new Date(cert.certificateDate);
        if (start && certDate < start) {continue;}
        if (end && certDate >= end) {continue;}
        result.push({
            invoiceId: inv.id,
            invoiceNumber: inv.invoiceNumber,
            organizationId: inv.organizationId,
            invoiceSubtotal: round2(Number(inv.subtotal) || 0),
            ...cert,
        });
    }
    return result;
}

// ── Public: role-gating helpers (for route layer) ──────────────────────────

function assertReadRole(actor) {
    const role = normalizeRole(actor?.canonicalRole || actor?.role);
    if (!role || !READ_ROLES.has(role)) {
        throw makeError(
            'FORBIDDEN_ROLE',
            'A finance or admin role is required',
            403,
        );
    }
    return role;
}

function assertWriteRole(actor) {
    const role = normalizeRole(actor?.canonicalRole || actor?.role);
    if (!role || !WRITE_ROLES.has(role)) {
        throw makeError(
            'FORBIDDEN_ROLE',
            'ACCOUNT_PLATFORM or ADMIN role required to record WHT certificates',
            403,
        );
    }
    return role;
}

module.exports = {
    // Constants
    DEFAULT_WHT_RATE,
    WHT_RECEIVABLE_ACCOUNT,
    PLATFORM_SERVICE_TYPES,
    // Classification + math (pure)
    isCorporateBuyer,
    computeWhtAmount,
    // Persistence
    recordWhtCertificate,
    isWhtApplicableForInvoice,
    listWhtCertificates,
    // Role helpers (for route layer)
    assertReadRole,
    assertWriteRole,
};
