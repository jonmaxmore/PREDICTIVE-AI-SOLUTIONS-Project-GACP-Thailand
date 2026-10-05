/**
 * Purchase Invoice Service — ใบกำกับภาษีซื้อ / Input VAT (ภาษีซื้อ) tracking.
 *
 * Iter 26 (hardening loop, 2026-05-16). Companion to vat-report-service.js
 * (B19-C). Where vat-report-service.js handles OUTPUT VAT (ภาษีขาย — VAT
 * the platform collects from its customers on PLATFORM service-fee
 * invoices), this module handles INPUT VAT (ภาษีซื้อ — VAT the platform
 * pays its own suppliers on business purchases) so the monthly ภ.พ.30
 * remittance can be computed correctly:
 *
 *     Net VAT payable = Output VAT − Input VAT     (ป.รัษฎากร ม.82/3)
 *
 * Responsibility:
 *   - Create / approve / reject / mark-as-paid PurchaseInvoice rows.
 *   - Allocate Input VAT (ภาษีซื้อ) claims to a specific ภ.พ.30 month via
 *     invoiceDate (ป.รัษฎากร ม.83/8 — Input VAT lands in the period that
 *     matches the supplier invoice date, not the receivedDate).
 *   - On APPROVAL, record the Input VAT journal entry (Dr Input VAT,
 *     Cr Cash / AP) into the GL so the trial balance + ภ.พ.30 reconcile.
 *   - Audit-log every state transition (ม.86/4 + Thai e-Transactions Act §31).
 *
 * Document state machine:
 *
 *     PENDING_REVIEW ──approve──▶ APPROVED ──mark-paid──▶ APPROVED (paidAt set)
 *           │
 *           └─reject──▶ REJECTED (terminal — submit a new row to retry)
 *
 *   APPROVED is terminal for the Input-VAT claim itself; markAsPaid only
 *   updates the settlement timestamp (it does NOT change status). This
 *   mirrors the Thai accounting practice where the VAT claim event and
 *   the cash-settlement event are recognised separately (the claim
 *   happens in the ภ.พ.30 period matching invoiceDate, the cash payment
 *   can land in any later period).
 *
 * Journal entry shape (APPROVED — written via journal-entry-service):
 *
 *     Dr. Input VAT (1310)             <vat>      ─ claimable on ภ.พ.30
 *     Dr. Expense / AP / Asset         <subtotal> ─ category-driven account
 *       Cr. Cash / Accounts Payable        <totalAmount>
 *
 *   The "Dr Expense / Cr Cash-or-AP" half of the entry depends on whether
 *   the platform has already paid the supplier:
 *     - paidAt set        → Cr Cash (1110-001) "เงินสด/เงินฝากธนาคาร"
 *     - paidAt not set    → Cr Accounts Payable (2110-001) "เจ้าหนี้การค้า"
 *   This service emits the right Cr line for the row's current state.
 *
 *   For Iter 26 the journal-entry-service does not yet have a dedicated
 *   `recordInputVatEntry` helper (B19-C was Output-only, B20-B added the
 *   credit-note reversal path but not Input). We use the same in-memory
 *   build + persist pattern that buildPaymentEntryLines uses, calling
 *   into the JournalEntry / JournalLine tables directly through the
 *   shared prisma-database handle. The structured log line carries a
 *   `[purchase-invoice][journal]` marker so finance can spot the entries
 *   in the log stream, and the persistence is wrapped in a $transaction
 *   so the row update + journal write commit atomically (TFRS for NPAEs
 *   ch.2 — atomicity).
 *
 * Legal anchors (ป.รัษฎากร):
 *   - ม.82/3 — VAT-registered buyers may net Input VAT against Output VAT.
 *   - ม.82/4 — Input VAT claim requires the original ใบกำกับภาษีซื้อ on
 *              file with supplier TIN, invoice number, date, taxable amount,
 *              and VAT amount; the purchase must relate to VAT-able
 *              business activities.
 *   - ม.83/8 — monthly e-Filing window: 15th of the following month;
 *              Input VAT lands in the period matching invoiceDate.
 *   - ม.86/4 — full tax-invoice field minima (drives validation).
 *   - ม.87/3 — 7-year retention of the supplier's tax invoice.
 *   - TFRS for NPAEs ch.2 — separation of duties: the reviewer (approver)
 *              should differ from the submitter where practical.
 *
 * Scope: PLATFORM only. The platform is the VAT-registered buyer; the
 * supplier is whoever sent the invoice. DTAM-side procurement is handled
 * by กรมบัญชีกลาง systems, not by this service.
 *
 * @module services/purchase-invoice-service
 */

