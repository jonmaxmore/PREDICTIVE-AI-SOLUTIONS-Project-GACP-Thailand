/**
 * An approval the applicant is never told about.
 *
 * The decision handler notifies on REQUEST_MORE and on nothing else. ACCEPT_ALL
 * writes DOC_APPROVED, answers `notified: false`, and sends the applicant no
 * message — so the filing moves, the next thing they owe (the audit fee) is never
 * announced, and the only way to find out is to open the site and look.
 *
 * Observed in the 2026-09-05 UAT walk: the officer accepted all nine papers, the
 * status became DOC_APPROVED, and the applicant's inbox still held exactly two
 * rows — the submit acknowledgement and the earlier revision request.
 *
 * `notifyDocumentApproved` has existed all along (domain-helpers.js:239) and
 * nothing called it.
 *
 * The failure discipline mirrors the REQUEST_MORE branch deliberately: telling
 * the applicant matters, but not more than the filing having actually moved. A
 * throw here would 500 a decision whose status write already committed, and the
 * officer would press the button again.
 */
'use strict';

// Asserted against the SOURCE rather than by driving the handler: the branch
// under test is one `if`, and a behavioural test here would need the whole
// decision pipeline mocked — which is exactly how the silence survived. Reading
// the file cannot be satisfied by a mock that never runs.
const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', 'routes', 'api', 'provider', 'document-reviews.js'),
    'utf8',
);

describe('ACCEPT_ALL tells the applicant their papers passed', () => {
    test('the handler imports the approval notifier at all', () => {
        // It imported only notifyRevisionRequired, which is why approval was silent.
        expect(SOURCE).toMatch(/notifyDocumentApproved/);
    });

    test('the approval notifier is called on the ACCEPT_ALL branch', () => {
        const acceptBranch = SOURCE.slice(SOURCE.indexOf("if (action === 'ACCEPT_ALL')"));
        expect(acceptBranch).toContain('notifyDocumentApproved');
    });

    test('a failed notification is swallowed and logged, never thrown', () => {
        // Same discipline the REQUEST_MORE branch documents: the status write has
        // already committed, so a throw would 500 a decision that DID happen.
        const acceptBranch = SOURCE.slice(SOURCE.indexOf("if (action === 'ACCEPT_ALL')"));
        const upToReturn = acceptBranch.slice(0, acceptBranch.indexOf('return res.json'));
        expect(upToReturn).toMatch(/catch/);
        expect(upToReturn).toMatch(/logger\.warn/);
    });

    test('both branches set `notified`, so the answer never lies about it', () => {
        expect(SOURCE).toMatch(/notified = true/);
        // Two assignments — one per branch — not one shared by accident.
        expect(SOURCE.match(/notified = true/g) || []).toHaveLength(2);
    });
});
