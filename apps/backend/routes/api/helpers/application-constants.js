/**
 * Application Constants & Pure Utility Functions
 *
 * Extracted from applications.js to comply with ≤ 300 line rule.
 * Contains all constants, step definitions, status mappings, and
 * pure helper functions with zero I/O dependencies.
 *
 * @module routes/api/helpers/application-constants
 */

const crypto = require('crypto');
const { CANONICAL_ROLES } = require('../../../shared/canonical-rbac');
const { WORKFLOW_STATES } = require('../../../services/workflow-transition-service');
const { localYear } = require('../../../utils/working-days');

// Master Step Required Fields (Steps 1-9)

const MASTER_STEP_REQUIRED_FIELDS = Object.freeze({
    1: {
        operator_name: ['operator_name', 'operatorName'],
        tax_id: ['tax_id', 'taxId'],
        address_contact: ['address_contact', 'addressContact'],
        phone_no: ['phone_no', 'phoneNo', 'phone'],
        email: ['email'],
        operator_type: ['operator_type', 'operatorType'],
    },
    2: {
        plot_name: ['plot_name', 'plotName'],
        land_title_no: ['land_title_no', 'landTitleNo'],
        area_rai: ['area_rai', 'areaRai'],
        area_ngan: ['area_ngan', 'areaNgan'],
        area_sq_wa: ['area_sq_wa', 'areaSqWa'],
        lat: ['lat', 'latitude'],
        long: ['long', 'lng', 'longitude'],
        surrounding_environment: ['surrounding_environment', 'surroundingEnvironment'],
    },
    3: {
        herb_type_id: ['herb_type_id', 'herbTypeId'],
        botanical_name: ['botanical_name', 'botanicalName'],
        strain_name: ['strain_name', 'strainName'],
        material_source: ['material_source', 'materialSource'],
        source_location: ['source_location', 'sourceLocation'],
        lot_number: ['lot_number', 'lotNumber'],
    },
    4: {
        water_source_type: ['water_source_type', 'waterSourceType'],
        irrigation_method: ['irrigation_method', 'irrigationMethod'],
        soil_preparation_method: ['soil_preparation_method', 'soilPreparationMethod'],
        soil_analysis_date: ['soil_analysis_date', 'soilAnalysisDate'],
        water_analysis_date: ['water_analysis_date', 'waterAnalysisDate'],
    },
    5: {
        fertilizer_type: ['fertilizer_type', 'fertilizerType'],
        fertilizer_schedule: ['fertilizer_schedule', 'fertilizerSchedule'],
        pest_control_method: ['pest_control_method', 'pestControlMethod'],
        weed_control_method: ['weed_control_method', 'weedControlMethod'],
        input_usage_history: ['input_usage_history', 'inputUsageHistory'],
    },
    6: {
        harvest_criteria: ['harvest_criteria', 'harvestCriteria'],
        harvest_method: ['harvest_method', 'harvestMethod'],
        equipment_sanitation: ['equipment_sanitation', 'equipmentSanitation'],
        harvest_time_of_day: ['harvest_time_of_day', 'harvestTimeOfDay'],
    },
    7: {
        cleaning_method: ['cleaning_method', 'cleaningMethod'],
        drying_method: ['drying_method', 'dryingMethod'],
        sorting_criteria: ['sorting_criteria', 'sortingCriteria'],
        moisture_content_target: ['moisture_content_target', 'moistureContentTarget'],
    },
    8: {
        packaging_material_type: ['packaging_material_type', 'packagingMaterialType'],
        storage_condition: ['storage_condition', 'storageCondition'],
        warehouse_pest_control: ['warehouse_pest_control', 'warehousePestControl'],
        stock_management_system: ['stock_management_system', 'stockManagementSystem'],
    },
    9: {
        traceability_code_format: ['traceability_code_format', 'traceabilityCodeFormat'],
        internal_audit_date: ['internal_audit_date', 'internalAuditDate'],
        sample_retention_period: ['sample_retention_period', 'sampleRetentionPeriod'],
        complaint_handling_procedure: ['complaint_handling_procedure', 'complaintHandlingProcedure'],
    },
});

const MASTER_STEPS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

// Tracking Steps & Status Mappings

