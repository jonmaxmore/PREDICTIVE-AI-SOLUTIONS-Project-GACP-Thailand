'use strict';

/**
 * ThaID identity service — resolveThaidLogin / decodeIdTokenSubject /
 * assertAutoProvisionableRole (feat/auth-thaid-oauth).
 *
 * RED-first (Law 3.11): written before services/auth/thaid-identity-service.js
 * exists — first run fails at `require` (module not found).
 *
 * Operator-mandated guards under test (2026-08-05):
 *   - only citizen (non-provider) roles may be auto-provisioned / auto-linked
 *     → national-ID hitting a PROVIDER-role user REJECTS
 *       (AUTH_AUTOPROVISION_ROLE_FORBIDDEN), no link written
 *   - auto-provision is fail-closed in production
 *       (AUTH_AUTOPROVISION_DISABLED), register() never called
 *   - subject MUST be the opaque id_token `sub` (never `pid`)
 */

const mockIdentityLink = {
    findUnique: jest.fn(),
    upsert: jest.fn(),
};
const mockUser = {
    findFirst: jest.fn(),
};
jest.mock('../../services/prisma-database', () => ({
    prisma: { identityLink: mockIdentityLink, user: mockUser },
}));

const mockRegister = jest.fn();
jest.mock('../../services/prisma-auth-service', () => ({
    register: (...a) => mockRegister(...a),
}));

// Deterministic lookup HMAC so the test never depends on ENCRYPTION_KEY.
jest.mock('../../utils/field-encryption', () => ({
    computeLookupHmac: (v) => `hmac(${v})`,
}));

const {
    resolveThaidLogin,
    persistThaidLink,
    decodeIdTokenSubject,
    decodeIdTokenClaims,
    assertAutoProvisionableRole,
} = require('../../services/auth/thaid-identity-service');

