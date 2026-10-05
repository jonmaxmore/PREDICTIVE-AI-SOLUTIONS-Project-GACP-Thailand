/**
 * Wave B adversarial-verify S6 (2026-07-03) — grant lifecycle: per-member
 * GRANT/REVOKE rows must be CLEARED when the membership itself changes hands:
 *
 *   1. revokeMember       — otherwise a later re-invite RESURRECTS the old
 *                           grants (upsert reuses the same membership row →
 *                           same PK → stale rows re-attach silently).
 *   2. addMember (upsert UPDATE branch: re-invite of a REVOKED row, or a
 *      role change) — same resurrect/stale-grant hole from the other side.
 *      A same-role ACTIVE idempotent re-call stays a no-op (mirrors the
 *      existing "no audit on idempotent re-call" semantics — grants are
 *      never wiped without an audit row).
 *   3. transferOwnership  — stale grants after transfer; and a promoted
 *      sole-OWNER carrying an old REVOKE would be un-fixable (the admin API
 *      self-guard blocks editing one's own grid → deadlock).
 *
 * Each clear is transactional with the existing writes and audited as an
 * ENTITY_PERMISSION_RESET event carrying the BEFORE snapshot.
 *
 * REAL entity-service over a mocked prisma.
 */

'use strict';

jest.mock('../../services/prisma-database', () => {
    const mockPrisma = {
        entity: { findFirst: jest.fn(), findUnique: jest.fn() },
        entityMembership: {
            findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(),
            upsert: jest.fn(), update: jest.fn(),
        },
        entityMemberPermissionGrant: {
            findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn(),
            delete: jest.fn(), deleteMany: jest.fn(),
        },
        entityMembershipEvent: { create: jest.fn(), findMany: jest.fn() },
        user: { findFirst: jest.fn(), findMany: jest.fn() },
    };
    mockPrisma.$transaction = jest.fn(async (fn) => fn(mockPrisma));
    return { prisma: mockPrisma };
});

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const { prisma } = require('../../services/prisma-database');
const entityService = require('../../services/entity-service');

const ENTITY_ID = 'ent-1';
const WORKER_ID = 'user-worker';
const OWNER_ID = 'user-owner';

const WORKER_MEMBERSHIP = {
    id: 'mem-worker', userId: WORKER_ID, entityId: ENTITY_ID,
    role: 'MANAGER', permissions: [], status: 'ACTIVE', organizationId: 'org-1',
};

const GRANT_ROWS = [
    { membershipId: 'mem-worker', permission: 'HARVEST_RECORD', effect: 'REVOKE' },
    { membershipId: 'mem-worker', permission: 'QR_GENERATE', effect: 'GRANT' },
];

function resetEvents() {
    return prisma.entityMembershipEvent.create.mock.calls
        .map((c) => c[0].data)
        .filter((d) => d.eventType === 'ENTITY_PERMISSION_RESET');
}

beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
    prisma.entityMembershipEvent.create.mockResolvedValue({ id: 'evt' });
    prisma.entityMemberPermissionGrant.findMany.mockResolvedValue(GRANT_ROWS);
    prisma.entityMemberPermissionGrant.deleteMany.mockResolvedValue({ count: GRANT_ROWS.length });
});

describe('S6.1 — revokeMember clears the membership grants (no resurrect-on-reinvite)', () => {
    it('deletes the grant rows and audits ENTITY_PERMISSION_RESET with the before snapshot', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue(WORKER_MEMBERSHIP);
        prisma.entityMembership.update.mockResolvedValue({ ...WORKER_MEMBERSHIP, status: 'REVOKED' });

        await entityService.revokeMember({
            entityId: ENTITY_ID, userId: WORKER_ID, actorUserId: OWNER_ID,
        });

        expect(prisma.entityMemberPermissionGrant.deleteMany).toHaveBeenCalledWith({
            where: { membershipId: 'mem-worker' },
        });
        const resets = resetEvents();
        expect(resets).toHaveLength(1);
        expect(resets[0].targetUserId).toBe(WORKER_ID);
        expect(resets[0].metadata.before).toEqual([
            { permission: 'HARVEST_RECORD', effect: 'REVOKE' },
            { permission: 'QR_GENERATE', effect: 'GRANT' },
        ]);
    });

    it('no grants → no deleteMany, no RESET event (clean no-op)', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue(WORKER_MEMBERSHIP);
        prisma.entityMembership.update.mockResolvedValue({ ...WORKER_MEMBERSHIP, status: 'REVOKED' });
        prisma.entityMemberPermissionGrant.findMany.mockResolvedValue([]);

        await entityService.revokeMember({
            entityId: ENTITY_ID, userId: WORKER_ID, actorUserId: OWNER_ID,
        });

        expect(prisma.entityMemberPermissionGrant.deleteMany).not.toHaveBeenCalled();
        expect(resetEvents()).toHaveLength(0);
    });

    it('already-REVOKED membership stays a full no-op (idempotent)', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue({ ...WORKER_MEMBERSHIP, status: 'REVOKED' });
        await entityService.revokeMember({
            entityId: ENTITY_ID, userId: WORKER_ID, actorUserId: OWNER_ID,
        });
        expect(prisma.entityMemberPermissionGrant.deleteMany).not.toHaveBeenCalled();
    });
});

