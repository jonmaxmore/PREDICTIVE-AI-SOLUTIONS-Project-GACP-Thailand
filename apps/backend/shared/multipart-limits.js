/**
 * How much multipart one upload door will read (SECU-02, audit 2026-09-17).
 *
 * multer bounds only what a door declares. Left to its defaults it accepts any
 * number of text fields, parts and files, up to 1 MB per text field, and field
 * names of any length and depth. All of that is held in memory before the
 * route's own checks run. multer < 2.3.0 can also be killed by two field names
 * (GHSA-wc9g-mqfw-jrwm, reproduced on 2.2.0 on 2026-09-17): `a[4294967294]`
 * followed by `a[]` makes append-field grow an array past its maximum length.
 * The RangeError is thrown inside a stream event, where no error handler can
 * catch it, and the process exits.
 *
 * So every door declares all of these limits:
 *   files, fileSize    what the route stores
 *   fields             the text fields its real client sends, with room to spare
 *   parts              files + fields, so one cannot be traded for the other
 *   fieldNameSize      100 bytes; the longest name a client sends is 16
 *   fieldSize          64 KB, unless the door takes long free text
 *   fieldNestingDepth  0. No client sends a bracketed name, and refusing them
 *                      blocks the crash above even before the multer upgrade.
 *
 * Guarded by __tests__/unit/upload-doors-declare-multipart-limits.test.js, which
 * pushes real multipart bodies through every multer instance in the backend.
 */
'use strict';

const FIELD_NAME_MAX_BYTES = 100;
const FIELD_VALUE_MAX_BYTES = 64 * 1024;

/**
 * @param {object} door
 * @param {number} door.fileSize  max bytes per file
 * @param {number} door.files     max file parts
 * @param {number} door.fields    max text fields
 * @param {number} [door.fieldSize] max bytes per text field
 * @returns {object} a complete multer `limits` object
 */
function multipartLimits({ fileSize, files, fields, fieldSize = FIELD_VALUE_MAX_BYTES }) {
    return {
        fileSize,
        files,
        fields,
        parts: files + fields,
        fieldNameSize: FIELD_NAME_MAX_BYTES,
        fieldSize,
        fieldNestingDepth: 0,
    };
}

module.exports = { multipartLimits, FIELD_NAME_MAX_BYTES, FIELD_VALUE_MAX_BYTES };
