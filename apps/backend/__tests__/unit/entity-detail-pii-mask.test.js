// M1.5 H2 — the workspace read surface must not hand out national IDs.
// Spec: design note 2026-08-15-m1.5-hardening-design §H2.
//
// `Entity.thaiCitizenId` is encrypted at rest and DECRYPTED on read by the PDPA
// extension (services/prisma-pdpa-extension.js:246-266), and `payload.director
// .idCard` is stored plaintext by buildJuristicPayload (entity-service.js:1408).
// `GET /api/entities/:id` returned both to every member of the workspace,
// VIEWER included — while the sibling listing already masks at the service
// boundary for EVERY role including OWNER (entity-service.js:1174-1186, pinned
// by __tests__/unit/entity-members-national-id-masking.test.js). This file
// applies that same convention to the entity detail shape, and uses the SAME
// national-ID fixtures as that test.
//
// `shapeEntityResponse` is shared by three endpoints (routes/api/entities/
// index.js:217 POST /, :260 GET /:id, :294 PATCH /:id), so masking there covers
// all three on purpose — the echo of a create/update is masked too. That costs
// the caller nothing: the raw value is what they just submitted.

'use strict';

const express = require('express');
const request = require('supertest');

// The caller is always the same user; the ROLE under test comes from the
// membership row the entity lookup returns (pattern: entity-claim-guard.test.js:15).
jest.mock('../../middleware/auth-middleware', () => {
    const passUser = (req, _res, next) => {
        req.user = {
            id: 'user-caller',
            healthId: '1100000000008',
            organizationId: 'org-1',
            canonicalRole: 'health',
            role: 'HEALTH_USER',
        };
        next();
    };
    return { authenticateHealth: passUser, authenticateAny: passUser };
});

jest.mock('../../services/prisma-database', () => {
    const mockPrisma = {
        entity: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
        },
        entityMembership: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
            upsert: jest.fn(),
            update: jest.fn(),
        },
    };
    mockPrisma.$transaction = jest.fn(async (fn) => fn(mockPrisma));
    return { prisma: mockPrisma };
});

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const { prisma: client } = require('../../services/prisma-database');
const entityService = require('../../services/entity-service');
const entitiesRouter = require('../../routes/api/entities/index');

// Same fixtures as entity-members-national-id-masking.test.js:54-55.
const OWNER_ID = '1100000000008';
const DIRECTOR_ID = '1100000000009';
const MASKED_OWNER_ID = '1-XXXX-XXXX-X-0008';
const MASKED_DIRECTOR_ID = '1-XXXX-XXXX-X-0009';

const ENTITY_UUID = '11111111-1111-4111-8111-111111111111';

function juristicEntity(overrides = {}) {
    return {
        id: ENTITY_UUID,
        type: 'JURISTIC',
        slug: 'abc-co-ltd',
        displayName: 'ABC Co. Ltd.',
        status: 'ACTIVE',
        organizationId: 'org-1',
        isDeleted: false,
        juristicId: '0105561234560',
        communityRegNo: null,
        thaiCitizenId: OWNER_ID,
        payload: {
            companyType: 'LIMITED_COMPANY',
            registeredCapital: 1000000,
            address: { full: '123 Main St', province: 'เชียงใหม่' },
            director: { name: 'สมชาย', idCard: DIRECTOR_ID, phone: '0810000000' },
            contact: { name: 'ฝ่ายบุคคล', email: 'hr@example.com' },
        },
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-02-01'),
        ...overrides,
    };
}

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/entities', entitiesRouter);
    return app;
}

describe('M1.5 H2 — presentEntityForMember masks both national-ID carriers', () => {
    it('masks thaiCitizenId and payload.director.idCard for EVERY role including OWNER', () => {
        const out = entityService.presentEntityForMember({
            id: 'e1', type: 'JURISTIC', thaiCitizenId: '1234567890123',
            payload: { director: { name: 'สมชาย', idCard: '1234567890123' }, registeredCapital: 1000000 },
        });

        expect(out.thaiCitizenId).not.toBe('1234567890123');
        expect(out.thaiCitizenId).toBe('1-XXXX-XXXX-X-0123');
        expect(out.payload.director.idCard).not.toBe('1234567890123');
        expect(out.payload.director.idCard).toBe('1-XXXX-XXXX-X-0123');
        // Everything else in the payload is untouched — this is a mask, not a
        // whitelist rewrite.
        expect(out.payload.registeredCapital).toBe(1000000);
        expect(out.payload.director.name).toBe('สมชาย');
        expect(out.id).toBe('e1');
        expect(out.type).toBe('JURISTIC');
    });

    it('survives INDIVIDUAL shape: payload null / no director', () => {
        expect(() => entityService.presentEntityForMember({ id: 'e2', thaiCitizenId: null, payload: null })).not.toThrow();

        const out = entityService.presentEntityForMember({ id: 'e2', thaiCitizenId: null, payload: null });
        expect(out.thaiCitizenId).toBeNull();
        expect(out.payload).toBeNull();

        // COMMUNITY_ENTERPRISE payloads carry the president's national ID the
        // same way juristic ones carry the director's (entity-service.js:1482,
        // and the PII registry files both side by side — formdata-pii.js:183-184).
        // M1.5 audit CRITICAL-1: it is masked by the SAME rule.
        const community = entityService.presentEntityForMember({
            id: 'e3', type: 'COMMUNITY_ENTERPRISE', thaiCitizenId: null,
            payload: { memberCount: 12, president: { name: 'ประเสริฐ', idCard: '1100000000009' } },
        });
        expect(community.payload.memberCount).toBe(12);
        expect(community.payload.president.name).toBe('ประเสริฐ');
        expect(community.payload.president.idCard).not.toBe('1100000000009');
    });

    it('does not mutate the row it was handed (the caller may still hold the Prisma object)', () => {
        const row = juristicEntity();
        entityService.presentEntityForMember(row);

        expect(row.thaiCitizenId).toBe(OWNER_ID);
        expect(row.payload.director.idCard).toBe(DIRECTOR_ID);
    });

    it('leaves a null / absent id card alone rather than masking it into a string', () => {
        const out = entityService.presentEntityForMember({
            id: 'e4', thaiCitizenId: null,
            payload: { director: { name: 'สมชาย', idCard: null } },
        });

        expect(out.thaiCitizenId).toBeNull();
        expect(out.payload.director.idCard).toBeNull();
    });
});

