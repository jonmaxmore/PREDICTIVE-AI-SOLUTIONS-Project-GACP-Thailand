/**
 * The desktop audit-decision door must tell the auditor WHY a PASS could not be recorded.
 * F-WALK-01: a NO_ONSITE_AUDIT failure was flattened to a blanket 500 with no reason.
 */
'use strict';

const { auditDecisionErrorResponse } = require('../../services/audit-decision-error-response');

/** As writeApplicationStatus wraps it: message English, .code carried, .cause set. */
function wrapped(code, { statusCode, causeMessage } = {}) {
    const err = new Error(`cert-auto-gen failed; status rolled back: ${code}`);
    err.code = code;
    err.cause = { code, message: causeMessage || null, statusCode: statusCode || undefined };
    if (statusCode) { err.statusCode = statusCode; }
    return err;
}

describe('audit-decision failure becomes an answer the auditor can act on', () => {
    test('NO_ONSITE_AUDIT is a 422 naming the fix, not a 500', () => {
        const r = auditDecisionErrorResponse(wrapped('NO_ONSITE_AUDIT'));
        expect(r.status).toBe(422);
        expect(r.body.code).toBe('NO_ONSITE_AUDIT');
        expect(r.body.messageTh).toContain('การตรวจประเมินในพื้นที่');
    });

    test.each([
        'INSUFFICIENT_PHOTOS', 'INCOMPLETE_CHECKLIST', 'AUDIT_APPLICATION_MISMATCH',
        'EVIDENCE_CAPTURE_UNAVAILABLE', 'CRITICAL_CHECKLIST_FAILURE',
    ])('%s is a 422 with a Thai reason', (code) => {
        const r = auditDecisionErrorResponse(wrapped(code));
        expect(r.status).toBe(422);
        expect(typeof r.body.messageTh).toBe('string');
        expect(r.body.messageTh.length).toBeGreaterThan(0);
    });

    test('a cert refusal carrying a 4xx statusCode keeps that status + its Thai message', () => {
        const r = auditDecisionErrorResponse(
            wrapped('CERTIFICATE_FARM_LOCATION_MISSING', { statusCode: 422, causeMessage: 'ข้อมูลที่ตั้งฟาร์มไม่ครบถ้วน' }));
        expect(r.status).toBe(422);
        expect(r.body.code).toBe('CERTIFICATE_FARM_LOCATION_MISSING');
        expect(r.body.messageTh).toContain('ที่ตั้งฟาร์ม');
    });

    test('an unknown/unexpected error returns null — the caller answers 500', () => {
        expect(auditDecisionErrorResponse(new Error('boom'))).toBeNull();
        expect(auditDecisionErrorResponse(wrapped('CERT_AUTO_GEN_FAILED'))).toBeNull();
    });
});
