'use strict';

/**
 * What a GACP document slot will accept, decided ONCE for both sides of the wire.
 *
 * F-G4-08: in the G4 walk a 70-byte 1x1 transparent PNG was accepted by three
 * document slots whose own label says "รองรับ .pdf", and by the step-4 slots as
 * well. Nothing looked at the file: not its real type, not its size, not whether
 * it contained anything. The officer who later "reviewed" those documents was
 * reviewing an invisible pixel, and the certificate rests entirely on that
 * review.
 *
 * Three layers, in this order, because each one only makes sense after the
 * previous has passed:
 *
 *   1. WHAT THE FILE ACTUALLY IS — read from the leading bytes, never from the
 *      filename extension or the browser-reported MIME type. Both of those are
 *      written by whoever sends the file: renaming photo.jpg to deed.pdf defeats
 *      an extension check, and a hand-rolled multipart body can claim any
 *      Content-Type it likes. The bytes at offset 0 are the only part of an
 *      upload the sender cannot lie about without changing the file itself.
 *   2. IS THERE ANYTHING IN IT — see MIN_DOCUMENT_BYTES below for the number and
 *      where it came from.
 *   3. IS IT TOO BIG — one upload must not be able to fill the disk.
 *
 * This module is plain CommonJS on purpose. The browser half of the wizard is
 * TypeScript compiled by Next, the server half is CommonJS Node; a `.ts` module
 * is invisible to the second and a bundler-only module is invisible to the
 * first. CommonJS + JSDoc is the one shape both can require, which is the whole
 * point: the browser check is a courtesy that answers instantly, the server
 * check is the one that counts, and they must be the SAME check or the courtesy
 * becomes a lie.
 *
 * What this module does NOT do: understand what the document says. A national ID
 * card uploaded into the house-registration slot is a valid, large, readable PDF
 * and passes every layer here. Catching that needs OCR plus a field-level
 * expectation per slot, and is a separate piece of work.
 */

/** The file types a GACP document slot can accept, by what the bytes say they are. */
const UPLOAD_KIND = Object.freeze({
    PDF: 'pdf',
    JPEG: 'jpeg',
    PNG: 'png',
    WEBP: 'webp',
});

/**
 * How a slot's declared type maps to the real file kinds it will take.
 *
 * 'LINK' slots (the production video) carry a URL, not bytes, so nothing here
 * applies to them.
 */
const ACCEPTED_KINDS_BY_SLOT_TYPE = Object.freeze({
    PDF: Object.freeze([UPLOAD_KIND.PDF]),
    IMAGE: Object.freeze([UPLOAD_KIND.JPEG, UPLOAD_KIND.PNG, UPLOAD_KIND.WEBP]),
    BOTH: Object.freeze([UPLOAD_KIND.PDF, UPLOAD_KIND.JPEG, UPLOAD_KIND.PNG, UPLOAD_KIND.WEBP]),
    LINK: Object.freeze([]),
});

/**
 * Every wizard document slot and the file kinds it accepts.
 *
 * The server receives only a `slotId` string, so without this table it could
 * only ever apply the loosest rule that any slot uses, which is exactly the
 * state F-G4-08 found: ภท.11 said "รองรับ .pdf" on screen and took a PNG on the
 * wire. The browser wizard reads its slot type from here too
 * (documents-step-config.tsx), so the label a farmer reads and the rule the
 * server applies come from one line of one file.
 *
 * A slotId that is NOT listed here (planting-activity photos, and any slot added
 * later) falls back to DEFAULT_SLOT_TYPE. That is deliberate: an unknown slot
 * still gets layers 1 to 3 against the full accepted set, so it can never be the
 * hole this ledger item is about, but a new slot cannot be silently locked out
 * of the product by an omission here either.
 */
