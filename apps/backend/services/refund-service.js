/**
 * Refund Service — Iter 23 (2026-05-16).
 *
 * Orchestrates the end-to-end PLATFORM-side refund flow:
 *
 *      Applicant cancels →
 *        Finance staff calls initiateRefund(...) →
 *          ┌───────────────────────────────────────────────────────┐
 *          │ Single Prisma $transaction:                            │
 *          │   1. creditNoteService.createCreditNote(...)  DRAFT    │
 *          │   2. creditNoteService.issueCreditNote(...)   ISSUED   │
 *          │   3. creditNoteService.postCreditNote(...)    POSTED   │
 *          │      → writes REVERSING JournalEntry via credit-note   │
 *          │        layer (Dr Revenue, Dr Output VAT, Cr Cash)      │
 *          │   4. Invoice.metadata.refund = { status, creditNoteId, │
 *          │      reasonCode, reason, initiatedAt, initiatedBy }    │
 *          └───────────────────────────────────────────────────────┘
 *        →  Notify applicant via notificationFanoutService.send(...)
 *           with the REFUND_INITIATED template (in-app + email + SMS)
 *        →  Out-of-band: finance staff makes the actual bank transfer.
 *           This service records the ACCOUNTING REVERSAL only; the cash
 *           outflow happens manually and is reconciled into the
 *           Cr Cash/Bank line of the reversing entry posted above.
 *
 * Scope — PLATFORM only. State-fee (DTAM) refunds are reissued through
 * Treasury's กรมบัญชีกลาง refund process and DO NOT touch this service.
 * Enforcement happens transitively via credit-note-service.assertInvoiceEligible
 * which throws NOT_PLATFORM_INVOICE for STATE serviceTypes — we surface that
 * error so the caller knows to route through Treasury instead.
 *
 * Legal basis:
 *   - ป.รัษฎากร ม.86/10 — ใบลดหนี้ MUST accompany any reduction in
 *     taxable amount; emitted by credit-note-service in step 1-3.
 *   - ป.รัษฎากร ม.86/4 — sequential numbering + 7-year retention.
 *   - TFRS for NPAEs ch.18 — revenue is REDUCED in the period the CN is
 *     recognised; original invoice + journal stay immutable; a REVERSING
 *     entry posts in this period.
 *
 * Idempotency: initiateRefund inspects Invoice.metadata.refund before
 * starting the transaction. If a refund is already INITIATED, the
 * existing record is returned untouched — repeated calls are safe.
 *
 * @module services/refund-service
 */

'use strict';

const logger = require('../shared/logger');
const { normalizeRole, CANONICAL_ROLES } = require('../shared/canonical-rbac');
const creditNoteService = require('./credit-note-service');
const notificationFanoutService = require('./notification-fanout-service');
const { auditLogger, AuditCategory, AuditSeverity, ResourceType } = require('../middleware/audit-logger');

let prismaModule;
try {
    prismaModule = require('./prisma-database');
} catch (_e) {
    prismaModule = { prisma: null };
}

// ── Constants ──────────────────────────────────────────────────────────────

const REFUND_STATUS = Object.freeze({
    NONE: 'NONE',
    INITIATED: 'INITIATED',
    BANK_TRANSFER_PENDING: 'BANK_TRANSFER_PENDING',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
});

const WRITE_ROLES = new Set([
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
]);

const CANCEL_ROLES = new Set([CANONICAL_ROLES.SYSTEM_ADMIN_DTAM]);

// ด่านอ่าน (สถานะการคืนเงิน) — การเงินสองบทบาทเห็นชุดเดียวกัน (operator 2026-09-11)
// WRITE_ROLES / CANCEL_ROLES ข้างบนไม่ขยาย
const READ_ROLES = new Set([
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
]);
// ผู้ตรวจประเมินไม่อยู่ในชุดอ่านเรื่องเงิน (operator 2026-09-27)

// ── Errors ─────────────────────────────────────────────────────────────────

function makeError(code, message, status = 400) {
    const e = new Error(message);
    e.code = code;
    e.statusCode = status;
    return e;
}

function resolvePrisma() {
    return prismaModule && prismaModule.prisma ? prismaModule.prisma : null;
}

