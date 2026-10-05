'use strict';

/**
 * F-G4-08 fast-follow — the slot table must not be bypassable by spelling.
 *
 * Measured on the real router with the real uploader before this fix: a 60 KB
 * PNG posted with slotId=licence_pt11 was stored with HTTP 200 and satisfied the
 * LICENCE_PT11 requirement. acceptedTypeForSlot looked the id up by EXACT key
 * after a .trim(), so seven alias spellings of PDF-only slots missed the table
 * and got DEFAULT_SLOT_TYPE ('BOTH'), which accepts images. Seven spellings,
 * seven accepted.
 *
 * The three things this file holds down:
 *   1. every alias spelling resolves to the same slot, and refuses the PNG;
 *   2. the backend's canonicaliser and the shared one are the SAME function, not
 *      two that agree today;
 *   3. a slot whose spellings declare two different types is a known, listed
 *      contradiction — a new one fails here instead of being resolved in silence.
 */

const {
    MAGIC_SNIFF_BYTES,
    SLOT_ALIAS_GROUPS,
    acceptedTypeForSlot,
    validateUploadedFile,
    getCanonicalSlotId,
    conflictingSlotTypeDeclarations,
} = require('@gacp/validation/upload-rules');
const slotUtils = require('../../routes/api/applications/validation-slot-utils');

/** A PNG big enough to clear the size floor, so only the TYPE rule can refuse it. */
function realisticPng(bytes = 60 * 1024) {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return Buffer.concat([signature, Buffer.alloc(Math.max(0, bytes - signature.length), 0x22)]);
}

function postPng(slotId) {
    const png = realisticPng();
    return validateUploadedFile({
        fileName: 'pixel.png',
        size: png.length,
        head: png.subarray(0, MAGIC_SNIFF_BYTES),
        slotType: acceptedTypeForSlot(slotId),
    });
}

/**
 * The seven spellings the adversarial pass got a PNG through, each paired with
 * the spelling the table happened to be written in.
 */
const ALIAS_SPELLINGS = [
    { alias: 'licence_pt11', canonicalSpelling: 'LICENCE_PT11' },
    { alias: 'LICENSE_BT11', canonicalSpelling: 'CONTROLLED_HERB_LICENSE' },
    { alias: 'land_title', canonicalSpelling: 'LAND_TITLE' },
    { alias: 'LAND_DEED', canonicalSpelling: 'LAND_TITLE' },
    { alias: 'site_map', canonicalSpelling: 'SITE_MAP' },
    { alias: 'licence_pt09', canonicalSpelling: 'LICENCE_PT09' },
    { alias: 'licence_pt10', canonicalSpelling: 'LICENCE_PT10' },
];

describe('the seven spellings that bypassed the slot table', () => {
    test.each(ALIAS_SPELLINGS)(
        '$alias is the same slot as $canonicalSpelling',
        ({ alias, canonicalSpelling }) => {
            expect(getCanonicalSlotId(alias)).toBe(getCanonicalSlotId(canonicalSpelling));
        },
    );

    test.each(ALIAS_SPELLINGS)(
        '$alias accepts exactly what $canonicalSpelling accepts, and that is PDF',
        ({ alias, canonicalSpelling }) => {
            expect(acceptedTypeForSlot(alias)).toBe(acceptedTypeForSlot(canonicalSpelling));
            expect(acceptedTypeForSlot(alias)).toBe('PDF');
        },
    );

    test.each(ALIAS_SPELLINGS)('$alias REFUSES a 60 KB PNG', ({ alias }) => {
        const verdict = postPng(alias);
        expect(verdict.ok).toBe(false);
        expect(verdict.code).toBe('FILE_TYPE_MISMATCH');
        // The refusal names the cause and what the farmer can do next.
        expect(verdict.message).toContain('PDF');
        expect(verdict.message).toContain('pixel.png');
    });

    test('separators and case carry no meaning in a slot id', () => {
        ['LICENCE-PT11', 'licence.pt11', '  LICENCE_PT11  ', 'Licence_Pt11'].forEach((spelling) => {
            expect(acceptedTypeForSlot(spelling)).toBe('PDF');
            expect(postPng(spelling).ok).toBe(false);
        });
    });

    test('an image slot still takes an image — the fix is not "refuse everything"', () => {
        expect(acceptedTypeForSlot('exterior_photos')).toBe('BOTH');
        expect(postPng('EXTERIOR_PHOTOS').ok).toBe(true);
        expect(postPng('photos_exterior').ok).toBe(true);
    });

    test('a slot nobody declared still falls back to the default, not to a refusal', () => {
        expect(acceptedTypeForSlot('planting_activity_photo_2569')).toBe('BOTH');
        expect(postPng('planting_activity_photo_2569').ok).toBe(true);
    });
});

