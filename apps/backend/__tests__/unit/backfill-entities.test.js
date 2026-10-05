/**
 * Unit tests for scripts/backfill-entities.js — the Entity + EntityMembership
 * backfill that wires pre-existing Application/Farm rows to a user's personal
 * INDIVIDUAL entity.
 *
 * Regression context (detokenize bug, verified live on staging 2026-07):
 *   - User.healthId is now `enc:v1:` AES ciphertext under ENABLE_PDPA_FIELD_ENCRYPTION.
 *   - Application.healthId now holds a keyed-HMAC TOKEN (== User.canonicalId),
 *     NOT the 13-digit national ID.
 *   The old script hashed the ciphertext / token → never matched the real
 *   Entity → CREATED A DUPLICATE INDIVIDUAL entity per user and wired 0 apps.
 *
 * The rewrite resolves the user's personal INDIVIDUAL entity via their
 * runtime-authoritative OWNER INDIVIDUAL EntityMembership (encoding-independent),
 * mirroring services/entity-service.js ensurePersonalIndividualEntity. These
 * tests inject a fake prisma client so they never need a DATABASE_URL.
 */

'use strict';

const {
    resolveUserPersonalEntity,
    step1BackfillEntities,
    step2BackfillApplications,
    step3BackfillFarms,
    parseArgs,
} = require('../../scripts/backfill-entities');

/**
 * Minimal in-memory fake of the Prisma surface the backfill touches.
 * Records every write so tests can assert dry-run performs ZERO writes and
 * live runs perform the RIGHT writes.
 */
function makePrisma({ users = [], entities = [], memberships = [], applications = [], farms = [] } = {}) {
    const writes = { entityCreate: [], membershipUpsert: [], applicationUpdate: [], farmUpdate: [] };
    return {
        writes,
        _state: { users, entities, memberships, applications, farms },
        user: {
            findMany: jest.fn(async ({ where = {} } = {}) =>
                users.filter((u) => (where.healthId ? u.healthId != null : true))),
            findUnique: jest.fn(async ({ where }) => users.find((u) => u.id === where.id) || null),
            findFirst: jest.fn(async ({ where = {} }) =>
                users.find((u) => (where.canonicalId ? u.canonicalId === where.canonicalId : false)) || null),
        },
        entity: {
            findFirst: jest.fn(async ({ where = {} }) =>
                entities.find((e) => (where.thaiCitizenIdHash ? e.thaiCitizenIdHash === where.thaiCitizenIdHash : false)) || null),
            create: jest.fn(async ({ data }) => {
                writes.entityCreate.push(data);
                const row = { id: `ent-new-${writes.entityCreate.length}`, createdAt: new Date(), ...data };
                entities.push(row);
                return row;
            }),
        },
        entityMembership: {
            findFirst: jest.fn(async ({ where = {} }) =>
                memberships.find((m) =>
                    m.userId === where.userId
                    && m.role === (where.role || m.role)
                    && (where.entity ? m.entityType === 'INDIVIDUAL' && !m.entityDeleted : true),
                ) || null),
            upsert: jest.fn(async ({ where, create }) => {
                writes.membershipUpsert.push({ where, create });
                return { id: `mem-${writes.membershipUpsert.length}` };
            }),
        },
        application: {
            findMany: jest.fn(async () => applications),
            update: jest.fn(async ({ where, data }) => {
                writes.applicationUpdate.push({ id: where.id, data });
                return { id: where.id, ...data };
            }),
        },
        farm: {
            findMany: jest.fn(async () => farms),
            update: jest.fn(async ({ where, data }) => {
                writes.farmUpdate.push({ id: where.id, data });
                return { id: where.id, ...data };
            }),
        },
    };
}

describe('backfill-entities / parseArgs', () => {
    test('defaults to a live run', () => {
        expect(parseArgs([])).toEqual({ dryRun: false, verbose: false });
    });
    test('--dry-run sets dryRun', () => {
        expect(parseArgs(['--dry-run'])).toMatchObject({ dryRun: true });
    });
    test('--verbose sets verbose', () => {
        expect(parseArgs(['--verbose'])).toMatchObject({ verbose: true });
    });
});