const SLOT_ACCEPTED_TYPE = Object.freeze({
    // Step 1 applicant slots (general-step-applicant-sections.tsx). They render
    // with the default accept=".pdf,image/*" because a farmer photographs an ID
    // card rather than scanning it, so BOTH is what they genuinely take. Listed
    // rather than left to the fallback so this table reads as the inventory of
    // every slot in the wizard.
    'id-card': 'BOTH',
    'house-reg': 'BOTH',
    'criminal-bg': 'BOTH',
    'community-reg': 'BOTH',
    'community-meeting': 'BOTH',
    'president-id': 'BOTH',
    'company-reg': 'BOTH',
    'director-list': 'BOTH',
    'director-id': 'BOTH',
    'power-attorney': 'BOTH',
    // Applicant identity — INDIVIDUAL
    IND_ID_CARD: 'BOTH',
    IND_HOUSE_REG: 'BOTH',
    // Applicant identity — COMMUNITY enterprise.
    //
    // COM_SVC01 and COM_MEETING_DOC are BOTH because the v2 fold puts each of them
    // on the same canonical slot as its step-1 twin (`community-reg`,
    // `community-meeting`), which has always rendered with accept=".pdf,image/*".
    // One slot cannot hold two rules, and resolving that pair to PDF would TAKE
    // AWAY a camera-roll upload the product accepts today — a farmer with a phone
    // and no scanner makes a สำเนา by photographing the paper. So the fold widens
    // rather than narrows, and it widens no further than the twin already went.
    // Every layer F-G4-08 built still runs on the photograph: magic bytes, the
    // 1,835-byte floor, and the server-side decode in
    // services/upload-content-guard.js.
    //
    // COM_TVC03 / COM_MEMBER_LIST keep PDF: no control offers a photograph for
    // them, so there is nothing to preserve and widening would be this task
    // granting a permission nobody asked it for. COM_HOUSE_CODE stays PDF for a
    // different reason — it is not a กทล.1 attachment at all (the house code is a
    // FIELD of ส่วนที่ ๑ in the v2 wizard).
    COM_SVC01: 'BOTH',
    COM_TVC03: 'PDF',
    COM_MEMBER_LIST: 'PDF',
    COM_PRESIDENT_ID: 'BOTH',
    COM_MEETING_DOC: 'BOTH',
    COM_HOUSE_CODE: 'PDF',
    // Applicant identity — JURISTIC person. Same rule as above, applied row by
    // row: JUR_COMPANY_REG and JUR_POA fold onto the slots their step-1 twins
    // (`company-reg`, `power-attorney`) already serve with the camera roll open,
    // so they widen to match. JUR_DIRECTOR_LIST keeps PDF (its twin `director-list`
    // is not folded yet), and ภ.พ.20 / หนังสือบริคณห์สนธิ are not กทล.1 attachments
    // at all — T15's to remove.
    JUR_COMPANY_REG: 'BOTH',
    JUR_DIRECTOR_LIST: 'PDF',
    JUR_DIRECTOR_ID: 'BOTH',
    JUR_POA: 'BOTH',
    JUR_TAX_REG: 'PDF',
    JUR_COMPANY_CERT: 'PDF',
    // The issued licence behind each purpose (shared/certification-purposes.js) — a
    // document the ministry issued, so it arrives as a PDF.
    LICENCE_PT09: 'PDF',
    LICENCE_PT10: 'PDF',
    LICENCE_PT11: 'PDF',
    KRATOM_EXPORT_LICENCE: 'PDF',
    CRIMINAL_BG: 'PDF',
    // Basic
    REG_FORM: 'PDF',
    LAND_TITLE: 'PDF',
    LAND_CONSENT: 'PDF',
    // The other three land papers, and the "อื่น ๆ" card beside them, ask for the SAME
    // legal attachment as LAND_TITLE (they are the land-rights satisfaction family —
    // satisfaction-families.js), and the farm step posts each under its own slot id.
    // Left off this table they fell to DEFAULT_SLOT_TYPE = 'BOTH', so a photograph
    // could satisfy a requirement the platform declares PDF-only through its other
    // spelling — the shape of the F-G4-08 bypass, arriving through the family instead
    // of through an alias. One requirement, one rule, however it is spelled.
    CHANOTE: 'PDF',
    NS3: 'PDF',
    SPK: 'PDF',
    OTHER_LAND: 'PDF',
    OTHER: 'PDF',
    // Location. BUILDING_PLAN keeps PDF even though the กทล.1 attachment it folds
    // into is named 'แบบแปลนอาคารหรือโรงเรือน พร้อมภาพถ่ายภายนอกและภายใน': no
    // control offers a photograph for it today, so widening it takes nothing away
    // from anyone and grants something nobody asked for. It is the upload
    // surface's call (T7), where the label a farmer reads is written — same
    // treatment as LAND_RIGHTS below.
    SITE_MAP: 'PDF',
    BUILDING_PLAN: 'PDF',
    EXTERIOR_PHOTOS: 'BOTH',
    // Production
    PRODUCTION_PLAN: 'PDF',
    SECURITY_PLAN: 'PDF',
    INTERIOR_PHOTOS: 'BOTH',
    // Quality system
    SOP_MANUAL: 'PDF',
    CP_CCP_TABLE: 'PDF',
    INPUT_REPORT: 'PDF',
    EQUIPMENT_CALIBRATION: 'PDF',
    // Training
    GACP_CERTIFICATE: 'PDF',
    STRAIN_CERTIFICATE: 'PDF',
    PROVIDER_TRAINING: 'PDF',
    PROVIDER_TEST: 'PDF',
    // Laboratory
    SOIL_TEST: 'PDF',
    NUTRIENT_SPEC: 'PDF',
    WATER_TEST: 'PDF',
    FLOWER_TEST: 'PDF',
    LAB_CERTIFICATE: 'PDF',
    // Other
    DESTINATION_CERT: 'PDF',
    VIDEO_LINK: 'LINK',
    ADDITIONAL_DOCS: 'BOTH',
    // ── v2 — กทล.1 canonical slots (spec 2026-09-01) ─────────────────────────
    // ONE rule decides every row here: a v2 slot declares the LOOSEST type any
    // control that folds into it already offers, so the fold takes nothing away
    // from a farmer mid-application, and it grants nothing either. Where the
    // folded controls all say PDF, the v2 row says PDF — even when the slot's own
    // กทล.1 name mentions a photograph (BUILDING_PLAN_PHOTOS) or when a farmer
    // would obviously photograph the paper (LAND_RIGHTS). Widening those is a real
    // decision about what a สำเนา may be, and it belongs to the task that writes
    // the label a farmer reads next to the picker (T7/T9), not to a fold.
    //
    // The effect of the rule is that a slot and every old spelling of it declare
    // the SAME type, so `conflictingSlotTypeDeclarations()` stays a REPORT that a
    // pair drifted apart rather than a resolution nobody decided.
    //
    // SOP_MANUAL, WATER_TEST, SOIL_TEST and ADDITIONAL_DOCS keep their rows above:
    // the v2 catalog adopts those ids unchanged.
    LAND_RIGHTS: 'PDF',
    LANDLORD_CONSENT: 'PDF',
    SITE_MAP_COORDS: 'PDF',
    BUILDING_PLAN_PHOTOS: 'PDF',
    FIELD_SURROUND_PHOTOS: 'BOTH',
    PRODUCTION_UTIL_PLAN: 'PDF',
    SECURITY_RESIDUE_PLAN: 'PDF',
    SITE_PHOTOS: 'BOTH',
    CONTROLLED_HERB_LICENSE: 'PDF',
    ID_HOUSE_REG: 'BOTH',
    COMMUNITY_REG_MEMBERS: 'BOTH',
    COMMUNITY_ASSIGNMENT: 'BOTH',
    PRODUCER_SUPERVISION_LETTER: 'PDF',
    JURISTIC_REG_6M: 'BOTH',
    JURISTIC_AUTHORITY: 'BOTH',
    PREV_CERT_ORIGINAL: 'BOTH',
    RENEWAL_PLAN: 'PDF',
    RENEWAL_UTIL_PLAN: 'PDF',
    OPERATION_SUMMARY_REPORT: 'PDF',
    POLICE_REPORT: 'BOTH',
    DAMAGED_CERT: 'BOTH',
});

