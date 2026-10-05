'use strict';

/**
 * quotation-line-items.js — per-cultivation-type line items for the
 * farmer-facing ใบเสนอราคา (quotation).
 *
 * Owner spec (2026-06-05): the quotation lists ONE line per selected
 * cultivation type (Indoor / Greenhouse / Outdoor), and every type is priced
 * the SAME. The amounts come from the canonical fee math
 * (modules/billing/internal/fee-service.js) — this module does NOT invent
 * prices, it only re-presents the per-scope amounts as per-type rows so the
 * quotation can show "Indoor / Green-house / Outdoor" instead of one
 * aggregate "N cultivation methods" line.
 *
 * Two-money-flow (ม.86 one-document-one-seller):
 *   - side='DTAM'     → state fee only (VAT-exempt). Phase1=ค่ารีวิวเอกสาร,
 *                       Phase2=ค่าประเมิน/ตรวจรับรอง. Per-type total = 30,000
 *                       at the canonical 5,000 + 25,000 per-scope rate.
 *   - side='PLATFORM' → platform service fee + 7% VAT per type.
 *
 * Pure: no DB, no I/O — unit-testable directly.
 */

const { ISSUER_TYPES } = require('../config/invoice-issuers');

// Cultivation-type display labels. Keys are the normalized values produced by
// fee-service.collectUniqueCultivationMethods (INDOOR / GREENHOUSE / OUTDOOR).
//
// 2026-09-07 — these led with English ('Outdoor (กลางแจ้ง)') and the operator read
// their own payment screen as showing "รูปแบบการปลูก OUTDOOR": "ลองดูคำให้ถูกต้อง
// การใช้คำในแต่ละช่อง". The applicant ticked กลางแจ้ง on a Thai form; every surface
// that speaks to them leads with the word they ticked, English kept in parentheses
// for the audit trail. The Thai words come from CULTIVATION_LABELS_TH below — one
// vocabulary, two dressings, zero chances to disagree.
const CULTIVATION_LABELS = Object.freeze({
    INDOOR: 'อาคารระบบปิด (Indoor)',
    GREENHOUSE: 'โรงเรือน (Greenhouse)',
    OUTDOOR: 'กลางแจ้ง (Outdoor)',
});

/**
 * The SAME three types in the words the applicant actually ticked.
 *
 * `CULTIVATION_LABELS` above is the bilingual display form used inside the app; a money
 * document speaks the form's own language, and กทล.๑ ส่วนที่ ๒ prints กลางแจ้ง / โรงเรือน /
 * อาคารระบบปิด. Operator ruling 2026-09-06 asks the quotation line to read
 * "…แบบกลางแจ้ง งวดที่ 1", so the enum may not travel onto a document even in Thai clothes
 * ("ระบบ OUTDOOR", which is what the PDF said before).
 *
 * Deliberately in THIS file, beside the map it mirrors, rather than in a new module: four
 * Thai vocabularies for ลักษณะพื้นที่ already exist across the codebase and a fifth
 * source would trip the dup-source ratchet. Two maps in one file are one place to fix.
 */
const CULTIVATION_LABELS_TH = Object.freeze({
    INDOOR: 'อาคารระบบปิด',
    INDOOR_CONTROLLED: 'อาคารระบบปิด',
    GREENHOUSE: 'โรงเรือน',
    // The operator named this one as "glasshouse" (2026-09-06). The register's enum is
    // GREENHOUSE, but a spelling that reaches this map unmapped would print the raw code
    // on a tax document, so the alias is carried rather than assumed impossible.
    GLASSHOUSE: 'โรงเรือน',
    OUTDOOR: 'กลางแจ้ง',
});

/** The Thai form-word for a cultivation type; falls back to the code rather than lying. */
function thaiLabelForMethod(method) {
    const key = String(method || '').trim().toUpperCase();
    return CULTIVATION_LABELS_TH[key] || key || 'ไม่ระบุประเภท';
}

function labelForMethod(method) {
    const key = String(method || '').trim().toUpperCase();
    return CULTIVATION_LABELS[key] || key || 'ไม่ระบุประเภท';
}

/**
 * What a line is called when the application can no longer name it (ruling 12,
 * 2026-08-28): the row was priced for N cultivation methods and the application
 * now names a different number, so no line may claim one of them. The document
 * still shows N lines — the row's N — under a neutral name.
 */
function genericScopeLabel(index) {
    return `รูปแบบการปลูกที่ ${index + 1}`;
}

