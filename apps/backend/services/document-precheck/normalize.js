'use strict';

/**
 * Pure Thai text helpers for the document pre-check feature.
 *
 * No I/O, no DB, no OCR — every function here is a deterministic string/date
 * transform so the rules in Task 3 (and Task 1's tessdata test) can share one
 * implementation instead of copying the arithmetic per caller (see
 * design note 2026-09-27-document-precheck, Task 2).
 *
 * @module services/document-precheck/normalize
 */

const { isThaiIdChecksumValid } = require('@gacp/validation/thai-id-checksum');
const { startOfLocalCalendarDay } = require('../../utils/working-days');

/** Thai digit glyphs ๐-๙ in codepoint order, matching Arabic 0-9. */
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/**
 * Converts Thai digit glyphs (๐-๙) to Arabic (0-9). Leaves every other
 * character untouched, so it is safe to run over full document text before
 * any digit-shaped pattern match (13-digit IDs, dates).
 *
 * @param {string} s
 * @returns {string}
 */
function thaiDigitsToArabic(s) {
    return String(s == null ? '' : s).replace(/[๐-๙]/g, (ch) => String(THAI_DIGITS.indexOf(ch)));
}

/**
 * tessdata_fast's `tha` model decomposes สระอำ (U+0E33) into NIKHAHIT
 * (U+0E4D) + SARA AA (U+0E32) — visually identical, different codepoints.
 * Owned here per Task 1's review (see
 * `apps/backend/__tests__/unit/tessdata-local-only.test.js`,
 * `apps/backend/data/tessdata/README.md` "Known trade-off").
 *
 * @param {string} s
 * @returns {string}
 */
function composeSaraAm(s) {
    return String(s == null ? '' : s).replace(/ํา/g, 'ำ');
}

/**
 * Removes ไม้เอก/โท/ตรี/จัตวา (U+0E48-U+0E4B). tessdata_fast can drop these
 * tone marks (for example ไม้โท in น้ำ) on a real read, so a caller that must
 * tolerate that loss strips them from both sides before comparing.
 *
 * Name matching must NOT use this by default — Thai names can differ from
 * each other by exactly one tone mark and that difference is meaningful
 * (see `normalizeName`, `nameMatchLevel`).
 *
 * @param {string} s
 * @returns {string}
 */
function stripToneMarks(s) {
    return String(s == null ? '' : s).replace(/[่-๋]/g, '');
}

/**
 * Normalizes text for matching against the closed doc-type phrase list
 * (catalog.js). Thai digits → composed sara am → tone marks stripped →
 * whitespace collapsed. Tone-insensitive on purpose: a phrase like "น้ำ"
 * inside a document title must still match after OCR drops the mark.
 *
 * NOT for name matching — see `normalizeName`.
 *
 * @param {string} s
 * @returns {string}
 */
function normalizeKeyword(s) {
    let result = thaiDigitsToArabic(s);
    result = composeSaraAm(result);
    result = stripToneMarks(result);
    result = result.replace(/\s+/g, ' ').trim();
    return result;
}

