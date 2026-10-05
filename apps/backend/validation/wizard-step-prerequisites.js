'use strict';

/**
 * The wizard's step-exit bar, on the server.
 *
 * F-G4-11 (2026-08-26). The wizard is nine numbered URLs and the client used to
 * be the only thing deciding which of them a farmer had earned. Editing the
 * address bar walked straight past that decision, and so did anything that
 * spoke to the API directly — the URL is one door, the API is the other.
 *
 * This module is the API side of that decision. It answers exactly one
 * question: given the canonical wizard data a caller is holding, which step is
 * the FIRST one they have not finished? Everything else (refuse, clamp, report)
 * is the route's business.
 *
 * ── The bar is the step-EXIT bar, not the submit bar ──
 * `validation/canonical-application-validator.js` holds the SUBMIT bar: every
 * field the ministry needs on a filed application (province, plot solar system,
 * drying method, area units…). That bar is deliberately higher. Judging a
 * draft-in-progress by it would refuse a farmer who is legitimately standing on
 * step 6 with a plot that has no solar system yet, so this module asks only
 * what the step's own UI asks before it lets you press "ถัดไป".
 *
 * Consequence worth stating plainly: anything this module refuses, the submit
 * validator would refuse too. It is strictly the looser of the two, so it can
 * never reject a filing that would otherwise have been accepted.
 *
 * ── Twin of the client rule ──
 * The browser has the same table in
 * `apps/web-app/src/app/health/applications/new/_steps/hooks/use-application-flow-store.ts`
 * (`isStepComplete` / `firstIncompleteStep`). It has to: the wizard must gate
 * navigation offline, before any save reaches this server. The two are written
 * against the same canonical field names and must move together. There is no
 * shared module because the backend is CommonJS at runtime and cannot require
 * the web app's TypeScript; `__tests__/unit/wizard-step-prerequisites.test.js`
 * pins this table field-for-field so a drift shows up as a failing test rather
 * than as a farmer who cannot save.
 */

const FLOW_STEP_NUMBERS = Object.freeze([1, 2, 4, 5, 6, 7, 8, 9]);
const LAST_FLOW_STEP = FLOW_STEP_NUMBERS[FLOW_STEP_NUMBERS.length - 1];

/** Slot 3 was merged into slot 2 and slot 11 into slot 10; the numbers stayed. */
const VACANT_FLOW_SLOTS = Object.freeze([3]);

/**
 * The steps this server actually judges — step 1 is deliberately absent.
 *
 * Step 1 is consent, and consent is the one step whose answer the wizard blob
 * is not the source of. Neither /prepare payload the wizard sends carries
 * `consentedPDPA` or `acknowledgedStandards` (review-step.tsx and
 * submit-step.tsx both omit them), so a server that judged step 1 from
 * formData would refuse EVERY real applicant — the same trap
 * canonical-application-validator.js was written to undo (C2).
 *
 * Nothing is lost by the omission. The server's consent authority is the
 * consent record captured at registration, enforced by the `requireConsent`
 * middleware on POST /submit; a checkbox echoed back inside formData was never
 * evidence of anything. The browser keeps judging step 1 because it holds the
 * checkbox state and can.
 */
const SERVER_JUDGED_STEP_NUMBERS = Object.freeze(FLOW_STEP_NUMBERS.filter((step) => step !== 1));

function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function filled(value) {
    if (value === null || value === undefined) { return false; }
    if (typeof value === 'string') { return value.trim().length > 0; }
    if (Array.isArray(value)) { return value.length > 0; }
    return true;
}

/**
 * Step 8's bar counts documents from either place the wizard can put them:
 * `formData.documents` (the store's own list, posted with the draft) and
 * `formData.draftDocuments` (written by POST /applications/draft-documents).
 * Counting only one of them would refuse a farmer who uploaded through the
 * other, so both count.
 */
function hasAnyDocument(formData) {
    const inline = asArray(formData.documents).filter((doc) => asObject(doc).uploaded === true);
    if (inline.length > 0) { return true; }
    return asArray(formData.draftDocuments).length > 0;
}

/**
 * Is the data needed to LEAVE `stepNumber` present in `formData`?
 *
 * @param {object} formDataInput canonical wizard formData (camelCase)
 * @param {number} stepNumber    URL step number (1, 2, 4..9)
 * @returns {boolean}
 */
