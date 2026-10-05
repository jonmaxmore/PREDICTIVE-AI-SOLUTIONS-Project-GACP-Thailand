/**
 * Service facts: what the web tells applicants about how long a certificate
 * lasts, who they pay, how they pay, what is refunded, and what this platform
 * is. Operator decision 6 (2026-09-17): the copy must state the truth.
 *
 * Audit 2026-09-17 (UXUI-01, UXUI-02, UXUI-X01, UXUI-X2) found the FAQ, the
 * pricing page, the Terms of Service, the onboarding tour, the footer and the
 * renewal wizard each writing their own sentence about these things, and the
 * sentences contradicted each other and the backend. A surface that states one
 * of these facts takes it from here. Every entry names the record it comes
 * from; a claim with no record behind it is not written here, it is removed
 * from the page.
 *
 * Pinned to the backend by
 * apps/backend/__tests__/unit/frontend-service-facts-mirror.test.js and
 * src/__tests__/truthful-copy/service-facts-module.test.ts.
 */

import { SUPPORT_EMAIL } from '@/constants/contact-emails';

// ── Certificate ─────────────────────────────────────────────────────────────

/**
 * อายุใบรับรอง (ปี). MIRROR of CERTIFICATE.VALIDITY_YEARS in
 * apps/backend/config/business-rules.js (operator 2026-09-11, commit a22007e4:
 * "อายุใบรับรองยืนยันแล้ว หนึ่งปี"). The expiry is the issue date plus this many
 * years (services/certificate-service.js).
 */
export const GACP_CERTIFICATE_VALIDITY_YEARS = 1;

/**
 * Days before expiry on which the renewal reminder is sent, as an in-app
 * notification (the fan-out is IN_APP only). MIRROR of REMINDER_DAYS in
 * apps/backend/services/renewal-service.js.
 */
export const GACP_RENEWAL_REMINDER_DAYS: ReadonlyArray<number> = [60, 30, 15];

/**
 * Generic copy (onboarding, FAQ) states the rule a certificate is issued under
 * today. Certificates issued before 2026-09-11 were minted by the retired
 * hardcoded 3-year path and keep that expiry (e.g. staging, 10 Sep 2569 ->
 * 10 Sep 2572). A page that shows ONE certificate therefore states that
 * certificate's own issue-to-expiry span, never this constant
 * (app/health/certificates/validity-years.ts).
 */
export const CERTIFICATE_VALIDITY_TH = `ใบรับรองมีอายุ ${GACP_CERTIFICATE_VALIDITY_YEARS} ปี นับจากวันที่ออก`;

/** "60, 30 และ 15" */
export const RENEWAL_REMINDER_DAYS_TH = GACP_RENEWAL_REMINDER_DAYS.join(', ').replace(/, (\d+)$/, ' และ $1');

/**
 * renewal-service.createRenewalApplication renews only an ACTIVE certificate
 * that has not expired, and answers CERT_ALREADY_EXPIRED ("a new application is
 * required") otherwise. There is no earliest-date window.
 */
export const RENEWAL_WINDOW_TH = 'ยื่นต่ออายุได้ขณะที่ใบรับรองยังไม่หมดอายุ ใบรับรองที่หมดอายุแล้วต้องยื่นคำขอใหม่';

/**
 * W12 (operator 2026-08-22, renewal-service.js header): "ต่ออายุ 30,000
 * ครั้งเดียว และไม่ตรวจเอกสาร นัดลงพื้นที่อย่างเดียว". The 30,000 in that quote
 * is the retired state base; since the one-fee ruling (operator 2026-09-11) the
 * declared renewal ค่าบริการ is 33,000 (FEES.RENEWAL_PER_SCOPE in
 * apps/backend/config/business-rules.js). The amount a page prints is the one
 * GET /api/pricing/fees serves (renewalTotalPerScope), never a literal here.
 */
