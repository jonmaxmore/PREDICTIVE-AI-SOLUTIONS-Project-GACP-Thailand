'use strict';
/**
 * Certificate revision (ฉบับแก้ไขภายใต้เลขเดิม): every code the revision
 * door can answer with must be a catalogued row in shared/error-codes.js.
 *
 * Spec: design note 2026-08-27-certificate-revision-design §3-§4.
 */
const { lookup } = require('../../shared/error-codes');

describe('certificate revision: every door code is catalogued', () => {
    it.each([
        ['CERTIFICATE_NOT_REVISABLE', 409],
        ['CERTIFICATE_REVISION_NO_CHANGE', 409],
        ['CERTIFICATE_REVISION_CONFLICT', 409],
        ['REVISION_REASON_REQUIRED', 400],
        ['REVISION_REASON_TOO_LONG', 400],
    ])('%s is catalogued at %d with Thai cause + next action', (code, status) => {
        const entry = lookup(code);
        expect(entry).toBeTruthy();
        expect(entry.httpStatus).toBe(status);
        expect(entry.messageTh).toMatch(/กรุณา|คุณ/);
        expect(entry.messageTh).not.toMatch(/—/);
    });
});
