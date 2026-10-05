/**
 * Quotation Service — canonical home for the `Quotation` Prisma model.
 *
 * Tier 18 / B18-A (2026-05-16). Distinct from `services/quote-service.js`
 * (batch 11, legacy `Quote` model) — this service targets the `Quotation`
 * model introduced by B16-A.
 *
 * W14 (operator ruling 2026-08-22, the change log c28355ea):
 *
 *   one Application → ONE Quotation row
 *     issuerType = 'PLATFORM' — the COMPANY (บริษัท พรีดิกทีฟ เอไอ โซลูชัน
 *     จำกัด), carrying the whole price: ค่าบริการ (ราคาเต็ม + ค่าแพลตฟอร์ม)
 *     plus VAT 7% on that whole service fee.
 *
 * The retired model issued TWO rows — a DTAM row for the state fee and a
 * PLATFORM row for the platform fee + VAT — because the platform collected the
 * state portion as DTAM's agent. It no longer does: the farmer pays the
 * company, and the company settles with DTAM outside this system.
 *
 * `issuerType` keeps the value 'PLATFORM' rather than gaining a new 'COMPANY'
 * value, because PLATFORM already IS the company. That avoids a schema
 * migration and, more importantly, lets pre-W14 rows keep reading back exactly
 * as written — see getFrozenPhaseFees.
 *
 * PRE-W14 APPLICATIONS still have their DTAM + PLATFORM pair on disk. They are
 * read back untouched and never repriced: a quotation is a price of record.
 *
 * Source-of-truth for amounts:
 *   `modules/billing.calculateApplicationFees(formData, { scopeCount })`
 *   returns `{ phase1, phase2, stateTotal, platformTotal, vatTotal,
 *   grandTotal }`. This service NEVER hard-codes amounts — it derives
 *   them from that calculator with the application's formData + the
 *   `cultivationScopeCount` column as the canonical scope count.
 *
 * Source-of-truth for issuer header info (legal name, tax ID, address):
 *   `config/invoice-issuers.getInvoiceIssuer(serviceType)` — frozen
 *   constants populated from env vars + verified defaults. Each
 *   Quotation row only carries the issuerType discriminator; the legal
 *   identity is resolved at PDF-render time so changes to env-driven
 *   issuer data flow into previously-issued quotations automatically.
 *
 * Single money flow (W14): the quotation announces the full tax invoice
 * (ใบกำกับภาษีเต็มรูป) the company will issue for the whole ค่าบริการ. There is
 * one transfer, to one account — the two-transfer / two-slip model is retired.
 *
 * Receipt-number allocator:
 *   `services/receipt-numbering-service.allocateReceiptNumber({ issuer,
 *   dateOrYear })`. The Quotation prefix is the issuer's `QT-DTAM` /
 *   `QT-PRD` form — we reuse the same allocator + sequence buckets the
 *   final receipt will use because the QT number sticks to the
 *   downstream invoice anyway.
 *
 * Statutory anchors (Thai accounting / Revenue Code):
 *   - ป.รัษฎากร ม.86/4 — ผู้ประกอบการ VAT ออกใบกำกับภาษีเต็มรูป (PLATFORM)
 *   - ป.รัษฎากร ม.77/1 (10) — รายได้แผ่นดินยกเว้น VAT (DTAM)
 *   - TFRS for NPAEs ch.18 (รายได้) — รับรู้เฉพาะที่กิจการได้รับ
 *   - กฎกระทรวงการคลังเรื่องเงินรายได้แผ่นดิน
 *
 * Row-level invariants centralised here:
 *   - `isDeleted: false` on every read
 *   - Idempotency keyed on (applicationId, issuerType) — never issue
 *     duplicate DTAM/PLATFORM rows for the same application
 *   - Decimal money writes use Prisma Decimal(15,2) per TFRS for NPAEs
 *     exact-decimal rule
 */

'use strict';

const crypto = require('crypto');

// Prisma is resolved lazily inside each function so test reloads of
// the prisma-database mock (or a per-request tenant-scoped client)
// flow through correctly. Capturing it at module load freezes the
// reference to whatever client was active when this file first loaded.
const _prismaDatabase = require('./prisma-database');
function _resolvePrisma(tx) { return tx || _prismaDatabase.prisma; }

// Spec 2026-09-30 §3.1 — a read reached from a health request carries the
// caller's holder fragment; staff, webhook and system callers pass no scope and
// keep their where. holder-access is required lazily (it loads farm-access and
// the permission engine).
const _holderAccess = () => require('./holder-access');
const _isHolderScope = (scope) => Boolean(scope) && typeof scope === 'object' && Array.isArray(scope.readIds);
function _holderFragment(holderScope, model = 'Quotation') {
    return _isHolderScope(holderScope) ? _holderAccess().holderReadWhere(holderScope, model) : {};
}

const {
    calculateApplicationFees,
    calculateRenewalFee,
} = require('../modules/billing');
const receiptNumbering = require('./receipt-numbering-service');
const { ISSUER_TYPES } = require('../config/invoice-issuers');
// Quotation validity window (operator ruling, re-confirmed 2026-09-27): 7
// BUSINESS days from issue, on the canonical Thai working-day calendar — the
// same primitive invoice due-dates already use, never a re-spelled day count.
const { addWorkingDays } = require('../utils/working-days');
const { PAYMENT } = require('../config/business-rules');
// One reader of "what does this instalment ask for", shared with the API line
// items and the PDF so the row is priced the same way on every surface.
const { instalmentPayable } = require('./quotation-line-items');
const { createLogger } = require('../shared/logger');
const { billableScopes } = require('../shared/application-scope');
// The ONE list of states that mean "the applicant accepted", owned by the gate
// both money rails ask (review r1, finding 2; the slip rail deleted its private
// copy for the same reason, payment-slip-service.js:442). Safe at module top in
// THIS direction: quotation-gate.js requires only shared/logger and
// shared/error-codes at load, and defers its own require of this module to the
// inside of the gate function, so no cycle is closed.
const { QUOTATION_ACCEPTED_STATES, MILESTONE_TO_PHASE } = require('./billing/quotation-gate');
// The escape hatch for the money paths that are NOT the applicant's own
// request (R6). services/tenant-context is dependency-free (an AsyncLocalStorage
// and four accessors), so requiring it at module top pulls nothing else in.
const { withoutTenantScope } = require('./tenant-context');

const logger = createLogger('quotation-service');

// ── Status constants ─────────────────────────────────────────────────────────
// Matches the schema's `status` column (default 'DRAFT'). The transition
// table is enforced by callers; this service only checks the source state
// when flipping (PENDING/SENT → ACCEPTED, ACCEPTED → INVOICED).
const QUOTATION_STATUS = Object.freeze({
    DRAFT: 'DRAFT',
    SENT: 'SENT',
    PENDING: 'PENDING',
    ACCEPTED: 'ACCEPTED',
    REJECTED: 'REJECTED',
    EXPIRED: 'EXPIRED',
    INVOICED: 'INVOICED',
});

// Issuer discriminator — matches the schema string column. The ONE issuer a
// new quotation may carry, read from invoice-issuers (which dropped DTAM on
// 2026-09-11, 3fc6a56a). Every value here must be a real string: when this map
// still read `ISSUER_TYPES.DTAM` it held `undefined`, and the Prisma query
// `issuerType: { in: [undefined, 'PLATFORM'] }` refused every issuance.
const ISSUER = Object.freeze({
    PLATFORM: ISSUER_TYPES.PLATFORM,
});

// ใบเสนอราคาก่อน W14 (~16 ใบ) ยังมี issuerType 'DTAM' บนดิสก์ — ใช้เพื่ออ่าน/แสดงแถวเก่าเท่านั้น ห้ามใช้ออกใบใหม่
const LEGACY_DTAM_ISSUER = 'DTAM';

// Quotation receipt-number prefix routing, keyed by the issuers that may be
// ISSUED. QT-DTAM is gone with the DTAM issuer, so _allocateQuotationNumber
// refuses 'DTAM' instead of minting a number for it.
const QT_PREFIX = Object.freeze({
    [ISSUER.PLATFORM]: 'QT-PRD',
});

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Allocate a QT-DTAM-… or QT-PRD-… number via the canonical receipt-numbering
 * service. We piggy-back on the same allocator + (prefix, year) bucket the
 * downstream receipt would use, so QT and the eventual invoice/receipt share
 * the same year run. The DTAM stream uses BE year + Thai numerals (government
 * convention); PLATFORM uses CE year + Arabic (B2B / FlowAccount convention).
 *
 * @param {'DTAM'|'PLATFORM'} issuerType
 * @param {Date} [issueDate]
 * @param {object} [prismaClient]  inject for tests
 * @returns {Promise<string>}
 */