const TRACKING_STEPS = Object.freeze([
    { step: 1, key: 'SUBMITTED', label: 'Submitted' },
    { step: 2, key: 'PENDING_DOC_FEE', label: 'Awaiting instalment 1 payment' },
    { step: 3, key: 'DOC_REVIEWING', label: 'Document review in progress' },
    { step: 4, key: 'REVISION_REQUESTED', label: 'Revision required' },
    { step: 5, key: 'DOC_APPROVED', label: 'Document approved' },
    { step: 6, key: 'PENDING_AUDIT_FEE', label: 'Awaiting service fee payment' },
    { step: 7, key: 'AUDIT_SCHEDULING', label: 'Audit scheduling' },
    { step: 8, key: 'CAR_PENDING', label: 'Field audit / CAR pending' },
    { step: 9, key: 'FINAL_REVIEW', label: 'Final approval review' },
    { step: 10, key: 'CERTIFIED', label: 'Certified' },
]);

/**
 * Raw workflow state → applicant-facing display bucket.
 *
 * Values are display *keys*, never prose. The frontend owns the wording
 * (apps/web-app/src/lib/constants/workflow-states.ts STATUS_LABELS plus the
 * display-only aliases in application-detail-page-config.ts STATUS_META), so
 * a Thai string here would be a second, un-translatable copy — and, because
 * it is not a key of STEP_BY_DISPLAY_STATUS, it also silently dropped the
 * progress ladder to 0 for anyone waiting on a payment-slip review.
 *
 * Several states deliberately collapse many-to-one: that is a product
 * decision (an applicant does not need to know whether their file has been
 * *assigned* to a reviewer yet, only that it is under review). The collapse
 * is why this map cannot be derived from the SSOT and must be maintained by
 * hand — which is what assertDisplayMapsAreTotal() below guards.
 */
const DISPLAY_STATUS_BY_RAW_STATUS = Object.freeze({
    DRAFT: 'DRAFT',
    // Legacy DB value, not a canonical workflow state. Retained so rows
    // written before the SSOT landed still render.
    REGISTERED: 'DRAFT',
    SUBMITTED: 'SUBMITTED',
    PENDING_DOC_FEE: 'PENDING_DOC_FEE',
    DOC_FEE_PAID: 'DOC_REVIEWING',
    ASSIGNED_FOR_REVIEW: 'DOC_REVIEWING',
    REVISION_REQUESTED: 'REVISION_REQUESTED',
    DOC_APPROVED: 'DOC_APPROVED',
    PENDING_AUDIT_FEE: 'PENDING_AUDIT_FEE',
    AUDIT_FEE_PAID: 'AUDIT_SCHEDULING',
    AUDIT_CONFIRMED: 'AUDIT_SCHEDULING',
    CAR_PENDING: 'CAR_PENDING',
    CAR_REVIEWING: 'CAR_PENDING',
    AUDIT_PASSED: 'FINAL_REVIEW',
    APPROVED: 'FINAL_REVIEW',
    CERTIFIED: 'CERTIFIED',
    REJECTED: 'REJECTED',
    EXPIRED: 'EXPIRED',
    CANCEL_EXPIRED: 'CANCEL_EXPIRED',
});

/**
 * Display buckets that close the case. The tracking ladder does not apply to
 * them — they are not "step 0, nothing done yet", they are "this file is
 * finished". Callers must read the `terminal` flag rather than inferring
 * closure from the step number, which DRAFT also occupies.
 */
const TERMINAL_DISPLAY_STATUSES = Object.freeze(new Set([
    'REJECTED',
    'EXPIRED',
    'CANCEL_EXPIRED',
]));

const STEP_BY_DISPLAY_STATUS = Object.freeze({
    DRAFT: 0,
    SUBMITTED: 1,
    PENDING_DOC_FEE: 2,
    DOC_REVIEWING: 3,
    REVISION_REQUESTED: 4,
    DOC_APPROVED: 5,
    PENDING_AUDIT_FEE: 6,
    AUDIT_SCHEDULING: 7,
    CAR_PENDING: 8,
    FINAL_REVIEW: 9,
    CERTIFIED: 10,
    // Terminal — see TERMINAL_DISPLAY_STATUSES.
    REJECTED: 0,
    EXPIRED: 0,
    CANCEL_EXPIRED: 0,
});

/**
 * Load-time exhaustiveness check — the JavaScript stand-in for a TypeScript
 * `never` guard on a discriminated union.
 *
 * Both defects PR 2a fixes were "a state was added to the SSOT and nobody
 * updated the projection", which stayed invisible because every lookup was
 * written `map[key] || fallback`. Failing at require() turns that class of
 * mistake into a boot failure in CI instead of raw enum keys on a farmer's
 * screen.
 */