export const RENEWAL_PROCESS_TH = 'การต่ออายุไม่มีการตรวจเอกสาร มีเฉพาะการตรวจประเมินฟาร์ม และชำระค่าบริการครั้งเดียว';

// ── Corrective action (CAR) ─────────────────────────────────────────────────

/**
 * วันทำการที่ผู้สมัครมีเวลาแก้ไขหลังเจ้าหน้าที่ออกคำสั่ง (CAR). MIRROR of
 * PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS in apps/backend/config/business-rules.js
 * (pinned by apps/backend/__tests__/unit/frontend-service-facts-mirror.test.js).
 * Consumed by services/workflow-transition-service.js; the deadline is counted
 * in business days, not calendar days.
 */
export const GACP_CAR_REVISION_DEADLINE_BUSINESS_DAYS = 5;

/** "5 วันทำการ" */
export const CAR_REVISION_DEADLINE_TH = `${GACP_CAR_REVISION_DEADLINE_BUSINESS_DAYS} วันทำการ`;

// ── Who is paid ─────────────────────────────────────────────────────────────

/**
 * W14 (operator 2026-08-22, the change log c28355ea; business-rules.js FEES
 * header) and docs/legal/payment-terms-th-v1.2.md §1: one issuer. The applicant
 * pays the platform company, which issues every quotation, invoice, receipt and
 * tax invoice. The retired two-payee model (state fee to the Comptroller
 * General, platform fee to the company) is not current.
 *
 * One ค่าบริการ (operator 2026-09-11): "ไม่มีการแยก
 * ค่าธรรมเนียมรัฐ ค่าบริการ จะเป็นค่าบริการทั้งหมด". So no sentence here says a
 * state fee sits inside the price, or that the company remits one to the
 * department: whatever the company pays the department is an agreement outside
 * this system (payment-terms v1.2 §2.6; the in-system monthly
 * remittance was ordered removed 2026-09-11). This file's first version
 * (2026-09-17) still said both; they became false with the one-fee ruling.
 */
export const PAYEE_TH = 'บริษัทผู้ให้บริการแพลตฟอร์ม';

export const PAYEE_STATEMENT_TH =
  'ค่าบริการทุกงวดชำระให้บริษัทผู้ให้บริการแพลตฟอร์มเพียงรายเดียว บริษัทเป็นผู้ออกใบเสนอราคา ใบแจ้งหนี้ ใบเสร็จ และใบกำกับภาษีทั้งหมด ไม่มียอดใดที่ต้องชำระแยกให้กรมการแพทย์แผนไทยและการแพทย์ทางเลือกหรือกรมบัญชีกลาง';

// ── How ─────────────────────────────────────────────────────────────────────

/**
 * The one payment rail. Operator ruling 2026-09-27: user-facing text never
 * names the payment provider (Stripe) — it says "ผู้ให้บริการรับชำระเงิน" /
 * "the payment provider". Code identifiers and comments may name it. Pinned by
 * apps/backend/__tests__/unit/frontend-service-facts-mirror.test.js and
 * src/__tests__/truthful-copy/service-facts-module.test.ts.
 *
 *   - Stripe only: operator 2026-09-06 "เราจ่ายเงินผ่าน strip เท่านั้น".
 *   - PromptPay only: mandate D3 2026-08-04, paymentMethodTypes ['promptpay']
 *     in services/checkout/stripe-checkout-service.js; the card path is
 *     deliberately not offered.
 *   - No transfer, no slip: the bank-slip rail was retired 2026-09-06/09-11
 *     (services/workflow-transition-service.js); only the verified Stripe
 *     webhook moves an application past a fee state.
 * Kept as ONE single-quoted literal: the backend mirror test reads it as text.
 */
export const PAYMENT_CHANNEL_TH = 'ชำระผ่านระบบด้วยการสแกน QR พร้อมเพย์ ผ่านผู้ให้บริการรับชำระเงิน เป็นช่องทางเดียว ไม่รับโอนเข้าบัญชีธนาคาร ไม่รับแนบสลิป และไม่รับบัตร';

