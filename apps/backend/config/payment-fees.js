/**
 * GACP Platform - Enhanced Payment Fees Configuration
 * ค่าธรรมเนียมที่ปรับปรุงตาม workflow ใหม่ (October 2025)
 *
 * กฎการชำระเงิน:
 * - Phase 1 / Phase 2: ชื่อและความครอบคลุมอยู่ใน shared/instalment-service-names.js
 *   จำนวนที่เรียกเก็บอยู่ใน config/business-rules.js
 * - หากถูกขอแก้ไข ต้องแก้ภายใน 5 วันทำการ ไม่งั้น EXPIRED → ต้องยื่นคำขอใหม่ + จ่ายค่าธรรมเนียมใหม่
 * - ไม่มีจำกัดจำนวนรอบการแก้ไข (revision/CAR ไม่จำกัดรอบ)
 * - ไม่มี Phase 3 (ไม่เก็บค่าออกใบรับรอง)
 */

// ── THE TARIFF HAS ONE HOME, AND IT IS NOT THIS FILE ─────────────────────────
// Every amount below is DERIVED from config/business-rules.js (which itself takes
// overrides from the DB), so this module is a VIEW of the tariff and can never hold a
// second opinion about it.
//
// It used to hold hand-written amounts and their VAT-inclusive totals, typed
// out by hand instead of read from the tariff. Two copies of a fee agree until the day one is edited, and from
// then on the amount an applicant is shown, the amount invoiced and the amount remitted
// to the department are three different numbers with no way to say which is right.
// GOALS.md G1 records the consequence as the "บั๊ก 30k/15k" and makes one fee source a
// hard gate for taking real money. scripts/probes/fee-single-source.sh is the machine
// that now enforces it.
//
// The derivation is the W14 ruling (operator 2026-08-22, the change log c28355ea):
// VAT is charged on the WHOLE service — state fee plus platform fee — not on the
// platform fee alone.
const { FEES } = require('./business-rules');
// ชื่อบรรทัด: แค็ตตาล็อกเดียว (operator 2026-10-03) — ไฟล์นี้ไม่ตั้งชื่อเอง
const { serviceFor, vatLine } = require('../shared/instalment-service-names');

/**
 * ค่าบริการ → { serviceFee, vat, total } — ได้มาทั้งหมด ไม่มีตัวเลขเขียนมือ
 *
 * การปัดเศษเหมือน modules/billing/internal/fee-service.js บรรทัดต่อบรรทัด เพราะสองกติกา
 * การปัดสำหรับอัตราเดียว คือการซ้ำซ้อนที่ไฟล์นี้ถูกทำความสะอาดเพื่อยุติ · ที่อัตราปัจจุบัน
 * มันไม่เคยปัดจริง (5,500 × 0.07 = 385 ลงตัว) · Math.round มีไว้เผื่ออัตราที่ override
 * ผ่าน SystemConfig ไม่ให้สร้างเศษสตางค์ และกัน IEEE-754 พิมพ์ 385.00000000000006 ลงใบ
 *
 * ── ถอด govFee ออก 2026-09-11 ──
 * operator สั่งเลิกแยกค่าธรรมเนียมรัฐกับค่าบริการ ⇒ อัตราที่รับเข้ามา **คือค่าบริการเอง**
 */
function phaseAmounts(serviceFee) {
  const vat = Math.round(serviceFee * FEES.VAT_RATE);
  return { serviceFee, vat, total: serviceFee + vat };
}

// Read AT CALL TIME (fix/fees-from-server round 3, 2026-10-03). These used to be
// `const PHASE_1 = phaseAmounts(FEES.PHASE1_PER_SCOPE)` evaluated when the module
// loaded, with `VAT_RATE: FEES.VAT_RATE` copied the same way, so a fee.* override
// applied to FEES afterwards never reached accounting, journal, split or export.
// Every fee field below is now a getter over FEES; the formula (phaseAmounts),
// the rounding and the field names are unchanged.
// Pinned by __tests__/unit/fee-overrides-reach-the-engine.test.js (round 3).
const phase1 = () => phaseAmounts(FEES.PHASE1_PER_SCOPE);
const phase2 = () => phaseAmounts(FEES.PHASE2_PER_SCOPE);

