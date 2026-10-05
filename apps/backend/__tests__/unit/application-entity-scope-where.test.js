// Farm-worker Wave A, Chunk 4 (2026-07-02) — application queries gain an
// entity-scope branch at the ONE chokepoint (buildHealthWhereClause).
//
// Interaction that makes this necessary (not just nice): the read-side
// prisma extension ALREADY ANDs `entityId: <active entity>` into every
// Application read when an entity context is bound. For a workspace
// co-member the legacy applicant pin then yields
//     applicant=worker AND entityId=workspace  →  EMPTY SET
// because workspace rows belong to the owner. The fix is to RELAX the pin
// to entity scope when (and only when) the caller explicitly acts under a
// workspace (x-active-entity-id header, membership already validated
// ACTIVE by active-entity-middleware — spoofed headers 403 before this
// code runs). The personal default context keeps today's where BYTE-FOR-BYTE.
//
// The middleware now marks context origin: header → personal:false
// (explicit workspace choice), default personal INDIVIDUAL → personal:true.

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        entityMembership: { findUnique: jest.fn(), findFirst: jest.fn() },
        entity: { findFirst: jest.fn() },
        application: { findFirst: jest.fn(), update: jest.fn() },
    },
}));

// deleteDraft (application-draft-query-methods) pulls audit-trail at factory
// time — stub it so the suite stays DB/Redis-free.
jest.mock('../../services/audit-trail', () => ({
    logAction: jest.fn(),
    ACTIONS: { SUBMIT: 'SUBMIT' },
    ENTITIES: { APPLICATION: 'APPLICATION' },
    SEVERITY: { INFO: 'INFO' },
}));

jest.mock('../../utils/field-encryption', () => ({
    maskThaiId: (v) => v,
    computeLookupHmac: () => null,
}));

jest.mock('../../services/user-lookup-service', () => ({
    findUserByHealthIdSecurely: jest.fn(),
}));

jest.mock('../../shared/logger', () => {
    const noop = () => {};
    const fake = { debug: noop, info: noop, warn: noop, error: noop };
    return { ...fake, createLogger: () => fake };
});

const { prisma } = require('../../services/prisma-database');
const { runWithEntityContext } = require('../../services/entity-context');
const { createApplicationIdentityMethods } = require('../../services/application-service/application-identity-methods');
const { createApplicationDraftQueryMethods } = require('../../services/application-service/application-draft-query-methods');
const { activeEntityMiddleware, HEADER_NAME } = require('../../middleware/active-entity-middleware');

const USER_ID = '9f8b7c6d-1111-4222-8333-abcdefabcdef';

function buildMethods() {
    const noop = () => {};
    return createApplicationIdentityMethods({
        prisma: {},
        logger: { debug: noop, info: noop, warn: noop, error: noop },
    });
}

describe('Wave A chunk 4 — buildHealthWhereClause entity branch', () => {
    const { buildHealthWhereClause } = buildMethods();

    it('no entity context (script/headless) → byte-identical legacy applicant pin', () => {
        const where = buildHealthWhereClause(USER_ID, {});
        expect(JSON.stringify(where)).toBe(JSON.stringify({
            applicant: { id: USER_ID, isDeleted: false },
        }));
    });

    it('personal default context → byte-identical legacy applicant pin (solo farmer unchanged)', () => {
        const where = runWithEntityContext(
            { entityId: 'ent-personal', role: 'OWNER', personal: true },
            () => buildHealthWhereClause(USER_ID, {}),
        );
        expect(JSON.stringify(where)).toBe(JSON.stringify({
            applicant: { id: USER_ID, isDeleted: false },
        }));
    });

    it('workspace context (ACTIVE membership, header-chosen) → entityId-scoped where', () => {
        const where = runWithEntityContext(
            { entityId: 'ent-juristic-1', role: 'MANAGER', personal: false },
            () => buildHealthWhereClause(USER_ID, {}),
        );
        expect(where).toEqual({ entityId: 'ent-juristic-1' });
    });

    it('workspace context with a healthId-only caller also scopes by entity', () => {
        const where = runWithEntityContext(
            { entityId: 'ent-juristic-1', role: 'ADMIN', personal: false },
            () => buildHealthWhereClause(null, { healthId: '1234567890123' }),
        );
        expect(where).toEqual({ entityId: 'ent-juristic-1' });
    });

    it('defense-in-depth: workspace context but NO caller identity → null (refuse broad query)', () => {
        const where = runWithEntityContext(
            { entityId: 'ent-juristic-1', role: 'MANAGER', personal: false },
            () => buildHealthWhereClause(null, {}),
        );
        expect(where).toBeNull();
    });
});