/** Applied to a slotId this table does not know. See SLOT_ACCEPTED_TYPE. */
const DEFAULT_SLOT_TYPE = 'BOTH';

/**
 * The spellings of one slot, and the canonicaliser that folds them together.
 *
 * F-G4-08 fast-follow: the table above was looked up by EXACT key after a
 * `.trim()`, while every other slot consumer in the platform (the mandatory
 * document check, the requirement snapshot, application_documents) first ran the
 * id through this alias fold. So `LICENSE_PT11` was PDF-only and `license_pt11`
 * was an unknown slot that fell to DEFAULT_SLOT_TYPE — which accepts images. An
 * adversarial pass proved it on the real router: a 60 KB PNG posted with
 * slotId=license_pt11 was stored with HTTP 200 and satisfied the LICENSE_PT11
 * requirement. Seven alias spellings, seven accepted. The PDF-only rule held
 * only for whoever happened to spell the slot the way the table did.
 *
 * The fold therefore has to be the SAME fold, not a second one that agrees for
 * now: this is the one definition, and the backend's
 * routes/api/applications/validation-slot-utils.js re-exports it rather than
 * keeping a copy. It lives beside the slot table because the table is what it
 * keys, and because this module is the one place both the browser wizard and the
 * CommonJS server can already require.
 */