function assertDisplayMapsAreTotal() {
    const problems = [];

    for (const state of WORKFLOW_STATES) {
        if (!Object.prototype.hasOwnProperty.call(DISPLAY_STATUS_BY_RAW_STATUS, state)) {
            problems.push(`workflow state ${state} has no DISPLAY_STATUS_BY_RAW_STATUS entry`);
        }
    }

    for (const [state, bucket] of Object.entries(DISPLAY_STATUS_BY_RAW_STATUS)) {
        if (!/^[A-Z][A-Z0-9_]*$/.test(bucket)) {
            problems.push(`display bucket for ${state} must be a key, got prose: ${bucket}`);
        }
        if (!Object.prototype.hasOwnProperty.call(STEP_BY_DISPLAY_STATUS, bucket)) {
            problems.push(`display bucket ${bucket} has no STEP_BY_DISPLAY_STATUS entry`);
        }
    }

    if (problems.length > 0) {
        throw new Error(`[application-constants] status display maps are not total:\n  - ${problems.join('\n  - ')}`);
    }
}

assertDisplayMapsAreTotal();

const AUDITOR_ROLES = new Set([
    CANONICAL_ROLES.DOCUMENT_REVIEWER,
    CANONICAL_ROLES.FIELD_INSPECTOR,
    // HEAD_AUDITOR removed — consolidated into AUDITOR
]);

const REJECTABLE_STATUSES = new Set(['ASSIGNED_FOR_REVIEW', 'CAR_REVIEWING']);
const REVISION_DECISION_TYPES = new Set(['DOC_REVISION', 'FIELD_CAR']);

// Pure Utility Functions

function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function hasValue(value) {
    if (value === null || value === undefined) { return false; }
    if (typeof value === 'number') { return Number.isFinite(value); }
    if (typeof value === 'boolean') { return true; }
    if (typeof value === 'string') { return value.trim().length > 0; }
    if (Array.isArray(value)) { return value.length > 0; }
    if (typeof value === 'object') { return Object.keys(value).length > 0; }
    return false;
}

function upper(value) {
    return String(value || '').trim().toUpperCase();
}

function getFirstPresentValue(data, aliases = []) {
    for (const key of aliases) {
        if (hasValue(data[key])) {
            return data[key];
        }
    }
    return null;
}

function ensureApplicationNumber(prefix = 'APP') {
    const year = localYear() + 543; // Bangkok year
    const shortTs = Date.now().toString(36).toUpperCase();
    const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `${prefix}-${year}-${shortTs}-${rand}`;
}

function isMissingApplicationCommentsTableError(error) {
    const message = String(error?.message || '');
    return error?.code === 'P2021' && message.includes('application_comments');
}

function normalizeStepPayload(stepPayload) {
    const payload = asObject(stepPayload);
    const candidateFiles = [
        payload.files,
        payload.documents,
        payload.attachments,
        payload.evidence_files,
        payload.evidenceFiles,
        payload.mandatoryFiles,
        payload.mandatory_files,
    ];
    const files = candidateFiles.find((entry) => Array.isArray(entry)) || [];
    return {
        ...payload,
        files: files.map((item) => item),
    };
}

