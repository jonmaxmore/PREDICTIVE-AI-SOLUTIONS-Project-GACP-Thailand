'use strict';

const {
    thaiDigitsToArabic,
    composeSaraAm,
    nameMatchLevel,
    findThirteenDigitIds,
    isValidThirteenDigitId,
    maskId,
} = require('../normalize');

/** Splits at whitespace/punctuation boundaries — never inside a Thai word. */
const TOKEN_SPLIT_RE = /[\s.,()\-:|]+/;

/**
 * How many extra tokens a candidate window may run past the expected name's
 * own token count. Fix round 2 (task-3-rereview-1.md, N3) widened this from
 * 1 to 6: OCR can over-split a short name into one token per syllable
 * ("นาย สม ชาย ใจ ดี" for "นายสมชาย ใจดี", 5 tokens against 2 expected), and
 * the window still only ever joins WHOLE, contiguous tokens — never slices
 * inside one — so widening it cannot reintroduce the fix-round-1 prefix bug
 * ("ทอง" is never a candidate on its own when the document only ever wrote
 * the single token "ทองดี").
 */
const WINDOW_SLACK_TOKENS = 6; // provisional — not swept; the backlog 2026-09-28 Task 9

/** Bound on how many text tokens the name-search window scans (a later task's field-level extraction removes the need for this). */
const NAME_SEARCH_MAX_TOKENS = 400;

function tokenize(text) {
    return thaiDigitsToArabic(composeSaraAm(String(text || '')))
        .split(TOKEN_SPLIT_RE)
        .filter(Boolean);
}

/**
 * Fix round 2 (task-3-rereview-1.md, N3): a Thai form label ("ชื่อ" = "name")
 * is sometimes OCR'd glued directly onto the answer with no separating space
 * ("ชื่อนายสมชาย" instead of "ชื่อ นายสมชาย"). Checked longest-first so
 * "ชื่อ-สกุล"/"ชื่อสกุล" (full-name label) are not bare-"ชื่อ"-stripped in
 * half. This is a parsing-mechanics heuristic about how Thai forms print
 * field labels, not a DTAM content rule — provisional, not sourced to
 * facts.md/กทล.1 the way CATALOG's own rules are.
 */
const NAME_LABEL_PREFIXES = ['ชื่อ-สกุล', 'ชื่อสกุล', 'ชื่อ'];

function stripKnownLabelPrefix(candidate) {
    for (const label of NAME_LABEL_PREFIXES) {
        if (candidate.length > label.length && candidate.startsWith(label)) {
            return candidate.slice(label.length);
        }
    }
    return null;
}

const LEVEL_RANK = { EXACT: 3, CLOSE: 2, TONE_ONLY: 1, DIFFERENT: 0 };

/** The best of `nameMatchLevel(candidate, ...)` and, if a known label prefix peels off, `nameMatchLevel(peeled, ...)`. */
function bestLevelForCandidate(candidate, expectedName, kind, minSimilarity) {
    let level = nameMatchLevel(candidate, expectedName, kind, minSimilarity);
    const peeled = stripKnownLabelPrefix(candidate);
    if (peeled) {
        const peeledLevel = nameMatchLevel(peeled, expectedName, kind, minSimilarity);
        if (LEVEL_RANK[peeledLevel] > LEVEL_RANK[level]) {
            level = peeledLevel;
        }
    }
    return level;
}

/**
 * Fix round 1 (task-3-review.md, Critical #1): the old version compacted the
 * WHOLE text (stripping every space) and did `text.includes(expected)`. With
 * no word boundary, a tone-differing name is a literal prefix of the version
 * with the extra tone-mark character, and a short name is a literal
 * substring of an unrelated longer one — both read as EXACT. Both broke
 * "TONE_ONLY must never become MATCH" (decision 2, task-3-brief.md).
 *
 * The fix: extract candidates at TOKEN boundaries in the original text
 * (never inside a word), and classify each one with `normalize.nameMatchLevel`
 * — the same ordering (EXACT, then TONE_ONLY, then CLOSE, then DIFFERENT)
 * Task 2 already implemented and tested. This file does not re-implement
 * that ordering or its Levenshtein arithmetic; it only decides which
 * substring of the document text gets handed to it.
 *
 * A name is usually printed as 1-3 space/punctuation-separated tokens (a
 * title glued to a first name, then a surname; or a company prefix, the
 * name itself, then "จำกัด") — window lengths from 1 up to
 * `expectedTokens.length + WINDOW_SLACK_TOKENS` cover a document that prints
 * slightly more or fewer tokens than the reference value. Across all
 * candidate windows, the BEST-ranked level wins (EXACT beats CLOSE beats
 * TONE_ONLY beats DIFFERENT) — real field-level extraction (which substring
 * is "the name" on a labelled form) is a later task's job, not this pure
 * rule layer's; this is a deliberately simple, bounded search over that gap.
 *
 * @param {string} text
 * @param {string} expectedName
 * @param {'PERSON'|'COMPANY'} kind
 * @param {number} [minSimilarity] passed through to `nameMatchLevel` (undefined = its default)
 * @returns {'EXACT'|'CLOSE'|'TONE_ONLY'|'DIFFERENT'}
 */
