'use strict';

/**
 * Quality Scoring Service — สัญญา C05F680149 ต้นแบบที่ 6 โมดูล 6.2
 * "ระบบให้คะแนนคุณภาพ" (5 ด้าน, 1-100 + ใบรับรองคุณภาพดิจิทัล).
 *
 * Deterministic weighted composite over 5 measured sub-scores — real, no ML,
 * fully testable. This scores PRODUCT quality (of a harvest batch) and is
 * explicitly NOT the GACP certification decision (which stays human PASS/FAIL,
 * owner ruling #298/#528). The "digital quality certificate" here is a product-
 * grade sheet, not the DTAM GACP certificate.
 */

// 5 เกณฑ์ตามเอกสารแนบ A3 (สัญญาหน้า 51/81) — น้ำหนักรวม = 1
const DIMENSIONS = Object.freeze([
    { key: 'COLOR', labelTH: 'สี', weight: 0.15 },
    { key: 'SIZE', labelTH: 'ขนาด', weight: 0.15 },
    { key: 'MOISTURE', labelTH: 'ความชื้น', weight: 0.25 },
    { key: 'CONTAMINATION', labelTH: 'สิ่งปนเปื้อน', weight: 0.25 },
    { key: 'ACTIVE_COMPOUND', labelTH: 'สารสำคัญ', weight: 0.20 },
]);

function httpError(statusCode, code, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.code = code;
    return err;
}

function gradeFor(score) {
    if (score >= 80) { return 'A'; }
    if (score >= 65) { return 'B'; }
    if (score >= 50) { return 'C'; }
    return 'D';
}

/**
 * @param {Record<string, number>} subScores — one 0-100 value per DIMENSION key
 * @returns {{score:number, grade:string, dimensions:Array}}
 */
function computeQualityScore(subScores) {
    const input = subScores || {};
    for (const dim of DIMENSIONS) {
        const v = input[dim.key];
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) {
            throw httpError(400, 'QUALITY_INPUT_INVALID',
                `Dimension ${dim.key} must be a number 0-100`);
        }
    }

    const dimensions = DIMENSIONS.map((dim) => ({
        key: dim.key,
        labelTH: dim.labelTH,
        weight: dim.weight,
        subScore: input[dim.key],
        weightedContribution: dim.weight * input[dim.key],
    }));

    const raw = dimensions.reduce((a, d) => a + d.weightedContribution, 0);
    const score = Math.round(raw);
    return { score, grade: gradeFor(score), dimensions };
}

/**
 * Map a raw moisture percentage to a 0-100 sub-score: full marks inside the
 * ideal band, decaying linearly outside it (dry herbs ~8-12%).
 */
function scoreMoistureBand(moisturePct, { idealMin = 8, idealMax = 12, decayPerPct = 5 } = {}) {
    if (typeof moisturePct !== 'number' || !Number.isFinite(moisturePct)) { return 0; }
    if (moisturePct >= idealMin && moisturePct <= idealMax) { return 100; }
    const distance = moisturePct < idealMin ? idealMin - moisturePct : moisturePct - idealMax;
    return Math.max(0, Math.min(100, Math.round(100 - distance * decayPerPct)));
}

/** Digital quality certificate payload (product-grade, NOT the GACP cert). */
function buildQualityCertificate({ result, herbCode, batchNumber, issuedAt }) {
    return {
        kind: 'PRODUCT_QUALITY_ASSESSMENT',
        herbCode: herbCode || null,
        batchNumber: batchNumber || null,
        score: result.score,
        grade: result.grade,
        dimensions: result.dimensions,
        issuedAt: issuedAt || null,
        disclaimer: 'เอกสารประเมินคุณภาพผลผลิต ไม่ใช่ใบรับรองมาตรฐาน GACP; ' +
            'การรับรอง GACP เป็นการตัดสินของผู้ตรวจประเมินตามกระบวนการปกติ',
    };
}

module.exports = {
    DIMENSIONS,
    computeQualityScore,
    scoreMoistureBand,
    buildQualityCertificate,
};