/**
 * formData keys the WIZARD owns — the complete set POST /draft's autosave is
 * allowed to write, and the reason the autosave stopped throwing work away.
 *
 * WHAT GOVERNS THIS LIST
 * `formData` is ONE JSON blob written by two parties (see
 * shared/form-data-ownership.js): the applicant, through the wizard, and the
 * server/provider staff, whose entries downstream code later reads back as
 * FACTS — the audit outcome, the auditor assignment, SLA deadlines, the stored
 * upload records, the requirement snapshot that decides which law judges this
 * filing. So the autosave cannot merge `payload.formData` wholesale.
 *
 * ALLOWLIST, NOT DENYLIST. A denylist fails OPEN the day someone adds a
 * server-owned field and forgets to list it; this fails CLOSED — an unlisted
 * key costs the farmer one re-entry, and that is the direction to fail in when
 * the alternative is an applicant writing their own price or their own status.
 *
 * ADDING A WIZARD FIELD? Add its key here too, or it will round-trip as empty
 * after a reload — that is the whole defect this list exists to fix (walk
 * ledger F-G4-14: eleven uploads answered 200 and came back blank). The key
 * must be one the wizard owns end-to-end; a key ANY server or staff path
 * writes belongs in SERVER_OWNED_FORM_DATA_KEYS instead, and the two lists may
 * never intersect (pinned by applications-draft-formdata-allowlist.test.js).
 *
 * Every key below is one the live autosave actually sends
 * (apps/web-app/src/app/health/applications/new/_steps/hooks/use-auto-save.ts)
 * AND one the detail payload hands back to the wizard for hydration
 * (application-payload-builders.js) — sent, stored, re-read, by the wizard only.
 *
 * MONEY (L3): the fee is not stored here and is not writable from here. Fees
 * are recomputed at read time by modules/billing from the applicant's own
 * DECLARATION of how they grow — cultivationMethods / plots / locationType —
 * which the wizard has always owned and which already reach formData through
 * POST /prepare and POST /submit. No amount, rate, quotation or invoice field
 * is on this list. `qrCount` / `estimatedQRCost` are money-SHAPED but are the
 * wizard's own on-screen estimate: no billing path reads them, only the
 * hydration payload echoes them back to the wizard that sent them.
 */
const WIZARD_OWNED_FORM_DATA_KEYS = Object.freeze([
    // What is being certified, and under which service.
    'plantId',
    'serviceType',
    'serviceTypes',
    'certificationPurpose',
    'certificationPurposes',
    'previousCertNumber',

    // กทล.1 ส่วนที่ ๑ + ๒ as the six-step wizard asks them (2026-09-06).
    //
    // ADDED after walking the wizard in a browser: every one of these was missing, and a
    // key that is not on this list is dropped SILENTLY — the save answers 200 and the
    // answer is gone. A filing could be typed in full and the stored application would not
    // know whether it was a new request or a renewal, who was applying, or what was being
    // grown. Nothing failed anywhere; the wizard's own unit tests all passed, because each
    // step was tested against its own props and never against this door.
    //
    // These are ANSWERS, not verdicts: the applicant declares them, the requirements lens
    // decides what they cost in paperwork, and the officer judges the result. Writable is
    // correct. `estimatedFee` stays off this list for the opposite reason — money is
    // derived from a dated rate table, never accepted from the client.
    //
    // `requestType` and `certScope` were briefly added here on 2026-09-06 and REMOVED the
    // same day: shared/form-data-ownership.js already owns them, and its comment says why —
    // both dimensions can REMOVE requirements (a filing claiming REPLACEMENT is judged by two
    // rows instead of the whole ส่วนที่ ๓ set; PLANTING skips the controlled-herb licence that
    // PROCESSING carries), so an applicant able to write them would be choosing the law that
    // judges them. The wizard asks those two questions; a door that CHECKS the answer is what
    // may write them, and that door does not exist yet — see the backlog F-APPV2-02.
    //
    // `applicantType` left this list on 2026-10-03 (R2 Task 8, spec 2026-09-30 §3.2): the
    // server writes it at create from the holder's Entity.type (form-data-ownership.js).
    'previousCertificateNumber',
    'varieties',
    'varietiesNote',
    'processing',

    // Who is applying, and the land they are applying for.
    'applicantData',
    'generalInfo',
    'farmData',
    'siteData',
    'siteTypes',
    'locationType',
    'plots',
    'lots',

    // How the crop is grown, harvested and secured.
    'cultivationMethod',
    'cultivationMethods',
    'cultivationDetails',
    'productionData',
    'harvestData',
    'securityData',
    'plantTracking',

    // The applicant's OWN paperwork checklist — the wizard's ticked boxes, not
    // evidence. services/application-document-requirements.js refuses to read
    // `documents` for exactly that reason: proof is `draftDocuments[]` (written
    // by the upload route, server-owned) and ApplicationDocument rows. Because
    // nothing authorizes off these, a forged tick buys nothing.
    'documents',
    'stepDocuments',
    'licensePdfUrl',
    'youtubeUrl',

    // Wizard-local QR estimate — see the MONEY note above.
    'qrCount',
    'estimatedQRCost',

    // Consent flags the applicant sets on themselves. The binding consent
    // record lives in its own table; these only drive the wizard's own UI.
    'consentedPDPA',
    'acknowledgedStandards',
]);

