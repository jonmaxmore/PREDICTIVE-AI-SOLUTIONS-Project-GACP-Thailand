/**
 * Debit Note Service — ใบเพิ่มหนี้ (Debit Note)
 *
 * Batch B20-A (Finance + Compliance + Backend, 2026-05-16).
 *
 * Mirror of credit-note-service.js for UPWARD amendments to a previously
 * issued PLATFORM full tax invoice (ใบกำกับภาษีเต็มรูป). Same state
 * machine, same atomicity contract, same audit-logging discipline — only
 * the journal-entry shape and the legal anchor differ:
 *
 *   DRAFT ──issue──▶ ISSUED ──post──▶ POSTED
 *     │                 │
 *     └─cancel─▶ CANCELLED ◀─cancel──┘
 *
 * Legal basis:
 *   - ป.รัษฎากร ม.86/9 — ใบเพิ่มหนี้: a VAT-registered seller that has
 *     issued a tax invoice and subsequently INCREASES the taxable amount
 *     MUST issue a debit note to the buyer in the same VAT period where
 *     the change occurs. The DN must:
 *       1. Reference the ORIGINAL tax-invoice number;
 *       2. State the reason for the additional charge;
 *       3. Show the additional amount + VAT separately;
 *       4. Be reported in ภ.พ.30 as an ADDITION to output VAT.
 *   - ม.86/4 — sequential numbering + 7-year retention.
 *   - ม.87/3 — retention of DN evidence for 7 years.
 *   - TFRS for NPAEs ch.18 (รายได้) — additional revenue is recognised at
 *     the period in which the DN is recognised, not the original invoice
 *     period.
 *
 * Scope: PLATFORM only. STATE-fee invoices flow through the กรมบัญชีกลาง
 * collection process — there is no platform-side concept of issuing an
 * upward correction against a state-fee receipt.
 *
 * Journal-entry shape (POSTED state — ADDITIONAL revenue entry):
 *
 *     Dr. Cash / Accounts Receivable     <totalAmount>
 *       Cr. Revenue — Platform Fee            <subtotal>
 *       Cr. Output VAT 7%                     <vat>
 *
 * Posted via `journalEntryService.recordDebitNoteEntry({...})` — see
 * `_postAdditionalJournalEntry()` for the fallback contract.
 *
 * @module services/debit-note-service
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

const STATUS = Object.freeze({
    DRAFT: 'DRAFT',
    ISSUED: 'ISSUED',
    POSTED: 'POSTED',
    CANCELLED: 'CANCELLED',
});

const VALID_REASON_CODES = Object.freeze([
    'ADDITIONAL_CHARGE', // extra scope of work billed after the fact
    'CORRECTION',        // under-billing / arithmetic error
    'LATE_FEE',          // penalty per the service agreement
]);

const ALLOWED_TRANSITIONS = Object.freeze({
    [STATUS.DRAFT]:     new Set([STATUS.ISSUED, STATUS.CANCELLED]),
    [STATUS.ISSUED]:    new Set([STATUS.POSTED, STATUS.CANCELLED]),
    [STATUS.POSTED]:    new Set(),
    [STATUS.CANCELLED]: new Set(),
});

const WRITE_ROLES = new Set([
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
]);

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
    if (!client.debitNote || typeof client.debitNote.create !== 'function') {
        return null;
    }
    return client;
}

function assertWriteAccess(actor, originalInvoice) {
    const role = normalizeRole(actor?.canonicalRole || actor?.role);
    if (!role || !WRITE_ROLES.has(role)) {
        throw makeError(
            'FORBIDDEN_ROLE',
            'ACCOUNT_PLATFORM or ADMIN role required to mutate debit notes',
            403,
        );
    }
    if (role !== CANONICAL_ROLES.SYSTEM_ADMIN_DTAM
        && actor?.organizationId
        && originalInvoice?.organizationId
        && actor.organizationId !== originalInvoice.organizationId) {
        throw makeError(
            'FORBIDDEN_TENANT',
            'Cross-tenant access denied — debit notes are scoped to the invoice owner',
            403,
        );
    }
}

function assertReadAccess(actor) {
    const role = normalizeRole(actor?.canonicalRole || actor?.role);
    if (!role || !READ_ROLES.has(role)) {
        throw makeError(
            'FORBIDDEN_ROLE',
            'A finance or admin role is required to read debit notes',
            403,
        );
    }
}

/**
 * Same eligibility check as credit-note-service. STATE invoices are not
 * adjustable via DN on the platform's books — they flow through the
 * กรมบัญชีกลาง collection process (additional state-fee charges create a
 * new STATE invoice, not a DN against the prior one).
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
            `Debit note requires a PAID original invoice (current status: ${invoice.status})`,
            409,
        );
    }
    const issuerType = journalEntryService.resolveIssuerType(invoice.serviceType);
    if (issuerType !== journalEntryService.ISSUER.PLATFORM) {
        throw makeError(
            'NOT_PLATFORM_INVOICE',
            'Debit notes are issued only against PLATFORM tax invoices. '
            + 'Additional state-fee charges go through DTAM, not via DN on the platform books.',
            422,
        );
    }
}

/**
 * Unlike credit notes, debit notes do not have a hard cap from the
 * original invoice — they ADD to the taxable amount. We still enforce
 * positive amounts and non-zero totals so a degenerate DN can't be
 * created.
 *
 * (We deliberately do not cap by a multiple of the original — that's a
 * business-policy decision, not a tax-law one. ม.86/9 does not bound the
 * DN amount; it only bounds the timing + reference + reason.)
 */
