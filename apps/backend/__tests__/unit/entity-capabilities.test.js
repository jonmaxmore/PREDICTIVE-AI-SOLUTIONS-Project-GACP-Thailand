// Wave C PR-4 — capability table + role defaults + invitee resolver.

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: { findFirst: jest.fn(), findMany: jest.fn() },
    },
}));

const { prisma } = require('../../services/prisma-database');
const {
    CAPABILITIES,
    DEFAULT_PERMISSIONS_BY_ROLE,
    assertCapability,
    defaultPermissionsFor,
    findInviteeByIdentifier,
} = require('../../services/entity-service');

describe('Wave C PR-4 — CAPABILITIES table', () => {
    it('exposes the canonical permission codes', () => {
        expect(CAPABILITIES.SUBMIT_APPLICATION).toBe('SUBMIT_APPLICATION');
        expect(CAPABILITIES.PRINT_QR).toBe('PRINT_QR');
        expect(CAPABILITIES.INVITE_MEMBER).toBe('INVITE_MEMBER');
        expect(CAPABILITIES.TRANSFER_OWNERSHIP).toBe('TRANSFER_OWNERSHIP');
    });

    it('OWNER has every capability by default', () => {
        const owner = DEFAULT_PERMISSIONS_BY_ROLE.OWNER;
        Object.values(CAPABILITIES).forEach(c => expect(owner).toContain(c));
    });

    it('VIEWER has zero capabilities by default', () => {
        expect(DEFAULT_PERMISSIONS_BY_ROLE.VIEWER).toEqual([]);
    });

    it('MANAGER can print QR but not edit farms nor submit applications (Wave B owner decision)', () => {
        const m = DEFAULT_PERMISSIONS_BY_ROLE.MANAGER;
        // Wave B (farm-worker-permissions-plan-2026-07-02, binding line 22):
        // MANAGER = all farm-operation codes EXCEPT FARM_CREATE + EDIT_FARM.
        // EDIT_FARM was defined-but-unenforced pre-Wave-B, so dropping it from
        // the MANAGER default changes no pre-existing behaviour.
        expect(m).not.toContain(CAPABILITIES.EDIT_FARM);
        expect(m).toContain(CAPABILITIES.PRINT_QR);
        expect(m).not.toContain(CAPABILITIES.SUBMIT_APPLICATION);
        expect(m).not.toContain(CAPABILITIES.INVITE_MEMBER);
    });

    it('ADMIN can invite + revoke + submit, but not transfer ownership', () => {
        const a = DEFAULT_PERMISSIONS_BY_ROLE.ADMIN;
        expect(a).toContain(CAPABILITIES.INVITE_MEMBER);
        expect(a).toContain(CAPABILITIES.REVOKE_MEMBER);
        expect(a).toContain(CAPABILITIES.SUBMIT_APPLICATION);
        expect(a).not.toContain(CAPABILITIES.TRANSFER_OWNERSHIP);
        expect(a).not.toContain(CAPABILITIES.DELETE_ENTITY);
    });

    it('defaultPermissionsFor returns a copy (not the frozen original)', () => {
        const out = defaultPermissionsFor('OWNER');
        expect(out).toEqual(DEFAULT_PERMISSIONS_BY_ROLE.OWNER);
        out.push('CUSTOM_HACK');
        expect(DEFAULT_PERMISSIONS_BY_ROLE.OWNER).not.toContain('CUSTOM_HACK');
    });

    it('defaultPermissionsFor unknown role returns empty array', () => {
        expect(defaultPermissionsFor('SUPERADMIN')).toEqual([]);
    });
});

describe('Wave C PR-4 — assertCapability', () => {
    it('returns true when role default permits', () => {
        expect(assertCapability('OWNER', 'SUBMIT_APPLICATION')).toBe(true);
        expect(assertCapability('ADMIN', 'INVITE_MEMBER')).toBe(true);
        // Wave B: EDIT_FARM left the MANAGER default (owner decision);
        // HARVEST_RECORD is a MANAGER farm-operation default.
        expect(assertCapability('MANAGER', 'HARVEST_RECORD')).toBe(true);
        expect(() => assertCapability('MANAGER', 'EDIT_FARM')).toThrow(/lacks capability/);
    });

    it('throws CAPABILITY_DENIED when role default denies', () => {
        expect(() => assertCapability('VIEWER', 'SUBMIT_APPLICATION'))
            .toThrow(/lacks capability/);
        try {
            assertCapability('MANAGER', 'INVITE_MEMBER');
        } catch (e) {
            expect(e.code).toBe('CAPABILITY_DENIED');
            expect(e.role).toBe('MANAGER');
            expect(e.capability).toBe('INVITE_MEMBER');
        }
    });

    it('grants when permissions[] explicitly grants beyond the role default', () => {
        // VIEWER doesn't have PRINT_QR by default, but a custom grant
        // adds it — useful for "QR-code printer" use cases.
        expect(assertCapability('VIEWER', 'PRINT_QR', ['PRINT_QR'])).toBe(true);
    });

    it('still grants when role default permits, even with empty permissions[]', () => {
        expect(assertCapability('OWNER', 'SUBMIT_APPLICATION', [])).toBe(true);
    });

    it('throws when role is missing', () => {
        expect(() => assertCapability(null, 'PRINT_QR')).toThrow();
    });
});

describe('Wave C PR-4 — findInviteeByIdentifier', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('resolves by healthId (primary channel)', async () => {
        prisma.user.findFirst.mockResolvedValue({
            id: 'u1', healthId: '1100000000008', firstName: 'A', lastName: 'B', email: 'a@b',
        });
        const out = await findInviteeByIdentifier({ type: 'healthId', value: '1100000000008' });
        expect(out).toEqual({
            user: expect.objectContaining({ id: 'u1', healthId: '1100000000008' }),
            ambiguous: false,
        });
    });

    it('returns null when no user matches', async () => {
        prisma.user.findFirst.mockResolvedValue(null);
        const out = await findInviteeByIdentifier({ type: 'healthId', value: 'unknown' });
        expect(out).toBeNull();
    });

    it('resolves uniquely by email', async () => {
        prisma.user.findMany.mockResolvedValue([
            { id: 'u1', healthId: '1100000000008', firstName: 'A', lastName: 'B', email: 'a@b.co' },
        ]);
        const out = await findInviteeByIdentifier({ type: 'email', value: 'a@b.co' });
        expect(out).toEqual({ user: expect.objectContaining({ id: 'u1' }), ambiguous: false });
    });

    it('returns ambiguous when 2+ users share an email', async () => {
        prisma.user.findMany.mockResolvedValue([
            { id: 'u1' }, { id: 'u2' },
        ]);
        const out = await findInviteeByIdentifier({ type: 'email', value: 'shared@b.co' });
        expect(out).toEqual({ user: null, ambiguous: true });
    });

    it('throws on unknown channel', async () => {
        await expect(findInviteeByIdentifier({ type: 'fingerprint', value: 'X' }))
            .rejects.toMatchObject({ code: 'INVALID_INVITE_CHANNEL' });
    });

    it('returns null on empty value', async () => {
        const out = await findInviteeByIdentifier({ type: 'healthId', value: '' });
        expect(out).toBeNull();
    });
});
