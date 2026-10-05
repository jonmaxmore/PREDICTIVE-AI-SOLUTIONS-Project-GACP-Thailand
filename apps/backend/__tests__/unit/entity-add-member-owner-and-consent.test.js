/**
 * SEC — the member-invite upsert must not demote the OWNER, and must not
 * accept an invitation on the invitee's behalf.
 *
 * POST /api/entities/:id/members validates the REQUESTED role
 * (['ADMIN','MANAGER','VIEWER'], and "only OWNER may grant ADMIN"), so an
 * attacker cannot ask for OWNER. But entityService.addMember is an UPSERT, and
 * its UPDATE branch wrote
 *
 *     { role, status: 'ACTIVE', acceptedAt: new Date(), permissions: … }
 *
 * with no look at the row it was overwriting. Two separate defects:
 *
 * 1. PRIVILEGE ESCALATION BY DEMOTION. A workspace ADMIN "invites" the current
 *    OWNER as MANAGER. The row exists, so the UPDATE branch runs and the OWNER
 *    is demoted — leaving the ADMIN as the highest-privileged member, with no
 *    OWNER left to reverse it. Note revokeMember, in this same file, already
 *    refuses to touch an OWNER row and directs the caller to transferOwnership;
 *    addMember simply never got the same rule.
 *
 * 2. CONSENT BYPASS. The CREATE branch correctly opens an invite as PENDING,
 *    but the UPDATE branch forced status ACTIVE. So inviting the same person
 *    twice auto-accepted the invitation for them: invite → PENDING, invite
 *    again → ACTIVE, without the invitee ever acting. acceptInvitation() is
 *    the dedicated path for that transition and is the only thing that should
 *    perform it.
 *
 * Fix direction: the UPDATE branch changes ROLE only. Status transitions belong
 * to the flows that own them — acceptInvitation (PENDING→ACTIVE) and
 * revokeMember (→REVOKED). Re-inviting a REVOKED member is the one status move
 * addMember still makes, and it re-opens the invite as PENDING so acceptance is
 * required again rather than silently restored.
 */

'use strict';

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log) };
});

const mockEntityFindUnique = jest.fn();
const mockMembershipFindUnique = jest.fn();
const mockMembershipUpsert = jest.fn();
const mockEventCreate = jest.fn(async () => ({}));
const mockGrantFindMany = jest.fn(async () => []);
const mockGrantDeleteMany = jest.fn(async () => ({ count: 0 }));

jest.mock('../../services/prisma-database', () => {
    const client = {
        entity: { findUnique: (...a) => mockEntityFindUnique(...a) },
        entityMembership: {
            findUnique: (...a) => mockMembershipFindUnique(...a),
            upsert: (...a) => mockMembershipUpsert(...a),
        },
        entityMembershipEvent: { create: (...a) => mockEventCreate(...a) },
        // Role changes clear any per-member permission grants tied to the old role.
        entityMemberPermissionGrant: {
            findMany: (...a) => mockGrantFindMany(...a),
            deleteMany: (...a) => mockGrantDeleteMany(...a),
        },
    };
    client.$transaction = async (fn) => fn(client);
    return { prisma: client };
});

const entityService = require('../../services/entity-service');

function upsertUpdateArg() {
    return mockMembershipUpsert.mock.calls[0][0].update;
}

describe('SEC — addMember cannot demote the OWNER', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockEntityFindUnique.mockResolvedValue({ id: 'ent-1', organizationId: 'org-1', isDeleted: false });
        mockMembershipUpsert.mockImplementation(async (args) => ({
            id: 'm-1', userId: 'u-owner', entityId: 'ent-1', ...args.update,
        }));
    });

    it('refuses to change the role on an OWNER row', async () => {
        mockMembershipFindUnique.mockResolvedValue({ id: 'm-1', role: 'OWNER', status: 'ACTIVE' });

        await expect(entityService.addMember({
            entityId: 'ent-1', userId: 'u-owner', role: 'MANAGER', invitedBy: 'u-admin',
        })).rejects.toMatchObject({ code: 'CANNOT_DEMOTE_OWNER' });

        expect(mockMembershipUpsert).not.toHaveBeenCalled();
    });

    it('refuses even when the requested role is also OWNER (no self-serve transfer)', async () => {
        mockMembershipFindUnique.mockResolvedValue({ id: 'm-1', role: 'OWNER', status: 'ACTIVE' });

        await expect(entityService.addMember({
            entityId: 'ent-1', userId: 'u-owner', role: 'OWNER', invitedBy: 'u-admin',
        })).rejects.toMatchObject({ code: 'CANNOT_DEMOTE_OWNER' });
    });

    it('still allows a role change on a non-OWNER member', async () => {
        mockMembershipFindUnique.mockResolvedValue({ id: 'm-2', role: 'VIEWER', status: 'ACTIVE' });

        await entityService.addMember({
            entityId: 'ent-1', userId: 'u-viewer', role: 'MANAGER', invitedBy: 'u-owner',
        });

        expect(upsertUpdateArg().role).toBe('MANAGER');
    });
});

describe('SEC — addMember does not accept an invitation for the invitee', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockEntityFindUnique.mockResolvedValue({ id: 'ent-1', organizationId: 'org-1', isDeleted: false });
        mockMembershipUpsert.mockImplementation(async (args) => ({
            id: 'm-1', userId: 'u-invitee', entityId: 'ent-1', ...args.update,
        }));
    });

    it('leaves a PENDING invite PENDING when the same person is re-invited', async () => {
        mockMembershipFindUnique.mockResolvedValue({ id: 'm-1', role: 'VIEWER', status: 'PENDING' });

        await entityService.addMember({
            entityId: 'ent-1', userId: 'u-invitee', role: 'MANAGER', invitedBy: 'u-owner',
        });

        const update = upsertUpdateArg();
        expect(update.status).toBe('PENDING');
        // acceptedAt belongs to acceptInvitation, not to the inviter.
        expect(update.acceptedAt).toBeUndefined();
    });

    it('keeps an ACTIVE member ACTIVE across a role change', async () => {
        mockMembershipFindUnique.mockResolvedValue({ id: 'm-1', role: 'VIEWER', status: 'ACTIVE' });

        await entityService.addMember({
            entityId: 'ent-1', userId: 'u-invitee', role: 'MANAGER', invitedBy: 'u-owner',
        });

        expect(upsertUpdateArg().status).toBe('ACTIVE');
    });

    it('re-opens a REVOKED membership as PENDING, requiring fresh acceptance', async () => {
        mockMembershipFindUnique.mockResolvedValue({ id: 'm-1', role: 'VIEWER', status: 'REVOKED' });

        await entityService.addMember({
            entityId: 'ent-1', userId: 'u-invitee', role: 'VIEWER', invitedBy: 'u-owner',
        });

        expect(upsertUpdateArg().status).toBe('PENDING');
    });

    it('still opens a brand-new invite as PENDING', async () => {
        mockMembershipFindUnique.mockResolvedValue(null);

        await entityService.addMember({
            entityId: 'ent-1', userId: 'u-new', role: 'VIEWER', invitedBy: 'u-owner',
        });

        expect(mockMembershipUpsert.mock.calls[0][0].create.status).toBe('PENDING');
    });
});