function assertWriteAccess(actor, invoice) {
    const role = normalizeRole(actor?.canonicalRole || actor?.role);
    if (!role || !WRITE_ROLES.has(role)) {
        throw makeError(
            'FORBIDDEN_ROLE',
            'ACCOUNT_PLATFORM or ADMIN role required to initiate a refund',
            403,
        );
    }
    if (role !== CANONICAL_ROLES.SYSTEM_ADMIN_DTAM
        && actor?.organizationId
        && invoice?.organizationId
        && actor.organizationId !== invoice.organizationId) {
        throw makeError(
            'FORBIDDEN_TENANT',
            'Cross-tenant access denied — refunds are scoped to the invoice owner',
            403,
        );
    }
}

function assertReadAccess(actor) {
    const role = normalizeRole(actor?.canonicalRole || actor?.role);
    if (!role || !READ_ROLES.has(role)) {
        throw makeError(
            'FORBIDDEN_ROLE',
            'A finance or admin role is required to view refund status',
            403,
        );
    }
}

function assertCancelAccess(actor) {
    const role = normalizeRole(actor?.canonicalRole || actor?.role);
    if (!role || !CANCEL_ROLES.has(role)) {
        throw makeError(
            'FORBIDDEN_ROLE',
            'ADMIN role required to cancel a refund (separation of duties)',
            403,
        );
    }
}