'use strict';

const logger = require('../shared/logger');
const { normalizeRole, CANONICAL_ROLES } = require('../shared/canonical-rbac');
const { auditLogger, AuditCategory, AuditSeverity, ResourceType } = require('../middleware/audit-logger');
// PDPA close-natid-round2 (2026-06-30) — mask the supplier TIN written into
// audit_logs.metadata. The AuditLog model has NO PDPA encrypt hook, so the
// raw 13-digit TIN would otherwise sit plaintext in the audit table (a
// dump-readable national-ID location). maskThaiId → 1-XXXX-XXXX-X-0123.
const { maskThaiId } = require('../utils/field-encryption');
// computeLookupHmac keys the parallel `supplierTaxIdHmac` lookup column the
// dedup + @@unique now use (the plaintext supplierTaxId column is encrypted at
// rest, so a raw WHERE / DB-unique on it can no longer work — mirrors the
// User.*Hmac / Entity.thaiCitizenIdHmac precedent).
const { computeLookupHmac } = require('../utils/field-encryption');

// Lazy-require so the service stays loadable in CI before
// `prisma generate` runs. resolvePrisma() below treats the stubbed
// Proxy as "no DB" and throws DB_UNAVAILABLE for write paths.
let prismaModule;
try {
    prismaModule = require('./prisma-database');
} catch (_e) {
    prismaModule = { prisma: null };
}

// ── Constants ──────────────────────────────────────────────────────────────

const STATUS = Object.freeze({
    PENDING_REVIEW: 'PENDING_REVIEW',
    APPROVED:       'APPROVED',
    REJECTED:       'REJECTED',
});

const VALID_CATEGORIES = Object.freeze([
    'OFFICE_SUPPLIES',
    'PROFESSIONAL_SERVICES',
    'UTILITIES',
    'OTHER',
]);

// Allowed transitions out of each state.
const ALLOWED_TRANSITIONS = Object.freeze({
    [STATUS.PENDING_REVIEW]: new Set([STATUS.APPROVED, STATUS.REJECTED]),
    [STATUS.APPROVED]:       new Set(),
    [STATUS.REJECTED]:       new Set(),
});

const WRITE_ROLES = new Set([
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
]);

// ด่านอ่าน — การเงินสองบทบาทเห็นชุดเดียวกัน (operator 2026-09-11) · WRITE_ROLES ข้างบนไม่ขยาย
const READ_ROLES = new Set([
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
]);
// ผู้ตรวจประเมินไม่อยู่ในชุดอ่านเรื่องเงิน (operator 2026-09-27)

// Chart-of-accounts entries used by the Input VAT journal entry. The
// canonical chart lives in chart-of-accounts-service.js (read-only for
// this iteration — out of bounds per B19-A); we mirror the codes here
// as constants so the service is self-contained and tests can assert
// against fixed strings. When chart-of-accounts-service is extended in
// a later iteration the constants below should be kept in sync (or
// promoted to a single import from that module).
const ACCOUNTS = Object.freeze({
    // Asset — Input VAT credit (ภาษีซื้อตั้งพัก / Input VAT claimable).
    // New code introduced by this iteration; sits in the 13xx asset
    // bucket because it represents a receivable-style claim against the
    // Revenue Department (it nets against VAT_PAYABLE_OUTPUT on ภ.พ.30).
    INPUT_VAT: { code: '1310-001', name: 'ภาษีซื้อ · Input VAT 7%' },
    // Asset / Expense — purchase subtotal. The exact account depends on
    // category; we keep a small mapping table below. Default to a
    // generic expense account when the category is OTHER.
    EXPENSE_OFFICE:        { code: '5210-001', name: 'ค่าใช้จ่าย · วัสดุสำนักงาน' },
    EXPENSE_PROFESSIONAL:  { code: '5220-001', name: 'ค่าใช้จ่าย บริการมืออาชีพ' },
    EXPENSE_UTILITIES:     { code: '5230-001', name: 'ค่าใช้จ่าย · สาธารณูปโภค' },
    EXPENSE_OTHER:         { code: '5290-001', name: 'ค่าใช้จ่าย · อื่น ๆ' },
    // Cash side — credited when paidAt is set.
    CASH_BANK:             { code: '1110-001', name: 'เงินสด/เงินฝากธนาคาร · บัญชีหลัก' },
    // AP side — credited when paidAt is NOT set (purchase on credit).
    ACCOUNTS_PAYABLE:      { code: '2110-001', name: 'เจ้าหนี้การค้า' },
});

