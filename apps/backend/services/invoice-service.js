const { prisma } = require('./prisma-database');
const invoiceTemplateService = require('./pdf/invoice-template-service');
const {
    normalizeInvoiceServiceType,
} = require('./phase-billing-service');
// R5-B / X4-FIX-A RC-2: receipt numbers MUST be allocated through the
// canonical per-issuer counter (ReceiptSequence). Using a shared
// `tx.invoice.count` counter let DTAM (government-revenue receipts) and
// PLATFORM (tax-invoice receipts) share one monotonic sequence — a
// silent contract drift from B16-D + R5-B. The fix is to call
// `receipt-numbering-service.allocateReceiptNumber({issuer})` inside the
// same serializable transaction so the per-issuer ReceiptSequence row
// gets the row-exclusive lock instead of a stale aggregate count.
const receiptNumberingService = require('./receipt-numbering-service');
const { getTenantContext } = require('./tenant-context');
const { orgReadScopeEnabled } = require('./tenant-prisma-extension');
const { BILLING_APPLICATION_SELECT } = require('./finance/billing-select');
const { PAYER_ENTITY_SELECT } = require('../utils/applicant-resolver');
const { classifyIssuerSide } = require('./finance/invoice-side');

const INVOICE_STATUS = Object.freeze({
    PENDING: 'PENDING',
    PAID: 'PAID',
    PAID_PENDING_RECEIPT: 'PAID_PENDING_RECEIPT',
    RECEIPT_ISSUED: 'RECEIPT_ISSUED',
    OVERDUE: 'OVERDUE',
    CANCELLED: 'CANCELLED',
});

const RAW_STATUS_ALIAS = Object.freeze({
    pending: INVOICE_STATUS.PENDING,
    paid: INVOICE_STATUS.PAID,
    paid_pending_receipt: INVOICE_STATUS.PAID_PENDING_RECEIPT,
    receipt_issued: INVOICE_STATUS.RECEIPT_ISSUED,
    overdue: INVOICE_STATUS.OVERDUE,
    cancelled: INVOICE_STATUS.CANCELLED,
});

function normalizeStatus(value) {
    const key = String(value || '').trim().toLowerCase();
    if (!key) {
        return null;
    }
    return RAW_STATUS_ALIAS[key] || String(value || '').trim().toUpperCase();
}

function canonicalPaidStatuses() {
    return ['paid', 'PAID', INVOICE_STATUS.PAID_PENDING_RECEIPT, INVOICE_STATUS.RECEIPT_ISSUED];
}

function statusFilterForQuery(status) {
    const normalized = normalizeStatus(status);
    if (!normalized) {
        return null;
    }

    if (normalized === INVOICE_STATUS.PENDING) {
        return { in: ['pending', 'PENDING'] };
    }
    if (normalized === INVOICE_STATUS.PAID) {
        return { in: canonicalPaidStatuses() };
    }
    if (normalized === INVOICE_STATUS.PAID_PENDING_RECEIPT) {
        return { in: [INVOICE_STATUS.PAID_PENDING_RECEIPT, 'paid', 'PAID'] };
    }
    if (normalized === INVOICE_STATUS.RECEIPT_ISSUED) {
        return { in: [INVOICE_STATUS.RECEIPT_ISSUED] };
    }
    if (normalized === INVOICE_STATUS.OVERDUE) {
        return { in: ['overdue', 'OVERDUE'] };
    }
    if (normalized === INVOICE_STATUS.CANCELLED) {
        return { in: ['cancelled', 'CANCELLED'] };
    }
    return status;
}

function toErpStatus(rawStatus, hasReceipt) {
    const normalized = normalizeStatus(rawStatus);
    if (hasReceipt) {
        return INVOICE_STATUS.RECEIPT_ISSUED;
    }
    if (normalized === INVOICE_STATUS.PAID) {
        return INVOICE_STATUS.PAID_PENDING_RECEIPT;
    }
    if (normalized === INVOICE_STATUS.PENDING) {
        return INVOICE_STATUS.PENDING;
    }
    return normalized || INVOICE_STATUS.PENDING;
}