describe('S6.2 — addMember upsert-UPDATE branch clears grants on re-invite / role change', () => {
    beforeEach(() => {
        prisma.entity.findUnique.mockResolvedValue({
            id: ENTITY_ID, organizationId: 'org-1', isDeleted: false,
        });
        prisma.entityMembership.upsert.mockResolvedValue(WORKER_MEMBERSHIP);
    });

    it('re-invite of a REVOKED row: old grants do NOT resurrect (cleared + RESET audited)', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue({
            id: 'mem-worker', role: 'MANAGER', status: 'REVOKED',
        });

        await entityService.addMember({
            entityId: ENTITY_ID, userId: WORKER_ID, role: 'MANAGER', invitedBy: OWNER_ID,
        });

        expect(prisma.entityMemberPermissionGrant.deleteMany).toHaveBeenCalledWith({
            where: { membershipId: 'mem-worker' },
        });
        expect(resetEvents()).toHaveLength(1);
    });

    it('role change on an ACTIVE row clears the stale role-relative grants', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue({
            id: 'mem-worker', role: 'VIEWER', status: 'ACTIVE',
        });

        await entityService.addMember({
            entityId: ENTITY_ID, userId: WORKER_ID, role: 'MANAGER', invitedBy: OWNER_ID,
        });

        expect(prisma.entityMemberPermissionGrant.deleteMany).toHaveBeenCalledWith({
            where: { membershipId: 'mem-worker' },
        });
        expect(resetEvents()).toHaveLength(1);
    });

    it('same-role ACTIVE idempotent re-call does NOT touch the grants (no silent wipe)', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue({
            id: 'mem-worker', role: 'MANAGER', status: 'ACTIVE',
        });

        await entityService.addMember({
            entityId: ENTITY_ID, userId: WORKER_ID, role: 'MANAGER', invitedBy: OWNER_ID,
        });

        expect(prisma.entityMemberPermissionGrant.deleteMany).not.toHaveBeenCalled();
        expect(resetEvents()).toHaveLength(0);
    });

    it('fresh row (no existing membership) never clears anything', async () => {
        prisma.entityMembership.findUnique.mockResolvedValue(null);
        await entityService.addMember({
            entityId: ENTITY_ID, userId: WORKER_ID, role: 'VIEWER', invitedBy: OWNER_ID,
        });
        expect(prisma.entityMemberPermissionGrant.deleteMany).not.toHaveBeenCalled();
    });
});

describe('S6.3 — transferOwnership clears BOTH memberships\' grants (promoted-OWNER REVOKE deadlock)', () => {
    it('clears demoted + promoted grants and audits a RESET per member', async () => {
        const OWNER_MEMBERSHIP = {
            id: 'mem-owner', userId: OWNER_ID, entityId: ENTITY_ID,
            role: 'OWNER', permissions: [], status: 'ACTIVE', organizationId: 'org-1',
        };
        prisma.entityMembership.findUnique.mockImplementation(async ({ where }) => {
            const uid = where.userId_entityId.userId;
            if (uid === OWNER_ID) { return OWNER_MEMBERSHIP; }
            if (uid === WORKER_ID) { return WORKER_MEMBERSHIP; }
            return null;
        });
        prisma.entityMembership.update.mockResolvedValue({});
        prisma.entity.findUnique.mockResolvedValue({ organizationId: 'org-1' });
        // The incoming OWNER carries an old REVOKE — after promotion this
        // would be an un-fixable self-lockout (admin API self-guard).
        prisma.entityMemberPermissionGrant.findMany.mockImplementation(async ({ where }) => (
            where.membershipId === 'mem-worker'
                ? [{ membershipId: 'mem-worker', permission: 'HARVEST_RECORD', effect: 'REVOKE' }]
                : [{ membershipId: 'mem-owner', permission: 'QR_GENERATE', effect: 'GRANT' }]
        ));

        await entityService.transferOwnership({
            entityId: ENTITY_ID, fromUserId: OWNER_ID, toUserId: WORKER_ID,
        });

        const deleted = prisma.entityMemberPermissionGrant.deleteMany.mock.calls.map((c) => c[0].where.membershipId);
        expect(deleted.sort()).toEqual(['mem-owner', 'mem-worker']);

        const resets = resetEvents();
        expect(resets).toHaveLength(2);
        expect(resets.map((r) => r.targetUserId).sort()).toEqual([OWNER_ID, WORKER_ID].sort());
    });
});
