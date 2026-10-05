/**
 * PaymentService
 * Handles payment processing for GACP certification applications
 *
 * Payment Rules:
 * 1. Initial Submission: 5,000 THB state fee + platform fee + VAT (Phase 1)
 * 2. Field Audit: 25,000 THB state fee + platform fee + VAT (Phase 2 —
 *    minted by the DOC_APPROVED auto-chain, settled through the slip flow)
 * 3. Resubmission: Phase-1 fee again when a revision deadline expires
 *
 * Wave 0 purge (docs/payment-refactor/legacy-payment-audit.md): the
 * gateway-era webhook surface that used to live here — handleWebhook /
 * handlePaymentSuccess / handlePaymentFailure / verifyWebhookSignature,
 * payment-service-webhook-flow.js, payment-legacy-service.js and
 * payment-webhook-service.js — was removed. No route mounted any of it since
 * the 2026-04-29 slip-flow cutover; the canonical PENDING → PAID transition
 * is `payment-slip-service.js` (approveSlip). The single-checkout redesign
 * will introduce a NEW signed PSP callback rather than resurrecting that
 * lineage.
 *
 * @module services/payment
 * @version 3.0.0
 */

const { prisma } = require('./prisma-database');
const feeService = require('./fee-service');
const {
  computePhaseSettlement,
  flattenRequiredInvoices,
} = require('./phase-billing-service');

const logger = require('../shared/logger');

// Shared constants (extracted to break circular deps)
const {
  CONFIG,
  PAYMENT_TYPES,
  PAYMENT_STATUS,
  PAYMENT_METHODS,
} = require('./payment-constants');

const {
  generateSecureIdFragment,
  asArray,
  buildWorkflowEvent,
} = require('./payment-utils');

// Lazy: holder-access pulls the permission engine; payment-service is required
// early by many rails.
const holderAccess = () => require('./holder-access');

/**
 * The invoices of one application. A health door passes `options.holderScope`:
 * the read then carries the holder fragment beside `applicationId` (the
 * application the door's gate already authorised). Staff, jobs and the webhook
 * pass nothing and keep their where byte for byte.
 */
async function getInvoiceSettlementsForApplication(applicationId, options = {}) {
  const invoices = await prisma.invoice.findMany({
    where: {
      applicationId,
      isDeleted: false,
      ...holderAccess().holderReadWhereIfScoped(options.holderScope, 'Invoice'),
    },
    select: {
      id: true,
      invoiceNumber: true,
      serviceType: true,
      status: true,
      totalAmount: true,
      paidAt: true,
      receiptIssuedAt: true,
      receiptNumber: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const phase1 = computePhaseSettlement(invoices, 'PHASE_1');
  const phase2 = computePhaseSettlement(invoices, 'PHASE_2');

  return {
    invoices,
    phase1,
    phase2,
    requiredInvoices: {
      phase1: flattenRequiredInvoices(phase1),
      phase2: flattenRequiredInvoices(phase2),
    },
  };
}

function getLatestPaidTimestamp(settlement) {
  const paidAtValues = [
    settlement?.state?.invoice?.paidAt,
    settlement?.platform?.invoice?.paidAt,
  ]
    .map((value) => (value ? new Date(value) : null))
    .filter((value) => value && Number.isFinite(value.getTime()));

  if (paidAtValues.length === 0) {
    return null;
  }
  paidAtValues.sort((left, right) => right.getTime() - left.getTime());
  return paidAtValues[0];
}

async function syncPhaseStatusesFromInvoices(applicationId, options = {}) {
  // A health door passes its holder scope: the read is findFirst({ id, ...fragment }),
  // the one row the door's gate authorised. No scope (staff, jobs, webhook) →
  // findUnique({ id }) as before.
  const scoped = holderAccess().holderReadWhereIfScoped(options.holderScope, 'Application');
  const read = Object.keys(scoped).length > 0
    ? (args) => prisma.application.findFirst({ ...args, where: { id: applicationId, ...scoped } })
    : (args) => prisma.application.findUnique(args);
  const application = await read({
    where: { id: applicationId },
    select: {
      id: true,
      phase1Status: true,
      phase2Status: true,
      phase1PaidAt: true,
      phase2PaidAt: true,
    },
  });
  if (!application) {
    return null;
  }

  const settlements = await getInvoiceSettlementsForApplication(applicationId, options);
  const phase1Paid = settlements.phase1.phasePaid;
  const phase2Paid = settlements.phase2.phasePaid;
  const phase1PaidAt = getLatestPaidTimestamp(settlements.phase1);
  const phase2PaidAt = getLatestPaidTimestamp(settlements.phase2);

  const updateData = {};
  if (phase1Paid && String(application.phase1Status || '').toUpperCase() !== 'PAID') {
    updateData.phase1Status = 'PAID';
  }
  if (phase2Paid && String(application.phase2Status || '').toUpperCase() !== 'PAID') {
    updateData.phase2Status = 'PAID';
  }
  if (phase1Paid && !application.phase1PaidAt && phase1PaidAt) {
    updateData.phase1PaidAt = phase1PaidAt;
  }
  if (phase2Paid && !application.phase2PaidAt && phase2PaidAt) {
    updateData.phase2PaidAt = phase2PaidAt;
  }

  if (Object.keys(updateData).length > 0) {
    await prisma.application.update({
      where: { id: applicationId },
      data: updateData,
    });
  }

  return {
    phase1Paid,
    phase2Paid,
    settlements,
  };
}

// ── Phase-1 payment initiation ──
const { createPhaseFlow } = require('./payment-service-phase-flow');
// GAP-5 (2026-07-08): frozen price-of-record reader — the phase-payment writer
// copies the accepted-quote amounts when present instead of recomputing from
// (mutable) formData. quotation-service has no cycle back to payment-service.
const { getFrozenPhaseFees } = require('./quotation-service');

const { createPhase1Payment } = createPhaseFlow({
  prisma,
  feeService,
  CONFIG,
  generateSecureIdFragment,
  asArray,
  buildWorkflowEvent,
  syncPhaseStatusesFromInvoices,
  getInvoiceSettlementsForApplication,
  logger,
  getFrozenPhaseFees,
});

// EXPORTS

module.exports = {
  // Constants
  CONFIG,
  PAYMENT_TYPES,
  PAYMENT_STATUS,
  PAYMENT_METHODS,

  // ── Canonical phase-flow surface ──
  // Creates the PENDING invoices (gateway='BANK_TRANSFER'). The
  // PENDING → PAID transition happens through `payment-slip-service.js`
  // (approveSlip), NOT here. Phase 2 is minted by the DOC_APPROVED
  // auto-chain (workflow-side-effects.js), not by a payment-create call.
  createPhase1Payment,
  syncPhaseStatusesFromInvoices,
  getInvoiceSettlementsForApplication,
};
