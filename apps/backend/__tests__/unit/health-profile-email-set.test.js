/**
 * PR6 — health PATCH /me email handling.
 *
 * Email is the 2FA + password-reset channel, so the controller allows a
 * FIRST-TIME email set (no existing recovery channel to hijack) but BLOCKS
 * changing an already-established email (an unverified change is an account-
 * takeover vector). These tests pin that behavior so a future refactor can't
 * silently reopen the change path.
 *
 * The handler factory takes injected deps, so this needs no DB/prisma import.
 */
const { createHealthAuthProfileHandlers } = require('../../controllers/auth-controller/health-auth-profile-handlers');

function buildHandlers({ currentEmail, getProfileThrows = false, getProfileNull = false }) {
    const calls = { error: [], success: [], updated: [] };
    const AuthService = {
        getProfile: jest.fn(async () => {
            if (getProfileThrows) { throw new Error('connection pool timeout'); }
            if (getProfileNull) { return null; }
            return { id: 'u1', email: currentEmail };
        }),
        updateProfile: jest.fn(async (_id, data) => {
            calls.updated.push(data);
            return { id: 'u1', ...data };
        }),
    };
    const handlers = createHealthAuthProfileHandlers({
        AuthService,
        auditLogger: { log: jest.fn() },
        logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
        fs: {},
        getRequestIp: () => '203.0.113.1',
        sendErrorResponse: (_res, _req, payload) => { calls.error.push(payload); return payload; },
        sendSuccessResponse: (_res, _req, payload) => { calls.success.push(payload); return payload; },
        setAuthCookies: jest.fn(),
        sanitizeUserPayload: (u) => u,
        consentManager: {},
        requiredConsents: [],
    });
    return { handlers, AuthService, calls };
}

const RES = {};

describe('PR6 — health updateProfile email handling', () => {
    it('allows a FIRST-TIME email set (no email on file)', async () => {
        const { handlers, AuthService, calls } = buildHandlers({ currentEmail: null });
        await handlers.updateProfile({ user: { id: 'u1' }, body: { email: 'New@Example.com' } }, RES);

        expect(calls.error).toHaveLength(0);
        expect(AuthService.updateProfile).toHaveBeenCalledTimes(1);
        // normalized to lower-case
        expect(calls.updated[0]).toEqual({ email: 'new@example.com' });
        expect(calls.success).toHaveLength(1);
    });

    it('BLOCKS changing an already-established email with 409', async () => {
        const { handlers, AuthService, calls } = buildHandlers({ currentEmail: 'old@example.com' });
        await handlers.updateProfile({ user: { id: 'u1' }, body: { email: 'attacker@evil.com' } }, RES);

        expect(AuthService.updateProfile).not.toHaveBeenCalled();
        expect(calls.error).toHaveLength(1);
        expect(calls.error[0].status).toBe(409);
        expect(calls.error[0].code).toBe('EMAIL_CHANGE_REQUIRES_VERIFICATION');
    });

    it('treats the SAME email (case-insensitive) as a no-op, not a change', async () => {
        const { handlers, AuthService, calls } = buildHandlers({ currentEmail: 'me@example.com' });
        // Only the email is sent and it matches → nothing to update → 400 (no valid fields).
        await handlers.updateProfile({ user: { id: 'u1' }, body: { email: 'ME@example.com' } }, RES);

        expect(AuthService.updateProfile).not.toHaveBeenCalled();
        expect(calls.error).toHaveLength(1);
        expect(calls.error[0].code).toBe('VALIDATION_ERROR'); // "No valid fields to update"
    });

    it('FAILS CLOSED with 503 when the current-email read throws (no takeover window)', async () => {
        const { handlers, AuthService, calls } = buildHandlers({ getProfileThrows: true });
        await handlers.updateProfile({ user: { id: 'u1' }, body: { email: 'attacker@evil.com' } }, RES);

        // Must NOT treat a read failure as "no email on file" → must NOT write email.
        expect(AuthService.updateProfile).not.toHaveBeenCalled();
        expect(calls.error).toHaveLength(1);
        expect(calls.error[0].status).toBe(503);
        expect(calls.error[0].code).toBe('EMAIL_GATE_READ_FAILED');
    });

    it('returns 404 when the user row is missing (not first-time-set)', async () => {
        const { handlers, AuthService, calls } = buildHandlers({ getProfileNull: true });
        await handlers.updateProfile({ user: { id: 'u1' }, body: { email: 'new@example.com' } }, RES);

        expect(AuthService.updateProfile).not.toHaveBeenCalled();
        expect(calls.error[0].status).toBe(404);
    });

    it('rejects a malformed email with 400', async () => {
        const { handlers, AuthService, calls } = buildHandlers({ currentEmail: null });
        await handlers.updateProfile({ user: { id: 'u1' }, body: { email: 'not-an-email' } }, RES);

        expect(AuthService.updateProfile).not.toHaveBeenCalled();
        expect(calls.error[0].status).toBe(400);
        expect(calls.error[0].code).toBe('VALIDATION_ERROR');
    });

    it('short-circuits an unchanged email (matches the session JWT) WITHOUT a DB read', async () => {
        const { handlers, AuthService, calls } = buildHandlers({ currentEmail: 'me@example.com' });
        // req.user.email (verified JWT) matches the submitted email → no-op fast path.
        await handlers.updateProfile(
            { user: { id: 'u1', email: 'me@example.com' }, body: { email: 'ME@example.com', firstName: 'ก' } },
            RES,
        );
        // Did NOT consult the DB for the gate, and saved the other field.
        expect(AuthService.getProfile).not.toHaveBeenCalled();
        expect(calls.updated[0]).toEqual({ firstName: 'ก' }); // email no-op, firstName saved
        expect(calls.error).toHaveLength(0);
    });

    it('still reads the DB (and 409s) when the submitted email differs from the session', async () => {
        const { handlers, AuthService, calls } = buildHandlers({ currentEmail: 'old@example.com' });
        await handlers.updateProfile(
            { user: { id: 'u1', email: 'old@example.com' }, body: { email: 'attacker@evil.com' } },
            RES,
        );
        expect(AuthService.getProfile).toHaveBeenCalledTimes(1);
        expect(calls.error[0].code).toBe('EMAIL_CHANGE_REQUIRES_VERIFICATION');
    });

    it('still updates other fields alongside a first-time email set', async () => {
        const { handlers, calls } = buildHandlers({ currentEmail: null });
        await handlers.updateProfile(
            { user: { id: 'u1' }, body: { firstName: 'สมชาย', email: 'a@b.co' } },
            RES,
        );
        expect(calls.error).toHaveLength(0);
        expect(calls.updated[0]).toEqual({ firstName: 'สมชาย', email: 'a@b.co' });
    });
});
