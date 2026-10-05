'use strict';

/**
 * Papers that answer one requirement together, WITHOUT becoming one slot.
 *
 * กทล.1 ส่วนที่ ๓ ข้อ ๑ asks for the land right once. Four different papers can answer it —
 * โฉนด, น.ส.3, ส.ป.ก. and the "อื่น ๆ" line — and the wizard that ships today renders all four
 * as separate cards with separate file inputs (apps/web-app/src/constants/options.ts:50-55,
 * farm-info-plots-land-sections.tsx:167,241-249), telling the farmer to attach every kind they
 * hold.
 *
 * The first attempt at this folded the four onto one canonical slot. That counted them
 * correctly and destroyed them in pairs: the upload door keeps ONE file per canonical slot
 * (routes/api/applications/applications.js:1413-1415,
 * services/application-document-sync.js:142-147), so a farmer with two plots who attached the
 * โฉนด of one and the ส.ป.ก. of the other was left with one file on the server, two green chips
 * on screen, and no way to tell.
 *
 * So the two questions are answered in two places:
 *
 *   - WHICH SLOT IS THIS FILE? — the fold (upload-rules.js). One paper, one slot. A group there
 *     may join two spellings of the same paper and nothing else, because a second upload into a
 *     slot REPLACES what is in it.
 *   - IS THE REQUIREMENT SATISFIED? — this table. It is read by the requirements engine and by
 *     nothing on the upload path, so listing a paper here can never delete another one.
 *
 * A family is therefore the opposite of a fold, and `buildSatisfactionFamilies` refuses a family
 * whose own members fold together — that would be a fold wearing a family's clothes. The day T7
 * ships one land-document control and T15 deletes the four old ones, the family stops mattering
 * for new applications; the drafts filed before that day keep their four ids forever, so it stays.
 *
 * ON `OTHER`. The wizard's fourth land card posts `slotId: 'OTHER'` (options.ts:54), which
 * normalises to the slot `other` — a name generic enough to worry about. It is in the family
 * anyway, because the alternative is worse and the risk is measured, not assumed:
 *   - the shipping client already counts it: documents-step-dedupe.ts:88-91 marks the land
 *     requirement satisfied for ANY file in farmData.landDocuments with a url, no type filter,
 *     and documents-step.tsx:75-77 then stops rendering that control. Leaving `other` out of the
 *     family would mean the wizard says ครบ and the server says ไม่ครบ for one applicant class —
 *     the farmer whose only paper is a เอกสารสิทธิ์อื่น ๆ (review r3, finding 3);
 *   - nothing else writes it: LAND_DOCUMENT_OPTIONS is the only source of that id in the web app,
 *     and `application_documents` holds zero rows of it today (checked 2026-09-04).
 * The permanent fix is not a family entry, it is a name: T7's single land control should file
 * that paper as `other_land` and this member should go away with the screen (carry-over recorded
 * in task-7-brief.md). `other_land` itself is named by the coordinator ruling and is inert today
 * — no surface writes it — so it is listed for the drafts the ruling had in mind, not for traffic.
 */

const { getCanonicalSlotId } = require('./upload-rules');

/**
 * Build the table, refusing a family that is secretly a fold.
 *
 * Every member is canonicalised, so a family may be declared in any spelling. If two DECLARED
 * members land on one canonical id they are two spellings of one paper, which belongs in
 * SLOT_ALIAS_GROUPS, not here — and silently de-duplicating them would erase exactly the
 * property the T6/T7 carry-over relies on (review r3, finding 5).
 *
 * @param {Record<string, string[]>} declaration
 * @returns {Readonly<Record<string, readonly string[]>>}
 */
function buildSatisfactionFamilies(declaration) {
    const table = {};
    Object.entries(declaration).forEach(([slot, members]) => {
        const canonicalSlot = getCanonicalSlotId(slot);
        const byCanonical = new Map();
        members.forEach((member) => {
            const canonical = getCanonicalSlotId(member);
            const already = byCanonical.get(canonical);
            if (already !== undefined) {
                throw new Error(
                    `satisfaction family "${canonicalSlot}" declares ${already} and ${member}, `
                    + `which are the same slot (${canonical}). Two spellings of one paper belong `
                    + 'in SLOT_ALIAS_GROUPS; a family joins papers that stay separate.',
                );
            }
            byCanonical.set(canonical, member);
        });
        table[canonicalSlot] = Object.freeze([...byCanonical.keys()]);
    });
    return Object.freeze(table);
}

/** Requirement slot → every slot whose upload answers it. */
const SATISFACTION_FAMILIES = buildSatisfactionFamilies({
    // A1 เอกสารสิทธิ์ที่ดิน: the v2 slot plus the four land papers the farm step still asks for
    // one by one. `other`/`other_land` per the reasoning in the header.
    land_rights: ['land_rights', 'CHANOTE', 'NS3', 'SPK', 'OTHER', 'OTHER_LAND'],
});

/**
 * Every slot whose upload satisfies `slotId` — itself when it has no family.
 *
 * @param {string} slotId any spelling; folded before the lookup
 * @returns {string[]} canonical slot ids
 */
function slotsSatisfying(slotId) {
    const canonical = getCanonicalSlotId(slotId);
    return SATISFACTION_FAMILIES[canonical] || [canonical];
}

/**
 * Is `slotId` answered by what the applicant has already uploaded?
 *
 * The uploaded ids are folded here: 14 rows in the demo database carry documentType CHANOTE,
 * and a caller that compared them raw would ask those farmers for a land document the server is
 * already holding.
 *
 * @param {string} slotId
 * @param {Iterable<string>} uploadedSlotIds any spellings; folded here
 * @returns {boolean}
 */
function isSlotSatisfied(slotId, uploadedSlotIds) {
    const uploaded = new Set(
        Array.from(uploadedSlotIds || []).map((id) => getCanonicalSlotId(id)),
    );
    return slotsSatisfying(slotId).some((member) => uploaded.has(member));
}

module.exports = {
    SATISFACTION_FAMILIES,
    buildSatisfactionFamilies,
    slotsSatisfying,
    isSlotSatisfied,
};
