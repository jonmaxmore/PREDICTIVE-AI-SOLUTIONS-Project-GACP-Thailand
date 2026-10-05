/**
 * [Sprint6] DELETE /me Right-to-Erasure (H7)
 *
 * Sprint 6 healthId-audit Phase D-H7: PDPA Section 33. Authenticated users can
 * request anonymisation of their account. Confirms via password, anonymises all
 * PII fields, revokes all sessions.
 */

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: {
            findUnique: (...args) => mockFindUnique(...args),
            update: (...args) => mockUpdate(...args),
        },
    },
}));

const mockRevokeAll = jest.fn().mockResolvedValue(undefined);
const mockBlocklistAccess = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/token-revocation-service', () => ({
    revokeAllUserTokens: (...args) => mockRevokeAll(...args),
    blocklistAccessToken: (...args) => mockBlocklistAccess(...args),
    revokeRefreshToken: jest.fn().mockResolvedValue(undefined),
    issueRefreshToken: jest.fn().mockResolvedValue('jti-new'),
    isAccessTokenBlocklisted: jest.fn().mockResolvedValue(false),
}));

jest.mock('bcryptjs', () => ({
    compare: jest.fn(),
}));

const bcrypt = require('bcryptjs');
const { createAuthSessionSecurityHandlers } = require('../../controllers/auth-controller/auth-session-security-handlers');

function makeRes() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    res.clearCookie = jest.fn(() => res);
    return res;
}

function buildHandlers() {
    return createAuthSessionSecurityHandlers({
        AuthService: {},
        auditLogger: { logAuth: jest.fn().mockResolvedValue(undefined) },
        jwtConfig: { loadJWTConfiguration: jest.fn(), verifyRefreshToken: jest.fn(), generateToken: jest.fn(), generateRefreshToken: jest.fn() },
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        getRequestIp: () => '127.0.0.1',
        sendErrorResponse: (res, _req, { status, code, message }) => res.status(status).json({ success: false, code, error: message }),
        sendSuccessResponse: (res, _req, body) => res.status(200).json({ success: true, ...body }),
        setAuthCookies: jest.fn(),
    });
}

