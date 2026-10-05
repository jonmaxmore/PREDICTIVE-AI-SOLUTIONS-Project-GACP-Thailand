'use strict';

// Domain: Requirement Engine — THE ONE LENS.
// Spec: design note 2026-09-01-application-submission-v2-design §2.1
// Plan: design note 2026-09-01-application-submission-v2 (Task 4)
//
// Before this module, four surfaces each decided for themselves which documents a
// กทล.1 filing must carry: the wizard's checklist in the browser, the review page's
// own copy of it, the submit gate's rule query, and the officer's eyes. They
// disagreed, and every disagreement was a farmer told something different by two
// screens of one system.
//
// So there is one answer, computed here, and every surface reads it: the review
// page (T11), the door GET /applications/:id/requirements (T4), the officer's
// checklist (T12) and the submit gate (application-document-requirements.js).
//
// WHAT DECIDES "REQUIRED": dated rows in `requirement_rules`, read through
// requirement-rule-service.rulesAt with all six dimensions. Two conditions the rule
// table cannot express are applied on top, and both are named in the payload so a
// reader can see WHY a slot is being asked for:
//   - each selected purpose requires the issued licence the LAW of that plant demands:
//     cannabis RESEARCH → licence_pt09, EXPORT → licence_pt10, PROCESSING → licence_pt11;
//     kratom EXPORT → kratom_export_licence; nothing for the rest (spec §2.1 + operator
//     ruling 2026-10-05 — the purpose is not a rule dimension);
//   - a REPLACEMENT filing needs the police report OR the damaged certificate, not
//     both, which no single row can say.
//
// WHAT DECIDES "SATISFIED": what the SERVER holds — `formData.draftDocuments[]`
// (written by the upload route) and `application_documents` rows — folded through
// getCanonicalSlotId, then read through the satisfaction families
// (@gacp/validation/satisfaction-families) so the four land papers a farmer can
// still attach separately count as the one land right กทล.1 asks for. The client's
// own `formData.documents` checklist is not evidence and is never read here.

const { prisma } = require('./prisma-database');
const logger = require('../shared/logger');
const { DOCUMENT_SLOTS } = require('../constants/document-slots');
const {
    buildUploadedSlotSet,
    getCanonicalSlotId,
} = require('../routes/api/applications/validation-slot-utils');
const { isSlotSatisfied } = require('@gacp/validation/satisfaction-families');
const { rulesAt, plantCodesWithRulesAt, RULE_DIMENSIONS } = require('./requirement-rule-service');
const { asPlantSlug } = require('../config/plant-species-slugs');
const {
    CERTIFICATION_PURPOSES, PURPOSE_CODES, assessPurposes, refusalMessageTh, purposeLicenceSlotId,
} = require('../shared/certification-purposes');

/**
 * The plants this platform can name at all.
 *
 * Not a list kept here: `asPlantSlug` is the ONE bridge between the wizard's slugs and
 * the plant_species master codes (config/plant-species-slugs.js), and it owns the
 * normalisation too, so a plant the wizard can offer is a plant this lens recognises and
 * there is no second spelling rule to drift from.
 *
 * Recognising a plant is NOT the same as being able to judge it. กทล.1 law is filed per
 * plant, and asking the register about a plant it holds no rules for returned the two
 * plant-agnostic rows — company_reg and community_cert, both holder-specific — so an
 * individual's filing was asked for NOTHING and passed the submit gate. The register
 * itself now answers which plants have law (plantCodesWithRulesAt), and a filing the law
 * cannot reach is refused rather than judged leniently.
 */
/** Why a filing cannot be judged at all. They refuse; they are not the same mistake. */
const BLOCKING_PLANT_NOT_DECLARED = 'PLANT_NOT_DECLARED';
const BLOCKING_PLANT_LAW_NOT_FILED = 'PLANT_LAW_NOT_FILED';
const BLOCKING_AREA_TYPE_UNREADABLE = 'AREA_TYPE_UNREADABLE';
const BLOCKING_APPLICANT_TYPE_NOT_THE_HOLDER = 'APPLICANT_TYPE_NOT_THE_HOLDER';
const BLOCKING_PURPOSE_INVALID = 'CERTIFICATION_PURPOSE_INVALID';

/** คำที่ผู้ยื่นอ่านเข้าใจ สำหรับแต่ละชนิดผู้ถือ */
const HOLDER_WORDS_TH = Object.freeze({
    JURISTIC: 'นิติบุคคล',
    COMMUNITY_ENTERPRISE: 'วิสาหกิจชุมชน',
});

/**
 * คำขอประกาศว่าผู้ยื่นเป็นนิติบุคคลหรือวิสาหกิจชุมชน แต่ตัวตนที่ระบบจะออกใบให้ไม่ใช่แบบนั้น
 *
 * มติ operator 2026-09-07: "บริษัท และวิสาหกิจชุมชน ผู้ถือจะต้องเป็นบริษัท หรือวิสาหกิจชุมชน
 * ห้ามเป็นบุคคล" · ใบรับรองบอกว่าใครเป็นผู้ถือ การออกให้คนทั้งที่ผู้ขอคือบริษัท คือข้อมูลผิด
 * บนทะเบียนของรัฐ และกระทบการโอน การเพิกถอน และความรับผิด (F-HOLDER-01)
 *
 * บอกตั้งแต่ประตูยื่น ตอนที่ยังแก้ได้โดยไม่เสียอะไร — ไม่ใช่ตอนออกใบ หลังจ่ายครบสองงวดแล้ว
 * (ตัวออกใบรับรองก็ปฏิเสธเหมือนกัน เป็นชั้นสุดท้าย: certificate-service.resolveHolderForIssuance)
 *
 * เงียบไม่ใช่คำอนุญาต: ไม่มีตัวตนเลยก็ปฏิเสธ เพราะระบบไม่สร้างตัวตนทางกฎหมายให้ใครเอง
 *
 * @param {object} formData        formData ของคำขอ
 * @param {string|null} holderType ชนิดของ Entity ที่คำขอผูกอยู่ (อ่านจากแถว ไม่ใช่จาก formData)
 * @returns {{code: string, messageTH: string, detail: object}|null}
 */
