// M2a Task 3 — the ministry edits the document law through an API, not a deploy.
// Spec: design note 2026-08-15-membership-m2-documents-and-poa-design §3
// Plan: design note 2026-08-15-m2a-requirement-engine Task 3
//
// Surface under test: routes/api/admin/requirement-rules.js, mounted by
// routes/api/admin/index.js under the parent authenticateProvider + requireAdmin
// chain (the route installs NO guard of its own — convention of admin/audit-log.js
// and admin/user-permissions.js).
//
//   GET  /api/admin/requirement-rules            ?at= &includeClosed=
//   POST /api/admin/requirement-rules            insert a rule
//   POST /api/admin/requirement-rules/:id/close  retire a rule
//
// What this file holds down:
//   (1) The app is mounted through the REAL admin router, so "it is reachable at
//       /api/admin/requirement-rules" and "a non-admin gets 403" are one and the
//       same proof — a route that is never mounted cannot pass these.
//   (2) requirement-rule-service stays REAL (only prisma + the audit writer are
//       mocked), so 201 means a row was actually shaped and an audit row actually
//       emitted — not that a stub resolved.
//   (3) Validation of all three dimensions, because a rule that is mistyped is a
//       rule that never fires: a law nobody can see failing (plan review M6).
//       'RENEW' is pinned as a REJECTED word — the vocabulary is NEW / RENEWAL /
//       REPLACEMENT and a fifth synonym must never be born here.

'use strict';

const express = require('express');
const request = require('supertest');

// ── Auth mock (admin-routes-rbac.test.js / admin-user-permissions-route.test.js
//    pattern): x-test-role builds req.user; no header = 401. ──────────────────
jest.mock('../../middleware/auth-middleware', () => {
    const buildHeaderUser = (req, _res, next) => {
        const role = req.headers['x-test-role'];
        if (!role || role === 'anonymous') {
            return _res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        req.user = {
            id: req.headers['x-test-user-id'] || 'admin-1',
            email: req.headers['x-test-email'] || 'admin-1@example.com',
            role,
            canonicalRole: req.headers['x-test-canonical-role'] || role,
            healthId: role === 'health' ? 'health-1' : null,
            providerId: role !== 'health' ? 'provider-1' : null,
            organizationId: req.headers['x-test-organization-id'] || 'org-1',
        };
        return next();
    };
    const requireRole = () => (_req, _res, next) => next();
    return {
        authenticateHealth: buildHeaderUser,
        authenticateAny: buildHeaderUser,
        authenticateProvider: buildHeaderUser,
        authenticateDTAM: buildHeaderUser,
        authenticate: buildHeaderUser,
        requireRole,
        optionalAuth: buildHeaderUser,
        requireVerification: (_req, _res, next) => next(),
        checkPermission: () => (_req, _res, next) => next(),
        rateLimitSensitive: () => (_req, _res, next) => next(),
    };
});

// canonical-rbac + the slot SSOT stay REAL — the whole point of the validation
// tests is that they run against the real vocabulary.
jest.mock('../../shared/canonical-rbac', () => jest.requireActual('../../shared/canonical-rbac'));

// ── prisma: the requirement_rules table plus the models the sibling admin
//    sub-routers touch at import/mount time. ─────────────────────────────────
const mockRuleFindMany = jest.fn();
const mockRuleFindUnique = jest.fn();
const mockRuleCreate = jest.fn();
const mockRuleUpdate = jest.fn();

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        requirementRule: {
            findMany: (...args) => mockRuleFindMany(...args),
            findUnique: (...args) => mockRuleFindUnique(...args),
            create: (...args) => mockRuleCreate(...args),
            update: (...args) => mockRuleUpdate(...args),
        },
        // Sibling admin routers are pulled in by the real admin/index.js mount.
        user: { count: jest.fn().mockResolvedValue(0) },
        application: { count: jest.fn().mockResolvedValue(0) },
        certificate: { count: jest.fn().mockResolvedValue(0) },
        farm: { count: jest.fn().mockResolvedValue(0) },
        userPermissionGrant: {
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({}),
            delete: jest.fn().mockResolvedValue({}),
        },
        $transaction: jest.fn(async (cb) => cb({})),
    },
}));