describe('one canonicaliser, not two that agree today', () => {
    test('the backend re-exports the shared function itself', () => {
        expect(slotUtils.getCanonicalSlotId).toBe(getCanonicalSlotId);
    });

    test('the fold every other slot consumer uses is the fold the guard uses', () => {
        // buildUploadedSlotSet / hasUploadedSlot are what the mandatory-document
        // check runs. If they ever key slots differently from the upload guard,
        // a document can satisfy a requirement the guard never judged.
        const uploaded = slotUtils.buildUploadedSlotSet([{ slotId: 'licence_pt11' }]);
        expect(slotUtils.hasUploadedSlot(uploaded, 'LICENCE_PT11')).toBe(true);
        // ภ.ท. 11 licence (what the PROCESSING purpose demands) and the v1 บท.11 row are two
        // papers: one upload must not satisfy the other (operator ruling 2026-10-05).
        expect(uploaded.has(getCanonicalSlotId('LICENSE_BT11'))).toBe(false);
    });

    test('the three purpose licences are three slots, and the retired PT9 / PT09 spellings reach none of them', () => {
        const slots = ['licence_pt09', 'licence_pt10', 'licence_pt11'].map(getCanonicalSlotId);
        expect(new Set(slots).size).toBe(3);
        ['LICENSE_PT9', 'license_pt09', 'LICENSE_PT10', 'M1_PT09', 'M1_PT10', 'M1_PT11'].forEach((retired) => {
            expect(slots).not.toContain(getCanonicalSlotId(retired));
        });
    });
});

describe('a slot cannot hold two rules', () => {
    /**
     * criminal_bg is the one left: step 1's `criminal-bg` (BOTH, rendered by
     * InlineDocumentUpload with accept=".pdf,image/*") and step 8's `CRIMINAL_BG`
     * (PDF) are the same document to every other consumer, so the alias fold
     * brings them onto one slot. It resolves to the tighter rule, PDF: relaxing a
     * slot some part of the product has already declared PDF-only, by accident,
     * is how F-G4-08 happened.
     *
     * Five more appeared for one day with the กทล.1 v2 fold (spec 2026-09-01) and
     * were settled rather than resolved, because "resolve to the stricter one" is
     * the safe answer to an ACCIDENT and the wrong answer to a QUESTION. The
     * question those five asked is in the block below.
     */
    const KNOWN_CONTRADICTIONS = [
        'criminal_bg',
    ];

    test('the known contradictions are exactly the listed ones', () => {
        const conflicts = conflictingSlotTypeDeclarations();
        expect(conflicts.map((row) => row.canonicalSlotId).sort()).toEqual(KNOWN_CONTRADICTIONS);
    });

    test('the contradiction resolves to the STRICTER declaration', () => {
        const criminalBg = conflictingSlotTypeDeclarations()
            .find((row) => row.canonicalSlotId === 'criminal_bg');
        expect(criminalBg.declarations.map((row) => row.type).sort()).toEqual(['BOTH', 'PDF']);
        expect(criminalBg.resolvedType).toBe('PDF');
        expect(acceptedTypeForSlot('criminal-bg')).toBe('PDF');
        expect(acceptedTypeForSlot('CRIMINAL_BG')).toBe('PDF');
        expect(postPng('criminal-bg').ok).toBe(false);
    });

    test('every contradiction resolves the same way, and the PNG is refused at each', () => {
        conflictingSlotTypeDeclarations().forEach((row) => {
            expect(row.declarations.map((one) => one.type)).toContain('PDF');
            expect(row.resolvedType).toBe('PDF');
            expect(acceptedTypeForSlot(row.canonicalSlotId)).toBe('PDF');
            expect(postPng(row.canonicalSlotId).ok).toBe(false);
        });
    });
});

