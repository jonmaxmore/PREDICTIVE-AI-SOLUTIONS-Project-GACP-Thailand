/**
 * Credit Note Service — ใบลดหนี้ (Credit Note)
 *
 * Batch B20-A (Finance + Compliance + Backend, 2026-05-16).
 *
 * Responsibility:
 *   - Create / issue / post / cancel Credit Notes (ใบลดหนี้) against a
 *     previously issued PLATFORM full tax invoice (ใบกำกับภาษีเต็มรูป).
 *   - Allocate the canonical CN number via receipt-numbering-service
 *     (documentType='CREDIT_NOTE_PLATFORM' → format `CN-PRD-{yearAD}-{seq6}`).
 *   - Drive the document state machine:
 *
 *         DRAFT ──issue──▶ ISSUED ──post──▶ POSTED
 *           │                 │
 *           └─cancel─▶ CANCELLED ◀─cancel──┘
 *
 *     POSTED is terminal — any further correction must be issued as a new
 *     CN or DN (standard accounting practice: never edit a posted entry,
 *     always reverse).
 *
 *   - Tenancy + role gating: every operation requires the actor to belong
 *     to the same organization as the original invoice AND to hold one of
 *     the allowed roles (finance_officer_platform or system_admin_dtam). Read
 *     operations accept both finance roles + system_admin_dtam (operator
 *     2026-09-11 / 2026-09-27).
 *
 * Legal basis (ป.รัษฎากร):
 *   - ม.86/10 — ใบลดหนี้: a VAT-registered seller that has issued a tax
 *     invoice and subsequently reduces the taxable amount MUST issue a
 *     credit note to the buyer in the same VAT period where the change
 *     occurs. The CN must:
 *       1. Reference the ORIGINAL tax-invoice number;
 *       2. State the reason for the adjustment (เหตุที่ออกใบลดหนี้);
 *       3. Show the reduced amount + VAT separately;
 *       4. Be reported in ภ.พ.30 as a DEDUCTION from output VAT.
 *   - ม.86/4 — sequential numbering + 7-year retention.
 *   - ม.87/3 — retention of CN evidence for 7 years.
 *   - TFRS for NPAEs ch.18 (รายได้) — revenue is REDUCED at the period in
 *     which the CN is recognised; the original invoice + journal entry
 *     stay immutable, the CN posts a REVERSING entry instead.
 *
 * Scope: PLATFORM only. DTAM (state-fee) invoices are corrected via the
 * กรมบัญชีกลาง refund process (out of platform scope), so this service
 * REJECTS any attempt to create a CN against a STATE-issuer invoice.
 *
 * Journal-entry shape (POSTED state — REVERSING entry):
 *
 *     Dr. Revenue — Platform Fee         <subtotal>
 *     Dr. Output VAT 7%                  <vat>
 *       Cr. Cash / Customer Refund Payable        <totalAmount>
 *
 * Posted via `journalEntryService.recordCreditNoteEntry({...})` — see
 * services/journal-entry-service.js. If that function is not yet wired by
 * batch B20-B, this service falls back to a clearly-marked
 * `[credit-note][journal-fallback]` log line so finance can reconcile
 * manually. See `_postReversingJournalEntry()` below.
 *
 * @module services/credit-note-service
 */

'use strict';

const logger = require('../shared/logger');
const { normalizeRole, CANONICAL_ROLES } = require('../shared/canonical-rbac');
// What the payer block needs from the original invoice's application (never thaiCitizenId).
const { PAYER_APPLICATION_SELECT } = require('../utils/applicant-resolver');
const receiptNumbering = require('./receipt-numbering-service');
const journalEntryService = require('./journal-entry-service');
const { auditLogger, AuditCategory, AuditSeverity, ResourceType } = require('../middleware/audit-logger');

let prismaModule;
try {
    prismaModule = require('./prisma-database');
} catch (_e) {
    prismaModule = { prisma: null };
}

// ── State machine ──────────────────────────────────────────────────────────

const STATUS = Object.freeze({
    DRAFT: 'DRAFT',
    ISSUED: 'ISSUED',
    POSTED: 'POSTED',
    CANCELLED: 'CANCELLED',
});

const VALID_REASON_CODES = Object.freeze([
    'CANCELLATION',      // service cancelled by buyer
    'PRICE_REDUCTION',   // agreed price discount post-invoice
    'CORRECTION',        // over-billing / arithmetic error
    'RETURN',            // partial return of supplied service
]);