const CATEGORY_TO_EXPENSE = Object.freeze({
    OFFICE_SUPPLIES:       ACCOUNTS.EXPENSE_OFFICE,
    PROFESSIONAL_SERVICES: ACCOUNTS.EXPENSE_PROFESSIONAL,
    UTILITIES:             ACCOUNTS.EXPENSE_UTILITIES,
    OTHER:                 ACCOUNTS.EXPENSE_OTHER,
});

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
    if (!client.purchaseInvoice || typeof client.purchaseInvoice.create !== 'function') {
        return null;
    }
    return client;
}

/**
 * Validate that a Thai tax ID looks well-formed (13 digits). We do NOT
 * run the checksum here — ป.รัษฎากร ม.86/4 requires the seller's TIN
 * to be present and correct on the invoice; if the supplier provided
 * an invalid TIN we still record the row but flag it; however an
 * obviously-malformed length (≠ 13 digits) is a hard reject because
 * the row cannot pass RD e-Filing validation.
 */
function isValidThaiTaxId(taxId) {
    return typeof taxId === 'string' && /^\d{13}$/.test(taxId);
}

function assertWriteAccess(actor, row) {
    const role = normalizeRole(actor?.canonicalRole || actor?.role);
    if (!role || !WRITE_ROLES.has(role)) {
        throw makeError(
            'FORBIDDEN_ROLE',
            'ACCOUNT_PLATFORM or ADMIN role required to mutate purchase invoices',
            403,
        );
    }
    if (role !== CANONICAL_ROLES.SYSTEM_ADMIN_DTAM
        && actor?.organizationId
        && row?.organizationId
        && actor.organizationId !== row.organizationId) {
        throw makeError(
            'FORBIDDEN_TENANT',
            'Cross-tenant access denied — purchase invoices are scoped to the org',
            403,
        );
    }
}

function assertReadAccess(actor) {
    const role = normalizeRole(actor?.canonicalRole || actor?.role);
    if (!role || !READ_ROLES.has(role)) {
        throw makeError(
            'FORBIDDEN_ROLE',
            'A finance or admin role is required to read purchase invoices',
            403,
        );
    }
}

/**
 * Validate financial totals balance — subtotal + vat must equal totalAmount
 * within 0.005 THB (sub-satang rounding tolerance).
 */