describe('the fold takes nothing away and grants nothing (กทล.1 v2)', () => {
    /**
     * Folding two controls onto one slot forces one answer to "what does this
     * accept". Four of the v2 slots join a step-8 row declared PDF to a step-1
     * control that has always rendered with accept=".pdf,image/*", so the pair has
     * to agree — and agreeing on PDF would REMOVE a camera-roll upload the product
     * accepts today, from a farmer with a phone and no scanner, mid-application.
     *
     * So the rule for the whole v2 block is: a canonical slot declares the LOOSEST
     * type any control that folds into it already offers. Nothing is taken away,
     * and nothing is granted either — BUILDING_PLAN_PHOTOS stays PDF although its
     * own กทล.1 name says พร้อมภาพถ่าย, and LAND_RIGHTS stays PDF although a farmer
     * photographs a โฉนด as readily as anything else. Widening those is a real
     * decision about what a สำเนา may be, and it belongs to the task that writes
     * the picker and its label (T7/T9).
     *
     * This is not the F-G4-08 hole re-opened: that hole was a slot accepting a file
     * its own label refused, decided by nobody. Here the label and the rule move
     * together in the one table both halves of the wire read, and every layer that
     * fix built still runs (magic bytes, the 1,835-byte floor, the server-side
     * decode in upload-content-guard).
     */
    const WIDENED_TO_MATCH_A_STEP1_CONTROL = [
        ['community_reg_members', 'community-reg'],
        ['community_assignment', 'community-meeting'],
        ['juristic_reg_6m', 'company-reg'],
        ['juristic_authority', 'power-attorney'],
    ];

    test.each(WIDENED_TO_MATCH_A_STEP1_CONTROL)(
        '%s keeps the photograph %s already accepted',
        (canonicalSlotId, stepOneControl) => {
            expect(getCanonicalSlotId(stepOneControl)).toBe(canonicalSlotId);
            expect(acceptedTypeForSlot(canonicalSlotId)).toBe('BOTH');
            expect(postPng(canonicalSlotId).ok).toBe(true);
        },
    );

    test.each([
        ['building_plan_photos', 'BUILDING_PLAN'],
        ['land_rights', 'LAND_TITLE'],
        ['landlord_consent', 'LAND_CONSENT'],
        ['site_map_coords', 'SITE_MAP'],
        ['production_util_plan', 'PRODUCTION_PLAN'],
        ['security_residue_plan', 'SECURITY_PLAN'],
        ['sop_manual', 'SOP_MANUAL'],
    ])('%s stays PDF: no control of it offers a photograph today', (canonicalSlotId, folded) => {
        expect(getCanonicalSlotId(folded)).toBe(canonicalSlotId);
        expect(acceptedTypeForSlot(canonicalSlotId)).toBe('PDF');
        expect(postPng(folded).ok).toBe(false);
    });

    test.each([
        ['BUILDING_PLAN', 'building_plan_photos'],
        ['COM_SVC01', 'community_reg_members'],
        ['community-reg', 'community_reg_members'],
        ['COM_MEETING_DOC', 'community_assignment'],
        ['community-meeting', 'community_assignment'],
        ['JUR_COMPANY_REG', 'juristic_reg_6m'],
        ['company-reg', 'juristic_reg_6m'],
        ['JUR_POA', 'juristic_authority'],
        ['power-attorney', 'juristic_authority'],
    ])('%s answers the same as %s, so the label cannot disagree with the rule', (spelling, canonicalSlotId) => {
        expect(getCanonicalSlotId(spelling)).toBe(canonicalSlotId);
        expect(acceptedTypeForSlot(spelling)).toBe(acceptedTypeForSlot(canonicalSlotId));
    });

    test('the ภท. licence slot is untouched — it is issued as a PDF and stays PDF', () => {
        expect(acceptedTypeForSlot('controlled_herb_license')).toBe('PDF');
        expect(postPng('LICENCE_PT11').ok).toBe(false);
    });
});

