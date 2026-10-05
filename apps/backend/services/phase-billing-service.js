// The ONLY place process.env is read is config/stripe.js; this module asks
// the accessor, never the environment (ratchet: env-direct).

const LEGACY_SERVICE_TYPES = Object.freeze({
  PHASE_1_STATE: 'APPLICATION_FEE',
  PHASE_2_STATE: ['AUDIT_FEE', 'PHASE_2_AUDIT', 'PHASE2_AUDIT'],
});

const CANONICAL_SERVICE_TYPES = Object.freeze({
  PHASE_1_STATE_FEE: 'PHASE_1_STATE_FEE',
  PHASE_1_PLATFORM_FEE: 'PHASE_1_PLATFORM_FEE',
  PHASE_2_STATE_FEE: 'PHASE_2_STATE_FEE',
  PHASE_2_PLATFORM_FEE: 'PHASE_2_PLATFORM_FEE',
});

const STATUS = Object.freeze({
  PENDING: 'PENDING',
  PAID_PENDING_RECEIPT: 'PAID_PENDING_RECEIPT',
  RECEIPT_ISSUED: 'RECEIPT_ISSUED',
});

function normalizeUpper(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeInvoiceServiceType(serviceType) {
  const normalized = normalizeUpper(serviceType);
  if (!normalized) {
    return null;
  }

  if (normalized === LEGACY_SERVICE_TYPES.PHASE_1_STATE) {
    return CANONICAL_SERVICE_TYPES.PHASE_1_STATE_FEE;
  }

  if (LEGACY_SERVICE_TYPES.PHASE_2_STATE.includes(normalized)) {
    return CANONICAL_SERVICE_TYPES.PHASE_2_STATE_FEE;
  }

  if (Object.values(CANONICAL_SERVICE_TYPES).includes(normalized)) {
    return normalized;
  }

  return normalized;
}

function getCanonicalServiceTypeForComponent(phase, component) {
  const normalizedPhase = normalizeUpper(phase);
  const normalizedComponent = normalizeUpper(component);

  if (normalizedPhase === 'PHASE_1' && normalizedComponent === 'STATE') {
    return CANONICAL_SERVICE_TYPES.PHASE_1_STATE_FEE;
  }
  if (normalizedPhase === 'PHASE_1' && normalizedComponent === 'PLATFORM') {
    return CANONICAL_SERVICE_TYPES.PHASE_1_PLATFORM_FEE;
  }
  if (normalizedPhase === 'PHASE_2' && normalizedComponent === 'STATE') {
    return CANONICAL_SERVICE_TYPES.PHASE_2_STATE_FEE;
  }
  if (normalizedPhase === 'PHASE_2' && normalizedComponent === 'PLATFORM') {
    return CANONICAL_SERVICE_TYPES.PHASE_2_PLATFORM_FEE;
  }
  return null;
}

function getServiceTypesForPhaseComponent(phase, component) {
  const normalizedPhase = normalizeUpper(phase);
  const normalizedComponent = normalizeUpper(component);

  if (normalizedPhase === 'PHASE_1' && normalizedComponent === 'STATE') {
    return [
      CANONICAL_SERVICE_TYPES.PHASE_1_STATE_FEE,
      LEGACY_SERVICE_TYPES.PHASE_1_STATE,
    ];
  }

  if (normalizedPhase === 'PHASE_1' && normalizedComponent === 'PLATFORM') {
    return [CANONICAL_SERVICE_TYPES.PHASE_1_PLATFORM_FEE];
  }

  if (normalizedPhase === 'PHASE_2' && normalizedComponent === 'STATE') {
    return [
      CANONICAL_SERVICE_TYPES.PHASE_2_STATE_FEE,
      ...LEGACY_SERVICE_TYPES.PHASE_2_STATE,
    ];
  }

  if (normalizedPhase === 'PHASE_2' && normalizedComponent === 'PLATFORM') {
    return [CANONICAL_SERVICE_TYPES.PHASE_2_PLATFORM_FEE];
  }

  return [];
}

function describeServiceType(serviceType) {
  const normalized = normalizeInvoiceServiceType(serviceType);
  switch (normalized) {
    case CANONICAL_SERVICE_TYPES.PHASE_1_STATE_FEE:
      return 'Phase 1 state fee';
    case CANONICAL_SERVICE_TYPES.PHASE_1_PLATFORM_FEE:
      return 'Phase 1 platform fee';
    case CANONICAL_SERVICE_TYPES.PHASE_2_STATE_FEE:
      return 'Phase 2 state fee';
    case CANONICAL_SERVICE_TYPES.PHASE_2_PLATFORM_FEE:
      return 'Phase 2 platform fee';
    default:
      return 'Service fee';
  }
}

function isInvoicePaidStatus(status) {
  const normalized = normalizeUpper(status);
  return ['PAID', STATUS.PAID_PENDING_RECEIPT, STATUS.RECEIPT_ISSUED].includes(normalized);
}

function isInvoiceReceiptIssued(invoice) {
  if (!invoice || typeof invoice !== 'object') {
    return false;
  }

  if (normalizeUpper(invoice.status) === STATUS.RECEIPT_ISSUED) {
    return true;
  }

  return !!invoice.receiptIssuedAt || !!invoice.receiptNumber;
}

function selectLatestInvoice(candidates) {
  const list = Array.isArray(candidates) ? [...candidates] : [];
  list.sort((left, right) => {
    const leftTime = new Date(left?.createdAt || left?.updatedAt || 0).getTime();
    const rightTime = new Date(right?.createdAt || right?.updatedAt || 0).getTime();
    return rightTime - leftTime;
  });
  return list[0] || null;
}

/**
 * The ONE invoice the checkout rail mints for a phase.
 *
 * `stripe-checkout-service.js:88` names it `CERTIFICATION_CHECKOUT_${milestone}`
 * with M1 = phase 1 and M2 = phase 2. It is in neither the STATE nor the PLATFORM
 * bucket below, and that is not an oversight to correct there: under W14
 * (2026-08-22) the company is the only issuer and ONE invoice is the whole
 * ค่าบริการ. There is no sibling, and waiting for one strands the filing.
 */
function checkoutServiceTypeForPhase(phase) {
  return normalizeUpper(phase) === 'PHASE_2'
    ? 'CERTIFICATION_CHECKOUT_M2'
    : 'CERTIFICATION_CHECKOUT_M1';
}

function computePhaseSettlement(invoices, phase) {
  const source = Array.isArray(invoices) ? invoices : [];
  const stateTypes = getServiceTypesForPhaseComponent(phase, 'STATE').map(normalizeUpper);
  const platformTypes = getServiceTypesForPhaseComponent(phase, 'PLATFORM').map(normalizeUpper);

  const stateInvoices = source.filter((invoice) => stateTypes.includes(normalizeUpper(invoice?.serviceType)));
  const platformInvoices = source.filter((invoice) => platformTypes.includes(normalizeUpper(invoice?.serviceType)));

  const stateInvoice = selectLatestInvoice(stateInvoices);
  const platformInvoice = selectLatestInvoice(platformInvoices);

  const hasLegacyStateOnly = !!stateInvoice
    && !platformInvoice
    && normalizeUpper(stateInvoice.serviceType) !== normalizeUpper(
      phase === 'PHASE_1'
        ? CANONICAL_SERVICE_TYPES.PHASE_1_STATE_FEE
        : CANONICAL_SERVICE_TYPES.PHASE_2_STATE_FEE,
    );

  const statePaid = !!stateInvoice && isInvoicePaidStatus(stateInvoice.status);
  const platformPaid = !!platformInvoice && isInvoicePaidStatus(platformInvoice.status);

  const stateReceiptIssued = !!stateInvoice && isInvoiceReceiptIssued(stateInvoice);
  const platformReceiptIssued = !!platformInvoice && isInvoiceReceiptIssued(platformInvoice);

  // The checkout rail's single invoice for this phase, if the application is on it.
  const checkoutInvoice = selectLatestInvoice(
    source.filter((invoice) => normalizeUpper(invoice?.serviceType) === checkoutServiceTypeForPhase(phase)),
  );
  const checkoutPaid = !!checkoutInvoice && isInvoicePaidStatus(checkoutInvoice.status);

  // A phase can be collected two ways, and they are read in the order the data
  // makes them true — never blended:
  //
  //   the legacy pair          both sides paid (or a lone legacy state invoice)
  //   the checkout rail        its one invoice paid
  //
  // The legacy answer is consulted FIRST, so an application that genuinely holds a
  // half-paid pair is not waved through by a checkout row that happens to sit
  // beside it. Only when the legacy shape says nothing — no state invoice at all,
  // which is exactly what the checkout rail leaves — does the single invoice speak.
  const legacyPhasePaid = stateInvoice
    ? (platformInvoice
      ? statePaid && platformPaid
      : (hasLegacyStateOnly ? statePaid : false))
    : false;

  const phasePaid = stateInvoice ? legacyPhasePaid : checkoutPaid;

  const phaseReceiptIssued = stateInvoice
    ? (platformInvoice
      ? stateReceiptIssued && platformReceiptIssued
      : (hasLegacyStateOnly ? stateReceiptIssued : false))
    : false;

  return {
    phase: normalizeUpper(phase),
    state: {
      invoice: stateInvoice,
      status: normalizeUpper(stateInvoice?.status || 'MISSING'),
      isPaid: statePaid,
      receiptIssued: stateReceiptIssued,
    },
    platform: {
      invoice: platformInvoice,
      status: normalizeUpper(platformInvoice?.status || (hasLegacyStateOnly ? 'LEGACY_NOT_REQUIRED' : 'MISSING')),
      isPaid: hasLegacyStateOnly ? true : platformPaid,
      receiptIssued: hasLegacyStateOnly ? true : platformReceiptIssued,
    },
    hasLegacyStateOnly,
    phasePaid,
    phaseReceiptIssued,
  };
}

/**
 * Split (STATE + PLATFORM) invoicing is retired. Permanently, and not by a flag.
 *
 * This used to be `return isStripeCheckoutEnabled()`, which is a single equality
 * test against the STRIPE_CHECKOUT_ENABLED environment variable — so ONE setting
 * decided two unrelated things: whether the payment GATEWAY was available, and
 * which ACCOUNTING MODEL the company used. Leave it unset, which is the default
 * anywhere nobody has said otherwise, and the platform reverted to minting the
 * retired STATE/PLATFORM pair whose STATE half the journal layer then refused to
 * book at all. Cash in the bank, no entry, and the refusal recorded as a skip
 * rather than an error.
 *
 * Whether a gateway is configured is properly an environment decision, and the
 * checkout door still answers 503 without one. How the company recognises its
 * revenue is not. Operator, 2026-09-05: "ผมจะลบแบบที่ไม่ถูกต้องออกทั้งหมดแล้วแทนค่า
 * หรือทำสิ่งที่ถูกต้องเท่านั้น."
 *
 * Kept as a function rather than deleted outright so the call sites that ask it
 * — and the tests that exercise both answers — keep reading naturally while the
 * now-unreachable split branches are removed.
 */
function isPhaseSplitInvoicingRetired() {
  return true;
}

function flattenRequiredInvoices(settlement) {
  const required = [];
  if (settlement?.state?.invoice) {
    required.push({
      component: 'STATE',
      serviceType: settlement.state.invoice.serviceType,
      invoiceId: settlement.state.invoice.id,
      invoiceNumber: settlement.state.invoice.invoiceNumber,
      status: settlement.state.status,
      isPaid: settlement.state.isPaid,
      amount: settlement.state.invoice.totalAmount,
    });
  }

  if (settlement?.platform?.invoice) {
    required.push({
      component: 'PLATFORM',
      serviceType: settlement.platform.invoice.serviceType,
      invoiceId: settlement.platform.invoice.id,
      invoiceNumber: settlement.platform.invoice.invoiceNumber,
      status: settlement.platform.status,
      isPaid: settlement.platform.isPaid,
      amount: settlement.platform.invoice.totalAmount,
    });
  }

  return required;
}

module.exports = {
  LEGACY_SERVICE_TYPES,
  CANONICAL_SERVICE_TYPES,
  STATUS,
  normalizeInvoiceServiceType,
  getCanonicalServiceTypeForComponent,
  getServiceTypesForPhaseComponent,
  describeServiceType,
  isInvoicePaidStatus,
  isInvoiceReceiptIssued,
  computePhaseSettlement,
  flattenRequiredInvoices,
  isPhaseSplitInvoicingRetired,
};