describe('Wave A chunk 4 — middleware marks context origin (personal vs workspace)', () => {
    const middleware = activeEntityMiddleware();

    function makeRes() {
        const res = { _status: 200, _json: null };
        res.status = (s) => { res._status = s; return res; };
        res.json = (b) => { res._json = b; return res; };
        return res;
    }

    beforeEach(() => jest.clearAllMocks());

    it('header-chosen entity → personal:false on req.activeEntity', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue({
            role: 'MANAGER', status: 'ACTIVE', entity: { type: 'JURISTIC' },
        });
        const req = {
            user: { id: 'worker-1', healthId: '1234567890123' },
            headers: { [HEADER_NAME]: 'ent-juristic-1' },
        };
        let nextCalled = false;
        await middleware(req, makeRes(), () => { nextCalled = true; });
        expect(nextCalled).toBe(true);
        expect(req.activeEntity).toEqual({ entityId: 'ent-juristic-1', role: 'MANAGER', personal: false });
    });

    it('no header → personal INDIVIDUAL default with personal:true', async () => {
        prisma.entityMembership.findFirst.mockResolvedValue({ entityId: 'ent-personal-1' });
        const req = {
            user: { id: 'farmer-1', healthId: '1234567890123' },
            headers: {},
        };
        let nextCalled = false;
        await middleware(req, makeRes(), () => { nextCalled = true; });
        expect(nextCalled).toBe(true);
        expect(req.activeEntity).toEqual({ entityId: 'ent-personal-1', role: 'OWNER', personal: true });
    });

    // Wave A fix S1 (adversarial-verify 2026-07-02): the FE PERSISTS the
    // picker choice and auto-sends the header for everyone — including solo
    // farmers whose stored choice IS their own personal INDIVIDUAL entity.
    // Header-presence alone must NOT flip them to the relaxed entity where
    // (that would drop the applicant pin + applicant.isDeleted guard for
    // ~every web user). OWN personal entity named in the header → still
    // personal:true → buildHealthWhereClause keeps the strict legacy pin.
    it('S1: header naming the user\'s OWN personal INDIVIDUAL entity → personal:true + strict pin (REAL path)', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue({
            role: 'OWNER',
            status: 'ACTIVE',
            entity: { type: 'INDIVIDUAL' },
        });
        const req = {
            user: { id: USER_ID, healthId: '1234567890123' },
            headers: { [HEADER_NAME]: 'ent-personal-1' },
        };
        let observedWhere = 'unset';
        await middleware(req, makeRes(), () => {
            observedWhere = buildMethods().buildHealthWhereClause(USER_ID, {});
        });
        expect(req.activeEntity).toEqual({ entityId: 'ent-personal-1', role: 'OWNER', personal: true });
        // The byte-compare: same where as the legacy solo-farmer pin.
        expect(JSON.stringify(observedWhere)).toBe(JSON.stringify({
            applicant: { id: USER_ID, isDeleted: false },
        }));
    });

    it('S1: header naming a JURISTIC workspace keeps personal:false (relaxed where unchanged)', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue({
            role: 'OWNER',
            status: 'ACTIVE',
            entity: { type: 'JURISTIC' },
        });
        const req = {
            user: { id: USER_ID, healthId: '1234567890123' },
            headers: { [HEADER_NAME]: 'ent-juristic-1' },
        };
        let observedWhere = 'unset';
        await middleware(req, makeRes(), () => {
            observedWhere = buildMethods().buildHealthWhereClause(USER_ID, {});
        });
        expect(req.activeEntity).toEqual({ entityId: 'ent-juristic-1', role: 'OWNER', personal: false });
        expect(observedWhere).toEqual({ entityId: 'ent-juristic-1' });
    });
});

