/**
 * @swagger
 * tags:
 *   name: Pricing
 *   description: Fee and pricing management
 */

const express = require('express');
const { safeErrorMessage } = require('../../../shared/api-response');
const router = express.Router();
// No SystemConfig read here any more: the `pricing_fees` override was removed
// (fix/fees-from-server round 1, 2026-10-03). Fees reach this route only
// through the engine, which reads the fee.* keys (config/business-rules.js).
const logger = require('../../../shared/logger');
const { ERROR_CODES } = require('../../../shared/error-codes');
const { getZonedParts, localYear } = require('../../../utils/working-days');
// C1-03 (audit 2026-06-10): estimates must match the binding invoice math.
// Canonical two-money-flow engine (ม.86 one-document-one-seller): state fee is
// VAT-EXEMPT (ม.77/1(10)); the 10% platform fee carries 7% VAT. Same engine
// quotation-service uses to write the real invoices — so the wizard estimate
// can never understate what the applicant is actually charged.
// `billing` is kept whole so VAT_RATE is read when a request is answered, not
// copied when this file loads (fix/fees-from-server round 2).
const billing = require('../../../modules/billing');
const {
    calculatePhase1Fee,
    calculatePhase2Fee,
    calculateRenewalFee,
    FEE_RATES,
} = billing;
// ชื่อและความครอบคลุมของแต่ละบรรทัด — แค็ตตาล็อกเดียว (operator 2026-10-03)
const { serviceFor, catalogueForApi } = require('../../../shared/instalment-service-names');

/**
 * W11-1 — /api/pricing FAILS CLOSED.
 *
 * Until 2026-08-22 both read routes swallowed an internal error and answered
 * `200 { success: true, data: defaultFeesPayload() }`. An applicant whose
 * SystemConfig lookup blew up was therefore quoted a number the platform had
 * never verified, indistinguishable on the wire from a real quote. A fee shown
 * to an applicant must come from the canonical engine or not be shown at all,
 * so an error is now an error. This REMOVES a wrong-number path — it computes,
 * settles and mutates nothing.
 *
 * What remains to fail is the engine itself (defaultFeesPayload throwing):
 * that is still answered PRICING_UNAVAILABLE, never a made-up 200. The stored
 * `pricing_fees` override that used to sit in front of the engine was removed
 * on 2026-10-03 (fix/fees-from-server round 1).
 */
function pricingUnavailable(res, error) {
    logger.error('[Pricing] fee table unavailable — refusing to quote:', error);
    const spec = ERROR_CODES.PRICING_UNAVAILABLE;
    return res.status(spec.httpStatus).json({
        success: false,
        error: spec.code,
        message: spec.messageTh,
    });
}

/**
 * Pure pricing helper extracted for unit-testability (P0-6).
 *
 * Both fees scale per cultivation-method count, matching the canonical
 * calculatePhase1Fee / calculatePhase2Fee in services/fee-service.js.
 *
 * @param {Object} opts
 * @param {number} [opts.areaCount=1]            number of cultivation methods
 * @param {boolean} [opts.includeInspection=true] include phase-2 audit fee
 * @param {number} [opts.applicationFee] per-method phase-1 state fee
 *        (default: FEE_RATES.PHASE1_PER_SCOPE — 5,000)
 * @param {number} [opts.inspectionFee]  ค่าบริการงวดที่ 2 ต่อรูปแบบ ก่อน VAT
 *        (ปริยาย: FEE_RATES.PHASE2_PER_SCOPE — 27,500)
 */
function computePricing({
    areaCount = 1,
    includeInspection = true,
    // อ่านอัตราจากตัวคำนวณกลางแทนการสะกดตัวเลขซ้ำที่นี่ · FEE_RATES คืออ็อบเจ็กต์เดียวกับ
    // ที่ calculatePhase1Fee/calculatePhase2Fee ใช้ออกใบ ⇒ ตัวช่วยนี้กับยอดเต็มข้างล่าง
    // ขัดกันไม่ได้ · ค่าบริการก่อน VAT: 5,500 / 27,500 — ตรึงที่ fee-table-ssot.test.js
    applicationFee = FEE_RATES.PHASE1_PER_SCOPE,
    inspectionFee = FEE_RATES.PHASE2_PER_SCOPE,
} = {}) {
    const phase1Total = applicationFee * areaCount;
    const phase2Total = includeInspection ? inspectionFee * areaCount : 0;
    return { phase1Total, phase2Total, total: phase1Total + phase2Total };
}