/**
 * English mirror of PAYMENT_CHANNEL_TH — same facts, same record (one-fee
 * residue sweep 2026-09-26). Before this, en-health.ts `methodTransfer` hand-
 * wrote its own English sentence with no backend-pinned source; the Thai
 * dictionary already reads PAYMENT_CHANNEL_TH the same way this one is read.
 * Kept as ONE single-quoted literal: the backend mirror test reads it as text.
 */
export const PAYMENT_CHANNEL_EN = 'Pay in the system by scanning a PromptPay QR code, through the payment provider, the only channel. Bank transfers, slip uploads and card payments are not accepted.';

/**
 * How an applicant pays, true whether or not this environment can take the
 * payment right now (PromptPay QR step, operator ruling 2026-09-27). POST
 * /payments/checkout creates the order and a Stripe PromptPay PaymentIntent and
 * returns the publishable key with it; the checkout screen then opens Stripe's
 * own QR modal (stripe.confirmPromptPayPayment). Only the verified Stripe
 * webhook marks a fee paid (checkout-settlement-service.js, probe
 * settle-webhook-only). The backend refuses a checkout before minting anything
 * when its publishable key is missing or of the wrong mode, and the screen then
 * says so (ONLINE_PAYMENT_NOT_READY_TH). Surfaces that cannot ask the backend
 * (pricing, FAQ, the payments list) state this sentence, which holds in both
 * states. No staff member can take the payment instead: the finance roles hold
 * no workflow transition.
 */
export const ONLINE_PAYMENT_STEP_TH = 'ชำระด้วยการสแกน QR พร้อมเพย์ที่ผู้ให้บริการรับชำระเงินแสดงบนหน้าชำระเงินของระบบ การชำระเงินจะถูกบันทึกเข้าระบบก็ต่อเมื่อได้รับการยืนยันจากผู้ให้บริการรับชำระเงิน หากระบบรับชำระเงินยังไม่พร้อม หน้าชำระเงินจะแจ้งไว้และไม่มีการเรียกเก็บเงิน';

/**
 * Said only where the backend has just answered that the QR cannot be shown:
 * a checkout response with no publishable key (the mock adapter), or one of the
 * fail-closed refusals STRIPE_PUBLISHABLE_KEY_NOT_CONFIGURED /
 * STRIPE_KEY_MODE_MISMATCH / STRIPE_NOT_CONFIGURED. Never printed on a surface
 * that did not ask.
 */
export const ONLINE_PAYMENT_NOT_READY_TH = 'ระบบรับชำระเงินยังไม่พร้อมในขณะนี้ หน้านี้จึงยังแสดง QR พร้อมเพย์ให้สแกนไม่ได้ และยังชำระค่าบริการผ่านระบบไม่ได้';

/** True while nothing can be confirmed: an order may exist, a charge does not. */
export const NOT_CHARGED_TH = 'ระบบยังไม่ได้เรียกเก็บเงินจากคุณ';

/**
 * The receipt is written when the Stripe settlement lands (the change log G4
 * walk a03: "settlement เขียน receiptNumber ... ลง invoice ทันที";
 * services/pdf/invoice-template-service.js "ใบเสร็จรับเงินออกอัตโนมัติเมื่อ
 * ชำระเงินสำเร็จ"). No working-day timetable and no Revenue Department e-Tax
 * registration is on record, so neither is claimed.
 */
export const RECEIPT_TH = 'เมื่อระบบยืนยันการชำระเงินแล้ว ใบเสร็จรับเงินและใบกำกับภาษีในนามบริษัทจะออกให้อัตโนมัติ';

// ── Refunds ─────────────────────────────────────────────────────────────────