function isStepComplete(formDataInput, stepNumber) {
    const formData = asObject(formDataInput);

    switch (stepNumber) {
        case 1:
            // Consent only. The step-1 screen collects nothing else — service
            // type and purposes moved to step 2 — so asking for more here would
            // hard-lock every new applicant on step 1.
            return Boolean(formData.consentedPDPA) && Boolean(formData.acknowledgedStandards);
        case 2:
            return filled(formData.plantId)
                && filled(formData.serviceType)
                && asArray(formData.certificationPurposes).length > 0
                && asArray(formData.cultivationMethods).length > 0;
        case 3:
            // Vacant slot. Complete by definition so deep links to 4..9 resolve.
            return true;
        case 4: {
            const applicant = asObject(formData.applicantData);
            const applicantType = String(applicant.applicantType || '').trim();
            if (!applicantType) { return false; }
            if (applicantType === 'INDIVIDUAL') {
                return filled(applicant.firstName) && filled(applicant.lastName) && filled(applicant.idCard);
            }
            if (applicantType === 'COMMUNITY') {
                return filled(applicant.communityName) && filled(applicant.presidentName);
            }
            if (applicantType === 'JURISTIC') {
                return filled(applicant.companyName) && filled(applicant.taxId);
            }
            return false;
        }
        case 5: {
            const farm = asObject(formData.farmData);
            return filled(farm.farmName) && filled(farm.address) && asArray(formData.plots).length > 0;
        }
        case 6: {
            const production = asObject(formData.productionData);
            return asArray(production.propagationType).length > 0 && asArray(production.plantParts).length > 0;
        }
        case 7:
            return filled(asObject(formData.harvestData).harvestMethod);
        case 8:
            return hasAnyDocument(formData);
        case 9:
            // Review reads; it collects nothing of its own.
            return true;
        default:
            return false;
    }
}

/**
 * The first step the holder of this data still owes, in URL numbers.
 * Returns 9 (the review step) once steps 1-8 are all satisfied.
 *
 * @param {object} formDataInput canonical wizard formData
 * @returns {number}
 */
function firstIncompleteStep(formDataInput) {
    const formData = asObject(formDataInput);
    for (const stepNumber of SERVER_JUDGED_STEP_NUMBERS) {
        if (!isStepComplete(formData, stepNumber)) { return stepNumber; }
    }
    return LAST_FLOW_STEP;
}

/**
 * Judge a caller's claim to be working on `requestedStep`.
 *
 * @param {object} formDataInput canonical wizard formData the caller holds
 * @param {number} requestedStep the step the caller says it is on
 * @returns {{ allowedStep: number, requestedStep: (number|null), earned: boolean }}
 *          `earned` is false only when the claim runs AHEAD of the data. A
 *          claim to a step at or behind the frontier is always earned — going
 *          back to a finished step is legitimate and must never be refused.
 */
function evaluateStepClaim(formDataInput, requestedStep) {
    const allowedStep = firstIncompleteStep(formDataInput);
    const step = Number.parseInt(String(requestedStep), 10);
    if (!Number.isFinite(step)) {
        return { allowedStep, requestedStep: null, earned: true };
    }
    return { allowedStep, requestedStep: step, earned: step <= allowedStep };
}

/**
 * The refusal a farmer reads. Names the step that is actually blocking and the
 * single action that unblocks it — a bare "ข้อมูลไม่ถูกต้อง" tells them nothing
 * they can act on.
 */
function stepPrerequisiteMessage(requestedStep, allowedStep) {
    return `คุณยังกรอกข้อมูลขั้นตอนที่ ${allowedStep} ไม่ครบ จึงยังบันทึกข้อมูลของขั้นตอนที่ ${requestedStep} ไม่ได้ `
        + `กรุณากลับไปกรอกขั้นตอนที่ ${allowedStep} ให้ครบก่อน`;
}

module.exports = {
    FLOW_STEP_NUMBERS,
    SERVER_JUDGED_STEP_NUMBERS,
    LAST_FLOW_STEP,
    VACANT_FLOW_SLOTS,
    isStepComplete,
    firstIncompleteStep,
    evaluateStepClaim,
    stepPrerequisiteMessage,
};
