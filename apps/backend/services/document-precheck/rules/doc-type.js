'use strict';

const { normalizeKeyword, levenshteinDistance } = require('../normalize');

/**
 * Fix round 1 (task-3-review.md, Important #4): §3 asks for "จับคู่แบบ
 * คลาดเคลื่อนได้เล็กน้อยเพื่อรับ OCR ที่เพี้ยน" — an OCR-inserted space or a
 * single wrong character must still MATCH. The old version only collapsed
 * whitespace to one space (`normalizeKeyword`), which is not tolerant of an
 * OCR space landing INSIDE a phrase ("โฉนด ที่ดิน" vs "โฉนดที่ดิน") or of any
 * single wrong character ("โฉนดที่ดีน").
 *
 * Two-step tolerance, in order:
 * 1. Remove ALL whitespace (not just collapse it) on both sides, after
 *    `normalizeKeyword` (tone marks stripped, Thai digits -> Arabic). This
 *    alone fixes the inserted-space case and the Thai-digit-with-space case
 *    ("น.ส. ๓" vs "น.ส.3"), because an inserted space disappears entirely.
 * 2. A small edit-distance search over `normalize.js`'s own
 *    `levenshteinDistance` (exported for exactly this — the review's fix
 *    note: "reuse it, not copy it") — never a second Levenshtein
 *    implementation. This is deliberately a SMALL absolute tolerance
 *    (`DOC_TYPE_MAX_EDIT_DISTANCE`), not a similarity ratio: §6.4 asks for
 *    high precision on these flags ("เน้นให้ธงเตือนผิดน้อย"), and doc-type
 *    phrases are short, so 1 character of slack is already generous.
 *
 * This stays a different tolerance model from `rules/cross-match.js`'s NAME
 * matching on purpose: names must stay tone-SENSITIVE (a tone mark changes
 * who someone is), while a doc-type phrase is tone-INSENSITIVE by design
 * (`normalizeKeyword`'s own doc comment).
 *
 * Fix round 2 (task-3-rereview-1.md, N1): the edit-distance search is unsafe
 * on a SHORT phrase — deleting one character from "น.ส.3" (the land_deed
 * phrase) gives "น.ส." (the title for Miss), so any text merely naming a
 * "Miss" MATCHed land_deed. Phrases under `MIN_LEN_FOR_EDIT_TOLERANCE`
 * compact characters get no edit tolerance at all: only exact containment
 * after normalization (which already handles the legitimate OCR cases for
 * short phrases — an inserted space or a converted Thai digit disappears
 * entirely once whitespace is stripped, no edit distance needed for those).
 * Longer phrases (≥ the threshold) keep the ±1 tolerance from fix round 1.
 */
const DOC_TYPE_MAX_EDIT_DISTANCE = 1; // provisional — not swept; the backlog 2026-09-28 Task 9
const MIN_LEN_FOR_EDIT_TOLERANCE = 8; // provisional — not swept; the backlog 2026-09-28 Task 9

function compact(s) {
    return normalizeKeyword(s).replace(/\s+/g, '');
}

/**
 * Does `compactAlt` "fully appear" in `compactText`, tolerating at most
 * `DOC_TYPE_MAX_EDIT_DISTANCE` character-level edits — but ONLY when
 * `compactAlt` is at least `MIN_LEN_FOR_EDIT_TOLERANCE` characters long (fix
 * round 2, N1). Exact containment is always checked first.
 */
function altFullyAppears(compactText, compactAlt) {
    if (compactAlt.length === 0) {
        return false;
    }
    if (compactText.includes(compactAlt)) {
        return true;
    }
    if (compactAlt.length < MIN_LEN_FOR_EDIT_TOLERANCE) {
        return false;
    }
    const altLen = compactAlt.length;
    for (let deltaLen = -DOC_TYPE_MAX_EDIT_DISTANCE; deltaLen <= DOC_TYPE_MAX_EDIT_DISTANCE; deltaLen += 1) {
        const windowLen = altLen + deltaLen;
        if (windowLen <= 0) {
            continue;
        }
        for (let start = 0; start + windowLen <= compactText.length; start += 1) {
            const window = compactText.slice(start, start + windowLen);
            if (levenshteinDistance(window, compactAlt) <= DOC_TYPE_MAX_EDIT_DISTANCE) {
                return true;
            }
        }
    }
    return false;
}

/**
 * DOC_TYPE: `MATCH` | `NOT_FOUND` | `UNREADABLE` — or no flag at all.
 *
 * "ต้องพบวลีบังคับของชนิดนั้น (จับคู่แบบคลาดเคลื่อนได้เล็กน้อยเพื่อรับ OCR ที่เพี้ยน)
 * · อ่านไม่ออกไม่นับว่าผิดชนิด" (design doc §3) — an unreadable document is
 * `UNREADABLE`, never `NOT_FOUND` (that would read as "this document does not
 * look like the right type", which is not what happened).
 *
 * Fix round 1 (task-3-review.md, Important #5): a slot with no sourced
 * phrase (`land_lease` — see catalog.js) must not run this check AT ALL —
 * "เกณฑ์ที่หาที่มาไม่ได้จะไม่ตรวจ" (design doc §3). The old version returned a
 * `NOT_FOUND` flag every time, which read exactly like "wrong document type"
 * on every single land_lease upload. Returns `null` instead (checked first,
 * before readability — an unsourced criterion never runs, unreadable or not),
 * and `evaluate.js` omits the flag entirely, the same way it already omits
 * VALIDITY for a slot with no validity rule.
 *
 * @param {{pages?: {text: string}[]}} extraction
 * @param {{phrases?: string[][]}} catalogEntry
 * @param {string} readabilityResult
 * @param {number} extractionConfidence
 * @returns {null|{check: 'DOC_TYPE', result: 'MATCH'|'NOT_FOUND'|'UNREADABLE', reasonTH: string, confidence: number, evidenceSnippet?: string}}
 */
function checkDocType(extraction, catalogEntry, readabilityResult, extractionConfidence) {
    const phrases = (catalogEntry && catalogEntry.phrases) || [];
    if (phrases.length === 0) {
        return null;
    }

    if (readabilityResult === 'UNREADABLE') {
        return {
            check: 'DOC_TYPE',
            result: 'UNREADABLE',
            reasonTH: 'อ่านเอกสารไม่ออก จึงยังตรวจชนิดเอกสารไม่ได้',
            confidence: extractionConfidence,
        };
    }

    const text = ((extraction && extraction.pages) || []).map((p) => (p && p.text) || '').join('\n');
    const compactText = compact(text);
    const matchedAlt = phrases.find((alt) => altFullyAppears(compactText, compact(alt.join(' '))));

    if (matchedAlt) {
        return {
            check: 'DOC_TYPE',
            result: 'MATCH',
            reasonTH: 'พบข้อความที่ตรงกับชนิดเอกสารที่คาด',
            confidence: extractionConfidence,
            evidenceSnippet: matchedAlt.join(' '),
        };
    }

    return {
        check: 'DOC_TYPE',
        result: 'NOT_FOUND',
        reasonTH: 'ไม่พบข้อความที่ตรงกับชนิดเอกสารที่คาด กรุณาตรวจว่าอัปโหลดถูกช่อง',
        confidence: extractionConfidence,
    };
}

module.exports = { checkDocType };
