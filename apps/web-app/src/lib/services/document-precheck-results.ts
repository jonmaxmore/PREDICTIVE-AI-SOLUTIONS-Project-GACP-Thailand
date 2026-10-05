/**
 * What a document pre-check flag's `result` means, for both screens that show one: the
 * applicant's slot card and the officer's document-check row. One list, so the two
 * sides cannot disagree about what counts as an observation.
 *
 * `result` is the backend rule's own word (apps/backend/services/document-precheck/rules):
 *   - PASS / MATCH       nothing noticed
 *   - MANUAL             signature/seal — a machine cannot judge it, the officer does
 *   - everything else    an observation: NOT_FOUND, MISMATCH, EXPIRED, UNREADABLE,
 *                        PAGE_COUNT, DATE_NOT_FOUND, and whatever a later rule adds.
 *
 * NOT_FOUND is an observation on purpose: a cross-match that could not find the name is
 * a finding, and reading it as "ไม่พบข้อสังเกต" would say the opposite of what it found.
 * Unknown words default to observation for the same reason — silence is the unsafe side.
 */

const NOTHING_NOTICED: ReadonlySet<string> = new Set(['PASS', 'MATCH']);
const OFFICERS_LINE: ReadonlySet<string> = new Set(['MANUAL']);

export function isNothingNoticed(result: string): boolean {
    return NOTHING_NOTICED.has(result);
}

export function isOfficersLine(result: string): boolean {
    return OFFICERS_LINE.has(result);
}

export function isObservation(result: string): boolean {
    return !isNothingNoticed(result) && !isOfficersLine(result);
}
