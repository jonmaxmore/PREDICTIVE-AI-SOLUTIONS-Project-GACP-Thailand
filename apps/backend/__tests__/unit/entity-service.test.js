// Phase 4c — exercise the JURISTIC / COMMUNITY_ENTERPRISE helpers
// added to entity-service.js. The personal-INDIVIDUAL helper from Phase 67
// is covered indirectly by the auth-service tests.

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        entity: {
            findFirst: jest.fn(),
            create: jest.fn(),
        },
        entityMembership: {
            // M1.5 H1 — the ensure* helpers now READ the caller's membership on
            // an already-registered entity before deciding create vs refuse.
            findUnique: jest.fn(),
            create: jest.fn(),
            upsert: jest.fn(),
        },
    },
}));

// M1.5 H1 — the refusal path writes a best-effort ENTITY_CLAIM_REFUSED row.
// Stub the writer only; the real constants stay (pattern:
// applications-submit-capability-gate.test.js:76).
jest.mock('../../middleware/audit-logger', () => {
    const actual = jest.requireActual('../../middleware/audit-logger');
    return {
        ...actual,
        auditLogger: {
            log: jest.fn().mockResolvedValue({ id: 'audit-1' }),
            logWithin: jest.fn(() => jest.fn()),
        },
    };
});

const { prisma } = require('../../services/prisma-database');
const entityService = require('../../services/entity-service');

const VALID_JURISTIC_TAX_ID = '0105561234560';

describe('entity-service.ensureJuristicEntity', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('creates the entity + OWNER membership when none exists', async () => {
        prisma.entity.findFirst.mockResolvedValue(null);
        prisma.entity.create.mockResolvedValue({ id: 'entity-1', type: 'JURISTIC' });
        prisma.entityMembership.upsert.mockResolvedValue({ id: 'membership-1', role: 'OWNER' });

        const out = await entityService.ensureJuristicEntity({
            user: { id: 'user-1', organizationId: 'org-1' },
            applicantData: {
                applicantType: 'JURISTIC',
                taxId: VALID_JURISTIC_TAX_ID,
                companyName: 'ABC Co. Ltd.',
                companyAddress: '123 Main St',
                companyType: 'LIMITED_COMPANY',
                directorName: 'Director X',
            },
        });

        expect(out.fresh).toBe(true);
        expect(prisma.entity.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                type: 'JURISTIC',
                displayName: 'ABC Co. Ltd.',
                juristicId: VALID_JURISTIC_TAX_ID,
                organizationId: 'org-1',
                createdBy: 'user-1',
                payload: expect.objectContaining({
                    companyType: 'LIMITED_COMPANY',
                    director: expect.objectContaining({ name: 'Director X' }),
                }),
            }),
        });
        expect(prisma.entityMembership.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { userId_entityId: { userId: 'user-1', entityId: 'entity-1' } },
        }));
    });

    // M1.5 H1 (FLIPPED) — this used to pin "reuses an existing entity
    // (idempotent) and does not call create", i.e. an upsert that made ANY
    // caller the OWNER of an entity found by its PUBLIC registration number.
    // That was the workspace-takeover hole. Reuse is now OWNER-only; everyone
    // else is refused. Spec §H1.
    it('refuses to attach a non-member to an existing entity found by tax ID (409)', async () => {
        prisma.entity.findFirst.mockResolvedValue({ id: 'entity-1' });
        prisma.entityMembership.findUnique.mockResolvedValue(null);

        await expect(entityService.ensureJuristicEntity({
            user: { id: 'user-1', organizationId: 'org-1' },
            applicantData: { taxId: VALID_JURISTIC_TAX_ID, companyName: 'X Co.' },
        })).rejects.toMatchObject({ status: 409, code: 'ENTITY_ALREADY_REGISTERED' });

        expect(prisma.entity.create).not.toHaveBeenCalled();
        expect(prisma.entityMembership.upsert).not.toHaveBeenCalled();
        expect(prisma.entityMembership.create).not.toHaveBeenCalled();
    });

    it('reuses an existing entity for its real OWNER (idempotent) and does not call create', async () => {
        prisma.entity.findFirst.mockResolvedValue({ id: 'entity-1' });
        prisma.entityMembership.findUnique.mockResolvedValue({ role: 'OWNER', status: 'ACTIVE' });

        const out = await entityService.ensureJuristicEntity({
            user: { id: 'user-1', organizationId: 'org-1' },
            applicantData: { taxId: VALID_JURISTIC_TAX_ID, companyName: 'X Co.' },
        });

        expect(out.fresh).toBe(false);
        expect(prisma.entity.create).not.toHaveBeenCalled();
        expect(prisma.entityMembership.upsert).not.toHaveBeenCalled();
    });

    it('rejects with APPLICANT_VALIDATION_FAILED when validation fails', async () => {
        await expect(entityService.ensureJuristicEntity({
            user: { id: 'user-1', organizationId: 'org-1' },
            applicantData: { taxId: '1100000000008', companyName: 'X' }, // not starting with 0
        })).rejects.toMatchObject({
            code: 'APPLICANT_VALIDATION_FAILED',
        });
        expect(prisma.entity.create).not.toHaveBeenCalled();
    });

    it('rejects when user.id is missing', async () => {
        await expect(entityService.ensureJuristicEntity({
            user: { organizationId: 'org-1' },
            applicantData: { taxId: VALID_JURISTIC_TAX_ID, companyName: 'X' },
        })).rejects.toThrow(/user\.id/);
    });

    it('rejects when organizationId is missing (ADR-014)', async () => {
        await expect(entityService.ensureJuristicEntity({
            user: { id: 'user-1' },
            applicantData: { taxId: VALID_JURISTIC_TAX_ID, companyName: 'X' },
        })).rejects.toThrow(/organizationId/);
    });
});