async function safeAudit(action, severity, actor, resourceId, metadata) {
    try {
        await auditLogger.log({
            category: AuditCategory.PAYMENT,
            action,
            severity,
            actorId: actor?.id || 'SYSTEM',
            actorEmail: actor?.email || null,
            actorRole: actor?.canonicalRole || actor?.role || 'UNKNOWN',
            actorType: actor?.providerId ? 'PROVIDER' : 'USER',
            resourceType: ResourceType.INVOICE,
            resourceId,
            organizationId: actor?.organizationId || null,
            metadata: metadata || {},
        });
    } catch (err) {
        logger.warn(`[refund] audit log failed (non-fatal): ${err?.message}`);
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Read the refund block from Invoice.metadata. Schema doesn't have a
 * dedicated `refundStatus` column for Iter 23 (would require a migration),
 * so we stash the structured refund record on Invoice.metadata.refund.
 *
 * TODO(schema): a future migration can promote Invoice.refundStatus +
 * Invoice.refundedAt to first-class columns once the cardinality stabilises
 * (currently expected: ≤1 refund per invoice, but Iter N+1 may allow
 * partial refunds → array). The metadata.refund JSON form is forward-
 * compatible because Prisma Json columns survive migration into typed
 * columns.
 */
function _readRefundBlock(invoice) {
    let meta = invoice?.metadata || {};
    // Bug 2.2 self-heal: legacy rows written by the old holdInvoice
    // (which JSON.stringify'd into the Json? column) store metadata as a
    // double-encoded STRING. Parse it so the refund idempotency guard still
    // fires for those rows instead of silently returning null (which bypassed
    // the guard → double-refund). New writes persist an object, so this branch
    // only ever runs for corrupted-at-rest rows.
    if (typeof meta === 'string') {
        try {
            meta = JSON.parse(meta || '{}');
        } catch (_e) {
            return null;
        }
    }
    return meta && typeof meta === 'object' ? (meta.refund || null) : null;
}

function _mergeRefundBlock(existingMetadata, refundBlock) {
    const meta = (existingMetadata && typeof existingMetadata === 'object') ? existingMetadata : {};
    return { ...meta, refund: refundBlock };
}

async function _loadInvoiceForRefund(prisma, invoiceId) {
    const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: {
            id: true,
            invoiceNumber: true,
            organizationId: true,
            serviceType: true,
            subtotal: true,
            vat: true,
            totalAmount: true,
            status: true,
            isDeleted: true,
            metadata: true,
            healthId: true,
            // Waiver-reopen policy (owner ruling 2026-07-08): refunds are
            // BLOCKED when the linked application is EXPIRED/REJECTED — the
            // fee is non-refundable by policy (the leniency path is the
            // fee-reuse reopen, never a cash refund). Pull the status for the
            // gate in initiateRefund.
            application: { select: { id: true, status: true } },
            // C2-class: `applicantUserId` is not a column on Invoice. Prisma 5.x
            // validates ALL select keys regardless of true/false → this threw and
            // the .catch(()=>null) swallowed it → every refund-initiate 404'd.
            // The applicant relation below is the correct accessor.
            applicant: {
                select: { id: true, email: true, phoneNumber: true, firstName: true, lastName: true },
            },
        },
    }).catch(() => null);
    return invoice;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Initiate a refund against a paid PLATFORM invoice.
 *
 * Flow (single $transaction):
 *   1. validate the invoice (exists, paid, PLATFORM issuer, not soft-deleted,
 *      not already refunded)
 *   2. credit-note-service: create DRAFT → issue → post (writes reversing JE)
 *   3. update Invoice.metadata.refund with status=INITIATED + linkage
 *
 * After the transaction commits, the applicant is notified via
 * notification-fanout-service (best-effort — notification failures do NOT
 * roll back the refund).
 *
 * @param {object} args
 * @param {string} args.invoiceId        — Invoice.id to refund.
 * @param {string} args.reason           — Thai-language free-text reason
 *                                          (≥3 chars). Printed on the CN PDF.
 * @param {string} args.reasonCode       — one of credit-note VALID_REASON_CODES.
 * @param {string} args.actorId          — actor User.id (also surfaces in
 *                                          audit-log + journal-entry meta).
 *                                          When `actor` is supplied with a
 *                                          canonicalRole, that takes precedence.
 * @param {object} [args.actor]          — full actor context preferred.
 * @param {string} [args.organizationId] — explicit tenant override (admin path).
 * @returns {Promise<{
 *   creditNoteId: string,
 *   creditNoteNumber: string,
 *   journalEntryId: ?string,
 *   refundStatus: string,
 *   invoiceId: string,
 *   notification: object | null,
 *   idempotent: boolean
 * }>}
 */
async function initiateRefund({
    invoiceId, reason, reasonCode, actorId, actor, organizationId,
} = {}) {
    if (!invoiceId) {
        throw makeError('VALIDATION_ERROR', 'invoiceId is required');
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
        throw makeError('VALIDATION_ERROR', 'reason is required (Thai free-text ≥3 chars)');
    }
    if (!reasonCode) {
        throw makeError('VALIDATION_ERROR', 'reasonCode is required');
    }

    const effectiveActor = actor || (actorId ? { id: actorId } : null);
    if (!effectiveActor) {
        throw makeError('VALIDATION_ERROR', 'actor or actorId is required');
    }

    const prisma = resolvePrisma();
    if (!prisma) {
        throw makeError('DB_UNAVAILABLE', 'Prisma client unavailable for refund', 503);
    }

    const invoice = await _loadInvoiceForRefund(prisma, invoiceId);
    if (!invoice) {
        throw makeError('INVOICE_NOT_FOUND', `Invoice ${invoiceId} not found`, 404);
    }
    if (invoice.isDeleted) {
        throw makeError('INVOICE_DELETED', 'Invoice is soft-deleted', 410);
    }
    if (String(invoice.status || '').toLowerCase() !== 'paid') {
        throw makeError(
            'INVOICE_NOT_PAID',
            `Refund requires a PAID invoice (current: ${invoice.status})`,
            409,
        );
    }

    // Waiver-reopen policy (owner ruling 2026-07-08): fees on EXPIRED /
    // REJECTED applications are non-refundable — the leniency channel is the
    // fee-reuse reopen (waiver-reopen-service), never a cash refund. This
    // converts the policy from prose into code.
    const appStatus = String(invoice.application?.status || '').toUpperCase();
    if (appStatus === 'EXPIRED' || appStatus === 'REJECTED') {
        throw makeError(
            'REFUND_BLOCKED_BY_POLICY',
            `Fees on ${appStatus} applications are non-refundable (waiver-reopen is the leniency path)`,
            409,
        );
    }

    assertWriteAccess(effectiveActor, invoice);

    // Idempotency — if a refund is already INITIATED (or COMPLETED), return
    // the existing record. Caller (route handler) does not need to know.
    const existing = _readRefundBlock(invoice);
    if (existing && existing.status === REFUND_STATUS.INITIATED) {
        logger.info(`[refund] idempotent return — invoice ${invoice.invoiceNumber} already INITIATED`);
        return {
            creditNoteId: existing.creditNoteId || null,
            creditNoteNumber: existing.creditNoteNumber || null,
            journalEntryId: existing.journalEntryId || null,
            refundStatus: existing.status,
            invoiceId: invoice.id,
            notification: null,
            idempotent: true,
        };
    }
    if (existing && existing.status === REFUND_STATUS.COMPLETED) {
        throw makeError(
            'REFUND_ALREADY_COMPLETED',
            'This invoice has already been refunded and the bank transfer recorded',
            409,
        );
    }

    // Use FULL invoice amounts — Iter 23 supports full-refund only. Partial
    // refunds (subtotal/vat split) defer to Iter 24+, at which point we
    // accept an explicit { subtotal, vat } in args. The credit-note layer
    // already enforces cap-vs-original so this is safe.
    const subtotal = Number(invoice.subtotal) || 0;
    const vat = Number(invoice.vat) || 0;

    let txResult;
    try {
        txResult = await prisma.$transaction(async (tx) => {
            // 1. Create CN (DRAFT)
            const cnDraft = await creditNoteService.createCreditNote({
                originalInvoiceId: invoice.id,
                reasonCode,
                reason: reason.trim(),
                subtotal,
                vat,
                actor: effectiveActor,
                organizationId: organizationId || invoice.organizationId,
            });
            // 2. Issue (DRAFT → ISSUED)
            const cnIssued = await creditNoteService.issueCreditNote(cnDraft.id, {
                actor: effectiveActor,
            });
            // 3. Post (ISSUED → POSTED — writes reversing JE via journal-entry-service)
            const cnPosted = await creditNoteService.postCreditNote(cnIssued.id, {
                actor: effectiveActor,
            });

            const refundBlock = {
                status: REFUND_STATUS.INITIATED,
                creditNoteId: cnPosted.id,
                creditNoteNumber: cnPosted.creditNoteNumber,
                reasonCode,
                reason: reason.trim(),
                initiatedAt: new Date().toISOString(),
                initiatedBy: effectiveActor.id || actorId || 'SYSTEM',
                journalEntryId: null,
                amount: Number(invoice.totalAmount) || subtotal + vat,
                legalBasis: 'ม.86/10 + ม.86/4 ป.รัษฎากร',
            };

            // 4. Mark Invoice with refundStatus via metadata.refund JSON
            const updatedInvoice = await tx.invoice.update({
                where: { id: invoice.id },
                data: {
                    metadata: _mergeRefundBlock(invoice.metadata, refundBlock),
                },
                select: { id: true, invoiceNumber: true, metadata: true },
            });

            return { cn: cnPosted, refundBlock, updatedInvoice };
        });
    } catch (err) {
        // credit-note-service throws NOT_PLATFORM_INVOICE for STATE invoices;
        // surface it untouched so callers can route through Treasury.
        if (err?.code === 'NOT_PLATFORM_INVOICE') {throw err;}
        if (err?.code === 'INVOICE_NOT_PAID') {throw err;}
        if (err?.code === 'FORBIDDEN_ROLE' || err?.code === 'FORBIDDEN_TENANT') {throw err;}
        if (err?.code === 'EXCEEDS_INVOICE_SUBTOTAL' || err?.code === 'EXCEEDS_INVOICE_VAT') {throw err;}
        logger.error(`[refund] initiate failed for ${invoice.invoiceNumber}: ${err?.message}`, err);
        throw makeError('REFUND_FAILED', `Refund transaction failed: ${err?.message}`, 500);
    }

    await safeAudit('REFUND_INITIATED', AuditSeverity.WARNING, effectiveActor,
        `INVOICE:${invoice.id}`, {
            invoiceNumber: invoice.invoiceNumber,
            creditNoteNumber: txResult.cn.creditNoteNumber,
            reasonCode,
            reason: reason.trim(),
            amount: Number(invoice.totalAmount),
            legalBasis: 'ม.86/10 ป.รัษฎากร',
        });

    logger.info(
        `[refund] INITIATED invoice=${invoice.invoiceNumber} `
        + `creditNote=${txResult.cn.creditNoteNumber} `
        + `amount=${Number(invoice.totalAmount).toFixed(2)} reasonCode=${reasonCode}`,
    );

    // Notify applicant — best-effort, OUTSIDE the transaction so a transport
    // hiccup does not roll back the accounting reversal.
    let notification = null;
    if (invoice.applicant?.id) {
        try {
            notification = await notificationFanoutService.send({
                userId: invoice.applicant.id,
                type: 'REFUND_INITIATED',
                payload: {
                    applicationId: null,
                    invoiceId: invoice.id,
                    invoiceNumber: invoice.invoiceNumber,
                    creditNoteNumber: txResult.cn.creditNoteNumber,
                    amount: Number(invoice.totalAmount),
                    businessDays: 7,
                    priority: 'HIGH',
                },
                channels: ['IN_APP', 'EMAIL', 'SMS'],
            });
        } catch (err) {
            logger.warn(`[refund] notification dispatch failed (non-fatal): ${err?.message}`);
        }
    } else {
        logger.warn(`[refund] no applicant resolved for invoice ${invoice.invoiceNumber}; skipping notification`);
    }

    return {
        creditNoteId: txResult.cn.id,
        creditNoteNumber: txResult.cn.creditNoteNumber,
        journalEntryId: txResult.refundBlock.journalEntryId,
        refundStatus: REFUND_STATUS.INITIATED,
        invoiceId: invoice.id,
        notification,
        idempotent: false,
    };
}

/**
 * Read the refund history for an invoice. Returns the refund block stored
 * on Invoice.metadata.refund plus the linked credit-note row.
 *
 * @param {string} invoiceId
 * @param {object} args
 * @param {object} args.actor
 */
async function getRefundStatus(invoiceId, { actor } = {}) {
    assertReadAccess(actor);
    const prisma = resolvePrisma();
    if (!prisma) {return null;}

    const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: {
            id: true, invoiceNumber: true, organizationId: true,
            metadata: true, totalAmount: true, status: true,
        },
    });
    if (!invoice) {return null;}

    // Cross-tenant read protection
    const role = normalizeRole(actor?.canonicalRole || actor?.role);
    // Non-admin: the caller's own organization only, and a caller with none is
    // refused (fail closed — L3). field_inspector no longer reads finance data
    // at all (operator 2026-09-27), so its cross-tenant exemption is gone.
    if (role !== CANONICAL_ROLES.SYSTEM_ADMIN_DTAM
        && (!actor?.organizationId
            || (invoice.organizationId && actor.organizationId !== invoice.organizationId))) {
        throw makeError('FORBIDDEN_TENANT', 'Cross-tenant read denied', 403);
    }

    const refundBlock = _readRefundBlock(invoice);
    if (!refundBlock) {
        return {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            refundStatus: REFUND_STATUS.NONE,
            history: [],
        };
    }

    let creditNote = null;
    if (refundBlock.creditNoteId) {
        creditNote = await creditNoteService.findCreditNoteById(
            refundBlock.creditNoteId,
            { actor },
        ).catch(() => null);
    }

    return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        refundStatus: refundBlock.status,
        amount: refundBlock.amount,
        reasonCode: refundBlock.reasonCode,
        reason: refundBlock.reason,
        initiatedAt: refundBlock.initiatedAt,
        initiatedBy: refundBlock.initiatedBy,
        creditNoteId: refundBlock.creditNoteId,
        creditNoteNumber: refundBlock.creditNoteNumber,
        creditNote,
        legalBasis: refundBlock.legalBasis,
        history: refundBlock.history || [],
    };
}

