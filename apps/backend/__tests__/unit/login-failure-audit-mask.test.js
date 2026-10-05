'use strict';

/**
 * M-1 (auth audit 2026-06-11) — the raw 13-digit national ID must NOT be
 * written to AuditLog on LOGIN_FAILURE. AuditLog.metadata is plaintext +
 * GIN-indexed, and failed-login rows often carry typos / other people's IDs /
 * enumeration probes, so storing cleartext violates PDPA data-minimization.
 * The identifier is masked the same way the success/MFA paths already mask it.
 */

const { createHealthAuthProfileHandlers } = require('../../controllers/auth-controller/health-auth-profile-handlers');

function buildLoginHandler(logAuth) {
    return createHealthAuthProfileHandlers({
        AuthService: {
            // Force the failure path.
            login: jest.fn().mockRejectedValue(new Error('Invalid credentials')),
        },
        auditLogger: { logAuth },
        logger: { debug: jest.fn(), error: jest.fn(), info: jest.fn() },
        fs: { unlink: jest.fn() },
        getRequestIp: () => '1.2.3.4',
        sendErrorResponse: (res, _req, e) => res.status(e.status).json(e),
        sendSuccessResponse: (res, _req, s) => res.status(s.status).json(s),
        setAuthCookies: jest.fn(),
        sanitizeUserPayload: (u) => u,
        consentManager: { recordConsent: jest.fn() },
        requiredConsents: [],
    });
}

const mockRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
});

describe('M-1 — LOGIN_FAILURE audit masks the national ID', () => {
    it('does not write the raw 13-digit identifier to the audit metadata', async () => {
        const logAuth = jest.fn().mockResolvedValue(undefined);
        const handlers = buildLoginHandler(logAuth);

        const res = mockRes();
        await handlers.login(
            { body: { identifier: '1186494077533', password: 'whatever' }, headers: { 'user-agent': 'jest' } },
            res,
        );

        expect(logAuth).toHaveBeenCalledTimes(1);
        const metadata = logAuth.mock.calls[0][6];
        // masked form keeps only the first 4 chars + ****
        expect(metadata.identifier).toBe('1186****');
        // the raw ID must NOT appear anywhere in the metadata
        expect(JSON.stringify(metadata)).not.toContain('1186494077533');
    });

    it('masks a non-numeric identifier (email/garbage probe) too, and never stores it raw', async () => {
        const logAuth = jest.fn().mockResolvedValue(undefined);
        const handlers = buildLoginHandler(logAuth);

        const res = mockRes();
        await handlers.login(
            { body: { identifier: 'attacker@evil.test', password: 'x' }, headers: {} },
            res,
        );

        const metadata = logAuth.mock.calls[0][6];
        expect(metadata.identifier).toBe('atta****');
        expect(JSON.stringify(metadata)).not.toContain('attacker@evil.test');
    });

    it('records null when no identifier was supplied', async () => {
        const logAuth = jest.fn().mockResolvedValue(undefined);
        const handlers = buildLoginHandler(logAuth);

        const res = mockRes();
        await handlers.login({ body: { password: 'x' }, headers: {} }, res);

        // login short-circuits MISSING_CREDENTIALS before AuthService.login, so
        // no failure-audit is written; if it ever is, identifier must be null.
        if (logAuth.mock.calls.length > 0) {
            expect(logAuth.mock.calls[0][6].identifier).toBeNull();
        }
        expect(res.statusCode).toBe(400);
    });
});
