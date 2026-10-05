'use strict';

/**
 * กทล.1 ส่วนที่ ๓ — one paper, one slot.
 *
 * The DTAM form names 22 attachments plus three the platform keeps optional. The
 * platform had grown a different set: seven spellings of ภท.11, four of the land
 * document, one photo slot per step of the wizard. Two consequences, both real:
 * a farmer was asked twice for one paper, and a paper already uploaded under an
 * old id stopped counting the moment the catalog was rewritten.
 *
 * So this file holds two things down:
 *   1. every v2 slot exists, in Thai, and says WHERE the farmer gets it
 *      (sourceHint — the question the counter clerk actually gets asked);
 *   2. every legacy spelling folds onto the v2 id it became, so a document
 *      uploaded yesterday still satisfies the requirement written today.
 */

const { DOCUMENT_SLOTS } = require('../../constants/document-slots');
const { getCanonicalSlotId } = require('../../routes/api/applications/validation-slot-utils');

const V2 = ['LAND_RIGHTS', 'LANDLORD_CONSENT', 'SITE_MAP_COORDS', 'BUILDING_PLAN_PHOTOS', 'FIELD_SURROUND_PHOTOS',
    'PRODUCTION_UTIL_PLAN', 'SECURITY_RESIDUE_PLAN', 'SITE_PHOTOS', 'SOP_MANUAL', 'CONTROLLED_HERB_LICENSE',
    'ID_HOUSE_REG', 'COMMUNITY_REG_MEMBERS', 'COMMUNITY_ASSIGNMENT', 'PRODUCER_SUPERVISION_LETTER',
    'JURISTIC_REG_6M', 'JURISTIC_AUTHORITY', 'PREV_CERT_ORIGINAL', 'RENEWAL_PLAN', 'RENEWAL_UTIL_PLAN',
    'OPERATION_SUMMARY_REPORT', 'POLICE_REPORT', 'DAMAGED_CERT', 'WATER_TEST', 'SOIL_TEST', 'ADDITIONAL_DOCS'];

describe('slot catalog v2', () => {
    it.each(V2)('%s exists with Thai name and sourceHint', (key) => {
        const slot = DOCUMENT_SLOTS[key];
        expect(slot).toBeDefined();
        expect(slot.slotId).toBe(key.toLowerCase());
        expect(slot.name).toMatch(/[ก-๙]/);
        expect(slot.sourceHint).toMatch(/[ก-๙]/);
    });

    it.each([
        ['LICENSE_BT11', 'controlled_herb_license'],
        ['LAND_TITLE', 'land_rights'], ['land_deed', 'land_rights'], ['LAND_CONSENT', 'landlord_consent'],
        ['SITE_MAP', 'site_map_coords'], ['BUILDING_PLAN', 'building_plan_photos'],
        ['EXTERIOR_PHOTOS', 'site_photos'], ['PRODUCTION_PLAN', 'production_util_plan'],
        ['SECURITY_PLAN', 'security_residue_plan'], ['id-card', 'id_house_reg'], ['IND_ID_CARD', 'id_house_reg'],
        ['community-reg', 'community_reg_members'], ['COM_MEETING_DOC', 'community_assignment'],
        ['company-reg', 'juristic_reg_6m'], ['power-attorney', 'juristic_authority'],
    ])('legacy %s folds to %s', (legacy, canon) => {
        expect(getCanonicalSlotId(legacy)).toBe(canon);
    });

    it('a v2 id folds to itself', () => {
        expect(getCanonicalSlotId('CONTROLLED_HERB_LICENSE')).toBe('controlled_herb_license');
    });

    /**
     * The one deviation from the plan's fold list, declared rather than hidden.
     *
     * กทล.1 asks for the ID card and the house registration as ONE attachment, and
     * `ID_HOUSE_REG` is that attachment. Folding the SECOND paper in has to wait
     * for the control that holds both (T6): today the wizard renders
     * `IND_ID_CARD` and `IND_HOUSE_REG` as two required controls at once
     * (documents-step-config.tsx:137,138), and the upload door keeps one file per
     * canonical slot, so the fold would make the house registration delete the ID
     * card with both rows still showing green. Same reason for `COM_MEMBER_LIST` /
     * `COM_TVC03`, `JUR_DIRECTOR_LIST` / `JUR_DIRECTOR_ID` and `INTERIOR_PHOTOS`.
     * The fence is in upload-slot-canonicalisation.test.js; what the server is
     * left holding is in application-document-slot-supersession.test.js.
     */
    it.each([
        ['IND_HOUSE_REG', 'ind_house_reg'],
        ['COM_MEMBER_LIST', 'com_member_list'],
        ['COM_TVC03', 'com_tvc03'],
        ['JUR_DIRECTOR_LIST', 'jur_director_list'],
        ['JUR_DIRECTOR_ID', 'jur_director_id'],
        ['INTERIOR_PHOTOS', 'photos_interior'],
        // The land papers are the case that has to hold hardest: a farmer with two
        // plots attaches the โฉนด of one and the ส.ป.ก. of the other in one sitting
        // (farm-info-plots-land-sections.tsx:241-249). They answer ONE requirement
        // and they are not one paper, so they count together through the
        // satisfaction family and stay four slots to the upload door.
        ['CHANOTE', 'chanote'],
        ['NS3', 'ns3'],
        ['SPK', 'spk'],
    ])('%s keeps its own slot until one control holds both papers (T6/T7)', (legacy, canon) => {
        expect(getCanonicalSlotId(legacy)).toBe(canon);
    });
});
