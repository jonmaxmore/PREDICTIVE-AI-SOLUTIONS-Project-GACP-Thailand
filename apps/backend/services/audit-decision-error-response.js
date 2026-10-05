'use strict';

const { lookup: lookupErrorCode } = require('../shared/error-codes');

/**
 * Turn a cert-auto-generation failure into the answer the auditor actually needs.
 *
 * F-WALK-01 (walked 2026-09-06): pressing PASS on the desktop audit-decision door with no
 * onsite audit recorded returned a blanket HTTP 500 "Failed to record audit decision". The
 * real reason — assertOnsiteEvidenceSufficient threw NO_ONSITE_AUDIT, so the certificate
 * cannot issue until the field audit is recorded — died in the catch. The auditor read a
 * server error where they should have read "record the onsite audit first".
 *
 * writeApplicationStatus wraps the originating error and CARRIES its `.code` and, when the
 * error had one, its `.statusCode` (application-status-writer.js — CERT_AUTO_GEN_ROLLBACK).
 * So the route can map the code to a 4xx the auditor can act on, with a Thai sentence, and
 * fall through to 500 only for a genuinely unexpected failure.
 *
 * Returns { status, body } for a known, correctable failure; null when the error is not one
 * of them (the caller answers 500). Pure — no I/O, unit-tested.
 */

/**
 * Onsite-evidence-gate codes: the decision is refused because the evidence is not there.
 * The wording is the catalogue's (shared/error-codes.js) — one place to read and change
 * what the inspector and the approver are told; this module only decides the status.
 */
const ONSITE_EVIDENCE_CODES = Object.freeze([
    'NO_ONSITE_AUDIT',
    'AUDIT_APPLICATION_MISMATCH',
    'EVIDENCE_CAPTURE_UNAVAILABLE',
    'INSUFFICIENT_PHOTOS',
    'INCOMPLETE_CHECKLIST',
    'CRITICAL_CHECKLIST_FAILURE',
]);

/**
 * The 4xx answer for a refusal from assertOnsiteEvidenceSufficient, or null when the error
 * is not one. Used by EVERY door that records or acts on a PASS (job-sheet, audit result,
 * workflow-transitions, final-approvals) so the evidence refusal reads the same wherever it
 * lands — a coded 422 with the catalogue's Thai sentence, never a blanket 500.
 */
function onsiteEvidenceRefusal(error) {
    const code = error?.code || error?.cause?.code || null;
    if (!code || !ONSITE_EVIDENCE_CODES.includes(code)) { return null; }
    const entry = lookupErrorCode(code);
    return {
        status: 422,
        body: {
            success: false,
            code,
            error: entry?.messageTh || entry?.messageEn || code,
            messageTh: entry?.messageTh || null,
        },
    };
}

function auditDecisionErrorResponse(error) {
    const evidence = onsiteEvidenceRefusal(error);
    if (evidence) { return evidence; }
    const code = error?.code || error?.cause?.code || null;

    // Certificate-generation refusals (e.g. CERTIFICATE_FARM_LOCATION_MISSING,
    // CERTIFICATE_PLANT_UNKNOWN) carry their own 4xx statusCode and a Thai message on the
    // cause. Honour that intent instead of flattening it to 500.
    const statusCode = error?.statusCode || error?.cause?.statusCode || null;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
        const stated = error?.cause?.message || error?.message || null;
        return {
            status: statusCode,
            body: {
                success: false,
                code: code || 'CERTIFICATE_NOT_ISSUED',
                error: 'Certificate could not be issued',
                messageTh: withRemedyForTheAuditor(code, stated),
            },
        };
    }

    return null;
}


/**
 * คำปฏิเสธที่มาถึงประตูนี้ ถูกอ่านโดย "ผู้ตรวจแปลง" — ไม่ใช่ผู้ยื่น และไม่ใช่ผู้ดูแลระบบ
 *
 * เดินจริงบน staging 2026-09-07: ผู้ตรวจกดบันทึกผลว่าผ่าน แล้วได้
 * CERTIFICATE_FARM_LOCATION_MISSING พร้อมประโยค "กรุณาแก้ไขข้อมูลที่ตั้งฟาร์มในคำขอ…"
 * ซึ่งสั่งสิ่งที่ผู้ตรวจทำไม่ได้ — PATCH /api/farms/:id เฝ้าด้วย authenticateHealth และ
 * ผูกกับเจ้าของฟาร์ม · ผู้ตรวจจึงติดกำแพงที่มีป้ายชี้ไปยังประตูที่เขาเปิดไม่ได้ และเจ้าของ
 * ฟาร์มก็ไม่รู้ว่ามีอะไรค้างอยู่
 *
 * ทางที่ประตูนี้มีจริงคือส่งกลับไปให้ผู้ยื่นแก้ (AUDIT_CONFIRMED → CAR_PENDING)
 * ข้อเท็จจริงว่าอะไรขาดยังเป็นของ certificate-service เหมือนเดิม — ที่เติมตรงนี้คือ
 * "แล้วคนที่ยืนอยู่ตรงประตูนี้ทำอะไรได้"
 */
const APPLICANT_DATA_REFUSALS = new Set([
    'CERTIFICATE_FARM_LOCATION_MISSING',
    'CERTIFICATE_FARM_NAME_MISSING',
    'CERTIFICATE_PLANT_UNKNOWN',
    'CERTIFICATE_HOLDER_MISMATCH',
]);

const AUDITOR_REMEDY_TH = 'ข้อมูลนี้แก้ได้โดยผู้ยื่นคำขอเท่านั้น '
    + 'กรุณาส่งกลับให้ผู้ยื่นแก้ไข (ขอให้แก้ไข/CAR) แล้วบันทึกผลอีกครั้งเมื่อแก้ครบ';

/** ตัดประโยคที่สั่งผู้ตรวจให้ไปแก้ข้อมูลเอง แล้วต่อด้วยทางที่เขาเดินได้ */
function withRemedyForTheAuditor(code, stated) {
    if (!stated) { return stated; }
    if (!APPLICANT_DATA_REFUSALS.has(String(code || ''))) { return stated; }
    const fact = String(stated).replace(/\s*กรุณาแก้ไข[^]*$/u, '').trim();
    return `${fact} ${AUDITOR_REMEDY_TH}`;
}

module.exports = { auditDecisionErrorResponse, onsiteEvidenceRefusal, ONSITE_EVIDENCE_CODES, AUDITOR_REMEDY_TH };
