'use strict';

/**
 * The one answer every 403 ENTITY_PERMISSION_DENIED door gives.
 *
 * The copy is read from the error catalogue (shared/error-codes.js ENTITY_PERMISSION_DENIED),
 * so it has a single source. A door that answers the refusal itself sends
 * `entityPermissionDeniedBody(permission)`; a door that goes through
 * shared/api-response.js sendErrorResponse gets the same body there. Nothing else may
 * write its own text for this code (pinned by __tests__/unit/entity-permission-denied-copy.test.js).
 *
 * Shape: `error` and `messageTh` carry the Thai copy (the web shows `error` for this
 * code, lib/api/entity-permission-denial.ts), `message` the generic English, `code`
 * the machine code.
 */

const { ERROR_CODES } = require('./error-codes');

const ENTRY = ERROR_CODES.ENTITY_PERMISSION_DENIED;
const ENTITY_PERMISSION_DENIED_CODE = ENTRY.code;
const ENTITY_PERMISSION_DENIED_TH = ENTRY.messageTh;
const ENTITY_PERMISSION_DENIED_EN = ENTRY.messageEn;

/**
 * @param {string} [permission] the permission the caller lacks, when known
 * @returns {{ success: false, code: string, permission?: string, error: string, message: string, messageTh: string }}
 */
function entityPermissionDeniedBody(permission) {
    return {
        success: false,
        code: ENTITY_PERMISSION_DENIED_CODE,
        ...(permission ? { permission } : {}),
        error: ENTITY_PERMISSION_DENIED_TH,
        message: ENTITY_PERMISSION_DENIED_EN,
        messageTh: ENTITY_PERMISSION_DENIED_TH,
    };
}

module.exports = {
    ENTITY_PERMISSION_DENIED_CODE,
    ENTITY_PERMISSION_DENIED_TH,
    ENTITY_PERMISSION_DENIED_EN,
    entityPermissionDeniedBody,
};
