const { prisma } = require('../../../services/prisma-database');
const phaseBillingService = require('../../../services/phase-billing-service');
const {
  getServiceTypesForPhaseComponent,
  isInvoicePaidStatus,
} = phaseBillingService;
// F-G4-51 read side: the ONE checkout invoice per milestone is minted by
// services/checkout/stripe-checkout-service.js. Its serviceType is asked from
// the minter itself, never re-typed here, so reader and writer cannot drift.
const { checkoutInvoiceServiceType } = require('../../../services/checkout/stripe-checkout-service');
// The two payment gates' names come from the checkout lifecycle SSOT.
const { MILESTONES } = require('../../../shared/checkout-status');


// ป้ายใน notes ที่ใช้ค้นใบเสนอราคาของงวดที่ 1 บนหน้าตรวจทาน · ตั้งแต่ 2026-09-11
// ไม่มีฝั่งเขียนแล้ว (ตัวมินต์ถูกลบไปพร้อมการแยกใบ) เหลือแต่ฝั่งอ่านที่ยังต้องรู้จักป้ายเก่า
// เพื่อหาแถวที่เคยถูกสร้างไว้ก่อนหน้า — เดิมคอมเมนต์นี้อธิบายว่า writer กับ reader ต้อง
// reader would silently miss rows the writer created — shared consts instead
// of two independently-typed string literals so they cannot drift. They sit in
// their own dependency-free module so a reader that only needs the tags (the
// C05 walk) need not load this file's prisma client to learn them.
const {
  PHASE1_STATE_PREVIEW_TAG,
  PHASE1_PLATFORM_PREVIEW_TAG,
} = require('./preview-legacy-doc-tags');





/**
 * R1-legacy-pin: removed in Task 12 (→ holderReadWhere). The applicant preview
 * passes its holder scope; the application its gate resolved decides, as pre-R1.
 */
function r1Scoped(holderScope, model, applicationId) {
  return require('../../../services/holder-access')
    .r1HolderOrLegacyWhenScoped(holderScope, model, { applicationId });
}

/**
 * The phase-1 quote/invoice rows of the retired per-side pair, for the applicant
 * preview — READ-ONLY, no create/update. The preview GET writes nothing in any
 * state (P-GET, 2026-09-30); its writing twin, ensurePhase1FinancialDocuments,
 * was deleted 2026-10-02 (M5) once it had become a pass-through to this reader.
 * Lookup keys: serviceType for invoices, the notesTag substring for quotes.
 */