function parseAuditMetadata(metadata) {
    if (!metadata) {
        return {};
    }
    if (typeof metadata === 'string') {
        try {
            return JSON.parse(metadata);
        } catch (_error) {
            return {};
        }
    }
    if (typeof metadata === 'object') {
        return metadata;
    }
    return {};
}

function withDerivedStatus(invoice) {
    return {
        ...invoice,
        erpStatus: toErpStatus(invoice.status, !!invoice.receiptNumber || !!invoice.receiptIssuedAt),
        canonicalServiceType: normalizeInvoiceServiceType(invoice.serviceType),
        // DTAM (legacy state fee) | PLATFORM — the same value for every viewer.
        // The web uses it to hide a hold/release button the backend's side
        // guard (invoice-helpers.assertInvoiceSideWritable) would refuse.
        issuerSide: classifyIssuerSide(invoice.serviceType),
    };
}

/**
 * The service a row bills, from the one catalogue (shared/instalment-service-names.js):
 * checkout M1 = งวดที่ 1, M2 = งวดที่ 2, and a renewal's M2 = the renewal service. null for
 * any other serviceType (subscription, retired split rows). The application's formData,
 * read only to answer this, is dropped from the row (it carries personal fields).
 */
function withServiceLine(invoice) {
    const { serviceForServiceType, isRenewalFiling } = require('../shared/instalment-service-names');
    const entry = serviceForServiceType(invoice.serviceType, { isRenewal: isRenewalFiling(invoice.application) });
    const { application, ...rest } = invoice;
    return {
        ...rest,
        ...(application ? { application: { applicationNumber: application.applicationNumber ?? null } } : {}),
        service: entry ? { key: entry.key, name: entry.name, coverage: entry.coverage } : null,
    };
}

async function syncApplicationPhaseStatus(applicationId) {
    if (!applicationId) {
        return;
    }
    try {
        const paymentService = require('./payment-service');
        if (typeof paymentService.syncPhaseStatusesFromInvoices === 'function') {
            await paymentService.syncPhaseStatusesFromInvoices(applicationId);
        }
    } catch (_error) {
        // Keep invoice operations resilient even if status sync fails.
    }
}

// Lean field set for the /api/payments listing view. The full applicant +
// line-item include we use for the provider invoice screen is too heavy here
// — and exposing it from a route would leak applicant PII to anyone who can
// reach this endpoint. Keep the columns minimal and identical for both the
// system-wide (admin/account) and per-healthId branches.
const PAYMENT_LIST_SELECT = Object.freeze({
    id: true,
    invoiceNumber: true,
    status: true,
    totalAmount: true,
    serviceType: true,
    createdAt: true,
    paidAt: true,
    applicationId: true,
});

// ── Health reads by holder (spec 2026-09-30-remove-workspace-mode §3.1, Task 5) ──
// holder-access loads farm-access and the permission engine, so it is required
// lazily (the same reason as quote-service / certificate-service).
function holderAccess() {
    return require('./holder-access');
}

const isHolderScope = (scope) => Boolean(scope) && Array.isArray(scope.readIds);

/**
 * The where of a health by-id Invoice read (the owner PDF doors): the holder
 * fragment alone, no filer pin (spec 2026-09-30-remove-workspace-mode §3.1).
 * @param {{ readIds: string[] }} scope
 */
function holderOwnedInvoiceWhere(scope) {
    return { isDeleted: false, ...holderAccess().holderReadWhere(scope, 'Invoice') };
}

class InvoiceService {