describe('entity-service.ensureCommunityEntity', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('creates the entity + OWNER membership for an 11-digit DOAE number', async () => {
        prisma.entity.findFirst.mockResolvedValue(null);
        prisma.entity.create.mockResolvedValue({ id: 'entity-2', type: 'COMMUNITY_ENTERPRISE' });
        prisma.entityMembership.upsert.mockResolvedValue({ id: 'membership-2', role: 'OWNER' });

        const out = await entityService.ensureCommunityEntity({
            user: { id: 'user-1', organizationId: 'org-1' },
            applicantData: {
                applicantType: 'COMMUNITY',
                communityRegNumber: '12345678901',
                communityName: 'วิสาหกิจชุมชนสมุนไพรบ้านสวน',
                presidentName: 'Prasert',
                memberCount: 12,
            },
        });

        expect(out.fresh).toBe(true);
        expect(prisma.entity.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                type: 'COMMUNITY_ENTERPRISE',
                displayName: 'วิสาหกิจชุมชนสมุนไพรบ้านสวน',
                communityRegNo: '12345678901',
                payload: expect.objectContaining({
                    memberCount: 12,
                    president: expect.objectContaining({ name: 'Prasert' }),
                }),
            }),
        });
    });

    it('rejects on a 10-digit (wrong length) registration number', async () => {
        await expect(entityService.ensureCommunityEntity({
            user: { id: 'user-1', organizationId: 'org-1' },
            applicantData: { communityRegNumber: '1234567890', communityName: 'X' },
        })).rejects.toMatchObject({ code: 'APPLICANT_VALIDATION_FAILED' });
    });
});

// M1.5 H1 — the `entity-service.ensureEntityFromApplicantData (dispatcher)`
// suite that stood here (4 cases: INDIVIDUAL → null, missing applicantType →
// null, JURISTIC dispatch, legacy "COMMUNITY" alias dispatch) is deleted with
// the helper it covered. That helper minted an org Entity out of a request-body
// registration number and made the caller its OWNER; spec §H1 removes it, and
// the pin below keeps the export from coming back.
describe('entity-service — the legacy applicantData dispatcher stays deleted (M1.5 H1)', () => {
    it('does not export ensureEntityFromApplicantData', () => {
        expect(entityService.ensureEntityFromApplicantData).toBeUndefined();
    });
});
