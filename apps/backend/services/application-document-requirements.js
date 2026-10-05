// Domain: Requirement Engine, applied to ONE application at the submit doors.
// Spec: design note 2026-08-15-membership-m2-documents-and-poa-design §3
// (operator ruling G2) · AC1 (per-holder-type 422 + the missing slots),
// AC2 (evidence is server-side; a client flag is not evidence),
// AC3 (a filing is judged by the law in force on the day it was FIRST filed).
//
// The law itself is data — dated rows in `requirement_rules`, read through
// services/requirement-rule-service.js. This module is the part that asks the
// law about a specific application and answers 422 or nothing.
//
// TWO THINGS THIS MODULE REFUSES TO DO, both deliberate:
//
//  1. It does NOT guess the mode. A door knows whether it is handling a first
//     submit or a resubmit — POST /submit even has the predicate in front of it
//     (`isInitialSubmit`, applications.js) — and the same status can mean either
//     thing at different doors. So `mode` is a required argument, and an
//     unrecognised one throws rather than defaulting to the lenient branch.
//
//  2. It does NOT read `formData.documents`. That array is the wizard's own
//     checklist: an applicant can set `uploaded: true` on every entry without a
//     byte reaching the server. Evidence is `formData.draftDocuments[]` (written
//     by the upload route, a server-owned key) and `ApplicationDocument` rows.
//
// Both sides of every comparison go through getCanonicalSlotId
// (routes/api/applications/validation-slot-utils.js — the SSOT alias table, no
// alias is ever written here): a rule filed as 'COMPANY_REG' and a document
// recorded as 'company_reg' are the same requirement, and a rule filed as
// 'LAND_TITLE' is not a law about nothing.

'use strict';

const { prisma } = require('./prisma-database');
const logger = require('../shared/logger');
const { DOCUMENT_SLOTS } = require('../constants/document-slots');
const { getCanonicalSlotId } = require('../routes/api/applications/validation-slot-utils');
const { isSlotSatisfied } = require('@gacp/validation/satisfaction-families');
const {
    resolveApplicationRequirements,
    collectServerDocumentEvidence,
    BLOCKING_PURPOSE_INVALID,
} = require('./application-requirements-service');
const {
    assessPurposes, refusalMessageTh, PURPOSE_CODES, purposeLicenceSlotId,
} = require('../shared/certification-purposes');
const { asPlantSlug } = require('../config/plant-species-slugs');

const MODE_FIRST_SUBMIT = 'first-submit';
const MODE_RESUBMIT = 'resubmit';

/**
 * Canonical slot id -> the ministry's own Thai label for it.
 *
 * A 422 that says `company_reg` tells an applicant nothing they can act on, so
 * the refusal carries the label from the slot catalog (constants/document-slots.js)
 * — the same words the wizard shows them.
 */
const SLOT_LABEL_TH_BY_CANONICAL_ID = (() => {
    const map = new Map();
    Object.values(DOCUMENT_SLOTS).forEach((slot) => {
        if (slot?.slotId && slot?.name) {
            map.set(getCanonicalSlotId(slot.slotId), slot.name);
        }
    });
    return map;
})();

/**
 * The 422 every door answers with. Shaped like SubmitGuardError
 * (services/application-submit-guard.js) so each door catches it the same way
 * it already catches the authority refusal: one `instanceof`, no string tests.
 */
/**
 * The filing cannot be judged at all, which is a different refusal from "a paper is
 * missing". Telling someone to attach nine documents is wrong advice when the ministry
 * has published no document list for what they are filing about, so this error carries
 * the reason instead of a slot list, and the surfaces render its own Thai sentence.
 */
class ApplicationNotJudgeableError extends Error {
    constructor(blockingIssues) {
        super(blockingIssues?.[0]?.messageTH
            || 'ยังไม่สามารถตรวจสอบเอกสารของคำขอนี้ได้ กรุณาตรวจสอบข้อมูลคำขอแล้วลองใหม่อีกครั้ง');
        this.name = 'ApplicationNotJudgeableError';
        this.status = 422;
        this.statusCode = 422;
        this.code = 'APPLICATION_NOT_JUDGEABLE';
        this.blockingIssues = blockingIssues;
        // Not a missing-document refusal: it must never pretend to name papers.
        this.missingSlots = [];
    }
}