const SLOT_ALIAS_GROUPS = Object.freeze([
    ['id_card', 'ID_CARD', 'idCardDoc'],
    ['house_reg', 'HOUSE_REG', 'houseRegDoc'],
    ['criminal_bg', 'CRIMINAL_BG', 'criminalBgDoc'],
    ['land_deed', 'LAND_DEED', 'LAND_TITLE', 'landTitle', 'land_title'],
    ['land_lease', 'LAND_LEASE', 'RENTAL_CONTRACT', 'landLease', 'land_lease'],
    ['land_consent', 'LAND_CONSENT', 'landConsent', 'land_consent'],
    // The three licences that back an application purpose — one slot each, one spelling
    // each (operator ruling 2026-10-05). Earlier these carried PT9/PT09 and
    // license/licence variants, and `license_pt11` was folded onto the scope
    // `controlled_herb_license` below — two different papers under one id. They are
    // separate requirements now, so no spelling of one may reach the other.
    ['licence_pt09', 'LICENCE_PT09'],
    ['licence_pt10', 'LICENCE_PT10'],
    ['licence_pt11', 'LICENCE_PT11'],
    ['kratom_export_licence', 'KRATOM_EXPORT_LICENCE'],
    // บท.11 is the v1 catalogue row for the controlled-herb permit; it still folds to
    // the v2 `controlled_herb_license` through the v2 group below.
    ['license_bt11', 'LICENSE_BT11'],
    ['license_pt12', 'LICENSE_PT12', 'pt12'],
    ['license_bt13', 'license_pt13', 'LICENSE_BT13', 'LICENSE_PT13'],
    ['license_bt16', 'license_pt16', 'LICENSE_BT16', 'LICENSE_PT16'],
    ['form_gacp_application', 'FORM_GACP_APPLICATION', 'form_09', 'FORM_09'],
    ['form_farm_summary', 'FORM_FARM_SUMMARY', 'form_10', 'FORM_10'],
    ['form_self_assessment', 'FORM_SELF_ASSESSMENT', 'form_11', 'FORM_11'],
    ['photos_exterior', 'PHOTOS_EXTERIOR', 'EXTERIOR_PHOTOS', 'photos_site', 'PHOTOS_SITE'],
    ['photos_signage', 'PHOTOS_SIGNAGE'],
    ['photos_interior', 'PHOTOS_INTERIOR', 'INTERIOR_PHOTOS'],
    ['photos_storage', 'PHOTOS_STORAGE'],
    ['site_map', 'SITE_MAP'],
    ['sop_cultivation', 'SOP_CULTIVATION'],
    ['sop_harvest', 'SOP_HARVEST'],
    ['sop_storage', 'SOP_STORAGE'],
    ['sop_pest', 'SOP_PEST'],

    // ── v2 — one paper, one slot (กทล.1 ส่วนที่ ๓, spec 2026-09-01) ──────────
    //
    // The groups above fold SPELLINGS of one slot together. These fold SLOTS
    // together: the platform had grown four ids for the land document, three for
    // ภท.11 and one photo slot per wizard step, so a farmer was asked twice for
    // one paper and the officer's checklist could not be read against the form it
    // comes from. The v2 catalog (constants/document-slots.js) names one slot per
    // กทล.1 attachment, and these groups are what makes a document uploaded
    // yesterday under an old id still satisfy the requirement written today.
    //
    // They are LAST on purpose. SLOT_ALIAS_LOOKUP is built by walking the groups
    // in order and writing each spelling into one map, so a later group wins: an
    // id that appears both here and in a group above (land_deed, id_card,
    // license_bt11 ...) ends up on the v2 canon, and there is no second answer
    // left behind for another consumer to find. Every spelling of a remapped
    // group is repeated here for the same reason — `landTitle` normalises to
    // `landtitle`, a DIFFERENT key from `land_title`, so leaving it out would
    // split one slot in two exactly the way F-G4-08 did. A WHOLE old group moves
    // or none of it does: taking `EXTERIOR_PHOTOS` across while its four sibling
    // spellings stayed behind was not a smaller fold, it was a split — and the
    // dead half was the half that matters, because application-document-sync.js
    // writes documentType as the upper-cased CANONICAL id, so what is really in
    // application_documents is 'PHOTOS_EXTERIOR' and 'EXTERIOR_PHOTOS' is not in
    // the table at all. The pair of tests "no spelling of one slot is left behind"
    // and "a canonical id is a fixed point of the fold" hold that down.
    //
    // WHAT IS NOT FOLDED YET, AND WHY IT IS NOT AN OMISSION.
    // Several กทล.1 slots hold more than one paper: ID_HOUSE_REG is บัตร +
    // ทะเบียนบ้าน, COMMUNITY_REG_MEMBERS is หนังสือจดทะเบียน + บัญชีรายชื่อสมาชิก,
    // BUILDING_PLAN_PHOTOS is แบบแปลน + ภาพถ่าย, JURISTIC_AUTHORITY takes either a
    // หนังสือมอบอำนาจ or a บัญชีรายชื่อกรรมการ. On the v2 wizard each is ONE card and
    // one file (T6/T7). On the wizard that ships TODAY each of those papers still
    // has its own required control, several of them on screen at once, and the
    // upload door keeps exactly one file per canonical slot: applications.js
    // drops every draftDocuments entry whose canonical slot matches, and
    // application-document-sync.js releases every row carrying any spelling of it.
    // Folding the second paper in before one control holds both would make the
    // second upload DELETE the first while the screen still shows both green.
    //
    // So a group here may join two spellings of the SAME paper (a rename, where
    // replacing a paper with itself loses nothing) and may not join two papers a
    // farmer can still attach separately. Deferred until T6/T7/T9 write the single
    // control: IND_HOUSE_REG + house_reg, COM_MEMBER_LIST + COM_TVC03,
    // JUR_DIRECTOR_LIST + JUR_DIRECTOR_ID, INTERIOR_PHOTOS + photos_interior,
    // and CHANOTE + NS3 + SPK (the land papers — a farmer
    // with two plots attaches two of them, so they COUNT together through
    // satisfaction-families.js and stay separate slots here). The fence that fails
    // if one of them is folded early is
    // __tests__/unit/upload-slot-canonicalisation.test.js, "a fold must not
    // swallow a paper the farmer can still attach separately".
    // A1 is ONE requirement with four papers behind it: โฉนด, น.ส.3, ส.ป.ก. and the
    // "อื่น ๆ" line. That makes them a SATISFACTION FAMILY (satisfaction-families.js
    // — any of them answers the requirement), which is the opposite of a fold: the
    // farm step renders all four as their own card with their own file input
    // (farm-info-plots-land-sections.tsx:241-249) and tells the farmer to attach
    // every kind they hold, so a farmer with two plots files two of them in one
    // sitting. Folded onto one canon, the ส.ป.ก. upload would release the โฉนด row
    // while both chips stayed green. Only the SPELLINGS of the slot itself fold in
    // here: LAND_TITLE and land_deed are the platform's two names for the one land
    // rights upload, and replacing that paper with itself loses nothing.
    ['land_rights', 'LAND_RIGHTS',
        'LAND_TITLE', 'land_title', 'landTitle', 'land_deed', 'LAND_DEED'],
    ['landlord_consent', 'LANDLORD_CONSENT', 'LAND_CONSENT', 'land_consent', 'landConsent'],
    ['site_map_coords', 'SITE_MAP_COORDS', 'SITE_MAP', 'site_map'],
    // A4 is 'แบบแปลนอาคารหรือโรงเรือน พร้อมภาพถ่ายภายนอกและภายใน' — the plan and the
    // photographs of the building are ONE attachment on the form. Only the drawing
    // slot and the processing-shed map fold in here today; the interior photo is a
    // SECOND paper with a control of its own (see "what is NOT folded yet" below).
    ['building_plan_photos', 'BUILDING_PLAN_PHOTOS', 'BUILDING_PLAN',
        'facility_map', 'FACILITY_MAP'],
    ['field_surround_photos', 'FIELD_SURROUND_PHOTOS'],
    ['production_util_plan', 'PRODUCTION_UTIL_PLAN', 'PRODUCTION_PLAN'],
    ['security_residue_plan', 'SECURITY_RESIDUE_PLAN', 'SECURITY_PLAN'],
    // A7 asks for 'สถานที่ผลิต (ปลูก) และการเก็บเกี่ยว', and the slot's own
    // instruction names ที่พักผลผลิต, so the old คลังเก็บ photo is part of it.
    ['site_photos', 'SITE_PHOTOS', 'EXTERIOR_PHOTOS',
        'photos_exterior', 'PHOTOS_EXTERIOR', 'photos_site', 'PHOTOS_SITE',
        'photos_storage', 'PHOTOS_STORAGE'],
    // A8 is one คู่มือ/SOP for the operation. The platform had split it into five
    // by activity, so a farmer who uploaded the cultivation SOP was told the SOP
    // was missing. Whether the ONE file they attached covers every activity is a
    // question for the officer's per-slot review (spec §5), not for a fold.
    // sop_processing belongs with the other four: SOP_MANUAL's own description
    // runs 'ตั้งแต่เตรียมพื้นที่ ... จนถึงเก็บรักษาและแปรรูป'.
    ['sop_manual', 'SOP_MANUAL', 'sop_cultivation', 'SOP_CULTIVATION',
        'sop_harvest', 'SOP_HARVEST', 'sop_storage', 'SOP_STORAGE',
        'sop_pest', 'SOP_PEST', 'sop_processing', 'SOP_PROCESSING'],
    // The cannabis planting licence or planting-notification evidence — OPTIONAL ("ถ้ามี",
    // operator ruling 2026-10-05; กทล.1 officer checklist 1.1). The v1 บท.11 row lands here. The three PURPOSE
    // licences (licence_pt09/10/11) are NOT folded in: each is a different issued
    // licence that a purpose demands, and folding them would let one upload satisfy
    // another.
    ['controlled_herb_license', 'CONTROLLED_HERB_LICENSE', 'LICENSE_BT11', 'license_bt11'],
    // กทล.1 asks for the ID card AND the house registration as ONE attachment. Only
    // the ID card's spellings fold in today — the house registration still has its
    // own control (see "what is NOT folded yet" below). The community president's
    // card is the same paper as the applicant's for the holder type that uses it,
    // and the two are never on screen together.
    ['id_house_reg', 'ID_HOUSE_REG', 'IND_ID_CARD', 'id-card', 'ID_CARD', 'idCardDoc',
        'COM_PRESIDENT_ID', 'president-id'],
    // community_cert is where the LIVE M2a seed rule for วิสาหกิจชุมชน points, so
    // leaving it out would ask a วิสาหกิจ for a หนังสือจดทะเบียน the platform is
    // already holding. The member list (ท.ว.ช.3) is the slot's second paper and is
    // not folded yet.
    ['community_reg_members', 'COMMUNITY_REG_MEMBERS', 'COM_SVC01', 'community-reg',
        'community_cert', 'COMMUNITY_CERT'],
    ['community_assignment', 'COMMUNITY_ASSIGNMENT', 'COM_MEETING_DOC', 'community-meeting'],
    // JURISTIC_REG_6M's own text says 'ใช้ได้ทั้งบริษัท ห้างหุ้นส่วน วิสาหกิจเพื่อสังคม
    // หรือสหกรณ์การเกษตร' and its sourceHint sends a สหกรณ์ to สำนักงานสหกรณ์จังหวัด,
    // so a coop_cert already on file is this attachment.
    ['juristic_reg_6m', 'JURISTIC_REG_6M', 'JUR_COMPANY_REG', 'company-reg',
        'coop_cert', 'COOP_CERT'],
    // 'หนังสือแสดงว่าผู้ยื่นเป็นผู้แทนหรือผู้มีอำนาจทำการแทนนิติบุคคล' — the หนังสือ
    // มอบอำนาจ is the instance the catalog names first and the only one folded now.
    ['juristic_authority', 'JURISTIC_AUTHORITY', 'JUR_POA', 'power-attorney'],
    // The renewal set: every renewal already in flight carries these two old ids,
    // and a fold is the only thing standing between that applicant and being told
    // to attach a certificate the platform issued to them itself.
    ['prev_cert_original', 'PREV_CERT_ORIGINAL', 'previous_cert', 'PREVIOUS_CERT'],
    ['operation_summary_report', 'OPERATION_SUMMARY_REPORT', 'renewal_report', 'RENEWAL_REPORT'],
]);