function holderMismatchIssue(formData, holderType) {
    const declared = mappedTo(isPlainObject(formData) ? formData.applicantType : null, HOLDER_TYPE_ALIASES);
    const word = HOLDER_WORDS_TH[declared];
    if (!word) { return null; }
    if (String(holderType || '').trim().toUpperCase() === declared) { return null; }
    return {
        code: BLOCKING_APPLICANT_TYPE_NOT_THE_HOLDER,
        messageTH: `คำขอนี้ระบุผู้ยื่นเป็น${word} แต่กำลังยื่นในนามบุคคล `
            + `ผู้ถือใบรับรองต้องเป็น${word}เอง `
            + `กรุณาสร้างหรือสลับไปพื้นที่ทำงาน${word} แล้วยื่นคำขอในพื้นที่นั้น`,
        detail: { declaredApplicantType: declared, holderType: holderType || null },
    };
}

/**
 * Closed vocabularies. rulesAt REFUSES a case-dimension word it does not know
 * (INVALID_RULE_DIMENSION, 422) — correctly, because a typo that widened a query
 * would silently drop a legal requirement. That makes this derivation layer the
 * safety boundary: an unknown or legacy value from a draft becomes null (= the
 * wildcard the rule table already means by NULL), never a guess and never raw.
 */
const HOLDER_TYPES = Object.freeze(['INDIVIDUAL', 'JURISTIC', 'COMMUNITY_ENTERPRISE']);

/** The wizard still says COMMUNITY where the rule table says COMMUNITY_ENTERPRISE. */
const HOLDER_TYPE_ALIASES = Object.freeze({
    INDIVIDUAL: 'INDIVIDUAL',
    JURISTIC: 'JURISTIC',
    COMMUNITY: 'COMMUNITY_ENTERPRISE',
    COMMUNITY_ENTERPRISE: 'COMMUNITY_ENTERPRISE',
});
const REQUEST_TYPES = Object.freeze(['NEW', 'RENEWAL', 'REPLACEMENT']);
const CERT_SCOPES = Object.freeze(['PLANTING', 'PROCESSING']);

/** How a draft spells land tenure → the vocabulary the rule table speaks. */
const LAND_TENURE_BY_INPUT = Object.freeze({
    OWNED: 'OWNED',
    OWN: 'OWNED',
    'เจ้าของ': 'OWNED',
    STATE: 'STATE_PERMITTED',
    STATE_PERMITTED: 'STATE_PERMITTED',
    // The wizard's third option is 'ได้รับอนุญาต (ต้องมีหนังสือยินยอม)' — permission
    // from the owner of land that is not yours (options.ts:46). กทล.1's vocabulary
    // has no separate word for it, and the seeded law files the หนังสือยินยอม under
    // RENTED, so that is where it goes: the paper the ministry wants is the same
    // paper, and the shipping wizard already demands LAND_CONSENT for both RENT and
    // CONSENT (documents-step-config.tsx:239). Mapping it to STATE_PERMITTED instead
    // — land of the state — matched no rule at all and quietly stopped asking for the
    // letter. OPEN QUESTION for DTAM (recorded in the T3 brief): whether ส.ป.ก./state
    // land needs its own consent row.
    CONSENT: 'RENTED',
    RENT: 'RENTED',
    RENTED: 'RENTED',
    'เช่า': 'RENTED',
});

/** How a draft spells the growing method → areaType. */
const AREA_TYPE_BY_INPUT = Object.freeze({
    OUTDOOR: 'OUTDOOR',
    INDOOR: 'INDOOR',
    INDOOR_CONTROLLED: 'INDOOR',
    GREENHOUSE: 'GREENHOUSE',
    OTHER: 'OTHER',
});

/**
 * Every ลักษณะพื้นที่ the filing ticks, because the papers hang off the ticks.
 *
 * กทล.1 ส่วนที่ ๒ prints ลักษณะพื้นที่ as four checkboxes (facts.md:22) and ส่วนที่ ๓ ties
 * A4 แบบแปลนอาคาร to Indoor/Greenhouse and A4' ภาพถ่ายแปลงและบริเวณโดยรอบ to Outdoor
 * (facts.md:38-39). A greenhouse standing on one corner of an open field is two ticks and
 * two papers.
 *
 * This used to collapse the ticks to the MOST CONTROLLED one, on the argument that erring
 * toward the stricter environment "cannot under-ask". The live register falsifies that
 * argument: the three areaType rows demand DISJOINT slots, so climbing from OUTDOOR to
 * GREENHOUSE does not add the building plan on top of the field photographs, it
 * substitutes one for the other and discards what it stepped over. Measured on the real
 * rule set: กลางแจ้ง + โรงเรือน lost field_surround_photos from the required list, from
 * missingRequired and from the submit gate, and the filing reported complete. The
 * browser's own checklist had been unioning all along (documents-step-config.tsx via
 * cultivation-tokens.ts), so the two surfaces disagreed — the exact failure this module
 * exists to end.
 *
 * WHERE THE TICKS ARE READ FROM: everywhere the filing states how it grows, taken
 * TOGETHER rather than one instead of another. `cultivationMethods` is the checkbox row
 * itself, and it is the field the invoice is already computed from (fee-service.js bills
 * per distinct method). `plots[].solarSystem` is the same answer given per plot, and on
 * live data it is populated where cultivationMethods is not. Only when the filing states
 * neither does the single legacy value stand in, and it is asked LAST on purpose:
 * Application.areaType is a NOT NULL column that three writers default to 'OUTDOOR'.
 */
