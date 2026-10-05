'use strict';

const { thaiDigitsToArabic, composeSaraAm, parseThaiDates, daysInMonth } = require('../normalize');
const { startOfLocalCalendarDay, endOfLocalDay, getZonedParts } = require('../../../utils/working-days');
const { formatThaiDate } = require('../../../utils/thai-format');

/**
 * Fix round 1 (task-3-review.md, Important #3): a real company registration
 * certificate states BOTH the company's registration date ("จดทะเบียน…เมื่อ
 * วันที่…") and the certificate's own issue date ("ออกให้ ณ วันที่…"). The old
 * "use the earliest date" policy read the registration date on every such
 * document, so any company older than 6 months got a false `EXPIRED` — the
 * only validity rule there is, turned into a constant false warning.
 *
 * The fix anchors on the issue-date label itself. A short list of OCR-
 * tolerant variants covers a dropped tone mark on "ที่" and a dropped space
 * (Thai script carries no space requirement, so OCR is at least as likely to
 * merge these words as to keep them apart).
 *
 * Fix round 2 (task-3-rereview-1.md, N2): a 40-character window after the
 * label was wide enough to bind a LATER, unrelated dated line ("ออกให้ ณ
 * วันที่ ...... ลงวันที่ 5 มกราคม 2560"), and when the date right after the
 * label failed to parse (OCR-garbled digits), the old code fell back to "the
 * single unlabeled date" — the registration date — giving a false `EXPIRED`
 * again. The fix: once the label is found, commit to it. Only whitespace is
 * trimmed before a SHORT, tight window (`LABEL_DATE_WINDOW_CHARS`, just
 * enough for one full "<day> <month> [พ.ศ.] <year>", not a whole sentence) —
 * any non-whitespace text between the label and the date (like "......
 * ลงวันที่") eats into that budget and pushes a later date out of reach. If
 * nothing parses within it, there is no fallback of any kind: the caller
 * reports `DATE_NOT_FOUND` outright. The single-unlabeled-date fallback only
 * ever applies when NO label is found anywhere in the text.
 */
const ISSUE_DATE_LABEL_VARIANTS = ['ออกให้ ณ วันที่', 'ออกให้ ณ วันที', 'ออกให้ณวันที่', 'ออกให้ณวันที'];

/** Just enough for "<2-digit day> <full month> พ.ศ. <4-digit year>" with normal spacing — never a whole sentence. */
const LABEL_DATE_WINDOW_CHARS = 24;

/**
 * Finds the earliest occurrence of any issue-date label variant.
 *
 * @param {string} normalizedText
 * @returns {{idx: number, len: number}|null}
 */
function findEarliestLabel(normalizedText) {
    let best = null;
    for (const label of ISSUE_DATE_LABEL_VARIANTS) {
        const idx = normalizedText.indexOf(label);
        if (idx !== -1 && (!best || idx < best.idx)) {
            best = { idx, len: label.length };
        }
    }
    return best;
}

/**
 * Looks for an issue-date label and, if found, the date immediately after
 * it (only whitespace allowed in between). Reuses `normalize.js`'s
 * `parseThaiDates` for the actual date grammar — this file only decides
 * WHICH (short, anchored) substring of the document text to hand it.
 *
 * @param {string} text
 * @returns {{found: boolean, date: Date|null}} `found: false` means no label
 *   anywhere in the text (the caller may fall back to a single unlabeled
 *   date); `found: true, date: null` means the label was there but no date
 *   parsed right after it — DATE_NOT_FOUND, with no fallback.
 */
function findLabeledIssueDate(text) {
    const normalized = thaiDigitsToArabic(composeSaraAm(String(text || '')));
    const label = findEarliestLabel(normalized);
    if (!label) {
        return { found: false, date: null };
    }
    const afterLabel = normalized.slice(label.idx + label.len).replace(/^\s+/, '');
    const window = afterLabel.slice(0, LABEL_DATE_WINDOW_CHARS);
    const dates = parseThaiDates(window);
    return { found: true, date: dates.length > 0 ? dates[0] : null };
}

/**
 * The last valid Bangkok calendar day of a period of `months` months that
 * starts from `issuedDate`, per ป.พ.พ.:
 *
 * - ม.193/3 วรรคสอง: a period counted in days/weeks/months/years does not
 *   count its first day, so the period BEGINS the day after issue.
 * - ม.193/5 วรรคสอง: it ends on the day before the day of the last month
 *   that corresponds to that beginning day; if the last month has no
 *   corresponding day, it ends on that month's last day.
 *
 * Worked: issued 1 ม.ค. → begins 2 ม.ค. → last day 1 ก.ค. · issued 30 ก.ย.
 * → begins 1 ต.ค. → corresponding day 1 เม.ย. → last day 31 มี.ค. (the old
 * same-day-number rule said 30 มี.ค. — one day early whenever the issue day
 * is the last day of a month shorter than the target month) · issued 30 ส.ค.
 * → begins 31 ส.ค. → กุมภาพันธ์ has no 31st → last day 28/29 ก.พ.
 *
 * Only calendar arithmetic on Bangkok day numbers; `startOfLocalCalendarDay`
 * turns day `n + 1` past a month's end, and day 0, into the neighbouring
 * month's day (Date.UTC semantics), which is exactly "the next day" /
 * "the day before" here — never a day-of-month that does not exist, because
 * the target day is checked against `daysInMonth` first (final review I4).
 *
 * @param {Date} issuedDate
 * @param {number} months
 * @returns {Date} 00:00 Bangkok on the last valid day
 */
