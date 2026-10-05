/**
 * Shared helpers for invoice routes.
 *
 * @module routes/api/finance/invoice-helpers
 */

const invoiceService = require('../../../services/invoice-service');
// Sprint 6 healthId-audit H8: route identity lookups through the canonical
// applicationService.resolveHealthIdentity. The legacy local fallback is kept
// for the cases where a healthId is already on the user object (token claim
// or pre-resolved upstream) so the canonical service is only hit when we
// actually have to query the DB.
const applicationService = require('../../../services/application-service');

const PAID_STATUSES = new Set(['PAID', 'PAID_PENDING_RECEIPT', 'RECEIPT_ISSUED']);

async function resolveHealthId(user) {
    // Prefer canonicalId (Invoice FK target), fallback to healthId.
    const explicitCanonical = String(user?.canonicalId || user?.healthId || '').trim();
    if (explicitCanonical) {
        return explicitCanonical;
    }

    const userId = String(user?.id || '').trim();
    if (!userId) {
        return null;
    }

    try {
        const identity = await applicationService.resolveHealthIdentity(userId, { userId });
        return identity.healthId || null;
    } catch (_error) {
        return null;
    }
}

/**
 * The invoice behind a health door that hands out a finance document (invoice
 * PDF, receipt / tax invoice), read by holder (spec 2026-09-30-remove-workspace-mode
 * §3.1): one findFirst whose where carries the Invoice holder fragment of
 * `scope` (holderScope(req)). No row → 404, for strangers, missing and
 * soft-deleted invoices alike (an existing invoice the caller may not read is
 * never told apart from a missing one).
 *
 * No holder scope: 404 with no query (fail closed).
 * @param {string} invoiceId
 * @param {{ readIds: string[] }} scope
 * @returns {Promise<object>} the invoice (billing view)
 */
async function findHealthInvoice(invoiceId, scope) {
    const notFound = () => Object.assign(new Error('Invoice not found'), { statusCode: 404 });
    if (!scope || !Array.isArray(scope.readIds)) {
        throw notFound();
    }
    const invoice = await invoiceService.getForHolder(invoiceId, { scope });
    if (invoice) {
        return invoice;
    }
    throw notFound();
}

/**
 * A receipt the applicant may download: the invoice is settled (any casing the
 * registers store — demo keeps `paid`, staging `PAID`) AND settlement bound a
 * receipt number to it. A voided invoice is not settled, even after a receipt.
 */
function hasIssuedReceipt(invoice) {
    const status = String(invoice?.status || '').trim().toUpperCase();
    const receiptNumber = String(invoice?.receiptNumber || '').trim();
    return PAID_STATUSES.has(status) && receiptNumber.length > 0;
}

/** The download name: the receipt number, reduced to filename-safe characters. */
function receiptFileName(invoice) {
    const safe = String(invoice?.receiptNumber || invoice?.id || 'receipt').replace(/[^A-Za-z0-9._-]/g, '_');
    return `${safe}.pdf`;
}

// ── การอ่าน: ไม่มีการแคบตามบทบาทอีกแล้ว (operator 2026-09-11) ─────────────────────
// "finance ต้องเห็นเหมือนกัน หรือว่าตัวเลขที่ต้องมากระทบยอด ต้องเท่ากัน เพื่อแสดงความโปร่งใส"
// เดิมไฟล์นี้มี invoiceSideWhere ซึ่งแคบรายการ/ยอดรวม/ส่งออก ให้การเงินแต่ละบทบาทเห็นแค่
// "ฝั่ง" ของตัวเอง (VIS-ACCT-02 ขาอ่าน) — ถูกลบทั้งตัว · ทุกประตูอ่านถามคำถามเดียวกัน
// ให้ทั้งสองบทบาท · `serviceType` ยังเป็นมิติข้อมูลที่ผู้ดูเลือกกรองเองได้ แต่บทบาทไม่บังคับ
//
// ที่เหลือข้างล่างคือขาเขียนเท่านั้น (hold/release) · operator 2026-09-27 "กรมฯ ดูอย่างเดียว":
// การเงินกรมไม่มี RECEIPT_ISSUE แล้ว จึงไม่ถึงด่านนี้ · ด่านนี้ยังมีผลกับการเงินบริษัทเพียงข้อเดียว:
// ระงับ/ปลดระงับใบแจ้งหนี้ค่าธรรมเนียมรัฐแบบเก่า (STATE) ไม่ได้ — ไม่ลบ เพราะการลบคือการขยาย
// อำนาจเขียนของการเงินบริษัท ต้องให้ operator ตัดสิน
const { resolveAllowedIssuerSides, classifyIssuerSide } = require('../../../services/finance/invoice-side');

/**
 * The single issuer side this user may WRITE on ('DTAM' | 'PLATFORM'), or null
 * when the user may act on both sides (admin / field inspector) or is unclassifiable.
 * Used only by the write-side guard below — never to narrow a read.
 */
function invoiceVisibleSide(user) {
    const sides = resolveAllowedIssuerSides(user);
    return sides.length === 1 ? sides[0] : null;
}

/**
 * Write-side SoD guard for invoice-by-id mutations (hold/release/forfeit), mirror
 * of the approveSlip/rejectSlip check. A single-side accountant
 * (ACCOUNT_DTAM/ACCOUNT_PLATFORM) may only mutate THEIR side's invoices; legacy
 * ACCOUNT/ADMIN (both sides) are unrestricted. Throws 403 INVALID_REVIEWER_SIDE
 * (or 404 if the invoice is missing). multi-role system test 2026-06-24 (P1).
 */
async function assertInvoiceSideWritable(user, invoiceId) {
    const side = invoiceVisibleSide(user);
    if (!side) { return; } // both-sides role → no narrowing
    const invoice = await invoiceService.getById(invoiceId);
    if (!invoice) {
        const err = new Error('Invoice not found');
        err.statusCode = 404;
        throw err;
    }
    if (classifyIssuerSide(invoice.serviceType) !== side) {
        const err = new Error('You may not act on the other money-flow side\'s invoice');
        err.statusCode = 403;
        err.code = 'INVALID_REVIEWER_SIDE';
        throw err;
    }
}

module.exports = {
    PAID_STATUSES,
    resolveHealthId,
    findHealthInvoice,
    hasIssuedReceipt,
    receiptFileName,
    invoiceVisibleSide,
    assertInvoiceSideWritable,
    classifyIssuerSide,
};