class DocumentRequirementError extends Error {
    constructor(missingSlots) {
        super('เอกสารบังคับยังไม่ครบ กรุณาแนบเอกสารที่ระบุก่อนส่งคำขอ');
        this.name = 'DocumentRequirementError';
        this.status = 422;
        this.statusCode = 422;
        this.code = 'APPLICATION_INCOMPLETE';
        this.missingSlots = missingSlots;
    }
}

/**
 * Is this the gate refusing, rather than something breaking?
 *
 * A KIND, not a class list. Each of the five submit doors used to test
 * `instanceof DocumentRequirementError`, so when the gate learned a second refusal none of
 * them caught it: the throw fell through to the generic handler and a farmer was told
 * "Failed to submit application", in English, with the reason dropped. A sixth refusal
 * must not be able to repeat that, so doors ask what kind of thing this is.
 */
function isSubmitGateRefusal(error) {
    return error instanceof DocumentRequirementError
        || error instanceof ApplicationNotJudgeableError;
}

/**
 * The ONE answer every door gives to a gate refusal.
 *
 * It was five inline copies of the same seven lines, each with
 * `error: 'APPLICATION_INCOMPLETE'` hardcoded — which is how the second refusal would have
 * been mislabelled even by a door that caught it. The refusal names itself now.
 */