function assertTotalsBalance(subtotal, vat, totalAmount) {
    const s = round2(subtotal);
    const v = round2(vat);
    const t = round2(totalAmount);
    if (s < 0) {
        throw makeError('INVALID_AMOUNT', 'subtotal must be non-negative');
    }
    if (v < 0) {
        throw makeError('INVALID_AMOUNT', 'vat must be non-negative');
    }
    if (t <= 0) {
        throw makeError('INVALID_AMOUNT', 'totalAmount must be positive');
    }
    if (Math.abs(s + v - t) > 0.005) {
        throw makeError(
            'UNBALANCED_TOTALS',
            `subtotal (${s}) + vat (${v}) must equal totalAmount (${t}) within 0.005 THB`,
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
        logger.warn(`[purchase-invoice] audit log failed (non-fatal): ${err?.message}`);
    }
}

// ── Journal entry builder (Input VAT) ──────────────────────────────────────

/**
 * Build the in-memory journal entry that an APPROVED PurchaseInvoice
 * posts to the GL. Pure helper — no I/O.
 *
 * Shape (Dr/Cr — balanced):
 *
 *   Dr. Input VAT 7%            <vat>             ── 1310-001
 *   Dr. Expense (by category)   <subtotal>        ── 5xxx-001
 *     Cr. Cash / AP                <totalAmount>  ── 1110-001 or 2110-001
 *
 * The Cr side picks Cash when `paid === true` (paidAt set on the row at
 * time of approval) or AP otherwise — see file header for rationale.
 *
 * @param {object} args
 * @param {string} args.purchaseInvoiceId
 * @param {string} args.invoiceNumber       supplier's invoice number
 * @param {string} args.supplierName
 * @param {number} args.subtotal
 * @param {number} args.vat
 * @param {number} args.totalAmount
 * @param {string} args.category            one of VALID_CATEGORIES
 * @param {boolean} args.paid               whether to credit Cash (true) or AP (false)
 * @param {Date}   args.entryDate           accounting date (invoice or approval date)
 * @returns {object}  balanced entry shape (entryDate, reference, lines, totals, balanced)
 */
function buildInputVatEntryLines({
    purchaseInvoiceId,
    invoiceNumber,
    supplierName,
    subtotal,
    vat,
    totalAmount,
    category,
    paid,
    entryDate,
}) {
    const subTotal = round2(subtotal);
    const vatAmt = round2(vat);
    const total = round2(totalAmount);

    const expenseAccount = CATEGORY_TO_EXPENSE[category] || ACCOUNTS.EXPENSE_OTHER;
    const creditAccount = paid ? ACCOUNTS.CASH_BANK : ACCOUNTS.ACCOUNTS_PAYABLE;

    const lines = [
        {
            lineNumber: 1,
            accountCode: ACCOUNTS.INPUT_VAT.code,
            accountName: ACCOUNTS.INPUT_VAT.name,
            debit:  vatAmt,
            credit: 0,
            issuer: 'PLATFORM',
            // Mark the VAT base on the Input VAT line so ภ.พ.30 Input
            // side has a single line to filter on (mirrors how
            // VAT_PAYABLE_OUTPUT carries taxableAmount on Output side).
            taxableAmount: subTotal,
            memo: `Input VAT 7% — purchase invoice ${invoiceNumber} (${supplierName})`,
        },
        {
            lineNumber: 2,
            accountCode: expenseAccount.code,
            accountName: expenseAccount.name,
            debit:  subTotal,
            credit: 0,
            issuer: 'PLATFORM',
            memo: `Purchase expense — ${invoiceNumber} (${supplierName})`,
        },
        {
            lineNumber: 3,
            accountCode: creditAccount.code,
            accountName: creditAccount.name,
            debit:  0,
            credit: total,
            issuer: 'PLATFORM',
            memo: paid
                ? `Cash paid to ${supplierName} — ${invoiceNumber}`
                : `Liability to ${supplierName} — ${invoiceNumber}`,
        },
    ];

    const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
    const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));
    const balanced = Math.abs(totalDebit - totalCredit) < 0.005;

    return {
        purchaseInvoiceId,
        invoiceNumber,
        entryDate,
        reference: `PURCHASE-${invoiceNumber}`,
        description: `Input VAT claim — purchase invoice ${invoiceNumber} (${supplierName})`,
        totalDebit,
        totalCredit,
        balanced,
        lines,
    };
}

/**
 * Persist a balanced Input VAT journal entry into JournalEntry +
 * JournalLine via the supplied (transaction or top-level) prisma client.
 * Returns the persisted row id, or null when the client lacks the
 * journalEntry delegate (test / CI without DB).
 *
 * @private
 */