function bestNameMatchLevel(text, expectedName, kind, minSimilarity) {
    const expectedTokens = tokenize(expectedName);
    if (expectedTokens.length === 0) {
        return 'DIFFERENT';
    }
    const textTokens = tokenize(text).slice(0, NAME_SEARCH_MAX_TOKENS);
    const maxWindow = Math.min(expectedTokens.length + WINDOW_SLACK_TOKENS, textTokens.length);

    let best = 'DIFFERENT';
    for (let windowLen = 1; windowLen <= maxWindow; windowLen += 1) {
        for (let start = 0; start + windowLen <= textTokens.length; start += 1) {
            const candidate = textTokens.slice(start, start + windowLen).join(' ');
            const level = bestLevelForCandidate(candidate, expectedName, kind, minSimilarity);
            if (LEVEL_RANK[level] > LEVEL_RANK[best]) {
                best = level;
                if (best === 'EXACT') {
                    return best; // nothing can outrank EXACT
                }
            }
        }
    }
    return best;
}

/**
 * Fix round 2 (task-3-rereview-1.md, N3): a NAME pair's status is now 3-way,
 * not the old binary MATCH/MISMATCH. `nameMatchLevel`'s own EXACT/CLOSE mean
 * MATCH, as before. But when NOTHING found across every candidate window
 * reaches even `TONE_ONLY`, this is downgraded from `MISMATCH` to
 * `NOT_FOUND`: OCR spacing (a label glued to the name, a whole line glued
 * with no spaces, or a name over-split across more tokens than the window
 * covers) was producing a best level of plain `DIFFERENT` and reporting a
 * confident "ไม่ตรง" for what is really "could not find anything to compare"
 * — the exact false-accusation class I2 already fixed for ids (§6.4 puts
 * precision first). `TONE_ONLY` alone still means `MISMATCH`: it is a
 * genuine, same-letters, different-tone name FOUND in the text, not an
 * absence.
 */
function nameLevelToStatus(level) {
    if (level === 'EXACT' || level === 'CLOSE') {
        return 'MATCH';
    }
    if (level === 'TONE_ONLY') {
        return 'MISMATCH';
    }
    return 'NOT_FOUND';
}

function onlyDigits(s) {
    return String(s || '').replace(/\D/g, '');
}

function findValidThirteenDigitIds(text) {
    return findThirteenDigitIds(text).filter(isValidThirteenDigitId);
}

/**
 * Builds the {type, kind, expected} pairs cross-match has data for, from
 * `catalogEntry.reference` (the slot's configured candidate types)
 * intersected with what `reference` actually populates. A type whose field
 * is absent from `reference` contributes no pair — this is what makes
 * `cross-match-missing-reference` (an individual applicant, no Entity) come
 * back `NOT_FOUND` rather than `MISMATCH`: there is simply nothing in this
 * list to fail on.
 */