describe('every old id of a กทล.1 paper keeps counting (spec §2.1, §7)', () => {
    /**
     * "id เก่าทุกตัว → canonical ใหม่ ⇒ เอกสารที่ผู้ใช้เดิมอัปไว้แล้วนับต่อได้ทันที
     * ไม่มี migration ข้อมูล". Two ways that promise breaks, and both are here:
     *
     *   1. an old id nobody folded — the farmer is asked again for a paper the
     *      platform is already holding;
     *   2. an old id folded while its SIBLING SPELLING was left behind, which is
     *      worse: application-document-sync writes documentType as the UPPER-CASED
     *      canonical id, so what is actually IN application_documents is
     *      'PHOTOS_EXTERIOR', never the raw 'EXTERIOR_PHOTOS'. Fold the spelling
     *      the store does not use and the fold is dead for every row ever synced.
     */
    test.each([
        ['photos_exterior', 'site_photos'],
        ['PHOTOS_EXTERIOR', 'site_photos'],
        ['photos_site', 'site_photos'],
        ['PHOTOS_SITE', 'site_photos'],
        ['EXTERIOR_PHOTOS', 'site_photos'],
        ['facility_map', 'building_plan_photos'],
        ['FACILITY_MAP', 'building_plan_photos'],
        ['community_cert', 'community_reg_members'],
        ['COMMUNITY_CERT', 'community_reg_members'],
        ['previous_cert', 'prev_cert_original'],
        ['PREVIOUS_CERT', 'prev_cert_original'],
        ['renewal_report', 'operation_summary_report'],
        ['RENEWAL_REPORT', 'operation_summary_report'],
        ['sop_cultivation', 'sop_manual'],
        ['SOP_CULTIVATION', 'sop_manual'],
        ['sop_harvest', 'sop_manual'],
        ['sop_storage', 'sop_manual'],
        ['sop_pest', 'sop_manual'],
        // SOP_MANUAL's own description ends 'จนถึงเก็บรักษาและแปรรูป', so the
        // processing SOP is inside the one คู่มือ กทล.1 asks for; leaving it out
        // told an applicant whose SOP is filed as sop_processing that the SOP was
        // missing, while one who uploaded sop_pest was not asked again.
        ['sop_processing', 'sop_manual'],
        ['SOP_PROCESSING', 'sop_manual'],
        // JURISTIC_REG_6M's own description says
        // 'ใช้ได้ทั้งบริษัท ห้างหุ้นส่วน วิสาหกิจเพื่อสังคม หรือสหกรณ์การเกษตร' and its
        // sourceHint names สำนักงานสหกรณ์จังหวัด, so a สหกรณ์การเกษตร that already
        // filed its หนังสือสำคัญ must not be asked for it a second time.
        ['coop_cert', 'juristic_reg_6m'],
        ['COOP_CERT', 'juristic_reg_6m'],
        // SITE_PHOTOS asks for 'แปลงปลูก จุดเก็บเกี่ยว และที่พักผลผลิต' — the place
        // the produce is kept IS part of A7, so the old คลังเก็บ photo counts.
        // Nothing renders photos_storage as its own control, so no paper is lost.
        ['photos_storage', 'site_photos'],
        ['PHOTOS_STORAGE', 'site_photos'],
    ])('%s counts as %s', (legacy, canonicalSlotId) => {
        expect(getCanonicalSlotId(legacy)).toBe(canonicalSlotId);
    });

    test('no spelling of one slot is left behind answering something else', () => {
        // The fold is only worth having if it is total: for every group, every
        // member answers the group's canon, and the canon answers itself.
        const split = [];
        SLOT_ALIAS_GROUPS.forEach((group) => {
            const canonical = getCanonicalSlotId(group[0]);
            group.forEach((spelling) => {
                if (getCanonicalSlotId(spelling) !== canonical) {
                    split.push(`${spelling} answers ${getCanonicalSlotId(spelling)}, not ${canonical}`);
                }
            });
        });
        expect(split).toEqual([]);
    });

    test('a canonical id is a fixed point of the fold', () => {
        const canons = new Set(SLOT_ALIAS_GROUPS.map((group) => getCanonicalSlotId(group[0])));
        canons.forEach((canonical) => {
            expect(getCanonicalSlotId(canonical)).toBe(canonical);
        });
    });
});