async function persistInputVatEntry({ prisma, entry, organizationId, createdBy }) {
    if (!prisma || !prisma.journalEntry || typeof prisma.journalEntry.create !== 'function') {
        return null;
    }
    return prisma.journalEntry.create({
        data: {
            entryDate: entry.entryDate,
            reference: entry.reference,
            invoiceId: null, // PurchaseInvoice is a separate aggregate from Invoice
            description: entry.description,
            totalDebit: entry.totalDebit,
            totalCredit: entry.totalCredit,
            organizationId: organizationId || null,
            createdBy: createdBy || null,
            lines: {
                create: entry.lines.map((line) => ({
                    lineNumber: line.lineNumber,
                    accountCode: line.accountCode,
                    accountName: line.accountName,
                    debit: line.debit,
                    credit: line.credit,
                    issuer: line.issuer || null,
                    taxableAmount: line.taxableAmount != null ? line.taxableAmount : null,
                    metadata: {
                        memo: line.memo || null,
                        kind: 'INPUT_VAT_CLAIM',
                        purchaseInvoiceId: entry.purchaseInvoiceId,
                    },
                })),
            },
        },
        include: { lines: true },
    });
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Create a PurchaseInvoice row in PENDING_REVIEW status.
 *
 *   {
 *     invoiceNumber, supplierName, supplierTaxId, supplierAddress?,
 *     invoiceDate, subtotal, vat, totalAmount, category, description?,
 *     notes?, attachmentId?, organizationId?, createdBy, actor,
 *   }
 *
 * `actor` ต้องอยู่ใน WRITE_ROLES ชุดเดียวกับ approve/reject/mark-paid — เดิมประตูสร้างไม่มีด่าน
 * บทบาทเลย เจ้าหน้าที่ทุกบทบาทสร้างใบภาษีซื้อได้ (operator 2026-09-27: "กรมฯ ดูอย่างเดียว"
 * · บริษัทเป็นผู้ถือสมุดบัญชี) · ด่านอยู่ก่อนการตรวจข้อมูล — บทบาทที่ไม่มีสิทธิ์ได้ 403 เสมอ
 *
 * @returns {Promise<{ id, invoiceNumber, status, ... }>} the created row
 */
async function createPurchaseInvoice({
    invoiceNumber, supplierName, supplierTaxId, supplierAddress,
    invoiceDate, subtotal, vat, totalAmount, category,
    description, notes, attachmentId, organizationId, createdBy, actor,
} = {}) {
    assertWriteAccess(actor, null);
    // Tenant (S4 — security review 2026-09-27): the row lands in the creator's own
    // organization; only system_admin_dtam may name another one.
    const isAdmin = normalizeRole(actor?.canonicalRole || actor?.role) === CANONICAL_ROLES.SYSTEM_ADMIN_DTAM;
    const targetOrganizationId = isAdmin ? (organizationId || actor?.organizationId || null) : (actor?.organizationId || null);
    if (!targetOrganizationId) {
        throw makeError('FORBIDDEN_TENANT', 'Organization context required', 403);
    }
    // Field-presence validation.
    if (!invoiceNumber || typeof invoiceNumber !== 'string') {
        throw makeError('VALIDATION_ERROR', 'invoiceNumber is required');
    }
    if (!supplierName || typeof supplierName !== 'string') {
        throw makeError('VALIDATION_ERROR', 'supplierName is required');
    }
    if (!isValidThaiTaxId(supplierTaxId)) {
        throw makeError(
            'INVALID_TAX_ID',
            'supplierTaxId must be 13 digits (ป.รัษฎากร ม.86/4)',
        );
    }
    if (!invoiceDate) {
        throw makeError('VALIDATION_ERROR', 'invoiceDate is required');
    }
    if (!VALID_CATEGORIES.includes(category)) {
        throw makeError(
            'INVALID_CATEGORY',
            `category must be one of: ${VALID_CATEGORIES.join(', ')}`,
        );
    }
    if (!createdBy) {
        throw makeError('VALIDATION_ERROR', 'createdBy is required');
    }
    assertTotalsBalance(subtotal, vat, totalAmount);

    const prisma = resolvePrisma();
    if (!prisma) {
        throw makeError('DB_UNAVAILABLE', 'Prisma client unavailable for purchase-invoice creation', 503);
    }

    // PDPA close-natid-round2 — dedup + DB-uniqueness moved to the keyed
    // `supplierTaxIdHmac` lookup column. The plaintext `supplierTaxId` column
    // is now encrypted at rest (random-IV AES-GCM via the PDPA extension), so a
    // raw WHERE / @@unique on it can no longer match — mirrors User.*Hmac /
    // Entity.thaiCitizenIdHmac. computeLookupHmac is deterministic + keyed off
    // ENCRYPTION_KEY, so it remains a stable equality key. (isValidThaiTaxId
    // above already guaranteed supplierTaxId is a 13-digit string.)
    const supplierTaxIdHmac = computeLookupHmac(supplierTaxId);

    // Uniqueness check at the application boundary so we can surface a
    // friendly error code (the unique index also enforces this at the
    // DB level — defense in depth). Filter by the HMAC, not the (now
    // encrypted) plaintext.
    const dup = await prisma.purchaseInvoice.findFirst({
        where: { supplierTaxIdHmac, invoiceNumber, isDeleted: false },
        select: { id: true },
    }).catch(() => null);
    if (dup) {
        throw makeError(
            'DUPLICATE_PURCHASE_INVOICE',
            `Purchase invoice ${invoiceNumber} from supplier ${maskThaiId(supplierTaxId)} already on file`,
            409,
        );
    }

    const created = await prisma.purchaseInvoice.create({
        data: {
            invoiceNumber: String(invoiceNumber).trim(),
            supplierName: String(supplierName).trim(),
            supplierTaxId,
            // Keyed-HMAC lookup column — carries dedup + the
            // @@unique([supplierTaxIdHmac, invoiceNumber]) now that the
            // plaintext column is encrypted.
            supplierTaxIdHmac,
            supplierAddress: supplierAddress || null,
            invoiceDate: new Date(invoiceDate),
            subtotal: round2(subtotal),
            vat: round2(vat),
            totalAmount: round2(totalAmount),
            category,
            description: description || null,
            notes: notes || null,
            attachmentId: attachmentId || null,
            organizationId: targetOrganizationId,
            status: STATUS.PENDING_REVIEW,
            createdBy,
        },
    });

    await safeAudit(
        'PURCHASE_INVOICE_CREATED',
        AuditSeverity.INFO,
        { id: createdBy, organizationId: targetOrganizationId },
        `PURCHASE_INVOICE:${created.id}`,
        {
            invoiceNumber: created.invoiceNumber,
            // PDPA close-natid-round2 — store the MASKED TIN in audit metadata.
            // audit_logs.metadata has no PDPA encrypt hook, so the raw 13-digit
            // TIN would be a plaintext dump-readable national ID. Masking keeps
            // the audit trail useful (last 4) without the at-rest leak — matches
            // the covered-set audit convention.
            supplierTaxId: maskThaiId(supplierTaxId),
            supplierName: created.supplierName,
            category,
            subtotal: round2(subtotal),
            vat: round2(vat),
            totalAmount: round2(totalAmount),
        },
    );

    logger.info(
        `[purchase-invoice] PENDING_REVIEW created ${created.invoiceNumber} from `
        + `${created.supplierName} (TIN ${maskThaiId(supplierTaxId)}) — `
        + `subtotal=${created.subtotal} vat=${created.vat} total=${created.totalAmount}`,
    );

    return {
        id: created.id,
        invoiceNumber: created.invoiceNumber,
        status: created.status,
        supplierName: created.supplierName,
        supplierTaxId: created.supplierTaxId,
        invoiceDate: created.invoiceDate,
        subtotal: created.subtotal,
        vat: created.vat,
        totalAmount: created.totalAmount,
        category: created.category,
        organizationId: created.organizationId,
        createdAt: created.createdAt,
        createdBy: created.createdBy,
    };
}

/**
 * Approve a PENDING_REVIEW PurchaseInvoice. Writes the Input VAT
 * journal entry atomically with the status flip.
 *
 * @param {string} id
 * @param {object} options
 * @param {object} options.actor  canonical actor — must have ACCOUNT_PLATFORM
 *                                or ADMIN role; tenant-scoped.
 */
async function approvePurchaseInvoice(id, { actor } = {}) {
    if (!id) {
        throw makeError('VALIDATION_ERROR', 'id is required');
    }
    const prisma = resolvePrisma();
    if (!prisma) {
        throw makeError('DB_UNAVAILABLE', 'Prisma client unavailable', 503);
    }

    const row = await prisma.purchaseInvoice.findUnique({ where: { id } });
    if (!row) {
        throw makeError('PURCHASE_INVOICE_NOT_FOUND', 'Purchase invoice not found', 404);
    }
    if (row.isDeleted) {
        throw makeError('PURCHASE_INVOICE_DELETED', 'Purchase invoice has been soft-deleted', 410);
    }
    assertWriteAccess(actor, row);

    if (!ALLOWED_TRANSITIONS[row.status]?.has(STATUS.APPROVED)) {
        throw makeError(
            'INVALID_TRANSITION',
            `Cannot approve purchase invoice from status ${row.status}`,
            409,
        );
    }

    const subtotal = round2(Number(row.subtotal));
    const vat = round2(Number(row.vat));
    const total = round2(Number(row.totalAmount));

    // Use invoiceDate as the accounting entryDate per ม.83/8 — Input VAT
    // claims land in the period matching the supplier invoice date.
    const entry = buildInputVatEntryLines({
        purchaseInvoiceId: row.id,
        invoiceNumber: row.invoiceNumber,
        supplierName: row.supplierName,
        subtotal,
        vat,
        totalAmount: total,
        category: row.category,
        paid: !!row.paidAt,
        entryDate: row.invoiceDate,
    });

    if (!entry.balanced) {
        logger.error(
            `[purchase-invoice] UNBALANCED journal entry for ${row.invoiceNumber} — `
            + `Dr=${entry.totalDebit} Cr=${entry.totalCredit}`,
        );
        throw makeError(
            'UNBALANCED_ENTRY',
            `Unbalanced journal entry: Dr ${entry.totalDebit} != Cr ${entry.totalCredit}`,
        );
    }

    // Atomic: status flip + journal entry write commit together.
    const result = await prisma.$transaction(async (tx) => {
        const persisted = await persistInputVatEntry({
            prisma: tx,
            entry,
            organizationId: row.organizationId,
            createdBy: actor?.id || 'SYSTEM',
        });
        const updated = await tx.purchaseInvoice.update({
            where: { id },
            data: {
                status: STATUS.APPROVED,
                reviewedAt: new Date(),
                reviewedBy: actor?.id || 'SYSTEM',
                journalEntryId: persisted ? persisted.id : null,
            },
        });
        return { updated, persisted };
    });

    await safeAudit(
        'PURCHASE_INVOICE_APPROVED',
        AuditSeverity.INFO,
        actor,
        `PURCHASE_INVOICE:${result.updated.id}`,
        {
            invoiceNumber: result.updated.invoiceNumber,
            // PDPA close-natid-round4 — store the MASKED TIN in audit metadata,
            // mirroring the CREATE audit twin at ~:533. audit_logs.metadata has
            // no PDPA encrypt hook by design, so the raw 13-digit TIN would be a
            // plaintext dump-readable national ID. (When ENABLE_PDPA_FIELD_
            // ENCRYPTION is ON, `result.updated.supplierTaxId` is the DECRYPTED
            // plaintext returned by the extension's read walker — so masking here
            // is what keeps the at-rest audit row leak-free.) maskThaiId keeps the
            // trail useful (last 4) without the leak — matches the covered-set
            // audit convention.
            supplierTaxId: maskThaiId(result.updated.supplierTaxId),
            subtotal, vat, totalAmount: total,
            journalEntryId: result.persisted ? result.persisted.id : null,
        },
    );

    logger.info(
        `[purchase-invoice][journal] ${result.updated.invoiceNumber} APPROVED — `
        + `Dr Input VAT ${vat} / Dr Expense ${subtotal} / `
        + `Cr ${row.paidAt ? 'Cash' : 'AP'} ${total} — journalEntryId=`
        + `${result.persisted?.id || 'NULL'}`,
    );

    return result.updated;
}

/**
 * Reject a PENDING_REVIEW PurchaseInvoice. Terminal — the submitter
 * must create a fresh row to retry.
 */
async function rejectPurchaseInvoice(id, { reason, actor } = {}) {
    if (!id) {
        throw makeError('VALIDATION_ERROR', 'id is required');
    }
    if (typeof reason !== 'string' || reason.trim().length < 3) {
        throw makeError(
            'INVALID_REASON',
            'rejection reason is required (min 3 chars)',
        );
    }
    const prisma = resolvePrisma();
    if (!prisma) {
        throw makeError('DB_UNAVAILABLE', 'Prisma client unavailable', 503);
    }

    const row = await prisma.purchaseInvoice.findUnique({ where: { id } });
    if (!row) {
        throw makeError('PURCHASE_INVOICE_NOT_FOUND', 'Purchase invoice not found', 404);
    }
    assertWriteAccess(actor, row);

    if (!ALLOWED_TRANSITIONS[row.status]?.has(STATUS.REJECTED)) {
        throw makeError(
            'INVALID_TRANSITION',
            `Cannot reject purchase invoice from status ${row.status}`,
            409,
        );
    }

    const updated = await prisma.purchaseInvoice.update({
        where: { id },
        data: {
            status: STATUS.REJECTED,
            reviewedAt: new Date(),
            reviewedBy: actor?.id || 'SYSTEM',
            rejectionReason: reason.trim(),
        },
    });

    await safeAudit(
        'PURCHASE_INVOICE_REJECTED',
        AuditSeverity.WARNING,
        actor,
        `PURCHASE_INVOICE:${updated.id}`,
        {
            invoiceNumber: updated.invoiceNumber,
            rejectionReason: reason.trim(),
        },
    );

    logger.info(
        `[purchase-invoice] ${updated.invoiceNumber} REJECTED — `
        + `reason: ${reason.trim()}`,
    );

    return updated;
}

/**
 * Mark an APPROVED purchase invoice as paid (records settlement date).
 * Does NOT change status — the Input VAT claim event and the cash
 * settlement event are separate (the claim was already recognised at
 * approval time per ม.83/8). This call is purely a bookkeeping marker
 * so AP aging reports can reconcile.
 */
async function markAsPaid(id, { paidAt, actor } = {}) {
    if (!id) {
        throw makeError('VALIDATION_ERROR', 'id is required');
    }
    const prisma = resolvePrisma();
    if (!prisma) {
        throw makeError('DB_UNAVAILABLE', 'Prisma client unavailable', 503);
    }

    const row = await prisma.purchaseInvoice.findUnique({ where: { id } });
    if (!row) {
        throw makeError('PURCHASE_INVOICE_NOT_FOUND', 'Purchase invoice not found', 404);
    }
    assertWriteAccess(actor, row);

    if (row.status !== STATUS.APPROVED) {
        throw makeError(
            'INVALID_TRANSITION',
            `Cannot mark-as-paid from status ${row.status} (only APPROVED rows can be paid)`,
            409,
        );
    }
    if (row.paidAt) {
        throw makeError(
            'ALREADY_PAID',
            `Purchase invoice ${row.invoiceNumber} is already marked paid (${row.paidAt.toISOString()})`,
            409,
        );
    }

    const settlement = paidAt ? new Date(paidAt) : new Date();

    const updated = await prisma.purchaseInvoice.update({
        where: { id },
        data: {
            paidAt: settlement,
            paidBy: actor?.id || 'SYSTEM',
        },
    });

    await safeAudit(
        'PURCHASE_INVOICE_PAID',
        AuditSeverity.INFO,
        actor,
        `PURCHASE_INVOICE:${updated.id}`,
        {
            invoiceNumber: updated.invoiceNumber,
            paidAt: settlement,
            totalAmount: Number(updated.totalAmount),
        },
    );

    logger.info(
        `[purchase-invoice] ${updated.invoiceNumber} marked as paid `
        + `at ${settlement.toISOString()} by ${actor?.id || 'SYSTEM'}`,
    );

    return updated;
}

/**
 * List purchase invoices with filters.
 *
 * @param {object} args
 * @param {string} [args.status]              one of STATUS values
 * @param {Date|string} [args.dateRange.from]  invoiceDate >=
 * @param {Date|string} [args.dateRange.to]    invoiceDate <
 * @param {string} [args.organizationId]
 * @param {object} args.actor
 */
async function listPurchaseInvoices({
    status, dateRange, organizationId, actor,
} = {}) {
    assertReadAccess(actor);
    const prisma = resolvePrisma();
    if (!prisma) {return [];}

    const where = { isDeleted: false };
    if (status) {
        if (!Object.values(STATUS).includes(status)) {
            throw makeError(
                'INVALID_STATUS',
                `status must be one of: ${Object.values(STATUS).join(', ')}`,
            );
        }
        where.status = status;
    }
    // Tenant scoping (S3 — security review 2026-09-27): a caller-supplied
    // organizationId is honoured for system_admin_dtam only; everyone else is
    // pinned to their own organization, and a caller with none is refused.
    // Mirrors credit-note-service / debit-note-service list scoping.
    if (normalizeRole(actor?.canonicalRole || actor?.role) === CANONICAL_ROLES.SYSTEM_ADMIN_DTAM) {
        if (organizationId) { where.organizationId = organizationId; }
    } else {
        if (!actor?.organizationId) {
            throw makeError('FORBIDDEN_TENANT', 'Organization context required', 403);
        }
        where.organizationId = actor.organizationId;
    }
    if (dateRange && (dateRange.from || dateRange.to)) {
        where.invoiceDate = {};
        if (dateRange.from) {where.invoiceDate.gte = new Date(dateRange.from);}
        if (dateRange.to)   {where.invoiceDate.lt  = new Date(dateRange.to);}
    }

    return prisma.purchaseInvoice.findMany({
        where,
        orderBy: { invoiceDate: 'desc' },
    });
}

async function findPurchaseInvoiceById(id, { actor } = {}) {
    assertReadAccess(actor);
    const prisma = resolvePrisma();
    if (!prisma) {return null;}
    const row = await prisma.purchaseInvoice.findUnique({ where: { id } });
    if (!row) {return null;}
    const role = normalizeRole(actor?.canonicalRole || actor?.role);
    // Non-admin: the caller's own organization only, and a caller with none is
    // refused (fail closed — L3). field_inspector no longer reads finance data
    // at all (operator 2026-09-27), so its cross-tenant exemption is gone.
    if (role !== CANONICAL_ROLES.SYSTEM_ADMIN_DTAM
        && (!actor?.organizationId
            || (row.organizationId && actor.organizationId !== row.organizationId))) {
        throw makeError('FORBIDDEN_TENANT', 'Cross-tenant read denied', 403);
    }
    return row;
}

module.exports = {
    STATUS,
    VALID_CATEGORIES,
    ALLOWED_TRANSITIONS,
    WRITE_ROLES,
    READ_ROLES,
    ACCOUNTS,
    CATEGORY_TO_EXPENSE,
    createPurchaseInvoice,
    approvePurchaseInvoice,
    rejectPurchaseInvoice,
    markAsPaid,
    listPurchaseInvoices,
    findPurchaseInvoiceById,
    // Exposed for tests + future input-VAT report integration.
    _internals: {
        round2,
        isValidThaiTaxId,
        assertTotalsBalance,
        buildInputVatEntryLines,
        persistInputVatEntry,
    },
};
