'use strict';

/**
 * ThaID adapter (services/auth/idp/thaid-adapter.js) — wire-shape unit pins
 * (Task 4, ThaID sandbox readiness plan).
 *
 * Why this file exists: the adapter has been in the tree since feat/auth-thaid-
 * oauth (evidence/AUTH-01) but had NO test file of its own — idp-adapter.test.js
 * covers the factory (getIdpAdapter) plus ProviderIdAdapter in full, and
 * auth-idp-routes.test.js exercises the ThaID ROUTE with thaid-identity-service
 * mocked out, but nothing has ever asserted what HTTP request this adapter
 * actually issues. That means the first real DOPA/BORA sandbox call would be
 * this code's first-ever execution against a live endpoint — this file pins
 * the wire shape (§6.1.1 authorize / §6.2.1 token / §7 error catalog,
 * evidence/AUTH-01/manual-citations.md:117-154) against mocked HTTP so a
 * shape mismatch is caught here, not against the sandbox.
 *
 * global.fetch is mocked throughout — no network. The adapter module itself
 * is REAL (not mocked) — only config/auth-providers.js's env-backed
 * getProviderConfig('thaid') is driven via process.env, same idiom as
 * idp-adapter.test.js's setFullProviderIdEnv().
 */

const { getAuthorizeUrl, exchangeCode } = require('../../services/auth/idp/thaid-adapter');

let envBackup;
let realFetch;

beforeEach(() => {
    envBackup = { ...process.env };
    for (const key of Object.keys(process.env)) {
        if (key.startsWith('AUTH_')) { delete process.env[key]; }
    }
    setThaidEnv();
    realFetch = global.fetch;
    global.fetch = jest.fn();
});

afterEach(() => {
    for (const key of Object.keys(process.env)) {
        if (!(key in envBackup)) { delete process.env[key]; }
    }
    Object.assign(process.env, envBackup);
    global.fetch = realFetch;
});

// ค่า placeholder ล้วน — ไม่ใช่ credential จริง (B1-CRED), โครงเดียวกับ
// idp-adapter.test.js:64-75 / auth-idp-routes.test.js:131-140
function setThaidEnv() {
    process.env.AUTH_THAID_CLIENT_ID = 'test-thaid-client';
    process.env.AUTH_THAID_CLIENT_SECRET = 'test-thaid-client-secret-value';
    process.env.AUTH_THAID_REDIRECT_URI = 'https://gacp.example/auth/callback/thaid';
    process.env.AUTH_THAID_AUTHORIZE_URL = 'https://thaid.example/api/v2/oauth2/auth/';
    process.env.AUTH_THAID_TOKEN_URL = 'https://thaid.example/api/v2/oauth2/token/';
    process.env.AUTH_THAID_SCOPE = 'openid pid given_name family_name';
    // INTROSPECT_URL deliberately NOT set here (Task 4 — optional, unused by
    // getAuthorizeUrl/exchangeCode; a REQUIRED-list regression would surface
    // in config/auth-providers.js's own suite, not this one).
}

function jsonResponse(status, payload) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(payload),
    };
}

async function rejectedCode(promise) {
    try { await promise; } catch (err) { return err && err.code; }
    return undefined;
}