describe('M1.5 H2 — GET /api/entities/:id masks for every role', () => {
    let app;
    beforeAll(() => { app = makeApp(); });
    beforeEach(() => jest.clearAllMocks());

    it.each(['VIEWER', 'MANAGER', 'ADMIN', 'OWNER'])('role %s receives masked national IDs', async (role) => {
        client.entity.findFirst.mockResolvedValue({
            ...juristicEntity(),
            members: [{ role, permissions: [], status: 'ACTIVE' }],
        });

        const r = await request(app).get(`/api/entities/${ENTITY_UUID}`);

        expect(r.status).toBe(200);
        expect(r.body.data.role).toBe(role);
        expect(r.body.data.thaiCitizenId).toBe(MASKED_OWNER_ID);
        expect(r.body.data.payload.director.idCard).toBe(MASKED_DIRECTOR_ID);
        // Nothing anywhere in the response carries a raw 13-digit ID.
        expect(JSON.stringify(r.body)).not.toContain(OWNER_ID);
        expect(JSON.stringify(r.body)).not.toContain(DIRECTOR_ID);
        // The workspace data the screen actually needs is still there.
        expect(r.body.data.displayName).toBe('ABC Co. Ltd.');
        expect(r.body.data.payload.registeredCapital).toBe(1000000);
        expect(r.body.data.payload.director.name).toBe('สมชาย');
    });

    it('an INDIVIDUAL entity with a null payload still answers 200', async () => {
        client.entity.findFirst.mockResolvedValue({
            id: ENTITY_UUID, type: 'INDIVIDUAL', slug: 'me', displayName: 'สมชาย ใจดี',
            status: 'ACTIVE', organizationId: 'org-1', juristicId: null, communityRegNo: null,
            thaiCitizenId: OWNER_ID, payload: null,
            createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
            members: [{ role: 'OWNER', permissions: [], status: 'ACTIVE' }],
        });

        const r = await request(app).get(`/api/entities/${ENTITY_UUID}`);

        expect(r.status).toBe(200);
        expect(r.body.data.payload).toBeNull();
        expect(r.body.data.thaiCitizenId).toBe(MASKED_OWNER_ID);
        expect(JSON.stringify(r.body)).not.toContain(OWNER_ID);
    });
});

describe('M1.5 H2 — the create / update echoes are masked too (same helper, three endpoints)', () => {
    let app;
    beforeAll(() => { app = makeApp(); });
    beforeEach(() => jest.clearAllMocks());

    it('PATCH /api/entities/:id echoes the updated row masked', async () => {
        client.entity.findFirst.mockResolvedValue({
            ...juristicEntity(),
            members: [{ role: 'OWNER', permissions: [], status: 'ACTIVE' }],
        });
        client.entity.update.mockResolvedValue(juristicEntity());

        const r = await request(app)
            .patch(`/api/entities/${ENTITY_UUID}`)
            .send({ payload: { director: { name: 'สมชาย', idCard: DIRECTOR_ID } } });

        expect(r.status).toBe(200);
        expect(r.body.data.thaiCitizenId).toBe(MASKED_OWNER_ID);
        expect(r.body.data.payload.director.idCard).toBe(MASKED_DIRECTOR_ID);
        expect(JSON.stringify(r.body)).not.toContain(DIRECTOR_ID);
    });

    it('POST /api/entities echoes the created workspace masked', async () => {
        client.entity.findFirst.mockResolvedValue(null);
        client.entity.create.mockImplementation(({ data }) => Promise.resolve({ id: 'ent-new', ...data }));
        client.entityMembership.upsert.mockResolvedValue({ id: 'mem-new', role: 'OWNER', status: 'ACTIVE' });

        const r = await request(app).post('/api/entities').send({
            type: 'JURISTIC',
            applicantData: {
                applicantType: 'JURISTIC',
                taxId: '0105561234560',
                companyName: 'ABC Co. Ltd.',
                companyAddress: '123 Main St',
                companyType: 'LIMITED_COMPANY',
                directorName: 'สมชาย',
                directorIdCard: DIRECTOR_ID,
            },
        });

        expect(r.status).toBe(200);
        expect(r.body.data.payload.director.idCard).toBe(MASKED_DIRECTOR_ID);
        expect(JSON.stringify(r.body)).not.toContain(DIRECTOR_ID);
        // The create path is unchanged otherwise.
        expect(r.body.data).toMatchObject({ type: 'JURISTIC', role: 'OWNER' });
    });
});