function areaWasDeclared(application, formData, farmData) {
    const plots = (Array.isArray(formData.plots) ? formData.plots : []).filter(isPlainObject);
    return [
        ...(Array.isArray(farmData.areaTypes) ? farmData.areaTypes : []),
        ...(Array.isArray(formData.cultivationMethods) ? formData.cultivationMethods : []),
        ...plots.map((plot) => plot.solarSystem || plot.cultivationMethod),
        formData.locationType,
        farmData.areaType,
        application?.areaType,
    ].some((value) => String(value === null || value === undefined ? '' : value).trim() !== '');
}

function tickedAreaTypes(application, formData, farmData) {
    const ticks = new Set();
    const add = (value) => {
        const word = mappedTo(value, AREA_TYPE_BY_INPUT);
        if (word) { ticks.add(word); }
    };
    const collect = (values) => {
        (Array.isArray(values) ? values : []).forEach(add);
        return ticks.size > 0;
    };

    // ONE owner for the legal answer. `farmData.areaTypes` is the ลักษณะพื้นที่ checkbox
    // group itself, written by the wizard's site step, and when the filing has it nothing
    // else may widen or narrow it.
    //
    // It is deliberately NOT `cultivationMethods`, though that array holds the same words
    // today: cultivationMethods is the MONEY declaration — modules/billing fee-service
    // computes the fee from it and the quotation renders one line per method — so a
    // farmer ticking a lawful second ลักษณะพื้นที่ box would change their bill. The law
    // and the invoice must be able to say different things.
    if (Array.isArray(farmData.areaTypes)) {
        collect(farmData.areaTypes);
        return RULE_DIMENSIONS.areaType.filter((word) => ticks.has(word));
    }

    // LEGACY, read-only, and in this ORDER — each rung answers only when the one above it
    // said nothing. They are not unioned, because only the first is an answer a farmer
    // actually gave: `plots[].solarSystem` is born 'OUTDOOR' on แปลงที่ 1
    // (farm-info-step.tsx:253) and its control is DISABLED whenever the ticks leave one
    // option (farm-info-plots-land-sections.tsx:145), so an indoor-only farm carries an
    // OUTDOOR plot nobody chose and nobody can change. Unioning that demanded
    // ภาพถ่ายแปลงและบริเวณโดยรอบ from a farm with no open field, which it can never supply
    // — the submit gate would refuse the filing forever. A default is not a tick.
    if (collect(formData.cultivationMethods)) {
        return RULE_DIMENSIONS.areaType.filter((word) => ticks.has(word));
    }

    (Array.isArray(formData.plots) ? formData.plots : []).forEach((plot) => {
        if (!isPlainObject(plot)) { return; }
        add(plot.solarSystem || plot.cultivationMethod);
    });

    if (ticks.size === 0) {
        // Said nothing in any of the honest places. The legacy single value is all there
        // is, and it is asked last on purpose: Application.areaType is a NOT NULL column
        // that three writers default to 'OUTDOOR'. If it too says nothing, the empty set
        // is the wildcard the register already means by a NULL column.
        add(formData.locationType || farmData.areaType || application?.areaType);
    }

    // Vocabulary order, not tick order: the rule set stamped onto an application has to
    // be byte-stable for the same filing however the farmer clicked.
    return RULE_DIMENSIONS.areaType.filter((word) => ticks.has(word));
}

/** กทล.1 keeps these three useful but never blocking (spec §2.1). */
const OPTIONAL_SLOT_IDS = Object.freeze(['water_test', 'soil_test', 'additional_docs']);

/**
 * กัญชา + ขอบข่ายปลูก: ใบอนุญาตปลูกหรือหลักฐานการแจ้งปลูก แสดงแต่ไม่บล็อก (มติ operator 2026-10-05)
 * ไม่มีใบอนุญาตปลูกกัญชาที่บังคับตามกฎหมาย — มีเพียงการแจ้งปลูก "ปลูกกัญ" และคำขอ ภ.ท. ระบุ "(ถ้ามี)"
 * ทะเบียนกฎพูดได้แต่ "บังคับ" (แถว isRequired=false ถูกข้ามเสมอ) จึงเป็นเงื่อนไขของเอนจิน เหมือนช่องของวัตถุประสงค์
 */
const OPTIONAL_FOR_CANNABIS_PLANTING = Object.freeze(['controlled_herb_license']);
const OBSOLETE_REGISTER_SLOT = 'controlled_herb_license';

/** REPLACEMENT asks for one of these two, not both. */
const REPLACEMENT_EITHER = Object.freeze(['police_report', 'damaged_cert']);
const REPLACEMENT_PAIR_ID = REPLACEMENT_EITHER.join('|');

const REASON_PURPOSE = 'PURPOSE';

/**
 * Canonical slot id → the ministry's own words for it.
 *
 * The v2 กทล.1 rows are appended LAST in the catalog, so where an old row and a v2
 * row fold onto one canonical id the v2 wording wins — which is the wording the
 * wizard, the form and the officer's checklist all show.
 */