// Allowed transitions out of each state.
const ALLOWED_TRANSITIONS = Object.freeze({
    [STATUS.DRAFT]:     new Set([STATUS.ISSUED, STATUS.CANCELLED]),
    [STATUS.ISSUED]:    new Set([STATUS.POSTED, STATUS.CANCELLED]),
    [STATUS.POSTED]:    new Set(),
    [STATUS.CANCELLED]: new Set(),
});

// Roles allowed to mutate (create / issue / post / cancel).
const WRITE_ROLES = new Set([
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
]);

// Roles allowed to read.
// อ่าน — การเงินสองบทบาทเห็นเท่ากัน (operator 2026-09-11 / 2026-09-27 (A)) · ผู้ตรวจประเมินไม่อยู่ในชุดอ่านเรื่องเงิน (operator 2026-09-27)
const READ_ROLES = new Set([
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
]);

// ── Pure helpers ───────────────────────────────────────────────────────────

function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

function makeError(code, message, status = 400) {
    const e = new Error(message);
    e.code = code;
    e.statusCode = status;
    return e;
}

function resolvePrisma(tx) {
    const client = tx || (prismaModule && prismaModule.prisma);
    if (!client) {return null;}
    if (!client.creditNote || typeof client.creditNote.create !== 'function') {
        return null;
    }
    return client;
}

/**
 * Assert the actor has the write role + correct organization. Throws on
 * failure. `originalInvoice` is needed so we can compare organizationId.
 */
function assertWriteAccess(actor, originalInvoice) {
    const role = normalizeRole(actor?.canonicalRole || actor?.role);
    if (!role || !WRITE_ROLES.has(role)) {
        throw makeError(
            'FORBIDDEN_ROLE',
            'ACCOUNT_PLATFORM or ADMIN role required to mutate credit notes',
            403,
        );
    }
    // ADMIN may operate cross-tenant for incident response; ACCOUNT_PLATFORM
    // is locked to its own org. The pattern mirrors finance-reports
    // requireOrganization.
    if (role !== CANONICAL_ROLES.SYSTEM_ADMIN_DTAM
        && actor?.organizationId
        && originalInvoice?.organizationId
        && actor.organizationId !== originalInvoice.organizationId) {
        throw makeError(
            'FORBIDDEN_TENANT',
            'Cross-tenant access denied — credit notes are scoped to the invoice owner',
            403,
        );
    }
}

function assertReadAccess(actor) {
    const role = normalizeRole(actor?.canonicalRole || actor?.role);
    if (!role || !READ_ROLES.has(role)) {
        throw makeError(
            'FORBIDDEN_ROLE',
            'A finance or admin role is required to read credit notes',
            403,
        );
    }
}

/**
 * Validate that the supplied invoice is eligible for a credit note. Rules:
 *   - Must exist + not soft-deleted.
 *   - Status === 'paid' — you cannot credit-note an unpaid invoice.
 *   - Issuer === PLATFORM — STATE-fee invoices go through Treasury refund.
 *
 * The PLATFORM check is made via `journalEntryService.resolveIssuerType` on
 * `serviceType` (the same helper the journal layer uses), so the boundary
 * is identical to the one in the payment / VAT-report flows.
 */
function assertInvoiceEligible(invoice) {
    if (!invoice) {
        throw makeError('INVOICE_NOT_FOUND', 'Original invoice not found', 404);
    }
    if (invoice.isDeleted) {
        throw makeError('INVOICE_DELETED', 'Original invoice has been soft-deleted', 410);
    }
    const status = String(invoice.status || '').toLowerCase();
    if (status !== 'paid') {
        throw makeError(
            'INVOICE_NOT_PAID',
            `Credit note requires a PAID original invoice (current status: ${invoice.status})`,
            409,
        );
    }
    const issuerType = journalEntryService.resolveIssuerType(invoice.serviceType);
    if (issuerType !== journalEntryService.ISSUER.PLATFORM) {
        throw makeError(
            'NOT_PLATFORM_INVOICE',
            'Credit notes are issued only against PLATFORM tax invoices. '
            + 'STATE-fee corrections are handled via the กรมบัญชีกลาง refund process.',
            422,
        );
    }
}

/**
 * Validate the requested adjustment does not exceed the original invoice's
 * subtotal + vat. ม.86/10 ป.รัษฎากร allows reductions only up to the
 * originally invoiced taxable amount — a CN can never "go negative" past
 * the original transaction.
 *
 * Existing posted CNs are summed in so a series of partial credit notes
 * cannot drift past the original invoice in aggregate.
 */