/**
 * Cancel a previously-initiated refund. Requires ADMIN role (separation of
 * duties — same actor that initiated should not be able to silently cancel
 * without ADMIN sign-off).
 *
 * Behaviour: marks the refund block CANCELLED and CANCELS the underlying
 * credit-note via creditNoteService.cancelCreditNote(...). If the CN is
 * already POSTED (terminal), creditNoteService throws INVALID_TRANSITION —
 * in that case the caller must issue a DEBIT NOTE (ม.86/9) to reverse the
 * reversal, since a posted CN cannot be soft-cancelled.
 *
 * @param {string} refundId — for Iter 23, refundId === invoiceId (the
 *                            refund block lives on Invoice.metadata; future
 *                            iterations can promote to a dedicated Refund
 *                            row with its own PK, at which point this
 *                            argument becomes a refund-table FK).
 * @param {object} args
 * @param {string} [args.reason] — Thai-language cancel reason.
 * @param {object} args.actor    — ADMIN required.
 */
async function cancelRefund(refundId, { actor, reason } = {}) {
    if (!refundId) {
        throw makeError('VALIDATION_ERROR', 'refundId (invoiceId) is required');
    }
    assertCancelAccess(actor);

    const prisma = resolvePrisma();
    if (!prisma) {
        throw makeError('DB_UNAVAILABLE', 'Prisma client unavailable', 503);
    }

    const invoice = await prisma.invoice.findUnique({
        where: { id: refundId },
        select: {
            id: true, invoiceNumber: true, metadata: true,
            organizationId: true,
        },
    });
    if (!invoice) {throw makeError('REFUND_NOT_FOUND', `Refund ${refundId} not found`, 404);}

    const refundBlock = _readRefundBlock(invoice);
    if (!refundBlock || refundBlock.status === REFUND_STATUS.NONE) {
        throw makeError('REFUND_NOT_FOUND', 'No refund record found for this invoice', 404);
    }
    if (refundBlock.status === REFUND_STATUS.CANCELLED) {
        return {
            invoiceId: invoice.id,
            refundStatus: REFUND_STATUS.CANCELLED,
            idempotent: true,
        };
    }
    if (refundBlock.status === REFUND_STATUS.COMPLETED) {
        throw makeError(
            'REFUND_ALREADY_COMPLETED',
            'Cannot cancel a refund whose bank transfer has already been recorded — '
            + 'issue a DEBIT NOTE (ม.86/9) to reverse instead.',
            409,
        );
    }

    // Attempt to cancel the underlying CN. If it's POSTED, credit-note
    // service throws INVALID_TRANSITION — caller must issue a DN instead.
    let cnCancelResult = null;
    if (refundBlock.creditNoteId) {
        try {
            cnCancelResult = await creditNoteService.cancelCreditNote(
                refundBlock.creditNoteId,
                { actor, reason: reason || 'Refund cancelled by ADMIN' },
            );
        } catch (err) {
            if (err?.code === 'INVALID_TRANSITION') {
                throw makeError(
                    'POSTED_CN_IRREVERSIBLE',
                    'Credit note is POSTED (immutable). Issue a DEBIT NOTE (ม.86/9) '
                    + 'to reverse the reversal — POSTED entries are never edited.',
                    409,
                );
            }
            throw err;
        }
    }

    const updatedRefundBlock = {
        ...refundBlock,
        status: REFUND_STATUS.CANCELLED,
        cancelledAt: new Date().toISOString(),
        cancelledBy: actor?.id || 'SYSTEM',
        cancelReason: reason || null,
        history: [
            ...(refundBlock.history || []),
            {
                event: 'CANCELLED',
                at: new Date().toISOString(),
                by: actor?.id || 'SYSTEM',
                reason: reason || null,
            },
        ],
    };

    await prisma.invoice.update({
        where: { id: invoice.id },
        data: { metadata: _mergeRefundBlock(invoice.metadata, updatedRefundBlock) },
    });

    await safeAudit('REFUND_CANCELLED', AuditSeverity.WARNING, actor,
        `INVOICE:${invoice.id}`, {
            invoiceNumber: invoice.invoiceNumber,
            creditNoteId: refundBlock.creditNoteId,
            cancelReason: reason || null,
        });

    return {
        invoiceId: invoice.id,
        refundStatus: REFUND_STATUS.CANCELLED,
        creditNoteCancelled: !!cnCancelResult,
        idempotent: false,
    };
}

module.exports = {
    REFUND_STATUS,
    WRITE_ROLES,
    CANCEL_ROLES,
    READ_ROLES,
    initiateRefund,
    getRefundStatus,
    cancelRefund,
    _internals: {
        _readRefundBlock,
        _mergeRefundBlock,
        _loadInvoiceForRefund,
        assertWriteAccess,
        assertCancelAccess,
    },
};
