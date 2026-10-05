'use strict';

/**
 * Separation of duties between the document reviewer and the field inspector of ONE
 * application (operator ruling 2026-10-05): the person who read the papers must not be the
 * person who visits the farm, because then one judgement is counted twice.
 *
 * The comparison is by user id on the same application, not by role. A field_inspector may
 * still review the papers of application A and inspect application B; what is refused is
 * the same person on both sides of the same filing.
 *
 * Three points, because the pair can be completed from either side and then acted on:
 *   - assigning the reviewer  -> the person already assigned as inspector is refused
 *   - assigning the inspector -> the person already assigned as reviewer is refused
 *     (whichever assignment comes second is the one refused)
 *   - deciding                -> the person who is both, on a filing assigned before this
 *     rule existed, may not take either decision
 *
 * Each refusal is a catalogue error (shared/error-codes.js) with a Thai message. Thrown
 * errors carry { code, statusCode, messageTh } so route handlers answer them in one shape.
 */

const { lookup } = require('./error-codes');

function refuse(code) {
    const row = lookup(code);
    const err = new Error(row.messageEn);
    err.code = code;
    err.statusCode = row.httpStatus;
    err.messageTh = row.messageTh;
    err.isSeparationOfDuties = true;
    return err;
}

function samePerson(a, b) {
    return Boolean(a) && Boolean(b) && String(a) === String(b);
}

/** Assigning `reviewerId` as document reviewer of an application whose inspector is `auditorId`. */
function assertReviewerIsNotInspector({ reviewerId, auditorId } = {}) {
    if (samePerson(reviewerId, auditorId)) {
        throw refuse('REVIEWER_IS_APPLICATION_INSPECTOR');
    }
}

/** Assigning `auditorId` as inspector of an application whose document reviewer is `reviewerId`. */
function assertInspectorIsNotReviewer({ reviewerId, auditorId } = {}) {
    if (samePerson(reviewerId, auditorId)) {
        throw refuse('INSPECTOR_IS_APPLICATION_REVIEWER');
    }
}

/** `actorId` is about to decide (documents or inspection) on an application they hold both sides of. */
function assertDecisionNotByReviewerAndInspector({ actorId, reviewerId, auditorId } = {}) {
    if (samePerson(reviewerId, auditorId) && samePerson(actorId, reviewerId)) {
        throw refuse('DECISION_BY_REVIEWER_AND_INSPECTOR');
    }
}

/**
 * Answer a refusal from this module on an Express response; returns true when it did.
 * @param {object} res
 * @param {Error} err
 */
function answerSeparation(res, err) {
    if (!err || !err.isSeparationOfDuties) { return false; }
    res.status(err.statusCode).json({
        success: false,
        code: err.code,
        error: err.messageTh,
        message: err.message,
        messageTh: err.messageTh,
    });
    return true;
}

module.exports = {
    assertReviewerIsNotInspector,
    assertInspectorIsNotReviewer,
    assertDecisionNotByReviewerAndInspector,
    answerSeparation,
};