/**
 * C1-03: full two-money-flow estimate, exported pure for unit tests.
 *
 * สร้างจากตัวคำนวณกลาง ตัวเลขจึงตรงกับใบแจ้งหนี้ที่ผู้ยื่นจะได้รับทุกบาท
 * (5,885 / 29,425 ต่อหนึ่งรูปแบบการปลูก):
 *   - หนึ่งบรรทัดต่องวด = ค่าบริการ ไม่มีการแยกส่วน ไม่มีบรรทัดใดยกเว้น VAT
 *   - subtotal = ค่าบริการ (ก่อน VAT) · total = subtotal + vat
 *
 * หมายเหตุ: `computePricing` ข้างบนคืนยอดก่อน VAT ล้วน ๆ คงไว้ตามสัญญาของเทสเดิม
 * ส่วนคำตอบของ /calculate สร้างจากยอดเต็มข้างล่างนี้
 */
function buildEstimateBreakdown({ areaCount = 1, includeInspection = true } = {}) {
    const scopeCount = Number.isFinite(areaCount) && areaCount > 0 ? Math.floor(areaCount) : 1;
    const phase1 = calculatePhase1Fee({}, { scopeCount });
    const phase2 = includeInspection ? calculatePhase2Fee({}, { scopeCount }) : null;

    // หนึ่งบรรทัดต่องวด ไม่ใช่สองบรรทัดแยกรัฐ/แพลตฟอร์ม (operator 2026-09-11)
    // `vatExempt` ถูกถอดไปด้วย: ไม่มีบรรทัดใดได้รับยกเว้น VAT อีกแล้ว ค่าบริการทั้งก้อน
    // เป็นรายได้ที่ต้องเสีย VAT ของบริษัท — ธงที่เหลืออยู่บนบรรทัดที่ไม่มีการยกเว้น
    // คือคำเชิญให้คนอ่านเชื่อว่ายังมีการยกเว้นอยู่
    const items = [
        {
            description: serviceFor(1).name,
            quantity: scopeCount,
            unitPrice: phase1.serviceFeeAmount / scopeCount,
            total: phase1.serviceFeeAmount,
        },
    ];
    if (phase2) {
        items.push({
            description: serviceFor(2).name,
            quantity: scopeCount,
            unitPrice: phase2.serviceFeeAmount / scopeCount,
            total: phase2.serviceFeeAmount,
        });
    }

    const serviceFeeTotal = phase1.serviceFeeAmount + (phase2 ? phase2.serviceFeeAmount : 0);
    const vatTotal = phase1.vatAmount + (phase2 ? phase2.vatAmount : 0);

    return {
        scopeCount,
        items,
        breakdown: {
            phase1: {
                serviceFeeAmount: phase1.serviceFeeAmount,
                vatAmount: phase1.vatAmount,
                phaseTotal: phase1.phaseTotal,
            },
            phase2: phase2
                ? {
                    serviceFeeAmount: phase2.serviceFeeAmount,
                    vatAmount: phase2.vatAmount,
                    phaseTotal: phase2.phaseTotal,
                }
                : null,
            serviceFeeTotal,
            vatTotal,
        },
        subtotal: serviceFeeTotal,
        vat: vatTotal,
        total: serviceFeeTotal + vatTotal,
        currency: 'THB',
    };
}

/**
 * Default public fee payload when no SystemConfig override exists.
 *
 * C1-03: เคยประกาศ `vatRate: 0` ซึ่งซ่อน VAT 7% ไว้ · ตอนนี้รายงานอัตราจริงและยอดเต็ม
 * ต่อหนึ่งรูปแบบการปลูกจากตัวคำนวณกลาง (5,885 / 29,425)
 *
 * `applicationFee` / `inspectionFee` คือ **ค่าบริการก่อน VAT** ต่อหนึ่งรูปแบบ ไม่ใช่
 * "ค่าธรรมเนียมรัฐที่ยกเว้น VAT" อย่างที่เคยเขียนไว้ (operator 2026-09-11 เลิกแยกส่วน)
 */
