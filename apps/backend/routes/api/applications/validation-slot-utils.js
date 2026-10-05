'use strict';

/**
 * The backend's door to the ONE slot-id canonicaliser.
 *
 * The alias table and the fold used to live here, and `acceptedTypeForSlot` in
 * @gacp/validation/upload-rules did its own exact-key lookup. That was two
 * spellings of the same truth, and they disagreed: every consumer that came
 * through this file treated `license_pt11` and `LICENSE_PT11` as one slot, while
 * the upload guard saw the lower-case one as an unknown slot and applied the
 * loosest rule any slot uses. A 60 KB PNG posted with slotId=license_pt11 was
 * stored with HTTP 200 and satisfied the LICENSE_PT11 requirement.
 *
 * So the fold moved to the shared package — beside the slot table it keys, and
 * in the one module the browser wizard and the CommonJS server can both require
 * — and this file re-exports it. Every existing importer keeps its path; there
 * is no longer a second copy to drift.
 */

const {
    SLOT_ALIAS_GROUPS,
    normalizeSlotId,
    getCanonicalSlotId,
    slotIdSpellings,
} = require('@gacp/validation/upload-rules');

function buildUploadedSlotSet(uploadedDocuments) {
    const slotSet = new Set();
    if (!Array.isArray(uploadedDocuments)) {
        return slotSet;
    }

    uploadedDocuments.forEach((entry) => {
        if (!entry) {
            return;
        }
        const rawSlotId = typeof entry === 'string'
            ? entry
            : (entry.slotId || entry.type || entry.id || '');
        if (!rawSlotId) {
            return;
        }
        slotSet.add(getCanonicalSlotId(rawSlotId));
    });

    return slotSet;
}

function hasUploadedSlot(slotSet, slotId) {
    return slotSet.has(getCanonicalSlotId(slotId));
}


module.exports = {
    buildUploadedSlotSet,
    hasUploadedSlot,
    getCanonicalSlotId,
    slotIdSpellings,
    normalizeSlotId,
    SLOT_ALIAS_GROUPS,
};