function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * ── ถอด buildQuotationLineItems ออก 2026-09-11 ────────────────────────────────
 * มันสร้างบรรทัดใบเสนอราคาโดยแยก "ฝั่งรัฐ" กับ "ฝั่งแพลตฟอร์ม" ออกจากกัน — โครงสร้างที่
 * operator สั่งเลิกใช้ ("ต่อไปนี้จะไม่มีการแยกค่าธรรมเนียมรัฐ ค่าบริการ จะเป็นค่าบริการทั้งหมด")
 * และมันไม่มีผู้เรียกในโค้ดจริงอยู่แล้ว — ใบเสนอราคาที่ออกจริงใช้
 * `buildQuotationLineItemsFromRow` ซึ่งอ่านจากแถวที่บันทึกไว้ ไม่ใช่จากตัวคำนวณค่าธรรมเนียม
 * (spec 3.2: เอกสารที่แสดงต้องเป็นเอกสารที่ถืออยู่)
 */

/**
 * The money THIS ROW asks for in one phase.
 *
 * ทุกงวดถือ `amount` ซึ่งเป็นยอดที่งวดนั้นเรียกเก็บจริง · เดิมมี fallback ที่บวก
 * stateAmount + platformAmount + vatAmount เข้าด้วยกันเมื่อไม่มี `amount` —
 * ถอดออก 2026-09-11 พร้อมกับการแยกส่วนที่มันอ่าน (operator: "แบบอื่นไม่ถูกต้อง
 * เก็บกวาดและคลีนทิ้งให้หมด") · แพลตฟอร์มยังไม่ขึ้นใช้งานจริง จึงไม่มีแถวเก่าให้ต้องรองรับ
 *
 * @param {object} instalment  one entry of Quotation.installments, or of a
 *   frozen acceptedSnapshot (where every money field is a 2-decimal string)
 * @returns {number} THB
 */
function instalmentPayable(instalment) {
    if (!instalment) { return 0; }
    const raw = instalment.amount;
    const amount = (raw === null || raw === undefined || raw === '') ? NaN : Number(raw);
    return Number.isFinite(amount) ? amount : 0;
}

/**
 * The VAT contained in what this row asks for. The state fee is VAT-exempt
 * (ม.77/1 (10) ป.รัษฎากร), so a DTAM row's price carries none; a PLATFORM row's
 * ค่าบริการทั้งก้อนเป็นรายได้ที่ต้องเสีย VAT ของบริษัท ⇒ ไม่มีฝั่งใดที่ VAT เป็นศูนย์อีกแล้ว
 * (เดิมยกเว้นให้ฝั่ง DTAM เพราะค่าธรรมเนียมรัฐถือเป็นรายรับของราชการ — เลิกใช้
 * 2026-09-11 พร้อมการแยกส่วน) · พารามิเตอร์ `issuerType` ถูกถอดไปด้วย เพราะการรับค่า
 * ที่ไม่มีผลต่อคำตอบ คือคำเชิญให้คนอ่านเชื่อว่ามันมีผล
 */
function instalmentVat(instalment) {
    if (!instalment) { return 0; }
    return Math.min(Number(instalment.vatAmount || 0), instalmentPayable(instalment));
}

/** The frozen document a row holds once accepted, or null while it has none. */
function frozenSnapshotOf(row) {
    return row?.acceptedSnapshot?.installments?.length ? row.acceptedSnapshot : null;
}

/**
 * How many cultivation scopes THIS ROW was priced for: its frozen snapshot's
 * count once accepted, else the count its own instalments record. `null` when
 * the row never recorded one (a pre-GAP-5 instalment carries `{phase, amount}`
 * only) — a row that never stated its scope count cannot contradict the
 * application, so the caller falls back to what the application names.
 *
 * @param {object} row  a Quotation row
 * @returns {number|null}
 */
function rowScopeCount(row) {
    const snapshot = frozenSnapshotOf(row);
    const source = snapshot ? snapshot.installments : (row?.installments || []);
    const declared = Number(snapshot?.scopeCount)
        || Number(source.find((it) => Number(it?.scopeCount) > 0)?.scopeCount)
        || 0;
    return declared > 0 ? Math.trunc(declared) : null;
}

/**
 * Split a stored total across the scopes in whole baht with the remainder on
 * the FIRST line, so the lines sum back to the total to the satang instead of
 * drifting by rounding.
 *
 * @param {number} total
 * @param {number} scopeCount
 * @returns {number[]} one amount per scope, summing to `total`
 */
function shareAcrossScopes(total, scopeCount) {
    const n = Math.max(1, Math.trunc(Number(scopeCount)) || 1);
    const amount = Number(total) || 0;
    const per = Math.floor(amount / n);
    return Array.from({ length: n }, (_unused, i) => (i === 0 ? amount - per * (n - 1) : per));
}

