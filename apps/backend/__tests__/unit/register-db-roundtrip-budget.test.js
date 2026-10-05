'use strict';

/**
 * F-QA-01 (deep-qa 2026-09-06) — public farmer registration measured 5,585 ms
 * median over 20 real registrations on staging. Measured inside the container:
 * ONE database round trip = 364 ms (the app runs in Bangkok, its Supabase in
 * Seoul; prod/demo cross to Sydney). So the wall time of /auth/health/register
 * is essentially "how many statements does this path issue, one after another".
 *
 * This test is the budget. It drives the REAL path
 *   controller.register → prisma-auth-service.register → entity-service
 *   → consent-manager → audit-logger
 * against a counting Prisma stub, and pins the statement list. It is not a
 * micro-benchmark: it fails when someone adds a query, which is the only thing
 * that actually made this endpoint slow.
 *
 * Baseline it replaces (same harness, before the fix): 24 statements in 4
 * transactions, including a membership probe that could not match, a
 * per-consent user lookup for an organizationId the caller already held, and
 * THREE separate locked audit transactions.
 */

const mockCalls = [];

jest.mock('../../services/prisma-database', () => {
    const rows = {
        'systemConfig.findUnique': null,
        'organization.findUnique': { id: 'org-1', slug: 'default' },
        'user.create': (args) => ({
            id: 'user-1',
            organizationId: 'org-1',
            healthId: args?.data?.healthId,
            firstName: 'สมชาย',
            lastName: 'ใจดี',
            email: null,
            status: args?.data?.status,
        }),
        'user.findUnique': { organizationId: 'org-1' },
        'entityMembership.findFirst': null,
        'entity.findFirst': null,
        'entity.create': { id: 'ent-1', type: 'INDIVIDUAL' },
        'entityMembership.upsert': { id: 'mem-1' },
        'auditLog.findFirst': null,
        'auditLog.create': { id: 'audit-1' },
        'auditLog.createMany': { count: 3 },
        'userConsent.upsert': (args) => ({ id: `consent-${args?.create?.category}`, ...args?.create }),
        // Retired shapes, still answered so that running this budget against an
        // older revision counts its statements honestly instead of erroring out
        // half way and looking cheaper than it was.
        'userConsent.findFirst': null,
        'userConsent.create': (args) => ({ id: `consent-${args?.data?.category}`, ...args?.data }),
        'userConsent.update': (args) => ({ id: 'consent-1', ...args?.data }),
    };

    const modelProxy = () => new Proxy({}, {
        get(_t, model) {
            if (model === 'then') { return undefined; }
            return new Proxy({}, {
                get(_t2, op) {
                    if (op === 'then') { return undefined; }
                    return async (args) => {
                        const key = `${String(model)}.${String(op)}`;
                        mockCalls.push(key);
                        const v = rows[key];
                        if (typeof v === 'function') { return v(args); }
                        return v === undefined ? null : v;
                    };
                },
            });
        },
    });

    const makeClient = () => new Proxy(modelProxy(), {
        get(t, prop) {
            if (prop === '$transaction') {
                return async (arg) => {
                    mockCalls.push('BEGIN');
                    try {
                        return typeof arg === 'function' ? await arg(makeClient()) : await Promise.all(arg);
                    } finally {
                        mockCalls.push('COMMIT');
                    }
                };
            }
            if (prop === '$executeRaw' || prop === '$executeRawUnsafe' || prop === '$queryRaw') {
                return async () => { mockCalls.push(String(prop)); return 1; };
            }
            return t[prop];
        },
    });

    return { prisma: makeClient(), basePrisma: makeClient(), TRANSACTION_OPTIONS: {} };
});

const AuthService = require('../../services/prisma-auth-service');
const { auditLogger } = require('../../middleware/audit-logger');
const { consentManager, RequiredConsents } = require('../../middleware/consent-manager');
const { createHealthAuthProfileHandlers } = require('../../controllers/auth-controller/health-auth-profile-handlers');

const handlers = createHealthAuthProfileHandlers({
    AuthService,
    auditLogger,
    logger: { debug() { }, error() { }, info() { }, warn() { } },
    fs: { unlink() { } },
    getRequestIp: () => '1.2.3.4',
    sendErrorResponse: (res, _req, e) => res.status(e.status).json(e),
    sendSuccessResponse: (res, _req, s) => res.status(s.status).json(s),
    setAuthCookies: () => 'csrf',
    sanitizeUserPayload: (u) => u,
    consentManager,
    requiredConsents: RequiredConsents,
});

const mockRes = () => ({
    statusCode: 0, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
});

const body = () => ({
    healthId: '1100000000008',
    password: 'Str0ng#Pass99',
    phoneNumber: '0812345678',
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    accountType: 'INDIVIDUAL',
    acceptedTermsOfService: true,
    acceptedPrivacyPolicy: true,
});

async function registerOnce() {
    mockCalls.length = 0;
    const res = mockRes();
    await handlers.register({ body: body(), file: null, headers: { 'user-agent': 'jest' } }, res);
    return { res, calls: [...mockCalls] };
}

const statements = (calls) => calls.filter((c) => c !== 'BEGIN' && c !== 'COMMIT');

describe('F-QA-01 — /auth/health/register issues a bounded number of DB statements', () => {
    test('a registration still succeeds through the real path', async () => {
        const { res } = await registerOnce();
        expect(res.statusCode).toBe(201);
    });

    test('the whole path costs at most 14 statements in at most 2 transactions', async () => {
        await registerOnce(); // warm the audit logger's cached default-org id
        const { calls } = await registerOnce();

        // 24 before the fix. Every statement here crosses a region.
        expect(statements(calls).length).toBeLessThanOrEqual(14);
        expect(calls.filter((c) => c === 'BEGIN').length).toBeLessThanOrEqual(2);
    });

    test('the removed round trips stay removed', async () => {
        await registerOnce();
        const { calls } = await registerOnce();

        // The user row is created inside the transaction, so no EntityMembership
        // can reference it — the probe could only ever return null.
        expect(calls).not.toContain('entityMembership.findFirst');
        // The consent writer is handed the organizationId the caller already
        // holds; it must not look the user up again (once per category).
        expect(calls).not.toContain('user.findUnique');
        // One upsert per consent, not findFirst + create.
        expect(calls).not.toContain('userConsent.findFirst');
        expect(calls.filter((c) => c === 'userConsent.upsert')).toHaveLength(RequiredConsents.length);
    });

    test('all three audit rows are written — in ONE locked transaction, not three', async () => {
        await registerOnce();
        const { calls } = await registerOnce();

        // The audit trail is NOT skipped: one batched insert covers
        // REGISTER_SUCCESS + one CONSENT_GRANTED per required consent.
        expect(calls.filter((c) => c === 'auditLog.createMany')).toHaveLength(1);
        expect(calls.filter((c) => c === 'auditLog.create')).toHaveLength(0);
        expect(calls.filter((c) => c === '$executeRaw')).toHaveLength(1); // one advisory lock
        expect(calls.filter((c) => c === 'auditLog.findFirst')).toHaveLength(1); // one tail read
    });

    test('the user + personal-entity writes still happen inside ONE transaction', async () => {
        const { calls } = await registerOnce();
        const begin = calls.indexOf('BEGIN');
        const commit = calls.indexOf('COMMIT');
        const inFirstTx = calls.slice(begin + 1, commit);
        expect(inFirstTx).toEqual(expect.arrayContaining([
            'user.create', 'entity.create', 'entityMembership.upsert',
        ]));
    });
});
