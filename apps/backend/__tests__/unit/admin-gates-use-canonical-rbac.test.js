'use strict';

/**
 * SSOT — two admin gates decide authorization from the RAW role column instead
 * of the canonical RBAC single source of truth.
 *
 *   interoperability-core.js:44  requireAdminRole  (POST /v1/certificates/:n/revoke)
 *       const role = String(req.user?.role || '').toUpperCase();
 *       if (role === 'system_admin_dtam' || role === 'system_admin_dtam' || role === 'system_admin_platform')
 *
 *   system/provider.js:252       POST /  (create a provider account)
 *       const currentUserRole = String(req.user?.role || '').toLowerCase();
 *       if (currentUserRole !== 'system_admin_dtam' && currentUserRole !== 'system_admin_dtam')
 *
 * The consequence is a FALSE DENIAL, not a privilege escalation — worth stating
 * precisely, because the two need different urgency. `req.user.role` is the raw
 * legacy column, and ROLE_ALIASES maps several spellings onto one canonical
 * role. Hand-rolled string comparison sees only the spellings someone thought
 * to enumerate:
 *
 *   raw 'system_admin_platform'  → normalizeRole → 'system_admin_platform'  → BOTH gates DENY
 *   raw 'system_admin_platform'  → normalizeRole → 'system_admin_platform'  → provider.js DENIES
 *
 * So a legitimate platform operator is locked out of certificate revocation and
 * provider-account creation. provider.js is the sharper case because that file
 * documents the opposite rule three lines from the bug: resolveDirectoryManager
 * (lines 60-72) admits ADMIN *and* PLATFORM_ADMIN precisely "so platform
 * operators can manage any tenant's staff", and every other mutation in the file
 * uses it. Creating a provider account is a directory mutation; :252 is simply
 * the one handler that never got converted.
 *
 * Both sites also evade scripts/ci/check-identity-field-usage.js, whose
 * ROLE_COMPARISON regex matches a direct `req.user.role ===` comparison. These
 * assign the raw role to a local first and compare the local, so the gate
 * reported OK while two live authorization decisions bypassed the SSOT. That
 * gap is closed alongside this fix — a guardrail that misses the cases it was
 * written for is worse than none, because it is trusted.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const { CANONICAL_ROLES } = require('../../shared/canonical-rbac');
const { requireAdminRole } = require('../../routes/api/interoperability/interoperability-core');

function runGate(user) {
    const req = { user };
    const res = {
        statusCode: null,
        body: null,
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; },
    };
    let nexted = false;
    requireAdminRole(req, res, () => { nexted = true; });
    return { allowed: nexted, status: res.statusCode };
}

describe('SSOT — interoperability requireAdminRole resolves roles canonically', () => {
    it('admits a platform admin whose RAW role is the platform_owner alias', () => {
        // ROLE_ALIASES maps platform_owner -> platform_admin. The hand-rolled
        // uppercase comparison never enumerated this spelling.
        expect(runGate({ id: 'u1', role: 'system_admin_platform' }).allowed).toBe(true);
    });

    it('admits the canonical lowercase spellings the migration will produce', () => {
        expect(runGate({ id: 'u1', role: 'system_admin_dtam' }).allowed).toBe(true);
        expect(runGate({ id: 'u1', role: 'system_admin_platform' }).allowed).toBe(true);
    });

    it('prefers canonicalRole over the raw column when both are present', () => {
        expect(runGate({ id: 'u1', canonicalRole: CANONICAL_ROLES.SYSTEM_ADMIN_DTAM, role: 'GARBAGE' }).allowed).toBe(true);
    });

    it('still admits the spellings that already worked', () => {
        for (const raw of ['system_admin_dtam', 'system_admin_dtam', 'system_admin_platform']) {
            expect(runGate({ id: 'u1', role: raw }).allowed).toBe(true);
        }
    });

    it('still refuses every non-admin role', () => {
        for (const raw of ['field_inspector', 'field_inspector', 'HEALTH', 'health', 'dispatcher', 'DOCUMENT_REVIEWER', 'finance_officer_platform']) {
            const r = runGate({ id: 'u1', role: raw });
            expect(r.allowed).toBe(false);
            expect(r.status).toBe(403);
        }
    });

    it('refuses an unknown or absent role rather than defaulting open', () => {
        for (const user of [{ id: 'u1', role: 'NOPE' }, { id: 'u1' }, {}, null, undefined]) {
            expect(runGate(user).allowed).toBe(false);
        }
    });
});

// ── provider.js POST / ──────────────────────────────────────────────────────

let mockUser = null;
jest.mock('../../middleware/auth-middleware', () => {
    const pass = (req, _res, next) => { req.user = mockUser; next(); };
    return { authenticateProvider: pass, authenticateAny: pass, authenticateHealth: pass };
});

const mockUserFindFirst = jest.fn(async () => null);
const mockUserCreate = jest.fn(async ({ data }) => ({ id: 'new-1', ...data }));
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: {
            findFirst: (...a) => mockUserFindFirst(...a),
            findUnique: jest.fn(async () => null),
            create: (...a) => mockUserCreate(...a),
            findMany: jest.fn(async () => []),
            count: jest.fn(async () => 0),
        },
        $transaction: jest.fn(async (cb) => cb({})),
    },
}));

const providerRouter = require('../../routes/api/system/provider');

function providerApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/provider', providerRouter);
    return app;
}

const NEW_ACCOUNT = {
    email: 'new.officer@dtam.go.th',
    password: 'CorrectHorseBatteryStaple9',
    firstName: 'สมหญิง',
    lastName: 'ตรวจดี',
    role: 'field_inspector',
    providerId: '1234567890123',
};

/** 403 means the ROLE GATE refused; anything else means it let us past it. */
async function postAsRole(rawRole, extra = {}) {
    mockUser = { id: 'caller', organizationId: 'org-1', role: rawRole, ...extra };
    const res = await request(providerApp()).post('/api/provider').send(NEW_ACCOUNT);
    return res.status;
}

describe('SSOT — provider create gate matches this file own admin convention', () => {
    beforeEach(() => jest.clearAllMocks());

    it('admits PLATFORM_ADMIN, as resolveDirectoryManager in this same file does', async () => {
        // Lines 60-72 admit ADMIN + PLATFORM_ADMIN for directory mutations
        // "so platform operators can manage any tenant's staff". Creating an
        // account is a directory mutation; this handler was the outlier.
        expect(await postAsRole('system_admin_platform')).not.toBe(403);
    });

    it('admits the platform_owner alias', async () => {
        expect(await postAsRole('system_admin_platform')).not.toBe(403);
    });

    it('still admits ADMIN and SUPER_ADMIN', async () => {
        expect(await postAsRole('system_admin_dtam')).not.toBe(403);
        expect(await postAsRole('system_admin_dtam')).not.toBe(403);
    });

    it('prefers canonicalRole over the raw column', async () => {
        expect(await postAsRole('GARBAGE', { canonicalRole: CANONICAL_ROLES.SYSTEM_ADMIN_DTAM })).not.toBe(403);
    });

    it('still refuses every non-admin role', async () => {
        for (const raw of ['field_inspector', 'field_inspector', 'dispatcher', 'DOCUMENT_REVIEWER', 'finance_officer_platform', 'HEALTH']) {
            expect(await postAsRole(raw)).toBe(403);
        }
    });

    it('refuses an unknown role rather than defaulting open', async () => {
        expect(await postAsRole('NOPE')).toBe(403);
        expect(await postAsRole(undefined)).toBe(403);
    });
});
