'use strict';

const { OCR_CONFIDENCE_MIN } = require('../catalog');

/**
 * READABILITY: `PASS` | `UNREADABLE` | `PAGE_COUNT`.
 *
 * "ไฟล์เปล่า/ไม่มีข้อความ หรือค่าความมั่นใจของ OCR ต่ำกว่าเกณฑ์ (เกณฑ์กำหนดจาก
 * ชุดทดสอบ ไม่เดา) → UNREADABLE · จำนวนหน้าผิดจากที่ catalog ระบุ → PAGE_COUNT"
 * (design note 2026-09-27-document-precheck-design §3).
 *
 * `catalogEntry.expectedPages` is unset for every slot in the real CATALOG
 * (no กทล.1/facts.md source states a page count for any of the 7 slots —
 * see catalog.js's module doc comment), so the PAGE_COUNT branch below is
 * exercised only by a synthetic catalog entry in the test file, never by
 * production data. The branch still has to exist: the CATALOG interface
 * names `expectedPages?: number` as a first-class field a future, sourced
 * value can be dropped into without touching this file.
 *
 * @param {{method?: string, pageCount?: number, pages?: {text: string, confidence?: number}[]}} extraction
 * @param {{expectedPages?: number}} [catalogEntry]
 * @param {number} [ocrConfidenceMin] defaults to `OCR_CONFIDENCE_MIN`; only the
 *   Task 9 accuracy report passes another value (its threshold sweep).
 * @returns {{check: 'READABILITY', result: 'PASS'|'UNREADABLE'|'PAGE_COUNT', reasonTH: string, confidence: number}}
 */
function checkReadability(extraction, catalogEntry, ocrConfidenceMin = OCR_CONFIDENCE_MIN) {
    const pages = (extraction && extraction.pages) || [];
    const hasText = pages.some((p) => p && typeof p.text === 'string' && p.text.trim().length > 0);

    if (!extraction || extraction.method === 'NONE' || pages.length === 0 || !hasText) {
        return {
            check: 'READABILITY',
            result: 'UNREADABLE',
            reasonTH: 'ไม่พบข้อความในเอกสาร กรุณาอัปโหลดไฟล์ที่อ่านได้ชัดเจนกว่านี้',
            confidence: 0,
        };
    }

    const confidences = pages.map((p) => (typeof p.confidence === 'number' ? p.confidence : 100));
    const avgConfidence = confidences.reduce((sum, c) => sum + c, 0) / confidences.length;

    if (avgConfidence < ocrConfidenceMin) {
        return {
            check: 'READABILITY',
            result: 'UNREADABLE',
            reasonTH: 'คุณภาพภาพไม่ชัดเจนพอให้ตรวจอัตโนมัติ กรุณาอัปโหลดไฟล์ที่คมชัดกว่านี้',
            confidence: avgConfidence,
        };
    }

    if (
        catalogEntry &&
        typeof catalogEntry.expectedPages === 'number' &&
        typeof extraction.pageCount === 'number' &&
        extraction.pageCount !== catalogEntry.expectedPages
    ) {
        return {
            check: 'READABILITY',
            result: 'PAGE_COUNT',
            reasonTH: `จำนวนหน้าไม่ตรงกับที่คาด (คาด ${catalogEntry.expectedPages} หน้า พบ ${extraction.pageCount} หน้า)`,
            confidence: avgConfidence,
        };
    }

    return {
        check: 'READABILITY',
        result: 'PASS',
        reasonTH: 'อ่านเอกสารได้ชัดเจน',
        confidence: avgConfidence,
    };
}

module.exports = { checkReadability };