describe('a fold must not swallow a paper the farmer can still attach separately', () => {
    /**
     * The กทล.1 v2 slots merge SEVERAL PAPERS into one attachment on purpose
     * (ID_HOUSE_REG is "บัตร + ทะเบียนบ้าน", spec §2.1). That is right for the form
     * and right for the v2 wizard, where one card per slot is written (T6/T7).
     *
     * It is destructive on the wizard that ships TODAY, which still renders one
     * upload control per old id, several of them on screen at once:
     * routes/api/applications/applications.js:1412-1415 drops every draftDocuments
     * entry whose CANONICAL slot matches the new upload, and
     * services/application-document-sync.js:144-147 releases every
     * application_documents row carrying any spelling of that slot. So if two
     * controls asking for DIFFERENT papers fold onto one canon, the second upload
     * deletes the first, the screen keeps both rows green, and the officer sees
     * one file.
     *
     * The rule this holds down: a fold may join two spellings of the SAME paper
     * (that is a rename, and replacing a paper with itself loses nothing), but it
     * may not join two papers that a farmer can attach at the same time until one
     * control holds them both.
     */

    /** Every upload control the wizard renders, by the surface that renders it. */
    const STEP8_COMMON = [ // documents-step-config.tsx:178-434
        'LICENCE_PT11', 'LICENCE_PT09', 'LICENCE_PT10', 'CRIMINAL_BG', 'REG_FORM',
        'LAND_TITLE', 'LAND_CONSENT', 'SITE_MAP', 'BUILDING_PLAN', 'EXTERIOR_PHOTOS',
        'PRODUCTION_PLAN', 'SECURITY_PLAN', 'INTERIOR_PHOTOS', 'SOP_MANUAL',
        'CP_CCP_TABLE', 'INPUT_REPORT', 'EQUIPMENT_CALIBRATION', 'GACP_CERTIFICATE',
        'STRAIN_CERTIFICATE', 'PROVIDER_TRAINING', 'PROVIDER_TEST', 'SOIL_TEST',
        'NUTRIENT_SPEC', 'WATER_TEST', 'FLOWER_TEST', 'LAB_CERTIFICATE',
        'DESTINATION_CERT', 'VIDEO_LINK', 'ADDITIONAL_DOCS',
    ];
    /**
     * The four land-document controls of the farm step, rendered together for
     * EVERY applicant type: options.ts:50-55 lists them and
     * farm-info-plots-land-sections.tsx:167 maps each into its own card with its
     * own `<input type="file">` (:241-249), which farm-info-step.tsx:177-186
     * posts as `slotId = doc.id`. The screen's own instruction is
     * "เลือกเอกสารที่มีและอัปโหลดไฟล์ (อย่างน้อย 1 ชนิด)", so a farmer with two plots
     * attaches two of them in one sitting. They were missing from this fence, and
     * the fence went green over exactly the case it exists to catch (review r2).
     */
    const FARM_INFO_LAND = ['CHANOTE', 'NS3', 'SPK', 'OTHER'];
    /** step 1 (general-step-applicant-sections.tsx) + step 8, per applicant type. */
    const CONTROLS_ON_SCREEN_TOGETHER = {
        INDIVIDUAL: [
            'id-card', 'house-reg', 'criminal-bg', // :100, :109, :118
            'IND_ID_CARD', 'IND_HOUSE_REG', // documents-step-config.tsx:137,138
        ],
        COMMUNITY_ENTERPRISE: [
            'community-reg', 'community-meeting', 'president-id', // :258, :267, :276
            'COM_SVC01', 'COM_TVC03', 'COM_MEMBER_LIST', 'COM_PRESIDENT_ID',
            'COM_MEETING_DOC', 'COM_HOUSE_CODE', // documents-step-config.tsx:142-147
        ],
        JURISTIC: [
            'company-reg', 'director-list', 'director-id', 'power-attorney', // :446-473
            'JUR_COMPANY_REG', 'JUR_DIRECTOR_LIST', 'JUR_DIRECTOR_ID', 'JUR_POA',
            'JUR_TAX_REG', 'JUR_COMPANY_CERT', // documents-step-config.tsx:151-156
        ],
    };

    /**
     * The controls that ask for ONE paper twice — the wizard grew a step-1 copy
     * and a step-8 copy of the same request. Folding these together is a rename,
     * and the second upload replaces the paper with itself.
     */
    const ONE_PAPER_TWO_CONTROLS = [
        ['id-card', 'IND_ID_CARD'], // สำเนาบัตรประชาชนผู้ยื่น
        ['house-reg', 'IND_HOUSE_REG'], // สำเนาทะเบียนบ้านผู้ยื่น
        ['criminal-bg', 'CRIMINAL_BG'], // หนังสือรับรองความประพฤติ
        ['community-reg', 'COM_SVC01'], // หนังสือสำคัญแสดงการจดทะเบียนวิสาหกิจชุมชน (สวช.01)
        ['community-meeting', 'COM_MEETING_DOC'], // รายงานการประชุม
        ['president-id', 'COM_PRESIDENT_ID'], // สำเนาบัตรประชาชนประธาน
        ['company-reg', 'JUR_COMPANY_REG'], // หนังสือรับรองนิติบุคคล
        ['director-list', 'JUR_DIRECTOR_LIST'], // บัญชีรายชื่อกรรมการ
        ['director-id', 'JUR_DIRECTOR_ID'], // สำเนาบัตรประชาชนกรรมการ
        ['power-attorney', 'JUR_POA'], // หนังสือมอบอำนาจ
    ];

    /** The paper a control asks for: its twin's name when it has one, else itself. */
    function paperOf(slotId) {
        const pair = ONE_PAPER_TWO_CONTROLS.find((papers) => papers.includes(slotId));
        return pair ? pair[0] : slotId;
    }

    test.each(Object.keys(CONTROLS_ON_SCREEN_TOGETHER))(
        'no two %s controls of DIFFERENT papers fold onto one slot',
        (applicantType) => {
            const onScreen = [
                ...CONTROLS_ON_SCREEN_TOGETHER[applicantType],
                ...STEP8_COMMON,
                ...FARM_INFO_LAND,
            ];
            const papersBySlot = new Map();
            onScreen.forEach((slotId) => {
                const canonical = getCanonicalSlotId(slotId);
                const papers = papersBySlot.get(canonical) || new Set();
                papers.add(paperOf(slotId));
                papersBySlot.set(canonical, papers);
            });

            const swallowed = [];
            papersBySlot.forEach((papers, canonical) => {
                if (papers.size > 1) {
                    swallowed.push(`${canonical} <- ${[...papers].sort().join(' + ')}`);
                }
            });
            expect(swallowed).toEqual([]);
        },
    );
});