function respondSubmitGateRefusal(res, error) {
    const body = {
        success: false,
        // `error` and `code` carry the same word: the older clients branch on `error`.
        error: error.code,
        code: error.code,
        message: error.message,
        // The SAME sentence again, under a name the browser does not throw away.
        //
        // apps/web-app/src/lib/api/api-client.ts:75 treats `message` as a RESERVED
        // envelope key and strips it from every non-2xx body, keeping `success`/`data`/
        // `error`/`code` and harvesting everything else into `.meta`. So the Thai this
        // gate writes died one hop short of the screen: the preview door fell through to
        // `setError(submitResponse.error)` and printed the bare enum
        // APPLICATION_NOT_JUDGEABLE at a farmer. `messageTh` is not reserved, so it
        // survives as `.meta.messageTh` — the field that door already reads for the older
        // refusal. Sent HERE, from the one responder, so no door has to remember.
        messageTh: error.message,
        missingSlots: error.missingSlots || [],
    };
    if (error.blockingIssues) {
        body.blockingIssues = error.blockingIssues;
    }
    return res.status(422).json(body);
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formDataOf(application) {
    return isPlainObject(application?.formData) ? application.formData : {};
}

function labelFor(canonical) {
    return SLOT_LABEL_TH_BY_CANONICAL_ID.get(canonical) || canonical;
}

/**
 * One line of the refusal, in the ministry's own words.
 *
 * A REPLACEMENT filing needs the police report OR the damaged certificate, which no
 * single rule row can say, so the lens reports that pair as one demand spelled
 * `police_report|damaged_cert`. Told to an applicant it has to read as a choice, not
 * as a slot id nobody can find on the form.
 */
function describeSlot(slotId) {
    const raw = String(slotId || '');
    if (raw.includes('|')) {
        const members = raw.split('|').map((member) => getCanonicalSlotId(member));
        return {
            slotId: members.join('|'),
            labelTH: members.map((member) => labelFor(member)).join(' หรือ '),
        };
    }
    const canonical = getCanonicalSlotId(raw);
    return { slotId: canonical, labelTH: labelFor(canonical) };
}

/**
 * Everything the SERVER can show for this application, as canonical slot ids.
 *
 * The implementation moved to services/application-requirements-service.js when that
 * module became the ONE lens: the gate and the door must not be able to disagree about
 * what counts as evidence, and two copies of this function is exactly how they would.
 * Re-exported here so every existing caller keeps its import path.
 */

function buildRequirementSnapshot(appliedRules) {
    const rules = Array.isArray(appliedRules) ? appliedRules : [];
    return {
        stampedAt: new Date().toISOString(),
        ruleIds: rules.map((rule) => rule?.id).filter(Boolean),
        // Canonical and de-duplicated: this list is what a resubmit is judged by
        // months later, so it must not depend on the spelling used the day the
        // rule was filed.
        slotIds: [...new Set(rules.map((rule) => getCanonicalSlotId(rule?.slotId)).filter(Boolean))],
    };
}

/**
 * Which of the demanded slots the server still cannot see.
 *
 * Satisfaction goes through the families (@gacp/validation/satisfaction-families), not
 * through a bare set lookup: กทล.1 asks for the land right once and four different
 * papers answer it — โฉนด, น.ส.3, ส.ป.ก., เอกสารสิทธิ์อื่น — and they stay four separate
 * slots on the upload door because folding them made the second upload delete the
 * first. A farmer holding a โฉนด must not be asked for a land document again.
 */
function missingFrom(requiredSlotIds, evidence) {
    const missing = [];
    const seen = new Set();
    requiredSlotIds.forEach((slotId) => {
        const raw = String(slotId || '');
        const isPair = raw.includes('|');
        const canonical = isPair
            ? raw.split('|').map((member) => getCanonicalSlotId(member)).join('|')
            : getCanonicalSlotId(raw);
        if (!canonical || seen.has(canonical)) { return; }
        const satisfied = isPair
            ? canonical.split('|').some((member) => isSlotSatisfied(member, evidence))
            : isSlotSatisfied(canonical, evidence);
        if (satisfied) { return; }
        seen.add(canonical);
        missing.push(describeSlot(canonical));
    });
    return missing;
}

/**
 * The gate. Throws DocumentRequirementError (422) when the server cannot see a
 * document the law demands; returns quietly otherwise.
 *
 * @param {object} params
 * @param {object} params.application application row — needs id, entityId, formData
 * @param {'first-submit'|'resubmit'} params.mode decided by the DOOR, never here
 * @param {object} [params.client] prisma client or transaction handle
 * @returns {Promise<{appliedRules: object[], requiredSlotIds: string[], grandfathered: boolean}>}
 */
async function assertRequiredDocumentsPresent({
    application, mode, client = prisma, holderScope = null, previousFormData = null,
} = {}) {
    if (mode !== MODE_FIRST_SUBMIT && mode !== MODE_RESUBMIT) {
        throw new Error(
            `application-document-requirements: mode must be '${MODE_FIRST_SUBMIT}' or '${MODE_RESUBMIT}' (got ${JSON.stringify(mode)})`,
        );
    }

    const formData = formDataOf(application);
    let appliedRules = [];
    let requiredSlotIds = [];
    let grandfathered = false;

    if (mode === MODE_RESUBMIT) {
        const stamp = formData.serverRequirementSnapshot;
        if (!isPlainObject(stamp) || !Array.isArray(stamp.slotIds)) {
            // Filed before M2a existed: there is no record of which law it was
            // judged by, and inventing one now would apply today's rules to a
            // filing that was compliant when it was made (the exact thing AC3
            // forbids). Let it through, and count it — the warn is the drain
            // signal that says how long this branch still has to live.
            logger.warn(
                `[M2a] resubmit without a requirement snapshot — grandfathered (application ${application?.id || 'unknown'})`,
            );
            grandfathered = true;
        } else {
            // กฎหมายตัดสินตราประทับเก่า (มติ operator 2026-10-05): controlled_herb_license ไม่ใช่เอกสารบังคับของชนิดใด
            // (ปลูกกัญชา = ไม่บังคับ · กระท่อม/อีกสี่ชนิด = ไม่มี · แปรรูปกัญชา = licence_pt11) ตราประทับที่ขอไว้เกินจึงไม่บล็อก
            requiredSlotIds = stamp.slotIds.filter((id) => getCanonicalSlotId(id) !== 'controlled_herb_license');
        }
        // ประตูแก้ไข: ตัดสิน formData ที่จะถูกเก็บจริง (หลัง merge) — คำที่ไม่รู้จักถูกปฏิเสธ
        // และวัตถุประสงค์ที่เพิ่มใหม่ต้องมีใบอนุญาตตามกฎหมายของชนิดนั้น
        const claimed = formData.certificationPurposes;
        if (Array.isArray(claimed)) {
            const verdict = assessPurposes(claimed);
            if (verdict.unknown.length > 0) {
                throw new ApplicationNotJudgeableError([{
                    code: BLOCKING_PURPOSE_INVALID,
                    messageTH: refusalMessageTh(),
                    detail: { unknown: verdict.unknown, accepted: PURPOSE_CODES },
                }]);
            }
            const before = new Set(Array.isArray(previousFormData?.certificationPurposes)
                ? previousFormData.certificationPurposes : []);
            const plant = asPlantSlug(formData.plantId || formData.plantType);
            // ไม่รู้ว่าของเดิมคืออะไร (ผู้เรียกไม่ส่งมา) = ไม่ตัดสินว่าอะไร "เพิ่มใหม่"
            (previousFormData ? claimed.filter((code) => !before.has(code)) : []).forEach((code) => {
                const slot = purposeLicenceSlotId(plant, code);
                if (slot) { requiredSlotIds = [...requiredSlotIds, getCanonicalSlotId(slot)]; }
            });
        }
    } else {
        // FIRST SUBMIT — read today's law THROUGH THE ONE LENS, then freeze it onto
        // the application. The gate used to ask the rule table its own question, with
        // two of the six dimensions and none of the conditions the table cannot
        // express, so the review page and this door could reach different answers for
        // one filing. They now read the same function.
        const holderType = await resolveHolderType(application, client);
        const documentRows = await client.applicationDocument.findMany({
            // A health door passes the applicant's holder scope (spec 2026-09-30
            // §3.1); staff and system callers pass none and keep this where.
            where: {
                applicationId: application.id,
                ...(holderScope && Array.isArray(holderScope.readIds)
                    ? require('./holder-access').holderReadWhere(holderScope, 'ApplicationDocument')
                    : {}),
            },
            // supersededAt travels with the type: a replaced row is history, never
            // evidence (see collectServerDocumentEvidence).
            select: { documentType: true, supersededAt: true },
        });
        const payload = await resolveApplicationRequirements(application, documentRows, {
            at: new Date(),
            client,
            // The holder the certificate would belong to is read from the ENTITY ROW,
            // not from formData: the applicant can retype the latter.
            holderType,
            // ยื่นจริงทุกประตู ต้องเลือกวัตถุประสงค์อย่างน้อยหนึ่งข้อ (ร่างว่างได้ ไม่ผ่านประตูนี้)
            requirePurpose: true,
        });
        // A row with isRequired:false is law that demands nothing — the lens already
        // dropped those, so nothing that reaches the stamp can refuse a resubmit for a
        // slot the first submit never had to carry.
        // Asked BEFORE the missing-document list, because the two refusals are not
        // alternatives: a filing whose plant has no filed law also has an empty required
        // list, and reporting "nothing is missing" — or "attach these" — would both be
        // answers to a question that was never answerable.
        if (payload.blockingIssues && payload.blockingIssues.length > 0) {
            throw new ApplicationNotJudgeableError(payload.blockingIssues);
        }

        appliedRules = payload.appliedRules;
        requiredSlotIds = payload.requiredSlotIds;

        if (payload.missingRequired.length > 0) {
            throw new DocumentRequirementError(payload.missingRequired.map(describeSlot));
        }
        return { appliedRules, requiredSlotIds, grandfathered };
    }

    if (requiredSlotIds.length > 0) {
        // RESUBMIT — judged by the stamp (AC3), never by today's law. Only the
        // evidence side is re-read, and it is read through the same families the lens
        // uses so a legacy upload keeps counting.
        const documentRows = await client.applicationDocument.findMany({
            // A health door passes the applicant's holder scope (spec 2026-09-30
            // §3.1); staff and system callers pass none and keep this where.
            where: {
                applicationId: application.id,
                ...(holderScope && Array.isArray(holderScope.readIds)
                    ? require('./holder-access').holderReadWhere(holderScope, 'ApplicationDocument')
                    : {}),
            },
            // supersededAt travels with the type: a replaced row is history, never
            // evidence (see collectServerDocumentEvidence).
            select: { documentType: true, supersededAt: true },
        });
        const missingSlots = missingFrom(requiredSlotIds, collectServerDocumentEvidence(application, documentRows));
        if (missingSlots.length > 0) {
            throw new DocumentRequirementError(missingSlots);
        }
    }

    return { appliedRules, requiredSlotIds, grandfathered };
}

/**
 * Entity.type of the holder the certificate would belong to.
 *
 * The entity is read from the APPLICATION ROW (never a request header) — the
 * same rule the submit guard follows. A row with no entityId is refused earlier
 * by that guard (400); if one ever reaches here, `null` means "no holder-type
 * dimension", i.e. only rules that bind everybody apply. Failing open on the
 * holder-specific rules is the safe direction: it cannot invent a demand that
 * the ministry did not make.
 */
async function resolveHolderType(application, client) {
    if (!application?.entityId) { return null; }
    const entity = await client.entity.findUnique({
        where: { id: application.entityId },
        select: { type: true },
    });
    return entity?.type || null;
}

module.exports = {
    collectServerDocumentEvidence,
    assertRequiredDocumentsPresent,
    buildRequirementSnapshot,
    DocumentRequirementError,
    ApplicationNotJudgeableError,
    isSubmitGateRefusal,
    respondSubmitGateRefusal,
    MODE_FIRST_SUBMIT,
    MODE_RESUBMIT,
};
