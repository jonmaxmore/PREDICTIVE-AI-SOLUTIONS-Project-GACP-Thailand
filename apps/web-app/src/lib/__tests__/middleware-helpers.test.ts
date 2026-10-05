/**
 * V1-D D1 — frontend middleware helpers unit test.
 *
 * Verifies the extracted `decideHealthAccess` helper used by
 * `apps/web-app/src/middleware.ts` to decide whether a `/health/*`
 * request should pass through, redirect to provider dashboard, or
 * redirect to the health login.
 *
 * Pre-V1-D the /health/* branch only checked auth_token cookie
 * presence. A provider with an `auth_token` (dev fixture, cross-tab
 * leakage) bypassed the gate. The fix mirrors the /provider/* role
 * decode at middleware.ts:151-157 — this file proves the decoder
 * returns the right decision for the 6 spec cases (admin, scheduler,
 * document_reviewer, auditor, account, health, plus malformed/empty).
 *
 * See: docs/handoffs/iter-V1/00-rfc.md §D1
 */

import { describe, expect, it } from '@jest/globals';
import {
    decideHealthAccess,
    decideProviderRouteAccess,
    decodeCanonicalRoleFromToken,
    decodeJwtPayload,
    PROVIDER_ROUTE_ROLE_RULES,
} from '../middleware-helpers';

/**
 * Build a minimal JWS-shaped string with the given payload claim. We do
 * not need a valid signature — the helper is intentionally non-verifying.
 * Real signature verification lives on the backend `authenticate*` calls.
 */
function makeToken(payload: Record<string, unknown>): string {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = btoa(JSON.stringify(payload));
    return `${header}.${body}.signature-placeholder`;
}