/**
 * The part of a client-supplied `formData` blob that may be written.
 *
 * Deliberately absent, though the blob may carry them:
 *   • `steps` — mergeMasterSteps owns it, and the step-claim gate in POST
 *     /draft judges step-scoped writes. Letting it through this door would be
 *     a second, ungated way to write the same thing.
 *   • `lastDraftStep` / `lastDraftSavedAt` / `lastPreparedAt` — the server's
 *     record of what it did; the handler stamps them after this merge.
 *   • every key in SERVER_OWNED_FORM_DATA_KEYS, plus the status/review facts
 *     (`submittedAt`, `workflowStateUpdatedAt`, `onsiteAuditId`, `reviewerName`,
 *     `reviewProgress`, `auditDecisions`, `_lastReviewComment`, …). Unlisted is
 *     unwritable, so no enumeration of them has to stay in sync.
 *
 * @param {unknown} clientFormData `payload.formData` as sent by the client
 * @returns {object} only the wizard-owned keys the client actually sent
 */
function pickWizardOwnedFormData(clientFormData) {
    const source = asObject(clientFormData);
    const picked = {};

    for (const key of WIZARD_OWNED_FORM_DATA_KEYS) {
        // hasOwnProperty, not truthiness: `false`, `0` and `[]` are answers a
        // farmer gave (an emptied plot list is an edit, not a missing field).
        if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
            picked[key] = source[key];
        }
    }

    return picked;
}

function mergeMasterSteps(existingFormData, inputPayload) {
    const formData = asObject(existingFormData);
    const payload = asObject(inputPayload);
    const currentSteps = asObject(formData.steps);
    const payloadSteps = asObject(payload.steps);
    const merged = { ...currentSteps };

    for (const [stepKey, stepValue] of Object.entries(payloadSteps)) {
        const normalizedStep = String(stepKey).trim();
        if (!normalizedStep) { continue; }
        merged[normalizedStep] = normalizeStepPayload(stepValue);
    }

    const explicitStep = Number.parseInt(String(payload.step || ''), 10);
    const stepData = asObject(payload.stepData || payload.data);
    if (Number.isFinite(explicitStep) && MASTER_STEPS.includes(explicitStep) && Object.keys(stepData).length > 0) {
        merged[String(explicitStep)] = normalizeStepPayload(stepData);
    }

    return merged;
}

function validateMasterSubmission(steps) {
    const stepMap = asObject(steps);
    const missingByStep = {};

    for (const stepNo of MASTER_STEPS) {
        const key = String(stepNo);
        const stepData = asObject(stepMap[key]);
        const fieldMap = MASTER_STEP_REQUIRED_FIELDS[stepNo] || {};
        const missingFields = [];

        for (const [canonicalField, aliases] of Object.entries(fieldMap)) {
            const value = getFirstPresentValue(stepData, aliases);
            if (!hasValue(value)) {
                missingFields.push(canonicalField);
            }
        }

        const stepFiles = asArray(stepData.files);
        if (stepFiles.length === 0) {
            missingFields.push('mandatory_files');
        }

        if (missingFields.length > 0) {
            missingByStep[key] = missingFields;
        }
    }

    return {
        isValid: Object.keys(missingByStep).length === 0,
        missingByStep,
    };
}

function buildStepResponse(formDataValue) {
    const formData = asObject(formDataValue);
    const stepMap = asObject(formData.steps);
    const response = {};

    for (const stepNo of MASTER_STEPS) {
        const key = String(stepNo);
        response[key] = normalizeStepPayload(asObject(stepMap[key]));
    }

    return response;
}

module.exports = {
    MASTER_STEP_REQUIRED_FIELDS,
    MASTER_STEPS,
    TRACKING_STEPS,
    DISPLAY_STATUS_BY_RAW_STATUS,
    STEP_BY_DISPLAY_STATUS,
    TERMINAL_DISPLAY_STATUSES,
    assertDisplayMapsAreTotal,
    AUDITOR_ROLES,
    REJECTABLE_STATUSES,
    REVISION_DECISION_TYPES,
    asObject,
    asArray,
    hasValue,
    upper,
    getFirstPresentValue,
    ensureApplicationNumber,
    isMissingApplicationCommentsTableError,
    normalizeStepPayload,
    WIZARD_OWNED_FORM_DATA_KEYS,
    pickWizardOwnedFormData,
    mergeMasterSteps,
    validateMasterSubmission,
    buildStepResponse,
};