/**
 * One slot id written the one way, before anything is looked up by it.
 *
 * Case, `-` and `.` carry no meaning in a slot id: they are how a React `id`
 * prop, a DTAM form code and a database column each happen to spell the same
 * slot. Folding them is what makes `license-pt11`, `LICENSE.PT11` and
 * `license_pt11` one thing rather than three.
 *
 * @param {string} value
 * @returns {string}
 */
function normalizeSlotId(value) {
    return String(value || '')
        .trim()
        .replaceAll('-', '_')
        .replaceAll('.', '_')
        .toLowerCase();
}

const SLOT_ALIAS_LOOKUP = (() => {
    const map = new Map();
    SLOT_ALIAS_GROUPS.forEach((group) => {
        const canonical = normalizeSlotId(group[0]);
        group.forEach((value) => {
            map.set(normalizeSlotId(value), canonical);
        });
    });
    return map;
})();

/**
 * The one id a slot is known by, whichever of its spellings arrived.
 *
 * @param {string} value
 * @returns {string}
 */
function getCanonicalSlotId(value) {
    const normalized = normalizeSlotId(value);
    return SLOT_ALIAS_LOOKUP.get(normalized) || normalized;
}

/** Every declared spelling of a slot, keyed by the id it folds to. */
const SLOT_SPELLINGS_BY_CANONICAL = (() => {
    const map = new Map();
    SLOT_ALIAS_GROUPS.forEach((group) => {
        // getCanonicalSlotId, not group[0]: a legacy group whose canon has since
        // been folded onto a v2 slot contributes its spellings to THAT slot, not
        // to an id nothing answers to any more.
        const canonical = getCanonicalSlotId(group[0]);
        const spellings = map.get(canonical) || new Set([canonical]);
        group.forEach((value) => spellings.add(normalizeSlotId(value)));
        map.set(canonical, spellings);
    });
    return map;
})();

/**
 * Every id a STORED row could be carrying for the slot this id names.
 *
 * getCanonicalSlotId answers "what is this slot called today". Rows written
 * yesterday are not re-canonicalised — nothing rewrites them (spec §7: no data
 * migration) — so a reader that has to FIND them needs yesterday's names too.
 *
 * The case that makes this load-bearing: application_documents.currentForSlot
 * holds the canonical id of the day it was written, and at most one row per
 * (application, slot) may carry it. An upload that releases the slot by exact
 * string releases nothing when the fold has since renamed it, and the
 * application ends up with two rows both claiming to be the current document for
 * one กทล.1 attachment — which the unique index cannot catch, because the two
 * strings differ.
 *
 * @param {string} value any spelling of the slot
 * @returns {string[]} normalized spellings, canonical id first
 */
function slotIdSpellings(value) {
    const canonical = getCanonicalSlotId(value);
    const known = SLOT_SPELLINGS_BY_CANONICAL.get(canonical);
    return known ? [canonical, ...[...known].filter((one) => one !== canonical)] : [canonical];
}

/**
 * Which declaration wins when two spellings of ONE slot declare different types.
 *
 * The alias fold can bring two rows of SLOT_ACCEPTED_TYPE onto the same slot —
 * step 1's `criminal-bg` and step 8's `CRIMINAL_BG` are the same document to
 * every other consumer in the platform, but this table declared them BOTH and
 * PDF. One slot cannot have two rules, and the tighter of the two is the only
 * safe way to resolve it: relaxing a slot that some part of the product has
 * already declared PDF-only is how F-G4-08 happened in the first place. The
 * looser row is a bug to be reported, not a permission to be granted —
 * `conflictingSlotTypeDeclarations()` below is what reports it.
 *
 * LINK ranks last because a LINK slot carries a URL and no bytes at all: if one
 * ever folds together with a byte slot, the byte rule is the one an upload has
 * to satisfy.
 */