async function assertWithinInvoiceCap({
    prisma, originalInvoice, subtotal, vat, excludeCreditNoteId,
}) {
    const reqSubtotal = round2(subtotal);
    const reqVat = round2(vat);
    if (reqSubtotal < 0 || reqVat < 0) {
        throw makeError(
            'INVALID_AMOUNT',
            'subtotal and vat must be non-negative (credit note amounts are positive numbers)',
        );
    }
    if (reqSubtotal === 0 && reqVat === 0) {
        throw makeError(
            'EMPTY_CREDIT_NOTE',
            'subtotal + vat must be greater than zero',
        );
    }

    const originalSubtotal = round2(originalInvoice.subtotal || 0);
    const originalVat = round2(originalInvoice.vat || 0);

    // Sum prior posted / issued (non-cancelled, non-draft) credit notes
    // against this invoice. Drafts are excluded so a stale draft does not
    // block a new CN; cancelled rows are excluded by definition.
    let prior = { _sum: { subtotal: 0, vat: 0 } };
    if (prisma && prisma.creditNote && typeof prisma.creditNote.aggregate === 'function') {
        const where = {
            originalInvoiceId: originalInvoice.id,
            isDeleted: false,
            status: { in: [STATUS.ISSUED, STATUS.POSTED] },
        };
        // Bug 5.2: at issue-time re-check we must EXCLUDE the CN being issued
        // so its own amount is added once (via reqSubtotal/reqVat below) and
        // not double-counted when it has already flipped to ISSUED inside the tx.
        if (excludeCreditNoteId) {
            where.id = { not: excludeCreditNoteId };
        }
        prior = await prisma.creditNote.aggregate({
            where,
            _sum: { subtotal: true, vat: true },
        });
    }
    const priorSubtotal = round2(Number(prior._sum?.subtotal) || 0);
    const priorVat = round2(Number(prior._sum?.vat) || 0);

    if (round2(priorSubtotal + reqSubtotal) > originalSubtotal + 0.005) {
        throw makeError(
            'EXCEEDS_INVOICE_SUBTOTAL',
            `Credit-note subtotal exceeds remaining invoice subtotal `
            + `(requested ${reqSubtotal}, prior ${priorSubtotal}, original ${originalSubtotal})`,
        );
    }
    if (round2(priorVat + reqVat) > originalVat + 0.005) {
        throw makeError(
            'EXCEEDS_INVOICE_VAT',
            `Credit-note VAT exceeds remaining invoice VAT `
            + `(requested ${reqVat}, prior ${priorVat}, original ${originalVat})`,
        );
    }
}

