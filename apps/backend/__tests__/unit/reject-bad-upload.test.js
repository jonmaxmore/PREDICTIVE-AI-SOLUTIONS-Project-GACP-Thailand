/**
 * reject-bad-upload middleware — surface a swallowed upload rejection as 400.
 *
 * RED (pre-impl): the middleware does not exist.
 */
'use strict';

const rejectBadUpload = require('../../middleware/reject-bad-upload');

function mockRes() {
    return {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
    };
}

describe('rejectBadUpload middleware', () => {
    test('a stashed rejection → 400 UPLOAD_REJECTED with the Thai reason, next NOT called', () => {
        const req = {
            uploadRejectionReason: 'ประเภทไฟล์ text/html ไม่รองรับ (evil.html)',
            uploadRejectionCode: 'UPLOAD_REJECTED',
        };
        const res = mockRes();
        const next = jest.fn();

        rejectBadUpload(req, res, next);

        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({
            success: false,
            error: 'UPLOAD_REJECTED',
            message: 'ประเภทไฟล์ text/html ไม่รองรับ (evil.html)',
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('no rejection (valid or absent file) → next() called, no response written', () => {
        const req = {};
        const res = mockRes();
        const next = jest.fn();

        rejectBadUpload(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBeNull();
        expect(res.body).toBeNull();
    });

    test('falls back to UPLOAD_REJECTED when only the reason (no code) is stashed', () => {
        const req = { uploadRejectionReason: 'bad file' };
        const res = mockRes();
        const next = jest.fn();

        rejectBadUpload(req, res, next);

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe('UPLOAD_REJECTED');
        expect(next).not.toHaveBeenCalled();
    });
});