const SLOT_TYPE_STRICTNESS = Object.freeze({ PDF: 0, IMAGE: 1, BOTH: 2, LINK: 3 });

function stricterSlotType(left, right) {
    const leftRank = SLOT_TYPE_STRICTNESS[left];
    const rightRank = SLOT_TYPE_STRICTNESS[right];
    if (typeof leftRank !== 'number') {
        return right;
    }
    if (typeof rightRank !== 'number') {
        return left;
    }
    return leftRank <= rightRank ? left : right;
}

/** SLOT_ACCEPTED_TYPE re-keyed by canonical id — what acceptedTypeForSlot reads. */
const CANONICAL_SLOT_ACCEPTED_TYPE = (() => {
    const map = new Map();
    Object.keys(SLOT_ACCEPTED_TYPE).forEach((declaredKey) => {
        const canonical = getCanonicalSlotId(declaredKey);
        const declared = SLOT_ACCEPTED_TYPE[declaredKey];
        const already = map.get(canonical);
        map.set(canonical, already === undefined ? declared : stricterSlotType(already, declared));
    });
    return map;
})();

/**
 * Every slot whose spellings declare more than one type, with the spellings.
 *
 * Exported so a test can hold the list of KNOWN contradictions and fail the day
 * a new one appears — silently resolving a fresh disagreement is exactly the
 * kind of quiet drift this whole fix is about.
 *
 * @returns {Array<{canonicalSlotId: string, declarations: Array<{slotId: string, type: string}>, resolvedType: string}>}
 */
function conflictingSlotTypeDeclarations() {
    const byCanonical = new Map();
    Object.keys(SLOT_ACCEPTED_TYPE).forEach((declaredKey) => {
        const canonical = getCanonicalSlotId(declaredKey);
        const rows = byCanonical.get(canonical) || [];
        rows.push({ slotId: declaredKey, type: SLOT_ACCEPTED_TYPE[declaredKey] });
        byCanonical.set(canonical, rows);
    });
    const conflicts = [];
    byCanonical.forEach((declarations, canonicalSlotId) => {
        const distinct = new Set(declarations.map((row) => row.type));
        if (distinct.size > 1) {
            conflicts.push({
                canonicalSlotId,
                declarations,
                resolvedType: CANONICAL_SLOT_ACCEPTED_TYPE.get(canonicalSlotId),
            });
        }
    });
    return conflicts;
}

/**
 * How many leading bytes the caller must hand to detectUploadKind.
 *
 * 12 is the longest signature we test (RIFF....WEBP); 16 leaves room for one
 * more without every caller having to be re-read.
 */
const MAGIC_SNIFF_BYTES = 16;

/**
 * The floor, in bytes, under which a file cannot be a document anyone can read.
 *
 * Derived from what is actually in this system's own upload directory
 * (apps/backend/public/uploads, measured 2026-08-26), which contains both
 * populations:
 *
 *   - structurally valid but CONTENT-FREE files: 1x1 PNG pixels at 67-70 bytes
 *     (the F-G4-08 case), and one-page PDFs with an empty page at 240 bytes.
 *     Largest measured: 240.
 *   - real one-page Thai documents a reviewer can open and read: 14,029 bytes
 *     and up. Smallest measured: 14,029.
 *
 * 1,835 is the geometric mean of those two bounds (sqrt(240 x 14029) = 1834.9).
 * The geometric mean, not the arithmetic one, because the quantity that matters
 * is the RATIO of margin on each side: 1,835 sits 7.6x above the largest empty
 * file we have ever stored and 7.6x below the smallest real one, so both a
 * padded pixel and an unusually small genuine scan would have to move a long way
 * before this number is the thing that decides.
 *
 * What this number is NOT: proof that a file contains a document. Padding a
 * pixel to 2 KB defeats it, and nothing short of reading the content can catch
 * that. Its job is the accident and the throwaway placeholder, which is what was
 * actually reaching DTAM.
 */
const MIN_DOCUMENT_BYTES = 1835;

/** One upload must not be able to fill the disk. Matches the multer ceiling. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Machine-readable refusal reasons. The Thai sentence is what a farmer sees.
 *
 * The last four are raised by a FOURTH layer that this module deliberately does
 * not contain — see "the layer that is not here" below. They are declared here
 * anyway so there is one vocabulary of refusal codes for the whole platform:
 * a second list, kept server-side, is how two doors end up telling one person
 * two different things about one file.
 */
const UPLOAD_REJECTION = Object.freeze({
    EMPTY: 'FILE_EMPTY',
    TOO_SMALL: 'FILE_TOO_SMALL',
    TOO_LARGE: 'FILE_TOO_LARGE',
    UNREADABLE: 'FILE_TYPE_UNREADABLE',
    WRONG_TYPE: 'FILE_TYPE_MISMATCH',
    NOT_DECODABLE: 'IMAGE_NOT_DECODABLE',
    DIMENSIONS_TOO_SMALL: 'IMAGE_DIMENSIONS_TOO_SMALL',
    DIMENSIONS_TOO_LARGE: 'IMAGE_DIMENSIONS_TOO_LARGE',
    INSPECTION_UNAVAILABLE: 'IMAGE_INSPECTION_UNAVAILABLE',
});

