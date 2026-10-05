/**
 * Personal-entity self-heal on GET /entities/mine (2026-06-11).
 *
 * Registration is the only caller of ensurePersonalIndividualEntity, so HEALTH
 * users created outside that flow (seed scripts, e2e-controller's raw
 * prisma.user.create, admin/backfill scripts) have ZERO memberships and the
 * workspace switcher dead-ends at "ไม่มีพื้นที่ใช้งาน" — found live on staging
 * (5 seeded users; prod verified clean). listMembershipsForUserWithHeal lazily
 * ensures the personal INDIVIDUAL entity on the read path.
 */

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: { findUnique: jest.fn() },
        entity: { findFirst: jest.fn(), create: jest.fn() },
        // STAGE B2 — ensurePersonalIndividualEntity now tries the stable
        // EntityMembership(userId, OWNER, INDIVIDUAL) link before the hash lookup.
        entityMembership: { findFirst: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
    },
}));

jest.mock('../../shared/logger', () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}));

const crypto = require('crypto');
const { prisma } = require('../../services/prisma-database');
const logger = require('../../shared/logger');
const entityService = require('../../services/entity-service');

const HEALTH_ID = '1100000000008';
const HASH = crypto.createHash('sha256').update(HEALTH_ID).digest('hex');

const HEALED_USER = {
    id: 'user-orphan',
    // Canonical spelling — users.role was canonicalised by migration
    // 20260801000000, so an uppercase row is a shape production cannot hold
    // (and the heal guard compares against CANONICAL_ROLES.HEALTH).
    role: 'health',
    healthId: HEALTH_ID,
    organizationId: 'org-1',
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    email: 'somchai@gacpth.com',
};

const EXISTING_ENTITY = {
    id: 'ent-1',
    type: 'INDIVIDUAL',
    displayName: 'สมชาย ใจดี',
    slug: 'somchai',
    status: 'ACTIVE',
    thaiCitizenIdHash: HASH,
    juristicId: null,
    communityRegNo: null,
    isDeleted: false,
    organizationId: 'org-1',
};

function membershipRow() {
    return {
        id: 'mem-1', userId: HEALED_USER.id, entityId: EXISTING_ENTITY.id,
        role: 'OWNER', status: 'ACTIVE', permissions: [],
        createdAt: new Date('2026-06-11T00:00:00Z'), entity: EXISTING_ENTITY,
    };
}

describe('listMembershipsForUserWithHeal', () => {
    beforeEach(() => jest.clearAllMocks());

    test('user WITH memberships → returned as-is, heal path never touched', async () => {
        prisma.entityMembership.findMany.mockResolvedValue([membershipRow()]);
        const out = await entityService.listMembershipsForUserWithHeal({
            userId: HEALED_USER.id, healthId: HEALTH_ID,
        });
        expect(out).toHaveLength(1);
        expect(out[0].isPersonal).toBe(true);
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
        expect(prisma.entityMembership.upsert).not.toHaveBeenCalled();
    });

    test('orphaned HEALTH user → entity ensured (existing-by-hash) + membership upserted + re-listed', async () => {
        prisma.entityMembership.findMany
            .mockResolvedValueOnce([])               // first list: empty
            .mockResolvedValueOnce([membershipRow()]); // re-list after heal
        prisma.user.findUnique.mockResolvedValue(HEALED_USER);
        // No OWNER membership link yet (orphan) → ensurePersonalIndividualEntity
        // falls back to the national-ID hash lookup.
        prisma.entityMembership.findFirst.mockResolvedValue(null);
        prisma.entity.findFirst.mockResolvedValue(EXISTING_ENTITY); // hash match → no create
        prisma.entityMembership.upsert.mockResolvedValue({ id: 'mem-1' });

        const out = await entityService.listMembershipsForUserWithHeal({
            userId: HEALED_USER.id, healthId: HEALTH_ID,
        });

        expect(prisma.entity.create).not.toHaveBeenCalled();
        expect(prisma.entityMembership.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { userId_entityId: { userId: HEALED_USER.id, entityId: EXISTING_ENTITY.id } },
            create: expect.objectContaining({ role: 'OWNER', status: 'ACTIVE', organizationId: 'org-1' }),
        }));
        expect(out).toHaveLength(1);
        expect(out[0].membershipStatus).toBe('ACTIVE');
    });

    test('legacy-spelled HEALTH row still heals (the seed wrote it that way)', async () => {
        // W4 2026-08-22: the HEALED_USER comment above claims an uppercase row
        // "is a shape production cannot hold". prisma/seed-gacp.js held exactly
        // that shape — every seeded applicant landed with role 'HEALTH' — and
        // the raw `user.role !== CANONICAL_ROLES.HEALTH` compare silently
        // skipped the heal for them, which is what blocked the whole wizard.
        // The seed is fixed, but this invariant must not depend on one writer's
        // spelling: normalise before comparing, as every RBAC gate does.
        prisma.entityMembership.findMany
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([membershipRow()]);
        prisma.user.findUnique.mockResolvedValue({ ...HEALED_USER, role: 'HEALTH' });
        prisma.entityMembership.findFirst.mockResolvedValue(null);
        prisma.entity.findFirst.mockResolvedValue(EXISTING_ENTITY);
        prisma.entityMembership.upsert.mockResolvedValue({ id: 'mem-1' });

        const out = await entityService.listMembershipsForUserWithHeal({
            userId: HEALED_USER.id, healthId: HEALTH_ID,
        });

        expect(prisma.entityMembership.upsert).toHaveBeenCalled();
        expect(out).toHaveLength(1);
    });

    test('a role that is not HEALTH at all never heals', async () => {
        // Guards the normalisation above from over-reaching: 'AUDITOR' also
        // normalises, but not to HEALTH, so it must still be refused.
        // mockReset (not clearAllMocks) — the queue a *Once from a previous
        // test left behind would otherwise leak in and fake a heal here.
        prisma.entityMembership.findMany.mockReset();
        prisma.entityMembership.findMany.mockResolvedValue([]);
        prisma.user.findUnique.mockResolvedValue({ ...HEALED_USER, role: 'AUDITOR' });
        const out = await entityService.listMembershipsForUserWithHeal({
            userId: HEALED_USER.id, healthId: HEALTH_ID,
        });
        expect(out).toEqual([]);
        expect(prisma.entityMembership.upsert).not.toHaveBeenCalled();
    });

    test('non-HEALTH / missing healthId / missing org → no heal, empty list returned', async () => {
        prisma.entityMembership.findMany.mockResolvedValue([]);
        for (const user of [
            null,
            { ...HEALED_USER, role: 'auditor' },
            { ...HEALED_USER, healthId: null },
            { ...HEALED_USER, organizationId: null },
        ]) {
            prisma.user.findUnique.mockResolvedValue(user);
            const out = await entityService.listMembershipsForUserWithHeal({ userId: 'u', healthId: null });
            expect(out).toEqual([]);
        }
        expect(prisma.entityMembership.upsert).not.toHaveBeenCalled();
    });

    test('heal failure fails OPEN to the empty list (logged, request not broken)', async () => {
        prisma.entityMembership.findMany.mockResolvedValue([]);
        prisma.user.findUnique.mockRejectedValue(new Error('db down'));
        const out = await entityService.listMembershipsForUserWithHeal({
            userId: HEALED_USER.id, healthId: HEALTH_ID,
        });
        expect(out).toEqual([]);
        expect(logger.error).toHaveBeenCalled();
    });
});