async function _allocateQuotationNumber(issuerType, issueDate, prismaClient) {
    const prefix = QT_PREFIX[issuerType];
    if (!prefix) {
        throw new TypeError(
            `[quotation-service] Unknown issuerType "${issuerType}". `
            + `Expected one of: ${Object.values(ISSUER).join(', ')}.`,
        );
    }

    // QT_PREFIX admits the company only, so the number is always CE year +
    // Arabic numerals (QT-PRD) — the BE/Thai-numeral branch belonged to QT-DTAM.
    // For PLATFORM this is what the removed `issuerType === 'DTAM'` test already gave.
    const date = issueDate || new Date();
    const year = receiptNumbering.toChristianYear(date);

    // Reuse the canonical Prisma-backed allocator with this service's QT
    // prefix. The allocator does upsert-in-transaction on
    // `ReceiptSequence` keyed by (prefix, year), so QT-DTAM-2569-* and
    // RCP-DTAM-2569-* increment independently.
    const allocator = require('./receipt-numbering-service');
    // We dip into the helper used by allocateReceiptNumber so we can drive
    // the prefix ourselves (the public allocate fn fixes the prefix per
    // issuer to RCP-/TAX-/RCP-PRD-). The internal function isn't exported,
    // so we re-implement the same upsert here against the same delegate.
    const prismaInstance = prismaClient || _resolvePrisma();
    let sequence;
    try {
        if (!prismaInstance
            || !prismaInstance.receiptSequence
            || typeof prismaInstance.receiptSequence.upsert !== 'function') {
            throw Object.assign(
                new Error('prisma.receiptSequence delegate unavailable'),
                { code: 'RECEIPT_SEQUENCE_MODEL_MISSING' },
            );
        }
        const row = await prismaInstance.$transaction(async (tx) => {
            return tx.receiptSequence.upsert({
                where: { prefix_year: { prefix, year } },
                create: { prefix, year, counter: 1, lastAllocatedAt: new Date() },
                update: { counter: { increment: 1 }, lastAllocatedAt: new Date() },
                select: { counter: true },
            });
        }, { isolationLevel: 'Serializable' });
        sequence = row.counter;
    } catch (err) {
        // [R6-B] Production must always have the receipt-sequence migration
        // applied. Mirrors the R5-B hardening of receipt-numbering-service.js
        // (lines 280-303) — refuse to silently fall back when prod misses the
        // migration; throw RECEIPT_SEQUENCE_DB_UNAVAILABLE with operator-
        // actionable text so the failing log line tells ops what to run.
        // Non-prod (test/dev) retains the in-memory fallback for unit tests
        // that exercise the allocation path without a live DB.
        if (process.env.NODE_ENV === 'production') {
            const reason = err && err.message ? err.message : String(err);
            logger.error(
                `[quotation-service] DB allocator failed - refusing to issue QT number. `
                + `Run \`npx prisma migrate deploy\` to apply the ReceiptSequence migration. `
                + `Underlying: ${reason}`,
            );
            const wrapped = new Error(
                '[quotation-service] quotation-sequence DB unavailable - '
                + 'production must have the receipt-sequence migration applied - '
                + 'run `npx prisma migrate deploy`',
            );
            wrapped.code = 'QUOTATION_NUMBER_DB_UNAVAILABLE';
            wrapped.cause = err;
            throw wrapped;
        }
        if (err && err.code === 'RECEIPT_SEQUENCE_MODEL_MISSING') {
            // In-memory fallback — reuse the receipt-numbering helpers'
            // formatter only; we generate a process-local sequence so unit
            // tests can exercise the path without a live DB. Production must
            // always run with the migration applied (the prod branch above
            // throws RECEIPT_SEQUENCE_DB_UNAVAILABLE).
            logger.warn(
                '[quotation-service] prisma.receiptSequence unavailable - '
                + 'falling back to in-memory counter (NOT for production).',
            );
            // Tiny per-process counter map. Keyed identically to the
            // receipt-numbering fallback so behaviour matches.
            if (!_allocateQuotationNumber._fallback) {
                _allocateQuotationNumber._fallback = new Map();
            }
            const key = `${prefix}-${year}`;
            const next = (_allocateQuotationNumber._fallback.get(key) || 0) + 1;
            _allocateQuotationNumber._fallback.set(key, next);
            sequence = next;
        } else {
            throw err;
        }
    }

    return allocator.formatReceiptNumber(prefix, year, sequence, {
        useThaiNumerals: false,
    });
}

/**
 * Test-only — reset the in-memory fallback counter for the QT prefix bucket.
 * @private
 */
function _resetFallbackCountersForTest() {
    if (_allocateQuotationNumber._fallback) {
        _allocateQuotationNumber._fallback.clear();
    }
}

/**
 * W12 (operator ruling 2026-08-22; billing change authorised as a one-time L3
 * exception, the change log eabfc020) — what a RENEWAL is billed.
 *
 * A renewal is ONE charge. It has no document-review stage, so it has no
 * phase 1 to pay for, and its quotation carries no PHASE_1 line at all.
 *
 * WHY THE SINGLE CHARGE IS MAPPED ONTO THE PHASE_2 SLOT rather than getting a
 * service type of its own: settlement decides what a paid checkout means, and
 * checkout-settlement-service maps the M2 (phase-2) checkout to AUDIT_FEE_PAID
 * — the state a renewal must land in to reach the scheduling queue. A new
 * service type would have to be taught to settlement, and settlement logic is
 * explicitly out of scope. Reusing PHASE_2 means settlement, invoice mint,
 * receipts and the M2 -> AUDIT_FEE_PAID transition all keep working with no
 * change at all. phase-billing-service therefore needs no new mapping either:
 * PHASE_2_STATE_FEE / PHASE_2_PLATFORM_FEE already cover both components.
 *
 * The amounts come from modules/billing.calculateRenewalFee, which is the same
 * buildPhaseFee the phase fees use, so the quotation cannot disagree with what
 * /api/pricing quotes the applicant.
 *
 * @param {object} application
 * @returns {boolean}
 */
function _isRenewal(application) {
    return Boolean(application?.formData?.renewalOf);
}

/**
 * The fee object the quotation is built from. Shaped exactly like
 * calculateApplicationFees' result so every downstream consumer is unchanged,
 * except that a renewal carries `phase1: null` — there is no phase 1.
 */
// billableScopes — WHICH cultivation types an application is billed for — lives in
// shared/application-scope.js since 2026-10-02 (M4), so the applicant preview prices with
// the SAME function the quotation does. Its history and rationale moved with it.

function _resolveBillableFees(application) {
    if (_isRenewal(application)) {
        // Operator correction 2026-08-22 (the change log 8b8d581f): a renewal is
        // charged per cultivation scope, exactly like a new application. The
        // scope count is resolved the same way the two-phase branch below
        // resolves it, so the two cannot disagree about what a scope is.
        const scopes = billableScopes(application);
        const scopeCount = scopes.length;
        const renewal = calculateRenewalFee(application.formData || {}, { scopes });
        return {
            scopeCount,
            phase1: null,
            phase2: renewal,
            // ช่องยอดรวมชุดเดียวกับที่ calculateApplicationFees คืน เพราะแถวใบเสนอราคา
            // ข้างล่างอ่านตรง ๆ · การต่ออายุไม่มีงวด 1 ค่าพวกนี้จึงเป็นยอดครั้งเดียวนั้นเอง
            // ค่าบริการต้องมีที่นี่ด้วย ไม่ใช่เฉพาะสาขาสองงวด: subtotal ของแถวอ่านจากช่องนี้
            // ถ้าไม่ใส่จะเขียน NaN ลงแถว
            serviceFeeTotal: renewal.serviceFeeAmount,
            vatTotal: renewal.vatAmount,
            grandTotal: renewal.phaseTotal,
            isRenewal: true,
        };
    }
    return calculateApplicationFees(application.formData || {}, {
        scopes: billableScopes(application),
    });
}