function buildComparisonPairs(catalogEntry, reference) {
    const types = (catalogEntry && catalogEntry.reference) || [];
    const ref = reference || {};
    const pairs = [];
    for (const type of types) {
        switch (type) {
            case 'APPLICANT_NAME':
                if (ref.applicantName) {
                    pairs.push({ type, kind: 'NAME', nameKind: 'PERSON', expected: ref.applicantName });
                }
                break;
            case 'ENTITY_NAME':
                if (ref.entityName) {
                    pairs.push({ type, kind: 'NAME', nameKind: 'COMPANY', expected: ref.entityName });
                }
                break;
            case 'DIRECTOR_NAME':
                if (ref.directorName) {
                    pairs.push({ type, kind: 'NAME', nameKind: 'PERSON', expected: ref.directorName });
                }
                break;
            case 'JURISTIC_ID':
                if (ref.juristicId) {
                    pairs.push({ type, kind: 'ID', expected: onlyDigits(ref.juristicId) });
                }
                break;
            case 'CITIZEN_ID':
                // decision 3 (task-3-brief.md): only the last 4 digits are ever
                // held in `reference` (privacy) — an ID "matches" only when a
                // VALID 13-digit id found in the document ends in these 4.
                if (ref.citizenIdLast4) {
                    pairs.push({ type, kind: 'ID_LAST4', expected: onlyDigits(ref.citizenIdLast4) });
                }
                break;
            default:
                break;
        }
    }
    return pairs;
}

/**
 * Per-pair status: `MATCH` | `MISMATCH` | `NOT_FOUND`.
 *
 * Fix round 1 (task-3-review.md, Important #2): for an ID/ID_LAST4 pair, the
 * old version conflated "no valid id anywhere in the document" with "a
 * different valid id was found" — both became MISMATCH, with a definitive
 * "ไม่ตรงกับข้อมูลที่กรอกไว้" reason. Thai OCR routinely drops or breaks digit
 * runs, so "absent" is the common case, and reporting it as a mismatch
 * (rather than "nothing to compare") is a steady source of false
 * accusations (§6.4, thai-ui-copy's "never claim a definitive bad state").
 *
 * Fix round 2 (N3) brings NAME pairs the same 3-way treatment — see
 * `nameLevelToStatus`.
 */
function evaluatePair(pair, text, validIdsCache, nameSimilarityMin) {
    if (pair.kind === 'NAME') {
        const level = bestNameMatchLevel(text, pair.expected, pair.nameKind, nameSimilarityMin);
        return { status: nameLevelToStatus(level) };
    }
    const validIds = validIdsCache.get();
    if (validIds.length === 0) {
        return { status: 'NOT_FOUND' };
    }
    const found =
        pair.kind === 'ID'
            ? validIds.find((id) => id === pair.expected)
            : validIds.find((id) => id.slice(-4) === pair.expected);
    return { status: found ? 'MATCH' : 'MISMATCH', evidenceId: found || validIds[0] };
}

/**
 * Fix round 1 (task-3-review.md, Important #1): combines this slot's pair
 * statuses into one CROSS_MATCH result, per `catalogEntry.referenceCombine`
 * (`'ANY'` for land documents — §8: the holder's name is compared with the
 * applicant's name OR the company's name — `'ALL'` everywhere else, the
 * default, unchanged from before).
 *
 * - `ANY`: any pair MATCH -> `MATCH`. Otherwise, any pair a definite
 *   MISMATCH -> `MISMATCH` (something concrete was found wrong, worth
 *   surfacing even under "OR" semantics). Otherwise (fix round 2, N3: NAME
 *   pairs can now report NOT_FOUND too) -> `NOT_FOUND`.
 * - `ALL`: every pair MATCH -> `MATCH`. Otherwise, if every non-MATCH pair is
 *   NOT_FOUND (nothing was actually found wrong, only absent) -> `NOT_FOUND`.
 *   Only when some pair is a definite MISMATCH (a different id or name was
 *   actually found) does the combined result become `MISMATCH`.
 */
function combine(results, mode) {
    if (mode === 'ANY') {
        if (results.some((r) => r.status === 'MATCH')) {
            return 'MATCH';
        }
        if (results.some((r) => r.status === 'MISMATCH')) {
            return 'MISMATCH';
        }
        return 'NOT_FOUND';
    }
    if (results.every((r) => r.status === 'MATCH')) {
        return 'MATCH';
    }
    if (results.every((r) => r.status !== 'MISMATCH')) {
        return 'NOT_FOUND';
    }
    return 'MISMATCH';
}

