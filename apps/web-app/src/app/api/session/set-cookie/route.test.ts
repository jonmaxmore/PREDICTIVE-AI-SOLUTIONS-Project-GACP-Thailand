/**
 * @jest-environment node
 *
 * SEC — POST /api/session/set-cookie must refuse cross-site callers.
 *
 * This route writes whatever `token` it is handed into the `auth_token` /
 * `provider_token` cookie. It had no CSRF defence of any kind: no Origin check,
 * and none of the double-submit `csrf_token` + `x-csrf-token` pair the rest of
 * this codebase uses on mutations (see auth-service logout, change-password,
 * and the backend csrf-middleware).
 *
 * That makes it a SESSION FIXATION primitive, which is the inverse of the usual
 * CSRF worry — the attacker is not acting as the victim, they are making the
 * victim act as THEM. An attacker's page posts the attacker's own valid session
 * token, the victim's browser stores it, and the victim carries on inside the
 * ATTACKER's account: every national ID, farm document and payment slip they
 * upload from that point lands in the attacker's records.
 *
 * Three things that look like mitigations but are not:
 *
 *  • `sameSite: 'lax'` on the cookie. SameSite governs when a cookie is SENT,
 *    not whether a cross-site response may SET one. The Set-Cookie in the
 *    response is honoured either way.
 *  • `Content-Type: application/json`, which would normally force a CORS
 *    preflight. `request.json()` does not verify the content type, and a plain
 *    HTML form with `enctype="text/plain"` can emit a body that parses as JSON
 *    — the standard bypass. No preflight is involved, so nothing blocks it.
 *  • httpOnly. It stops the page reading the cookie; it does not stop this
 *    route writing one.
 *
 * The guard is an Origin/Sec-Fetch-Site check rather than the double-submit
 * pair, because this route runs immediately after login, before a `csrf_token`
 * cookie necessarily exists. Browsers always send `Origin` on a cross-origin
 * POST, so requiring it to match closes the browser vector completely; a
 * non-browser caller that sends neither header is not a CSRF vector at all and
 * is left alone.
 */

import { NextRequest } from 'next/server';
import { POST } from './route';

const SELF = 'http://localhost:3000';

function buildRequest(body: unknown, headers: Record<string, string> = {}) {
    return new NextRequest(`${SELF}/api/session/set-cookie`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });
}

const VALID_BODY = { token: 'attacker-session-token', cookieName: 'auth_token' };

function setCookieHeader(response: Response) {
    return response.headers.get('set-cookie') || '';
}

describe('SEC — /api/session/set-cookie rejects cross-site callers', () => {
    it('refuses a cross-origin POST and sets no cookie', async () => {
        const res = await POST(buildRequest(VALID_BODY, { origin: 'https://evil.example' }));

        expect(res.status).toBe(403);
        expect(setCookieHeader(res)).not.toContain('auth_token');
    });

    it('refuses when Sec-Fetch-Site says cross-site, even with no Origin', async () => {
        const res = await POST(buildRequest(VALID_BODY, { 'sec-fetch-site': 'cross-site' }));

        expect(res.status).toBe(403);
        expect(setCookieHeader(res)).not.toContain('auth_token');
    });

    it('refuses Sec-Fetch-Site: same-site (a sibling subdomain is not us)', async () => {
        const res = await POST(buildRequest(VALID_BODY, { 'sec-fetch-site': 'same-site' }));

        expect(res.status).toBe(403);
    });

    it('refuses the text/plain form-post bypass shape', async () => {
        // The body an enctype="text/plain" form produces still parses as JSON,
        // so content-type alone never protected this route.
        const req = new NextRequest(`${SELF}/api/session/set-cookie`, {
            method: 'POST',
            headers: { 'content-type': 'text/plain', origin: 'https://evil.example' },
            body: '{"token":"attacker-session-token","cookieName":"auth_token","x":"="}',
        });

        const res = await POST(req);

        expect(res.status).toBe(403);
        expect(setCookieHeader(res)).not.toContain('auth_token');
    });

    it('still accepts the app own same-origin call', async () => {
        const res = await POST(buildRequest(VALID_BODY, { origin: SELF }));

        expect(res.status).toBe(200);
        expect(setCookieHeader(res)).toContain('auth_token=');
    });

    it('still accepts Sec-Fetch-Site: same-origin', async () => {
        const res = await POST(buildRequest(VALID_BODY, { 'sec-fetch-site': 'same-origin' }));

        expect(res.status).toBe(200);
        expect(setCookieHeader(res)).toContain('auth_token=');
    });

    it('leaves a non-browser caller (no Origin, no Sec-Fetch-Site) working', async () => {
        // Not a CSRF vector: a browser always sends at least one of these on a
        // cross-origin POST. Rejecting here would break server-side callers for
        // no security gain.
        const res = await POST(buildRequest(VALID_BODY));

        expect(res.status).toBe(200);
    });

    it('keeps rejecting an invalid cookie name regardless of origin', async () => {
        const res = await POST(buildRequest(
            { token: 't', cookieName: 'refresh_token' },
            { origin: SELF },
        ));

        expect(res.status).toBe(400);
    });
});