describe('backfill-entities / resolveUserPersonalEntity', () => {
    test('resolves to the existing OWNER INDIVIDUAL membership entity — does NOT create a duplicate', async () => {
        const user = { id: 'u-1', healthId: 'enc:v1:ciphertext', organizationId: 'org-1' };
        const prisma = makePrisma({
            memberships: [
                { userId: 'u-1', role: 'OWNER', entityType: 'INDIVIDUAL', entityDeleted: false, entity: { id: 'ent-existing-1' } },
            ],
        });
        const entityId = await resolveUserPersonalEntity(prisma, user, { dryRun: false });
        expect(entityId).toBe('ent-existing-1');
        // The bug was: hashing the ciphertext missed the real entity and created a dupe.
        expect(prisma.entity.create).not.toHaveBeenCalled();
        expect(prisma.writes.entityCreate).toHaveLength(0);
    });

    test('dry-run never writes even when the user has NO entity yet', async () => {
        const user = { id: 'u-2', healthId: 'enc:v1:ciphertext', organizationId: 'org-1' };
        const prisma = makePrisma({ memberships: [] });
        await resolveUserPersonalEntity(prisma, user, { dryRun: true });
        expect(prisma.entity.create).not.toHaveBeenCalled();
        expect(prisma.entityMembership.upsert).not.toHaveBeenCalled();
        expect(prisma.writes.entityCreate).toHaveLength(0);
        expect(prisma.writes.membershipUpsert).toHaveLength(0);
    });
});

describe('backfill-entities / step1BackfillEntities', () => {
    test('re-run with everyone already owning an entity is a no-op (idempotent)', async () => {
        const prisma = makePrisma({
            users: [{ id: 'u-1', healthId: 'enc:v1:a', organizationId: 'org-1' }],
            memberships: [
                { userId: 'u-1', role: 'OWNER', entityType: 'INDIVIDUAL', entityDeleted: false, entity: { id: 'ent-1' } },
            ],
        });
        const result = await step1BackfillEntities(prisma, { dryRun: false });
        expect(prisma.entity.create).not.toHaveBeenCalled();
        expect(result.entitiesCreated).toBe(0);
    });

    test('dry-run performs zero writes across all users', async () => {
        const prisma = makePrisma({
            users: [
                { id: 'u-1', healthId: 'enc:v1:a', organizationId: 'org-1' },
                { id: 'u-2', healthId: 'enc:v1:b', organizationId: 'org-1' },
            ],
            memberships: [],
        });
        await step1BackfillEntities(prisma, { dryRun: true });
        expect(prisma.writes.entityCreate).toHaveLength(0);
        expect(prisma.writes.membershipUpsert).toHaveLength(0);
    });
});

describe('backfill-entities / step2BackfillApplications', () => {
    const applications = [{ id: 'a-1', healthId: 'token-abc' }];
    const users = [{ id: 'u-1', healthId: 'enc:v1:a', canonicalId: 'token-abc', organizationId: 'org-1' }];
    const memberships = [
        { userId: 'u-1', role: 'OWNER', entityType: 'INDIVIDUAL', entityDeleted: false, entity: { id: 'ent-1' } },
    ];

    test('maps app.entityId via the owner user (canonicalId=token) → membership entity, NOT a hash', async () => {
        const prisma = makePrisma({ users, memberships, applications });
        const result = await step2BackfillApplications(prisma, { dryRun: false });
        // Token join, never a hash lookup on Application.healthId.
        expect(prisma.user.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ canonicalId: 'token-abc' }) }),
        );
        expect(prisma.writes.applicationUpdate).toEqual([
            { id: 'a-1', data: { entityId: 'ent-1', submitterId: 'u-1' } },
        ]);
        expect(result.updated).toBe(1);
    });

    test('dry-run performs zero application writes', async () => {
        const prisma = makePrisma({ users, memberships, applications });
        await step2BackfillApplications(prisma, { dryRun: true });
        expect(prisma.application.update).not.toHaveBeenCalled();
        expect(prisma.writes.applicationUpdate).toHaveLength(0);
    });
});

describe('backfill-entities / step3BackfillFarms', () => {
    const farms = [{ id: 'f-1', ownerId: 'u-1' }];
    const users = [{ id: 'u-1', healthId: 'enc:v1:a', canonicalId: 'token-abc', organizationId: 'org-1' }];
    const memberships = [
        { userId: 'u-1', role: 'OWNER', entityType: 'INDIVIDUAL', entityDeleted: false, entity: { id: 'ent-1' } },
    ];

    test('maps farm.entityId via ownerId (User.id) → membership entity, NOT a hash', async () => {
        const prisma = makePrisma({ users, memberships, farms });
        const result = await step3BackfillFarms(prisma, { dryRun: false });
        expect(prisma.writes.farmUpdate).toEqual([{ id: 'f-1', data: { entityId: 'ent-1' } }]);
        expect(result.updated).toBe(1);
    });

    test('dry-run performs zero farm writes', async () => {
        const prisma = makePrisma({ users, memberships, farms });
        await step3BackfillFarms(prisma, { dryRun: true });
        expect(prisma.farm.update).not.toHaveBeenCalled();
        expect(prisma.writes.farmUpdate).toHaveLength(0);
    });
});
