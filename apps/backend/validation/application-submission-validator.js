'use strict';

/**
 * Shared submission-completeness gate.
 *
 * Task-3 fix round 1 (Ruling 7, 2026-08-18): extracted verbatim from
 * `routes/api/applications/applications.js`'s POST /submit handler (the
 * `hasLegacyMasterStepPayload` branch), which previously carried this
 * decision inline. The revision door (`PUT /:id/revision` →
 * `application-review-revision-methods.js`) let a DRAFT resubmit reach
 * PENDING_DOC_FEE — and mint price-of-record quotations
 * (`quotation-service.js`, read with no status filter by
 * `getFrozenPhaseFees`) — without ever running this check, so an incomplete
 * filing could sail through a door the front door 422s at. Both doors now
 * call this ONE function instead of each carrying (or duplicating) the
 * decision (the project rules L4 — dup-source ratchet).
 *
 *   LEGACY step-keyed payloads ({ steps: { 1..9 } }, snake-case) validate
 *   through the snake-case Zod `validateAllSteps`. CANONICAL payloads (the
 *   live wizard: { applicantData, farmData, plots, … } with no step-keys)
 *   validate through `validateCanonicalSubmission` instead — feeding a
 *   canonical payload to `validateAllSteps` would see {} and 422 every real
 *   submit (the C2 bug this mirrors; see canonical-application-validator.js).
 */
const { mergeMasterSteps, MASTER_STEPS, asObject } = require('../routes/api/helpers/application-constants');
const { normalizeDocuments } = require('../routes/api/preview/preview-utils');
const { validateAllSteps } = require('./application-schemas');
const { validateCanonicalSubmission } = require('./canonical-application-validator');

/**
 * @param {object} params
 * @param {object} params.currentFormData - the application's stored formData
 * @param {object} params.payload - the caller's request body (new step data,
 *        merged onto currentFormData the same way the front door does)
 * @param {object} params.application - the application row (normalizeDocuments
 *        reads its `.attachments`)
 * @returns {{ isValid: true } | { isValid: false, errorsByStep: object, missingFields?: string[] }}
 */
function validateSubmissionPayload({ currentFormData, payload, application }) {
    const mergedSteps = mergeMasterSteps(currentFormData, payload);
    const hasLegacyMasterStepPayload = MASTER_STEPS.some((stepNo) => {
        const stepData = asObject(mergedSteps[String(stepNo)]);
        return Object.keys(stepData).length > 0;
    });

    if (hasLegacyMasterStepPayload) {
        const zodResult = validateAllSteps(mergedSteps);
        return zodResult.isValid
            ? { isValid: true }
            : { isValid: false, errorsByStep: zodResult.errorsByStep };
    }

    const normalizedDocuments = normalizeDocuments(currentFormData, application);
    const canonicalResult = validateCanonicalSubmission(currentFormData, normalizedDocuments);
    return canonicalResult.isValid
        ? { isValid: true }
        : { isValid: false, errorsByStep: canonicalResult.errorsByStep, missingFields: canonicalResult.missingFields };
}

module.exports = { validateSubmissionPayload };