// audit-logger: real constants (AuditCategory / AuditSeverity / ResourceType),
// stubbed writer — same shape as requirement-rule-service.test.js:33.
jest.mock('../../middleware/audit-logger', () => {
    const actual = jest.requireActual('../../middleware/audit-logger');
    return {
        ...actual,
        auditLogger: {
            log: jest.fn().mockResolvedValue({ id: 'audit-1' }),
            logWithin: jest.fn().mockResolvedValue({ id: 'audit-1' }),
            isSequenceConflictError: jest.fn(() => false),
        },
    };
});

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const { auditLogger, AuditCategory, ResourceType } = require('../../middleware/audit-logger');

// The REAL admin router — mounting through it is what proves the new sub-router
// is actually wired into /api/admin (a forgotten `router.use` fails here).
const adminRouter = require('../../routes/api/admin');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminRouter);
    return app;
}

const BASE = '/api/admin/requirement-rules';

const AT_ISO = '2026-08-15T03:00:00.000Z';
const AT = new Date(AT_ISO);

function ruleRow(overrides = {}) {
    return {
        id: 'rule-1',
        createdAt: new Date('2026-08-15T00:00:00.000Z'),
        holderType: 'JURISTIC',
        requestType: null,
        plantCode: null,
        slotId: 'company_reg',
        isRequired: true,
        maxDocumentAgeMonths: 6,
        effectiveFrom: new Date('2026-08-15T00:00:00.000Z'),
        effectiveTo: null,
        createdBy: 'SYSTEM-M2A-SEED',
        reason: 'operator ruling 2026-08-15',
        closedBy: null,
        closedAt: null,
        ...overrides,
    };
}

function asAdmin(app, method, path) {
    return request(app)[method](path)
        .set('x-test-role', 'system_admin_dtam')
        .set('x-test-user-id', 'admin-1')
        .set('x-test-organization-id', 'org-1');
}

let app;

beforeAll(() => { app = buildApp(); });

beforeEach(() => {
    jest.clearAllMocks();
    mockRuleFindMany.mockResolvedValue([ruleRow()]);
    mockRuleFindUnique.mockResolvedValue(null);
    mockRuleCreate.mockImplementation(async ({ data }) => ({ id: 'rule-new-1', createdAt: new Date(), ...data }));
    mockRuleUpdate.mockImplementation(async ({ where, data }) => ({ ...ruleRow(), id: where.id, ...data }));
    auditLogger.log.mockResolvedValue({ id: 'audit-1' });
});

// ───────────────────────────────────────────────────────────────────────────
describe('the surface is admin-only — and mounted (both proven by one request)', () => {
    const NON_ADMIN_ROLES = ['document_reviewer', 'scheduler', 'auditor', 'account_dtam', 'health'];

    test.each(NON_ADMIN_ROLES)('%s cannot read the rules (403, no query fired)', async (role) => {
        const res = await request(app).get(BASE).set('x-test-role', role).send();
        expect(res.status).toBe(403);
        expect(mockRuleFindMany).not.toHaveBeenCalled();
    });

    test.each(NON_ADMIN_ROLES)('%s cannot write a rule (403, nothing created, nothing audited)', async (role) => {
        const res = await request(app).post(BASE).set('x-test-role', role)
            .send({ slotId: 'company_reg', holderType: 'JURISTIC' });
        expect(res.status).toBe(403);
        expect(mockRuleCreate).not.toHaveBeenCalled();
        expect(auditLogger.log).not.toHaveBeenCalled();
    });

    test.each(NON_ADMIN_ROLES)('%s cannot close a rule (403, no update)', async (role) => {
        const res = await request(app).post(`${BASE}/rule-1/close`).set('x-test-role', role)
            .send({ reason: 'superseded' });
        expect(res.status).toBe(403);
        expect(mockRuleUpdate).not.toHaveBeenCalled();
    });

    test('an anonymous caller gets 401, not 403 (auth sits before the admin gate)', async () => {
        expect((await request(app).get(BASE).send()).status).toBe(401);
        expect((await request(app).post(BASE).send({ slotId: 'company_reg' })).status).toBe(401);
        expect((await request(app).post(`${BASE}/rule-1/close`).send({})).status).toBe(401);
        expect(mockRuleFindMany).not.toHaveBeenCalled();
        expect(mockRuleCreate).not.toHaveBeenCalled();
    });
});

