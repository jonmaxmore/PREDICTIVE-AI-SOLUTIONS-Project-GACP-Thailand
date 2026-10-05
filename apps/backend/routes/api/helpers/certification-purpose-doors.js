'use strict';

/**
 * The two doors' answer to a purpose the register has no licence for (operator ruling
 * 2026-10-05): POST /applications/draft and POST /applications/submit. One refusal, one
 * code, one Thai sentence — kept out of applications.js so the door file stays a door.
 *
 * @module routes/api/helpers/certification-purpose-doors
 */

const { assessPurposes, refusalMessageTh, PURPOSE_CODES } = require('../../../shared/certification-purposes');

const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

/**
 * The one refusal for a purpose the register has no licence for (operator ruling
 * 2026-10-05). Both doors use it: a draft save and a submit answer in the same words.
 * `unknown` names what was refused so a caller can show it; nothing is mapped or renamed.
 */
function respondPurposeInvalid(res, { unknown = [], empty = false } = {}) {
    return res.status(400).json({
        success: false,
        error: 'CERTIFICATION_PURPOSE_INVALID',
        code: 'CERTIFICATION_PURPOSE_INVALID',
        message: refusalMessageTh(),
        messageTh: refusalMessageTh(),
        unknown,
        empty,
        accepted: PURPOSE_CODES,
    });
}

/**
 * What a DRAFT SAVE claims about purposes, judged only where the client actually said
 * something. An empty list is an unfinished wizard and is left alone (the submit door asks
 * for a choice); a non-empty list or a legacy single word must be in the vocabulary.
 *
 * @returns {{ unknown: string[] } | null} null when nothing the client sent is refused
 */
function refusedDraftPurposeClaim(payloadInput) {
    const payload = asObject(payloadInput);
    const claimed = asObject(payload.formData);
    const claims = [
        payload.certificationPurposes, claimed.certificationPurposes,
        payload.purpose, payload.certificationPurpose, claimed.certificationPurpose,
    ];
    for (const claim of claims) {
        if (claim === undefined || claim === null || claim === '') { continue; }
        const list = Array.isArray(claim) ? claim : [claim];
        if (list.length === 0) { continue; }
        const verdict = assessPurposes(list);
        if (!verdict.ok) { return { unknown: verdict.unknown }; }
    }
    return null;
}

module.exports = { respondPurposeInvalid, refusedDraftPurposeClaim };
