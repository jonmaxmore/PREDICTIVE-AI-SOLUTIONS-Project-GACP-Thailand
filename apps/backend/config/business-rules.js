/**
 * Centralized Business Rules & Constants
 *
 * Single source of truth for all business configuration values.
 * Fee values can be overridden via SystemConfig DB entries:
 *   - fee.phase1_per_scope  → FEES.PHASE1_PER_SCOPE
 *   - fee.phase2_per_scope  → FEES.PHASE2_PER_SCOPE
 *   - fee.renewal_per_scope → FEES.RENEWAL_PER_SCOPE
 *     (legacy alias still honoured: fee.renewal_per_cert)
 *   - fee.platform_rate     → FEES.PLATFORM_RATE
 *   - fee.vat_rate          → FEES.VAT_RATE
 *
 * @module config/business-rules
 */

const logger = require('../shared/logger');

// FEES (THB) — defaults, overridable via SystemConfig
//
// ค่าบริการต่อหนึ่งรูปแบบการปลูก — ราคาเดียว ไม่มีการแยกส่วน
// ┌─────────────────────────┬────────────┬────────────────┐
// │ รายการ                   │ งวดที่ 1    │ งวดที่ 2        │
// ├─────────────────────────┼────────────┼────────────────┤
// │ ค่าบริการ                │ 5,500      │ 27,500         │
// │ VAT 7%                  │ 385        │ 1,925          │
// ├─────────────────────────┼────────────┼────────────────┤
// │ ยอดชำระต่อรูปแบบ          │ 5,885      │ 29,425         │
// └─────────────────────────┴────────────┴────────────────┘
//
// operator 2026-09-11: "ต่อไปนี้จะไม่มีการแยกค่าธรรมเนียมรัฐ ค่าบริการ จะเป็นค่าบริการ
// ทั้งหมด 5,500 + 27,500 ... รวม vat 7% จะเท่ากับ 35,310 เรามีราคานี้เท่านั้น
// ต่อ 1 รูปแบบการปลูก แบบอื่นไม่ถูกต้อง เก็บกวาด และคลีนทิ้งให้หมด"
//
// ── ยอดไม่ขยับแม้แต่สตางค์เดียว ──
// เดิมประกาศ 5,000 แล้วบวกแพลตฟอร์ม 10% ได้ 5,500 · ตอนนี้ประกาศ 5,500 ตรง ๆ
// ตัวเลขที่เกษตรกรจ่ายเท่าเดิมทุกจำนวนรูปแบบ (35,310 / 70,620 / 105,930)
// สิ่งที่หายไปคือการคำนวณย้อนกลับ ไม่ใช่เงิน
//
// ── ทำไมการแยกนั้นเป็นคำโกหกอยู่ก่อนแล้ว ──
// รางที่ใช้จริงมินต์ใบเดียว serviceType `CERTIFICATION_CHECKOUT_M1|M2` ซึ่งไม่ลงท้าย
// `_STATE_FEE` ⇒ services/finance/invoice-side.js จัดให้อยู่ฝั่งบริษัททั้งก้อนอยู่แล้ว
// และไม่มีเส้นทางใดในระบบมินต์ใบ `*_STATE_FEE` อีกเลย เหลือแต่ตัวอ่าน
//
// ต่อเนื่องจาก W14 (operator 2026-08-22, the change log c28355ea; ยืนยันตัวเลข
// d1c33ea0) ที่ตัดสินว่าบริษัทเป็นผู้ออกเอกสารคนเดียว เกษตรกรจ่ายบริษัท และบริษัท
// ไปกระทบยอดกับกรมนอกระบบนี้ ⇒ ไม่มีขาที่ยกเว้น VAT และไม่มีตัวแทนเก็บเงิน
// ใบนี้เดินต่ออีกก้าว: เลิกเก็บ "ส่วนของรัฐ" ไว้ในตัวเลขที่ไม่มีใครใช้แล้ว
//
// การต่ออายุคือยอดเดียวกันเก็บครั้งเดียว: 33,000 + VAT = 35,310 ต่อรูปแบบ

