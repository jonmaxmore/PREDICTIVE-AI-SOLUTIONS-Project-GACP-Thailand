// Wave C PR C-2 — active-entity middleware contract test.
// Covers header → req.activeEntity, mismatch → 403, default fallback.

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        // STAGE B2 — the default (no-header) personal-entity resolution now
        // prefers the stable EntityMembership(userId, OWNER, INDIVIDUAL) link
        // (findFirst) before the legacy national-ID hash lookup (entity.findFirst).
        entityMembership: { findUnique: jest.fn(), findFirst: jest.fn() },
        entity: { findFirst: jest.fn() },
    },
}));

jest.mock('../../shared/logger', () => {
    const noop = () => {};
    return {
        debug: noop, info: noop, warn: noop, error: noop,
        createLogger: () => ({ debug: noop, info: noop, warn: noop, error: noop }),
    };
});

const { prisma } = require('../../services/prisma-database');
const { activeEntityMiddleware, HEADER_NAME, __hashIdentifier } = require('../../middleware/active-entity-middleware');
const { getEntityContext } = require('../../services/entity-context');

const PERSONAL_HEALTH_ID = '1100000000008';
const PERSONAL_HASH = __hashIdentifier(PERSONAL_HEALTH_ID);

function makeReq({ user, header } = {}) {
    return {
        user,
        headers: header ? { [HEADER_NAME]: header } : {},
    };
}

function makeRes() {
    const res = { _status: 200, _json: null };
    res.status = (s) => { res._status = s; return res; };
    res.json = (b) => { res._json = b; return res; };
    return res;
}