function assertReason(reason, reasonCode) {
    if (typeof reason !== 'string' || reason.trim().length < 3) {
        throw makeError(
            'INVALID_REASON',
            'reason is required (Thai-language free-text, min 3 chars)',
        );
    }
    if (!VALID_REASON_CODES.includes(reasonCode)) {
        throw makeError(
            'INVALID_REASON_CODE',
            `reasonCode must be one of: ${VALID_REASON_CODES.join(', ')}`,
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
        logger.warn(`[credit-note] audit log failed (non-fatal): ${err?.message}`);
    }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Create a Credit Note in DRAFT status.
 *
 *   {
 *     originalInvoiceId,
 *     reasonCode,    // one of VALID_REASON_CODES
 *     reason,        // Thai-language free-text (printed on the PDF)
 *     subtotal,      // positive, ≤ remaining invoice subtotal
 *     vat,           // positive, ≤ remaining invoice VAT
 *     actor,         // { id, canonicalRole, organizationId, ... }
 *     organizationId // optional override (admin path)
 *   }
 *
 * @returns {Promise<object>}  the created CreditNote row (DRAFT)
 */
async function createCreditNote({
    originalInvoiceId, reasonCode, reason, subtotal, vat,
    actor, organizationId,
} = {}) {
    if (!originalInvoiceId) {
        throw makeError('VALIDATION_ERROR', 'originalInvoiceId is required');
    }
    assertReason(reason, reasonCode);

    const prisma = resolvePrisma();
    if (!prisma) {
        throw makeError('DB_UNAVAILABLE', 'Prisma client unavailable for credit-note creation', 503);
    }

    const originalInvoice = await prisma.invoice.findUnique({
        where: { id: originalInvoiceId },
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
        },
    });
    assertInvoiceEligible(originalInvoice);
    assertWriteAccess(actor, originalInvoice);
    await assertWithinInvoiceCap({
        prisma, originalInvoice, subtotal, vat,
    });

    const subtotalDec = round2(subtotal);
    const vatDec = round2(vat);
    const totalDec = round2(subtotalDec + vatDec);

    // A DRAFT consumes no document number (operator/controller 2026-09-26:
    // number year = printed year). The number is allocated at ISSUE, from the
    // same instant the note prints as its issue date — a draft made on 31 Dec
    // and issued on 2 Jan is a 2570 document with a 2570-series number, and an
    // abandoned draft leaves no gap in the CN-PRD series. A draft shows "ร่าง".
    const created = await prisma.$transaction(async (tx) => {
        return tx.creditNote.create({
            data: {
                creditNoteNumber: null,
                originalInvoiceId,
                reason: String(reason).trim(),
                reasonCode,
                subtotal: subtotalDec,
                vat: vatDec,
                totalAmount: totalDec,
                status: STATUS.DRAFT,
                organizationId: organizationId || originalInvoice.organizationId,
            },
        });
    });

    await safeAudit('CREDIT_NOTE_CREATED', AuditSeverity.INFO, actor,
        `CREDIT_NOTE:${created.id}`, {
            creditNoteNumber: created.creditNoteNumber,
            originalInvoiceId,
            originalInvoiceNumber: originalInvoice.invoiceNumber,
            reasonCode,
            subtotal: subtotalDec,
            vat: vatDec,
            totalAmount: totalDec,
        });

    logger.info(
        `[credit-note] DRAFT created (${created.id}, no number until issue) against `
        + `${originalInvoice.invoiceNumber} — Dr<<reverse>> ${totalDec} THB `
        + `(subtotal=${subtotalDec}, vat=${vatDec}), reasonCode=${reasonCode}`,
    );
    return created;
}

/**
 * Transition DRAFT → ISSUED. Records issuedAt + issuedBy and stamps the
 * row immutable from a status-perspective (the PDF can now safely be
 * generated and delivered; the financials are frozen).
 */
async function issueCreditNote(creditNoteId, { actor } = {}) {
    if (!creditNoteId) {
        throw makeError('VALIDATION_ERROR', 'creditNoteId is required');
    }
    const prisma = resolvePrisma();
    if (!prisma) {
        throw makeError('DB_UNAVAILABLE', 'Prisma client unavailable', 503);
    }

    const cn = await prisma.creditNote.findUnique({
        where: { id: creditNoteId },
        include: {
            originalInvoice: {
                select: {
                    id: true, organizationId: true, invoiceNumber: true,
                    subtotal: true, vat: true,
                },
            },
        },
    });
    if (!cn) {throw makeError('CREDIT_NOTE_NOT_FOUND', 'Credit note not found', 404);}
    assertWriteAccess(actor, cn.originalInvoice);

    if (!ALLOWED_TRANSITIONS[cn.status]?.has(STATUS.ISSUED)) {
        throw makeError(
            'INVALID_TRANSITION',
            `Cannot issue credit note from status ${cn.status}`,
            409,
        );
    }

    // Bug 5.2 (cap-bypass TOCTOU): the create-time cap check only counted
    // prior ISSUED/POSTED. Two DRAFT CNs both pass at create, then both issue
    // → aggregate exceeds the original invoice, over-reversing output VAT.
    // Re-run the cap check INSIDE a $transaction — aggregating prior
    // ISSUED/POSTED (EXCLUDING this CN) + this CN's own subtotal/vat.
    // MF-2 (adversarial-verify): flipping THIS CN's status atomically does NOT
    // serialize two concurrent issues of DIFFERENT CNs — under READ COMMITTED the
    // non-locking aggregate lets both see prior=0 (write-skew). We must take a
    // SHARED-ROW LOCK on the ORIGINAL INVOICE so concurrent CN issues against the
    // same invoice serialize behind it (mirrors the 5.3 batch FOR UPDATE lock).
    const updated = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "invoices" WHERE id = ${cn.originalInvoice.id} FOR UPDATE`;
        await assertWithinInvoiceCap({
            prisma: tx,
            originalInvoice: cn.originalInvoice,
            subtotal: cn.subtotal,
            vat: cn.vat,
            excludeCreditNoteId: creditNoteId,
        });
        // ONE instant: the printed issue date and the number's (Bangkok) year.
        const issuedAt = new Date();
        // CLAIM the draft before any number is drawn: the conditional update
        // takes this note's row lock and only matches while it is still DRAFT.
        // A concurrent issue of the SAME draft waits on the lock, then matches
        // nothing and is refused — its transaction never reaches the allocator,
        // so it cannot burn a number (re-review 2, New 1).
        const claimed = await tx.creditNote.updateMany({
            where: { id: creditNoteId, status: STATUS.DRAFT },
            data: { status: STATUS.ISSUED, issuedAt, issuedBy: actor?.id || 'SYSTEM' },
        });
        if (claimed.count !== 1) {
            throw makeError('INVALID_TRANSITION', 'Credit note is no longer a DRAFT — it was issued or cancelled concurrently', 409);
        }
        // A draft made before numbers moved to issue (2026-09-26) already holds
        // one: keep it, so that number never becomes a gap in the series.
        // Otherwise allocate now, inside this transaction — a failure after this
        // point rolls the sequence back with the claim (no gap).
        const creditNoteNumber = cn.creditNoteNumber || (await receiptNumbering.allocateReceiptNumber({
            issuer: receiptNumbering.ISSUER.CREDIT_NOTE_PLATFORM,
            dateOrYear: issuedAt,
            prismaClient: tx,
        })).number;
        return tx.creditNote.update({
            where: { id: creditNoteId },
            data: { creditNoteNumber },
        });
    });

    await safeAudit('CREDIT_NOTE_ISSUED', AuditSeverity.INFO, actor,
        `CREDIT_NOTE:${updated.id}`, {
            creditNoteNumber: updated.creditNoteNumber,
            originalInvoiceNumber: cn.originalInvoice?.invoiceNumber,
        });
    logger.info(
        `[credit-note] ${updated.creditNoteNumber} ISSUED — PDF generation `
        + `eligible. Original invoice ${cn.originalInvoice?.invoiceNumber}.`,
    );
    return updated;
}

/**
 * Transition ISSUED → POSTED. Writes the REVERSING journal entry into the
 * GL and marks the CN immutable.
 *
 * REVERSING shape (PLATFORM only — STATE invoices are never CN-able):
 *     Dr. Revenue — Platform Fee         <subtotal>
 *     Dr. Output VAT 7%                  <vat>
 *       Cr. Cash / Customer Refund Payable    <totalAmount>
 *
 * Delegates to `journalEntryService.recordCreditNoteEntry(...)`. If that
 * method is not yet present (B20-B not yet wired by the journal owner), we
 * fall back to a structured `[credit-note][journal-fallback]` log so the
 * accounting team can reconcile manually and the next batch can wire the
 * persistence atomically. The CN status STILL transitions to POSTED in
 * either case — the document state machine should not stall on a missing
 * downstream service; the fallback marker carries enough information for
 * the next-batch wire-in to back-fill the GL entry.
 */
async function postCreditNote(creditNoteId, { actor } = {}) {
    if (!creditNoteId) {
        throw makeError('VALIDATION_ERROR', 'creditNoteId is required');
    }
    const prisma = resolvePrisma();
    if (!prisma) {
        throw makeError('DB_UNAVAILABLE', 'Prisma client unavailable', 503);
    }

    const cn = await prisma.creditNote.findUnique({
        where: { id: creditNoteId },
        include: {
            originalInvoice: {
                select: {
                    id: true, organizationId: true, invoiceNumber: true,
                    serviceType: true, subtotal: true, vat: true, totalAmount: true,
                },
            },
        },
    });
    if (!cn) {throw makeError('CREDIT_NOTE_NOT_FOUND', 'Credit note not found', 404);}
    assertWriteAccess(actor, cn.originalInvoice);

    if (!ALLOWED_TRANSITIONS[cn.status]?.has(STATUS.POSTED)) {
        throw makeError(
            'INVALID_TRANSITION',
            `Cannot post credit note from status ${cn.status}`,
            409,
        );
    }

    const subtotal = round2(Number(cn.subtotal));
    const vatAmount = round2(Number(cn.vat));
    const total = round2(Number(cn.totalAmount));

    // Run the status flip + GL write atomically.
    const journalResult = await prisma.$transaction(async (tx) => {
        const updated = await tx.creditNote.update({
            where: { id: creditNoteId },
            data: {
                status: STATUS.POSTED,
                postedAt: new Date(),
                postedBy: actor?.id || 'SYSTEM',
            },
        });
        const entry = await _postReversingJournalEntry({
            tx,
            creditNote: updated,
            originalInvoice: cn.originalInvoice,
            subtotal,
            vat: vatAmount,
            total,
            actor,
        });
        return { updated, entry };
    });

    await safeAudit('CREDIT_NOTE_POSTED', AuditSeverity.INFO, actor,
        `CREDIT_NOTE:${journalResult.updated.id}`, {
            creditNoteNumber: journalResult.updated.creditNoteNumber,
            originalInvoiceNumber: cn.originalInvoice?.invoiceNumber,
            journalEntryId: journalResult.entry?.journalEntryId || null,
            journalPersisted: !!journalResult.entry?.persisted,
            subtotal, vat: vatAmount, total,
        });
    logger.info(
        `[credit-note] ${journalResult.updated.creditNoteNumber} POSTED — `
        + `reversing entry Dr Revenue ${subtotal} / Dr VAT ${vatAmount} / `
        + `Cr Cash ${total} against invoice ${cn.originalInvoice?.invoiceNumber}.`,
    );
    return journalResult.updated;
}

/**
 * Soft-cancel a credit note. Allowed only from DRAFT or ISSUED — POSTED is
 * terminal (corrections require another CN/DN). Sets status=CANCELLED but
 * preserves the row so the audit trail is intact (ม.87/3 retention).
 */
async function cancelCreditNote(creditNoteId, { actor, reason } = {}) {
    if (!creditNoteId) {
        throw makeError('VALIDATION_ERROR', 'creditNoteId is required');
    }
    const prisma = resolvePrisma();
    if (!prisma) {
        throw makeError('DB_UNAVAILABLE', 'Prisma client unavailable', 503);
    }

    const cn = await prisma.creditNote.findUnique({
        where: { id: creditNoteId },
        include: { originalInvoice: { select: { id: true, organizationId: true } } },
    });
    if (!cn) {throw makeError('CREDIT_NOTE_NOT_FOUND', 'Credit note not found', 404);}
    assertWriteAccess(actor, cn.originalInvoice);

    if (!ALLOWED_TRANSITIONS[cn.status]?.has(STATUS.CANCELLED)) {
        throw makeError(
            'INVALID_TRANSITION',
            `Cannot cancel credit note from status ${cn.status} `
            + '(POSTED is terminal — issue a new CN/DN to correct).',
            409,
        );
    }

    // Conditional write (fix round 4): cancel only the note in the status the
    // caller read — DRAFT or ISSUED, per ALLOWED_TRANSITIONS. The old
    // unconditional update let a cancel that read ISSUED overwrite a note a
    // concurrent post had just made POSTED (terminal: a posted note is
    // corrected by a new CN/DN, never cancelled), and let a cancel that read a
    // DRAFT void a note a concurrent issue had just numbered. The row lock
    // makes Postgres re-check the WHERE after the other writer commits; a
    // changed status matches nothing and is refused, so the caller re-reads.
    const cancelled = await prisma.creditNote.updateMany({
        where: { id: creditNoteId, status: cn.status },
        data: { status: STATUS.CANCELLED },
    });
    if (cancelled.count !== 1) {
        throw makeError(
            'INVALID_TRANSITION',
            `Credit note changed from ${cn.status} while it was being cancelled — re-read it before cancelling`,
            409,
        );
    }
    const updated = await prisma.creditNote.findUnique({ where: { id: creditNoteId } });

    await safeAudit('CREDIT_NOTE_CANCELLED', AuditSeverity.WARNING, actor,
        `CREDIT_NOTE:${updated.id}`, {
            creditNoteNumber: updated.creditNoteNumber,
            cancelReason: reason || null,
        });
    return updated;
}

// The original invoice as the JSON detail route returns it. No applicant
// data: formData carries the wizard's personal fields (national ID included).
const ORIGINAL_INVOICE_SELECT = Object.freeze({
    id: true, invoiceNumber: true, serviceType: true,
    subtotal: true, vat: true, totalAmount: true,
    paidAt: true, organizationId: true, billingName: true,
    billingAddress: true, certificateNumber: true,
});

async function _findCreditNoteWith(creditNoteId, actor, originalInvoiceSelect) {
    assertReadAccess(actor);
    const prisma = resolvePrisma();
    if (!prisma) {return null;}
    const cn = await prisma.creditNote.findUnique({
        where: { id: creditNoteId },
        include: {
            originalInvoice: { select: originalInvoiceSelect },
        },
    });
    if (!cn) {return null;}
    // Cross-tenant read protection (mirrors write path).
    const role = normalizeRole(actor?.canonicalRole || actor?.role);
    // Non-admin: the caller's own organization only, and a caller with none is
    // refused (fail closed — L3). field_inspector no longer reads finance data
    // at all (operator 2026-09-27), so its cross-tenant exemption is gone.
    if (role !== CANONICAL_ROLES.SYSTEM_ADMIN_DTAM
        && (!actor?.organizationId
            || (cn.organizationId && actor.organizationId !== cn.organizationId))) {
        throw makeError('FORBIDDEN_TENANT', 'Cross-tenant read denied', 403);
    }
    return cn;
}

async function findCreditNoteById(creditNoteId, { actor } = {}) {
    return _findCreditNoteWith(creditNoteId, actor, ORIGINAL_INVOICE_SELECT);
}

/**
 * INTERNAL ONLY — the credit note with its original invoice's applying entity, for
 * rendering the PDF. Never return this object from a route: the application's
 * formData carries the wizard's personal fields.
 *
 * The payer printed on a credit note is the ORIGINAL invoice's entity, resolved by
 * utils/applicant-resolver.js like every other finance document (operator rule
 * 2026-09-27, the audit ledger L-083) — not the `billingName` snapshot, which no
 * writer in this repo populates. `thaiCitizenId` is never selected
 * (PAYER_ENTITY_SELECT).
 */
async function findCreditNoteForDocument(creditNoteId, { actor } = {}) {
    return _findCreditNoteWith(creditNoteId, actor, {
        ...ORIGINAL_INVOICE_SELECT,
        application: { select: PAYER_APPLICATION_SELECT },
    });
}

async function listCreditNotesForInvoice(originalInvoiceId, { actor, holderScope = null } = {}) {
    const prisma = resolvePrisma();
    if (!prisma) {return [];}
    const role = normalizeRole(actor?.canonicalRole || actor?.role);
    const hasReadRole = Boolean(role && READ_ROLES.has(role));
    if (!hasReadRole) {
        // Owner fallback: a HEALTH applicant may read credit notes for an invoice
        // they OWN (powers the applicant refund-visibility panel). Verify ownership
        // against Invoice.healthId so one applicant can never read another's notes.
        // Post-detokenize (APP_FK_USE_TOKEN): Invoice.healthId stores the
        // keyed-HMAC TOKEN == actor.canonicalId, NOT the plaintext id — the old
        // plaintext-only compare 403'd every real owner (walkthrough 2026-07-10:
        // 2x console 403 on /health/payments). Compare the token first; keep the
        // plaintext term for legacy pre-token rows.
        const invoice = await prisma.invoice.findUnique({
            where: {
                id: String(originalInvoiceId),
                // R1-legacy-pin: removed in Task 12 — a health caller passes its holder
                // scope; the invoice id decides the row and the healthId compare below
                // decides ownership, as pre-R1.
                ...require('./holder-access').r1HolderOrLegacyWhenScoped(holderScope, 'Invoice', { id: String(originalInvoiceId) }),
            },
            select: { healthId: true },
        });
        const ownerKeys = [actor?.canonicalId, actor?.healthId].filter(Boolean);
        if (!invoice || ownerKeys.length === 0 || !ownerKeys.includes(invoice.healthId)) {
            throw makeError(
                'FORBIDDEN_ROLE',
                'A finance or admin role (or the invoice owner) is required to read credit notes',
                403,
            );
        }
    }
    if (hasReadRole) { await assertInvoiceInCallerOrg(prisma, originalInvoiceId, actor); }
    return prisma.creditNote.findMany({
        where: { originalInvoiceId, isDeleted: false },
        orderBy: { createdAt: 'desc' },
    });
}

async function assertInvoiceInCallerOrg(prisma, originalInvoiceId, actor) {
    // Finance readers see notes of their own organization's invoices only
    // (S5 — security review 2026-09-27); system_admin_dtam may cross tenants.
    const role = normalizeRole(actor?.canonicalRole || actor?.role);
    if (role === CANONICAL_ROLES.SYSTEM_ADMIN_DTAM) { return; }
    const invoice = await prisma.invoice.findUnique({
        where: { id: String(originalInvoiceId) },
        select: { organizationId: true },
    });
    if (!actor?.organizationId || !invoice || (invoice.organizationId && invoice.organizationId !== actor.organizationId)) {
        throw makeError('FORBIDDEN_TENANT', 'Cross-tenant read denied', 403);
    }
}

async function listCreditNotes({ status, organizationId, from, to, actor } = {}) {
    assertReadAccess(actor);
    const prisma = resolvePrisma();
    if (!prisma) {return [];}
    const where = { isDeleted: false };
    if (status) {where.status = status;}
    // Tenant scoping: a non-ADMIN caller is PINNED to its own org — a
    // caller-supplied organizationId (?organizationId=) must not let a finance
    // user read another tenant's notes. ADMIN may cross-tenant (incident response).
    const role = normalizeRole(actor?.canonicalRole || actor?.role);
    if (role === CANONICAL_ROLES.SYSTEM_ADMIN_DTAM) {
        if (organizationId) {where.organizationId = organizationId;}
    } else {
        if (!actor?.organizationId) {
            throw makeError('FORBIDDEN_TENANT', 'Organization context required', 403);
        }
        where.organizationId = actor.organizationId;
    }
    if (from || to) {
        where.createdAt = {};
        if (from) {where.createdAt.gte = new Date(from);}
        if (to) {where.createdAt.lt = new Date(to);}
    }
    return prisma.creditNote.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
            originalInvoice: { select: { id: true, invoiceNumber: true } },
        },
    });
}

// ── Journal-entry post (internal) ──────────────────────────────────────────

/**
 * Post the REVERSING journal entry that mirrors the original PLATFORM
 * payment entry. Prefers `journalEntryService.recordCreditNoteEntry(...)`
 * when available; falls back to a structured log marker so the next batch
 * can wire the persistence atomically.
 *
 * The reversing-shape contract (PLATFORM only — STATE invoices are never
 * eligible for CN, enforced upstream in `assertInvoiceEligible`):
 *
 *     Dr. Revenue — Platform Fee   <subtotal>
 *     Dr. Output VAT 7%            <vat>
 *       Cr. Cash / Bank                  <total>
 *
 * @private
 */
async function _postReversingJournalEntry({
    tx, creditNote, originalInvoice, subtotal, vat, total, actor,
}) {
    // Preferred path — the journal-entry-service in batch B20-B (or later)
    // wires `recordCreditNoteEntry`. Call signature mirrors
    // `recordPaymentEntry`: invoiceId, total, components, meta (with `tx`
    // for atomicity).
    if (typeof journalEntryService.recordCreditNoteEntry === 'function') {
        return journalEntryService.recordCreditNoteEntry(
            originalInvoice.id,
            total,
            { subtotal, vat },
            {
                creditNoteId: creditNote.id,
                creditNoteNumber: creditNote.creditNoteNumber,
                invoiceNumber: originalInvoice.invoiceNumber,
                serviceType: originalInvoice.serviceType,
                organizationId: creditNote.organizationId,
                createdBy: actor?.id || 'SYSTEM',
                tx,
            },
        );
    }

    // Fallback — the journal-entry-service has not yet been extended with
    // recordCreditNoteEntry. We log a structured marker so the next batch
    // can back-fill the GL entry, and we DO NOT throw — the document
    // state machine should continue to advance.
    //
    // TODO(B20-B journal owner): add `recordCreditNoteEntry({ invoiceId,
    //   total, components, meta })` to services/journal-entry-service.js
    //   that posts the REVERSING entry below. Shape:
    //     Dr Revenue — Platform Fee (4110-001)   <subtotal>
    //     Dr Output VAT 7%          (2131-001)   <vat>
    //       Cr Cash / Bank          (1110-001)         <total>
    //   metadata.kind = 'CREDIT_NOTE_REVERSAL'; reference = creditNoteNumber.
    logger.warn(
        '[credit-note][journal-fallback] recordCreditNoteEntry not yet '
        + `wired in journal-entry-service — manual GL reconciliation required `
        + `for ${creditNote.creditNoteNumber}. `
        + `Reversing entry: Dr Revenue ${subtotal} / Dr VAT ${vat} / `
        + `Cr Cash ${total} against invoice ${originalInvoice.invoiceNumber}.`,
        {
            creditNoteId: creditNote.id,
            creditNoteNumber: creditNote.creditNoteNumber,
            originalInvoiceId: originalInvoice.id,
            originalInvoiceNumber: originalInvoice.invoiceNumber,
            kind: 'CREDIT_NOTE_REVERSAL',
            lines: [
                { accountCode: '4110-001', accountName: 'รายได้ค่าบริการแพลตฟอร์ม', debit: subtotal, credit: 0 },
                { accountCode: '2131-001', accountName: 'ภาษีขายตั้งพัก (Output VAT 7%)', debit: vat, credit: 0 },
                { accountCode: '1110-001', accountName: 'เงินสด/เงินฝากธนาคาร · บัญชีหลัก', debit: 0, credit: total },
            ],
        },
    );
    return { persisted: false, fallback: true, fallbackReason: 'RECORD_CREDIT_NOTE_ENTRY_NOT_WIRED' };
}

module.exports = {
    STATUS,
    VALID_REASON_CODES,
    ALLOWED_TRANSITIONS,
    WRITE_ROLES,
    READ_ROLES,
    createCreditNote,
    issueCreditNote,
    postCreditNote,
    cancelCreditNote,
    findCreditNoteById,
    findCreditNoteForDocument,
    listCreditNotesForInvoice,
    listCreditNotes,
    // Exposed for tests
    _internals: {
        round2,
        assertInvoiceEligible,
        assertWithinInvoiceCap,
        assertReason,
        _postReversingJournalEntry,
    },
};