describe('a satisfaction family counts papers together without folding them', () => {
    /**
     * กทล.1 asks for the land right ONCE (ส่วนที่ ๓ A1), and four different papers
     * can answer it: โฉนด, น.ส.3, ส.ป.ก. and the "อื่น ๆ" line. The first fold of
     * this task made them one canonical slot, which counted them correctly and
     * DELETED them in pairs: the four controls are on screen at the same time
     * (farm-info-plots-land-sections.tsx:241-249), so the ส.ป.ก. upload released the
     * โฉนด row while both chips stayed green (review r2 blocker).
     *
     * A family is the other half of the answer: "any of these satisfies the slot",
     * read by the requirements engine (T4) and by nothing on the upload path. The
     * fold stays a fold — one spelling of one paper — so no upload can replace a
     * paper that is not itself.
     */
    const {
        SATISFACTION_FAMILIES,
        slotsSatisfying,
        isSlotSatisfied,
        buildSatisfactionFamilies,
    } = require('@gacp/validation/satisfaction-families');

    test('a family is not a fold: declaring two spellings of ONE paper is refused', () => {
        // The property the T6/T7 carry-over relies on. Asserting it against the built table
        // proves nothing — the builder canonicalises and de-duplicates, so by then every
        // member is distinct by construction and two declared spellings have silently
        // vanished (review r3, finding 5). So assert against the DECLARATION.
        expect(() => buildSatisfactionFamilies({
            land_rights: ['land_rights', 'CHANOTE', 'LAND_TITLE'],
        })).toThrow(/land_title/i);

        // ...and the real table is built by that same guard.
        expect(Object.keys(SATISFACTION_FAMILIES)).toEqual(['land_rights']);
    });

    test('any of the land papers satisfies the one land-rights slot', () => {
        expect(slotsSatisfying('LAND_RIGHTS')).toEqual(
            expect.arrayContaining(['land_rights', 'chanote', 'ns3', 'spk', 'other_land']),
        );
        // A legacy spelling of the slot itself asks the same question.
        expect(slotsSatisfying('LAND_TITLE')).toEqual(slotsSatisfying('land_rights'));
    });

    test('the predicate T4 is bound to call folds the uploaded ids before comparing', () => {
        // 14 rows in the demo database carry documentType CHANOTE; if this predicate ever
        // stopped folding what it is given, every one of those farmers would be asked for a
        // land document the server is already holding.
        expect(isSlotSatisfied('land_rights', ['NS3'])).toBe(true);
        expect(isSlotSatisfied('LAND_RIGHTS', ['chanote'])).toBe(true);
        expect(isSlotSatisfied('land_rights', ['OTHER'])).toBe(true);
        expect(isSlotSatisfied('land_rights', ['criminal_bg'])).toBe(false);
        expect(isSlotSatisfied('land_rights', [])).toBe(false);
    });

    test('a slot with no family answers only to itself', () => {
        expect(slotsSatisfying('SOP_MANUAL')).toEqual(['sop_manual']);
        expect(slotsSatisfying('controlled_herb_license')).toEqual(['controlled_herb_license']);
    });
});
