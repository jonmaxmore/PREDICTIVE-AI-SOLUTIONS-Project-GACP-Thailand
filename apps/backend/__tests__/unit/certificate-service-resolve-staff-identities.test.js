/**
 * certificate-service.resolveStaffIdentities — the read-only, tenant-scoped
 * User lookup behind GET /api/certificates/:id issuer / revoker
 * (ledger F-G4-47).
 *
 *   1. empty / falsy ids → {} without touching Prisma;
 *   2. tenant-bound caller: where { id: { in }, organizationId } — the same
 *      predicate shape findById applies to the certificate row;
 *   3. crossTenant (PLATFORM_ADMIN): no organizationId predicate;
 *   4. select is EXACTLY { id, firstName, lastName } — never healthId /
 *      providerId / email, so a health applicant's national id cannot ride
 *      out through this door;
 *   5. displayName = 'firstName lastName' trimmed; both names null →
 *      displayName null (the screen falls back to a role label);
 *   6. duplicate ids are looked up once.
 *
 * Mock pattern mirrors certificate-service.test.js.
 */

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        certificate: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
            update: jest.fn(),
        },
        user: {
            findMany: jest.fn(),
        },
    },
}));

jest.mock('../../services/cache-service', () => ({
    invalidateAnalyticsCache: jest.fn().mockResolvedValue(undefined),
}));

const { prisma } = require('../../services/prisma-database');
const certificateService = require('../../services/certificate-service');

const ISSUER_ID = '79242ab9-ae05-46e8-81f2-4743730ad7be';
const REVOKER_ID = 'f71d11dc-e896-4c93-86b0-00af70c4aa54';

describe('certificate-service.resolveStaffIdentities', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        prisma.user.findMany.mockResolvedValue([]);
    });

    it('1. returns {} for no ids without hitting Prisma', async () => {
        expect(await certificateService.resolveStaffIdentities([], { organizationId: 'org-A' })).toEqual({});
        expect(await certificateService.resolveStaffIdentities([null, undefined, ''], { organizationId: 'org-A' })).toEqual({});
        expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('2.+4.+6. tenant-bound: where { id in, organizationId }, select exactly id/firstName/lastName, duplicates collapsed', async () => {
        prisma.user.findMany.mockResolvedValue([
            { id: ISSUER_ID, firstName: 'สมชาย', lastName: 'ตรวจดี' },
        ]);

        const out = await certificateService.resolveStaffIdentities(
            [ISSUER_ID, ISSUER_ID, REVOKER_ID],
            { organizationId: 'org-A', crossTenant: false },
        );

        expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
        const query = prisma.user.findMany.mock.calls[0][0];
        expect(query.where).toEqual({ id: { in: [ISSUER_ID, REVOKER_ID] }, organizationId: 'org-A' });
        expect(Object.keys(query.select).sort()).toEqual(['firstName', 'id', 'lastName']);
        expect(query).not.toHaveProperty('include');
        expect(out).toEqual({
            [ISSUER_ID]: { id: ISSUER_ID, displayName: 'สมชาย ตรวจดี' },
        });
    });

    it('3. crossTenant: no organizationId predicate', async () => {
        await certificateService.resolveStaffIdentities([ISSUER_ID], { organizationId: 'org-A', crossTenant: true });

        const query = prisma.user.findMany.mock.calls[0][0];
        expect(query.where).toEqual({ id: { in: [ISSUER_ID] } });
    });

    it('5. both names null → displayName null; a single name is used as-is', async () => {
        prisma.user.findMany.mockResolvedValue([
            { id: ISSUER_ID, firstName: null, lastName: null },
            { id: REVOKER_ID, firstName: 'สมหญิง', lastName: null },
        ]);

        const out = await certificateService.resolveStaffIdentities([ISSUER_ID, REVOKER_ID], { organizationId: 'org-A' });

        expect(out[ISSUER_ID]).toEqual({ id: ISSUER_ID, displayName: null });
        expect(out[REVOKER_ID]).toEqual({ id: REVOKER_ID, displayName: 'สมหญิง' });
    });
});