// ───────────────────────────────────────────────────────────────────────────
describe('GET / — the law as of a date', () => {
    test('returns the rules in force NOW by default (open window, deterministic order)', async () => {
        const res = await asAdmin(app, 'get', BASE).send();

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.rows).toHaveLength(1);
        // Policy is not PII — the whole row goes back, provenance included.
        expect(res.body.data.rows[0]).toMatchObject({
            id: 'rule-1', slotId: 'company_reg', holderType: 'JURISTIC', createdBy: 'SYSTEM-M2A-SEED',
        });

        expect(mockRuleFindMany).toHaveBeenCalledTimes(1);
        const arg = mockRuleFindMany.mock.calls[0][0];
        // The window is the same one rulesAt uses: started on or before the
        // instant asked about, not yet closed at it.
        expect(arg.where.effectiveFrom.lte).toBeInstanceOf(Date);
        expect(arg.where.OR).toEqual([{ effectiveTo: null }, { effectiveTo: { gt: arg.where.effectiveFrom.lte } }]);
        expect(arg.orderBy).toEqual([{ slotId: 'asc' }, { effectiveFrom: 'asc' }]);
    });

    test('?at= asks the question as of THAT instant, not now', async () => {
        const res = await asAdmin(app, 'get', `${BASE}?at=${encodeURIComponent(AT_ISO)}`).send();

        expect(res.status).toBe(200);
        expect(res.body.data.at).toBe(AT_ISO);
        const arg = mockRuleFindMany.mock.calls[0][0];
        expect(arg.where.effectiveFrom.lte.getTime()).toBe(AT.getTime());
        expect(arg.where.OR[1].effectiveTo.gt.getTime()).toBe(AT.getTime());
    });

    test('?includeClosed=true drops the window so retired rules stay readable (AC3)', async () => {
        mockRuleFindMany.mockResolvedValue([ruleRow(), ruleRow({
            id: 'rule-closed', effectiveTo: new Date('2026-08-14T00:00:00.000Z'), closedBy: 'admin-1',
        })]);

        const res = await asAdmin(app, 'get', `${BASE}?includeClosed=true`).send();

        expect(res.status).toBe(200);
        expect(res.body.data.includeClosed).toBe(true);
        expect(res.body.data.rows).toHaveLength(2);
        const arg = mockRuleFindMany.mock.calls[0][0];
        expect(arg.where.effectiveFrom).toBeUndefined();
        expect(arg.where.OR).toBeUndefined();
    });

    test('?at=garbage is refused (400) instead of silently answering about now', async () => {
        const res = await asAdmin(app, 'get', `${BASE}?at=not-a-date`).send();

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(mockRuleFindMany).not.toHaveBeenCalled();
    });
});

