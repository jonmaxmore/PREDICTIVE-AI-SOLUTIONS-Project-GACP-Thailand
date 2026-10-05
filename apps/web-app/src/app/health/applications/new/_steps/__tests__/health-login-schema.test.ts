/**
 * V1-A — health-login-page Thai validation copy.
 *
 * The login schema is built via `createLoginSchema(v)` where `v`
 * carries language-specific error strings. Wave E.3-B refactored
 * this from hardcoded Thai literals so English users no longer see
 * Thai validation copy — but the regression we want to lock down
 * is the *Thai* path: when the page initialises with `language='th'`
 * (the default), an empty identifier MUST return the Thai message
 * verbatim, not the English one and not a generic "Required".
 *
 * Test path: lives under the wizard tests dir because V1-A scope
 * covers sign-up + wizard polish; the schema itself is exported
 * from the auth-page module so this test does not depend on
 * rendering the React component (no need for a React test harness).
 */

import { createLoginSchema, LOGIN_COPY } from '@/app/auth/_components/health-login-page';

describe('[V1-A] health-login createLoginSchema — language-aware validation', () => {
    it('returns the Thai identifier message verbatim when language=th (default)', () => {
        const schema = createLoginSchema(LOGIN_COPY.th.validation);
        const result = schema.safeParse({ identifier: '', password: 'longenoughpw' });

        expect(result.success).toBe(false);
        if (result.success) return;

        const identifierIssue = result.error.issues.find((issue) => issue.path.includes('identifier'));
        expect(identifierIssue).toBeDefined();
        // The exact Thai copy we ship in COPY.th.validation.identifier
        expect(identifierIssue?.message).toBe('กรุณากรอกเลขบัตรประชาชน 13 หลัก');
    });

    it('rejects an EMPTY password with the Thai message (login validates presence only)', () => {
        // Auth audit 2026-06-11: login enforces PRESENCE, not strength — a legacy
        // user whose password predates the strong policy must still sign in. So a
        // short-but-non-empty password is accepted; only an empty one is rejected.
        const schema = createLoginSchema(LOGIN_COPY.th.validation);
        const result = schema.safeParse({ identifier: '1234567890123', password: '' });

        expect(result.success).toBe(false);
        if (result.success) return;

        const passwordIssue = result.error.issues.find((issue) => issue.path.includes('password'));
        expect(passwordIssue?.message).toBe('กรุณากรอกรหัสผ่าน');
    });

    it('ACCEPTS a short (legacy) password at login — strength is enforced only on register', () => {
        const schema = createLoginSchema(LOGIN_COPY.th.validation);
        const result = schema.safeParse({ identifier: '1234567890123', password: 'short' });
        expect(result.success).toBe(true);
    });

    it('returns the English identifier message when language=en (regression guard)', () => {
        // Ensures the English path didn't silently drift back to Thai.
        const schema = createLoginSchema(LOGIN_COPY.en.validation);
        const result = schema.safeParse({ identifier: '', password: 'longenoughpw' });

        expect(result.success).toBe(false);
        if (result.success) return;

        const identifierIssue = result.error.issues.find((issue) => issue.path.includes('identifier'));
        expect(identifierIssue?.message).toBe('Please enter your 13-digit citizen ID');
    });

    it('validates a well-formed payload successfully (positive case)', () => {
        const schema = createLoginSchema(LOGIN_COPY.th.validation);
        const result = schema.safeParse({
            identifier: '1234567890123',
            password: 'longenoughpw',
        });
        expect(result.success).toBe(true);
    });

    it('LOGIN_COPY.th.validation exposes both identifier and password keys (contract anchor)', () => {
        // If someone refactors LOGIN_COPY and forgets to keep the
        // validation key set in sync between th and en, this test
        // fails loud rather than the form silently showing
        // `undefined` instead of an error message.
        expect(LOGIN_COPY.th.validation).toEqual(
            expect.objectContaining({
                identifier: expect.any(String),
                password: expect.any(String),
            }),
        );
        expect(LOGIN_COPY.en.validation).toEqual(
            expect.objectContaining({
                identifier: expect.any(String),
                password: expect.any(String),
            }),
        );
    });
});
