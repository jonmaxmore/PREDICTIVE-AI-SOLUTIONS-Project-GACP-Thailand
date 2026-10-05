/**
 * Ownership rules for the shared `formData` JSON blob.
 *
 * Application.formData and ApplicationDraft.formData are single JSON columns
 * written by TWO different parties:
 *
 *   • the APPLICANT, through the wizard — their own answers (applicantData,
 *     farmData, plantName, certificationPurposes, steps, …)
 *   • the SERVER and PROVIDER STAFF — records that downstream code later reads
 *     back as FACTS (the audit outcome, who is assigned to audit, SLA
 *     deadlines, admin overrides, the list of stored upload paths)
 *
 * Because it is one blob, an applicant-facing endpoint that spreads the request
 * body into it hands the applicant a pen for the second category too. That is
 * not a theoretical concern: certificate-service.js reads
 * `formData.auditResult === 'PASS'` plus `formData.auditedAt` and accepts the
 * pair as proof of a passing audit, and the (since deleted) wizard-controller.js
 * read `formData.uploadedDocuments[].filePath` and passed it to fs.unlink().
 *
 * ONE DIRECTION: keys listed here flow server -> client only. Applicant input
 * never writes them; it is stripped at the edge, so the value already recorded
 * by the server survives untouched. There is no second rule, no per-route
 * exception list, and no re-derivation further down the call stack.
 *
 * Adding a key here is always safe. Removing one needs proof that no
 * authorization, money or filesystem decision reads it.
 */

'use strict';

/**
 * Keys an applicant may never write into formData.
 *
 * Grouped by who owns them and what breaks if an applicant can forge one.
 */
const SERVER_OWNED_FORM_DATA_KEYS = Object.freeze([
    // Lifecycle position. Read as the application's true state by workflow code.
    'workflowState',

    // กทล.๑ ส่วนที่ ๔ — WHEN the applicant certified the filing. The client may say
    // "accepted"; it may not say when, because a timestamp the browser supplied is
    // evidence of nothing about a person. An applicant who could write this key
    // through /prepare could file today and date the certification last year, or
    // let a stale draft carry a time nobody was at the keyboard for. The submit
    // door stamps it (services/application-declarations-gate.js).
    'declarationsAcceptedAt',

    // Audit outcome — certificate-service.js accepts auditResult + auditedAt as
    // proof of a passing audit, one of the two gates on issuing a certificate.
    'auditResult',
    'auditedAt',
    'auditExecution',
    'auditSchedule',
    'auditMode',

    // Who audits this application, and any approved reschedules.
    'PROVIDERAssignment',
    'rescheduleRequests',

    // SLA deadlines. Applicant-set deadlines are self-granted extensions.
    'carDueAt',
    'car_due_at',
    'revisionDueAt',
    'revision_due_at',

    // Staff escape hatches.
    'adminOverrides',

    // Stored upload records. filePath / s3Key from here reach fs.unlink() and
    // storageService.deleteObject(), so a forged entry is arbitrary deletion.
    'uploadedDocuments',
    'draftDocuments',

    // M2 — what the SERVER concluded about this filing's documents, written at
    // the submit doors and read back as fact afterwards:
    //   serverRequirementSnapshot — which requirement rules judged this filing,
    //     stamped at first submit. Every later resubmit (CAR / revision /
    //     revision-deadline / bundle) is judged against THIS list, so an
    //     applicant who could write it would choose the law that judges them.
    //   serverVaultSnapshot — which entity-vault documents were used (M2b).
    //     Declared here now, with the key it will be written under, so the
    //     ownership rule exists before the first writer does rather than after.
    'serverRequirementSnapshot',
    'serverVaultSnapshot',

    // WHICH FARM THIS FILING IS ABOUT (F-QA-06). Written by the submit door when it
    // materialises the Farm row from the applicant's own site answers, and read back as
    // a fact by certificate issuance — it is the FIRST thing
    // resolveFarmForCertificate looks at, and it decides which farm a certificate names.
    // The resolver already scopes the id to the applicant's own entity/owner before it
    // trusts it, so a forged value could never reach someone else's land; it is
    // server-owned so that an applicant cannot repoint their own filing at a different
    // farm than the one their submitted site described, and so a door that REPLACES
    // formData wholesale lays the stored value back on top instead of dropping it.
    'farmId',

    // Renewal linkage, written by renewal-service from a verified certificate.
    'renewalOf',
    'renewalOfCertificateNumber',
    'renewalOfExpiryDate',
    'renewalReminders',

    // WHICH LAW JUDGES THIS FILING (กทล.1 v2, spec 2026-09-01 §2.1).
    //
    // requestType and certScope are dimensions of the requirement engine, and both
    // of them can REMOVE requirements: a filing that says REPLACEMENT is judged by
    // the two replacement rows instead of the whole ส่วนที่ ๓ set, and PLANTING skips
    // the controlled-herb licence that PROCESSING carries. An applicant who could
    // write them would be choosing the law that judges them — the same reason
    // serverRequirementSnapshot is on this list.
    //
    // So they are server-owned from the day the key exists rather than from the day
    // someone notices. The wizard asks the question (T5); the door that accepts the
    // answer is what writes it, after checking it — for a renewal or a replacement
    // that means a previous certificate the platform itself issued.
    'requestType',
    'replacementOf',
    'certScope',

    // WHO IS APPLYING (spec 2026-09-30-remove-workspace-mode §3.2). The draft door
    // writes it once, at create, from the holder's own Entity.type, so the type the
    // paper declares and the holder the certificate names can never disagree on a
    // new filing (F-HOLDER-01). An applicant who could write it could declare a
    // company on a person's draft, or the reverse; changing the holder means
    // deleting the draft and starting a new one (M2 G7).
    'applicantType',
]);