/**
 * docs/legal/payment-terms-th-v1.2.md §7 and §10 (in force from 4 ตุลาคม 2569,
 * operator 2026-10-03), the text the applicant ticks before every payment (the
 * checkout disclosure summarises the same rules). Lines 1-4 carry v1.1 §2's
 * rules, which v1.2 §7.1-§7.2 (ก)-(ค) keep; line 5 is v1.2 §7.2 (ง), new in
 * v1.2. Line 6 is §7.3's timetable (operator 2026-10-03: 15 วันทำการ from
 * approval plus complete account details). Line 1's closing clause is the one
 * the checkout disclosure shows.
 */
export const REFUND_POLICY_TH: ReadonlyArray<string> = [
  'ค่าบริการของขั้นตอนที่เริ่มดำเนินการตรวจแล้ว (เอกสารถูกส่งเข้าสู่การตรวจแล้ว หรือตรวจประเมินแล้ว) ไม่สามารถขอคืนได้ แม้ผลจะไม่ผ่านหรือคำขอถูกยกเลิกเพราะพ้นกำหนดแก้ไข',
  'หากระบบเรียกเก็บเงินซ้ำหรือเก็บผิดพลาดทางเทคนิค จะได้รับคืนส่วนที่เก็บเกิน',
  'หากคำขอถูกยกเลิกเพราะความผิดพลาดของระบบ ระบบจะคืนสถานะคำขอให้เอง และหากชำระซ้ำเพราะเหตุนั้น บริษัทผู้ให้บริการแพลตฟอร์มจะคืนยอดที่ชำระซ้ำให้เต็มจำนวน',
  'หากบริษัทหรือหน่วยงานของรัฐเป็นฝ่ายยกเลิกการให้บริการเอง มีสิทธิ์ได้รับเงินคืนหรือการเยียวยา',
  'หากขอยกเลิกคำขอก่อนเริ่มดำเนินการตรวจของงวดที่ชำระแล้ว บริษัทคืนค่าบริการของงวดนั้น',
  'บริษัทโอนเงินคืนเข้าบัญชีที่แจ้งไว้ภายใน 15 วันทำการ นับจากวันที่อนุมัติการคืนเงินและได้รับข้อมูลบัญชีครบถ้วน',
];

/**
 * payment-terms v1.2 §7.3 + §11.1: a refund case starts with the company, at
 * its support address (v1.1 §4 sent it to the responsible inspector). Refunds
 * are still executed by staff only (routes/api/finance/refunds.js: every
 * endpoint is authenticateProvider); an applicant has no refund request of
 * their own in the system.
 */
export const REFUND_REQUEST_TH = `ผู้ยื่นคำขอยังยื่นขอคืนเงินผ่านระบบเองไม่ได้ หากต้องการเปิดเรื่องคืนเงิน ให้ติดต่อบริษัททางอีเมล ${SUPPORT_EMAIL}`;

/** Per-instalment one-liners of the §2 rule, for fee tables. */
export const REFUND_PHASE1_TH = 'ไม่คืนเงินเมื่อเอกสารถูกส่งเข้าสู่การตรวจแล้ว แม้ผลจะไม่ผ่าน';
export const REFUND_AUDIT_TH = 'ไม่คืนเงินเมื่อตรวจประเมินแล้ว แม้ผลจะไม่ผ่าน';

// ── What this platform is ───────────────────────────────────────────────────

/**
 * No record in the repository shows a government authorisation for this site,
 * a .go.th domain, the official Garuda emblem (the login page says it is still
 * awaiting approval), or an ISO/IEC 17065 accreditation, so no page claims to
 * be a government website, to be certified or endorsed by the department, or
 * to issue under ISO/IEC 17065 (audit UXUI-02). What the records do show: the
 * platform company provides and bills the service (payment-terms v1.2 §1), and
 * the certificate is the department's (Terms of Service §1-§2; the certificate
 * PDF, apps/backend/services/pdf/templates/certificate.html "ออกโดย DTAM").
 */
export const CERTIFICATE_ISSUER_TH = 'ใบรับรองออกโดยกรมการแพทย์แผนไทยและการแพทย์ทางเลือก (DTAM)';
