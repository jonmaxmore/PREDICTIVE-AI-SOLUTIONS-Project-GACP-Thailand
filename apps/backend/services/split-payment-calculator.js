/**
 * Split-Payment Calculator
 * คำนวณและแยกยอดรายได้ตามกระเป๋าเงิน (Wallet A: กรมฯ / Wallet B: บริษัท)
 *
 * ใช้สำหรับ:
 * - แสดงรายละเอียดบน Finance Dashboard
 * - ออก e-Tax Invoice
 * - รายงานภาษีขาย / รายงานนำส่งเงินกรมฯ
 */

const { PAYMENT_FEES } = require('../config/payment-fees');
// Bug 6.2 — single canonical money-flow side classifier. This service maps the
// STATE side to the GOV revenue type; PLATFORM stays PLATFORM.
const { classifyInvoiceSide, INVOICE_SIDES } = require('./finance/invoice-side');

// Money rounding: half-up to 2 decimal places (satang). Matches the GL of
// record (journal-entry-service round2) so this report reconciles with it.
function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

// ─── Revenue Types ──────────────────────────────────────────

const REVENUE_TYPE = Object.freeze({
  GOV: 'GOV',           // ค่าธรรมเนียมรัฐ (ยกเว้น VAT → นำส่งกรมฯ)
  PLATFORM: 'PLATFORM', // ค่าบริการแพลตฟอร์ม
  VAT: 'VAT',           // ภาษีมูลค่าเพิ่ม 7%
});

// ─── Invoice Revenue Classification ─────────────────────────

/**
 * Classify an invoice's service type into a revenue type.
 * STATE side (incl. legacy APPLICATION_FEE/AUDIT_FEE) → GOV, PLATFORM → PLATFORM.
 *
 * Bug 6.2: delegates to the canonical classifyInvoiceSide so this reporter
 * agrees with customer-statement / daily-cash / bank-reconciliation / the
 * ACCOUNT-side SoD wall (previously this classifier said GOV while those three
 * said PLATFORM for the SAME legacy APPLICATION_FEE/AUDIT_FEE serviceType).
 *
 * @param {string} serviceType
 * @returns {'GOV' | 'PLATFORM'}
 */
function classifyRevenueType(serviceType) {
  return classifyInvoiceSide(serviceType) === INVOICE_SIDES.STATE
    ? REVENUE_TYPE.GOV
    : REVENUE_TYPE.PLATFORM;
}

// ─── Revenue Aggregation (from invoices) ────────────────────

/**
 * Aggregate revenue split from a list of paid invoices.
 * @param {Array} invoices - Array of invoice objects with { serviceType, totalAmount, status }
 * @returns {{ walletA: number, walletB: number, vatCollected: number, totalRevenue: number, byPhase }}
 */
function calculateRevenueSplit(invoices) {
  const result = {
    walletA: 0,    // Gov revenue
    walletB: 0,    // Company revenue (service fee + VAT)
    vatCollected: 0,
    totalRevenue: 0,
    paidCount: 0,
    byPhase: {
      phase1: { walletA: 0, walletB: 0, count: 0 },
      phase2: { walletA: 0, walletB: 0, count: 0 },
    },
  };

  const paidStatuses = new Set(['PAID', 'PAID_PENDING_RECEIPT', 'RECEIPT_ISSUED']);

  for (const invoice of invoices) {
    const status = String(invoice.status || '').toUpperCase();
    if (!paidStatuses.has(status)) { continue; }

    const amount = Number(invoice.totalAmount || 0);
    const type = classifyRevenueType(invoice.serviceType);
    result.totalRevenue += amount;
    result.paidCount += 1;

    if (type === REVENUE_TYPE.GOV) {
      // Gov fee invoices: entire amount goes to Wallet A
      result.walletA += amount;

      // Determine phase
      const serviceType = String(invoice.serviceType || '').toUpperCase();
      if (serviceType.includes('PHASE_1') || serviceType === 'APPLICATION_FEE') {
        result.byPhase.phase1.walletA += amount;
        result.byPhase.phase1.count += 1;
      } else {
        result.byPhase.phase2.walletA += amount;
        result.byPhase.phase2.count += 1;
      }
    } else {
      // Platform fee invoices: service fee + VAT goes to Wallet B
      // Extract VAT portion: VAT = amount × (VAT_RATE / (1 + VAT_RATE)).
      // Round at 2 dp (satang), NOT whole baht — money-flow audit 2026-06-11 (3.3):
      // bare Math.round() over-stated VAT by up to ~0.34 baht/row on non-canonical
      // PLATFORM totals (e.g. subscription 990 → 65 vs the GL's correct 64.77),
      // drifting this month-end report away from the GL of record. Canonical cert
      // platform totals (535 / 2,675) already land on integers, so they're unaffected.
      const vatPortion = round2(amount * (PAYMENT_FEES.VAT_RATE / (1 + PAYMENT_FEES.VAT_RATE)));
      result.walletB += amount;
      result.vatCollected += vatPortion;

      const serviceType = String(invoice.serviceType || '').toUpperCase();
      if (serviceType.includes('PHASE_1')) {
        result.byPhase.phase1.walletB += amount;
      } else {
        result.byPhase.phase2.walletB += amount;
      }
    }
  }

  // Boundary rounding (audit 2026-06-11 3.3): re-round the float accumulators to
  // 2 dp before returning so satang-level drift can't accumulate across rows.
  result.walletA = round2(result.walletA);
  result.walletB = round2(result.walletB);
  result.vatCollected = round2(result.vatCollected);
  result.totalRevenue = round2(result.totalRevenue);
  result.byPhase.phase1.walletA = round2(result.byPhase.phase1.walletA);
  result.byPhase.phase1.walletB = round2(result.byPhase.phase1.walletB);
  result.byPhase.phase2.walletA = round2(result.byPhase.phase2.walletA);
  result.byPhase.phase2.walletB = round2(result.byPhase.phase2.walletB);

  return result;
}

module.exports = {
  REVENUE_TYPE,
  classifyRevenueType,
  calculateRevenueSplit,
};