const FEE_DEFAULTS = {
    /** งวดที่ 1 — ค่าบริการตรวจเอกสาร ต่อหนึ่งรูปแบบการปลูก (ก่อน VAT) */
    PHASE1_PER_SCOPE: 5500,
    /** งวดที่ 2 — ค่าบริการตรวจพื้นที่ ต่อหนึ่งรูปแบบการปลูก (ก่อน VAT) */
    PHASE2_PER_SCOPE: 27500,
    /**
     * Certificate renewal — ONE charge, per CULTIVATION SCOPE (ค่าต่ออายุใบรับรอง).
     *
     * Operator ruling 2026-08-22 (the change log @ 67ef3612): a renewal is
     * billed ONCE — it does NOT walk the PHASE1 + PHASE2 pair a new application
     * walks, because it has no document-review stage to pay for.
     *
     * PER CULTIVATION SCOPE, multiplied exactly like the two entries above.
     * Operator correction the same day (the change log @ 8b8d581f): "ฟาร์ม 1
     * รูปแบบ 30000 / 2 รูปแบบ 60000 / 3 รูปแบบ 90000 ราคารวม ต้องแบบนี้ ไม่ว่าใหม่
     * หรือต่อ ต้องคิดเงินแยกรูปแบบการปลูก". An earlier reading of the first ruling
     * treated this as a flat per-certificate charge; that was wrong, and the
     * correction is applied here, in the multiplication path, and in the tests
     * that had pinned the flat reading.
     *
     * นี่คือ **ค่าบริการก่อน VAT** รูปเดียวกับสองรายการข้างบน (operator 2026-09-11
     * เลิกแยกส่วนรัฐ/แพลตฟอร์ม) · บวก VAT 7% แล้วได้ 35,310 / 70,620 / 105,930
     * สำหรับ 1 / 2 / 3 รูปแบบ ส่งออกเป็น renewalTotalPerScope โดย
     * routes/api/finance/pricing.js
     *
     * ตัวเลขที่ประกาศเปลี่ยนจาก 30,000 เป็น 33,000 เพราะความหมายของช่องเปลี่ยน
     * (ฐานรัฐ → ค่าบริการ) **ยอดที่เก็บจริงเท่าเดิม**: 30,000 + 10% = 33,000 มาก่อน
     *
     * This paragraph used to read "state fees are VAT-exempt and the platform fee
     * carries the VAT (ม.77/1(10)) ... 33,210 / 66,420 / 99,630" — the RETIRED
     * formula, left standing in the same file whose header already declared W14.
     * Two tax positions and two grossed-up totals for one fee, 60 lines apart.
     * The code has always served 35,310; only the comment was wrong, which is the
     * more dangerous half: an accountant reading this file would have taken the
     * VAT-exempt reading to the Revenue Department.
     *
     * CONSEQUENCE worth knowing before someone reports it as a bug: because the
     * renewal base per scope (30,000) equals PHASE1 + PHASE2 per scope
     * (5,000 + 25,000), a renewal and a new application now come to the SAME
     * total for the same farm. The difference is not the amount, it is the
     * schedule: a renewal is charged once, a new application is split across
     * two phases.
     *
     * Before this entry existed the platform carried two live renewal quotes at
     * once (backend 15,000 vs frontend 30,000 — money branch W11 item P7).
     * This is now the only place the amount is defined; the frontend constant
     * is a mirror that __tests__/unit/renewal-fee-ssot.test.js forbids from
     * drifting.
     */
    RENEWAL_PER_SCOPE: 33000,
    /**
     * VAT rate (7%, Thai standard).
     *
     * คิดจาก **ค่าบริการทั้งก้อน** (W14 operator 2026-08-22 the change log c28355ea
     * และยืนยันอีกครั้ง 2026-09-11 ตอนเลิกแยกส่วน) — บริษัทเป็นผู้ออกเอกสารทุกใบ
     * ค่าบริการทั้งหมดจึงเป็นรายได้ที่ต้องเสีย VAT ของบริษัท
     * ดู modules/billing/internal/fee-service.js buildPhaseFee
     */
    VAT_RATE: 0.07,
    // W14 — BT11_CULTIVATION / BT13_PROCESSING (50,000 each) deleted.
    // Operator: "ค่าใบอนุญาตปลูก 50,000 ... เราไม่มี 50000 บาทนะ". They were
    // declared here and mapped to SystemConfig keys, and nothing anywhere ever
    // charged them — the only references in the repo were this declaration and
    // that key map. The `license_bt11` / `license_bt13` DOCUMENT SLOTS
    // (constants/document-slots.js) are a different thing entirely — uploaded
    // licence documents, no money — and are untouched.
};

// Mutable copy — will be overridden by loadFeesFromSystemConfig()
const FEES = { ...FEE_DEFAULTS };

