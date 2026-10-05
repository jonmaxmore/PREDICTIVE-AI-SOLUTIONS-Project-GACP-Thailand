/**
 * COMP-006 regression (PDPA ม.19) — health registration must capture EXPLICIT
 * consent for the required categories (Terms of Service + Privacy Policy) and
 * persist it as an auditable UserConsent trail.
 *
 *  - Schema gate: registration is rejected unless both consents are === true.
 *  - Controller: on a successful (201) registration, recordConsent is called
 *    once per required category; a non-fatal persistence error must not break
 *    the registration response.
 *
 * See docs/handoffs/audit-2026-05-31/security/SEC-... compliance audit COMP-006.
 */
'use strict';

const { healthRegisterSchema } = require('../../shared/schemas/auth-schemas');
const { createHealthAuthProfileHandlers } = require('../../controllers/auth-controller/health-auth-profile-handlers');

// Otherwise-valid payload (valid Mod-11 Thai ID widely used across the suite),
// so the ONLY thing under test is the consent gate.
const validBase = {
    identifier: '1100000000008',
    password: 'Str0ng#Pass99', // meets the strong-password policy (audit 2026-06-11)
    phoneNumber: '0812345678',
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    accountType: 'INDIVIDUAL',
};

describe('COMP-006 — registration schema enforces explicit consent', () => {
    test('rejects when consent fields are missing', () => {
        const r = healthRegisterSchema.safeParse({ ...validBase });
        expect(r.success).toBe(false);
        const paths = r.error.issues.map((i) => i.path.join('.'));
        expect(paths).toEqual(expect.arrayContaining(['acceptedTermsOfService', 'acceptedPrivacyPolicy']));
    });

    test('rejects when consent is explicitly false', () => {
        const r = healthRegisterSchema.safeParse({
            ...validBase, acceptedTermsOfService: false, acceptedPrivacyPolicy: false,
        });
        expect(r.success).toBe(false);
    });

    test('accepts when both consents are true', () => {
        const r = healthRegisterSchema.safeParse({
            ...validBase, acceptedTermsOfService: true, acceptedPrivacyPolicy: true,
        });
        expect(r.success).toBe(true);
    });
});

function buildHandlers(recordRegistrationConsents, spies = {}) {
    const logMany = spies.logMany || jest.fn().mockResolvedValue(2);
    return createHealthAuthProfileHandlers({
        AuthService: {
            registerHealthUser: jest.fn().mockResolvedValue({
                status: 201,
                body: { message: 'ok', data: { user: { id: 'user-1', organizationId: 'org-xyz' } } },
            }),
        },
        auditLogger: {
            // F-QA-01: registration now emits ONE audit batch (REGISTER_SUCCESS
            // + one CONSENT_GRANTED per required consent) instead of one locked
            // transaction per event. authEvent() is the shared shape builder.
            authEvent: (action, actorId, actorRole, outcome, ipAddress, userAgent, metadata) => ({
                category: 'AUTHENTICATION', action, actorId, actorRole, result: outcome,
                ipAddress, userAgent, metadata,
            }),
            logMany,
        },
        logger: { debug: jest.fn(), error: jest.fn(), info: jest.fn() },
        fs: { unlink: jest.fn() },
        getRequestIp: () => '1.2.3.4',
        sendErrorResponse: (res, _req, e) => res.status(e.status).json(e),
        sendSuccessResponse: (res, _req, s) => res.status(s.status).json(s),
        setAuthCookies: jest.fn(),
        sanitizeUserPayload: (u) => u,
        consentManager: { recordRegistrationConsents },
        requiredConsents: ['TERMS_OF_SERVICE', 'PRIVACY_POLICY'],
    });
}

const mockRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
});

const consentEvent = (category) => ({
    category: 'SECURITY',
    action: 'CONSENT_GRANTED',
    actorId: 'user-1',
    resourceType: 'CONSENT',
    metadata: { consentCategory: category, version: '1.0.0' },
});