// ───────────────────────────────────────────────────────────────────────────
describe('POST / — new law enters as a row', () => {
    test('201: the row is created under the caller and an audit row is emitted', async () => {
        const res = await asAdmin(app, 'post', BASE).send({
            holderType: 'JURISTIC',
            requestType: 'NEW',
            slotId: 'company_reg',
            maxDocumentAgeMonths: 6,
            effectiveFrom: AT_ISO,
            reason: 'ประกาศกรมฯ 2569',
        });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.id).toBe('rule-new-1');

        expect(mockRuleCreate).toHaveBeenCalledTimes(1);
        const { data } = mockRuleCreate.mock.calls[0][0];
        expect(data).toMatchObject({
            holderType: 'JURISTIC',
            requestType: 'NEW',
            plantCode: null,
            // v2 canon (spec 2026-09-01): 'company_reg' is one of the spellings
            // the กทล.1 slot fold retired, so what reaches the row is the กทล.1
            // slot the ministry names. Typed either way, stored one way.
            slotId: 'juristic_reg_6m',
            isRequired: true,
            maxDocumentAgeMonths: 6,
            // Provenance is the SESSION's, never the body's.
            createdBy: 'admin-1',
            reason: 'ประกาศกรมฯ 2569',
        });
        expect(data.effectiveFrom.getTime()).toBe(AT.getTime());

        expect(auditLogger.log).toHaveBeenCalledTimes(1);
        const event = auditLogger.log.mock.calls[0][0];
        expect(event.action).toBe('REQUIREMENT_RULE_CREATED');
        expect(event.category).toBe(AuditCategory.ADMIN);
        expect(event.resourceType).toBe(ResourceType.SYSTEM);
        expect(event.resourceId).toBe('rule-new-1');
        expect(event.actorId).toBe('admin-1');
        expect(event.metadata).toMatchObject({ slotId: 'juristic_reg_6m', holderType: 'JURISTIC' });
    });

    test('a slot written through an old alias is stored canonical (LAND_TITLE → land_rights)', async () => {
        const res = await asAdmin(app, 'post', BASE).send({ slotId: 'LAND_TITLE' });

        expect(res.status).toBe(201);
        expect(mockRuleCreate.mock.calls[0][0].data.slotId).toBe('land_rights');
    });

    test('all three dimensions omitted = a rule that binds everyone (201, NULLs stored)', async () => {
        const res = await asAdmin(app, 'post', BASE).send({ slotId: 'id_card' });

        expect(res.status).toBe(201);
        expect(mockRuleCreate.mock.calls[0][0].data).toMatchObject({
            // กทล.1 asks for the ID card and the house registration as ONE
            // attachment, so the old two-slot spelling now stores as one.
            holderType: null, requestType: null, plantCode: null, slotId: 'id_house_reg',
        });
    });

    test('an explicit null dimension is accepted the same way', async () => {
        const res = await asAdmin(app, 'post', BASE)
            .send({ slotId: 'id_card', holderType: null, requestType: null });

        expect(res.status).toBe(201);
        expect(mockRuleCreate.mock.calls[0][0].data.holderType).toBeNull();
    });

    test('an unknown slot is refused (400) — a law about a slot that does not exist can never fire', async () => {
        const res = await asAdmin(app, 'post', BASE).send({ slotId: 'company_registration_certificate' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INVALID_SLOT_ID');
        expect(mockRuleCreate).not.toHaveBeenCalled();
        expect(auditLogger.log).not.toHaveBeenCalled();
    });

    test('a missing slot is refused (400)', async () => {
        const res = await asAdmin(app, 'post', BASE).send({ holderType: 'JURISTIC' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INVALID_SLOT_ID');
        expect(mockRuleCreate).not.toHaveBeenCalled();
    });

    test('an unknown holderType is refused (400) and the answer names the accepted set', async () => {
        const res = await asAdmin(app, 'post', BASE).send({ slotId: 'company_reg', holderType: 'COMPANY' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INVALID_HOLDER_TYPE');
        expect(res.body.allowed).toEqual(['INDIVIDUAL', 'JURISTIC', 'COMMUNITY_ENTERPRISE']);
        expect(mockRuleCreate).not.toHaveBeenCalled();
    });

    test("'RENEW' is refused (400): the vocabulary is NEW/RENEWAL/REPLACEMENT and gets no fifth word", async () => {
        const res = await asAdmin(app, 'post', BASE).send({ slotId: 'company_reg', requestType: 'RENEW' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INVALID_REQUEST_TYPE');
        expect(res.body.allowed).toEqual(['NEW', 'RENEWAL', 'REPLACEMENT']);
        expect(mockRuleCreate).not.toHaveBeenCalled();
    });

    test.each(['NEW', 'RENEWAL', 'REPLACEMENT'])('%s is accepted', async (requestType) => {
        const res = await asAdmin(app, 'post', BASE).send({ slotId: 'company_reg', requestType });

        expect(res.status).toBe(201);
        expect(mockRuleCreate.mock.calls[0][0].data.requestType).toBe(requestType);
    });

    test.each(['INDIVIDUAL', 'JURISTIC', 'COMMUNITY_ENTERPRISE'])('%s is accepted', async (holderType) => {
        const res = await asAdmin(app, 'post', BASE).send({ slotId: 'company_reg', holderType });

        expect(res.status).toBe(201);
        expect(mockRuleCreate.mock.calls[0][0].data.holderType).toBe(holderType);
    });

    // ── audit M2a F3 — a dimension nothing asks about ────────────────────────
    //
    // The column exists and the service stores it, but the gate never sends a
    // plantCode (application-document-requirements.js:201 asks rulesAt for
    // holderType + requestType only) and rulesAt pins the dimension to
    // {plantCode: null} when the caller does not name it. A per-plant rule filed
    // today would therefore answer 201, emit an audit row, and bind nobody —
    // ever. Refusing it is the honest answer until the gate carries the plant
    // dimension (M2b+).
    test('a per-plant rule is refused (400) instead of being filed as law that can never fire', async () => {
        const res = await asAdmin(app, 'post', BASE).send({ slotId: 'company_reg', plantCode: 'cannabis' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('PLANT_DIMENSION_NOT_SUPPORTED');
        expect(mockRuleCreate).not.toHaveBeenCalled();
        expect(auditLogger.log).not.toHaveBeenCalled();
    });

    test('the refusal says WHY, so the admin does not simply retype it', async () => {
        const res = await asAdmin(app, 'post', BASE).send({ slotId: 'company_reg', plantCode: 'CANNABIS' });

        expect(res.status).toBe(400);
        expect(String(res.body.error)).toContain('plantCode');
    });

    // PIN: the two spellings of "no plant dimension" stay accepted.
    test.each([null, ''])('plantCode %p still means "every plant" (201)', async (plantCode) => {
        const res = await asAdmin(app, 'post', BASE).send({ slotId: 'company_reg', plantCode });

        expect(res.status).toBe(201);
        expect(mockRuleCreate.mock.calls[0][0].data.plantCode).toBeNull();
    });

    // ── review r0 F6 — the กทล.1 case dimensions must survive the door ───────
    //
    // Before this, the handler built the service payload from named fields only,
    // so POST {slotId:'landlord_consent', landTenure:'RENTED'} answered 201,
    // emitted a REQUIREMENT_RULE_CREATED audit row, and stored landTenure NULL —
    // a rule binding EVERY case, the inverse of what the ministry typed, with no
    // error anywhere. This is the only door a human types the law through.
    test('201: landTenure/areaType/certScope reach the row and the audit row', async () => {
        // landlord_consent now that the กทล.1 slot catalog carries it: this is
        // the rule the ministry actually files with landTenure RENTED, and an
        // unknown slot would be refused one check earlier.
        const res = await asAdmin(app, 'post', BASE).send({
            slotId: 'landlord_consent',
            landTenure: 'RENTED',
            areaType: 'INDOOR',
            certScope: 'PLANTING',
            reason: 'ประกาศกรมฯ 2569 ส่วนที่ ๓',
        });

        expect(res.status).toBe(201);
        expect(mockRuleCreate.mock.calls[0][0].data).toMatchObject({
            slotId: 'landlord_consent', landTenure: 'RENTED', areaType: 'INDOOR', certScope: 'PLANTING',
        });
        expect(auditLogger.log.mock.calls[0][0].metadata).toMatchObject({
            landTenure: 'RENTED', areaType: 'INDOOR', certScope: 'PLANTING',
        });
    });

    test('the case dimensions are optional — omitted still means "every case" (201, NULLs)', async () => {
        const res = await asAdmin(app, 'post', BASE).send({ slotId: 'id_card' });

        expect(res.status).toBe(201);
        expect(mockRuleCreate.mock.calls[0][0].data).toMatchObject({
            landTenure: null, areaType: null, certScope: null,
        });
    });

    test.each([
        ['landTenure', 'LEASED', 'INVALID_LAND_TENURE', ['OWNED', 'STATE_PERMITTED', 'RENTED']],
        ['areaType', 'GLASSHOUSE', 'INVALID_AREA_TYPE', ['OUTDOOR', 'GREENHOUSE', 'INDOOR']],
        ['certScope', 'EXPORT', 'INVALID_CERT_SCOPE', ['PLANTING', 'PROCESSING']],
    ])('a mistyped %s is refused (400) and the answer names the accepted set', async (field, value, code, allowed) => {
        const res = await asAdmin(app, 'post', BASE).send({ slotId: 'company_reg', [field]: value });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe(code);
        expect(res.body.allowed).toEqual(allowed);
        expect(String(res.body.error)).toContain(value);
        expect(mockRuleCreate).not.toHaveBeenCalled();
        expect(auditLogger.log).not.toHaveBeenCalled();
    });

    test('an unparsable effectiveFrom surfaces as 400, not 500', async () => {
        const res = await asAdmin(app, 'post', BASE)
            .send({ slotId: 'company_reg', effectiveFrom: 'the day after tomorrow' });

        expect(res.status).toBe(400);
        expect(mockRuleCreate).not.toHaveBeenCalled();
    });

    test('a DB failure is a 500 that leaks no internals', async () => {
        mockRuleCreate.mockRejectedValue(new Error('connection to 10.0.0.5:5432 refused'));

        const res = await asAdmin(app, 'post', BASE).send({ slotId: 'company_reg' });

        expect(res.status).toBe(500);
        expect(JSON.stringify(res.body)).not.toContain('10.0.0.5');
    });
});

// ───────────────────────────────────────────────────────────────────────────
describe('fix round 4 — controlled_herb_license is decided by law, not by the register', () => {
    it.each(['controlled_herb_license', 'CONTROLLED_HERB_LICENSE'])('refuses %s with a Thai message and writes nothing', async (slotId) => {
        const res = await asAdmin(app, 'post', BASE).send({ slotId, certScope: 'PLANTING' });
        expect(res.status).toBe(400);
        expect(res.body.code || res.body.error).toBe('REQUIREMENT_RULE_SLOT_LAW_DECIDED');
        expect(JSON.stringify(res.body)).toMatch(/กฎหมาย|ไม่รับ/);
        expect(mockRuleCreate).not.toHaveBeenCalled();
        expect(auditLogger.log).not.toHaveBeenCalled();
    });
});

describe('POST /:id/close — retiring a rule is the only touch a row ever gets', () => {
    test('200: exactly effectiveTo/closedBy/closedAt are written, plus an audit row', async () => {
        mockRuleFindUnique.mockResolvedValue(ruleRow({ id: 'rule-1' }));

        const res = await asAdmin(app, 'post', `${BASE}/rule-1/close`)
            .send({ reason: 'superseded by ministry order 12/2569' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        expect(mockRuleUpdate).toHaveBeenCalledTimes(1);
        const call = mockRuleUpdate.mock.calls[0][0];
        expect(Object.keys(call.data).sort()).toEqual(['closedAt', 'closedBy', 'effectiveTo']);
        expect(call.data.closedBy).toBe('admin-1');
        expect(call.where).toEqual({ id: 'rule-1', effectiveTo: null });

        const event = auditLogger.log.mock.calls[0][0];
        expect(event.action).toBe('REQUIREMENT_RULE_CLOSED');
        expect(event.resourceId).toBe('rule-1');
        expect(event.metadata).toMatchObject({ reason: 'superseded by ministry order 12/2569' });
    });

    test('closing a rule that was already closed is a 409, not a second stamp', async () => {
        mockRuleFindUnique.mockResolvedValue(ruleRow({ effectiveTo: new Date('2026-08-14T00:00:00.000Z') }));

        const res = await asAdmin(app, 'post', `${BASE}/rule-1/close`).send({ reason: 'again' });

        expect(res.status).toBe(409);
        expect(mockRuleUpdate).not.toHaveBeenCalled();
    });

    test('closing a rule that does not exist is a 404', async () => {
        mockRuleFindUnique.mockResolvedValue(null);

        const res = await asAdmin(app, 'post', `${BASE}/ghost/close`).send({ reason: 'nothing there' });

        expect(res.status).toBe(404);
        expect(mockRuleUpdate).not.toHaveBeenCalled();
    });

    test('there is no route that edits a rule body — PUT/PATCH/DELETE do not exist', async () => {
        for (const method of ['put', 'patch', 'delete']) {
            const res = await asAdmin(app, method, `${BASE}/rule-1`).send({ slotId: 'id_card' });
            expect(res.status).toBe(404);
        }
        expect(mockRuleUpdate).not.toHaveBeenCalled();
    });
});