function escapeRegExp(literal) {
    return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Fix round 1 (task-2-review.md, Critical #1): the previous `NAME_AFFIXES`
 * list stripped every listed word wherever it appeared as a bare substring
 * — Thai has no spaces between words, so `split(affix).join('')` cut "นาย"
 * out of the middle of "นายทุน" (a company owner's actual given name) as if
 * it were the title prefix นาย. `normalizeName('บริษัท นายทุน จำกัด')`
 * collapsed to `'ทุน'`, which then read as an EXACT match against the
 * unrelated name "ทุน จำกัด".
 *
 * "Word boundary" in Thai script is positional, not delimiter-based: a
 * company prefix/suffix can only be the LEADING/TRAILING affix of the whole
 * string, and a person's title can only be LEADING. That is why
 * `normalizeName` now takes `kind` and never mixes the two affix lists —
 * COMPANY never touches person titles (so a company name that happens to
 * start with a title-shaped word, e.g. "นายกรัฐมนตรี...", is left alone),
 * and PERSON never touches company words.
 */
const COMPANY_PREFIXES = [
    'ห้างหุ้นส่วนสามัญนิติบุคคล',
    'ห้างหุ้นส่วนจำกัด',
    'ห้างหุ้นส่วนสามัญ',
    'บริษัท',
    'บมจ.',
    'บจก.',
    'หจก.',
];

const COMPANY_SUFFIXES = ['จำกัด (มหาชน)', '(มหาชน)', 'จำกัด'];

const PERSON_TITLES = ['นางสาว', 'นาง', 'นาย', 'น.ส.', 'ด.ช.', 'ด.ญ.'];

const COMPANY_PREFIX_RE = new RegExp(`^(?:${COMPANY_PREFIXES.map(escapeRegExp).join('|')})\\s*`);
const COMPANY_SUFFIX_RE = new RegExp(`\\s*(?:${COMPANY_SUFFIXES.map(escapeRegExp).join('|')})$`);
const PERSON_TITLE_RE = new RegExp(`^(?:${PERSON_TITLES.map(escapeRegExp).join('|')})\\s*`);

/** Removes whitespace/punctuation left over after affix stripping. */
function stripNamePunctuation(s) {
    return s.replace(/[\s.,()\-]/g, '');
}

function normalizeCompanyName(s) {
    let result = composeSaraAm(s).trim();
    result = result.replace(COMPANY_PREFIX_RE, '');
    result = result.replace(COMPANY_SUFFIX_RE, '');
    return stripNamePunctuation(result.trim());
}

function normalizePersonName(s) {
    let result = composeSaraAm(s).trim();
    const titleMatch = result.match(PERSON_TITLE_RE);
    // Only strip the title when something follows it — a bare "นาย" with
    // nothing after it is not "a title stripped from a name", it IS the name.
    if (titleMatch && titleMatch[0].length < result.length) {
        result = result.slice(titleMatch[0].length);
    }
    return stripNamePunctuation(result.trim());
}

/**
 * Normalizes a name for cross-matching: composes sara am, strips exactly one
 * LEADING/TRAILING affix appropriate to `kind`, and removes remaining
 * whitespace/punctuation. Deliberately does NOT strip tone marks — Thai
 * names can differ from each other by exactly one tone mark, and collapsing
 * that away would turn two different people into one match
 * (`nameMatchLevel` reports that case as `TONE_ONLY`, never `EXACT`).
 *
 * `kind: 'COMPANY'` strips only a leading company prefix and a trailing
 * company suffix (never a person title). `kind: 'PERSON'` strips only a
 * leading title, and only when a name actually follows it.
 *
 * @param {string} s
 * @param {'PERSON'|'COMPANY'} kind
 * @returns {string}
 */
function normalizeName(s, kind) {
    const input = String(s == null ? '' : s);
    if (kind === 'COMPANY') {
        return normalizeCompanyName(input);
    }
    if (kind === 'PERSON') {
        return normalizePersonName(input);
    }
    throw new TypeError(`normalizeName requires kind: 'PERSON' | 'COMPANY' (received ${JSON.stringify(kind)})`);
}

/**
 * Classic Levenshtein edit distance (insert/delete/substitute, cost 1 each).
 * Pure, no Thai-specific behaviour — the Thai-specific part already
 * happened in `normalizeName` before this runs.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshteinDistance(a, b) {
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;

    let previousRow = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i += 1) {
        const currentRow = [i];
        for (let j = 1; j <= n; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            currentRow[j] = Math.min(
                previousRow[j] + 1, // deletion
                currentRow[j - 1] + 1, // insertion
                previousRow[j - 1] + cost, // substitution
            );
        }
        previousRow = currentRow;
    }
    return previousRow[n];
}

/**
 * Similarity of two names on `normalizeName` output, in [0, 1]: 1 minus the
 * Levenshtein distance normalized by the longer normalized string's length.
 * Tone-sensitive (does not strip tone marks) — see `normalizeName`.
 *
 * @param {string} a
 * @param {string} b
 * @param {'PERSON'|'COMPANY'} kind
 * @returns {number}
 */
function nameSimilarity(a, b, kind) {
    const normA = normalizeName(a, kind);
    const normB = normalizeName(b, kind);
    const maxLen = Math.max(normA.length, normB.length);
    if (maxLen === 0) return 1;
    return 1 - levenshteinDistance(normA, normB) / maxLen;
}

/**
 * Similarity threshold above which two names are treated as a close match
 * rather than different people/entities.
 *
 * NOT the Task 9 sweep's pick. The sweep (0.70..0.95 step 0.05) picks 0.95:
 * it catches the two near-name mismatches 0.85 misses, but also warns on an
 * OCR-blurred correct company name, and the synthetic corpus under-represents
 * OCR noise (tessdata_fast loses tone marks on real scans), so 0.95 would
 * raise more of exactly the false warnings §6.4 wants fewest of. 0.85 is kept
 * as an explicit exception — coordinator decision 2026-09-28, operator to
 * confirm. The corpus is synthetic: its floors guard against regressions
 * only, they are not a measure of production accuracy. Floors:
 * `__tests__/fixtures/document-precheck/thresholds.json`; sweep, the 0.95
 * numbers and reasoning: `evidence/document-precheck-task-9/INDEX.md`.
 */
const NAME_SIMILARITY_MIN = 0.85;

/**
 * Classifies how closely two names match, tone-sensitively.
 *
 * Evaluation order is EXACT, then TONE_ONLY, then CLOSE, then DIFFERENT —
 * TONE_ONLY is checked before the similarity threshold on purpose: a name
 * that differs from another by exactly one tone mark is usually also
 * "similar enough" to pass `NAME_SIMILARITY_MIN`, but Task 3 must never let
 * that read as an ordinary close match. It has to surface as its own signal
 * ("ตรวจชื่ออีกครั้ง") every time, not only when it happens to fall below the
 * similarity threshold.
 *
 * `minSimilarity` defaults to `NAME_SIMILARITY_MIN`; only the Task 9 accuracy
 * report passes another value (to sweep it over the corpus). Production code
 * never passes it.
 *
 * @param {string} a
 * @param {string} b
 * @param {'PERSON'|'COMPANY'} kind
 * @param {number} [minSimilarity]
 * @returns {'EXACT'|'CLOSE'|'TONE_ONLY'|'DIFFERENT'}
 */
function nameMatchLevel(a, b, kind, minSimilarity = NAME_SIMILARITY_MIN) {
    const normA = normalizeName(a, kind);
    const normB = normalizeName(b, kind);
    if (normA === normB) {
        return 'EXACT';
    }
    if (stripToneMarks(normA) === stripToneMarks(normB)) {
        return 'TONE_ONLY';
    }
    if (nameSimilarity(a, b, kind) >= minSimilarity) {
        return 'CLOSE';
    }
    return 'DIFFERENT';
}

/** Exactly 13 contiguous digits, not part of a longer digit run. */
const THIRTEEN_DIGITS_CONTIGUOUS_RE = /(?<!\d)\d{13}(?!\d)/g;

/**
 * Fix round 1 (task-2-review.md, Important #4): the previous rule accepted
 * ANY run of digits/dashes/spaces that happened to total 13 digits, so a
 * 4-digit document number followed by a space and an unrelated 9-digit
 * number ("เลขที่ 1234 567890123") concatenated into a false 13-digit
 * candidate. The printed grouping on a Thai ID card / juristic registration
 * number is exactly 1-4-5-2-1 (e.g. `0-1055-68045-93-2`), so each of the 4
 * gaps now accepts exactly one `-` or one space — never a run of several,
 * never a different grouping.
 */
const THIRTEEN_DIGITS_GROUPED_RE = /(?<!\d)\d[-\s]\d{4}[-\s]\d{5}[-\s]\d{2}[-\s]\d(?!\d)/g;

/**
 * Finds every 13-digit Thai ID / juristic registration number in `text`,
 * tolerating Thai digits, as either 13 contiguous digits or the printed
 * 1-4-5-2-1 grouping (dash- or space-separated). This function finds
 * candidates by SHAPE only; `isValidThirteenDigitId` judges them.
 *
 * @param {string} text
 * @returns {string[]}
 */
function findThirteenDigitIds(text) {
    const converted = thaiDigitsToArabic(text);
    const matches = [
        ...converted.matchAll(THIRTEEN_DIGITS_CONTIGUOUS_RE),
        ...converted.matchAll(THIRTEEN_DIGITS_GROUPED_RE),
    ];
    return matches.map((m) => m[0].replace(/[^\d]/g, ''));
}

/**
 * Mod-11 checksum for a 13-digit Thai national ID / juristic-person
 * registration number. The same rule governs both (see
 * `@gacp/validation/thai-id-checksum` for the arithmetic and its provenance)
 * so this file does not re-derive it — `apps/backend/utils/thai-id-validator.js:19`
 * is the existing caller this mirrors.
 *
 * @param {string} s
 * @returns {boolean}
 */
function isValidThirteenDigitId(s) {
    return isThaiIdChecksumValid(s);
}

/** Thai month names, full and abbreviated, in calendar order. */
const THAI_MONTHS = [
    { full: 'มกราคม', abbr: 'ม.ค.', month: 1 },
    { full: 'กุมภาพันธ์', abbr: 'ก.พ.', month: 2 },
    { full: 'มีนาคม', abbr: 'มี.ค.', month: 3 },
    { full: 'เมษายน', abbr: 'เม.ย.', month: 4 },
    { full: 'พฤษภาคม', abbr: 'พ.ค.', month: 5 },
    { full: 'มิถุนายน', abbr: 'มิ.ย.', month: 6 },
    { full: 'กรกฎาคม', abbr: 'ก.ค.', month: 7 },
    { full: 'สิงหาคม', abbr: 'ส.ค.', month: 8 },
    { full: 'กันยายน', abbr: 'ก.ย.', month: 9 },
    { full: 'ตุลาคม', abbr: 'ต.ค.', month: 10 },
    { full: 'พฤศจิกายน', abbr: 'พ.ย.', month: 11 },
    { full: 'ธันวาคม', abbr: 'ธ.ค.', month: 12 },
];

/** name (full or abbreviated) -> month number 1-12. */
const THAI_MONTH_TO_NUMBER = new Map();
for (const { full, abbr, month } of THAI_MONTHS) {
    THAI_MONTH_TO_NUMBER.set(full, month);
    THAI_MONTH_TO_NUMBER.set(abbr, month);
}

const MONTH_ALTERNATION = [...THAI_MONTH_TO_NUMBER.keys()].map(escapeRegExp).join('|');

/** `d <เดือนไทยเต็ม|ย่อ> [พ.ศ.] yyyy` */
const MONTH_NAME_DATE_RE = new RegExp(
    `(\\d{1,2})\\s*(${MONTH_ALTERNATION})\\s*(?:พ\\.ศ\\.?\\s*)?(\\d{2,4})`,
    'g',
);

/** `d/m/yyyy` */
const SLASH_DATE_RE = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/g;

/**
 * Fix round 1 (task-2-review.md, Critical #2): the Thai-month path used to
 * ALWAYS treat the year as Buddhist Era, unconditionally subtracting 543 —
 * `parseThaiDates('27 กันยายน 2026')` produced 1483, the exact "wrong by
 * 543 years" failure the brief warned about for the slash-date path, just
 * on the month-name path instead, which had no guard at all.
 *
 * One rule now covers every path (month-name and slash alike):
 *  - a 2-digit year is Buddhist Era 25xx before the -543 offset
 *    (`69` -> `2569` -> `2026`);
 *  - a 4-digit year `> 2400` is Buddhist Era (`-543`);
 *  - a 4-digit year in `[1900, 2400]` is already Common Era, unchanged;
 *  - anything else (e.g. a bare 3-digit year) is not a bucket this rule
 *    defines — returns `null` so the caller drops the date rather than
 *    guess at a 5th rule nobody asked for.
 *
 * @param {number} rawYear
 * @returns {number|null}
 */
function resolveCeYear(rawYear) {
    if (rawYear < 100) {
        return 2500 + rawYear - 543;
    }
    if (rawYear > 2400) {
        return rawYear - 543;
    }
    if (rawYear >= 1900 && rawYear <= 2400) {
        return rawYear;
    }
    return null;
}

/** Days per CE calendar month, 0-indexed (Jan=0). February is fixed up in `daysInMonth`. */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(ceYear) {
    return (ceYear % 4 === 0 && ceYear % 100 !== 0) || ceYear % 400 === 0;
}

function daysInMonth(ceYear, month) {
    return month === 2 && isLeapYear(ceYear) ? 29 : DAYS_IN_MONTH[month - 1];
}

/**
 * Fix round 1 (task-2-review.md, Critical #3): `startOfLocalCalendarDay`
 * builds off `Date.UTC`, which silently rolls an out-of-range day into the
 * next month (`31 กุมภาพันธ์` became 3 มีนาคม with no signal). A document
 * date that is not a real calendar day must be dropped, not corrected.
 *
 * @param {number} ceYear
 * @param {number} month 1-12
 * @param {number} day
 * @returns {boolean}
 */
function isValidCalendarDate(ceYear, month, day) {
    if (!Number.isInteger(month) || month < 1 || month > 12) return false;
    if (!Number.isInteger(day) || day < 1) return false;
    return day <= daysInMonth(ceYear, month);
}

/**
 * Finds `d <Thai month> [พ.ศ.] yyyy` and `d/m/yyyy` dates in `text`,
 * tolerating Thai digits. Every result is a Date at 00:00 Asia/Bangkok on
 * the matched calendar day (`utils/working-days.js#startOfLocalCalendarDay`)
 * — never the process/local timezone.
 *
 * The year is read per `resolveCeYear` on BOTH paths — see its doc comment.
 * A match whose year does not resolve, or whose day does not exist in that
 * month (`isValidCalendarDate` — this includes leap years), is dropped
 * rather than silently rolled into a different date.
 *
 * @param {string} text
 * @returns {Date[]}
 */
function parseThaiDates(text) {
    const converted = thaiDigitsToArabic(text);
    const dates = [];

    for (const match of converted.matchAll(MONTH_NAME_DATE_RE)) {
        const day = Number(match[1]);
        const month = THAI_MONTH_TO_NUMBER.get(match[2]);
        const ceYear = resolveCeYear(Number(match[3]));
        if (ceYear === null || !isValidCalendarDate(ceYear, month, day)) {
            continue;
        }
        dates.push(startOfLocalCalendarDay(ceYear, month, day));
    }

    for (const match of converted.matchAll(SLASH_DATE_RE)) {
        const day = Number(match[1]);
        const month = Number(match[2]);
        const ceYear = resolveCeYear(Number(match[3]));
        if (ceYear === null || !isValidCalendarDate(ceYear, month, day)) {
            continue;
        }
        dates.push(startOfLocalCalendarDay(ceYear, month, day));
    }

    return dates;
}

/**
 * Masks an ID for display: strips non-digits, keeps only the last 4 digits,
 * prefixed with an ellipsis (`…1234`) per the `thai-ui-copy` skill.
 *
 * Fix round 1 (task-2-review.md, Minor #5) flagged that an input under 5
 * digits shows its ENTIRE id (`maskId('12')` -> `'…12'`) — the ellipsis
 * reads as "something is hidden" when nothing actually is. The brief does
 * not specify behaviour for this case either way, so this is pinned as-is
 * rather than guessed at; a real lower-bound rule (e.g. refuse to mask, or
 * pad) is the caller's/spec's call, not this module's to invent.
 *
 * @param {string} s
 * @returns {string}
 */
function maskId(s) {
    const digits = String(s == null ? '' : s).replace(/\D/g, '');
    return `…${digits.slice(-4)}`;
}

module.exports = {
    thaiDigitsToArabic,
    composeSaraAm,
    stripToneMarks,
    normalizeKeyword,
    normalizeName,
    nameSimilarity,
    nameMatchLevel,
    NAME_SIMILARITY_MIN,
    findThirteenDigitIds,
    isValidThirteenDigitId,
    parseThaiDates,
    maskId,
    // Fix round 1 (task-3-review.md, Important #4): doc-type's fuzzy phrase
    // tolerance reuses this instead of a second Levenshtein implementation.
    levenshteinDistance,
    // Final review I4: validity.js clamps its deadline day with this — one
    // month-length table, not a second one.
    daysInMonth,
};