/* ── The layer that is NOT here, and why ──────────────────────────────────────
 *
 * F-G4-08 fast-follow (adversarial review, 2026-08-26): layer 1 asks what the
 * leading bytes SAY the file is, and nothing after it asks whether that is true.
 * Five buffers of FFD8FFE0 followed by 4,000 random bytes each were accepted by
 * the onsite photo door as kind=jpeg, hashed to five distinct SHA-256s, and the
 * evidence gate answered MINT ALLOWED with photoCount=5. Not one of them is an
 * image: sharp().metadata() throws on all five. A four-byte hat was the whole
 * cost of satisfying the gate whose purpose is to prove an auditor stood on a
 * farm.
 *
 * The only check that catches that is DECODING the file, and a decoder cannot
 * live in this module. This is the one module both halves of the wire require,
 * and the browser half is bundled for a browser: sharp is a native libvips
 * binding with no browser build, so importing it here would break the wizard's
 * bundle rather than harden it. There is no pure-JS substitute worth having
 * either, because a hand-rolled JPEG parser is a new attack surface written to
 * defend against attack surface.
 *
 * So the split is by capability, not by preference. This module keeps the three
 * cheap layers that both sides can run and that give a farmer an instant answer.
 * The decode is layer 4 and lives on the server, in
 * apps/backend/services/upload-content-guard.js, applied by the door whose
 * output is COUNTED BY A MACHINE rather than read by a human. Its refusal codes
 * are the four above.
 */

/**
 * Signatures, checked at offset 0.
 *
 * PDF is anchored at 0 because ISO 32000-1 §7.5.2 says the header "shall be" the
 * first line of the file. Readers in the wild tolerate junk before it; we do not,
 * because a file that needs that tolerance is either broken or is deliberately
 * two formats at once.
 */
