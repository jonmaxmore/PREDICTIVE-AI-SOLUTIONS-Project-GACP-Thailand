'use strict';

const { CATALOG, OCR_CONFIDENCE_MIN } = require('./catalog');
const { NAME_SIMILARITY_MIN } = require('./normalize');
const { checkReadability } = require('./rules/readability');
const { checkDocType } = require('./rules/doc-type');
const { checkCrossMatch } = require('./rules/cross-match');
const { checkValidity } = require('./rules/validity');
const { checkSignature } = require('./rules/signature');

const RAW_THIRTEEN_DIGITS_RE = /\d{13}/;

/**
 * decision 3 (task-3-brief.md): "reasonTH never contains a full 13-digit
 * number (regex \d{13} absent)". Every rule in `rules/*.js` is written so
 * this can never happen by construction (ids only ever reach a flag through
 * `maskId`) — this is the fail-loud backstop, not the mechanism: a rule that
 * regresses trips this instead of silently shipping a raw id.
 */
function assertNoRawId(flag) {
    if (RAW_THIRTEEN_DIGITS_RE.test(flag.reasonTH || '') || RAW_THIRTEEN_DIGITS_RE.test(flag.evidenceSnippet || '')) {
        throw new Error(`document-precheck evaluate(): flag "${flag.check}" leaked an unmasked 13-digit id`);
    }
    return flag;
}

/**
 * `evaluate({ extraction, reference, slotId, now })` — the pure rule layer
 * for the document pre-check feature. No I/O, no DB, no OCR: `extraction`
 * (per-page text + confidence, Task 4) and `reference` (the applicant's
 * on-file identity/entity data, Task 6) are both already loaded by the
 * caller.
 *
 * Runs readability, then doc-type and cross-match (both short-circuit to
 * `UNREADABLE`/`NOT_FOUND` when readability failed — see
 * `unreadable-short-circuits`), then validity ONLY when `slotId`'s CATALOG
 * entry carries a validity rule (today: `company_reg` alone), then
 * signature (always `MANUAL`).
 *
 * Fix round 1 (task-3-review.md, Important #5): doc-type and cross-match can
 * each also return `null` when their own criterion is unsourced for this
 * slot (`land_lease` has no doc-type phrase; `previous_cert` has no
 * cross-match reference field — both in catalog.js) — "เกณฑ์ที่หาที่มาไม่ได้จะ
 * ไม่ตรวจ" applies to every check, not only validity. `null` results are
 * filtered out here, same as validity's pre-existing `null` omission.
 *
 * `thresholds` is optional and only ever passed by the Task 9 accuracy report
 * (`scripts/document-precheck/accuracy-report.js`), which sweeps both values
 * over the corpus. Omitted (every production caller), the two constants apply.
 *
 * @param {{extraction: object, reference: object, slotId: string, now: Date, thresholds?: {ocrConfidenceMin?: number, nameSimilarityMin?: number}}} args
 * @returns {Array<{check: 'READABILITY'|'DOC_TYPE'|'CROSS_MATCH'|'VALIDITY'|'SIGNATURE', result: string, reasonTH: string, confidence: number, evidenceSnippet?: string}>}
 */
function evaluate({ extraction, reference, slotId, now, thresholds = {} }) {
    const catalogEntry = CATALOG[slotId];
    if (!catalogEntry) {
        throw new TypeError(`document-precheck evaluate(): slotId "${slotId}" is outside the 7-slot CATALOG scope`);
    }

    const ocrConfidenceMin = thresholds.ocrConfidenceMin ?? OCR_CONFIDENCE_MIN;
    const nameSimilarityMin = thresholds.nameSimilarityMin ?? NAME_SIMILARITY_MIN;

    const readability = checkReadability(extraction, catalogEntry, ocrConfidenceMin);
    const extractionConfidence = readability.confidence;

    const flags = [
        readability,
        checkDocType(extraction, catalogEntry, readability.result, extractionConfidence),
        checkCrossMatch(extraction, reference, catalogEntry, readability.result, extractionConfidence, nameSimilarityMin),
        checkValidity(extraction, catalogEntry, now, readability.result, extractionConfidence),
        checkSignature(),
    ].filter(Boolean);

    return flags.map(assertNoRawId);
}

module.exports = {
    evaluate,
    OCR_CONFIDENCE_MIN,
    NAME_SIMILARITY_MIN,
};