    /**
     * List invoices for the payments-list UI.
     * When `healthId` is null the caller is a system-wide finance role —
     * the upstream route is responsible for enforcing that role check before
     * calling this. The service does not re-check roles, but it also does not
     * silently widen access: a missing healthId yields the system-wide query
     * exactly, never a mix.
     */
    async listForPaymentsView({ healthId = null, limit = 50 } = {}) {
        const where = { isDeleted: false };
        if (healthId) {
            // UAT gap: scope to non-deleted applications too — otherwise a
            // soft-deleted application's still-pending invoices kept showing as
            // "pay" prompts on GET /payments (every other view hides them).
            where.application = { healthId, isDeleted: false };
        }
        return prisma.invoice.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: PAYMENT_LIST_SELECT,
        });
    }

    /**
     * List invoices for provider with filters
     */
    async listAll(filters = {}, limit = 50) {
        const where = { isDeleted: false };
        const statusFilter = statusFilterForQuery(filters.status);
        if (statusFilter) { where.status = statusFilter; }
        if (filters.startDate && filters.endDate) {
            where.createdAt = {
                gte: new Date(filters.startDate),
                lte: new Date(filters.endDate),
            };
        }

        const invoices = await prisma.invoice.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit,
            include: {
                applicant: { select: { firstName: true, lastName: true } },
                // Billing columns only (S1 / F-SCOPE-01) — see services/finance/billing-select.js.
                // The applicant display name comes from Application.entity.displayName.
                application: BILLING_APPLICATION_SELECT,
                lineItems: { orderBy: { lineNumber: 'asc' } },
            },
        });

        return invoices.map(withDerivedStatus);
    }

    /**
     * The invoices a health user may read (GET /api/invoices/my): those of the
     * applications filed under a holder entity in the caller's holder scope
     * (spec 2026-09-30-remove-workspace-mode §3.1; holderScope(req)). No filer
     * pin and no null-holder branch: co-members see the holder's invoices.
     *
     * No holder scope: fail closed, no query.
     * @param {{ scope: { readIds: string[] }, status?: string }} args
     */
    async listForHolders({ scope, status } = {}) {
        if (!isHolderScope(scope)) { return []; }
        const where = { isDeleted: false, ...holderAccess().holderReadWhere(scope, 'Invoice') };
        const statusFilter = statusFilterForQuery(status);
        if (statusFilter) { where.status = statusFilter; }

        const invoices = await prisma.invoice.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: {
                lineItems: { orderBy: { lineNumber: 'asc' } },
                // round 5 (operator 2026-10-03): which service a row bills is renewal-aware,
                // so the application's formData is read — to answer `service`, never returned.
                application: { select: { applicationNumber: true, formData: true } },
            },
        });

        return invoices.map((invoice) => withServiceLine(withDerivedStatus(invoice)));
    }

    /**
     * One invoice a health user may read, by id — the billing view (the same
     * select as getById). Null when the caller's holder scope does not reach it,
     * or it is missing or soft-deleted (the doors answer 404 for all three).
     * Used by invoice-helpers.findHealthInvoice.
     * @param {string} id
     * @param {{ scope: { readIds: string[] } }} args
     */
    async getForHolder(id, { scope } = {}) {
        if (!isHolderScope(scope)) { return null; }
        return this._findOneInvoice(id, BILLING_APPLICATION_SELECT, holderOwnedInvoiceWhere(scope));
    }

    /**
     * Get Invoice Statistics
     */
    async getSummary(startDate, endDate) {
        const where = { isDeleted: false };
        if (startDate && endDate) {
            where.createdAt = {
                gte: new Date(startDate),
                lte: new Date(endDate),
            };
        }
        // #13 — invoice.aggregate is NOT hooked by the tenant-prisma-extension
        // (only findMany/findFirst/count are), so the _sum revenue totals below
        // leaked EVERY org's revenue while the sibling counts were org-scoped
        // (smoking-gun asymmetry). Mirror the extension's read-scope on the shared
        // `where` so the aggregates match the counts. No-context/system paths and
        // flag-off keep the prior global behaviour. Same predicate as the extension
        // (orgReadScopeEnabled: anything but 'false' = on) — L7, security review 2026-09-27.
        const _tctx = getTenantContext();
        if (_tctx?.organizationId && orgReadScopeEnabled()) {
            where.organizationId = _tctx.organizationId;
        }

        const [totalPaid, totalPending, totalOverdue, pendingCount, paidCount, overdueCount, totalCount] = await Promise.all([
            prisma.invoice.aggregate({
                _sum: { totalAmount: true },
                where: {
                    ...where,
                    status: { in: canonicalPaidStatuses() },
                },
            }),
            prisma.invoice.aggregate({
                _sum: { totalAmount: true },
                where: {
                    ...where,
                    status: { in: ['pending', 'PENDING'] },
                },
            }),
            prisma.invoice.aggregate({
                _sum: { totalAmount: true },
                where: {
                    ...where,
                    status: { in: ['overdue', 'OVERDUE'] },
                },
            }),
            prisma.invoice.count({ where: { ...where, status: { in: ['pending', 'PENDING'] } } }),
            prisma.invoice.count({ where: { ...where, status: { in: canonicalPaidStatuses() } } }),
            prisma.invoice.count({ where: { ...where, status: { in: ['overdue', 'OVERDUE'] } } }),
            prisma.invoice.count({ where }),
        ]);

        return {
            totalRevenue: totalPaid._sum?.totalAmount || 0,
            pendingAmount: totalPending._sum?.totalAmount || 0,
            overdueAmount: totalOverdue._sum?.totalAmount || 0,
            monthlyRevenue: totalPaid._sum?.totalAmount || 0,
            invoiceCount: {
                total: totalCount,
                pending: pendingCount,
                paid: paidCount,
                overdue: overdueCount,
            },
        };
    }

    /**
     * Get single invoice — the billing view (safe to serialise to a caller).
     * The Application relation carries billing columns only (S1 / F-SCOPE-01);
     * PDF generation, which needs the full application, uses getForDocument().
     */
    async getById(id) {
        return this._findOneInvoice(id, BILLING_APPLICATION_SELECT);
    }

    /**
     * INTERNAL ONLY — the invoice with its full Application row, for rendering
     * the invoice / receipt PDF (the template reads formData for the product
     * detail). Never return this object from a route.
     *
     * Entity select carries `juristicId` + `communityRegNo` on top of the
     * billing-safe `{id, type, displayName}` triple — the invoice/receipt/
     * tax-invoice PDFs print the JURISTIC payer's tax id and the
     * COMMUNITY_ENTERPRISE payer's DOAE registration number
     * (utils/applicant-resolver.js resolveFromEntity) and neither reaches the caller as
     * JSON (getById/BILLING_APPLICATION_SELECT is the route-facing select and
     * does not carry these columns). Both are `enc:v1:`-encrypted at rest;
     * the PDPA prisma extension's generic decrypt-on-read walker
     * (services/prisma-pdpa-extension.js decryptResultTree) decrypts them
     * transparently on this same read because they are now present in the
     * result tree to walk — no extra wiring needed. Fixes the invoice/
     * receipt PDF always printing "Tax ID -" for a real juristic/community
     * payer (2026-09-27).
     *
     * `thaiCitizenId` is DELIBERATELY ABSENT — operator ruling 2026-09-27: an
     * INDIVIDUAL payer's national ID is never printed on any finance
     * document, in full or in part. A fix-round-1 version of this select DID
     * add it, which (via the resolver's then `id = entity.thaiCitizenId
     * || '-'`, since removed) started printing the full 13-digit national ID
     * as PAYER_ID on the invoice/receipt for an individual payer — a leak,
     * caught before merge. Do not re-add it.
     */
    async getForDocument(id, { scope } = {}) {
        // A health door passes its holder scope (Task 5): the document read goes
        // through the same scoped where as its gate. Staff doors and the PDF
        // worker pass none and keep the plain { id } read.
        const holderWhere = isHolderScope(scope) ? holderOwnedInvoiceWhere(scope) : null;
        return this._findOneInvoice(id, {
            // The discriminator column on Entity is `type`
            // (prisma/schema/entity.prisma:33), NOT `entityType` (B1).
            include: {
                // The resolver's own select — one definition for every payer read.
                entity: { select: PAYER_ENTITY_SELECT },
            },
        }, holderWhere);
    }

    async _findOneInvoice(id, applicationArgs, holderWhere = null) {
        // findFirst (NOT findUnique) so the tenant-prisma-extension injects
        // organizationId when a tenant context is bound (TENANT_READ_ORG_SCOPE).
        // findUnique is NOT hooked by the extension, which let any INVOICE_VIEW_ALL
        // holder read another org's invoice by id (cross-org IDOR). System/no-context
        // paths are unaffected (no org injected → resolves by id as before).
        const invoice = await prisma.invoice.findFirst({
            where: holderWhere ? { id, ...holderWhere } : { id },
            include: {
                // NARROW SELECTS, not `true`. `include: <relation>: true` returns
                // EVERY column — which once put the applicant's bcrypt password
                // hash, TOTP secret and password-reset token, and the Entity's
                // plaintext national and juristic IDs, into an invoice-detail
                // response readable by any holder of INVOICE_VIEW_ALL.
                application: applicationArgs,
                applicant: {
                    select: {
                        id: true, firstName: true, lastName: true, email: true, phoneNumber: true,
                    },
                },
                lineItems: { orderBy: { lineNumber: 'asc' } },
            },
        });
        return invoice ? withDerivedStatus(invoice) : null;
    }

    /**
     * Find invoice by Application ID
     */
    async findByApplicationId(applicationId) {
        const invoice = await prisma.invoice.findFirst({
            where: {
                applicationId,
                isDeleted: false,
            },
            orderBy: { createdAt: 'desc' },
        });
        return invoice ? withDerivedStatus(invoice) : null;
    }

    /**
     * Generate PDF Buffer
     */
    async generatePdf(id, { scope } = {}) {
        const invoice = await this.getForDocument(id, { scope });
        if (!invoice) { throw new Error('Invoice not found'); }

        // Try queue-based generation first, fallback to direct PDFKit
        try {
            const { getPdfQueue } = require('./queue-service');
            const pdfQueue = getPdfQueue();
            if (pdfQueue) {
                const logger = require('../shared/logger');
                logger.info(`[Invoice] Offloading PDF generation to worker for ID: ${id}`);
                const job = await pdfQueue.add({ type: 'INVOICE', payload: { invoiceId: id } });
                const resultBase64 = await job.finished();
                return Buffer.from(resultBase64, 'base64');
            }
        } catch (queueError) {
            const logger = require('../shared/logger');
            logger.warn(`[Invoice] Queue PDF failed, falling back to direct PDFKit: ${queueError.message}`);
        }

        return invoiceTemplateService.generateInvoicePdf(invoice, { upload: false });
    }

    /**
     * Mark as Paid (Manual)
     */
    async markAsPaid(id, transactionId) {
        const updated = await prisma.invoice.update({
            where: { id },
            data: {
                status: INVOICE_STATUS.PAID_PENDING_RECEIPT,
                paidAt: new Date(),
                paymentTransactionId: transactionId || null,
            },
        });
        await syncApplicationPhaseStatus(updated.applicationId);
        return updated;
    }

    /**
     * Issue Receipt for paid invoice (Accountant action)
     * @param {string} invoiceId 
     * @param {string} issuedBy - Accountant user ID
     * @param {string} paymentMethod - QR_CASH, BANK_TRANSFER, CREDIT_CARD
     * @param {string} notes - Additional notes
     */
    async issueReceipt(invoiceId, issuedBy, paymentMethod, notes) {
        const invoice = await this.getById(invoiceId);
        if (!invoice) { throw new Error('Invoice not found'); }
        if (!canonicalPaidStatuses().includes(invoice.status)) {
            throw new Error('Cannot issue receipt for unpaid invoice');
        }
        if (invoice.receiptNumber) {
            throw new Error('Receipt already issued for this invoice');
        }

        // R5-B / X4-FIX-A RC-2: allocate the receipt number through the
        // canonical per-issuer allocator. `allocateReceiptNumber` runs its
        // own serializable transaction on the (prefix, year) ReceiptSequence
        // row, so DTAM and PLATFORM receipts pull from independent counters
        // (RCP-DTAM-๒๕๖๙-๐๐๐๐๐๑ vs TAX-PRD-2026-000001) instead of sharing
        // one global `invoice.count` aggregate. The invoice.update then
        // runs in its own serializable transaction; a failure between the
        // two leaves a gap in the sequence, which is acceptable per
        // commercial-receipt practice (better than silent collision).
        const issuer = receiptNumberingService.resolveIssuerForServiceType(invoice.serviceType);
        // One instant for the number year and the printed receipt date (Bangkok).
        const receiptIssuedAt = new Date();
        const allocation = await receiptNumberingService.allocateReceiptNumber({
            issuer, dateOrYear: receiptIssuedAt,
        });
        const receiptNumber = allocation.number;

        // Compare-and-set (audit 2026-06-11, 3.6): only write the receiptNumber
        // while it is still null. The pre-check at line ~371 reads a snapshot, so
        // two issuers (auto-issue racing a manual issue/retry) could both pass it;
        // `update({where:{id}})` would then let the loser OVERWRITE the winner's
        // receiptNumber (last-writer-wins). updateMany with `receiptNumber: null`
        // makes the write conditional — a 0-row result means another writer won,
        // so we leave their number intact (our allocated number becomes an
        // accepted sequence gap, per commercial-receipt practice) and return the
        // persisted receipt idempotently instead of double-writing / double-notifying.
        const receiptData = {
            status: INVOICE_STATUS.RECEIPT_ISSUED,
            receiptNumber,
            receiptIssuedAt,
            receiptIssuedBy: issuedBy,
            paymentMethod: paymentMethod || 'BANK_TRANSFER',
            notes: notes ? (invoice.notes ? `${invoice.notes}\n[Receipt] ${notes}` : `[Receipt] ${notes}`) : invoice.notes,
        };
        const writeCount = await prisma.$transaction(async (tx) => {
            const res = await tx.invoice.updateMany({
                where: { id: invoiceId, receiptNumber: null },
                data: receiptData,
            });
            return res.count;
        }, { isolationLevel: 'Serializable' });

        if (writeCount === 0) {
            // A concurrent issuance already assigned a receipt number. Do NOT
            // overwrite it and do NOT re-run the phase sync / notification (the
            // winner already did). Our allocated number is left as an accepted
            // sequence gap. Idempotent return of the persisted receipt.
            return await this.getById(invoiceId);
        }

        const updated = { ...invoice, ...receiptData };

        await syncApplicationPhaseStatus(updated.applicationId);

        // Send notification outside transaction to avoid timeout
        const { sendNotification, NotifyType } = require('./notification-service');
        if (invoice.applicant?.id) {
            await sendNotification(invoice.applicant.id, NotifyType.SUCCESS, {
                applicationNumber: invoice.application?.applicationNumber,
                receiptNumber: updated.receiptNumber,
            }, {
                title: 'Receipt issued',
                // Iter 24 (decimal-unification 2026-05-16): Invoice.totalAmount
                // is now Decimal(15,2). Prisma marshals it as a Decimal.js
                // instance which has `.toFixed()` but NOT `.toLocaleString()`.
                // Coerce via Number() at this single notification boundary —
                // baht amounts are well below 2^53 so the conversion is
                // lossless for every plausible row.
                message: `Receipt ${updated.receiptNumber} amount ${Number(invoice.totalAmount).toLocaleString()} THB`,
            });
        }

        return updated;
    }

    /**
     * Auto-issue a receipt with PERSISTED status tracking (B-RCPT-STATUS).
     * The slip-approve path calls this ASYNCHRONOUSLY (outside its tx — decision
     * A). Unlike the old fire-and-forget swallow, a failure is RECORDED on the
     * invoice (receiptStatus='FAILED' + receiptError) so it is visible to the
     * ACCOUNT queue (listReceiptFailures) and retryable (retryReceiptIssue) —
     * never silent. Returns { ok, invoice?, alreadyIssued?, error? }; does NOT throw.
     */
    async autoIssueReceiptTracked(invoiceId, issuedBy, paymentMethod, notes) {
        const logger = require('../shared/logger');
        // Mark the attempt up front so a crash mid-issue still leaves a trace.
        await prisma.invoice.update({
            where: { id: invoiceId },
            data: {
                receiptStatus: 'PENDING',
                receiptLastAttemptAt: new Date(),
                receiptAttempts: { increment: 1 },
            },
        }).catch(() => { /* status column best-effort; the issue still proceeds */ });

        try {
            const updated = await this.issueReceipt(invoiceId, issuedBy, paymentMethod, notes);
            await prisma.invoice.update({
                where: { id: invoiceId },
                data: { receiptStatus: 'ISSUED', receiptError: null },
            }).catch(() => {});
            return { ok: true, invoice: updated };
        } catch (err) {
            const message = String(err?.message || err);
            // "Receipt already issued" is a benign race (a prior attempt won) —
            // reconcile to ISSUED rather than flagging a false failure.
            if (/already issued/i.test(message)) {
                await prisma.invoice.update({
                    where: { id: invoiceId },
                    data: { receiptStatus: 'ISSUED', receiptError: null },
                }).catch(() => {});
                return { ok: true, alreadyIssued: true };
            }
            await prisma.invoice.update({
                where: { id: invoiceId },
                data: { receiptStatus: 'FAILED', receiptError: message.slice(0, 500) },
            }).catch(() => {});
            logger.error(`[invoice] auto-issue receipt FAILED invoice=${invoiceId}: ${message}`);
            return { ok: false, error: err };
        }
    }

    /**
     * ACCOUNT queue: invoices whose auto-issue FAILED (paid, no receipt, with a
     * recorded reason). Complements listPendingReceipts (never-attempted) by
     * surfacing the FAILED ones + their error so finance can act / retry.
     */
    async listReceiptFailures(limit = 100) {
        const invoices = await prisma.invoice.findMany({
            where: { receiptStatus: 'FAILED', isDeleted: false },
            orderBy: { receiptLastAttemptAt: 'desc' },
            take: limit,
            include: {
                applicant: { select: { firstName: true, lastName: true } },
                application: BILLING_APPLICATION_SELECT,
            },
        });
        return invoices.map(withDerivedStatus);
    }

    /**
     * Retry a previously-failed auto-issue (ACCOUNT action). Idempotent: if the
     * receipt was meanwhile issued, returns ok without duplicating.
     */
    async retryReceiptIssue(invoiceId, issuedBy, notes) {
        return this.autoIssueReceiptTracked(
            invoiceId, issuedBy, 'BANK_TRANSFER', notes || `Manual retry by ${issuedBy}`,
        );
    }

    /**
     * The paper for a paid invoice: ใบเสร็จรับเงิน / ใบกำกับภาษีเต็มรูป, numbered with the
     * stored TAX-PRD receipt number (invoice-template-service.generateReceiptTaxInvoicePdf).
     * Served by the staff route and by the applicant's own route alike.
     */
    async generateReceiptPdf(invoiceId, { scope } = {}) {
        const invoice = await this.getForDocument(invoiceId, { scope });
        if (!invoice) { throw new Error('Invoice not found'); }
        // Precondition, not a server fault: invoice exists but no receipt issued
        // yet → 409 (respondError honours error.statusCode). Previously this plain
        // Error fell through to a generic 500.
        if (!invoice.receiptNumber) {
            throw Object.assign(new Error('Receipt not issued yet'), { statusCode: 409, code: 'RECEIPT_NOT_ISSUED' });
        }

        // Try queue-based generation first, fallback to direct PDFKit
        try {
            const { getPdfQueue } = require('./queue-service');
            const pdfQueue = getPdfQueue();
            if (pdfQueue) {
                const logger = require('../shared/logger');
                logger.info(`[Invoice] Offloading Receipt PDF generation to worker for ID: ${invoiceId}`);
                const job = await pdfQueue.add({ type: 'RECEIPT', payload: { invoiceId: invoiceId } });
                const resultBase64 = await job.finished();
                return Buffer.from(resultBase64, 'base64');
            }
        } catch (queueError) {
            const logger = require('../shared/logger');
            logger.warn(`[Invoice] Queue Receipt PDF failed, falling back to direct PDFKit: ${queueError.message}`);
        }

        return invoiceTemplateService.generateReceiptTaxInvoicePdf(invoice, { upload: false });
    }

    /**
     * List paid invoices pending receipt issuance
     */
    async listPendingReceipts() {
        const invoices = await prisma.invoice.findMany({
            where: {
                status: { in: ['paid', 'PAID', INVOICE_STATUS.PAID_PENDING_RECEIPT] },
                receiptNumber: null,
                isDeleted: false,
            },
            orderBy: { paidAt: 'asc' },
            // Billing columns only — see listAll above.
            include: {
                applicant: { select: { firstName: true, lastName: true } },
                application: BILLING_APPLICATION_SELECT,
            },
        });
        return invoices.map(withDerivedStatus);
    }

    /**
     * List accounting exceptions from payment webhook audit trail.
     * Exception classes: unmatched invoice, invalid signature, processing failure.
     */
    async listReceiptExceptions(limit = 100) {
        const logs = await prisma.auditLog.findMany({
            where: {
                category: 'PAYMENT',
                action: {
                    in: [
                        'WEBHOOK_UNMATCHED',
                        'WEBHOOK_INVALID_SIGNATURE',
                        'WEBHOOK_PROCESSING_FAILED',
                    ],
                },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });

        return logs.map((entry) => {
            const metadata = parseAuditMetadata(entry.metadata);
            return {
                id: entry.id,
                action: entry.action,
                severity: entry.severity,
                createdAt: entry.createdAt,
                invoiceId: metadata.invoiceId || metadata.gatewayRef || null,
                transactionId: metadata.transactionId || null,
                message: metadata.message || entry.errorMessage || 'Payment exception recorded',
                payloadRef: metadata.payloadHash || null,
                metadata,
            };
        });
    }

    // ─── Finance Department Features (delegated to invoice/invoice-finance-ops.js) ───

    async holdInvoice(invoiceId, reason, heldBy) {
        const invoice = await this.getById(invoiceId);
        if (!invoice) { throw new Error('Invoice not found'); }
        const financeOps = require('./invoice/invoice-finance-ops');
        const updated = await financeOps.holdInvoice(invoice, invoiceId, reason, heldBy);
        return withDerivedStatus(updated);
    }

    async releaseHold(invoiceId, releasedBy) {
        const invoice = await this.getById(invoiceId);
        if (!invoice) { throw new Error('Invoice not found'); }
        const financeOps = require('./invoice/invoice-finance-ops');
        const updated = await financeOps.releaseHold(invoice, invoiceId, releasedBy);
        await syncApplicationPhaseStatus(updated.applicationId);
        return withDerivedStatus(updated);
    }

    async forfeitRevenue(invoiceId, reason) {
        const invoice = await this.getById(invoiceId);
        if (!invoice) { throw new Error('Invoice not found'); }
        const financeOps = require('./invoice/invoice-finance-ops');
        const updated = await financeOps.forfeitRevenue(invoice, invoiceId, reason);
        return withDerivedStatus(updated);
    }

    async getRevenueSummary(startDate, endDate) {
        const financeOps = require('./invoice/invoice-finance-ops');
        return financeOps.getRevenueSummary(startDate, endDate);
    }

    /**
     * Fetch a thin projection of invoices for a set of applicationIds, used
     * by the auditor + scheduler dashboards to compute per-application phase
     * settlement (`computePhaseSettlement(...)`). Soft-deleted invoices are
     * filtered out so a phase that has been cancelled/written-off cannot be
     * mistaken for an unpaid balance on the queue cards.
     *
     * Replaces prisma.invoice.findMany at:
     *   - routes/api/provider/handlers/auditor-dashboard-handler.js:75
     *   - routes/api/provider/handlers/scheduler-dashboard-handler.js:70
     */
    /**
     * Fetch a thin projection of invoices for a single application, used by
     * the auditor `isPhase2ReceiptIssued` precondition check in the
     * inspection-start path. Soft-deleted invoices are filtered out so a
     * cancelled phase invoice cannot block a fresh inspection start.
     *
     * Replaces prisma.invoice.findMany at
     * routes/api/provider/handlers/auditor-handler-deps.js:33.
     */
    async listSettlementsForApplication(applicationId) {
        if (!applicationId) {return [];}
        return prisma.invoice.findMany({
            where: {
                applicationId,
                isDeleted: false,
            },
            select: {
                id: true,
                serviceType: true,
                status: true,
                receiptIssuedAt: true,
                receiptNumber: true,
                createdAt: true,
                updatedAt: true,
            },
            orderBy: { createdAt: 'asc' },
        });
    }

    async listSettlementsByApplicationIds(applicationIds) {
        if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
            return [];
        }
        return prisma.invoice.findMany({
            where: {
                applicationId: { in: applicationIds },
                isDeleted: false,
            },
            select: {
                applicationId: true,
                serviceType: true,
                status: true,
                paidAt: true,
                receiptIssuedAt: true,
                receiptNumber: true,
                createdAt: true,
                updatedAt: true,
            },
        });
    }
}

module.exports = new InvoiceService();