async function readPhase1FinancialDocuments(application, { holderScope = null } = {}) {
  const appId = String(application?.id || '').trim();
  if (!appId) {
    return {
      quote: null,
      invoice: null,
      phase1: {
        state: { quote: null, invoice: null },
        platform: { quote: null, invoice: null },
      },
    };
  }

  const [stateInvoice, platformInvoice] = await Promise.all([
    prisma.invoice.findFirst({
      where: {
        applicationId: appId,
        serviceType: { in: getServiceTypesForPhaseComponent('PHASE_1', 'STATE') },
        isDeleted: false,
        ...r1Scoped(holderScope, 'Invoice', appId),
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.invoice.findFirst({
      where: {
        applicationId: appId,
        serviceType: { in: getServiceTypesForPhaseComponent('PHASE_1', 'PLATFORM') },
        isDeleted: false,
        ...r1Scoped(holderScope, 'Invoice', appId),
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const [stateQuote, platformQuote] = await Promise.all([
    prisma.quote.findFirst({
      where: {
        applicationId: appId,
        isDeleted: false,
        notes: { contains: PHASE1_STATE_PREVIEW_TAG },
        ...r1Scoped(holderScope, 'Quote', appId),
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.quote.findFirst({
      where: {
        applicationId: appId,
        isDeleted: false,
        notes: { contains: PHASE1_PLATFORM_PREVIEW_TAG },
        ...r1Scoped(holderScope, 'Quote', appId),
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return {
    quote: toQuoteSummary(stateQuote),
    invoice: toInvoiceSummary(stateInvoice),
    phase1: {
      state: {
        quote: toQuoteSummary(stateQuote),
        invoice: toInvoiceSummary(stateInvoice),
      },
      platform: {
        quote: toQuoteSummary(platformQuote),
        invoice: toInvoiceSummary(platformInvoice),
      },
    },
  };
}

function toQuoteSummary(quote) {
  if (!quote) {
    return null;
  }
  return {
    id: quote.id,
    quoteNumber: quote.quoteNumber,
    status: quote.status,
    validUntil: quote.validUntil,
  };
}

function toInvoiceSummary(invoice) {
  if (!invoice) {
    return null;
  }
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    dueDate: invoice.dueDate,
    totalAmount: invoice.totalAmount,
    serviceType: invoice.serviceType,
  };
}

/**
 * F-G4-51 — read-only lens over the checkout rail for the applicant preview.
 *
 * Under F-G4-35 the per-side PHASE_1 quote/invoice pair is retired, so
 * readPhase1FinancialDocuments answers all-null and the preview page's four
 * legacy slots would stay empty forever. What the applicant actually pays is
 * the ONE CERTIFICATION_CHECKOUT_Mx invoice per milestone. This summarises the
 * invoice rows the preview route already loaded: pure, no query, no write.
 *
 * The live invariant is ONE ACTIVE row per (application, serviceType) — the
 * partial unique index uniq_invoice_app_service_active. History is what makes a
 * milestone carry more than one row: a cancelled or expired attempt sits next
 * to the row that was actually paid, and a re-entered checkout mints a fresh
 * order + invoice. So the tie-break covers history, not concurrency: a PAID row
 * always beats an unpaid/cancelled one, and createdAt only decides between rows
 * of equal payment standing.
 */
const CHECKOUT_MILESTONE_BY_PHASE = Object.freeze({
  // The milestone vocabulary is the checkout SSOT's, never re-typed here:
  // shared/checkout-status.js MILESTONES = ['M1', 'M2'] (Wave 1 design v2).
  phase1: MILESTONES[0],
  phase2: MILESTONES[1],
});

function normalizeServiceType(value) {
  return String(value || '').trim().toUpperCase();
}

function createdAtMillis(invoice) {
  const value = invoice?.createdAt;
  if (!value) {
    return 0;
  }
  const millis = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(millis) ? 0 : millis;
}

/**
 * Which of two rows of the same milestone is the one the applicant lives with?
 * A row whose money moved always wins: a cancelled attempt minted AFTER the
 * paid one (re-entry, then abandonment) must never be able to tell a farmer
 * their settled phase is unpaid. Only between rows of equal payment standing
 * does the newer row win.
 */
function outranksCheckoutRow(candidate, current) {
  const candidatePaid = isInvoicePaidStatus(candidate?.status);
  const currentPaid = isInvoicePaidStatus(current?.status);
  if (candidatePaid !== currentPaid) {
    return candidatePaid;
  }
  return createdAtMillis(candidate) >= createdAtMillis(current);
}

function selectCheckoutInvoiceOfServiceType(invoices, serviceType) {
  const wanted = normalizeServiceType(serviceType);
  let selected = null;
  for (const invoice of invoices) {
    if (normalizeServiceType(invoice?.serviceType) !== wanted) {
      continue;
    }
    if (!selected || outranksCheckoutRow(invoice, selected)) {
      selected = invoice;
    }
  }
  return selected;
}

/**
 * An amount the row does not carry is UNKNOWN, not zero: `Number(x || 0)`
 * printed "฿0" at an applicant for a row whose total was simply absent. A
 * genuine 0 stays 0 — only absence (and an unreadable value) becomes null, and
 * the page then renders no amount row at all.
 */
function toCheckoutAmount(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function toCheckoutSummary(invoice) {
  if (!invoice) {
    return null;
  }
  return {
    invoiceNumber: invoice.invoiceNumber || null,
    status: invoice.status || null,
    isPaid: isInvoicePaidStatus(invoice.status),
    paidAt: invoice.paidAt || null,
    receiptNumber: invoice.receiptNumber || null,
    receiptIssuedAt: invoice.receiptIssuedAt || null,
    totalAmount: toCheckoutAmount(invoice.totalAmount),
  };
}

function summarizeCheckoutInvoices(invoices) {
  const rows = Array.isArray(invoices) ? invoices : [];
  const summary = {};
  for (const [phase, milestone] of Object.entries(CHECKOUT_MILESTONE_BY_PHASE)) {
    summary[phase] = toCheckoutSummary(
      selectCheckoutInvoiceOfServiceType(rows, checkoutInvoiceServiceType(milestone)),
    );
  }
  return summary;
}

/**
 * B-F1 — one answer to "is this phase paid?", across both billing rails.
 *
 * computePhaseSettlement can only see the retired PHASE_x split service types
 * (phase-billing-service.js:139-194). On an application minted under the
 * checkout rail those rows do not exist, so it answers phasePaid=false forever
 * and the preview told an applicant whose M1 money had already settled that
 * their next required action was still PAY_PHASE_1 — asking a farmer to pay
 * twice. The two rails answer the same question about the same phase, so the
 * page reads their OR: whichever rail the money actually moved on counts.
 *
 * Pure: takes the settlement object and the milestone's checkout summary,
 * touches no database and no clock.
 */
function derivePhasePaymentState({ settlement, checkout } = {}) {
  return {
    paid: Boolean(settlement?.phasePaid) || Boolean(checkout?.isPaid),
    receiptIssued: Boolean(settlement?.phaseReceiptIssued) || Boolean(checkout?.receiptNumber),
  };
}

/**
 * Get Preview Data for Application
 * GET /api/applications/:id/preview
 *
 * Returns summary of all data for review before payment
 */

module.exports = {
  readPhase1FinancialDocuments,
  summarizeCheckoutInvoices,
  derivePhasePaymentState,
  // Re-exported so a caller holding this module already has the tags; the
  // dependency-free source is ./preview-legacy-doc-tags.
  PHASE1_STATE_PREVIEW_TAG,
  PHASE1_PLATFORM_PREVIEW_TAG,
};