const SLOT_COPY_BY_CANONICAL_ID = (() => {
    const map = new Map();
    Object.values(DOCUMENT_SLOTS).forEach((slot) => {
        if (!slot?.slotId || !slot?.name) { return; }
        map.set(getCanonicalSlotId(slot.slotId), {
            labelTH: slot.name,
            description: slot.description || null,
            sourceHint: slot.sourceHint || null,
        });
    });
    return map;
})();

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formDataOf(application) {
    return isPlainObject(application?.formData) ? application.formData : {};
}

/** Trim, upper-case, and answer null for anything outside the closed set. */
function oneOf(value, vocabulary) {
    const text = String(value === null || value === undefined ? '' : value).trim().toUpperCase();
    if (!text) { return null; }
    return vocabulary.includes(text) ? text : null;
}

/** Map through a table of known spellings; an unknown word is null, never a guess. */
function mappedTo(value, table) {
    const text = String(value === null || value === undefined ? '' : value).trim();
    if (!text) { return null; }
    return table[text.toUpperCase()] || table[text] || null;
}

/**
 * The six dimensions this filing is judged by, plus the purposes (not a dimension).
 *
 * Every one of them is either a word the rule table knows or null. Null is not
 * "unknown" being papered over — it is the wildcard the table already means by a
 * NULL column, so a draft that has not said where it grows yet is judged by the
 * rules that bind everybody and by nothing else.
 */
function deriveDimensions(application, options = {}) {
    const formData = formDataOf(application);
    const farmData = isPlainObject(formData.farmData) ? formData.farmData : {};
    const areaTicks = tickedAreaTypes(application, formData, farmData);

    // WHO the certificate would belong to. When a caller states it — the submit gate
    // reads it from the ENTITY ROW — that answer is used as given, including its null:
    // falling through to the applicant-supplied `applicantType` on a null override
    // would hand the choice of holder-specific law back to the applicant, which is the
    // exact thing reading the entity row was for.
    const holderType = Object.prototype.hasOwnProperty.call(options, 'holderType')
        ? oneOf(options.holderType, HOLDER_TYPES)
        : oneOf(
            application?.entity?.type || mappedTo(formData.applicantType, HOLDER_TYPE_ALIASES),
            HOLDER_TYPES,
        );

    // WHICH LAW judges this filing. Read only from server-owned keys
    // (shared/form-data-ownership.js): requestType and replacementOf are stripped from
    // any applicant payload, and renewalOf is written by renewal-service from a
    // certificate the platform itself issued. It has to be that way — REPLACEMENT is
    // judged by two rows instead of the whole ส่วนที่ ๓ set, so an applicant who could
    // write it could file one police report and pass a gate that should have asked for
    // eleven papers. `serviceType`, which the wizard owns, is deliberately NOT read.
    const requestType = formData.replacementOf
        ? 'REPLACEMENT'
        : (oneOf(formData.requestType, REQUEST_TYPES) || (formData.renewalOf ? 'RENEWAL' : 'NEW'));

    // Carried as written: a word outside the vocabulary is a refusal below, never something
    // this lens trims, upper-cases or drops on the applicant's behalf (operator ruling
    // 2026-10-05 — no silent mapping of MEDICAL / COMMERCIAL or any other old word).
    const purposes = Array.isArray(formData.certificationPurposes)
        ? formData.certificationPurposes.map((purpose) => String(purpose ?? ''))
        : [];

    // Read from the FILING only. `applications` has no plant column and never has —
    // `application.plantType` was a dead read that could only ever be undefined, and a
    // dead read next to a live one invites the next reader to trust it.
    const plantCode = asPlantSlug(formData.plantId || formData.plantType);

    return {
        holderType,
        requestType,
        plantCode,
        landTenure: mappedTo(farmData.landOwnership, LAND_TENURE_BY_INPUT),
        areaTypes: areaTicks,
        // "I cannot read what you said about your land" must not be spelled the same way
        // as "this filing has no land". An empty tick set asks the register
        // `areaType: null`, which returns ONLY the rows that bind every area — so
        // แบบแปลนอาคาร (A4) and ภาพถ่ายแปลงและบริเวณโดยรอบ (A4') are dropped from the
        // required set, from missingRequired, and from the submit gate, silently. The
        // filing then freezes that reduced answer onto itself as its own law.
        // `farmData` is applicant-writable (stripServerOwnedKeys only removes TOP-LEVEL
        // keys), so this is reachable by hand: one nested `areaTypes: []`.
        areaDeclarationUnreadable: areaTicks.length === 0
            && areaWasDeclared(application, formData, farmData),
        // PLANTING is the กทล.1 default: a filing that has not said otherwise is a
        // growing application, which is what the form's own first checkbox means.
        certScope: oneOf(formData.certScope, CERT_SCOPES) || 'PLANTING',
        purposes,
    };
}

/**
 * What the SERVER can see, as canonical slot ids.
 *
 * `formData.documents` — the wizard's own checklist — is deliberately not read: an
 * applicant can tick every box in it without a byte reaching the server.
 */