/**
 * Load fee overrides from SystemConfig DB table.
 *
 * INTENTIONALLY UNWIRED — operator ruling 2026-10-03: database rows may not
 * change what the platform bills. Nothing calls this at boot (server.js) or
 * anywhere else, and it must not be wired in without a new operator ruling.
 * Every fee consumer reads FEES at call time (fix/fees-from-server rounds 2-3),
 * so wiring it WOULD take effect everywhere at once; that is the decision being
 * withheld. Proven by __tests__/unit/fee-overrides-reach-the-engine.test.js.
 *
 * (Original note:) Call once at server startup after Prisma is initialized.
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function loadFeesFromSystemConfig(prisma) {
    try {
        const configs = await prisma.systemConfig.findMany({
            where: {
                key: { startsWith: 'fee.' },
            },
        });

        const keyMap = {
            'fee.phase1_per_scope': 'PHASE1_PER_SCOPE',
            'fee.phase2_per_scope': 'PHASE2_PER_SCOPE',
            'fee.renewal_per_scope': 'RENEWAL_PER_SCOPE',
            // Legacy alias. The key was briefly named ..._per_cert on
            // 2026-08-22 while the fee was misread as a flat per-certificate
            // charge. A deployment that already persisted a SystemConfig row
            // under the old name must not silently lose it, so the old key
            // still maps to the same field; precedence is made explicit below.
            'fee.renewal_per_cert': 'RENEWAL_PER_SCOPE',
            'fee.platform_rate': 'PLATFORM_RATE',
            'fee.vat_rate': 'VAT_RATE',
            // W14: 'fee.bt11_cultivation' / 'fee.bt13_processing' removed with
            // the fees themselves. An orphan SystemConfig row under either key
            // is now ignored rather than loaded into a field nothing reads.
        };

        // Apply the legacy renewal key FIRST so a row stored under the current
        // name overwrites it when both exist. Without this the winner would
        // depend on the order Postgres happened to return the rows in.
        const ordered = [...configs].sort((a, b) => {
            const legacy = (k) => (k === 'fee.renewal_per_cert' ? 0 : 1);
            return legacy(a.key) - legacy(b.key);
        });
        for (const config of ordered) {
            const feeKey = keyMap[config.key];
            if (feeKey) {
                const numVal = Number(config.value);
                if (Number.isFinite(numVal)) {
                    FEES[feeKey] = numVal;
                }
            }
        }
    } catch (_err) {
        // SystemConfig table may not exist yet — use defaults silently
    }
}

// SETTLEMENT — Transaction & Retry Resilience
// Defaults for settlement transaction timeouts, retry backoff strategy, and reconciliation.
// Overridable via SystemConfig DB entries:
//   - settlement.tx_timeout_ms → SETTLEMENT.TX_TIMEOUT_MS
//   - settlement.tx_max_wait_ms → SETTLEMENT.TX_MAX_WAIT_MS
//   - settlement.max_attempts → SETTLEMENT.MAX_ATTEMPTS
//   - settlement.reconcile_stale_ms → SETTLEMENT.RECONCILE_STALE_MS
//   - settlement.reconcile_batch → SETTLEMENT.RECONCILE_BATCH

const SETTLEMENT_DEFAULTS = {
    TX_TIMEOUT_MS: 30000,      // a financial settle must not abort at Prisma's 5s default under latency/load
    TX_MAX_WAIT_MS: 10000,     // max wait to acquire a tx slot from the pool
    MAX_ATTEMPTS: 6,           // after this many failed settles → DEAD_LETTER + alert
    RETRY_BACKOFF_MS: [60000, 300000, 900000, 3600000, 10800000], // 1m,5m,15m,1h,3h (last repeats)
    RECONCILE_STALE_MS: 300000,   // an un-processed event older than this is eligible for the reconcile sweep
    RECONCILE_BATCH: 100,          // max rows per reconcile run (bounded)
};

// Mutable copy — will be overridden by loadSettlementFromSystemConfig()
const SETTLEMENT = { ...SETTLEMENT_DEFAULTS };

// ONSITE_AUDIT — decision-transaction resilience (P2028, Phase 0 walk-2
// 2026-08-19): the onsite PASS/FAIL decision tx runs writeApplicationStatus +
// the cert-auto-gen hook (farm create + evidence-gate counts + cert mint) in
// ONE transaction; over Supabase latency that took 6.6s and Prisma's 5s
// default expired the tx, rolling back a fully-evidenced PASS. Same remedy as
// SETTLEMENT above — the timeout is an explicit business rule, not the library
// default. (Static for now; wire SystemConfig overrides like SETTLEMENT's when
// a deployment needs to tune it.)
const ONSITE_AUDIT = {
    DECISION_TX_TIMEOUT_MS: 30000,
    DECISION_TX_MAX_WAIT_MS: 10000,
};

/**
 * Load settlement config overrides from SystemConfig DB table.
 * Call once at server startup after Prisma is initialized.
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function loadSettlementFromSystemConfig(prisma) {
    try {
        const rows = await prisma.systemConfig.findMany({
            where: {
                key: { startsWith: 'settlement.' },
            },
        });

        const keyMap = {
            'settlement.tx_timeout_ms': 'TX_TIMEOUT_MS',
            'settlement.tx_max_wait_ms': 'TX_MAX_WAIT_MS',
            'settlement.max_attempts': 'MAX_ATTEMPTS',
            'settlement.reconcile_stale_ms': 'RECONCILE_STALE_MS',
            'settlement.reconcile_batch': 'RECONCILE_BATCH',
        };

        for (const row of rows) {
            const field = keyMap[row.key];
            if (field) {
                const n = Number(row.value);
                if (Number.isFinite(n)) {
                    SETTLEMENT[field] = n;
                }
            }
        }
    } catch (e) {
        logger.warn('[business-rules] settlement config load skipped', { error: e.message });
    }
}

// FILE LIMITS

const FILE_LIMITS = Object.freeze({
    /** Max image file size (5 MB) */
    IMAGE_MAX_SIZE: 5 * 1024 * 1024,
    /** Max document / evidence file size (10 MB) */
    DOCUMENT_MAX_SIZE: 10 * 1024 * 1024,
    /** Max photo file size (10 MB) — alias for consistency */
    PHOTO_MAX_SIZE: 10 * 1024 * 1024,
    /** Allowed image MIME types */
    IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
    /** Allowed document MIME types */
    DOCUMENT_TYPES: ['application/pdf', 'image/jpeg', 'image/png'],
});