// ─────────────────────────────────────────────────────────────────────
// Wave A fix M2 (adversarial-verify 2026-07-02) — deleteDraft must use the
// STRICT applicant pin, never the workspace-relaxed `{ entityId }` where.
// Reads stay relaxed (co-members see workspace drafts); destructive draft
// ops stay personal (soft-delete is permanent-grade — DRAFT_DELETE is not
// in the Wave-B taxonomy).
// ─────────────────────────────────────────────────────────────────────
describe('Wave A fix M2 — deleteDraft keeps the strict applicant pin', () => {
    const noop = () => {};
    const noopLogger = { debug: noop, info: noop, warn: noop, error: noop };

    function buildDraftService() {
        const identity = createApplicationIdentityMethods({ prisma, logger: noopLogger });
        const drafts = createApplicationDraftQueryMethods({
            prisma,
            feeService: {
                calculateApplicationFees: () => ({
                    phase1: { total: 5535 }, phase2: { total: 27675 }, total: 33210, scopeCount: 1,
                }),
            },
            sendNotification: jest.fn(),
            NotifyType: {},
            logger: noopLogger,
        });
        return Object.assign({}, identity, drafts);
    }

    const WORKSPACE_CTX = { entityId: 'ent-juristic-1', role: 'MANAGER', personal: false };
    // Spec 2026-09-30 Task 3: health reads take the caller's holder scope
    // (R ∩ active entity in R1). deleteDraft keeps the strict pin AND the fragment.
    const HOLDER_SCOPE = { userId: USER_ID, readIds: ['ent-juristic-1'], editIds: ['ent-juristic-1'] };
    const SCOPE_OPTS = { healthId: '1234567890123', strictHealthId: true, holderScope: HOLDER_SCOPE };

    beforeEach(() => jest.clearAllMocks());

    it('under a workspace context the delete lookup pins the APPLICANT, not the entity', async () => {
        prisma.application.findFirst.mockResolvedValue(null);
        const svc = buildDraftService();

        await runWithEntityContext(WORKSPACE_CTX, () =>
            svc.deleteDraft(USER_ID, 'draft-1', SCOPE_OPTS),
        );

        expect(prisma.application.findFirst).toHaveBeenCalledTimes(1);
        const where = prisma.application.findFirst.mock.calls[0][0].where;
        expect(Object.keys(where).sort()).toEqual(['AND', 'OR', 'id', 'isDeleted', 'status']);
        expect(where).toEqual(expect.objectContaining({
            AND: [{ applicant: { id: USER_ID, isDeleted: false } }],
            id: 'draft-1',
            status: 'DRAFT',
            isDeleted: false,
        }));
        // R1 (final review C1): OR [holder fragment, the strict pin] beside the pin; the
        // rows are exactly the strict pin's, with or without an entity context.
        expect(where.OR[0].entityId).toEqual({ in: ['ent-juristic-1'] });
        expect(JSON.parse(JSON.stringify(where.OR[1]))).toEqual({ applicant: { id: USER_ID, isDeleted: false } });
    });

    it('co-member cannot soft-delete the owner\'s draft (null, no update write)', async () => {
        // Strict pin → the owner's draft does not match the co-member's id.
        prisma.application.findFirst.mockResolvedValue(null);
        const svc = buildDraftService();

        const out = await runWithEntityContext(WORKSPACE_CTX, () =>
            svc.deleteDraft(USER_ID, 'draft-owner-1', SCOPE_OPTS),
        );

        expect(out).toBeNull();
        expect(prisma.application.update).not.toHaveBeenCalled();
    });

    it('owner still soft-deletes their own draft (regression)', async () => {
        prisma.application.findFirst.mockResolvedValue({ id: 'draft-1' });
        prisma.application.update.mockResolvedValue({ id: 'draft-1' });
        const svc = buildDraftService();

        const out = await svc.deleteDraft(USER_ID, 'draft-1', SCOPE_OPTS);

        expect(out).toEqual({ id: 'draft-1' });
        expect(prisma.application.update).toHaveBeenCalledWith({
            where: { id: 'draft-1' },
            data: expect.objectContaining({ isDeleted: true }),
            select: { id: true },
        });
    });

    it('getDraft (READ) reads OR [holder fragment, relaxed workspace where] and in R1 keeps that where as the AND member', async () => {
        prisma.application.findFirst.mockResolvedValue(null);
        const svc = buildDraftService();

        await runWithEntityContext(WORKSPACE_CTX, () =>
            svc.getDraft(USER_ID, SCOPE_OPTS),
        );

        const where = prisma.application.findFirst.mock.calls[0][0].where;
        expect(Object.keys(where).sort()).toEqual(['AND', 'OR', 'isDeleted', 'status']);
        expect(where).toEqual(expect.objectContaining({
            AND: [{ entityId: 'ent-juristic-1' }], // R1-legacy-pin: the pre-R1 relaxed where
            status: 'DRAFT',
            isDeleted: false,
        }));
        expect(where.OR[0].entityId).toEqual({ in: ['ent-juristic-1'] });
        expect(JSON.parse(JSON.stringify(where.OR[1]))).toEqual({ entityId: 'ent-juristic-1' });
    });
});