function collectServerDocumentEvidence(application, documentRows = []) {
    const formData = formDataOf(application);
    const evidence = buildUploadedSlotSet(
        Array.isArray(formData.draftDocuments) ? formData.draftDocuments : [],
    );
    (Array.isArray(documentRows) ? documentRows : []).forEach((row) => {
        const documentType = row?.documentType;
        if (!documentType) { return; }
        // A superseded row is a file that was REPLACED. It is kept as history, and it
        // is not evidence: the replacement can itself be deleted, and counting the
        // history would report a slot satisfied with no file behind it — a green tick
        // on a card showing nothing, and a submit gate that lets it through.
        if (row.supersededAt) { return; }
        evidence.add(getCanonicalSlotId(documentType));
    });
    return evidence;
}

/**
 * The file behind each canonical slot, for the surfaces that show it back.
 *
 * `application_documents` rows win over the draft array when both exist: the row is
 * written by the sync that also decides which upload is CURRENT for a slot.
 */
function indexUploadedFiles(application, documentRows = []) {
    const files = new Map();
    const remember = (slotId, file) => {
        const canonical = getCanonicalSlotId(slotId);
        if (!canonical) { return; }
        files.set(canonical, file);
    };

    const formData = formDataOf(application);
    (Array.isArray(formData.draftDocuments) ? formData.draftDocuments : []).forEach((entry) => {
        if (!isPlainObject(entry)) { return; }
        remember(entry.slotId || entry.type || '', {
            documentId: entry.documentId || null,
            fileUrl: entry.fileUrl || null,
            fileName: entry.fileName || null,
            uploadedAt: entry.uploadedAt || null,
        });
    });
    (Array.isArray(documentRows) ? documentRows : []).forEach((row) => {
        if (!isPlainObject(row) || !row.documentType) { return; }
        if (row.currentForSlot === null && row.supersededAt) { return; }
        remember(row.documentType, {
            documentId: row.documentId || null,
            fileUrl: row.fileUrl || null,
            fileName: row.fileName || null,
            uploadedAt: row.createdAt || null,
        });
    });
    return files;
}

/**
 * WHY this slot is being asked for, in one word the surfaces can render.
 *
 * A rule row carries the case it belongs to, so the reason is read from the row
 * rather than guessed by the caller: the wizard's step-3 explainer strip
 * ("เพราะที่ดินเป็นการเช่า") and the officer's checklist both need it, and neither
 * should have to re-derive the law.
 */
function reasonFromRule(rule) {
    if (rule?.landTenure === 'RENTED') { return 'RENTED'; }
    if (rule?.areaType === 'INDOOR' || rule?.areaType === 'GREENHOUSE' || rule?.areaType === 'OUTDOOR') {
        return rule.areaType;
    }
    if (rule?.certScope === 'PROCESSING') { return 'PROCESSING'; }
    // 2026-09-06: the licence rule gained a PLANTING-scope row (operator instruction,
    // matching กทล.1 checklist 1.1 "กรณีการปลูก/แปรรูป") — its reason word is the scope,
    // same as PROCESSING, so the paper explains which scope demanded it.
    if (rule?.certScope === 'PLANTING') { return 'PLANTING'; }
    if (rule?.requestType === 'RENEWAL' || rule?.requestType === 'REPLACEMENT') { return rule.requestType; }
    if (rule?.holderType) { return 'HOLDER_TYPE'; }
    // OWNED / STATE_PERMITTED / OTHER carry no reason word of their own: they are
    // not a condition a farmer needs explained, they are the ordinary case.
    return 'ALWAYS';
}

function slotEntry(canonicalId, { required, requiredReason, satisfied, file, alternativeGroup = null }) {
    const copy = SLOT_COPY_BY_CANONICAL_ID.get(canonicalId) || {};
    return {
        slotId: canonicalId,
        // An id the catalog does not know is shown as itself rather than hidden:
        // a requirement nobody can name is still a requirement the farmer is being
        // held to, and it must be visible to whoever fixes the catalog.
        labelTH: copy.labelTH || canonicalId,
        description: copy.description || null,
        sourceHint: copy.sourceHint || null,
        required: Boolean(required),
        // Set when this paper satisfies a demand JOINTLY with its alternatives: the group
        // is required, no member is on its own. Null for every ordinary slot.
        alternativeGroup: alternativeGroup || null,
        requiredReason: requiredReason || null,
        satisfied: Boolean(satisfied),
        // The id DELETE /applications/draft-documents/:documentId takes (walk D3).
        documentId: file?.documentId || null,
        fileUrl: file?.fileUrl || null,
        fileName: file?.fileName || null,
        uploadedAt: file?.uploadedAt || null,
    };
}

/**
 * The one answer.
 *
 * @param {object} application application row (id, entity?, formData)
 * @param {Array<{documentType?: string}>} documentRows application_documents rows
 * @param {{at?: Date|string, client?: object, holderType?: string}} [options]
 * @returns {Promise<{dims: object, slots: object[], missingRequired: string[], complete: boolean,
 *                    appliedRules: object[], requiredSlotIds: string[]}>}
 */
