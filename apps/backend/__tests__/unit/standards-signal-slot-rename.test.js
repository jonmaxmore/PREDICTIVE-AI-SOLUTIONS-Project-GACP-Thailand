'use strict';

/**
 * The gap analysis must survive a slot rename.
 *
 * `application-document-sync.js:48-52` writes `documentType` as the upper-cased
 * CANONICAL slot id, so the moment the กทล.1 v2 fold renamed six slots, an upload
 * of the title deed started being stored as `LAND_RIGHTS` while
 * `standards-signal-map.js:54` still named `LAND_DEED`. The analyzer compared the
 * two by exact string membership, so the signal simply stopped firing: the
 * applicant attached the document, the requirement fell to NOT_MET, and the site
 * compliance score dropped for it. Old rows kept matching and new rows did not,
 * so the two populations diverged with nothing failing anywhere (review r2, MAJOR).
 *
 * The fix is to compare slots the way every other consumer does — through the one
 * canonicaliser — on BOTH sides. This suite is the fence: it drives each slot the
 * signal map names through `deriveDocumentType`, exactly as an upload does, and
 * asserts the requirement still reads it. A future rename that forgets the map
 * fails here instead of in a farmer's score.
 */

const { SIGNAL_MAP } = require('../../data/standards/standards-signal-map');
const { evaluateRequirement, STATUS } = require('../../services/standards-analyzer-service');
const { deriveDocumentType } = require('../../services/application-document-sync');

/**
 * Canonical ids that more than one DIFFERENT paper of this map folds onto. A match through
 * one of those is ambiguous evidence, never proof of the specific paper — the requirement it
 * answers can reach NEEDS_REVIEW and not MET. What that costs and why is pinned in
 * standards-signal-merged-evidence.test.js; here it only decides the expected status.
 */
const MERGED_CANONS = (() => {
    const namesByCanon = new Map();
    Object.values(SIGNAL_MAP).forEach((mapping) => {
        [...(mapping.docs || []), ...(mapping.docsSecondary || [])].forEach((slot) => {
            const canonical = deriveDocumentType(slot);
            const names = namesByCanon.get(canonical) || new Set();
            names.add(String(slot).toUpperCase());
            namesByCanon.set(canonical, names);
        });
    });
    return new Set([...namesByCanon.entries()].filter(([, n]) => n.size > 1).map(([c]) => c));
})();

/** Every (requirement, slot) pair the signal map can answer with a document. */
const DOCUMENT_SIGNALS = [];
Object.entries(SIGNAL_MAP).forEach(([key, mapping]) => {
    // A platform capability answers MET before any document is looked at, so a
    // document signal underneath it proves nothing either way.
    if (mapping.platform) { return; }
    const separator = key.indexOf(':');
    const standardCode = key.slice(0, separator);
    const name = key.slice(separator + 1);
    (mapping.docs || []).forEach((slot) => DOCUMENT_SIGNALS.push({
        standardCode, name, slot, tier: 'primary', merged: MERGED_CANONS.has(deriveDocumentType(slot)),
    }));
    (mapping.docsSecondary || []).forEach((slot) => DOCUMENT_SIGNALS.push({
        standardCode, name, slot, tier: 'secondary', merged: MERGED_CANONS.has(deriveDocumentType(slot)),
    }));
});

/** The application: one upload, stored the way the upload door stores it. */
function contextWithUploadOf(slot) {
    return {
        documentTypes: new Set([deriveDocumentType(slot)]),
        formData: {},
        // Not an onsite-verified state, so `certifiedStates` cannot answer for the
        // document under test.
        status: 'SUBMITTED',
    };
}

function requirementNamed(name) {
    return { id: 'r-under-test', category: 'DOCUMENTATION', name, nameTH: 'ข้อกำหนดที่ทดสอบ', isRequired: true };
}

describe('a renamed slot still reaches the standards signal map', () => {
    test('the map names at least one slot the fold rewrites (else this suite proves nothing)', () => {
        const renamed = DOCUMENT_SIGNALS.filter(
            ({ slot }) => deriveDocumentType(slot) !== slot.toUpperCase(),
        );
        expect(renamed.length).toBeGreaterThan(0);
    });

    test.each(DOCUMENT_SIGNALS)(
        '$standardCode:$name reads a $tier upload of $slot',
        ({ standardCode, name, slot, tier, merged }) => {
            const result = evaluateRequirement(
                requirementNamed(name),
                standardCode,
                contextWithUploadOf(slot),
            );
            // The signal must be READ — never NOT_MET. It may only reach MET when the match is
            // the paper itself: a primary slot that shares its canonical id with other papers
            // is ambiguous and stops at NEEDS_REVIEW.
            expect(result.status).toBe(
                tier === 'primary' && !merged ? STATUS.MET : STATUS.NEEDS_REVIEW,
            );
            // The evidence line names the row that is really in the application.
            expect(result.evidence).toContain(deriveDocumentType(slot));
        },
    );

    test('a document of an unrelated slot does not answer the requirement', () => {
        const result = evaluateRequirement(
            requirementNamed('Farm Registration'),
            'THAI_GACP',
            contextWithUploadOf('CRIMINAL_BG'),
        );
        expect(result.status).toBe(STATUS.NOT_MET);
    });
});