// PAGINATION

const PAGINATION = Object.freeze({
    DEFAULT_PAGE_SIZE: 20,
    MAX_PAGE_SIZE: 100,
});

// PAYMENT

const PAYMENT = Object.freeze({
    /**
     * Revision deadline (business days) after audit/reviewer rejection.
     * Flow: audit/reviewer ปฏิเสธ/ให้แก้ไข → ผู้สมัครมี 5 วันทำการแก้ไข
     *       → ถ้าเกิน 5 วันทำการ → เอกสาร auto-rejected
     *
     * RESUBMISSION_FEE (5,000) used to sit on the next line, and the comment
     * above used to end "→ ต้องชำระ 5,000 บาท เพื่อยื่นเอกสารใหม่". Both are gone
     * (operator 2026-09-05, "hardcode ที่เป็นตัวเลขเก่า ให้ทำการคลีนทั้งหมด").
     * The rule they described — max 3 resubmissions, pay to file again — was
     * cancelled by R2 M6 / D-2, and the constant had exactly ONE occurrence in
     * the whole repository: its own declaration. Nothing read it, so nobody was
     * ever charged it; what it did instead was sit in the fee config looking
     * like a live price, which is the misunderstanding this clean-up is for.
     * d2-resubmission-retired.test.js pins it dead.
     */
    REVISION_DEADLINE_BUSINESS_DAYS: 5,
    /** Invoice expiry in minutes */
    INVOICE_EXPIRY_MINUTES: 60,
    // GATEWAY_PROVIDER ('MOCK_PROMPTPAY') removed 2026-06-04 — dead config
    // (CONFIG.gateway.provider had no readers; slip-flow is canonical).
    /**
     * Invoice payment due window per checkout milestone, in BUSINESS days
     * counted from the mint instant (operator decision Q2-D1, W3-41).
     * Consumed by services/checkout/checkout-schedule-service.js, which
     * computes the date on the canonical Thai working-day calendar
     * (utils/working-days.js) — never hardcode these numbers elsewhere.
     */
    INVOICE_DUE_BUSINESS_DAYS: Object.freeze({
        M1: 7,
        M2: 15,
    }),
    /**
     * Payment reminder schedule (business days), derived from Invoice.dueDate
     * by checkout-schedule-service. PRE_DUE fires this many business days
     * BEFORE the due date; DUE_DATE fires on it; OVERDUE_NOTICE on the next
     * working day after it (dispatching the reminders is D2 work).
     */
    PAYMENT_REMINDER: Object.freeze({
        PRE_DUE_BUSINESS_DAYS: 3,
    }),
    /**
     * Quotation validity window, in BUSINESS days from the issue instant
     * (operator ruling, re-confirmed 2026-09-27: "ใบเสนอราคามีกำหนดยืนราคา
     * 7 วันทำการ นับจากวันที่ออก โดยไม่นับวันที่ออก"). Consumed by
     * services/quotation-service.js (issueQuotationsForApplication), which
     * computes `validUntil` on the canonical Thai working-day calendar
     * (utils/working-days.js addWorkingDays) — never hardcode this number
     * elsewhere. Replaces the retired 30-CALENDAR-day default.
     */
    QUOTATION_VALIDITY_BUSINESS_DAYS: 7,
    /**
     * R2 M5 — payment-abandonment auto-close threshold, in CALENDAR days
     * (operator decision, evidence/R2-special-reopen/decisions-final.md:65).
     * An application whose PENDING checkout invoice is past its dueDate by MORE
     * than this many calendar days — AND that has received all three payment
     * reminders (PRE_DUE / DUE_DATE / OVERDUE_NOTICE) — is auto-closed as
     * PAYMENT_ABANDONED by jobs/payment-closure-job.js. REVERSIBLE: tuning this
     * only changes how long an unpaid case waits before it is marked abandoned;
     * it moves, refunds, or mutates NO money. Read via config (Law 3.5) — the
     * job never hardcodes the number.
     */
    PAYMENT_ABANDONMENT_CLOSE_CALENDAR_DAYS: 30,
});