describe('[Sprint6] DELETE /me Right-to-Erasure', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns 401 when no user is authenticated', async () => {
        const handlers = buildHandlers();
        const req = { user: null, body: { password: 'whatever' }, cookies: {}, headers: {} };
        const res = makeRes();
        await handlers.deleteMe(req, res);
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it('returns 400 when password confirmation is missing from request body', async () => {
        const handlers = buildHandlers();
        const req = { user: { id: 'user-1', jti: 'jti-1' }, body: {}, cookies: {}, headers: {} };
        const res = makeRes();
        await handlers.deleteMe(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PASSWORD_CONFIRMATION_REQUIRED' }));
    });

    it('returns 401 when password confirmation does not match bcrypt hash', async () => {
        mockFindUnique.mockResolvedValue({ id: 'user-1', password: '$2a$12$hash', role: 'HEALTH', isAnonymized: false });
        bcrypt.compare.mockResolvedValue(false);

        const handlers = buildHandlers();
        const req = { user: { id: 'user-1', jti: 'jti-1' }, body: { password: 'wrong-password' }, cookies: {}, headers: {} };
        const res = makeRes();
        await handlers.deleteMe(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('successful erasure: nulls all PII, sets password to PDPA_ANONYMIZED, revokes sessions, returns 200', async () => {
        mockFindUnique.mockResolvedValue({ id: 'user-1', password: '$2a$12$hash', role: 'HEALTH', isAnonymized: false });
        bcrypt.compare.mockResolvedValue(true);
        mockUpdate.mockResolvedValue(undefined);

        const handlers = buildHandlers();
        const req = { user: { id: 'user-1', jti: 'jti-1' }, body: { password: 'correct-password' }, cookies: {}, headers: {} };
        const res = makeRes();
        await handlers.deleteMe(req, res);

        // Update should have nulled all identity fields.
        const updateArgs = mockUpdate.mock.calls[0][0];
        expect(updateArgs.where).toEqual({ id: 'user-1' });
        const data = updateArgs.data;
        for (const f of [
            'healthId', 'providerId', 'idCard', 'taxId', 'communityRegistrationNo',
            'healthIdHash', 'providerIdHash', 'idCardHash', 'taxIdHash', 'communityRegistrationNoHash',
            'firstName', 'lastName', 'email', 'phoneNumber',
        ]) {
            expect(data[f]).toBeNull();
        }
        expect(data.password).toBe('PDPA_ANONYMIZED');
        expect(data.isAnonymized).toBe(true);
        expect(data.isDeleted).toBe(true);

        // Sessions revoked.
        expect(mockBlocklistAccess).toHaveBeenCalledWith('jti-1');
        expect(mockRevokeAll).toHaveBeenCalledWith('user-1');

        // Cookies cleared.
        expect(res.clearCookie).toHaveBeenCalledWith('auth_token', { path: '/' });
        expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', { path: '/' });

        // Success response.
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 410 ALREADY_ANONYMIZED when user is already anonymised', async () => {
        mockFindUnique.mockResolvedValue({ id: 'user-1', password: '$2a$12$hash', role: 'HEALTH', isAnonymized: true });

        const handlers = buildHandlers();
        const req = { user: { id: 'user-1', jti: 'jti-1' }, body: { password: 'anything' }, cookies: {}, headers: {} };
        const res = makeRes();
        await handlers.deleteMe(req, res);

        expect(res.status).toHaveBeenCalledWith(410);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ALREADY_ANONYMIZED' }));
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('never retries without isAnonymized/anonymizedAt — a marker failure surfaces, it is not routed around', async () => {
        // R-HOTFIX-PDPA follow-up: the marker columns now EXIST
        // (migration 20260803130000_add_user_anonymization_markers), so an update
        // that fails while mentioning them is a real failure — not an old-schema
        // shape to be worked around. The marker-less retry this replaces was the
        // same bug class removed from the nightly sweep in #737: it completed the
        // IRREVERSIBLE null-out (identity columns AND their hashes) while dropping
        // `anonymizedAt`, which is the PDPA evidence of WHEN the erasure happened.
        // Destroying the data and losing the record of having done so is strictly
        // worse than failing loudly.
        mockFindUnique.mockResolvedValue({ id: 'user-1', password: '$2a$12$hash', role: 'HEALTH', isAnonymized: false });
        bcrypt.compare.mockResolvedValue(true);
        // First attempt rejects naming a marker column; any later attempt would resolve.
        mockUpdate.mockRejectedValueOnce(new Error('Unknown arg `isAnonymized` in data'));

        const handlers = buildHandlers();
        const req = { user: { id: 'user-1', jti: 'jti-1' }, body: { password: 'correct-password' }, cookies: {}, headers: {} };
        const res = makeRes();
        await handlers.deleteMe(req, res);

        // Exactly one attempt — no second, marker-stripped write.
        expect(mockUpdate).toHaveBeenCalledTimes(1);
        // That single attempt carries the markers; they are never stripped.
        const attemptedData = mockUpdate.mock.calls[0][0].data;
        expect(attemptedData.isAnonymized).toBe(true);
        expect(attemptedData.anonymizedAt).toBeInstanceOf(Date);

        // The error is not swallowed: deleteMe's own catch turns it into 500.
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'DELETE_ME_FAILED' }));
        expect(res.status).not.toHaveBeenCalledWith(200);

        // Nothing downstream ran: the account was NOT erased, so the caller must
        // not be logged out and must not be told the deletion succeeded.
        expect(mockBlocklistAccess).not.toHaveBeenCalled();
        expect(mockRevokeAll).not.toHaveBeenCalled();
        expect(res.clearCookie).not.toHaveBeenCalled();
    });
});