/**
 * Build the two installment-line arrays. DTAM has state-only amounts
 * (VAT-exempt — ม.77/1 (10) ป.รัษฎากร). PLATFORM has platform fee +
 * VAT for each phase, because the gateway charges them as a single bundle
 * per phase (this matches how invoices are split downstream).
 *
 * @param {object} fees  return value of calculateApplicationFees(...)
 * @returns {{ dtam: Array, platform: Array }}
 */
function _buildInstallments(fees) {
    // แต่ละงวดถือ `phase` + `amount` (หน้าเว็บและผู้บริโภคเดิมอ่านแค่นี้) และถือตัวเลข
    // ของงวดนั้นแบบครบชุดไว้ด้วย เพื่อให้ใบเสนอราคาที่ถูกยอมรับเป็นราคาที่ตรึงไว้แล้ว
    // อ่านได้ด้วยตัวเอง — ดู getFrozenPhaseFees ข้างล่าง
    //
    // เดิมชุดนี้มี stateAmount/platformAmount เพราะ `amount` ต่างกันตามผู้ออกใบ
    // (DTAM = ส่วนรัฐ · PLATFORM = ส่วนบริษัท + VAT) · ตั้งแต่ W14 มีผู้ออกใบรายเดียว
    // และตั้งแต่ 2026-09-11 ไม่มีการแยกส่วนแล้ว ⇒ เหลือค่าบริการกับ VAT
    const split = (f) => ({
        serviceFeeAmount: f.serviceFeeAmount,
        vatAmount: f.vatAmount,
        scopeCount: fees.scopeCount,
        // Per-cultivation-type amounts, frozen with the rest of the price (operator ruling
        // 2026-09-06 — "ราคาก็เอามารวมกัน"). The document prints these as its numbered
        // lines; without them it can only share the phase figure across the types, which
        // is right while every type costs the same and wrong the moment one does not.
        // Frozen rather than recomputed for the same reason every other figure here is:
        // an accepted quotation is the price of record and may not move when a rate does.
        scopeBreakdown: Array.isArray(f.scopeBreakdown)
            ? f.scopeBreakdown.map((line) => ({
                method: line.method,
                serviceFeeAmount: line.serviceFeeAmount,
                vatAmount: line.vatAmount,
            }))
            : undefined,
    });
    // W14 (operator ruling 2026-08-22) — ONE issuer, so ONE installment list.
    // `amount` is now the FULL phase payable (state + platform + VAT), because
    // the company bills the whole thing on one document. The retired model split
    // each phase between a DTAM entry (state only) and a PLATFORM entry
    // (platform + VAT), which is what forced two quotations per application.
    //
    // The per-phase split fields are unchanged, so getFrozenPhaseFees keeps
    // reconstructing the breakdown exactly as before — including from rows
    // written under the old model, which is what preserves frozen prices.
    //
    // W12 — a renewal has no phase 1, so it emits no PHASE_1 line.
    const company = [];
    if (fees.phase1) {
        company.push({ phase: 'PHASE_1', amount: fees.phase1.phaseTotal, ...split(fees.phase1) });
    }
    company.push({ phase: 'PHASE_2', amount: fees.phase2.phaseTotal, ...split(fees.phase2) });
    // `platform` is the same array under the name the Quotation row's
    // issuerType already uses ('PLATFORM' IS the company — บริษัท พรีดิกทีฟ
    // เอไอ โซลูชัน). Keeping the key means no schema migration and no rename
    // ripple through readers. `dtam` is deliberately absent: there is no second
    // issuer to build a list for, and returning an empty array would let a
    // caller create a DTAM row full of zeroes.
    return { company, platform: company };
}

/**
 * Pure half of getFrozenPhaseFees: turn stored installments into the frozen
 * per-phase breakdown, or null when the rows are legacy and un-enriched.
 *
 * W12 — a RENEWAL quotation carries ONLY a PHASE_2 line (there is no document
 * review to pay for). That is a complete, frozen price, not a legacy row, so it
 * must NOT fall through to the recompute path: recomputing would bill the
 * renewal the ordinary two-phase amounts, which is the exact defect this work
 * closes. The absent phase is reported as an explicit zero so every existing
 * consumer of this shape (payment-service-phase-flow.resolveLockedPhaseTotals,
 * the phase-invoice mint) keeps working with no change.
 *
 * @param {Array} installments
 * @returns {{ scopeCount:number, phase1:object, phase2:object, singleCharge:boolean } | null}
 * @private
 */
function _reconstructFrozenFromInstallments(installments) {
    if (!Array.isArray(installments) || installments.length === 0) { return null; }
    const byPhase = {};
    for (const it of installments) {
        if (!it
            || typeof it.serviceFeeAmount !== 'number'
            || typeof it.vatAmount !== 'number'
            || typeof it.scopeCount !== 'number') {
            return null; // แถวรุ่นเก่าที่ยังไม่มีตัวเลขครบ → ถอยไปคำนวณใหม่
        }
        byPhase[it.phase] = {
            serviceFeeAmount: it.serviceFeeAmount,
            vatAmount: it.vatAmount,
            phaseTotal: it.serviceFeeAmount + it.vatAmount,
        };
    }
    if (!byPhase.PHASE_2) { return null; }
    const phase1 = byPhase.PHASE_1 || { serviceFeeAmount: 0, vatAmount: 0, phaseTotal: 0 };
    return {
        scopeCount: installments[0].scopeCount,
        phase1,
        phase2: byPhase.PHASE_2,
        singleCharge: !byPhase.PHASE_1,
    };
}

/**
 * GAP-5: return the FROZEN per-phase billing breakdown for an application from
 * its issued quotation(s) — the single price-of-record that downstream billing
 * (invoice mint, phase-payment) copies instead of recomputing from mutable
 * formData. Reads the non-deleted DTAM/PLATFORM quotation rows and reconstructs
 * the split from the enriched installments.
 *
 * Returns `null` (→ the caller falls back to calculateApplicationFees, i.e. the
 * pre-GAP-5 behavior) when: no quotation exists, or the installments predate the
 * GAP-5 enrichment (legacy rows carry only { phase, amount }). This keeps every
 * in-flight application unchanged; only quotes issued after this change lock.
 *
 * @param {string} applicationId
 * @param {object} [opts]
 * @param {object} [opts.tx] — Prisma transaction handle
 * @returns {Promise<{ scopeCount:number, phase1:object, phase2:object } | null>}
 */
async function getFrozenPhaseFees(applicationId, opts = {}) {
    if (!applicationId) { return null; }
    const { platform } = await findQuotationsByApplicationId(applicationId, opts);
    const source = platform;
    if (!source || !Array.isArray(source.installments) || source.installments.length === 0) {
        return null;
    }

    return _reconstructFrozenFromInstallments(source.installments);
}

/**
 * Every live quotation row of an application, on whichever client is handed in
 * (the outer client, or a transaction handle). ONE reader so the idempotency
 * probe, the in-transaction re-probe and the post-refusal re-read cannot drift
 * into asking three slightly different questions.
 * @private
 */
async function _readLiveQuotationRows(client, applicationId, holderScope = null) {
    return client.quotation.findMany({
        where: {
            applicationId,
            ..._holderFragment(holderScope),
            isDeleted: false,
            // Legacy DTAM rows are read on purpose: a pre-W14 pair already
            // quoted this application, so it must not be re-issued (see the
            // idempotency note in issueQuotationsForApplication).
            issuerType: { in: [LEGACY_DTAM_ISSUER, ISSUER.PLATFORM] },
        },
    });
}

/**
 * รูป `{ company, platform }` ที่การออกใบตอบกลับ สร้างจากแถวที่มีอยู่แล้ว
 *
 * ช่อง `dtam` ถูกถอด 2026-09-11 — ไม่มีผู้ออกเอกสารฝั่งกรมแล้ว · `platform` เป็นชื่อพ้อง
 * ของ `company` คงไว้เพราะผู้เรียกเดิมอ่านชื่อนั้น
 * @private
 */
function _shapeIssuanceResult(rows) {
    const companyExisting = rows.find((q) => q.issuerType === ISSUER.PLATFORM) || null;
    return { company: companyExisting, platform: companyExisting };
}