const SERVER_OWNED_KEY_SET = new Set(SERVER_OWNED_FORM_DATA_KEYS);

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Drop every server-owned key from an applicant-supplied payload.
 *
 * Use when merging INTO an existing blob — the surviving keys keep whatever the
 * server last wrote, because the applicant's version never enters the spread.
 *
 * @param {unknown} payload applicant-supplied object (anything else -> {})
 * @returns {object} a copy carrying only applicant-writable keys
 */
function stripServerOwnedKeys(payload) {
    if (!isPlainObject(payload)) {
        return {};
    }
    const safe = {};
    for (const key of Object.keys(payload)) {
        if (!SERVER_OWNED_KEY_SET.has(key)) {
            safe[key] = payload[key];
        }
    }
    return safe;
}

/**
 * Pull the server-owned keys back out of the blob currently stored.
 *
 * Use when an endpoint REPLACES formData wholesale instead of merging: the
 * client's blob is stripped, then the stored server-owned values are laid back
 * on top so a full replacement cannot erase or rewrite them.
 *
 * @param {unknown} existingFormData the blob currently in the database
 * @returns {object} only the server-owned keys that are actually present
 */
function pickServerOwnedKeys(existingFormData) {
    if (!isPlainObject(existingFormData)) {
        return {};
    }
    const owned = {};
    for (const key of SERVER_OWNED_FORM_DATA_KEYS) {
        if (Object.prototype.hasOwnProperty.call(existingFormData, key)) {
            owned[key] = existingFormData[key];
        }
    }
    return owned;
}

/**
 * Full-replacement merge: applicant keys from the client, server-owned keys
 * from the database. The one call an endpoint needs when it overwrites
 * formData rather than merging into it.
 *
 * @param {unknown} existingFormData blob currently stored
 * @param {unknown} clientFormData blob supplied by the applicant
 * @returns {object}
 */
function applyClientFormData(existingFormData, clientFormData) {
    return {
        ...stripServerOwnedKeys(clientFormData),
        ...pickServerOwnedKeys(existingFormData),
    };
}

/**
 * The formData that WILL be stored when a client resubmits over a stored blob: stored answers
 * the client did not resend are kept, the client's applicant keys win, server-owned keys come
 * from the database. One definition so a judge reads exactly what the writer will write.
 */
function mergeClientFormData(existingFormData, clientFormData) {
    return {
        ...(isPlainObject(existingFormData) ? existingFormData : {}),
        ...applyClientFormData(existingFormData, clientFormData),
    };
}

module.exports = {
    mergeClientFormData,
    SERVER_OWNED_FORM_DATA_KEYS,
    stripServerOwnedKeys,
    pickServerOwnedKeys,
    applyClientFormData,
};