describe('V1-D D1 — decodeJwtPayload', () => {
    it('returns null for empty / missing input', () => {
        expect(decodeJwtPayload('')).toBeNull();
        expect(decodeJwtPayload(null)).toBeNull();
        expect(decodeJwtPayload(undefined)).toBeNull();
    });

    it('returns null when token is not a 3-part JWS', () => {
        expect(decodeJwtPayload('not-a-jwt')).toBeNull();
        expect(decodeJwtPayload('only.one-dot')).toBeNull();
    });

    it('returns null when the payload section is not valid base64-json', () => {
        // header.payload.signature — payload is not base64
        expect(decodeJwtPayload('aa.@@@@.bb')).toBeNull();
    });

    it('returns the parsed payload object when valid', () => {
        const token = makeToken({ role: 'health', sub: 'user-1' });
        const payload = decodeJwtPayload(token);
        expect(payload).toMatchObject({ role: 'health', sub: 'user-1' });
    });

    it('decodes base64url payloads (RFC 7515) — real signers emit -/_ and no padding', () => {
        // Thai claims force bytes whose base64 contains '+'/'/' — a real JWT
        // encodes them as '-'/'_'. Bare atob() threw here, the middleware read
        // role=null, and a VALID session bounced to login.
        const json = JSON.stringify({ role: 'field_inspector', name: 'สมชาย ทดสอบ', sub: 'u-1' });
        const base64url = btoa(unescape(encodeURIComponent(json)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        const payload = decodeJwtPayload(`hh.${base64url}.ss`);
        expect(payload).toMatchObject({ role: 'field_inspector', sub: 'u-1' });
    });
});

describe('V1-D D1 — decodeCanonicalRoleFromToken', () => {
    it('reads `role` claim and normalises', () => {
        expect(decodeCanonicalRoleFromToken(makeToken({ role: 'system_admin_dtam' }))).toBe('system_admin_dtam');
        expect(decodeCanonicalRoleFromToken(makeToken({ role: 'health' }))).toBe('health');
    });

    it('reads `canonicalRole` claim when both are present', () => {
        // JWT ที่ยังไม่หมดอายุถือคำเดิม ('field_inspector') · การรีเนมเมื่อ 2026-09-10 ทำผ่าน
        // alias ⇒ โทเคนเก่ายังใช้ได้ และถูกแปลเป็นคำใหม่ให้เอง
        expect(
            decodeCanonicalRoleFromToken(makeToken({ canonicalRole: 'field_inspector', role: 'inspector' })),
        ).toBe('field_inspector');
    });

    it('falls back to `role` when `canonicalRole` is absent', () => {
        expect(decodeCanonicalRoleFromToken(makeToken({ role: 'dispatcher' }))).toBe('dispatcher');
    });

    it('returns null for unknown role string', () => {
        expect(decodeCanonicalRoleFromToken(makeToken({ role: 'mystery_role' }))).toBeNull();
    });

    it('returns null for malformed token', () => {
        expect(decodeCanonicalRoleFromToken('not-a-token')).toBeNull();
        expect(decodeCanonicalRoleFromToken(null)).toBeNull();
    });
});

describe('V1-D D1 — decideHealthAccess (6+ spec cases)', () => {
    // Per RFC: the 6 spec cases are admin / scheduler / reviewer /
    // auditor / account / health input.
    it('HEALTH role → allow', () => {
        const token = makeToken({ role: 'health', sub: 'user-h' });
        expect(decideHealthAccess(token)).toEqual({ decision: 'allow' });
    });

    it('admin role → redirect to provider dashboard', () => {
        const token = makeToken({ role: 'system_admin_dtam' });
        expect(decideHealthAccess(token)).toEqual({ decision: 'redirect-provider-dashboard' });
    });

    it('scheduler role → redirect to provider dashboard', () => {
        const token = makeToken({ role: 'dispatcher' });
        expect(decideHealthAccess(token)).toEqual({ decision: 'redirect-provider-dashboard' });
    });

    it('document_reviewer → redirect to provider dashboard', () => {
        const token = makeToken({ role: 'document_reviewer' });
        expect(decideHealthAccess(token)).toEqual({ decision: 'redirect-provider-dashboard' });
    });

    it('auditor role → redirect to provider dashboard', () => {
        const token = makeToken({ role: 'field_inspector' });
        expect(decideHealthAccess(token)).toEqual({ decision: 'redirect-provider-dashboard' });
    });

    it('account (legacy) role → redirect to provider dashboard', () => {
        const token = makeToken({ role: 'finance_officer_platform' });
        expect(decideHealthAccess(token)).toEqual({ decision: 'redirect-provider-dashboard' });
    });

    it('account_dtam role → redirect to provider dashboard', () => {
        const token = makeToken({ role: 'finance_officer_dtam' });
        expect(decideHealthAccess(token)).toEqual({ decision: 'redirect-provider-dashboard' });
    });

    it('account_platform role → redirect to provider dashboard', () => {
        const token = makeToken({ role: 'finance_officer_platform' });
        expect(decideHealthAccess(token)).toEqual({ decision: 'redirect-provider-dashboard' });
    });

    it('unknown role → redirect back to health login (safe default)', () => {
        const token = makeToken({ role: 'unknown_role_xyz' });
        expect(decideHealthAccess(token)).toEqual({ decision: 'redirect-health-login' });
    });

    it('missing / malformed token → redirect to health login', () => {
        expect(decideHealthAccess(null)).toEqual({ decision: 'redirect-health-login' });
        expect(decideHealthAccess('')).toEqual({ decision: 'redirect-health-login' });
        expect(decideHealthAccess('not-a-jwt')).toEqual({ decision: 'redirect-health-login' });
    });

    it('payload without role claim → redirect to health login', () => {
        const token = makeToken({ sub: 'user-1', exp: 9999999999 });
        expect(decideHealthAccess(token)).toEqual({ decision: 'redirect-health-login' });
    });
});

describe('V2-B RB-1 — decideProviderRouteAccess for /provider/applications', () => {
    // Mirrors the rule object added to `providerRouteRoleRules` in
    // middleware.ts. If the production rule changes shape (roles, prefix
    // order), this test must be updated in lock-step so it stays an
    // accurate proxy for the live middleware.
    //
    // FE-XC-02: use the SHIPPING rules table imported from middleware-helpers
    // (the same const middleware.ts consumes) — no hand-copied mirror to drift.
    const providerRules = PROVIDER_ROUTE_ROLE_RULES;

    const APP_DETAIL_PATH = '/provider/applications/abc-123';
    const APP_LIST_PATH = '/provider/applications';

    it('admin role is allowed onto /provider/applications/:id', () => {
        expect(decideProviderRouteAccess(APP_DETAIL_PATH, 'system_admin_dtam', providerRules))
            .toEqual({ decision: 'allow' });
    });

    it('document_reviewer role is allowed onto /provider/applications/:id', () => {
        expect(decideProviderRouteAccess(APP_DETAIL_PATH, 'document_reviewer', providerRules))
            .toEqual({ decision: 'allow' });
    });

    it('auditor role is allowed onto /provider/applications/:id (RB-5 canonical contract)', () => {
        expect(decideProviderRouteAccess(APP_DETAIL_PATH, 'field_inspector', providerRules))
            .toEqual({ decision: 'allow' });
    });

    it('scheduler role is redirected to provider dashboard', () => {
        expect(decideProviderRouteAccess(APP_DETAIL_PATH, 'dispatcher', providerRules))
            .toEqual({ decision: 'redirect-provider-dashboard' });
    });

    it('account_dtam role is redirected to provider dashboard', () => {
        expect(decideProviderRouteAccess(APP_DETAIL_PATH, 'finance_officer_dtam', providerRules))
            .toEqual({ decision: 'redirect-provider-dashboard' });
    });

    it('account_platform role is redirected to provider dashboard', () => {
        expect(decideProviderRouteAccess(APP_DETAIL_PATH, 'finance_officer_platform', providerRules))
            .toEqual({ decision: 'redirect-provider-dashboard' });
    });

    it('legacy account role is redirected to provider dashboard', () => {
        expect(decideProviderRouteAccess(APP_DETAIL_PATH, 'finance_officer_platform', providerRules))
            .toEqual({ decision: 'redirect-provider-dashboard' });
    });

    it('health role (loose-cookie scenario) is redirected to provider dashboard', () => {
        // Health users normally carry `auth_token` not `provider_token`,
        // so this branch is the "loose cookie" case where a health JWT
        // happens to be mounted as a provider cookie. The rule still
        // rejects because health is not in the allow-list.
        expect(decideProviderRouteAccess(APP_DETAIL_PATH, 'health', providerRules))
            .toEqual({ decision: 'redirect-provider-dashboard' });
    });

    it('missing / unknown role is redirected to provider dashboard', () => {
        expect(decideProviderRouteAccess(APP_DETAIL_PATH, null, providerRules))
            .toEqual({ decision: 'redirect-provider-dashboard' });
        expect(decideProviderRouteAccess(APP_DETAIL_PATH, '', providerRules))
            .toEqual({ decision: 'redirect-provider-dashboard' });
        expect(decideProviderRouteAccess(APP_DETAIL_PATH, 'mystery_role', providerRules))
            .toEqual({ decision: 'redirect-provider-dashboard' });
    });

    it('rule matches /provider/applications root listing (not just :id)', () => {
        expect(decideProviderRouteAccess(APP_LIST_PATH, 'document_reviewer', providerRules))
            .toEqual({ decision: 'allow' });
        expect(decideProviderRouteAccess(APP_LIST_PATH, 'dispatcher', providerRules))
            .toEqual({ decision: 'redirect-provider-dashboard' });
    });

    it('rule order: /provider/applications matched before bare /provider prefix', () => {
        // Sanity check the find-first-match semantics used by the real
        // middleware — the more specific rule wins. If a future edit
        // accidentally drops the /provider/applications entry, all the
        // negative cases above silently start passing because no rule
        // matches; this case fails loudly when the rule order breaks.
        const rule = providerRules.find((item) => APP_DETAIL_PATH.startsWith(item.prefix));
        expect(rule?.prefix).toBe('/provider/applications');
    });
});

describe('FE-XC-03 — default-deny on UNLISTED /provider/* paths (bare dashboard)', () => {
    const rules = PROVIDER_ROUTE_ROLE_RULES;
    const DASH = '/provider/dashboard'; // no specific rule → the default-deny path
    const PROFILE = '/provider/profile';

    it('valid provider roles are allowed onto the bare dashboard', () => {
        for (const role of ['system_admin_dtam', 'document_reviewer', 'field_inspector', 'dispatcher', 'finance_officer_dtam', 'finance_officer_platform', 'finance_officer_platform']) {
            expect(decideProviderRouteAccess(DASH, role, rules)).toEqual({ decision: 'allow' });
        }
    });

    it('HEALTH role in the provider cookie slot is bounced to provider login (not allowed, not a loop)', () => {
        // Pre-FE-XC-03 this returned { allow } because no rule matched the bare
        // dashboard. Now a non-provider role is denied → provider login (a
        // dashboard redirect would loop on this same path).
        expect(decideProviderRouteAccess(DASH, 'health', rules))
            .toEqual({ decision: 'redirect-provider-login' });
        expect(decideProviderRouteAccess(PROFILE, 'health', rules))
            .toEqual({ decision: 'redirect-provider-login' });
    });

    it('missing / unknown role on an unlisted path is bounced to provider login', () => {
        expect(decideProviderRouteAccess(DASH, null, rules)).toEqual({ decision: 'redirect-provider-login' });
        expect(decideProviderRouteAccess(DASH, '', rules)).toEqual({ decision: 'redirect-provider-login' });
        expect(decideProviderRouteAccess(DASH, 'mystery_role', rules)).toEqual({ decision: 'redirect-provider-login' });
    });
});

describe('V4-A RB-1 / UX-D1 — decideProviderRouteAccess for /provider/accounting + /provider/receipts', () => {
    // Mirrors the updated rule objects in `middleware.ts` (V4-A). Pre-V4
    // these rules listed only [ADMIN, ACCOUNT] which silently redirected
    // both ACCOUNT_DTAM and ACCOUNT_PLATFORM away from their own dashboards.
    // V4-A widens both rules to admit the Tier 16 split roles + the legacy
    // ACCOUNT migration role + AUDITOR for read-only finance oversight.
    //
    // See: docs/handoffs/iter-V4/00-rfc.md §UX-D1 / RB-1.
    // FE-XC-02: shipping rules table (imported), not a mirror.
    const providerRules = PROVIDER_ROUTE_ROLE_RULES;

    // The 6 roles × 2 prefixes matrix per RFC V4-A acceptance.
    const PREFIXES = [
        { prefix: '/provider/accounting', sample: '/provider/accounting/foo' },
        { prefix: '/provider/receipts', sample: '/provider/receipts/123' },
    ] as const;

    // operator 2026-09-27 S6: field_inspector moved from ADMIT to REDIRECT (no finance reads)
    const ADMIT = ['system_admin_dtam', 'finance_officer_platform', 'finance_officer_dtam'] as const;
    const REDIRECT = ['dispatcher', 'document_reviewer', 'field_inspector', 'health'] as const;

    describe.each(PREFIXES)('prefix $prefix', ({ sample }) => {
        it.each(ADMIT)('%s role is allowed (V4-A admission)', (role) => {
            expect(decideProviderRouteAccess(sample, role, providerRules))
                .toEqual({ decision: 'allow' });
        });

        it.each(REDIRECT)('%s role is redirected to provider dashboard', (role) => {
            expect(decideProviderRouteAccess(sample, role, providerRules))
                .toEqual({ decision: 'redirect-provider-dashboard' });
        });

        it('missing / unknown role is redirected', () => {
            expect(decideProviderRouteAccess(sample, null, providerRules))
                .toEqual({ decision: 'redirect-provider-dashboard' });
            expect(decideProviderRouteAccess(sample, 'mystery_role', providerRules))
                .toEqual({ decision: 'redirect-provider-dashboard' });
        });
    });

    it('rule order: /provider/accounting matched before bare /provider prefix', () => {
        const rule = providerRules.find((item) => '/provider/accounting/page'.startsWith(item.prefix));
        expect(rule?.prefix).toBe('/provider/accounting');
    });

    it('rule order: /provider/receipts matched before bare /provider prefix', () => {
        const rule = providerRules.find((item) => '/provider/receipts/abc'.startsWith(item.prefix));
        expect(rule?.prefix).toBe('/provider/receipts');
    });
});