/**
 * The lines a document of `scopeCount` lines carries, named by the
 * application's cultivation methods ONLY while the two counts agree. When they
 * do not — the application was revised after the quotation was priced — every
 * line is named generically, because attributing the row's money to today's
 * methods would either drop lines or invent them (ruling 12).
 *
 * @param {number} scopeCount
 * @param {string[]} methods
 * @returns {Array<{method:string,label:string,generic:boolean}>}
 */
function scopeNamesFor(scopeCount, methods) {
    const n = Math.max(1, Math.trunc(Number(scopeCount)) || 1);
    const named = (Array.isArray(methods) ? methods : [])
        .filter((m) => String(m ?? '').trim() !== '');
    if (named.length === n) {
        return named.map((method) => ({ method, label: labelForMethod(method), generic: false }));
    }
    return Array.from({ length: n }, (_unused, i) => ({
        method: `SCOPE_${i + 1}`,
        label: genericScopeLabel(i),
        generic: true,
    }));
}

/**
 * The line count a stored row's document has, and what to call each line —
 * one resolver for the API, the PDF and the pure builder.
 *
 * The COUNT is the row's own (`rowScopeCount`); the application's current
 * cultivation methods only NAME the lines. `scopeMismatch` says the two
 * disagree, which is the applicant's cue that the quotation predates a
 * revision — the surface reports it, it does not silently reprice.
 *
 * @param {object} row  a Quotation row
 * @param {string[]} methods  the application's CURRENT unique methods
 * @returns {{scopeCount:number, applicationScopeCount:number,
 *            scopeMismatch:boolean, scopes:Array<{method,label,generic}>}}
 */
function resolveRowScopes(row, methods) {
    const applicationScopeCount = (Array.isArray(methods) ? methods : [])
        .filter((m) => String(m ?? '').trim() !== '').length;
    const declared = rowScopeCount(row);
    const scopeCount = Math.max(1, declared || applicationScopeCount || 1);
    return {
        scopeCount,
        applicationScopeCount,
        scopeMismatch: declared !== null
            && applicationScopeCount > 0
            && applicationScopeCount !== declared,
        scopes: scopeNamesFor(scopeCount, methods),
    };
}

/**
 * Per-scope line items derived from the STORED quotation, in this order of
 * preference: the frozen acceptedSnapshot, else the row's own installments.
 * Never the fee service (spec 3.2 — the document shown must be the document
 * held).
 *
 * The row also decides HOW MANY lines there are (ruling 12): a quotation
 * accepted for three cultivation methods keeps three lines summing to its own
 * total even after the application is revised down to one, and vice versa.
 *
 * @param {object} row  a Quotation row (installments, optionally acceptedSnapshot)
 * @param {string[]} methods  the application's CURRENT unique methods, for labelling
 * @returns {Array<{method, label, phase1Amount, phase2Amount, netAmount, taxAmount}>}
 */
function buildQuotationLineItemsFromRow(row, methods) {
    const snapshot = frozenSnapshotOf(row);
    const source = snapshot ? snapshot.installments : (row?.installments || []);
    const byPhase = Object.fromEntries(source.map((it) => [it.phase, it]));
    const { scopeCount, scopes } = resolveRowScopes(row, methods);
    const phase1 = instalmentPayable(byPhase.PHASE_1);
    const phase2 = instalmentPayable(byPhase.PHASE_2);
    const tax = instalmentVat(byPhase.PHASE_1) + instalmentVat(byPhase.PHASE_2);
    const phase1Shares = shareAcrossScopes(phase1, scopeCount);
    const phase2Shares = shareAcrossScopes(phase2, scopeCount);
    const netShares = shareAcrossScopes(phase1 + phase2 - tax, scopeCount);
    const taxShares = shareAcrossScopes(tax, scopeCount);
    return scopes.map((scope, index) => ({
        method: scope.method,
        label: scope.label,
        phase1Amount: phase1Shares[index],
        phase2Amount: phase2Shares[index],
        netAmount: netShares[index],
        taxAmount: taxShares[index],
    }));
}

module.exports = {
    buildQuotationLineItemsFromRow,
    instalmentPayable,
    instalmentVat,
    labelForMethod,
    thaiLabelForMethod,
    genericScopeLabel,
    rowScopeCount,
    resolveRowScopes,
    scopeNamesFor,
    shareAcrossScopes,
    CULTIVATION_LABELS,
    CULTIVATION_LABELS_TH,
};