describe('Wave C PR C-2 — activeEntityMiddleware', () => {
    const middleware = activeEntityMiddleware();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('passes through when req.user is missing (anonymous / public)', async () => {
        let called = false;
        await middleware(makeReq(), makeRes(), () => { called = true; });
        expect(called).toBe(true);
    });

    it('binds the requested entity when header matches an ACTIVE membership', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue({
            role: 'OWNER', status: 'ACTIVE', entity: { type: 'JURISTIC' },
        });

        const req = makeReq({
            user: { id: 'user-1', healthId: PERSONAL_HEALTH_ID },
            header: 'ent-juristic',
        });
        const res = makeRes();
        let observedCtx = null;

        await middleware(req, res, () => {
            observedCtx = getEntityContext();
        });

        expect(req.activeEntity).toEqual({ entityId: 'ent-juristic', role: 'OWNER', personal: false });
        expect(observedCtx).toEqual({ entityId: 'ent-juristic', role: 'OWNER', personal: false });
    });

    // Wave A fix S1 (adversarial-verify 2026-07-02): the FE persists the
    // picker choice and auto-sends the header for everyone. A header that
    // names the user's OWN personal INDIVIDUAL entity (role OWNER on an
    // INDIVIDUAL entity — the same predicate findPersonalEntity uses) must
    // keep personal:true so buildHealthWhereClause keeps the strict pin.
    it('S1: header naming the user\'s OWN personal INDIVIDUAL entity → personal:true', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue({
            role: 'OWNER', status: 'ACTIVE', entity: { type: 'INDIVIDUAL' },
        });

        const req = makeReq({
            user: { id: 'user-1', healthId: PERSONAL_HEALTH_ID },
            header: 'ent-personal',
        });
        const res = makeRes();
        let observedCtx = null;

        await middleware(req, res, () => { observedCtx = getEntityContext(); });

        // The membership lookup must fetch the entity type to decide this.
        expect(prisma.entityMembership.findUnique).toHaveBeenCalledWith({
            where: { userId_entityId: { userId: 'user-1', entityId: 'ent-personal' } },
            select: { role: true, status: true, entity: { select: { type: true } } },
        });
        expect(req.activeEntity).toEqual({ entityId: 'ent-personal', role: 'OWNER', personal: true });
        expect(observedCtx).toEqual({ entityId: 'ent-personal', role: 'OWNER', personal: true });
    });

    it('S1: non-OWNER membership on an INDIVIDUAL entity stays a workspace (personal:false)', async () => {
        // Invited worker on someone ELSE's personal-entity farm — must NOT
        // collapse to the strict pin (they need the relaxed workspace scope).
        prisma.entityMembership.findUnique.mockResolvedValue({
            role: 'MANAGER', status: 'ACTIVE', entity: { type: 'INDIVIDUAL' },
        });

        const req = makeReq({
            user: { id: 'worker-1', healthId: PERSONAL_HEALTH_ID },
            header: 'ent-someone-elses',
        });
        const res = makeRes();

        await middleware(req, res, () => {});

        expect(req.activeEntity).toEqual({ entityId: 'ent-someone-elses', role: 'MANAGER', personal: false });
    });

    it('returns 403 when header is set but no active membership matches', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue(null);

        const req = makeReq({
            user: { id: 'user-1', healthId: PERSONAL_HEALTH_ID },
            header: 'ent-not-mine',
        });
        const res = makeRes();
        let nextCalled = false;

        await middleware(req, res, () => { nextCalled = true; });

        expect(res._status).toBe(403);
        expect(res._json).toMatchObject({
            success: false,
            code: 'ACTIVE_ENTITY_MISMATCH',
        });
        expect(nextCalled).toBe(false);
    });

    it('returns 403 when membership exists but status is REVOKED / PENDING', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue({ role: 'OWNER', status: 'REVOKED' });

        const req = makeReq({
            user: { id: 'user-1', healthId: PERSONAL_HEALTH_ID },
            header: 'ent-revoked',
        });
        const res = makeRes();

        await middleware(req, res, () => {});

        expect(res._status).toBe(403);
    });

    it('resolves the personal entity via the stable OWNER membership link (no hash lookup) when header is absent', async () => {
        // STAGE B2 — primary path: EntityMembership(userId, OWNER, INDIVIDUAL).
        prisma.entityMembership.findFirst.mockResolvedValue({ entityId: 'ent-personal' });

        const req = makeReq({ user: { id: 'user-1', healthId: PERSONAL_HEALTH_ID } });
        const res = makeRes();
        let observedCtx = null;

        await middleware(req, res, () => { observedCtx = getEntityContext(); });

        expect(prisma.entityMembership.findFirst).toHaveBeenCalledWith({
            where: {
                userId: 'user-1',
                role: 'OWNER',
                entity: { type: 'INDIVIDUAL', isDeleted: false },
            },
            select: { entityId: true },
            // Wave B chunk 6 — deterministic pick (oldest candidate wins).
            orderBy: { createdAt: 'asc' },
        });
        // The national-ID hash lookup must NOT be consulted on the primary path.
        expect(prisma.entity.findFirst).not.toHaveBeenCalled();
        expect(req.activeEntity).toEqual({ entityId: 'ent-personal', role: 'OWNER', personal: true });
        expect(observedCtx).toEqual({ entityId: 'ent-personal', role: 'OWNER', personal: true });
    });

    it('falls back to the legacy national-ID hash lookup when no OWNER membership link exists (flag OFF)', async () => {
        // No membership link → fall back to the unkeyed thaiCitizenIdHash lookup
        // (byte-for-byte today's behaviour while AUTH_LOOKUP_USE_HMAC is off).
        prisma.entityMembership.findFirst.mockResolvedValue(null);
        prisma.entity.findFirst.mockResolvedValue({ id: 'ent-personal' });

        const req = makeReq({ user: { id: 'user-1', healthId: PERSONAL_HEALTH_ID } });
        const res = makeRes();
        let observedCtx = null;

        await middleware(req, res, () => { observedCtx = getEntityContext(); });

        expect(prisma.entity.findFirst).toHaveBeenCalledWith({
            where: { type: 'INDIVIDUAL', thaiCitizenIdHash: PERSONAL_HASH, isDeleted: false },
            select: { id: true },
            // Wave B chunk 6 — deterministic pick (oldest candidate wins).
            orderBy: { createdAt: 'asc' },
        });
        expect(req.activeEntity).toEqual({ entityId: 'ent-personal', role: 'OWNER', personal: true });
        expect(observedCtx).toEqual({ entityId: 'ent-personal', role: 'OWNER', personal: true });
    });

    it('passes through with no scope when header absent and neither link nor personal entity exists', async () => {
        prisma.entityMembership.findFirst.mockResolvedValue(null);
        prisma.entity.findFirst.mockResolvedValue(null);

        const req = makeReq({ user: { id: 'user-1', healthId: PERSONAL_HEALTH_ID } });
        const res = makeRes();
        let nextCalled = false;
        let observedCtx = 'unset';

        await middleware(req, res, () => {
            nextCalled = true;
            observedCtx = getEntityContext();
        });

        expect(nextCalled).toBe(true);
        expect(req.activeEntity).toBeUndefined();
        // No scope was bound — getEntityContext returns null inside next.
        expect(observedCtx).toBeNull();
    });

    it('does not 500 on a Prisma failure (best-effort)', async () => {
        prisma.entityMembership.findFirst.mockRejectedValue(new Error('connection lost'));

        const req = makeReq({ user: { id: 'user-1', healthId: PERSONAL_HEALTH_ID } });
        const res = makeRes();
        let nextCalled = false;

        await middleware(req, res, () => { nextCalled = true; });

        expect(nextCalled).toBe(true);
        expect(res._status).toBe(200);
    });
});