const SIGNATURES = Object.freeze([
    // '%PDF-'
    { kind: UPLOAD_KIND.PDF, offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
    // JPEG SOI + first marker
    { kind: UPLOAD_KIND.JPEG, offset: 0, bytes: [0xff, 0xd8, 0xff] },
    // PNG signature (ISO 15948 §5.2)
    { kind: UPLOAD_KIND.PNG, offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    // RIFF container ... 'WEBP' at offset 8 (the 4 bytes between are the length)
    { kind: UPLOAD_KIND.WEBP, offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
    { kind: UPLOAD_KIND.WEBP, offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
]);

/** Thai names for what a file turned out to be, for the refusal sentence. */
const KIND_LABEL_TH = Object.freeze({
    [UPLOAD_KIND.PDF]: 'ไฟล์ PDF',
    [UPLOAD_KIND.JPEG]: 'รูปภาพ JPEG',
    [UPLOAD_KIND.PNG]: 'รูปภาพ PNG',
    [UPLOAD_KIND.WEBP]: 'รูปภาพ WebP',
});

/** Thai names for what a slot will take, read straight after "รับเฉพาะ". */
const ACCEPTED_LABEL_TH = Object.freeze({
    PDF: 'ไฟล์ PDF',
    IMAGE: 'รูปภาพ JPEG, PNG หรือ WebP',
    BOTH: 'ไฟล์ PDF หรือรูปภาพ JPEG, PNG และ WebP',
    LINK: 'ลิงก์วิดีโอ',
});

function matchesAt(head, offset, bytes) {
    if (!head || head.length < offset + bytes.length) {
        return false;
    }
    for (let i = 0; i < bytes.length; i += 1) {
        if (head[offset + i] !== bytes[i]) {
            return false;
        }
    }
    return true;
}

/**
 * What the file actually is, decided from its leading bytes alone.
 *
 * @param {Uint8Array|Buffer|number[]} head first MAGIC_SNIFF_BYTES bytes of the file
 * @returns {'pdf'|'jpeg'|'png'|'webp'|null} null when no signature matches
 */
function detectUploadKind(head) {
    if (!head) {
        return null;
    }
    // WebP needs both of its rows to match, so count them rather than
    // returning on the first hit.
    let riffSeen = false;
    let webpSeen = false;
    for (const sig of SIGNATURES) {
        if (!matchesAt(head, sig.offset, sig.bytes)) {
            continue;
        }
        if (sig.kind !== UPLOAD_KIND.WEBP) {
            return sig.kind;
        }
        if (sig.offset === 0) {
            riffSeen = true;
        } else {
            webpSeen = true;
        }
    }
    return riffSeen && webpSeen ? UPLOAD_KIND.WEBP : null;
}

/**
 * The declared type of a slot, or DEFAULT_SLOT_TYPE when the slot is unknown.
 *
 * The lookup is by CANONICAL id, never by the string as it arrived. An exact-key
 * lookup made the rule depend on spelling: `LICENSE_PT11` was PDF-only and
 * `license_pt11` was an unknown slot, so the looser default answered, and a PNG
 * filled a ภท.11 slot with HTTP 200. See SLOT_ALIAS_GROUPS.
 *
 * @param {string} slotId any spelling of the slot
 * @returns {'PDF'|'IMAGE'|'BOTH'|'LINK'}
 */
function acceptedTypeForSlot(slotId) {
    const canonical = getCanonicalSlotId(slotId);
    const declared = CANONICAL_SLOT_ACCEPTED_TYPE.get(canonical);
    return declared === undefined ? DEFAULT_SLOT_TYPE : declared;
}

/**
 * The file kinds a slot accepts.
 *
 * @param {'PDF'|'IMAGE'|'BOTH'|'LINK'} slotType
 * @returns {ReadonlyArray<string>}
 */
function acceptedKindsForSlotType(slotType) {
    return ACCEPTED_KINDS_BY_SLOT_TYPE[slotType] || ACCEPTED_KINDS_BY_SLOT_TYPE[DEFAULT_SLOT_TYPE];
}

/** Sizes as a farmer would say them, so the message is checkable against the file's own properties. */
function formatSizeTh(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) {
        return `${n} ไบต์`;
    }
    if (n < 1024 * 1024) {
        return `${trimZero((n / 1024).toFixed(1))} KB`;
    }
    return `${trimZero((n / (1024 * 1024)).toFixed(1))} MB`;
}

function trimZero(value) {
    return String(value).replace(/\.0$/, '');
}

/**
 * How a refusal refers to the file.
 *
 * Quoting the farmer's own filename back is what makes a refusal checkable
 * against the thing they picked. Multer's byte-limit abort is the one case where
 * the name never reaches us, so there is a phrase for that too rather than an
 * empty pair of quotes.
 */
function describeSubject(fileName) {
    const name = String(fileName || '').trim();
    return name ? `ไฟล์ "${name}"` : 'ไฟล์ที่คุณเลือก';
}

/**
 * Layer 3's refusal, usable when the size is not known.
 *
 * Multer aborts an oversize upload mid-write and reports neither the original
 * filename nor how big the file actually was, so the route that catches that
 * abort needs a refusal that can be built without either.
 *
 * @param {string} [fileName]
 * @param {number} [size] omit when unknown
 * @returns {{ok: false, code: string, message: string}}
 */
function tooLargeRefusal(fileName, size) {
    const measured = Number(size) > 0 ? ` มีขนาด ${formatSizeTh(size)} ซึ่ง` : ' ';
    return {
        ok: false,
        code: UPLOAD_REJECTION.TOO_LARGE,
        message: `${describeSubject(fileName)}${measured}เกินขีดจำกัด ${formatSizeTh(MAX_UPLOAD_BYTES)} คุณสามารถบีบอัดไฟล์ หรือสแกนใหม่ที่ความละเอียดต่ำลง แล้วอัปโหลดอีกครั้ง`,
    };
}

/**
 * Decide whether one uploaded file may fill one slot.
 *
 * Order is deliberate. Empty and oversize come first because neither needs the
 * content read at all (an empty file has no signature to find, and a 30 MB file
 * is refused whatever it turns out to be). Then the real type, then the floor —
 * that pair in that order so a 70-byte PNG in a PDF slot is told it is the wrong
 * KIND rather than sent away to rescan a file that would still be refused.
 * A refusal always names the cause AND what the farmer can do next.
 *
 * @param {object} args
 * @param {string} args.fileName name as the farmer sees it, quoted back to them
 * @param {number} args.size size in bytes
 * @param {Uint8Array|Buffer|number[]} args.head first MAGIC_SNIFF_BYTES bytes
 * @param {'PDF'|'IMAGE'|'BOTH'|'LINK'} [args.slotType] declared type of the slot
 * @param {string} [args.slotId] used when slotType is not given
 * @returns {{ok: true, kind: string} | {ok: false, code: string, message: string}}
 */
function validateUploadedFile(args) {
    const opts = args || {};
    const fileName = String(opts.fileName || '');
    const subject = describeSubject(fileName);
    const size = Number(opts.size) || 0;
    const slotType = opts.slotType || acceptedTypeForSlot(opts.slotId);
    const acceptedLabel = ACCEPTED_LABEL_TH[slotType] || ACCEPTED_LABEL_TH[DEFAULT_SLOT_TYPE];

    if (size <= 0) {
        return {
            ok: false,
            code: UPLOAD_REJECTION.EMPTY,
            message: `${subject} ไม่มีข้อมูลอยู่เลย (0 ไบต์) คุณสามารถเปิดไฟล์ต้นฉบับตรวจสอบ แล้วอัปโหลดใหม่อีกครั้ง`,
        };
    }

    if (size > MAX_UPLOAD_BYTES) {
        return tooLargeRefusal(fileName, size);
    }

    const kind = detectUploadKind(opts.head);
    if (!kind) {
        return {
            ok: false,
            code: UPLOAD_REJECTION.UNREADABLE,
            message: `ระบบอ่านชนิดของ${subject} ไม่ได้ ไฟล์อาจเสียหายหรือไม่ใช่ไฟล์เอกสาร คุณสามารถเปิดไฟล์ตรวจสอบ แล้วบันทึกใหม่เป็น${acceptedLabel} ก่อนอัปโหลดอีกครั้ง`,
        };
    }

    if (!acceptedKindsForSlotType(slotType).includes(kind)) {
        return {
            ok: false,
            code: UPLOAD_REJECTION.WRONG_TYPE,
            message: `${subject} เป็น${KIND_LABEL_TH[kind]} แต่ช่องนี้รับเฉพาะ${acceptedLabel} คุณสามารถบันทึกเอกสารเป็น${acceptedLabel} แล้วอัปโหลดใหม่อีกครั้ง`,
        };
    }

    // Checked after the type, so the farmer is told the more useful of the two
    // problems first: a 70-byte PNG in a PDF slot is wrong in kind, and saying
    // "too small" would send them off to rescan the wrong thing.
    if (size < MIN_DOCUMENT_BYTES) {
        return {
            ok: false,
            code: UPLOAD_REJECTION.TOO_SMALL,
            message: `${subject} มีขนาด ${formatSizeTh(size)} เล็กเกินกว่าจะเป็นเอกสารที่เจ้าหน้าที่อ่านได้ (ต้องไม่น้อยกว่า ${formatSizeTh(MIN_DOCUMENT_BYTES)}) คุณสามารถสแกนหรือถ่ายภาพเอกสารให้เห็นข้อความชัดเจน แล้วอัปโหลดใหม่อีกครั้ง`,
        };
    }

    return { ok: true, kind };
}

module.exports = {
    UPLOAD_KIND,
    UPLOAD_REJECTION,
    ACCEPTED_KINDS_BY_SLOT_TYPE,
    SLOT_ACCEPTED_TYPE,
    DEFAULT_SLOT_TYPE,
    SLOT_ALIAS_GROUPS,
    CANONICAL_SLOT_ACCEPTED_TYPE,
    normalizeSlotId,
    getCanonicalSlotId,
    slotIdSpellings,
    conflictingSlotTypeDeclarations,
    MAGIC_SNIFF_BYTES,
    MIN_DOCUMENT_BYTES,
    MAX_UPLOAD_BYTES,
    ACCEPTED_LABEL_TH,
    KIND_LABEL_TH,
    detectUploadKind,
    acceptedTypeForSlot,
    acceptedKindsForSlotType,
    validateUploadedFile,
    tooLargeRefusal,
    // Exported so a door that carries its own thresholds (the onsite photo door
    // has a different floor and a lower ceiling than a document slot) speaks a
    // size and names a file the SAME way this module does. A second copy of
    // either helper would let two doors describe one file differently to the
    // same person.
    formatSizeTh,
    describeSubject,
};