/** base64url-encode a header.payload. JWT (signature blank — origin is trusted backchannel) */
function makeJwt(payload) {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`;
}

const NATIONAL_ID = '1234567890123';

let nodeEnvBackup;
beforeEach(() => {
    jest.clearAllMocks();
    nodeEnvBackup = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
});
afterEach(() => {
    process.env.NODE_ENV = nodeEnvBackup;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('decodeIdTokenSubject', () => {
    it('returns the opaque sub for a valid JWT', () => {
        expect(decodeIdTokenSubject(makeJwt({ sub: 'opaque-sub-abc', pid: NATIONAL_ID }))).toBe('opaque-sub-abc');
    });

    it('returns null for garbage / missing sub / non-string input (never throws)', () => {
        expect(decodeIdTokenSubject('not-a-jwt')).toBeNull();
        expect(decodeIdTokenSubject('aaa.@@@notbase64json@@@.ccc')).toBeNull();
        expect(decodeIdTokenSubject(makeJwt({ notSub: 1 }))).toBeNull();
        expect(decodeIdTokenSubject(makeJwt({ sub: 123 }))).toBeNull();
        expect(decodeIdTokenSubject(null)).toBeNull();
        expect(decodeIdTokenSubject(undefined)).toBeNull();
        expect(decodeIdTokenSubject('')).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 4 (audit-verified two-shape gap): §6.2.2's "**" note (evidence/AUTH-01/
// manual-citations.md:134-135) — pid/given_name/family_name sit top-level on
// the token response WITHOUT `openid` scope, or INSIDE the id_token WITH it.
// decodeIdTokenClaims is the reader auth-idp.js's resolveThaidSession uses to
// see whichever of those the id_token itself actually carries — it never
// assumes a shape, it reports what is there. decodeIdTokenSubject (above) is
// now a thin wrapper over this function; its own describe block already pins
// that the refactor kept `sub` extraction byte-identical.
describe('decodeIdTokenClaims — two-shape pid/name reader (Task 4)', () => {
    it('extracts sub + pid + given_name + family_name together when the id_token carries all four (openid-scope shape)', () => {
        const claims = decodeIdTokenClaims(makeJwt({
            sub: 'opaque-sub-abc', pid: NATIONAL_ID,
            given_name: 'สมศรี', family_name: 'ทดสอบระบบ',
        }));
        expect(claims).toEqual({
            sub: 'opaque-sub-abc', pid: NATIONAL_ID,
            given_name: 'สมศรี', family_name: 'ทดสอบระบบ',
        });
    });

    it('missing individual claims (no-openid shape: id_token carries only sub) come back null, not undefined/thrown', () => {
        expect(decodeIdTokenClaims(makeJwt({ sub: 'opaque-sub-abc' }))).toEqual({
            sub: 'opaque-sub-abc', pid: null, given_name: null, family_name: null,
        });
    });

    it('a non-string claim value is treated as absent (null), same discipline as decodeIdTokenSubject', () => {
        expect(decodeIdTokenClaims(makeJwt({ sub: 'x', pid: 1234567890123 }))).toEqual({
            sub: 'x', pid: null, given_name: null, family_name: null,
        });
    });

    it('returns null (never throws) for garbage / missing / non-string input — mirrors decodeIdTokenSubject', () => {
        expect(decodeIdTokenClaims('not-a-jwt')).toBeNull();
        expect(decodeIdTokenClaims('aaa.@@@notbase64json@@@.ccc')).toBeNull();
        expect(decodeIdTokenClaims(null)).toBeNull();
        expect(decodeIdTokenClaims(undefined)).toBeNull();
        expect(decodeIdTokenClaims('')).toBeNull();
    });

    it('decodeIdTokenSubject(sub) === decodeIdTokenClaims(sub).sub for the same token (wrapper pin)', () => {
        const jwt = makeJwt({ sub: 'shared-sub-value', pid: NATIONAL_ID });
        expect(decodeIdTokenSubject(jwt)).toBe(decodeIdTokenClaims(jwt).sub);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assertAutoProvisionableRole', () => {
    it('throws AUTH_AUTOPROVISION_ROLE_FORBIDDEN for a provider role', () => {
        expect(() => assertAutoProvisionableRole('auditor')).toThrow();
        try {
            assertAutoProvisionableRole('reviewer');
            throw new Error('should have thrown');
        } catch (err) {
            expect(err.code).toBe('AUTH_AUTOPROVISION_ROLE_FORBIDDEN');
        }
    });

    it('passes for a citizen (non-provider) role', () => {
        expect(() => assertAutoProvisionableRole('health')).not.toThrow();
    });

    it('throws AUTH_AUTOPROVISION_ROLE_FORBIDDEN for an unknown/foreign role (allow-list, fail-closed)', () => {
        // normalizeRole() returns null for an unrecognised role string; a
        // deny-list on isProviderRole() would then FAIL OPEN and auto-link it.
        // The guard must be an ALLOW-list: only a citizen role is permitted.
        try {
            assertAutoProvisionableRole('some-unknown-role');
            throw new Error('should have thrown');
        } catch (err) {
            expect(err.code).toBe('AUTH_AUTOPROVISION_ROLE_FORBIDDEN');
        }
        expect(() => assertAutoProvisionableRole(null)).toThrow();
        expect(() => assertAutoProvisionableRole(undefined)).toThrow();
        expect(() => assertAutoProvisionableRole('')).toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Council final-fix round, Item 2: resolveThaidLogin is now PURE RESOLUTION —
// it never writes identity_links (create OR touch). It returns
// `{ user, subjectKey }` instead of the bare user, so the caller
// (auth-idp.js resolveThaidSession) can defer the identity_links write
// (persistThaidLink, tested in its own describe block below) until AFTER its
// own 2FA gate decides no challenge is needed. Every assertion below that
// used to check `mockIdentityLink.upsert` being called BY resolveThaidLogin
// now asserts the opposite — upsert is NEVER called from this function,
// under any branch, including auto-provision (which still calls register()
// to create the USER row — unavoidable, you cannot know a fresh account's
// 2FA status without creating it — but never touches identity_links).
describe('resolveThaidLogin', () => {
    it('missing subject → throws AUTH_IDP_PROFILE_INCOMPLETE', async () => {
        await expect(resolveThaidLogin({ subject: null, nationalId: NATIONAL_ID }))
            .rejects.toMatchObject({ code: 'AUTH_IDP_PROFILE_INCOMPLETE' });
        expect(mockRegister).not.toHaveBeenCalled();
        expect(mockIdentityLink.upsert).not.toHaveBeenCalled();
    });

    // Task 4 (c): neither shape (top-level nor id_token-embedded) yielded a
    // pid — the route-layer extraction in auth-idp.js resolves `nationalId`
    // to undefined, which lands here unchanged. No existing link, no
    // national-id match possible (there is no id to match on) and
    // NODE_ENV=test (non-production) → falls through to auto-provision,
    // which itself fails closed on a missing national id. This is
    // PRE-EXISTING behaviour (the `if (!nationalId)` guard below step 4,
    // untouched by Task 4) — newly pinned here because it is the outcome the
    // two-shape extraction must degrade to when BOTH sources come up empty.
    it('(c) neither shape yields a pid (nationalId undefined) + no existing link/match → AUTH_IDP_PROFILE_INCOMPLETE, register() never called', async () => {
        mockIdentityLink.findUnique.mockResolvedValue(null);
        mockUser.findFirst.mockResolvedValue(null);

        await expect(resolveThaidLogin({ subject: 'sub-no-pid-anywhere', nationalId: undefined }))
            .rejects.toMatchObject({ code: 'AUTH_IDP_PROFILE_INCOMPLETE' });

        expect(mockRegister).not.toHaveBeenCalled();
        expect(mockIdentityLink.upsert).not.toHaveBeenCalled();
    });

    it('new subject + new national id (NODE_ENV=test) → register once, return {user, subjectKey}, NO identity_links write', async () => {
        mockIdentityLink.findUnique.mockResolvedValue(null);
        mockUser.findFirst.mockResolvedValue(null);
        const created = { id: 'u-new', role: 'health', firstName: 'สมชาย', lastName: 'ใจดี' };
        mockRegister.mockResolvedValue(created);

        const result = await resolveThaidLogin({
            subject: 'sub-new', nationalId: NATIONAL_ID,
            firstNameTh: 'สมชาย', lastNameTh: 'ใจดี',
        });

        expect(mockRegister).toHaveBeenCalledTimes(1);
        expect(mockRegister.mock.calls[0][0]).toMatchObject({
            healthId: NATIONAL_ID,
            firstName: 'สมชาย',
            lastName: 'ใจดี',
            accountType: 'INDIVIDUAL',
        });
        // auto-generated password must be present and not the caller's
        expect(typeof mockRegister.mock.calls[0][0].password).toBe('string');
        expect(mockRegister.mock.calls[0][0].password.length).toBeGreaterThan(0);
        // Item 2: resolveThaidLogin itself never writes identity_links.
        expect(mockIdentityLink.upsert).not.toHaveBeenCalled();
        expect(result.user).toBe(created);
        // R-D Task 3: the returned subjectKey is the DERIVED key
        // (thaidSubjectKey → computeLookupHmac('idp:thaid:'+sub), faked above
        // as `hmac(${v})`) — never the raw ThaID sub — so the caller can
        // persist the link later without re-deriving it.
        expect(result.subjectKey).toBe('hmac(idp:thaid:sub-new)');
    });

    it('NEGATIVE (operator-required): national id matches an EXISTING PROVIDER-role user → REJECT + no link', async () => {
        mockIdentityLink.findUnique.mockResolvedValue(null);
        mockUser.findFirst.mockResolvedValue({ id: 'staff-1', role: 'reviewer' });

        await expect(resolveThaidLogin({ subject: 'sub-staff', nationalId: NATIONAL_ID }))
            .rejects.toMatchObject({ code: 'AUTH_AUTOPROVISION_ROLE_FORBIDDEN' });

        expect(mockIdentityLink.upsert).not.toHaveBeenCalled();
        expect(mockRegister).not.toHaveBeenCalled();
    });

    it('national id matches an existing CITIZEN user → return {user, subjectKey} (no register, no identity_links write)', async () => {
        mockIdentityLink.findUnique.mockResolvedValue(null);
        const citizen = { id: 'u-cit', role: 'health' };
        mockUser.findFirst.mockResolvedValue(citizen);

        const result = await resolveThaidLogin({ subject: 'sub-cit', nationalId: NATIONAL_ID });

        expect(result.user).toBe(citizen);
        expect(typeof result.subjectKey).toBe('string');
        expect(mockRegister).not.toHaveBeenCalled();
        // Item 2: no write happens during resolution — the caller persists
        // the link later, once its own 2FA gate clears.
        expect(mockIdentityLink.upsert).not.toHaveBeenCalled();
    });

    it('NEGATIVE (operator-required): no link + no national-id match + NODE_ENV=production → REJECT + no register', async () => {
        process.env.NODE_ENV = 'production';
        mockIdentityLink.findUnique.mockResolvedValue(null);
        mockUser.findFirst.mockResolvedValue(null);

        await expect(resolveThaidLogin({ subject: 'sub-prod', nationalId: NATIONAL_ID }))
            .rejects.toMatchObject({ code: 'AUTH_AUTOPROVISION_DISABLED' });

        expect(mockRegister).not.toHaveBeenCalled();
        expect(mockIdentityLink.upsert).not.toHaveBeenCalled();
    });

    it('existing link to a citizen (HEALTH) role → return {user, subjectKey} WITHOUT provisioning or touching the link', async () => {
        const linkedUser = { id: 'u-linked', role: 'health', firstName: 'x' };
        mockIdentityLink.findUnique.mockResolvedValue({ userId: 'u-linked', user: linkedUser, isActive: true });

        const result = await resolveThaidLogin({ subject: 'sub-linked', nationalId: NATIONAL_ID });

        expect(result.user).toBe(linkedUser);
        expect(mockRegister).not.toHaveBeenCalled();
        expect(mockUser.findFirst).not.toHaveBeenCalled();
        // Item 2: the existing-link branch is READ ONLY — resolveThaidLogin
        // itself never touches (upserts) the link. A failed-MFA attempt on
        // this branch must leave identity_links completely untouched.
        expect(mockIdentityLink.upsert).not.toHaveBeenCalled();
    });

    // Item 4 (isActive kill-switch): an admin-deactivated link must not be
    // resolved for login at all — reject BEFORE the role guard, and leave
    // the row untouched (no write of any kind).
    it('NEGATIVE (Item 4): existing link with isActive=false → REJECT AUTH_LINKING_INACTIVE, link untouched, still inactive', async () => {
        const linkedUser = { id: 'u-deactivated', role: 'health', firstName: 'x' };
        mockIdentityLink.findUnique.mockResolvedValue({
            userId: 'u-deactivated', user: linkedUser, isActive: false,
        });

        await expect(resolveThaidLogin({ subject: 'sub-deactivated', nationalId: NATIONAL_ID }))
            .rejects.toMatchObject({ code: 'AUTH_LINKING_INACTIVE' });

        expect(mockRegister).not.toHaveBeenCalled();
        // "still inactive in the captured args": no upsert call at all means
        // the row's isActive is never touched — it stays exactly false.
        expect(mockIdentityLink.upsert).not.toHaveBeenCalled();
    });

    it('POSITIVE control: existing link with isActive OMITTED (legacy row, pre-Item-4 shape) → resolves as active', async () => {
        const linkedUser = { id: 'u-legacy-link', role: 'health', firstName: 'x' };
        mockIdentityLink.findUnique.mockResolvedValue({ userId: 'u-legacy-link', user: linkedUser });

        const result = await resolveThaidLogin({ subject: 'sub-legacy', nationalId: NATIONAL_ID });

        expect(result.user).toBe(linkedUser);
    });

    // R-A Task 2 (existing-link rider): an existing (provider='thaid', subject)
    // link used to return the linked user for ANY role with no assertion — a
    // staff account that had ever acquired a link (admin error, or a link
    // created before this guard existed) would be a 2FA-free ThaID door,
    // since resolveThaidSession/issueTokensForAuthenticatedUser only checks
    // the CURRENT user's twoFactorEnabled, not whether ThaID should be
    // reachable for that role at all. Fail-closed default (council ruling
    // R-A): non-citizen roles are rejected the same way branch 3 (national-ID
    // match) already rejects them — reusing assertAutoProvisionableRole so
    // both branches share one predicate and one error code.
    it('NEGATIVE (R-A Task 2): existing link to a non-citizen (staff) role → REJECT, link untouched', async () => {
        const staffUser = { id: 'staff-linked', role: 'auditor', firstName: 'x' };
        mockIdentityLink.findUnique.mockResolvedValue({ userId: 'staff-linked', user: staffUser, isActive: true });

        await expect(resolveThaidLogin({ subject: 'sub-staff-linked', nationalId: NATIONAL_ID }))
            .rejects.toMatchObject({ code: 'AUTH_AUTOPROVISION_ROLE_FORBIDDEN' });

        // Rejected BEFORE touching the link (mirrors branch 3's assert order).
        expect(mockIdentityLink.upsert).not.toHaveBeenCalled();
        expect(mockRegister).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Council final-fix round, Item 2 + Item 4 — persistThaidLink is the ONLY
// place identity_links is written for ThaID. The caller (auth-idp.js
// resolveThaidSession) invokes it exclusively on the actual-mint branch.
describe('persistThaidLink', () => {
    it('no existing row → creates with isActive:true', async () => {
        mockIdentityLink.upsert.mockResolvedValue({});

        await persistThaidLink('hmac(idp:thaid:sub-x)', 'u-x');

        expect(mockIdentityLink.upsert).toHaveBeenCalledTimes(1);
        const arg = mockIdentityLink.upsert.mock.calls[0][0];
        expect(arg.where).toEqual({
            provider_subject: { provider: 'thaid', subject: 'hmac(idp:thaid:sub-x)' },
        });
        expect(arg.create).toEqual({
            provider: 'thaid', subject: 'hmac(idp:thaid:sub-x)', userId: 'u-x', isActive: true,
        });
    });

    // Item 4: the update clause must NOT force isActive:true — an
    // admin-deactivated row's isActive must survive a later touch
    // untouched. (In practice resolveThaidLogin's isActive guard means this
    // function is only ever reached for an active row, but the update
    // clause itself must not be the thing papering over a deactivation.)
    it('existing row → update touches ONLY lastLoginAt, never forces isActive', async () => {
        mockIdentityLink.upsert.mockResolvedValue({});

        await persistThaidLink('hmac(idp:thaid:sub-y)', 'u-y');

        const arg = mockIdentityLink.upsert.mock.calls[0][0];
        expect(arg.update).toHaveProperty('lastLoginAt');
        expect(arg.update.lastLoginAt).toBeInstanceOf(Date);
        expect(Object.prototype.hasOwnProperty.call(arg.update, 'isActive')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(arg.update, 'userId')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// R-D Task 3 — domain-separated subject derivation (council ruling R-D).
//
// ThaID's `sub` is documented (sandbox onboarding doc, 2026-08) as the RAW
// 13-digit national ID (CID) itself — not an opaque per-app identifier the
// OIDC id_token shape implies. thaidSubjectKey(sub) = computeLookupHmac(
// 'idp:thaid:' + sub) is the ONE function every identity_links read/write
// for provider='thaid' must go through, so the raw sub never reaches prisma
// or a log, and the derived value can never collide with
// computeLookupHmac(sub) unlabelled — the byte-identical value
// users.healthIdHmac/idCardHmac store for the SAME CID — which is exactly
// the cross-column joinability the identity_links.subject schema comment
// forbids.
//
// These pins load the REAL utils/field-encryption (NOT the deterministic
// `hmac(${v})` fake mocked at the top of this file — that fake would make
// pin (a)'s inequality assertion meaningless, since both sides would run
// through the identical fake function) via jest.doMock + jest.requireActual
// inside a resetModules() reload. prisma-database / prisma-auth-service stay
// mocked through the SAME mockIdentityLink/mockUser/mockRegister jest.fn()s
// declared at the top of this file: jest.resetModules() clears the require
// cache but not those closures, so the already-registered jest.mock
// factories for those two modules re-resolve to the identical fn objects on
// reload — only utils/field-encryption's resolution changes here.
describe('thaidSubjectKey — domain-separated derivation, real crypto (R-D Task 3)', () => {
    let real;
    let realComputeLookupHmac;

    beforeAll(() => {
        jest.resetModules();
        jest.doMock('../../utils/field-encryption', () => jest.requireActual('../../utils/field-encryption'));
        realComputeLookupHmac = jest.requireActual('../../utils/field-encryption').computeLookupHmac;
        real = require('../../services/auth/thaid-identity-service');
    });

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.NODE_ENV = 'test';
    });

    const SUB = '1111122222333'; // ThaID sub documented as the raw 13-digit CID

    it('(a) DOMAIN-SEPARATION: thaidSubjectKey(sub) !== computeLookupHmac(sub) unlabelled, for the SAME sub', () => {
        expect(typeof real.thaidSubjectKey).toBe('function');
        const derived = real.thaidSubjectKey(SUB);
        const unlabelled = realComputeLookupHmac(SUB);
        expect(typeof derived).toBe('string');
        expect(derived.length).toBeGreaterThan(0);
        // `unlabelled` is the exact byte-identical value users.healthIdHmac /
        // users.idCardHmac would hold for the same CID — must never match
        // (cross-column joinability is the thing being prevented).
        expect(derived).not.toBe(unlabelled);
    });

    it('(b) STABILITY: same sub → same key every call, and the key resolveThaidLogin RETURNS is what persistThaidLink writes and a later lookup searches for', async () => {
        const keyOnce = real.thaidSubjectKey(SUB);
        const keyTwice = real.thaidSubjectKey(SUB);
        expect(keyOnce).toBe(keyTwice);

        // Auto-provision path: no existing link, no national-id match → creates one.
        // Item 2: resolveThaidLogin itself does not write identity_links —
        // the caller (here, the test, standing in for auth-idp.js) persists
        // the link via persistThaidLink using the RETURNED subjectKey.
        mockIdentityLink.findUnique.mockResolvedValueOnce(null);
        mockUser.findFirst.mockResolvedValueOnce(null);
        const created = { id: 'u-real-crypto', role: 'health' };
        mockRegister.mockResolvedValueOnce(created);

        const resolved = await real.resolveThaidLogin({ subject: SUB, nationalId: '9174693837311' });
        expect(resolved.subjectKey).toBe(keyOnce);
        expect(mockIdentityLink.upsert).not.toHaveBeenCalled();

        mockIdentityLink.upsert.mockResolvedValueOnce({});
        await real.persistThaidLink(resolved.subjectKey, resolved.user.id);

        const upsertArgs = mockIdentityLink.upsert.mock.calls[0][0];
        expect(upsertArgs.where).toEqual({ provider_subject: { provider: 'thaid', subject: keyOnce } });
        expect(upsertArgs.create.subject).toBe(keyOnce);
        expect(upsertArgs.create.subject).not.toBe(SUB);

        // A later login with the SAME sub must look up by the SAME derived
        // key (simulating the row persisted above), never the raw sub —
        // neither create() nor findUnique() ever sees the raw value.
        mockIdentityLink.findUnique.mockImplementationOnce(({ where }) => {
            expect(where.provider_subject.subject).toBe(keyOnce);
            expect(where.provider_subject.subject).not.toBe(SUB);
            return Promise.resolve({ userId: created.id, user: created, isActive: true });
        });

        const foundResolved = await real.resolveThaidLogin({ subject: SUB, nationalId: '9174693837311' });
        expect(foundResolved.user).toBe(created);
        expect(foundResolved.subjectKey).toBe(keyOnce);
    });

    it('(c) RAW-CID-NOWHERE: a fake 13-digit sub never appears in any identity_links (findUnique/upsert) call arg', async () => {
        const RAW_SUB = '4445556667778';
        mockIdentityLink.findUnique.mockResolvedValueOnce(null);
        mockUser.findFirst.mockResolvedValueOnce(null);
        const created = { id: 'u-raw-scan', role: 'health' };
        mockRegister.mockResolvedValueOnce(created);

        const resolved = await real.resolveThaidLogin({ subject: RAW_SUB, nationalId: '1010101010101' });
        mockIdentityLink.upsert.mockResolvedValueOnce({});
        await real.persistThaidLink(resolved.subjectKey, resolved.user.id);

        const identityLinkCalls = [
            ...mockIdentityLink.findUnique.mock.calls,
            ...mockIdentityLink.upsert.mock.calls,
        ];
        expect(identityLinkCalls.length).toBeGreaterThan(0);
        for (const call of identityLinkCalls) {
            expect(JSON.stringify(call)).not.toContain(RAW_SUB);
        }
    });
});