function assertAmounts({ subtotal, vat }) {
    const reqSubtotal = round2(subtotal);
    const reqVat = round2(vat);
    if (reqSubtotal < 0 || reqVat < 0) {
        throw makeError(
            'INVALID_AMOUNT',
            'subtotal and vat must be non-negative (debit note amounts are positive numbers)',
        );
    }
    if (reqSubtotal === 0 && reqVat === 0) {
        throw makeError(
            'EMPTY_DEBIT_NOTE',
            'subtotal + vat must be greater than zero',
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
        logger.warn(`[debit-note] audit log failed (non-fatal): ${err?.message}`);
    }
}

// ── Public API ─────────────────────────────────────────────────────────────

async function createDebitNote({
    originalInvoiceId, reasonCode, reason, subtotal, vat,
    actor, organizationId,
} = {}) {
    if (!originalInvoiceId) {
        throw makeError('VALIDATION_ERROR', 'originalInvoiceId is required');
    }
    assertReason(reason, reasonCode);
    assertAmounts({ subtotal, vat });

    const prisma = resolvePrisma();
    if (!prisma) {
        throw makeError('DB_UNAVAILABLE', 'Prisma client unavailable for debit-note creation', 503);
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

    const subtotalDec = round2(subtotal);
    const vatDec = round2(vat);
    const totalDec = round2(subtotalDec + vatDec);

    // A DRAFT consumes no document number (operator/controller 2026-09-26:
    // number year = printed year). The number is allocated at ISSUE from the
    // instant the note prints as its issue date; an abandoned draft leaves no
    // gap in the DN-PRD series. A draft shows "ร่าง".
    const created = await prisma.$transaction(async (tx) => {
        return tx.debitNote.create({
            data: {
                debitNoteNumber: null,
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

    await safeAudit('DEBIT_NOTE_CREATED', AuditSeverity.INFO, actor,
        `DEBIT_NOTE:${created.id}`, {
            debitNoteNumber: created.debitNoteNumber,
            originalInvoiceId,
            originalInvoiceNumber: originalInvoice.invoiceNumber,
            reasonCode,
            subtotal: subtotalDec,
            vat: vatDec,
            totalAmount: totalDec,
        });

    logger.info(
        `[debit-note] DRAFT created (${created.id}, no number until issue) against `
        + `${originalInvoice.invoiceNumber} — Dr Cash ${totalDec} THB `
        + `(subtotal=${subtotalDec}, vat=${vatDec}), reasonCode=${reasonCode}`,
    );
    return created;
}

async function issueDebitNote(debitNoteId, { actor } = {}) {
    if (!debitNoteId) {
        throw makeError('VALIDATION_ERROR', 'debitNoteId is required');
    }
    const prisma = resolvePrisma();
    if (!prisma) {
        throw makeError('DB_UNAVAILABLE', 'Prisma client unavailable', 503);
    }
    const dn = await prisma.debitNote.findUnique({
        where: { id: debitNoteId },
        include: { originalInvoice: { select: { id: true, organizationId: true, invoiceNumber: true } } },
    });
    if (!dn) {throw makeError('DEBIT_NOTE_NOT_FOUND', 'Debit note not found', 404);}
    assertWriteAccess(actor, dn.originalInvoice);
    if (!ALLOWED_TRANSITIONS[dn.status]?.has(STATUS.ISSUED)) {
        throw makeError(
            'INVALID_TRANSITION',
            `Cannot issue debit note from status ${dn.status}`,
            409,
        );
    }
    // ONE instant: the printed issue date and the number's (Bangkok) year. The
    // number and the status flip commit together; a failed issue rolls the
    // sequence back (no gap).
    const updated = await prisma.$transaction(async (tx) => {
        const issuedAt = new Date();
        // CLAIM the draft before any number is drawn: the conditional update
        // takes this note's row lock and matches only while it is still DRAFT.
        // A concurrent issue of the SAME draft waits, matches nothing and is
        // refused before the allocator (re-review 2, New 1).
        const claimed = await tx.debitNote.updateMany({
            where: { id: debitNoteId, status: STATUS.DRAFT },
            data: { status: STATUS.ISSUED, issuedAt, issuedBy: actor?.id || 'SYSTEM' },
        });
        if (claimed.count !== 1) {
            throw makeError('INVALID_TRANSITION', 'Debit note is no longer a DRAFT — it was issued or cancelled concurrently', 409);
        }
        // A pre-2026-09-26 draft already holds a number: keep it (no gap).
        const debitNoteNumber = dn.debitNoteNumber || (await receiptNumbering.allocateReceiptNumber({
            issuer: receiptNumbering.ISSUER.DEBIT_NOTE_PLATFORM,
            dateOrYear: issuedAt,
            prismaClient: tx,
        })).number;
        return tx.debitNote.update({
            where: { id: debitNoteId },
            data: { debitNoteNumber },
        });
    });
    await safeAudit('DEBIT_NOTE_ISSUED', AuditSeverity.INFO, actor,
        `DEBIT_NOTE:${updated.id}`, {
            debitNoteNumber: updated.debitNoteNumber,
            originalInvoiceNumber: dn.originalInvoice?.invoiceNumber,
        });
    logger.info(
        `[debit-note] ${updated.debitNoteNumber} ISSUED — PDF generation `
        + `eligible. Original invoice ${dn.originalInvoice?.invoiceNumber}.`,
    );
    return updated;
}

/**
 * Transition ISSUED → POSTED. Writes the ADDITIONAL journal entry into
 * the GL and marks the DN immutable.
 *
 * ADDITIONAL shape (PLATFORM only):
 *     Dr. Cash / Accounts Receivable     <total>
 *       Cr. Revenue — Platform Fee            <subtotal>
 *       Cr. Output VAT 7%                     <vat>
 */
async function postDebitNote(debitNoteId, { actor } = {}) {
    if (!debitNoteId) {
        throw makeError('VALIDATION_ERROR', 'debitNoteId is required');
    }
    const prisma = resolvePrisma();
    if (!prisma) {
        throw makeError('DB_UNAVAILABLE', 'Prisma client unavailable', 503);
    }

    const dn = await prisma.debitNote.findUnique({
        where: { id: debitNoteId },
        include: {
            originalInvoice: {
                select: {
                    id: true, organizationId: true, invoiceNumber: true,
                    serviceType: true, subtotal: true, vat: true, totalAmount: true,
                },
            },
        },
    });
    if (!dn) {throw makeError('DEBIT_NOTE_NOT_FOUND', 'Debit note not found', 404);}
    assertWriteAccess(actor, dn.originalInvoice);

    if (!ALLOWED_TRANSITIONS[dn.status]?.has(STATUS.POSTED)) {
        throw makeError(
            'INVALID_TRANSITION',
            `Cannot post debit note from status ${dn.status}`,
            409,
        );
    }

    const subtotal = round2(Number(dn.subtotal));
    const vatAmount = round2(Number(dn.vat));
    const total = round2(Number(dn.totalAmount));

    const journalResult = await prisma.$transaction(async (tx) => {
        const updated = await tx.debitNote.update({
            where: { id: debitNoteId },
            data: {
                status: STATUS.POSTED,
                postedAt: new Date(),
                postedBy: actor?.id || 'SYSTEM',
            },
        });
        const entry = await _postAdditionalJournalEntry({
            tx,
            debitNote: updated,
            originalInvoice: dn.originalInvoice,
            subtotal,
            vat: vatAmount,
            total,
            actor,
        });
        return { updated, entry };
    });

    await safeAudit('DEBIT_NOTE_POSTED', AuditSeverity.INFO, actor,
        `DEBIT_NOTE:${journalResult.updated.id}`, {
            debitNoteNumber: journalResult.updated.debitNoteNumber,
            originalInvoiceNumber: dn.originalInvoice?.invoiceNumber,
            journalEntryId: journalResult.entry?.journalEntryId || null,
            journalPersisted: !!journalResult.entry?.persisted,
            subtotal, vat: vatAmount, total,
        });
    logger.info(
        `[debit-note] ${journalResult.updated.debitNoteNumber} POSTED — `
        + `additional entry Dr Cash ${total} / Cr Revenue ${subtotal} / `
        + `Cr VAT ${vatAmount} against invoice ${dn.originalInvoice?.invoiceNumber}.`,
    );
    return journalResult.updated;
}

async function cancelDebitNote(debitNoteId, { actor, reason } = {}) {
    if (!debitNoteId) {
        throw makeError('VALIDATION_ERROR', 'debitNoteId is required');
    }
    const prisma = resolvePrisma();
    if (!prisma) {
        throw makeError('DB_UNAVAILABLE', 'Prisma client unavailable', 503);
    }
    const dn = await prisma.debitNote.findUnique({
        where: { id: debitNoteId },
        include: { originalInvoice: { select: { id: true, organizationId: true } } },
    });
    if (!dn) {throw makeError('DEBIT_NOTE_NOT_FOUND', 'Debit note not found', 404);}
    assertWriteAccess(actor, dn.originalInvoice);
    if (!ALLOWED_TRANSITIONS[dn.status]?.has(STATUS.CANCELLED)) {
        throw makeError(
            'INVALID_TRANSITION',
            `Cannot cancel debit note from status ${dn.status} `
            + '(POSTED is terminal — issue a new CN/DN to correct).',
            409,
        );
    }
    // Conditional write (fix round 4): cancel only the note in the status the
    // caller read (DRAFT or ISSUED). A concurrent post (POSTED is terminal) or
    // issue changes the status; the re-checked WHERE then matches nothing and
    // the cancel is refused instead of overwriting it.
    const cancelled = await prisma.debitNote.updateMany({
        where: { id: debitNoteId, status: dn.status },
        data: { status: STATUS.CANCELLED },
    });
    if (cancelled.count !== 1) {
        throw makeError(
            'INVALID_TRANSITION',
            `Debit note changed from ${dn.status} while it was being cancelled — re-read it before cancelling`,
            409,
        );
    }
    const updated = await prisma.debitNote.findUnique({ where: { id: debitNoteId } });
    await safeAudit('DEBIT_NOTE_CANCELLED', AuditSeverity.WARNING, actor,
        `DEBIT_NOTE:${updated.id}`, {
            debitNoteNumber: updated.debitNoteNumber,
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

async function _findDebitNoteWith(debitNoteId, actor, originalInvoiceSelect) {
    assertReadAccess(actor);
    const prisma = resolvePrisma();
    if (!prisma) {return null;}
    const dn = await prisma.debitNote.findUnique({
        where: { id: debitNoteId },
        include: {
            originalInvoice: { select: originalInvoiceSelect },
        },
    });
    if (!dn) {return null;}
    const role = normalizeRole(actor?.canonicalRole || actor?.role);
    // Non-admin: the caller's own organization only, and a caller with none is
    // refused (fail closed — L3). field_inspector no longer reads finance data
    // at all (operator 2026-09-27), so its cross-tenant exemption is gone.
    if (role !== CANONICAL_ROLES.SYSTEM_ADMIN_DTAM
        && (!actor?.organizationId
            || (dn.organizationId && actor.organizationId !== dn.organizationId))) {
        throw makeError('FORBIDDEN_TENANT', 'Cross-tenant read denied', 403);
    }
    return dn;
}

async function findDebitNoteById(debitNoteId, { actor } = {}) {
    return _findDebitNoteWith(debitNoteId, actor, ORIGINAL_INVOICE_SELECT);
}

/**
 * INTERNAL ONLY — the debit note with its original invoice's applying entity, for
 * rendering the PDF. Never return this object from a route: the application's
 * formData carries the wizard's personal fields.
 *
 * The payer printed on a debit note is the ORIGINAL invoice's entity, resolved by
 * utils/applicant-resolver.js like every other finance document (operator rule
 * 2026-09-27, the audit ledger L-083) — not the `billingName` snapshot, which no
 * writer in this repo populates. `thaiCitizenId` is never selected
 * (PAYER_ENTITY_SELECT).
 */
async function findDebitNoteForDocument(debitNoteId, { actor } = {}) {
    return _findDebitNoteWith(debitNoteId, actor, {
        ...ORIGINAL_INVOICE_SELECT,
        application: { select: PAYER_APPLICATION_SELECT },
    });
}

async function listDebitNotesForInvoice(originalInvoiceId, { actor } = {}) {
    assertReadAccess(actor);
    const prisma = resolvePrisma();
    if (!prisma) {return [];}
    await assertInvoiceInCallerOrg(prisma, originalInvoiceId, actor);
    return prisma.debitNote.findMany({
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

async function listDebitNotes({ status, organizationId, from, to, actor } = {}) {
    assertReadAccess(actor);
    const prisma = resolvePrisma();
    if (!prisma) {return [];}
    const where = { isDeleted: false };
    if (status) {where.status = status;}
    // Tenant scoping: non-ADMIN caller pinned to own org (ignore caller-supplied
    // organizationId); ADMIN may cross-tenant. Mirrors credit-note-service.
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
    return prisma.debitNote.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
            originalInvoice: { select: { id: true, invoiceNumber: true } },
        },
    });
}

// ── Journal-entry post (internal) ──────────────────────────────────────────

/**
 * Post the ADDITIONAL journal entry that mirrors the original PLATFORM
 * payment entry but BIGGER. Prefers
 * `journalEntryService.recordDebitNoteEntry(...)` when available; falls
 * back to a structured log marker so the next batch can wire the
 * persistence atomically.
 *
 * Shape (PLATFORM only):
 *     Dr. Cash / Bank              <total>
 *       Cr. Revenue — Platform Fee     <subtotal>
 *       Cr. Output VAT 7%              <vat>
 *
 * @private
 */
async function _postAdditionalJournalEntry({
    tx, debitNote, originalInvoice, subtotal, vat, total, actor,
}) {
    if (typeof journalEntryService.recordDebitNoteEntry === 'function') {
        return journalEntryService.recordDebitNoteEntry(
            originalInvoice.id,
            total,
            { subtotal, vat },
            {
                debitNoteId: debitNote.id,
                debitNoteNumber: debitNote.debitNoteNumber,
                invoiceNumber: originalInvoice.invoiceNumber,
                serviceType: originalInvoice.serviceType,
                organizationId: debitNote.organizationId,
                createdBy: actor?.id || 'SYSTEM',
                tx,
            },
        );
    }

    // TODO(B20-B journal owner): add `recordDebitNoteEntry({ invoiceId,
    //   total, components, meta })` to services/journal-entry-service.js
    //   that posts the ADDITIONAL entry below. Shape:
    //     Dr Cash / Bank            (1110-001)   <total>
    //       Cr Revenue — Platform Fee (4110-001)    <subtotal>
    //       Cr Output VAT 7%        (2131-001)    <vat>
    //   metadata.kind = 'DEBIT_NOTE_ADDITIONAL'; reference = debitNoteNumber.
    logger.warn(
        '[debit-note][journal-fallback] recordDebitNoteEntry not yet '
        + `wired in journal-entry-service — manual GL reconciliation required `
        + `for ${debitNote.debitNoteNumber}. `
        + `Additional entry: Dr Cash ${total} / Cr Revenue ${subtotal} / `
        + `Cr VAT ${vat} against invoice ${originalInvoice.invoiceNumber}.`,
        {
            debitNoteId: debitNote.id,
            debitNoteNumber: debitNote.debitNoteNumber,
            originalInvoiceId: originalInvoice.id,
            originalInvoiceNumber: originalInvoice.invoiceNumber,
            kind: 'DEBIT_NOTE_ADDITIONAL',
            lines: [
                { accountCode: '1110-001', accountName: 'เงินสด/เงินฝากธนาคาร · บัญชีหลัก', debit: total, credit: 0 },
                { accountCode: '4110-001', accountName: 'รายได้ค่าบริการแพลตฟอร์ม', debit: 0, credit: subtotal },
                { accountCode: '2131-001', accountName: 'ภาษีขายตั้งพัก (Output VAT 7%)', debit: 0, credit: vat },
            ],
        },
    );
    return { persisted: false, fallback: true, fallbackReason: 'RECORD_DEBIT_NOTE_ENTRY_NOT_WIRED' };
}

module.exports = {
    STATUS,
    VALID_REASON_CODES,
    ALLOWED_TRANSITIONS,
    WRITE_ROLES,
    READ_ROLES,
    createDebitNote,
    issueDebitNote,
    postDebitNote,
    cancelDebitNote,
    findDebitNoteById,
    findDebitNoteForDocument,
    listDebitNotesForInvoice,
    listDebitNotes,
    // Exposed for tests
    _internals: {
        round2,
        assertInvoiceEligible,
        assertAmounts,
        assertReason,
        _postAdditionalJournalEntry,
    },
};