/**
 * Did the database refuse this write because a row already exists?
 *
 * `P2002` is what Prisma raises for a unique-constraint violation; `23505` is
 * the raw PostgreSQL SQLSTATE, which surfaces instead when the statement went
 * through $queryRaw or when an error crosses a boundary that drops Prisma's
 * wrapper. Both mean the same thing and both must be recognised — reading only
 * the Prisma spelling would turn a lost race back into a 500 on the raw path.
 * @private
 */
function _isUniqueViolation(err) {
    const code = err && err.code;
    return code === 'P2002' || code === '23505';
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Issue BOTH DTAM and PLATFORM quotations for an application atomically.
 *
 * Idempotent: when a quotation already exists for (applicationId,
 * issuerType, isDeleted=false) the existing row is returned instead of
 * creating a duplicate. This lets the SUBMITTED hook be called more than
 * once (retries, replay, application-status-writer rollbacks) without
 * polluting the table.
 *
 * Amounts are derived canonically from
 * `modules/billing.calculateApplicationFees(application.formData, {
 * scopeCount: application.cultivationScopeCount })`. The DTAM quotation is
 * VAT=0 (state fee VAT-exempt — ม.77/1 (10) ป.รัษฎากร). The PLATFORM
 * quotation carries the canonical VAT 7% on platform fee
 * (ม.86/4 ป.รัษฎากร).
 *
 * Receipt numbers are allocated via the canonical receipt-numbering
 * service: QT-DTAM uses BE year + Thai numerals, QT-PRD uses CE year +
 * Arabic numerals.
 *
 * @param {string} applicationId
 * @param {object} opts
 * @param {string} [opts.actorId]        — User UUID for createdBy
 * @param {string} [opts.organizationId] — overrides application.organizationId
 * @param {object} [opts.tx]             — Prisma transaction handle for atomic
 *                                         inclusion in a caller-owned $transaction
 * @param {string} [opts.notes]          — free text stamped on the row. The
 *                                         controlled self-heal
 *                                         (quotation-issuance-on-submit.js)
 *                                         writes 'ISSUED_LATE: <reason>' here so
 *                                         a row priced after its submission date
 *                                         says so on its face (F-G4-69).
 * @returns {Promise<{ dtam: object, platform: object }>}
 */
async function issueQuotationsForApplication(applicationId, opts = {}) {
    if (!applicationId) {
        throw new TypeError('[quotation-service] issueQuotationsForApplication: applicationId required');
    }
    const {
        actorId = null, organizationId: orgOverride = null, tx = null, notes = null, holderScope = null,
    } = opts;
    const db = _resolvePrisma(tx);

    // 1. Load application — we need formData + cultivationScopeCount for the
    //    canonical fee math, and organizationId for tenancy parity with
    //    the legacy Quote table. Reached from a health request (the submit door,
    //    the quotation GET self-heal) it reads within the caller's holder scope
    //    (spec 2026-09-30 §3.1); staff and system callers keep findUnique.
    const applicationArgs = {
        select: {
            id: true,
            formData: true,
            cultivationScopeCount: true,
            // Retired name, still selected so the fallback in
            // storedCultivationScopeCount can answer for a row the expand
            // backfill has not reached; the contract migration drops it.
            totalAreaTypes: true,
            organizationId: true,
            isDeleted: true,
        },
    };
    const application = _isHolderScope(holderScope)
        ? await db.application.findFirst({
            where: { id: applicationId, ..._holderFragment(holderScope, 'Application') },
            ...applicationArgs,
        })
        : await db.application.findUnique({ where: { id: applicationId }, ...applicationArgs });
    if (!application) {
        const err = new Error(
            `[quotation-service] Application "${applicationId}" not found`,
        );
        err.code = 'APPLICATION_NOT_FOUND';
        throw err;
    }
    if (application.isDeleted) {
        const err = new Error(
            `[quotation-service] Application "${applicationId}" is soft-deleted`,
        );
        err.code = 'APPLICATION_DELETED';
        throw err;
    }

    // 2. Idempotency probe — return existing rows if this application has
    //    already been quoted. We do a single findMany on the composite
    //    index (applicationId, issuerType) added by B16-A.
    const existing = await _readLiveQuotationRows(db, applicationId, holderScope);
    if (existing.length > 0) {
        // W14 — idempotency now needs ONE row, not a pair. Any existing
        // non-deleted quotation for this application means it has been quoted;
        // re-issuing would hand the applicant a second, differently-numbered
        // price for the same work.
        //
        // A pre-W14 application legitimately has TWO rows (DTAM + PLATFORM).
        // They are returned untouched under their own keys — repricing them to
        // the new formula is exactly what must not happen. See
        // single-issuer-frozen-quotation.test.js.
        return _shapeIssuanceResult(existing);
    }

    // 3. Canonical fee math — single source of truth.
    //    Use application.cultivationScopeCount as the scopeCount override so the
    //    quotation matches the gateway charge (the fee-service phase-flow
    //    test anchors on this exact pairing).
    const fees = _resolveBillableFees(application);
    const installments = _buildInstallments(fees);
    const issueDate = new Date();
    // Operator ruling, re-confirmed 2026-09-27: 7 วันทำการ นับจากวันที่ออก
    // โดยไม่นับวันที่ออก — addWorkingDays never counts the start day and
    // returns 23:59:59.999 Bangkok on the 7th qualifying working day.
    const validUntil = addWorkingDays(issueDate, PAYMENT.QUOTATION_VALIDITY_BUSINESS_DAYS);
    const organizationId = orgOverride || application.organizationId;

    // 4. W14 — allocate ONE number and create ONE row. The company issues the
    //    quotation; there is no second issuer to allocate a QT-DTAM number for.
    //
    // The number is allocated BEFORE the transaction below, on the outer
    // client, because the allocator runs its own Serializable transaction over
    // ReceiptSequence (_allocateQuotationNumber). Opening that from inside an
    // interactive transaction would hold two connections per issuance, which
    // is how a pool deadlocks under exactly the concurrency this code is being
    // hardened for. The cost is a gap in the QT sequence when the create below
    // loses the race — a quotation number that was never printed on a document.
    //
    // When the CALLER owns the transaction (opts.tx is a real interactive
    // handle), `db` has no $transaction of its own, so the allocator cannot run
    // on it at all — it would fail with "not a function" and the caller would
    // read a numbering outage. The allocator therefore takes the client this
    // module owns in that case, which is also the only client on which its
    // Serializable upsert can commit independently of the caller's work.
    const allocationClient = typeof db.$transaction === 'function' ? db : _resolvePrisma();
    const companyNumber = await _allocateQuotationNumber(ISSUER.PLATFORM, issueDate, allocationClient);

    // The company's quotation carries the WHOLE price:
    //   subtotal    = ค่าบริการ (ราคาเต็ม + ค่าแพลตฟอร์ม)
    //   vat         = 7% of that whole service fee
    //   totalAmount = ยอดชำระ
    // totalAmount must equal subtotal + vat so downstream invoice math
    // reconciles cleanly — asserted in single-issuer-quotation-row.test.js.
    //
    // issuerType stays 'PLATFORM' because that IS the company (บริษัท พรีดิกทีฟ
    // เอไอ โซลูชัน จำกัด). Reusing the existing enum value means no schema
    // migration and lets pre-W14 PLATFORM rows keep reading back unchanged.
    const createCompanyRow = async (client) => {
        // Re-probe INSIDE the transaction: the probe at step 2 ran before the
        // fee math and the number allocation, and a concurrent caller may have
        // committed in between.
        const raced = await _readLiveQuotationRows(client, applicationId, holderScope);
        if (raced.length > 0) { return _shapeIssuanceResult(raced); }
        const companyRow = await client.quotation.create({
            data: {
                applicationId,
                issuerType: ISSUER.PLATFORM,
                quotationNumber: companyNumber,
                subtotal: fees.serviceFeeTotal,
                vat: fees.vatTotal,
                totalAmount: fees.serviceFeeTotal + fees.vatTotal,
                installments: installments.company,
                status: QUOTATION_STATUS.PENDING,
                validUntil,
                createdBy: actorId,
                organizationId,
                notes,
            },
        });
        return { company: companyRow, dtam: null, platform: companyRow };
    };

    try {
        // One transaction for the check and the create. When the caller already
        // owns a transaction (opts.tx), we are inside it already and must not
        // open a second one — a Prisma interactive-transaction client has no
        // $transaction of its own.
        return typeof db.$transaction === 'function'
            ? await db.$transaction((txClient) => createCompanyRow(txClient))
            : await createCompanyRow(db);
    } catch (err) {
        if (!_isUniqueViolation(err)) { throw err; }
        // The caller owns the transaction, and PostgreSQL aborted it the
        // instant the index refused the insert: every further statement on that
        // handle fails with 25P02, so the read-the-winner recovery below would
        // turn a lost race into a hard failure with a misleading error, inside
        // somebody else's transaction — which has to be retried as a whole
        // anyway. Hand the violation back and let the owner decide (R5).
        if (tx) {
            logger.warn(
                '[quotation-service] concurrent issuance lost the race inside a caller-owned transaction - rethrowing',
                { applicationId },
            );
            throw err;
        }
        // The partial unique index quotations_application_issuer_live_uq
        // refused a second live row for this (applicationId, issuerType).
        // That is not an error to hand back to an applicant: it means somebody
        // else issued this application's quotation microseconds ago. Read it
        // and answer with it.
        const winner = await _readLiveQuotationRows(db, applicationId, holderScope);
        if (winner.length === 0) {
            // A unique violation on some OTHER constraint (quotationNumber,
            // say). Swallowing it would report a price of record that does not
            // exist, so it goes back up unchanged.
            throw err;
        }
        logger.warn(
            '[quotation-service] concurrent issuance lost the race - returning the row that won',
            { applicationId, quotationId: winner[0]?.id || null },
        );
        return _shapeIssuanceResult(winner);
    }
}

/**
 * Retire a lapsed, still-unaccepted quotation and issue its replacement — in
 * ONE transaction (F-G4-64 final round, R1).
 *
 * WHY BOTH WRITES MOVE TOGETHER. The partial unique index
 * quotations_application_issuer_live_uq admits exactly one LIVE row per
 * (applicationId, issuerType), so the replacement cannot be created while the
 * lapsed row is still live, and the lapsed row must not be retired unless the
 * replacement is actually created — an applicant left with neither has no price
 * of record at all, which is the shape of application A2.
 *
 * The retired row is soft-deleted rather than left as a live EXPIRED row for
 * the same reason: `isDeleted = false` is the index's predicate, and it is also
 * what every reader in this service filters on, so a live EXPIRED row would
 * keep answering findQuotationsByApplicationId and re-enter the gate. It keeps
 * status EXPIRED as well, because that is the fact about the document, and
 * until this change nothing in the system ever wrote that status.
 *
 * The soft-delete is an updateMany on (id, isDeleted:false): two reads racing
 * to heal the same lapsed row both try, one changes nothing, and the second
 * issuance is then refused by the index (rethrown by
 * issueQuotationsForApplication because the transaction is ours to retry).
 *
 * ACCEPTED LIMITATION, same one as the late issue: the replacement is priced at
 * the rate table AS IT IS NOW (F-G4-69, no effective date). The notes field
 * names the document it replaces, so the difference is visible on the row.
 *
 * @param {string} applicationId
 * @param {object} opts
 * @param {object} opts.lapsed        the live row that has passed validUntil
 * @param {string} [opts.actorId]
 * @param {Date}   [opts.at]          the ONE instant recorded on the retirement
 * @param {object} [opts.tx]
 * @param {object} [opts.holderScope]  a health caller's holder scope (spec 2026-09-30 §3.1)
 * @returns {Promise<{company: object, dtam: object|null, platform: object}>}
 */
async function reissueLapsedQuotation(applicationId, opts = {}) {
    const { lapsed = null, actorId = null, at = new Date(), tx = null, holderScope = null } = opts;
    if (!applicationId || !lapsed || !lapsed.id) {
        throw new TypeError(
            '[quotation-service] reissueLapsedQuotation: applicationId and the lapsed row are required',
        );
    }
    const db = _resolvePrisma(tx);
    const run = async (client) => {
        await client.quotation.updateMany({
            where: { id: lapsed.id, isDeleted: false },
            data: {
                status: QUOTATION_STATUS.EXPIRED,
                isDeleted: true,
                deletedAt: at,
                deletedBy: actorId,
                deleteReason: 'EXPIRED_REISSUED',
                updatedBy: actorId,
            },
        });
        return issueQuotationsForApplication(applicationId, {
            actorId,
            tx: client,
            notes: `REISSUED_AFTER_EXPIRY:${lapsed.quotationNumber}`,
            ...(holderScope ? { holderScope } : {}),
        });
    };
    return typeof db.$transaction === 'function'
        ? db.$transaction((txClient) => run(txClient))
        : run(db);
}

/**
 * Return both quotations for an application (DTAM + PLATFORM). Empty
 * array entries are dropped (caller may receive 1 or 2 rows; never a
 * row marked isDeleted).
 *
 * @param {string} applicationId
 * @param {object} [opts]
 * @param {object} [opts.tx]
 * @returns {Promise<{ dtam: object|null, platform: object|null }>}
 */
async function findQuotationsByApplicationId(applicationId, opts = {}) {
    if (!applicationId) { return { dtam: null, platform: null }; }
    const db = _resolvePrisma(opts.tx);
    const rows = await db.quotation.findMany({
        where: {
            applicationId,
            ..._holderFragment(opts.holderScope),
            isDeleted: false,
        },
        orderBy: { createdAt: 'asc' },
    });
    return {
        // Legacy pre-W14 row only — no new quotation is issued as DTAM. The
        // payment gate still requires it to be accepted (quotation-gate.js).
        dtam: rows.find((r) => r.issuerType === LEGACY_DTAM_ISSUER) || null,
        platform: rows.find((r) => r.issuerType === ISSUER.PLATFORM) || null,
    };
}

/**
 * Fetch a single Quotation by ID.
 *
 * W14 (operator ruling 2026-08-22) — the ACCOUNT_DTAM / ACCOUNT_PLATFORM
 * SEPARATION IS RETIRED. It existed because the two issuers were genuinely
 * different businesses with different ledgers, signing keys and receipt
 * templates, so a DTAM accountant seeing a PLATFORM quotation was a real
 * cross-ledger leak. With one issuer there is one ledger, one signing key and
 * one template: the rule now has nothing to separate, and enforcing it would
 * just hide the company's own quotation from the company's own accountant.
 *
 * `reviewerSide` is still HONOURED when a caller passes it, and pre-W14 rows
 * still carry issuerType 'DTAM'. Removing the filter outright would widen
 * access to those historical rows as a side effect of a pricing change, which
 * is not what was authorised. New rows are all PLATFORM, so the filter simply
 * stops matching anything for them.
 *
 * @param {string} quotationId
 * @param {object} [opts]
 * @param {'DTAM'|'PLATFORM'|null} [opts.reviewerSide]  legacy filter — null = no filter
 * @param {object} [opts.tx]
 * @returns {Promise<object|null>}  null when not found OR when a supplied
 *   reviewerSide does not match a legacy row's issuerType
 */
async function findQuotationById(quotationId, opts = {}) {
    if (!quotationId) { return null; }
    const db = _resolvePrisma(opts.tx);
    const row = await db.quotation.findFirst({
        where: { id: quotationId, isDeleted: false },
    });
    if (!row) { return null; }
    if (opts.reviewerSide
        && opts.reviewerSide !== row.issuerType) {
        // Return null rather than throwing so callers can answer a generic 404
        // without leaking the row's existence.
        return null;
    }
    return row;
}

/** THB as a fixed 2-decimal string. Decimal columns arrive as strings; installments as numbers. */
function _thb(value) {
    return Number(value ?? 0).toFixed(2);
}

/** The refusal both the builder and the acceptance writer raise. */
function _snapshotRequired(reason) {
    const err = new Error(`[quotation-service] acceptance snapshot: ${reason}`);
    err.code = 'SNAPSHOT_REQUIRED';
    return err;
}

/**
 * An instalment the snapshot can freeze faithfully. Mirrors the guard in
 * _reconstructFrozenFromInstallments: without the money columns there is
 * nothing to describe, and describing it anyway writes zeros.
 */
function _hasFrozenMoneyColumns(instalment) {
    return Boolean(instalment)
        && typeof instalment.serviceFeeAmount === 'number'
        && typeof instalment.vatAmount === 'number'
        && typeof instalment.scopeCount === 'number';
}

/**
 * The document the applicant sees at the instant of acceptance, built from THIS
 * ROW and nothing else (spec 3.2, R2).
 *
 * It must NOT call the fee service. Channel C in synthesis.md 3.3 is that the
 * rate table has no effective date (config/business-rules.js:112-154), so a
 * recompute renders a document that is not the one the row holds — which is
 * exactly what the API (routes/.../quotations.js:163) and the PDF
 * (invoice-template-service.js:1021) do today. `feeTable` therefore records the
 * per-scope rates DERIVED FROM THIS ROW, not read from the config module.
 *
 * @param {object} row  a Quotation row
 * @param {{renderedAt?: Date}} [opts]
 * @returns {object} plain JSON, every money field a 2-decimal string
 * @throws {Error & {code:'SNAPSHOT_REQUIRED'}} when the row cannot be frozen
 *   faithfully (no installments, or an instalment with no money columns)
 */
function buildAcceptanceSnapshot(row, opts = {}) {
    const renderedAt = opts.renderedAt instanceof Date ? opts.renderedAt : new Date();
    const raw = Array.isArray(row?.installments) ? row.installments : [];
    // A row this function cannot describe must NOT be frozen as zeros and then
    // hashed as the applicant's accepted figures. Same precedent as
    // _reconstructFrozenFromInstallments above: a pre-GAP-5 instalment carries
    // `{phase, amount}` only, and there is no honest document to build from it.
    if (raw.length === 0) {
        throw _snapshotRequired('the row carries no installments to freeze');
    }
    const unfreezable = raw.find((it) => !_hasFrozenMoneyColumns(it));
    if (unfreezable) {
        throw _snapshotRequired(
            `instalment "${unfreezable.phase || 'unknown phase'}" carries no money columns`,
        );
    }
    const scopeCount = Number(raw[0]?.scopeCount) > 0 ? Number(raw[0].scopeCount) : 1;
    const installments = raw.map((it) => {
        const serviceFee = Number(it.serviceFeeAmount ?? 0);
        const vat = Number(it.vatAmount ?? 0);
        return {
            phase: it.phase,
            // ยอดที่งวดนี้เรียกเก็บจริง
            amount: _thb(instalmentPayable(it)),
            serviceFeeAmount: _thb(serviceFee),
            vatAmount: _thb(vat),
            // เลขคณิตของแถวเอง ไม่ใช่ของตัวคำนวณค่าธรรมเนียม: ถ้าแถวรุ่นเก่าขัดกับตัวเอง
            // ภาพนิ่งนี้ต้องแสดงให้เห็น ไม่ใช่กลบไว้
            phaseTotal: _thb(serviceFee + vat),
        };
    });
    const byPhase = Object.fromEntries(raw.map((it) => [it.phase, it]));
    return {
        quotationNumber: row?.quotationNumber ?? null,
        issuerType: row?.issuerType ?? null,
        scopeCount,
        currency: 'THB',
        installments,
        subtotal: _thb(row?.subtotal),
        vat: _thb(row?.vat),
        totalAmount: _thb(row?.totalAmount),
        validUntil: row?.validUntil ? new Date(row.validUntil).toISOString() : null,
        // อัตราต่อหนึ่งรูปแบบการปลูก ที่ **ได้มาจากแถวนี้** ไม่ใช่อ่านจากตารางค่าธรรมเนียม
        // `platformRate` ถูกถอด 2026-09-11 พร้อมการแยกส่วน — อัตราที่หารจากตัวเลขที่ไม่มีอยู่
        // จะได้ 0 เสมอ และ 0 บนเอกสารราคาอ่านได้ว่า "ไม่คิดค่าบริการ"
        feeTable: {
            phase1RatePerScope: _thb(Number(byPhase.PHASE_1?.serviceFeeAmount ?? 0) / scopeCount),
            phase2RatePerScope: _thb(Number(byPhase.PHASE_2?.serviceFeeAmount ?? 0) / scopeCount),
            vatRate: _thb(
                Number(byPhase.PHASE_2?.serviceFeeAmount ?? 0) > 0
                    ? Number(byPhase.PHASE_2.vatAmount) / Number(byPhase.PHASE_2.serviceFeeAmount)
                    : 0,
            ),
        },
        renderedAt: renderedAt.toISOString(),
    };
}

/** Recursively key-sorted JSON, so serialisation order cannot change the hash. */
function _canonicalise(value) {
    if (Array.isArray(value)) { return value.map(_canonicalise); }
    if (value && typeof value === 'object') {
        return Object.keys(value).sort().reduce((acc, k) => {
            acc[k] = _canonicalise(value[k]);
            return acc;
        }, {});
    }
    return value;
}

/** sha256 hex over the canonical JSON of a snapshot. Pure. */
function canonicalSnapshotHash(snapshot) {
    return crypto.createHash('sha256').update(JSON.stringify(_canonicalise(snapshot))).digest('hex');
}

/**
 * Mark a Quotation ACCEPTED. Used by the applicant-facing accept route.
 * Only flips when current status is PENDING / SENT / DRAFT — refuses to
 * re-accept a row that is already ACCEPTED / INVOICED / REJECTED /
 * EXPIRED, returning the unchanged row so callers can short-circuit.
 *
 * @param {string} quotationId
 * @param {object} opts
 * @param {string} opts.acceptedBy
 * @param {Date}   [opts.acceptedAt]
 * @param {object} opts.snapshot  the frozen document the applicant accepted,
 *   from buildAcceptanceSnapshot — required; the hash is derived here
 * @param {object} [opts.tx]
 * @returns {Promise<object>} the updated row, carrying acceptedSnapshot +
 *   acceptedSnapshotHash
 * @throws {Error & {code:'QUOTATION_NOT_FOUND'|'INVALID_QUOTATION_STATUS'|'SNAPSHOT_REQUIRED'|'QUOTATION_EXPIRED'}}
 */
async function markQuotationAccepted(quotationId, opts = {}) {
    if (!quotationId) {
        throw new TypeError('[quotation-service] markQuotationAccepted: quotationId required');
    }
    const { acceptedBy = null, acceptedAt = new Date(), snapshot = null, tx = null, holderScope = null } = opts;
    // An acceptance with no snapshot records that someone pressed a button and
    // nothing about what they were shown, which is the gap ISO/IEC 17065 4.1.2.1
    // asks about (synthesis.md 5(ก).9). Refuse rather than write a half-record.
    if (!snapshot || typeof snapshot !== 'object') {
        throw _snapshotRequired('markQuotationAccepted was called with no snapshot');
    }
    const db = _resolvePrisma(tx);
    const existing = await db.quotation.findFirst({
        where: { id: quotationId, ..._holderFragment(holderScope), isDeleted: false },
    });
    if (!existing) {
        const err = new Error(
            `[quotation-service] Quotation "${quotationId}" not found`,
        );
        err.code = 'QUOTATION_NOT_FOUND';
        throw err;
    }
    const acceptable = new Set([
        QUOTATION_STATUS.DRAFT,
        QUOTATION_STATUS.PENDING,
        QUOTATION_STATUS.SENT,
    ]);
    if (!acceptable.has(existing.status)) {
        // Idempotent no-op for already-accepted rows; everything else is a
        // hard 409 at the route layer. An ACCEPTED row returns here BEFORE the
        // expiry test below on purpose: an accepted quotation is an agreement,
        // and agreements do not lapse because the offer window closed — the
        // same rule the payment gate applies (quotation-gate.js).
        if (existing.status === QUOTATION_STATUS.ACCEPTED) { return existing; }
        const err = new Error(
            `[quotation-service] Cannot accept quotation in status "${existing.status}"`,
        );
        err.code = 'INVALID_QUOTATION_STATUS';
        throw err;
    }
    // The SAME predicate the payment gate uses, at the door the applicant
    // actually presses (final round R1). Until this line the window bound only
    // the applicants who did NOT press the button: the gate refused a lapsed,
    // still-unaccepted row with QUOTATION_EXPIRED, and the applicant cleared
    // that refusal by pressing ยอมรับ on the same screen, after which the gate
    // passed. Nothing else in the system ever wrote status EXPIRED, so the
    // validity window had no enforcement anywhere.
    //
    // The applicant is not left holding an unusable document: the payments read
    // retires this row and issues a replacement (reissueLapsedQuotation, driven
    // by quotation-issuance-on-submit.ensureQuotationForIssuedApplication),
    // which is the action QUOTATION_EXPIRED's copy names.
    if (existing.validUntil && new Date(existing.validUntil).getTime() < new Date(acceptedAt).getTime()) {
        const err = new Error(
            `[quotation-service] Quotation "${quotationId}" lapsed on `
            + `${new Date(existing.validUntil).toISOString()} and can no longer be accepted`,
        );
        err.code = 'QUOTATION_EXPIRED';
        throw err;
    }
    return db.quotation.update({
        where: { id: quotationId },
        data: {
            status: QUOTATION_STATUS.ACCEPTED,
            acceptedAt,
            acceptedBy,
            acceptedSnapshot: snapshot,
            acceptedSnapshotHash: canonicalSnapshotHash(snapshot),
            // Kept: every existing reader of updatedBy keeps working. acceptedBy
            // is the narrower fact (this column moves only on acceptance).
            updatedBy: acceptedBy,
        },
    });
}

/**
 * Flip an accepted quotation to INVOICED — call site is the invoice-
 * generation path (Tier 19) once it spawns the four downstream Invoice
 * rows from the quotation's installments.
 *
 * @param {string} quotationId
 * @param {object} [opts]
 * @param {object} [opts.tx]
 * @returns {Promise<object>}
 */
async function markQuotationInvoiced(quotationId, opts = {}) {
    if (!quotationId) {
        throw new TypeError('[quotation-service] markQuotationInvoiced: quotationId required');
    }
    const db = _resolvePrisma(opts.tx);
    const existing = await db.quotation.findFirst({
        where: { id: quotationId, isDeleted: false },
    });
    if (!existing) {
        const err = new Error(
            `[quotation-service] Quotation "${quotationId}" not found`,
        );
        err.code = 'QUOTATION_NOT_FOUND';
        throw err;
    }
    if (existing.status === QUOTATION_STATUS.INVOICED) { return existing; }
    if (existing.status !== QUOTATION_STATUS.ACCEPTED) {
        const err = new Error(
            `[quotation-service] Cannot mark INVOICED from status "${existing.status}" — must be ACCEPTED first`,
        );
        err.code = 'INVALID_QUOTATION_STATUS';
        throw err;
    }
    return db.quotation.update({
        where: { id: quotationId },
        data: { status: QUOTATION_STATUS.INVOICED },
    });
}

/** Which stamp column each instalment writes. */
const PHASE_INVOICED_COLUMN = Object.freeze({
    PHASE_1: 'phase1InvoicedAt',
    PHASE_2: 'phase2InvoicedAt',
});

/**
 * The states the guarded close may flip FROM (R4). Derived from the gate's own
 * accepted-states list rather than retyped, minus INVOICED itself: a row that
 * already carries the label needs no second UPDATE writing the same value, and
 * @updatedAt would move on a money document for nothing.
 */
const FLIPPABLE_TO_INVOICED = Object.freeze(
    QUOTATION_ACCEPTED_STATES.filter((s) => s !== QUOTATION_STATUS.INVOICED),
);
/**
 * Milestone vocabulary → instalment phase (M1/M2 on the card rail, PHASE_1 /
 * PHASE_2 on the slip rail). This WAS a private copy of the gate's map, on the
 * reasoning that importing the gate would close a require cycle. It does not:
 * the gate defers its own require of this module to the inside of the gate
 * function precisely so this direction stays open, and the constant import at
 * the top of this file proves it. One map, one meaning of "งวดนี้".
 */
const MILESTONE_PHASE = MILESTONE_TO_PHASE;

/**
 * Does the document this row froze at acceptance agree with the figure the
 * charge actually collected for `phase`?
 *
 * Asked ONLY on the applicationId fallback (F-G4-64, review r0 finding 3). When
 * `checkout_orders.quotationId` is set, the mint already compared the live
 * breakdown against the accepted snapshot to the satang and refused as
 * CHECKOUT_PRICE_DRIFT on any difference, and the order carries the hash of the
 * snapshot that matched; re-deciding here would add a second, weaker opinion on
 * a question already settled. The fallback has no such proof: it picks whatever
 * quotation is live for the application at settlement time, which is not
 * necessarily the document this charge collected against.
 *
 * Compared against `phaseTotal` — the same field the mint-time check compares
 * `totalPayableAmount` with (services/checkout/stripe-checkout-service.js) — so
 * the two doors cannot disagree about which figure "the accepted price of this
 * instalment" means.
 *
 * Formatting is _thb's job (this module's one 2-decimal formatter); the
 * finiteness guard is here because on a money path a figure that cannot be read
 * is a refusal, never a match.
 *
 * @returns {{chargedAmount: string|null, acceptedAmount: string|null}|null}
 *          null = nothing to disagree about (either they match, or the row
 *          froze no figures at all and is handled by the notes marker instead).
 */
function _acceptedFigureMismatch(row, phase, chargedAmount) {
    const frozen = Array.isArray(row?.acceptedSnapshot?.installments)
        ? row.acceptedSnapshot.installments
        : null;
    // A row that never recorded an acceptance froze no figures, so there is no
    // agreed price to contradict. Refusing here would leave every pre-gate row
    // unstamped forever; it is stamped, and `notes` says it was billed without
    // a recorded acceptance (INVOICED_WITHOUT_ACCEPTANCE).
    if (!frozen) { return null; }

    const acceptedRaw = Number(frozen.find((it) => it.phase === phase)?.phaseTotal);
    // Number(null) and Number('') are both 0. On a money path "the caller said
    // nothing" must not read as "zero baht was collected" — that would silently
    // match a 0.00 instalment and stamp on no evidence at all.
    const chargedRaw = (chargedAmount === null || chargedAmount === undefined || chargedAmount === '')
        ? NaN
        : Number(chargedAmount);
    const acceptedAmount = Number.isFinite(acceptedRaw) ? _thb(acceptedRaw) : null;
    const charged = Number.isFinite(chargedRaw) ? _thb(chargedRaw) : null;
    if (acceptedAmount !== null && charged !== null && acceptedAmount === charged) { return null; }
    return { chargedAmount: charged, acceptedAmount };
}

/**
 * Stamp the per-instalment invoiced time and close the quotation only when
 * EVERY instalment it prices has been billed (F-G4-64, spec §3.3).
 *
 * Under W14 one quotation prices BOTH phases, so flipping INVOICED at M1 would
 * declare the whole document billed while งวดที่ 2 has not been — and INVOICED
 * is not an inert label: the slip gate reads it as "the farmer accepted"
 * (QUOTATION_ACCEPTED_STATES). A renewal prices PHASE_2 only, so for a renewal
 * that one stamp closes the document.
 *
 * A row that is not in {ACCEPTED, INVOICED} — a pre-gate row — is STAMPED but
 * NOT flipped: the invoicing is a fact, the acceptance is not, and writing
 * ACCEPTED here would record an event that never happened (R5).
 *
 * This function is called from OUTSIDE the settle transaction. It must never
 * be moved inside it (see settlement-quotation-must-not-throw-in-tx.test.js).
 *
 * @param {object} args
 * @param {string} [args.quotationId]    preferred — checkout_orders.quotationId
 * @param {string} [args.applicationId]  fallback for an order minted before the binding existed
 * @param {'M1'|'M2'|'PHASE_1'|'PHASE_2'} args.milestone
 * @param {string} [args.invoiceNumber]  recorded in notes when the row was never accepted
 * @param {number|string} [args.chargedAmount] what the charge actually collected for this
 *        instalment. Only consulted on the applicationId fallback, where the document is a
 *        guess: it is compared with the accepted snapshot and a difference refuses the stamp.
 * @param {Date}   [args.at]             the ONE settlement instant
 * @param {object} [args.tx]
 * @returns {Promise<{quotationId: string, phase: 'PHASE_1'|'PHASE_2',
 *                    closed: boolean, status: string, stamped: boolean,
 *                    mismatch: {chargedAmount: string|null, acceptedAmount: string|null}|null}
 *                   | null>}
 *          null when no quotation could be found (logged by the caller, never thrown);
 *          `stamped: false` when the fallback found a document the charge does not match —
 *          also a return value, never a throw, because settlement may not fail for a
 *          quotation reason.
 * @throws only on a genuine database failure — the CALLER catches everything
 */
async function recordPhaseInvoiced({
    quotationId = null, applicationId = null, milestone, invoiceNumber = null,
    chargedAmount = null, at = new Date(), tx = null,
} = {}) {
    const phase = MILESTONE_PHASE[String(milestone || '').toUpperCase()];
    const column = PHASE_INVOICED_COLUMN[phase];
    if (!column) {
        const err = new Error(`[quotation-service] recordPhaseInvoiced: unknown milestone "${milestone}"`);
        err.code = 'UNKNOWN_MILESTONE';
        throw err;
    }
    const db = _resolvePrisma(tx);

    let row = null;
    let bound = false;
    // BOTH lookups run outside the tenant scope (R6). This function is called
    // from settlement (a webhook worker) and from an ACCOUNT reviewer's slip
    // approval — never from the applicant's own request — and 'Quotation' is in
    // TENANT_SCOPED_MODELS, so a bound context would narrow the read to the
    // ACTOR's organization. For an applicant outside it the row simply would
    // not be found: the document a payment collects against would never close,
    // reported only as a logger.error in the caller. The document is resolved
    // by the application and by the order that names it, never by who happens
    // to be pressing approve.
    if (quotationId) {
        row = await withoutTenantScope(() => db.quotation.findFirst({
            where: { id: quotationId, isDeleted: false },
        }));
        // The order names this exact document, so the mint already proved the
        // figures matched before anything was charged.
        bound = Boolean(row);
    }
    if (!row && applicationId) {
        // An order minted before checkout_orders.quotationId existed still knows
        // its application. Prefer the company row, exactly as the gate does.
        const { dtam, platform } = await withoutTenantScope(
            () => findQuotationsByApplicationId(applicationId, { tx }),
        );
        row = platform || dtam;
    }
    if (!row) { return null; }   // the caller logs; this never throws for "absent"

    // The fallback picked this document; it did not prove it. If the row's own
    // frozen figures disagree with what was collected, stamping it would record
    // that this document was billed by a charge that took a different amount —
    // and quotation-closure would then read the row as closed, hiding it.
    const mismatch = bound ? null : _acceptedFigureMismatch(row, phase, chargedAmount);
    if (mismatch) {
        return {
            quotationId: row.id, phase, closed: false, status: row.status,
            stamped: false, mismatch,
        };
    }

    const alreadyStamped = Boolean(row[column]);
    const stamps = {
        phase1InvoicedAt: row.phase1InvoicedAt,
        phase2InvoicedAt: row.phase2InvoicedAt,
        [column]: alreadyStamped ? row[column] : at,
    };

    // Which instalments does THIS row price? A renewal has only PHASE_2.
    const priced = new Set((Array.isArray(row.installments) ? row.installments : [])
        .map((i) => i.phase).filter((p) => PHASE_INVOICED_COLUMN[p]));
    if (priced.size === 0) { priced.add('PHASE_1').add('PHASE_2'); } // legacy row with no instalments

    // ONE vocabulary for "the applicant accepted", read from the module that
    // owns it (review r1, finding 2). A private copy here is the copy that
    // decides whether INVOICED may be written at all, so a later state added to
    // the gate would silently read as never-accepted on exactly this line:
    // stamped without being flipped, and libelled INVOICED_WITHOUT_ACCEPTANCE.
    // It is the same list the guarded close below sends to the database.
    const wasAccepted = QUOTATION_ACCEPTED_STATES.includes(row.status);
    const data = { [column]: stamps[column] };
    // Say in the row itself that this was billed without a recorded acceptance,
    // rather than leaving a silent stamp — ONCE (review r1, finding 1). This
    // function is the heal path as well as the settle path: the already-SETTLED
    // branch calls it on every Stripe redelivery, settleEvent retry and
    // reconcile pass for the same (order, phase), and the rows it heals are the
    // drain-window ones whose quotation is still PENDING — i.e. exactly this
    // branch. Appending per attempt made the row read as the same instalment
    // invoiced N times against one receipt number. The guard is the note's own
    // content rather than `!alreadyStamped`, so a SECOND document for the same
    // phase is still recorded, and a first pass that had no number to write can
    // still gain one later.
    const note = `INVOICED_WITHOUT_ACCEPTANCE ${phase} ${invoiceNumber}`;
    if (!wasAccepted && invoiceNumber && !String(row.notes || '').includes(note)) {
        data.notes = row.notes ? `${row.notes}\n${note}` : note;
    }

    // Nothing to write is nothing to write: an UPDATE whose data changes no
    // field still bumps `updatedAt` (@updatedAt on Quotation) on a money
    // document, so a heal pass over an already-correct row would rewrite the
    // document's timestamp on every redelivery. The answer is unchanged, so no
    // caller can read a no-op as a failure. A row that already says INVOICED
    // needs no close attempt either — that is the only state the guarded flip
    // below could write, and writing it twice is the same wasted UPDATE.
    const alreadyClosed = row.status === QUOTATION_STATUS.INVOICED;
    if (alreadyStamped && !data.notes && alreadyClosed) {
        return {
            quotationId: row.id, phase, closed: true, status: row.status,
            stamped: true, mismatch: null,
        };
    }

    let current = row;
    if (!alreadyStamped || data.notes) {
        current = await db.quotation.update({ where: { id: row.id }, data });
    }

    // ── The close is the DATABASE's decision, not this snapshot's (R4) ───────
    //
    // `row` was read outside any transaction. Under W14 one quotation prices
    // BOTH phases and the two settle on their own webhooks, so two closes that
    // interleave each saw the other's stamp as NULL: neither wrote INVOICED and
    // the document stayed ACCEPTED with everything billed, which the closure
    // probe reads as an open quotation forever. A guarded updateMany asks the
    // question against the row AS IT STANDS, so whichever writer commits last
    // performs the flip and the loser changes nothing.
    //
    // The WHERE is built from the instalments THIS document prices: a renewal
    // carries PHASE_2 only, and demanding phase1InvoicedAt of it would leave
    // every renewal open for ever. For the two-phase W14 row it is exactly
    // "phase1InvoicedAt not null AND phase2InvoicedAt not null".
    let closed = current.status === QUOTATION_STATUS.INVOICED;
    let status = current.status;
    if (!closed) {
        const where = { id: row.id, status: { in: FLIPPABLE_TO_INVOICED } };
        for (const p of priced) { where[PHASE_INVOICED_COLUMN[p]] = { not: null }; }
        const flip = await db.quotation.updateMany({
            where, data: { status: QUOTATION_STATUS.INVOICED },
        });
        if (flip?.count > 0) {
            closed = true;
            status = QUOTATION_STATUS.INVOICED;
        }
    }

    return {
        quotationId: row.id, phase, closed, status, stamped: true, mismatch: null,
    };
}

module.exports = {
    // Status + issuer enums re-exported for callers
    QUOTATION_STATUS,
    ISSUER,
    // Public API
    issueQuotationsForApplication,
    // F-G4-64 R1 - retire a lapsed offer and issue its replacement atomically.
    // The only writer of status EXPIRED in the product.
    reissueLapsedQuotation,
    findQuotationsByApplicationId,
    findQuotationById,
    markQuotationAccepted,
    markQuotationInvoiced,
    // F-G4-64 §3.3 — the ONLY production writer of INVOICED, now on BOTH money
    // rails: checkout settlement calls it after its transaction commits, and
    // payment-slip-service.approveSlip after its own. markQuotationInvoiced
    // above stays exported and tested but has no production caller.
    recordPhaseInvoiced,
    // F-G4-64 — the acceptance record. The route builds the snapshot from the
    // row it is about to accept and hands it to markQuotationAccepted; the
    // checkout gate re-hashes the stored snapshot to prove the charge matches.
    buildAcceptanceSnapshot,
    canonicalSnapshotHash,
    // GAP-5: frozen price-of-record reader for downstream billing
    getFrozenPhaseFees,
    // W12 — the pure halves of the billing decision, exported so the
    // single-charge rule and the new-application golden values can be asserted
    // against the REAL code path without a database in the loop.
    _internals: {
        // Exported so a unit test can prove no issuer value is undefined.
        QT_PREFIX,
        LEGACY_DTAM_ISSUER,
        resolveBillableFees: _resolveBillableFees,
        buildInstallments: _buildInstallments,
        reconstructFrozenFromInstallments: _reconstructFrozenFromInstallments,
        isRenewal: _isRenewal,
        // F-G4-64 — both are pure, so the acceptance document and its hash can
        // be asserted with no database in the loop.
        buildAcceptanceSnapshot,
        canonicalSnapshotHash,
    },
    // Test-only helper for the in-memory fallback counter
    _resetFallbackCountersForTest,
};
