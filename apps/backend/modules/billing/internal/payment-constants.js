/**
 * Payment Constants — Shared between payment-service.js and payment-legacy-service.js
 *
 * Extracted to break a circular dependency:
 *   payment-service.js → payment-legacy-service.js → payment-service.js (for constants)
 *
 * --------------------------------------------------------------------------
 * NAMING NOTE (2026-04-28, billing follow-ups PR):
 *
 * The fields below describe the per-scope STATE (government) fee rate, NOT the
 * full Application.phase1Amount / phase2Amount column value.
 *
 * Per the canonical-billing-amount fix (`fix/phase-amount-caller-canonical-
 * semantics`), `Application.phase1Amount` / `Application.phase2Amount` are now
 * canonically the FULL phase total (state fee + 10% platform fee + 7% VAT on
 * platform), sourced exclusively from `feeService.calculatePhase1Fee().total`.
 *
 * To avoid name collisions / readers guessing wrong, these constants were
 * renamed:
 *   phase1Amount        -> phase1StateRatePerScope
 *   phase2Amount        -> phase2StateRatePerScope
 *
 * If you need the column-equivalent FULL phase total in code, call
 * `feeService.calculatePhase1Fee(...).total`.
 * --------------------------------------------------------------------------
 *
 * @module modules/billing/internal/payment-constants
 *
 * Phase A6 §A6-2 (2026-04-29): file moved from
 *   apps/backend/services/payment-constants.js
 * to
 *   apps/backend/modules/billing/internal/payment-constants.js
 *
 * The thin re-export shim still at services/payment-constants.js keeps
 * existing consumers working. Public API exposed via modules/billing.
 */

const { FEES, PAYMENT: PAYMENT_RULES } = require('../../../config/business-rules');

// Configuration — sourced from config/business-rules.js
// IMPORTANT: phase{1,2}StateRatePerScope = state-only fee per scope (5000/25000),
// NOT the full Application.phase{1,2}Amount column value (5535/27675).
const CONFIG = {
  phase1StateRatePerScope: FEES.PHASE1_PER_SCOPE,
  phase2StateRatePerScope: FEES.PHASE2_PER_SCOPE,
  invoiceExpiryMinutes: PAYMENT_RULES.INVOICE_EXPIRY_MINUTES,
  // (Removed 2026-08-16: dead `gateway.{publicKey,secretKey,webhookSecret}` —
  // 0 readers. Webhook signatures are verified by the payment adapters
  // (services/payment/{stripe,mock}-payment-adapter.js), not this object;
  // the "consumed by payment-service.verifyWebhookSignature" note was stale.
  // PAYMENT_WEBHOOK_SECRET the env var is still catalogued in config/secrets.js.
  // PAYMENT_PUBLIC_KEY / PAYMENT_SECRET_KEY have no readers left at all.)
};

// Payment types
const PAYMENT_TYPES = {
  INITIAL: 'initial',
  PHASE_1: 'PHASE_1',
  PHASE_2: 'PHASE_2',
};

// Payment status
const PAYMENT_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  PAID: 'PAID',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
};

// Payment methods
const PAYMENT_METHODS = {
  CREDIT_CARD: 'credit_card',
  BANK_TRANSFER: 'bank_transfer',
  QR_CODE: 'qr_code',
  PROMPTPAY: 'promptpay',
};

module.exports = {
  CONFIG,
  PAYMENT_TYPES,
  PAYMENT_STATUS,
  PAYMENT_METHODS,
};
