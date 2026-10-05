'use strict';

/**
 * SIGNATURE is always `MANUAL` — no automatic signature/seal detection in
 * this round ("ลายมือชื่อ/ตรา: ให้เจ้าหน้าที่ตรวจเองในรอบแรก · ระบบไม่อ้างว่าตรวจ
 * ลายเซ็นได้", design doc §1 + §3). Not sourced from a facts.md/กทล.1 line —
 * this one is an operator scope decision (§1's decision table), which is why
 * it carries no `source` string the way CATALOG rules do.
 *
 * @returns {{check: 'SIGNATURE', result: 'MANUAL', reasonTH: string, confidence: number}}
 */
function checkSignature() {
    return {
        check: 'SIGNATURE',
        result: 'MANUAL',
        reasonTH: 'ให้เจ้าหน้าที่ตรวจลายมือชื่อและตราประทับด้วยตนเอง',
        confidence: 0,
    };
}

module.exports = { checkSignature };