function validityDeadline(issuedDate, months) {
    const issued = getZonedParts(issuedDate);
    const begins = getZonedParts(startOfLocalCalendarDay(issued.year, issued.month, issued.day + 1));
    const lastMonth = getZonedParts(startOfLocalCalendarDay(begins.year, begins.month + months, 1));
    const lastMonthDays = daysInMonth(lastMonth.year, lastMonth.month);
    if (begins.day > lastMonthDays) {
        return startOfLocalCalendarDay(lastMonth.year, lastMonth.month, lastMonthDays);
    }
    return startOfLocalCalendarDay(lastMonth.year, lastMonth.month, begins.day - 1);
}

/**
 * VALIDITY: `PASS` | `EXPIRED` | `DATE_NOT_FOUND`. Only a slot whose CATALOG
 * entry carries a `validity` rule is checked at all (today: `company_reg`,
 * `facts.md:50`, ≤ 6 months) — every other slot's VALIDITY flag is simply
 * never produced (`evaluate.js` skips this check when `catalogEntry.validity`
 * is unset), per design doc §3: "ชนิดอื่นที่ยังไม่มีที่มาของเกณฑ์จะไม่ตรวจอายุ".
 *
 * Every comparison is a Bangkok calendar day via the repo's one date/timezone
 * SSOT (`apps/backend/utils/working-days.js`, per the thai-business-days
 * guideline) — `getZonedParts`, `startOfLocalCalendarDay`
 * and `endOfLocalDay` are reused as-is. The only new arithmetic here is
 * the ป.พ.พ. ม.193/3 + ม.193/5 period end (`validityDeadline` above), plain
 * calendar arithmetic, not timezone math.
 *
 * Fix round 1 (task-3-review.md, Important #3) + fix round 2 (N2): the issue
 * date is read from the labelled date (`findLabeledIssueDate`) when the
 * label is present — and once found, that is the ONLY path tried; a label
 * found with no parseable date right after it is `DATE_NOT_FOUND`, never a
 * fallback to some other date in the document. Only when NO label is found
 * anywhere does a single unlabeled date get used (most of these documents
 * carry only the one date); with MULTIPLE unlabeled dates, this pure layer
 * cannot tell which one is "issued" without field-level extraction (a later
 * task's job) — so it reports `DATE_NOT_FOUND` rather than guessing.
 *
 * @param {{pages?: {text: string}[]}} extraction
 * @param {{validity?: {maxAgeMonths: number, source: string}}} catalogEntry
 * @param {Date} now
 * @param {string} readabilityResult
 * @param {number} extractionConfidence
 * @returns {null|{check: 'VALIDITY', result: 'PASS'|'EXPIRED'|'DATE_NOT_FOUND', reasonTH: string, confidence: number, evidenceSnippet?: string}}
 */
function checkValidity(extraction, catalogEntry, now, readabilityResult, extractionConfidence) {
    const rule = catalogEntry && catalogEntry.validity;
    if (!rule) {
        return null;
    }

    if (readabilityResult === 'UNREADABLE') {
        return {
            check: 'VALIDITY',
            result: 'DATE_NOT_FOUND',
            reasonTH: 'อ่านเอกสารไม่ออก จึงยังตรวจวันที่ไม่ได้',
            confidence: extractionConfidence,
        };
    }

    const text = ((extraction && extraction.pages) || []).map((p) => (p && p.text) || '').join('\n');

    const label = findLabeledIssueDate(text);
    let issuedDate;
    if (label.found) {
        // Fix round 2, N2: the label was found — commit to it. No fallback,
        // even if the date right after it failed to parse.
        if (!label.date) {
            return {
                check: 'VALIDITY',
                result: 'DATE_NOT_FOUND',
                reasonTH: 'พบป้ายวันที่ออกเอกสารแต่วันที่ตามหลังอ่านไม่ออก กรุณาตรวจสอบวันที่ด้วยตนเอง',
                confidence: extractionConfidence,
            };
        }
        issuedDate = label.date;
    } else {
        const dates = parseThaiDates(text);
        if (dates.length === 0 || dates.length > 1) {
            return {
                check: 'VALIDITY',
                result: 'DATE_NOT_FOUND',
                reasonTH: 'ไม่พบวันที่ออกเอกสารที่ระบุชัดเจนในไฟล์ กรุณาตรวจสอบวันที่ด้วยตนเอง',
                confidence: extractionConfidence,
            };
        }
        issuedDate = dates[0];
    }

    const deadlineEnd = endOfLocalDay(validityDeadline(issuedDate, rule.maxAgeMonths));
    // M1 (task-3-review.md): thai-ui-copy requires Buddhist-era dates in
    // user-facing text, never a Gregorian ISO string — reuses the repo's
    // existing formatter instead of building a second one.
    const issuedTH = formatThaiDate(issuedDate);

    if (now.getTime() <= deadlineEnd.getTime()) {
        return {
            check: 'VALIDITY',
            result: 'PASS',
            reasonTH: `เอกสารยังไม่หมดอายุ (ออกเมื่อ ${issuedTH})`,
            confidence: extractionConfidence,
            evidenceSnippet: issuedTH,
        };
    }

    return {
        check: 'VALIDITY',
        result: 'EXPIRED',
        reasonTH: `เอกสารออกมานานเกินกำหนด (ออกเมื่อ ${issuedTH})`,
        confidence: extractionConfidence,
        evidenceSnippet: issuedTH,
    };
}

module.exports = { checkValidity };