describe('COMP-006 — registration persists UserConsent (controller)', () => {
    test('records every required consent on a 201 registration, with the tenant it already knows', async () => {
        const recordRegistrationConsents = jest.fn().mockResolvedValue({
            consents: [{ id: 'c1' }, { id: 'c2' }],
            auditEvents: [consentEvent('TERMS_OF_SERVICE'), consentEvent('PRIVACY_POLICY')],
            failures: [],
        });
        const handlers = buildHandlers(recordRegistrationConsents);

        const res = mockRes();
        await handlers.register({ body: {}, file: null, headers: { 'user-agent': 'jest' } }, res);

        expect(res.statusCode).toBe(201);
        expect(recordRegistrationConsents).toHaveBeenCalledTimes(1);
        expect(recordRegistrationConsents).toHaveBeenCalledWith({
            userId: 'user-1',
            organizationId: 'org-xyz',
            categories: ['TERMS_OF_SERVICE', 'PRIVACY_POLICY'],
            ipAddress: '1.2.3.4',
            userAgent: 'jest',
            metadata: { source: 'REGISTRATION' },
        });
    });

    test('REGISTER_SUCCESS and both CONSENT_GRANTED rows go out as ONE audit batch', async () => {
        const logMany = jest.fn().mockResolvedValue(3);
        const recordRegistrationConsents = jest.fn().mockResolvedValue({
            consents: [{ id: 'c1' }, { id: 'c2' }],
            auditEvents: [consentEvent('TERMS_OF_SERVICE'), consentEvent('PRIVACY_POLICY')],
            failures: [],
        });
        const handlers = buildHandlers(recordRegistrationConsents, { logMany });

        const res = mockRes();
        await handlers.register({ body: {}, file: null, headers: { 'user-agent': 'jest' } }, res);

        expect(res.statusCode).toBe(201);
        // F-QA-01: one call, not one per event — three separate locked
        // transactions to a cross-region database is what made registration slow.
        expect(logMany).toHaveBeenCalledTimes(1);
        const batch = logMany.mock.calls[0][0];
        expect(batch.map((e) => e.action)).toEqual(['REGISTER_SUCCESS', 'CONSENT_GRANTED', 'CONSENT_GRANTED']);
        expect(batch[0]).toMatchObject({ actorId: 'user-1', actorRole: 'HEALTH', result: 'SUCCESS' });
        expect(batch.map((e) => e.metadata.consentCategory).filter(Boolean))
            .toEqual(['TERMS_OF_SERVICE', 'PRIVACY_POLICY']);
    });

    test('a non-fatal consent persistence error still returns 201 — and REGISTER_SUCCESS is still audited', async () => {
        const logMany = jest.fn().mockResolvedValue(1);
        const recordRegistrationConsents = jest.fn().mockRejectedValue(new Error('db down'));
        const handlers = buildHandlers(recordRegistrationConsents, { logMany });

        const res = mockRes();
        await handlers.register({ body: {}, file: null, headers: {} }, res);

        expect(res.statusCode).toBe(201);
        expect(logMany).toHaveBeenCalledTimes(1);
        expect(logMany.mock.calls[0][0].map((e) => e.action)).toEqual(['REGISTER_SUCCESS']);
    });

    test('one category failing does not cost the other its audit row', async () => {
        const logMany = jest.fn().mockResolvedValue(2);
        const recordRegistrationConsents = jest.fn().mockResolvedValue({
            consents: [{ id: 'c1' }],
            auditEvents: [consentEvent('TERMS_OF_SERVICE')],
            failures: [{ category: 'PRIVACY_POLICY', error: new Error('unique violation') }],
        });
        const handlers = buildHandlers(recordRegistrationConsents, { logMany });

        const res = mockRes();
        await handlers.register({ body: {}, file: null, headers: {} }, res);

        expect(res.statusCode).toBe(201);
        expect(logMany.mock.calls[0][0].map((e) => e.action)).toEqual(['REGISTER_SUCCESS', 'CONSENT_GRANTED']);
    });
});
