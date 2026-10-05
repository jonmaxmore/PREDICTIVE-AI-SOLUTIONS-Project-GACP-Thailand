/**
 * Task 9 fix round 1 (task-9-review.md I1): on a file whose truth is
 * UNREADABLE the rule layer emits DOC_TYPE=UNREADABLE, CROSS_MATCH=NOT_FOUND
 * and VALIDITY=DATE_NOT_FOUND automatically (the READABILITY cascade). Scoring
 * those as DOC_TYPE/CROSS_MATCH/VALIDITY true positives measures READABILITY
 * three more times. The dependent checks are scored only on files whose truth
 * READABILITY is PASS; READABILITY keeps its own numbers, and a cascade flag
 * that goes missing is still caught by presenceErrors.
 *
 * @see apps/backend/scripts/document-precheck/accuracy-report.js
 */

'use strict';

const { computeMetrics } = require('../../../scripts/document-precheck/accuracy-report');

const ALL_PASS = { READABILITY: 'PASS', DOC_TYPE: 'MATCH', CROSS_MATCH: 'MATCH', VALIDITY: 'PASS' };
const CASCADE = { READABILITY: 'UNREADABLE', DOC_TYPE: 'UNREADABLE', CROSS_MATCH: 'NOT_FOUND', VALIDITY: 'DATE_NOT_FOUND' };

function row(file, expected, actual) {
    return { file, expected, actual };
}

describe('computeMetrics — dependent checks exclude truth-UNREADABLE files', () => {
    const rows = [
        row('readable-correct.pdf', ALL_PASS, ALL_PASS),
        row('readable-wrong-name.pdf', { ...ALL_PASS, CROSS_MATCH: 'MISMATCH' }, { ...ALL_PASS, CROSS_MATCH: 'NOT_FOUND' }),
        row('illegible.png', CASCADE, CASCADE),
    ];
    const m = computeMetrics(rows);

    test('READABILITY is scored on every file', () => {
        expect(m.checks.READABILITY.n).toBe(3);
        expect(m.checks.READABILITY.tp).toBe(1);
    });

    test('DOC_TYPE / CROSS_MATCH / VALIDITY are scored only on the 2 truth-readable files', () => {
        for (const check of ['DOC_TYPE', 'CROSS_MATCH', 'VALIDITY']) {
            expect(m.checks[check].n).toBe(2);
        }
        expect(m.checks.DOC_TYPE.problems).toBe(0);
        expect(m.checks.CROSS_MATCH.tp).toBe(1);
    });

    test('the overall pool holds READABILITY x3 + the dependent checks on readable files only', () => {
        expect(m.overall.n).toBe(3 + 3 * 2);
        expect(m.overall.tp).toBe(2);
    });

    test('a false UNREADABLE on a truth-readable file still counts against the dependent checks', () => {
        const falseUnreadable = computeMetrics([row('blurry-but-legible.png', ALL_PASS, CASCADE)]);
        expect(falseUnreadable.checks.DOC_TYPE.fp).toBe(1);
        expect(falseUnreadable.checks.CROSS_MATCH.fp).toBe(1);
    });

    test('a missing cascade flag on a truth-UNREADABLE file is still a presence error', () => {
        const missing = computeMetrics([row('illegible.png', CASCADE, { ...CASCADE, DOC_TYPE: null })]);
        expect(missing.presenceErrors).toEqual(['illegible.png DOC_TYPE: expected UNREADABLE, got null']);
    });
});
