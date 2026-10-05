'use strict';

/**
 * A rename must not cost the applicant their evidence — and a MERGE must not hand them
 * compliance they never proved.
 *
 * Round 3 canonicalised both sides of the documentType comparison. That revived seventeen
 * dead (requirement, slot) pairs, and in the same stroke made five DIFFERENT papers
 * interchangeable: the platform used to ask for an SOP per activity (cultivation, harvest,
 * storage, pest, processing) and now asks for ONE manual, so all five ids fold onto
 * SOP_MANUAL. With a plain canonical compare, the single SOP file every applicant attaches
 * made WHO:Drying Protocols and ASEAN:Pest Control System report MET — and the officer read
 * `พบเอกสารหลักฐานหลักในคำขอ: SOP_HARVEST` on an application whose only row said SOP_MANUAL.
 * The farmer is told a requirement is satisfied for which nothing was written, so they do
 * not write it (review r3, finding 1).
 *
 * The rule: a match is full strength when the row carries the slot itself or the id that
 * slot was RENAMED to. A match that exists only because several distinct papers now share
 * one id is ambiguous — it may support NEEDS_REVIEW and may never on its own report MET.
 * The fold says the same thing in its own words: whether the one file covers every activity
 * is a question for the officer's per-slot review, not for a fold.
 */

const { SIGNAL_MAP } = require('../../data/standards/standards-signal-map');
const { evaluateRequirement, STATUS } = require('../../services/standards-analyzer-service');
const { deriveDocumentType } = require('../../services/application-document-sync');
const { getCanonicalSlotId } = require('../../routes/api/applications/validation-slot-utils');

/** Recomputed from the map here, independently of the service's own derivation. */
const MERGED_CANONS = (() => {
    const namesByCanon = new Map();
    Object.values(SIGNAL_MAP).forEach((mapping) => {
        [...(mapping.docs || []), ...(mapping.docsSecondary || [])].forEach((slot) => {
            const canonical = getCanonicalSlotId(slot).toUpperCase();
            const names = namesByCanon.get(canonical) || new Set();
            names.add(String(slot).toUpperCase());
            namesByCanon.set(canonical, names);
        });
    });
    return new Set([...namesByCanon.entries()].filter(([, n]) => n.size > 1).map(([c]) => c));
})();

/** An application holding exactly these rows, stored the way the upload door stores them. */
function stored(...documentTypes) {
    return { documentTypes: new Set(documentTypes), formData: {}, status: 'SUBMITTED' };
}

function requirementNamed(name) {
    return { id: 'r', category: 'PROCESS', name, nameTH: 'ข้อกำหนด', isRequired: true };
}

describe('a merged slot is ambiguous evidence, not proof', () => {
    test('the map really does merge something (otherwise this suite proves nothing)', () => {
        expect([...MERGED_CANONS]).toContain('SOP_MANUAL');
        expect(deriveDocumentType('SOP_HARVEST')).toBe('SOP_MANUAL');
    });

    test('the one SOP manual does not report a topic-specific requirement as MET', () => {
        const drying = evaluateRequirement(requirementNamed('Drying Protocols'), 'WHO', stored('SOP_MANUAL'));
        expect(drying.status).toBe(STATUS.NEEDS_REVIEW);

        const pest = evaluateRequirement(requirementNamed('Pest Control System'), 'ASEAN', stored('SOP_MANUAL'));
        expect(pest.status).toBe(STATUS.NEEDS_REVIEW);
    });

    test('the evidence line names the file the applicant really attached, and only that', () => {
        const drying = evaluateRequirement(requirementNamed('Drying Protocols'), 'WHO', stored('SOP_MANUAL'));
        expect(drying.evidence).toContain('SOP_MANUAL');
        expect(drying.evidence).not.toContain('SOP_HARVEST');
        expect(drying.evidence).not.toContain('SOP_PROCESSING');
        expect(drying.evidence).not.toContain('SOP_STORAGE');
    });

    test('a row written before the merge still answers its own requirement exactly', () => {
        const pest = evaluateRequirement(requirementNamed('Pest Control System'), 'ASEAN', stored('SOP_PEST'));
        expect(pest.status).toBe(STATUS.MET);
        expect(pest.evidence).toContain('SOP_PEST');
    });

    test('that same old row does not answer a DIFFERENT SOP requirement', () => {
        // review r3 finding 8: standards-analyzer-service.test.js:103 feeds SOP_PEST and asserts
        // only Pesticide Residues, so Drying Protocols flipping to MET went unnoticed.
        const drying = evaluateRequirement(requirementNamed('Drying Protocols'), 'WHO', stored('SOP_PEST'));
        expect(drying.status).not.toBe(STATUS.MET);
    });

    test('a pure rename keeps full strength — the round-3 fix stays fixed', () => {
        const farm = evaluateRequirement(requirementNamed('Farm Registration'), 'THAI_GACP', stored('LAND_RIGHTS'));
        expect(farm.status).toBe(STATUS.NEEDS_REVIEW);
        expect(farm.evidence).toContain('LAND_RIGHTS');
        // and it must not claim the retired spelling is what is on file
        expect(farm.evidence).not.toContain('LAND_DEED');
    });

    /** No requirement whose primary evidence is only a merged id may report MET. */
    const MERGED_PRIMARY_ONLY = [];
    Object.entries(SIGNAL_MAP).forEach(([key, mapping]) => {
        if (mapping.platform) { return; }
        const docs = mapping.docs || [];
        if (docs.length === 0) { return; }
        const canons = new Set(docs.map((slot) => getCanonicalSlotId(slot).toUpperCase()));
        if ([...canons].every((canonical) => MERGED_CANONS.has(canonical))) {
            const separator = key.indexOf(':');
            MERGED_PRIMARY_ONLY.push({
                standardCode: key.slice(0, separator),
                name: key.slice(separator + 1),
                upload: [...canons][0],
            });
        }
    });

    test('the sweep found the requirements at risk', () => {
        expect(MERGED_PRIMARY_ONLY.length).toBeGreaterThan(0);
    });

    test.each(MERGED_PRIMARY_ONLY)(
        '$standardCode:$name is not MET by a bare $upload upload',
        ({ standardCode, name, upload }) => {
            const result = evaluateRequirement(requirementNamed(name), standardCode, stored(upload));
            expect(result.status).not.toBe(STATUS.MET);
        },
    );
});