function thrownCode(fn) {
    try { fn(); } catch (err) { return err && err.code; }
    return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('getAuthorizeUrl — §6.1.1 (manual-citations.md:117-122)', () => {
    it('builds a URL against AUTHORIZE_URL with response_type=code, client_id, redirect_uri, scope, state', () => {
        const url = getAuthorizeUrl({ state: 'random-state-0123456789abcdef' });
        expect(String(url).startsWith('https://thaid.example/api/v2/oauth2/auth/?')).toBe(true);
        const parsed = new URL(String(url));
        expect(parsed.searchParams.get('response_type')).toBe('code');
        expect(parsed.searchParams.get('client_id')).toBe('test-thaid-client');
        expect(parsed.searchParams.get('redirect_uri')).toBe('https://gacp.example/auth/callback/thaid');
        expect(parsed.searchParams.get('scope')).toBe('openid pid given_name family_name');
        expect(parsed.searchParams.get('state')).toBe('random-state-0123456789abcdef');
        // client_secret must NEVER reach a URL an end user's browser sees.
        expect(String(url)).not.toContain('test-thaid-client-secret-value');
    });

    it('state is mandatory (mandate §D3 anti-CSRF) — omitting it throws VALIDATION_ERROR, no URL built', () => {
        expect(thrownCode(() => getAuthorizeUrl({}))).toBe('VALIDATION_ERROR');
        expect(thrownCode(() => getAuthorizeUrl())).toBe('VALIDATION_ERROR');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('exchangeCode — §6.2.1 token request (manual-citations.md:128-131)', () => {
    it('POSTs TOKEN_URL with Basic base64(client_id:client_secret) EXACT + form-urlencoded body', async () => {
        global.fetch.mockResolvedValueOnce(jsonResponse(200, {
            access_token: 'thaid-access-token', token_type: 'Bearer', expire_in: 300,
        }));

        await exchangeCode({ code: 'the-auth-code' });

        const [url, opts] = global.fetch.mock.calls[0] || [];
        expect(url).toBe('https://thaid.example/api/v2/oauth2/token/');
        expect(opts && opts.method).toBe('POST');

        // §6.2.1: "Authorization: Basic Base64(client_id:client_secret)" —
        // exact value, not merely "starts with Basic".
        const expectedBasic = `Basic ${Buffer.from('test-thaid-client:test-thaid-client-secret-value').toString('base64')}`;
        expect(opts.headers.Authorization).toBe(expectedBasic);

        const contentType = opts.headers['Content-Type'] || opts.headers['content-type'];
        expect(contentType).toBe('application/x-www-form-urlencoded');

        const form = new URLSearchParams(String(opts.body));
        expect(form.get('grant_type')).toBe('authorization_code');
        expect(form.get('code')).toBe('the-auth-code');
        expect(form.get('redirect_uri')).toBe('https://gacp.example/auth/callback/thaid');
        // §6.2.1: credentials travel ONLY in the Basic header, never the body
        // (unlike the providerid leg-1, which is a different IdP's contract).
        expect(form.has('client_id')).toBe(false);
        expect(form.has('client_secret')).toBe(false);
    });

    it('returns the raw token response verbatim (raw field) — no PII parsing at this layer', async () => {
        const body = {
            access_token: 'thaid-access-token', token_type: 'Bearer', expire_in: 300,
            id_token: 'h.p.s', pid: '1234567890123',
        };
        global.fetch.mockResolvedValueOnce(jsonResponse(200, body));
        const res = await exchangeCode({ code: 'the-auth-code' });
        expect(res.raw).toStrictEqual(body);
        expect(res.accessToken).toBe('thaid-access-token');
        expect(res.accountId).toBeNull(); // ThaID has no account_id — subject lives in id_token.sub
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('exchangeCode — §7 error catalog (manual-citations.md:126, adapter throwTokenError)', () => {
    it('401 invalid_client → AUTH_IDP_CLIENT_AUTH_FAILED', async () => {
        global.fetch.mockResolvedValueOnce(jsonResponse(401, {
            error: 'invalid_client', error_description: 'Client authentication failed',
        }));
        expect(await rejectedCode(exchangeCode({ code: 'c' }))).toBe('AUTH_IDP_CLIENT_AUTH_FAILED');
    });

    it('401 user_denied → AUTH_IDP_ACCESS_DENIED (§7: "User denied the request (disapproved)")', async () => {
        global.fetch.mockResolvedValueOnce(jsonResponse(401, {
            error: 'user_denied', error_description: 'User denied the request (disapproved)',
        }));
        expect(await rejectedCode(exchangeCode({ code: 'c' }))).toBe('AUTH_IDP_ACCESS_DENIED');
    });

    it('400 invalid_scope → AUTH_IDP_EXCHANGE_FAILED', async () => {
        global.fetch.mockResolvedValueOnce(jsonResponse(400, {
            error: 'invalid_scope', error_description: 'The requested scope is invalid',
        }));
        expect(await rejectedCode(exchangeCode({ code: 'c' }))).toBe('AUTH_IDP_EXCHANGE_FAILED');
    });

    it('400 invalid_request → AUTH_IDP_CODE_INVALID', async () => {
        global.fetch.mockResolvedValueOnce(jsonResponse(400, {
            error: 'invalid_request', error_description: 'code or redirect_uri is invalid',
        }));
        expect(await rejectedCode(exchangeCode({ code: 'c' }))).toBe('AUTH_IDP_CODE_INVALID');
    });

    it('5xx (BORA server error) → AUTH_IDP_UNAVAILABLE', async () => {
        global.fetch.mockResolvedValueOnce(jsonResponse(503, { error: 'server_error' }));
        expect(await rejectedCode(exchangeCode({ code: 'c' }))).toBe('AUTH_IDP_UNAVAILABLE');
    });

    it('network unreachable / timeout → AUTH_IDP_UNAVAILABLE (fail-closed, no partial state)', async () => {
        global.fetch.mockRejectedValueOnce(
            Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
        );
        expect(await rejectedCode(exchangeCode({ code: 'c' }))).toBe('AUTH_IDP_UNAVAILABLE');
    });

    it('code is required — omitting it throws VALIDATION_ERROR before any fetch', async () => {
        expect(await rejectedCode(exchangeCode({}))).toBe('VALIDATION_ERROR');
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
