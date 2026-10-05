'use strict';

/**
 * M1 AC2 / AC3 against a REAL Postgres — "ยื่นในนาม entity" with real rows.
 *
 * The unit suites prove the WIRING (which entity each door asks about, what the
 * refusal looks like, that nothing is written when the answer is no). They
 * cannot prove the two things that only exist in the database:
 *
 *   AC2 — a caller who is neither an ACTIVE member nor a grant-holder is
 *         refused, and the refusal leaves a real AuditLog FAILURE row behind
 *         (auditLogger.log opens its own transaction and takes an advisory
 *         lock — middleware/audit-logger.js:479,505-506 — so the row survives
 *         the caller's rollback).
 *   AC3 — a per-member GRANT row (EntityMemberPermissionGrant, effect GRANT)
 *         flips the same call to allowed, and the accepted act is recorded with
 *         `metadata.onBehalfOfEntityId` (plan D9 — metadata, no new column).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HONEST SCOPE (Law L1). THIS FILE HAS NEVER EXECUTED. The dev machine that
 * wrote it has no DATABASE_URL, no Postgres on 5432 and no docker
 * (verified 2026-08-15 — plan Global Constraints), so it self-skips here and
 * NEITHER red NOR green is claimed for any case below. It is written to be run
 * on staging after `prisma migrate deploy`; expect the FIXTURES (organization,
 * user, entity, membership shapes) to need repair on the first real run, and do
 * not read a fixture failure as a product failure.
 *
 * What it deliberately does NOT cover: the HTTP layer of the four doors. That
 * is covered by the unit suites over supertest with the engine mocked; here the
 * subject is the guard + the real permission engine + the real audit writer
 * against real rows.
 */

const crypto = require('crypto');

// Not `Boolean(process.env.DATABASE_URL)`: jest.setup.js:104 pins that variable on every
// run, so the old HAS_DB was always true — this suite never skipped and died on connection
// refused. Ask the run-level guard what it actually probed; it names the reason in the title.
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