function defaultFeesPayload() {
    // W12 — the quoted renewal figures come from the SAME function the
    // quotation is billed from (modules/billing.calculateRenewalFee). This route
    // used to gross the base up with its own copy of the arithmetic; that copy
    // is gone, so the screen and the invoice cannot disagree by construction.
    // Per ONE cultivation scope — same catalogue convention as applicationFee
    // and inspectionFee above. A real renewal multiplies by the application's
    // scope count (operator correction 2026-08-22).
    const renewalFee = calculateRenewalFee({}, { scopeCount: 1 });
    return {
        // มาจากตัวคำนวณกลาง (FEE_RATES) ตัวเดียวกับที่ calculatePhase1Fee/calculatePhase2Fee
        // ใช้ออกใบ ⇒ ตัวเลขบนหน้าจอกับบนใบแจ้งหนี้ขัดกันไม่ได้โดยโครงสร้าง
        // ค่าบริการก่อน VAT ต่อหนึ่งรูปแบบ: 5,500 / 27,500 — ตรึงที่ fee-table-ssot.test.js
        applicationFee: FEE_RATES.PHASE1_PER_SCOPE,
        inspectionFee: FEE_RATES.PHASE2_PER_SCOPE,
        // W12 (operator ruling 2026-08-22, final) — closes W11-P7. This route
        // served 15,000 while the renewal wizard showed the applicant 30,000
        // from apps/web-app/src/constants/fees.ts: two live quotes for one
        // service. The amount now comes from the canonical fee table, and the
        // frontend mirror is pinned to it by renewal-fee-ssot.test.js.
        //
        // A renewal is ONE charge, not the phase pair — renewalChargeCount says
        // so explicitly rather than leaving a screen to infer the schedule from
        // an amount that coincidentally equals 5,000 + 25,000 today.
        renewalFee: renewalFee.serviceFeeAmount,
        renewalTotalPerScope: renewalFee.phaseTotal,
        renewalChargeCount: 1,
        // M4 (operator ruling 2026-08-23) — `expediteFee: 10000` stood here,
        // never SSoT-backed, and contradicted config/payment-fees.js, which
        // priced the same rush service at 3,000. The operator abolished it:
        // "ไม่มีค่าเร่งด่วน". The key is GONE from the response, not zeroed —
        // a 0 still advertises the option. Pinned by no-expedite-fee.test.js.
        currency: 'THB',
        vatRate: billing.VAT_RATE,
        // ยอดเต็มต่อหนึ่งรูปแบบการปลูก (ค่าบริการ + VAT 7%) ตรงกับที่ใบแจ้งหนี้คิด
        phase1TotalPerScope: calculatePhase1Fee({}, { scopeCount: 1 }).phaseTotal,
        phase2TotalPerScope: calculatePhase2Fee({}, { scopeCount: 1 }).phaseTotal,
        // fix/fee-line-descriptions — what each charge is called and covers, so the web
        // never keeps its own wording (the pricing page once claimed phase 2 paid for
        // inspector travel and lodging; it does not).
        services: catalogueForApi(billing.VAT_RATE),
        lastUpdated: getZonedParts(new Date()).isoDate, // Bangkok day
        validUntil: `${localYear()}-12-31`, // end of the Bangkok year
    };
}

/**
 * GET /api/pricing
 * Get platform fees (root alias for /fees)
 */
router.get('/', async (req, res) => {
    try {
        return res.json({ success: true, data: defaultFeesPayload() });
    } catch (error) {
        // W11-1 — was `return res.json({ success: true, data: defaultFeesPayload() })`.
        return pricingUnavailable(res, error);
    }
});

/**
 * @swagger
 * /api/pricing/fees:
 *   get:
 *     summary: Get platform fees
 *     tags: [Pricing]
 *     description: Returns current application and inspection fees
 *     responses:
 *       200:
 *         description: Fee structure
 */
router.get('/fees', async (req, res) => {
    try {
        // fix/fees-from-server round 1 (2026-10-03): this used to serve a stored
        // SystemConfig `pricing_fees` blob as-is when one existed — a second fee
        // source beside the engine invoices are billed from. Staging and demo
        // held no such row (coordinator, read-only, 2026-10-03), so removing it
        // changed nothing served. Fees are changed through the fee.* keys the
        // engine reads (config/business-rules.js). Pinned by
        // __tests__/unit/pricing-serves-the-engine-only.test.js.
        res.json({
            success: true,
            data: defaultFeesPayload(),
        });
    } catch (error) {
        // W11-1 — was "Return defaults even on error", i.e. a 200 carrying
        // numbers nobody verified. An unreadable fee table is now an error.
        return pricingUnavailable(res, error);
    }
});

/**
 * @swagger
 * /api/pricing/calculate:
 *   post:
 *     summary: Calculate total fees
 *     tags: [Pricing]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               serviceType:
 *                 type: string
 *                 enum: [NEW, RENEWAL, MODIFY]
 *               areaTypes:
 *                 type: array
 *                 items:
 *                   type: string
 *               includeInspection:
 *                 type: boolean
 */
router.post('/calculate', async (req, res) => {
    try {
        const { serviceType = 'NEW', areaTypes = ['OUTDOOR'], includeInspection = true } = req.body;

        // C1-03: the estimate previously returned the STATE-only total with
        // vat:0, understating the real charge (5,000 shown vs 5,535 invoiced
        // per scope). Build the response from the canonical two-money-flow
        // engine instead — identical math to the binding invoice.
        const areaCount = Array.isArray(areaTypes) ? areaTypes.length : 1;
        const estimate = buildEstimateBreakdown({ areaCount, includeInspection });

        res.json({
            success: true,
            data: {
                serviceType,
                areaTypes,
                ...estimate,
            },
        });
    } catch (error) {
        logger.error('[Pricing] Error:', error);
        res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

module.exports = router;
module.exports.computePricing = computePricing;
module.exports.buildEstimateBreakdown = buildEstimateBreakdown;
module.exports.defaultFeesPayload = defaultFeesPayload;