const PAYMENT_FEES = {
  // ค่าบริการก่อน VAT ต่อหนึ่งรูปแบบการปลูก — อ่านมา ไม่ได้ประกาศซ้ำ
  get DOCUMENT_REVIEW_FEE() { return phase1().serviceFee; }, // งวดที่ 1 (ชื่อ: shared/instalment-service-names)
  get FIELD_AUDIT_FEE() { return phase2().serviceFee; },     // งวดที่ 2 (ชื่อ: shared/instalment-service-names)

  get VAT_RATE() { return FEES.VAT_RATE; },

  // ยอดรวมแยกตาม Phase — คำนวณจาก Base + Service Fee + VAT (W14)
  get PHASE_1_SERVICE_FEE() { return phase1().serviceFee; },
  get PHASE_1_VAT() { return phase1().vat; },
  get PHASE_1_TOTAL() { return phase1().total; },

  get PHASE_2_SERVICE_FEE() { return phase2().serviceFee; },
  get PHASE_2_VAT() { return phase2().vat; },
  get PHASE_2_TOTAL() { return phase2().total; },

  // ค่าธรรมเนียมพิเศษ — ยื่นซ้ำคิดเท่าค่าตรวจเอกสาร ไม่ใช่ตัวเลขของตัวเอง
  get RE_SUBMISSION_FEE() { return phase1().serviceFee; },
  // M4 (operator ruling 2026-08-23): the rush-processing fee is abolished
  // ("ไม่มีค่าเร่งด่วน"). The constant that stood here said 3,000 while
  // GET /api/pricing advertised 10,000 — one fee, two prices, and no invoice
  // ever carried either. Removed the way BT11/BT13 were; do not reintroduce.

  // การคำนวณยอดรวม (ทั้ง 2 งวด)
  get TOTAL_STANDARD_FEE() { return phase1().total + phase2().total; },

  // NOTE: PAYMENT_PHASES and RE_PAYMENT_RULES (dead as of the 2026-09-26
  // side-fix cleanup) used to carry hand-written phase amounts here —
  // 5,000 / 25,000 / 5,885 — the retired per-scope prices from before the
  // 2026-09-11 one-service-fee ruling. grep across apps/, scripts/,
  // packages/ found no reader (nested key or dynamic/bracket access) of
  // either export, so they were removed rather than re-derived: nobody
  // was depending on them, and a second copy of the phase table — even a
  // derived one — is exactly the duplication config/business-rules.js is
  // the single source against. Revision-deadline behaviour is unaffected:
  // it always lived in workflow-transition-service.js, not here.

  // สถานะการชำระเงิน
  PAYMENT_STATUS: {
    PENDING: 'pending', // รอชำระ
    PROCESSING: 'processing', // กำลังตรวจสอบ
    COMPLETED: 'completed', // ชำระแล้ว
    FAILED: 'failed', // ชำระไม่สำเร็จ
    EXPIRED: 'expired', // หมดอายุ
    REFUNDED: 'refunded', // คืนเงินแล้ว
    CANCELLED: 'cancelled', // ยกเลิก
  },

  // ระยะเวลาชำระเงิน
  PAYMENT_TIMEOUT: {
    PHASE_1: 7 * 24 * 60 * 60 * 1000, // 7 วัน
    PHASE_2: 14 * 24 * 60 * 60 * 1000, // 14 วัน
  },

  // Gateway และช่องทางการชำระเงิน
  PAYMENT_METHODS: {
    CREDIT_CARD: 'credit_card',
    INTERNET_BANKING: 'internet_banking',
    MOBILE_BANKING: 'mobile_banking',
    QR_CODE: 'qr_code',
    BANK_TRANSFER: 'bank_transfer',
    COUNTER_SERVICE: 'counter_service',
  },
  // NOTE: dead dummy BANK_ACCOUNTS config removed (named the wrong department,
  // never read anywhere). Real receiving accounts live in the BankAccount Prisma
  // model (bank-account-service.js / finance/bank-accounts.js, seed-bank-accounts.js).
};

module.exports = {
  PAYMENT_FEES,

  /**
   * คำนวณรายละเอียดค่าใช้จ่ายแยกรายการตามงวด
   * @param {number} phase - 1 or 2
   * @returns {{ serviceFee, vat, total, lineItems[] }}
   */
  computePhaseBreakdown: (phase) => {
    const p = parseInt(phase);
    const serviceFee = p === 1 ? PAYMENT_FEES.PHASE_1_SERVICE_FEE : PAYMENT_FEES.PHASE_2_SERVICE_FEE;
    const vat = p === 1 ? PAYMENT_FEES.PHASE_1_VAT : PAYMENT_FEES.PHASE_2_VAT;
    const total = p === 1 ? PAYMENT_FEES.PHASE_1_TOTAL : PAYMENT_FEES.PHASE_2_TOTAL;

    return {
      phase: p,
      serviceFee,
      vat,
      total,
      // กระเป๋าเดียว: เกษตรกรจ่ายบริษัท และบริษัทกระทบยอดกับกรมนอกระบบนี้
      // (operator 2026-09-11 สั่งถอดระบบนำส่งเงินให้กรมออกทั้งชุด)
      // `walletA`/`walletB` ถูกถอดไปด้วย — ไม่มีสองกระเป๋าให้แยกอีกแล้ว
      // สองบรรทัด ไม่ใช่สาม: ค่าบริการ กับ VAT ของมัน
      // เดิมบรรทัดแรกคือ "ค่าธรรมเนียมตรวจสอบเอกสาร (Government Fee)" revenueType STATE
      // และบรรทัดที่สองคือค่าบริการแพลตฟอร์ม — ทั้งคู่ถูกยุบเป็นบรรทัดเดียว 2026-09-11
      lineItems: [
        {
          order: 1,
          description: serviceFor(p).name,
          description_en: serviceFor(p).nameEn,
          amount: serviceFee,
          // ไม่มีบรรทัดใดได้รับยกเว้น VAT: ผู้ออกใบรายเดียว รายได้ที่ต้องเสียภาษีก้อนเดียว
          taxExempt: false,
        },
        {
          order: 2,
          description: vatLine(PAYMENT_FEES.VAT_RATE).name,
          description_en: vatLine(PAYMENT_FEES.VAT_RATE).nameEn,
          amount: vat,
          taxExempt: false,
        },
      ],
    };
  },
};

