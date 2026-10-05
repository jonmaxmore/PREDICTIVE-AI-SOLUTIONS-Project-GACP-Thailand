'use strict';

/**
 * The application statuses in which the APPLICANT may still change the filing:
 * its draft fields and its draft documents (upload, replace, delete).
 *
 * One definition for the door that refuses the write
 * (routes/api/applications/applications.js findOrCreateApplicationForHealth →
 * 409 APPLICATION_NOT_EDITABLE) and for the requirements answer that tells the
 * wizard whether to offer the write at all (GET /applications/:id/requirements
 * `editable`, walk D3 2026-09-29). A screen may be less permissive than its
 * door, never more — which only holds if both read the same set.
 */
const APPLICANT_EDITABLE_STATUSES = Object.freeze(['DRAFT', 'REVISION_REQUESTED', 'CAR_PENDING']);

// A frozen ARRAY is exported, never the Set: Object.freeze on a Set leaves
// .add/.delete working, so a caller could widen the door for every other one.
const EDITABLE = new Set(APPLICANT_EDITABLE_STATUSES);

/** @param {unknown} status @returns {boolean} */
function isApplicantEditable(status) {
    return EDITABLE.has(String(status || '').toUpperCase());
}

module.exports = { APPLICANT_EDITABLE_STATUSES, isApplicantEditable };