d('M1 submit enforcement (real Postgres)', () => {
    let prisma;
    let assertSubmitAllowed;
    const created = { grants: [], memberships: [], applications: [], entities: [], users: [], orgs: [] };

    const uid = () => crypto.randomUUID();

    beforeAll(async () => {
        ({ prisma } = require('../../services/prisma-database'));
        ({ assertSubmitAllowed } = require('../../services/application-submit-guard'));
    });

    afterAll(async () => {
        // Reverse dependency order.
        for (const g of created.grants) {
            await prisma.entityMemberPermissionGrant.deleteMany({ where: { membershipId: g } });
        }
        for (const id of created.applications) {
            await prisma.application.deleteMany({ where: { id } });
        }
        for (const id of created.memberships) {
            await prisma.entityMembership.deleteMany({ where: { id } });
        }
        for (const id of created.entities) {
            await prisma.entity.deleteMany({ where: { id } });
        }
        for (const id of created.users) {
            await prisma.user.deleteMany({ where: { id } });
        }
    });

    /**
     * One entity, one application belonging to it, and one user who is NOT a
     * member of it. Everything is created inside an existing organization so no
     * tenancy row has to be invented.
     */
    async function seedOutsiderAndEntity() {
        const org = await prisma.organization.findFirst({ select: { id: true } });
        if (!org) { throw new Error('m1-submit-enforcement: no organization row to attach fixtures to'); }

        const entity = await prisma.entity.create({
            data: {
                type: 'JURISTIC',
                displayName: `M1 TEST CO ${uid().slice(0, 8)}`,
                organizationId: org.id,
                status: 'ACTIVE',
            },
        });
        created.entities.push(entity.id);

        const user = await prisma.user.create({
            data: {
                id: uid(),
                email: `m1-outsider-${uid().slice(0, 8)}@example.test`,
                password: 'not-a-real-secret-hash',
                firstName: 'M1',
                lastName: 'Outsider',
                role: 'HEALTH_USER',
                organizationId: org.id,
            },
        });
        created.users.push(user.id);

        const application = await prisma.application.create({
            data: {
                applicationNumber: `M1-TEST-${uid().slice(0, 8)}`,
                status: 'DRAFT',
                organizationId: org.id,
                entityId: entity.id,
                formData: {},
            },
        });
        created.applications.push(application.id);

        return { org, entity, user, application };
    }

    async function countFailureRows(applicationId) {
        return prisma.auditLog.count({
            where: { resourceId: applicationId, result: 'FAILURE' },
        });
    }

    it('AC2 — a non-member is refused 403 ENTITY_PERMISSION_DENIED and the refusal is on the record', async () => {
        const { user, entity, application } = await seedOutsiderAndEntity();
        const before = await countFailureRows(application.id);

        await expect(assertSubmitAllowed({
            userId: user.id,
            application,
            auditContext: { actorRole: 'health', route: 'TEST' },
        })).rejects.toMatchObject({ status: 403, code: 'ENTITY_PERMISSION_DENIED' });

        expect(await countFailureRows(application.id)).toBe(before + 1);

        const row = await prisma.auditLog.findFirst({
            where: { resourceId: application.id, result: 'FAILURE' },
            orderBy: { createdAt: 'desc' },
        });
        expect(row.actorId).toBe(user.id);
        expect(row.metadata.onBehalfOfEntityId).toBe(entity.id);
    });

    it('AC3 — an ACTIVE membership carrying a SUBMIT_APPLICATION GRANT is allowed, and names the entity', async () => {
        const { org, user, entity, application } = await seedOutsiderAndEntity();

        // MANAGER: deliberately a role whose DEFAULTS do NOT include
        // SUBMIT_APPLICATION (plan D6 / review B1). The GRANT row is what makes
        // the difference, which is the whole point of AC3.
        const membership = await prisma.entityMembership.create({
            data: {
                userId: user.id,
                entityId: entity.id,
                role: 'MANAGER',
                status: 'ACTIVE',
                organizationId: org.id,
            },
        });
        created.memberships.push(membership.id);

        await expect(assertSubmitAllowed({
            userId: user.id, application, auditContext: { actorRole: 'health' },
        })).rejects.toMatchObject({ status: 403 });

        await prisma.entityMemberPermissionGrant.create({
            data: {
                membershipId: membership.id,
                permission: 'SUBMIT_APPLICATION',
                effect: 'GRANT',
                organizationId: org.id,
            },
        });
        created.grants.push(membership.id);

        await expect(assertSubmitAllowed({
            userId: user.id, application, auditContext: { actorRole: 'health' },
        })).resolves.toEqual({ entityId: entity.id });
    });

    it('AC2 — a REVOKE row wins over the grant (fail closed), still audited', async () => {
        const { org, user, entity, application } = await seedOutsiderAndEntity();
        const membership = await prisma.entityMembership.create({
            data: {
                userId: user.id, entityId: entity.id, role: 'OWNER',
                status: 'ACTIVE', organizationId: org.id,
            },
        });
        created.memberships.push(membership.id);

        await expect(assertSubmitAllowed({
            userId: user.id, application, auditContext: {},
        })).resolves.toEqual({ entityId: entity.id });

        await prisma.entityMemberPermissionGrant.create({
            data: {
                membershipId: membership.id,
                permission: 'SUBMIT_APPLICATION',
                effect: 'REVOKE',
                organizationId: org.id,
            },
        });
        created.grants.push(membership.id);

        const before = await countFailureRows(application.id);
        await expect(assertSubmitAllowed({
            userId: user.id, application, auditContext: {},
        })).rejects.toMatchObject({ status: 403, code: 'ENTITY_PERMISSION_DENIED' });
        expect(await countFailureRows(application.id)).toBe(before + 1);
    });

    it('AC2 — an application naming no entity is 400 VALIDATION_ERROR, audited with a null holder', async () => {
        const { user, application } = await seedOutsiderAndEntity();

        await expect(assertSubmitAllowed({
            userId: user.id,
            application: { ...application, entityId: null },
            auditContext: {},
        })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });

        const row = await prisma.auditLog.findFirst({
            where: { resourceId: application.id, result: 'FAILURE' },
            orderBy: { createdAt: 'desc' },
        });
        expect(row.metadata.onBehalfOfEntityId).toBeNull();
    });
});