// SECURITY

const SECURITY = Object.freeze({
    /** Default bcrypt hash rounds */
    BCRYPT_ROUNDS: 12,
    /** Password reset token expiry (ms) — 1 hour */
    RESET_TOKEN_EXPIRY_MS: 60 * 60 * 1000,
    /** Max failed login attempts before lockout */
    MAX_LOGIN_ATTEMPTS: 5,
    /** Account lock duration (ms) — 30 minutes */
    ACCOUNT_LOCK_DURATION_MS: 30 * 60 * 1000,
});

// EXPORTS

/**
 * อายุใบรับรอง (ปี) — **operator ยืนยันแล้ว 2026-09-11: หนึ่งปี**
 *
 * ═══ ที่มา และสิ่งที่ที่มานี้ไม่ใช่ ═══
 * ตัวเลขนี้เป็น **การตัดสินของเจ้าของ scheme** ไม่ใช่การอ้างเอกสารของกรม ·
 * ค้นเอกสารทางการสองฉบับ (แบบ กทล.1 และข้อกำหนดฯ Thailand Cannabis GACP) เมื่อ
 * 2026-09-11 แล้ว **ไม่มีฉบับใดระบุอายุใบรับรอง** — ข้อเท็จจริงนั้นยังเป็นจริงอยู่
 * ⇒ ถ้าวันหนึ่งกรมประกาศอายุที่ต่างไป นี่คือจุดที่ต้องกลับมาแก้ และเป็นการแก้
 * มติของเรา ไม่ใช่การแก้ความผิดพลาด
 *
 * ค่าเดิมคือ `const validYears = 3;` ฝังกลางฟังก์ชันออกใบ พร้อมคอมเมนต์
 * `// Standard GACP` ซึ่งทำให้เลขที่ระบบประกาศเองอ่านเหมือนเป็นเลขของมาตรฐาน —
 * นั่นอันตรายกว่าไม่มีคอมเมนต์ เพราะมันปิดคำถาม
 *
 * ISO/IEC 17065:2012 §7.7.1(e) บังคับให้ใบระบุ "the term or expiry date of
 * certification" คือต้อง **มี** อายุ แต่ไม่ได้กำหนดว่ากี่ปี · ความยาวเป็นของ scheme owner
 *
 * ═══ หนึ่งใบ หนึ่งรูปแบบการปลูก ═══
 * operator 2026-09-11: กรมออกใบ "ตามจำนวนรูปแบบการขอ" ⇒ ผ่านสองรูปแบบ = สองใบ
 * คนละเลข **คนละวันหมดอายุ** เพราะแต่ละใบเริ่มนับจากวันที่รูปแบบนั้นผ่าน
 * ⇒ ต่ออายุแยกใบ (มติเดียวกัน)
 */
const CERTIFICATE = Object.freeze({
    /** operator ยืนยัน 2026-09-11 · เอกสารกรมไม่ได้ระบุอายุ — นี่คือมติของเรา */
    VALIDITY_YEARS: 1,
});

module.exports = {
    CERTIFICATE,
    FEES,
    FEE_DEFAULTS,
    loadFeesFromSystemConfig,
    SETTLEMENT,
    SETTLEMENT_DEFAULTS,
    loadSettlementFromSystemConfig,
    ONSITE_AUDIT,
    FILE_LIMITS,
    PAGINATION,
    PAYMENT,
    SECURITY,
};