async function resolveApplicationRequirements(application, documentRows = [], options = {}) {
    const { at, client = prisma } = options;
    // Forward the caller's holderType only when they actually stated one: passing the
    // key with an undefined value would read as "the holder is nothing", which is a
    // deliberate answer and not the same as "I did not say".
    const dims = deriveDimensions(
        application,
        Object.prototype.hasOwnProperty.call(options, 'holderType')
            ? { holderType: options.holderType }
            : {},
    );

    let rules = [];
    try {
        rules = await rulesAt({
            at: at || new Date(),
            holderType: dims.holderType,
            requestType: dims.requestType,
            plantCode: dims.plantCode,
            landTenure: dims.landTenure,
            areaType: dims.areaTypes,
            certScope: dims.certScope,
        }, client);
    } catch (error) {
        // rulesAt refuses a dimension word outside its closed vocabulary with a
        // 422 written for an ADMIN filing a rule. An applicant asking which
        // documents they need must never be shown that: if it fires here, the
        // derivation above let a word through that it should have mapped to null,
        // which is our defect, not theirs.
        if (error?.code === 'INVALID_RULE_DIMENSION') {
            logger.error(
                `[requirements] INVALID_RULE_DIMENSION from the rule engine — a derived dimension `
                + `was not mapped into the closed vocabulary (application ${application?.id || 'unknown'}, `
                + `dims ${JSON.stringify(dims)}): ${error.message}`,
            );
            const internal = new Error('ระบบอ่านเงื่อนไขเอกสารของคำขอนี้ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง หากยังไม่ได้กรุณาแจ้งเจ้าหน้าที่');
            internal.statusCode = 500;
            internal.status = 500;
            internal.code = 'REQUIREMENTS_RESOLUTION_FAILED';
            throw internal;
        }
        throw error;
    }

    // ---- can this filing be judged at all? ----------------------------------
    // Guessing 'cannabis' would judge a kratom filing by the wrong attachment list, so the
    // plant is never defaulted. But the old behaviour — carry on with no plant dimension —
    // was worse than a guess: the register answers such a question with the two
    // plant-agnostic rows, which are company_reg and community_cert, so an INDIVIDUAL
    // filing was asked for ZERO documents, passed the submit gate, and froze that empty
    // answer onto itself as the law every later resubmit is judged by. Nine slots became
    // none by typing one word into a field the applicant owns.
    //
    // Refusing is the honest answer to an unanswerable question. It is not a lenient
    // outcome dressed up: a blocked filing reports complete:false whatever it has
    // attached, and the gate turns it into a refusal the farmer can act on.
    // `openPlantCodes` empty means the register does not distinguish plants at all — every
    // rule on it binds every plant. There is then no plant-shaped hole to fall through, so
    // there is nothing to refuse; the check bites exactly when law HAS been filed per plant
    // and this filing's plant is not among the plants it was filed for.
    const openPlantCodes = await plantCodesWithRulesAt({ at: at || new Date() }, client);
    const blockingIssues = [];
    if (!dims.plantCode) {
        logger.warn(
            `[requirements] application ${application?.id || 'unknown'} names no plant this `
            + 'platform recognises, so no law can judge it',
        );
        blockingIssues.push({
            code: BLOCKING_PLANT_NOT_DECLARED,
            messageTH: 'คำขอนี้ยังไม่ได้ระบุชนิดพืชที่ขอรับรอง ระบบจึงยังไม่ทราบว่าต้องใช้เอกสารชุดใด '
                + 'กรุณาเลือกชนิดพืชในขั้นตอนแรก แล้วกลับมาที่หน้านี้อีกครั้ง',
            detail: { plantCode: null, openPlantCodes },
        });
    } else if (openPlantCodes.length > 0 && !openPlantCodes.includes(dims.plantCode)) {
        logger.warn(
            `[requirements] application ${application?.id || 'unknown'} names plant `
            + `${dims.plantCode}, which has no requirement rules on the register`,
        );
        blockingIssues.push({
            code: BLOCKING_PLANT_LAW_NOT_FILED,
            messageTH: 'ขณะนี้ยังไม่มีประกาศข้อกำหนดเอกสารสำหรับพืชที่คุณเลือก ระบบจึงยังรับคำขอของพืชชนิดนี้ไม่ได้ '
                + 'กรุณาเลือกพืชที่ระบบเปิดรับ หรือติดต่อเจ้าหน้าที่',
            detail: { plantCode: dims.plantCode, openPlantCodes },
        });
    }

    // Same shape as the plant refusals, same reason: an unanswerable question gets a
    // refusal, never a lenient answer. This one bites on a filing that DID say something
    // about its land and said it in words no rule keys off — including the empty array,
    // which is a statement, not a silence. A filing that says nothing anywhere is left
    // alone: Application.areaType is NOT NULL, so silence means a caller holding a bare
    // formData, not an applicant who removed their answer.
    // ผู้ถือที่คำขอประกาศ ต้องเป็นผู้ถือที่ระบบจะออกใบให้จริง (มติ operator 2026-09-07)
    const holderIssue = holderMismatchIssue(formDataOf(application), dims.holderType);
    if (holderIssue) {
        logger.warn(
            `[requirements] application ${application?.id || 'unknown'} declares `
            + `${holderIssue.detail.declaredApplicantType} but its entity is `
            + `${holderIssue.detail.holderType || 'none'}`,
        );
        blockingIssues.push(holderIssue);
    }

    // A purpose word the register has no licence for (MEDICAL, COMMERCIAL, anything else).
    // An EMPTY list is not refused here — it is an unfinished draft, and the submit door
    // is where "choose a purpose" is demanded.
    const purposeVerdict = assessPurposes(dims.purposes);
    // ยื่นแล้วต้องมีอย่างน้อยหนึ่งข้อ (options.requirePurpose = ประตูที่ยื่นจริง) — ร่างว่างได้
    if (options.requirePurpose && purposeVerdict.empty) {
        blockingIssues.push({
            code: BLOCKING_PURPOSE_INVALID,
            messageTH: refusalMessageTh(),
            detail: { unknown: [], empty: true, accepted: PURPOSE_CODES },
        });
    }
    if (purposeVerdict.unknown.length > 0) {
        blockingIssues.push({
            code: BLOCKING_PURPOSE_INVALID,
            messageTH: refusalMessageTh(),
            detail: { unknown: purposeVerdict.unknown, accepted: PURPOSE_CODES },
        });
    }

    if (dims.areaDeclarationUnreadable) {
        logger.warn(
            `[requirements] application ${application?.id || 'unknown'} declares an area `
            + 'the platform cannot read, so no area rule can judge it',
        );
        blockingIssues.push({
            code: BLOCKING_AREA_TYPE_UNREADABLE,
            messageTH: 'คำขอนี้ระบุลักษณะพื้นที่ปลูกด้วยค่าที่ระบบอ่านไม่ออก ระบบจึงยังไม่ทราบว่าต้องใช้เอกสารชุดใด '
                + 'กรุณาเลือกลักษณะพื้นที่ (กลางแจ้ง / โรงเรือน / อาคารระบบปิด) ในขั้นตอนข้อมูลแปลงปลูก '
                + 'แล้วกลับมาที่หน้านี้อีกครั้ง',
            detail: { areaTypes: [], accepted: RULE_DIMENSIONS.areaType },
        });
    }

    if (blockingIssues.length > 0) {
        // No slot list, no missingRequired, no stamp material. Handing over the
        // plant-agnostic rows here would be the "attach these papers" advice this refusal
        // exists to prevent — and those two rows (company_reg, community_cert) are exactly
        // what an unjudgeable filing used to be asked for.
        return {
            dims,
            slots: [],
            missingRequired: [],
            complete: false,
            blockingIssues,
            appliedRules: [],
            requiredSlotIds: [],
        };
    }

    const evidence = collectServerDocumentEvidence(application, documentRows);
    const files = indexUploadedFiles(application, documentRows);
    const satisfiedBy = (canonicalId) => isSlotSatisfied(canonicalId, evidence);

    // ---- what the law asked for, slot by slot -------------------------------
    const appliedRules = [];
    const reasons = new Map();
    // When a filing ticks both โรงเรือน and อาคารระบบปิด, TWO rows demand
    // building_plan_photos and each offers its own reason word. First-row-wins made the
    // badge a farmer reads depend on the order the database happened to return, so the
    // tie is broken by a vocabulary instead.
    //
    // It has to be the WHOLE vocabulary, not the area words alone. Ranking only areas and
    // leaving every other reason unranked still let row order decide the moment the tie
    // crossed a dimension: land_rights demanded by a RENTED row and by an OUTDOOR row read
    // 'RENTED' when the rented row happened to come back first and 'OUTDOOR' when it did
    // not — the same order-dependence, one dimension over. The order below is
    // reasonFromRule's own priority, so the two agree: RENTED before an area word (a paper
    // demanded because the land is rented has to keep saying so), the area words in
    // กทล.1's checkbox order, then the rest, with ALWAYS — the ordinary case, explaining
    // nothing — last.
    const REASON_RANK = ['RENTED', ...RULE_DIMENSIONS.areaType, 'PROCESSING', 'PLANTING', 'RENEWAL', 'REPLACEMENT', 'HOLDER_TYPE', 'ALWAYS'];
    const reasonRank = (reason) => {
        const at = REASON_RANK.indexOf(reason);
        // A word this list has never heard ranks last rather than first: an unknown
        // reason must not silently outrank the ones the farmer was promised.
        return at === -1 ? REASON_RANK.length : at;
    };
    const outranks = (candidate, held) => reasonRank(candidate) < reasonRank(held);
    rules.forEach((rule) => {
        if (rule?.isRequired === false) { return; }
        const canonical = getCanonicalSlotId(rule.slotId);
        if (!canonical) { return; }
        // กฎหมายตัดสิน ไม่ใช่แถวเก่าในทะเบียน (มติ operator 2026-10-05): ไม่มีชนิดไหนถูกบังคับให้ส่ง
        // controlled_herb_license — ช่องปลูกกัญชาเป็นช่องไม่บังคับด้านล่าง ส่วนแปรรูปใช้ licence_pt11
        if (canonical === OBSOLETE_REGISTER_SLOT) { return; }
        appliedRules.push(rule);
        const reason = reasonFromRule(rule);
        if (!reasons.has(canonical)) {
            reasons.set(canonical, reason);
            return;
        }
        if (outranks(reason, reasons.get(canonical))) {
            reasons.set(canonical, reason);
        }
    });

    // ---- the conditions no single row can express ---------------------------
    //
    // วัตถุประสงค์ที่เลือก ⇒ ต้องมีใบอนุญาตที่ออกให้แล้วรองรับ — **ตามที่กฎหมายของชนิดนั้นบังคับจริง**
    // (มติ operator 2026-10-05 · purposeLicenceSlotId เป็นคนตอบ):
    //   กัญชา RESEARCH ภ.ท. 09 · EXPORT ภ.ท. 10 · PROCESSING ภ.ท. 11
    //   กระท่อม EXPORT = ใบอนุญาตตามมาตรา 10 พ.ร.บ.พืชกระท่อม · วิจัย/แปรรูป ไม่มี
    //   อีกสี่ชนิด ไม่มี — ขิงที่ติ๊ก "ส่งออก" ไม่ถูกขอใบอนุญาตที่ไม่มีอยู่สำหรับขิง (เดิน demo 2026-09-12)
    //
    // เงื่อนไขนี้อยู่นอกทะเบียนกฎ เพราะทะเบียนไม่มีมิติ "วัตถุประสงค์" และไม่ควรมี (spec §2.1)
    //
    // ช่องที่ทะเบียนเรียกอยู่แล้ว (กัญชา ขอบข่ายแปรรูป ⇒ licence_pt11) ไม่ถูกใส่ซ้ำ: reasons รวมตาม
    // slot id อยู่แล้ว แต่ appliedRules ต้องมีแถวเดียวต่อช่อง ไม่งั้นตราประทับนับสองครั้ง
    PURPOSE_CODES
        .filter((code) => dims.purposes.includes(code))
        .forEach((code) => {
            const licenceSlot = purposeLicenceSlotId(dims.plantCode, code);
            if (!licenceSlot) { return; }
            const slotId = getCanonicalSlotId(licenceSlot);
            if (!reasons.has(slotId)) { reasons.set(slotId, REASON_PURPOSE); }
            // The stamp is built from appliedRules, and a purpose has no row on the
            // register — so it enters as a virtual rule (same device as the replacement
            // pair below). Without it a resubmit, judged by the stamp alone, never
            // re-asks for the licence. The reader needs no special case.
            if (appliedRules.some((rule) => getCanonicalSlotId(rule.slotId) === slotId)) { return; }
            appliedRules.push({ id: null, slotId, isRequired: true, virtual: true, purposeCode: code });
        });

    // กัญชา ขอบข่ายแปรรูป ⇒ ภ.ท. 11 โดยโค้ดเอง ไม่พึ่งแถวในทะเบียนที่ต้อง seed (มติ operator 2026-10-05)
    if (dims.plantCode === 'cannabis' && dims.certScope === 'PROCESSING') {
        const pt11 = getCanonicalSlotId(CERTIFICATION_PURPOSES.PROCESSING.slotId);
        if (!reasons.has(pt11)) { reasons.set(pt11, 'PROCESSING'); }
        if (!appliedRules.some((rule) => getCanonicalSlotId(rule.slotId) === pt11)) {
            appliedRules.push({ id: null, slotId: pt11, isRequired: true, virtual: true, purposeCode: 'PROCESSING' });
        }
    }

    const replacementPair = dims.requestType === 'REPLACEMENT';
    if (replacementPair) {
        REPLACEMENT_EITHER.forEach((slotId) => reasons.delete(slotId));
    }

    const required = [...reasons.keys()];
    const slots = required.map((canonicalId) => slotEntry(canonicalId, {
        required: true,
        requiredReason: reasons.get(canonicalId),
        satisfied: satisfiedBy(canonicalId),
        file: files.get(canonicalId),
    }));

    if (replacementPair) {
        REPLACEMENT_EITHER.forEach((canonicalId) => {
            slots.push(slotEntry(canonicalId, {
                // Neither is required ON ITS OWN — the pair is, and the pair is
                // reported as one entry in missingRequired.
                required: false,
                // …but "not required on its own" is not "optional", and the screen had no
                // way to tell them apart: it sorted by `required` alone and filed both
                // under เอกสารไม่บังคับ — "ไม่แนบก็ยื่นคำขอได้" — which is false, because
                // the filing cannot be submitted until one of them is attached. Naming the
                // group here is what lets the screen show it as a choice among the papers
                // this filing owes. (Found by walking a replacement, 2026-09-07.)
                alternativeGroup: REPLACEMENT_PAIR_ID,
                requiredReason: 'REPLACEMENT',
                satisfied: satisfiedBy(canonicalId),
                file: files.get(canonicalId),
            }));
        });
    }

    const optionalIds = dims.plantCode === 'cannabis' && dims.certScope === 'PLANTING'
        ? [...OPTIONAL_FOR_CANNABIS_PLANTING, ...OPTIONAL_SLOT_IDS]
        : OPTIONAL_SLOT_IDS;
    optionalIds.forEach((canonicalId) => {
        if (slots.some((slot) => slot.slotId === canonicalId)) { return; }
        slots.push(slotEntry(canonicalId, {
            required: false,
            requiredReason: null,
            satisfied: satisfiedBy(canonicalId),
            file: files.get(canonicalId),
        }));
    });

    // ---- what is still missing ----------------------------------------------
    const missingRequired = required.filter((canonicalId) => !satisfiedBy(canonicalId));
    const requiredSlotIds = [...required];
    if (replacementPair) {
        requiredSlotIds.push(REPLACEMENT_PAIR_ID);
        if (!REPLACEMENT_EITHER.some((canonicalId) => satisfiedBy(canonicalId))) {
            missingRequired.push(REPLACEMENT_PAIR_ID);
        }
        // The stamp a resubmit is judged by has to carry the pair as ONE demand,
        // or the resubmit would ask for both papers the first submit never needed.
        appliedRules.push({ id: null, slotId: REPLACEMENT_PAIR_ID, isRequired: true, virtual: true });
    }

    return {
        dims,
        slots,
        missingRequired,
        // A filing the law cannot reach is never complete, however many files it carries:
        // "nothing is missing" is only true once something was asked.
        complete: missingRequired.length === 0 && blockingIssues.length === 0,
        blockingIssues,
        appliedRules,
        requiredSlotIds,
    };
}

module.exports = {
    holderMismatchIssue,
    resolveApplicationRequirements,
    BLOCKING_PLANT_NOT_DECLARED,
    BLOCKING_PLANT_LAW_NOT_FILED,
    BLOCKING_AREA_TYPE_UNREADABLE,
    BLOCKING_PURPOSE_INVALID,
    collectServerDocumentEvidence,
    deriveDimensions,
    isRequirementSatisfied: isSlotSatisfied,
    OPTIONAL_SLOT_IDS,
    REPLACEMENT_EITHER,
    REPLACEMENT_PAIR_ID,
};