/**
 * CROSS_MATCH: `MATCH` | `MISMATCH` | `NOT_FOUND` — or no flag at all.
 *
 * Fix round 1 (task-3-review.md, Important #5): a slot with an EMPTY
 * `reference` list (`previous_cert` — no source for what field to compare —
 * see catalog.js) must not run this check AT ALL. Checked first, before the
 * unreadable short-circuit: an unsourced criterion never runs, unreadable or
 * not. Returns `null`, and `evaluate.js` omits the flag entirely.
 *
 * Once the criterion exists, `NOT_FOUND` happens only when there is nothing
 * to compare: either the unreadable-short-circuit (readability already
 * failed — nothing usable came out of the document, per
 * `unreadable-short-circuits`), this slot's configured reference fields are
 * all absent from `reference` (nothing on OUR side, per
 * `cross-match-missing-reference`), or (fix round 1, I2) nothing comparable
 * was found in the DOCUMENT either. `MISMATCH` is reserved for "both sides
 * exist and disagree" — a name/id that is definitely, actually different.
 *
 * @param {{pages?: {text: string}[]}} extraction
 * @param {{applicantName?: string, entityName?: string, directorName?: string, juristicId?: string, citizenIdLast4?: string}} reference
 * @param {{reference?: string[], referenceCombine?: 'ALL'|'ANY'}} catalogEntry
 * @param {string} readabilityResult
 * @param {number} extractionConfidence
 * @param {number} [nameSimilarityMin] defaults to `NAME_SIMILARITY_MIN` (via
 *   `nameMatchLevel`); only the Task 9 accuracy report passes another value.
 * @returns {null|{check: 'CROSS_MATCH', result: 'MATCH'|'MISMATCH'|'NOT_FOUND', reasonTH: string, confidence: number, evidenceSnippet?: string}}
 */
function checkCrossMatch(extraction, reference, catalogEntry, readabilityResult, extractionConfidence, nameSimilarityMin) {
    const configuredTypes = (catalogEntry && catalogEntry.reference) || [];
    if (configuredTypes.length === 0) {
        return null;
    }

    if (readabilityResult === 'UNREADABLE') {
        return {
            check: 'CROSS_MATCH',
            result: 'NOT_FOUND',
            reasonTH: 'อ่านเอกสารไม่ออก จึงยังเทียบข้อมูลไม่ได้',
            confidence: extractionConfidence,
        };
    }

    const pairs = buildComparisonPairs(catalogEntry, reference);
    if (pairs.length === 0) {
        return {
            check: 'CROSS_MATCH',
            result: 'NOT_FOUND',
            // Read by the applicant as well as the officer (Task 7 serves
            // reasonTH to both): says what happens next, instructs no one.
            reasonTH: 'ไม่มีข้อมูลผู้ยื่นให้เทียบสำหรับช่องนี้ เจ้าหน้าที่จะตรวจสอบเพิ่มเติม',
            confidence: extractionConfidence,
        };
    }

    const text = ((extraction && extraction.pages) || []).map((p) => (p && p.text) || '').join('\n');
    let cachedValidIds = null;
    const validIdsCache = { get: () => cachedValidIds || (cachedValidIds = findValidThirteenDigitIds(text)) };

    const results = pairs.map((pair) => ({ pair, ...evaluatePair(pair, text, validIdsCache, nameSimilarityMin) }));
    const combineMode = (catalogEntry && catalogEntry.referenceCombine) || 'ALL';
    const result = combine(results, combineMode);

    const idResult = results.find((r) => (r.pair.kind === 'ID' || r.pair.kind === 'ID_LAST4') && r.evidenceId);
    // decision 3 (task-3-brief.md): reasonTH/evidenceSnippet mask every id —
    // `maskId` is the only place a document's own id digits reach a flag.
    const evidenceSnippet = idResult ? maskId(idResult.evidenceId) : undefined;

    const REASON_TH = {
        MATCH: 'ข้อมูลในเอกสารตรงกับข้อมูลที่กรอกไว้',
        MISMATCH: 'ข้อมูลในเอกสารไม่ตรงกับข้อมูลที่กรอกไว้ กรุณาตรวจสอบอีกครั้ง',
        NOT_FOUND: 'ไม่พบข้อมูลที่จะเทียบในเอกสารนี้ เจ้าหน้าที่จะตรวจสอบเพิ่มเติม',
    };

    return {
        check: 'CROSS_MATCH',
        result,
        reasonTH: REASON_TH[result],
        confidence: extractionConfidence,
        ...(evidenceSnippet ? { evidenceSnippet } : {}),
    };
}

module.exports = { checkCrossMatch };
