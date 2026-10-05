/**
 * withoutTenantScope + a lazy PrismaPromise — proved on a REAL Postgres with the
 * REAL tenant-prisma-extension (services/prisma-database singleton).
 *
 * `withoutTenantScope(() => prisma.x.y(...))` returned an un-started
 * PrismaPromise. It started when the CALLER awaited it — after the null store
 * had exited — so the org read-scope ran with the caller's organizationId and
 * spread it over the query's own explicit filter. Three consequences, each a
 * block below:
 *
 *   S6  — a PLATFORM_ADMIN bound to org A editing org B: the directory lookup
 *         404'd, and the last-admin count ran in org A instead of org B, so B's
 *         last admin could be removed whenever A had any admin.
 *   S7  — a REVOKE stored under org B was invisible to a caller bound to org A:
 *         the revoked permission stayed effective, and revoking the member left
 *         the grant rows behind.
 *   $   — settlement-reconcile (a money-path job, no tenant bound): must see
 *         every org's stale order before and after the change.
 *
 * Requires a migrated test database (jest.globalsetup.js verifies it); skips
 * with the reason otherwise.
 */

'use strict';

const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');

// Real tenant binding: the auth mock sets req.user from headers, then hands off
// to the REAL tenant-context middleware, exactly as authenticateProvider does.
jest.mock('../../middleware/auth-middleware', () => {
    const { tenantContextMiddleware } = jest.requireActual('../../middleware/tenant-context-middleware');
    const bindTenant = tenantContextMiddleware();
    const auth = (req, res, next) => {
        const role = req.headers['x-test-role'];
        if (!role) { return res.status(401).json({ success: false }); }
        req.user = {
            id: req.headers['x-test-user-id'],
            role,
            canonicalRole: role,
            providerId: req.headers['x-test-provider-id'] || null,
            organizationId: req.headers['x-test-organization-id'],
        };
        return bindTenant(req, res, next);
    };
    return {
        authenticateProvider: auth,
        authenticateAny: auth,
        authenticateDTAM: auth,
        authenticate: auth,
        // REAL role guard (review M2): the organizations door must refuse a
        // tenant role on its own, not because the test waved it through.
        requireRole: jest.requireActual('../../middleware/role-middleware').requireRole,
        optionalAuth: auth,
        requireVerification: (_req, _res, next) => next(),
        checkPermission: () => (_req, _res, next) => next(),
        rateLimitSensitive: () => (_req, _res, next) => next(),
    };
});

// The reconcile job asks the gateway about each candidate order. Record the
// question, answer "not captured" so nothing is re-driven.
const mockAskedIntents = [];
jest.mock('../../services/payment/payment-adapter', () => {
    const actual = jest.requireActual('../../services/payment/payment-adapter');
    return {
        ...actual,
        getPaymentAdapter: () => ({
            getPaymentIntent: async (id) => { mockAskedIntents.push(id); return { id, status: 'processing' }; },
        }),
    };
});

const { describeIfTestDatabase: d } = require('../../test-support/test-database');

d('withoutTenantScope runs a lazy PrismaPromise with no tenant bound (real Postgres)', () => {
    /* eslint-disable global-require */
    const { PrismaClient } = require('@prisma/client');
    const { runWithTenantContext } = require('../../services/tenant-context');
    const adminUserService = require('../../services/admin-user-service');
    const { getEffectiveEntityPermissions } = require('../../services/entity-effective-permissions-service');
    const entityService = require('../../services/entity-service');
    const { runSettlementReconcile } = require('../../jobs/settlement-reconcile-job');
    const { SETTLEMENT } = require('../../config/business-rules');
    /* eslint-enable global-require */

    const sfx = `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
    const ids = { orgs: [], users: [], entities: [], orders: [], applications: [] };
    /** @type {import('@prisma/client').PrismaClient} */
    let raw; // un-extended: seeds and reads back across tenants
    let orgA; let orgB; let orgC;
    let platformAdmin; let adminA; let lastAdminB; let adminC1; let adminC2;

    function providerId() {
        return `9${crypto.randomInt(10 ** 11, 10 ** 12 - 1)}`;
    }
    async function makeOrg(tag) {
        const o = await raw.organization.create({
            data: { name: `WTS ${tag} ${sfx}`, slug: `wts-${tag}-${sfx}`, code: `WTS${tag}${sfx}`.toUpperCase().slice(0, 24) },
        });
        ids.orgs.push(o.id);
        return o;
    }
    async function makeStaff(org, tag, role) {
        const u = await raw.user.create({
            data: {
                canonicalId: `wts-${tag}-${sfx}`,
                email: `wts-${tag}-${sfx}@example.test`,
                password: 'not-a-real-hash',
                firstName: 'WTS',
                lastName: tag,
                role,
                status: 'ACTIVE',
                authType: 'EMAIL_LEGACY',
                providerId: providerId(),
                organizationId: org.id,
            },
        });
        ids.users.push(u.id);
        return u;
    }

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        orgA = await makeOrg('A');
        orgB = await makeOrg('B');
        orgC = await makeOrg('C');
        platformAdmin = await makeStaff(orgA, 'platform', 'system_admin_platform');
        adminA = await makeStaff(orgA, 'adminA', 'system_admin_dtam');
        lastAdminB = await makeStaff(orgB, 'lastB', 'system_admin_dtam');
        adminC1 = await makeStaff(orgC, 'c1', 'system_admin_dtam');
        adminC2 = await makeStaff(orgC, 'c2', 'system_admin_dtam');
    });

    afterAll(async () => {
        if (!raw) { return; }
        await raw.checkoutOrder.deleteMany({ where: { id: { in: ids.orders } } }).catch(() => {});
        await raw.notification.deleteMany({ where: { userId: { in: ids.users } } }).catch(() => {});
        await raw.revisionDeadline.deleteMany({ where: { applicationId: { in: ids.applications } } }).catch(() => {});
        await raw.auditLog.deleteMany({ where: { resourceId: { in: ids.applications } } }).catch(() => {});
        await raw.application.deleteMany({ where: { id: { in: ids.applications } } }).catch(() => {});
        await raw.entityMemberPermissionGrant.deleteMany({ where: { organizationId: { in: ids.orgs } } }).catch(() => {});
        await raw.entityMembershipEvent.deleteMany({ where: { entityId: { in: ids.entities } } }).catch(() => {});
        await raw.entityMembership.deleteMany({ where: { entityId: { in: ids.entities } } }).catch(() => {});
        await raw.entity.deleteMany({ where: { id: { in: ids.entities } } }).catch(() => {});
        await raw.auditLog.deleteMany({ where: { organizationId: { in: ids.orgs } } }).catch(() => {});
        await raw.user.deleteMany({ where: { id: { in: ids.users } } }).catch(() => {});
        await raw.organization.deleteMany({ where: { id: { in: ids.orgs } } }).catch(() => {});
        await raw.$disconnect();
        const { prisma } = require('../../services/prisma-database'); // eslint-disable-line global-require
        await prisma.$disconnect().catch(() => {});
    });

    describe('S6 — last-admin guard, caller bound to org A, target in org B', () => {
        function app() {
            const a = express();
            a.use(express.json());
            a.use('/api/system/providers', require('../../routes/api/system/provider')); // eslint-disable-line global-require
            return a;
        }
        const asPlatformAdmin = (r) => r
            .set('x-test-role', 'system_admin_platform')
            .set('x-test-user-id', platformAdmin.id)
            .set('x-test-provider-id', platformAdmin.providerId)
            .set('x-test-organization-id', orgA.id);

        test('service: assertNotLastActiveAdmin refuses to remove org B\'s only admin', async () => {
            await expect(runWithTenantContext({ organizationId: orgA.id }, async () => (
                adminUserService.assertNotLastActiveAdmin({ existing: lastAdminB, organizationId: orgB.id })
            ))).rejects.toMatchObject({ code: 'ROLE_ADMIN_CANNOT_BE_LAST', status: 409 });
        });

        test('real door: PATCH disabling org B\'s only admin answers 409 and the row stays ACTIVE', async () => {
            const res = await asPlatformAdmin(request(app()).patch(`/api/system/providers/${lastAdminB.id}`))
                .send({ isActive: false });
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('ROLE_ADMIN_CANNOT_BE_LAST');
            const row = await raw.user.findUnique({ where: { id: lastAdminB.id }, select: { status: true } });
            expect(row.status).toBe('ACTIVE');
        });

        test('control: org C has two admins, so disabling one of them succeeds', async () => {
            const res = await asPlatformAdmin(request(app()).patch(`/api/system/providers/${adminC1.id}`))
                .send({ isActive: false });
            expect(res.status).toBe(200);
            const row = await raw.user.findUnique({ where: { id: adminC1.id }, select: { status: true } });
            expect(row.status).toBe('INACTIVE');
            // org A's own admin is untouched by any of this
            const a = await raw.user.findUnique({ where: { id: adminA.id }, select: { status: true } });
            expect(a.status).toBe('ACTIVE');
        });
    });

    describe('platform-admin provisioning — caller bound to org A creates a user in org B', () => {
        test('POST /api/platform-admin/organizations/:orgB/users answers 201 and the row lands in org B', async () => {
            const a = express();
            a.use(express.json());
            a.use('/api/platform-admin/organizations', require('../../routes/api/platform-admin/organizations')); // eslint-disable-line global-require
            const email = `wts-provisioned-${sfx}@example.test`;
            const res = await request(a).post(`/api/platform-admin/organizations/${orgB.id}/users`)
                .set('x-test-role', 'system_admin_platform')
                .set('x-test-user-id', platformAdmin.id)
                .set('x-test-provider-id', platformAdmin.providerId)
                .set('x-test-organization-id', orgA.id)
                .send({ email, firstName: 'WTS', lastName: 'Provisioned', providerId: providerId() });
            const row = await raw.user.findFirst({ where: { email }, select: { id: true, organizationId: true } });
            if (row) { ids.users.push(row.id); }
            expect(res.status).toBe(201);
            expect(row && row.organizationId).toBe(orgB.id);
        });
    });

    // Review M1 (pin): after the fix the tenant read filter no longer narrows the
    // directory lookups at provider.js:92 / :705 — only their explicit
    // organizationId filter keeps a TENANT admin inside its own org. Pin it.
    describe('M1 pin — a tenant admin of org A cannot reach org B\'s staff (provider.js :92 / :705)', () => {
        let staffB; let staffA;
        const asTenantAdminA = (r) => r
            .set('x-test-role', 'system_admin_dtam')
            .set('x-test-user-id', adminA.id)
            .set('x-test-provider-id', adminA.providerId)
            .set('x-test-organization-id', orgA.id);
        function app() {
            const a = express();
            a.use(express.json());
            a.use('/api/system/providers', require('../../routes/api/system/provider')); // eslint-disable-line global-require
            return a;
        }
        const lockedStaff = async (org, tag) => {
            const u = await raw.user.create({
                data: {
                    canonicalId: `wts-${tag}-${sfx}`, email: `wts-${tag}-${sfx}@example.test`,
                    password: 'not-a-real-hash', firstName: 'WTS', lastName: tag, role: 'dispatcher',
                    status: 'ACTIVE', accountType: 'PROVIDER', authType: 'EMAIL_LEGACY', providerId: providerId(),
                    isLocked: true, loginAttempts: 5, organizationId: org.id,
                },
            });
            ids.users.push(u.id);
            return u;
        };
        const snapshot = (id) => raw.user.findUnique({
            where: { id },
            select: { status: true, role: true, firstName: true, isLocked: true, loginAttempts: true, isDeleted: true, sessionsRevokedAt: true, updatedAt: true },
        });

        beforeAll(async () => {
            staffB = await lockedStaff(orgB, 'm1-staffB');
            staffA = await lockedStaff(orgA, 'm1-staffA');
        });

        test(':92 PATCH on org B\'s staff answers 404 and org B\'s row is unchanged', async () => {
            const before = await snapshot(staffB.id);
            const res = await asTenantAdminA(request(app()).patch(`/api/system/providers/${staffB.id}`))
                .send({ isActive: false, firstName: 'Changed' });
            expect(res.status).toBe(404);
            expect(await snapshot(staffB.id)).toEqual(before);
        });

        test(':92 DELETE on org B\'s staff answers 404 and org B\'s row is unchanged', async () => {
            const before = await snapshot(staffB.id);
            const res = await asTenantAdminA(request(app()).delete(`/api/system/providers/${staffB.id}`))
                .send({ reason: 'm1 pin cross-org delete' });
            expect(res.status).toBe(404);
            expect(await snapshot(staffB.id)).toEqual(before);
        });

        test(':705 unlock on org B\'s staff answers 404 and the account stays locked', async () => {
            const before = await snapshot(staffB.id);
            const res = await asTenantAdminA(request(app()).post(`/api/system/providers/${staffB.id}/unlock`));
            expect(res.status).toBe(404);
            const after = await snapshot(staffB.id);
            expect(after).toEqual(before);
            expect(after.isLocked).toBe(true);
        });

        test('control: the same admin unlocks a staff member of its own org A', async () => {
            const res = await asTenantAdminA(request(app()).post(`/api/system/providers/${staffA.id}/unlock`));
            expect(res.status).toBe(200);
            expect((await snapshot(staffA.id)).isLocked).toBe(false);
        });
    });

    // Review M2 (pin): the PLATFORM_ADMIN_ONLY door refuses a tenant admin with
    // the REAL requireRole (role-middleware), and nothing is written.
    describe('M2 pin — organizations POST /:id/users refuses a non-platform admin', () => {
        test('tenant admin of org A → 403 AUTHORIZATION_ERROR, no user created in org B', async () => {
            const a = express();
            a.use(express.json());
            a.use('/api/platform-admin/organizations', require('../../routes/api/platform-admin/organizations')); // eslint-disable-line global-require
            // Same mapping as the global error handler in server.js (err.statusCode, err.code).
            a.use((err, _req, res, _next) => res.status(Number.isInteger(err?.statusCode) ? err.statusCode : 500)
                .json({ success: false, code: err.code || 'INTERNAL_SERVER_ERROR' }));
            const email = `wts-m2-refused-${sfx}@example.test`;
            const res = await request(a).post(`/api/platform-admin/organizations/${orgB.id}/users`)
                .set('x-test-role', 'system_admin_dtam')
                .set('x-test-user-id', adminA.id)
                .set('x-test-provider-id', adminA.providerId)
                .set('x-test-organization-id', orgA.id)
                .send({ email, firstName: 'WTS', lastName: 'Refused', providerId: providerId() });
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('AUTHORIZATION_ERROR');
            expect(await raw.user.count({ where: { email } })).toBe(0);
        });
    });

    describe('S7 — a REVOKE stored under org B, caller bound to org A', () => {
        let entity; let worker; let membership; let revoked;

        beforeAll(async () => {
            entity = await raw.entity.create({
                data: { type: 'JURISTIC', displayName: `WTS CO ${sfx}`, organizationId: orgB.id, status: 'ACTIVE' },
            });
            ids.entities.push(entity.id);
            worker = await raw.user.create({
                data: {
                    canonicalId: `wts-worker-${sfx}`,
                    email: `wts-worker-${sfx}@example.test`, password: 'not-a-real-hash',
                    role: 'health', status: 'ACTIVE', authType: 'EMAIL_LEGACY', organizationId: orgB.id,
                },
            });
            ids.users.push(worker.id);
            membership = await raw.entityMembership.create({
                data: { userId: worker.id, entityId: entity.id, role: 'MANAGER', status: 'ACTIVE', organizationId: orgB.id },
            });
            // revoke a permission MANAGER holds by default
            [revoked] = entityService.DEFAULT_PERMISSIONS_BY_ROLE.MANAGER;
            await raw.entityMemberPermissionGrant.create({
                data: { membershipId: membership.id, permission: revoked, effect: 'REVOKE', organizationId: orgB.id },
            });
        });

        test('the fixture really is a default MANAGER permission', () => {
            expect(typeof revoked).toBe('string');
        });

        test('effective permissions honour the REVOKE', async () => {
            const result = await runWithTenantContext({ organizationId: orgA.id }, async () => (
                getEffectiveEntityPermissions({ membershipId: membership.id })
            ));
            expect(result.grants).toEqual([{ permission: revoked, effect: 'REVOKE' }]);
            expect(result.effective).not.toContain(revoked);
        });

        test('revoking the member removes its grant rows (no resurrect on re-invite)', async () => {
            await runWithTenantContext({ organizationId: orgA.id }, async () => (
                entityService.revokeMember({ entityId: entity.id, userId: worker.id, actorUserId: platformAdmin.id })
            ));
            const left = await raw.entityMemberPermissionGrant.count({ where: { membershipId: membership.id } });
            expect(left).toBe(0);
            const m = await raw.entityMembership.findUnique({ where: { id: membership.id }, select: { status: true } });
            expect(m.status).toBe('REVOKED');
        });
    });

    // revision-deadline-checker.js re-enters the deadline's tenant, then looks
    // the dispatchers/DTAM admins up inside withoutTenantScope WITHOUT an org
    // filter. Before the fix that lookup ran lazily under the deadline's org,
    // so the fan-out stayed in that org. Fixing withoutTenantScope alone would
    // have widened it to every tenant's staff (another org's application
    // number + applicant name). The site now filters by the deadline's org.
    describe('revision-deadline fan-out stays in the deadline\'s org', () => {
        test('an expired deadline in org B notifies org B\'s dispatcher and not org C\'s', async () => {
            // eslint-disable-next-line global-require
            const { checkExpiredDeadlines } = require('../../jobs/revision-deadline-checker');
            const mk = async (org, tag) => {
                const u = await raw.user.create({
                    data: {
                        canonicalId: `wts-${tag}-${sfx}`, email: `wts-${tag}-${sfx}@example.test`,
                        password: 'not-a-real-hash', role: 'dispatcher', status: 'ACTIVE',
                        accountType: 'PROVIDER', authType: 'EMAIL_LEGACY', providerId: providerId(),
                        organizationId: org.id,
                    },
                });
                ids.users.push(u.id);
                return u;
            };
            const dispatcherB = await mk(orgB, 'dispB');
            const dispatcherC = await mk(orgC, 'dispC');
            const farmer = await raw.user.create({
                data: {
                    canonicalId: `wts-farmer-rd-${sfx}`, email: `wts-farmer-rd-${sfx}@example.test`,
                    password: 'not-a-real-hash', role: 'health', status: 'ACTIVE', authType: 'EMAIL_LEGACY',
                    organizationId: orgB.id,
                },
            });
            ids.users.push(farmer.id);
            const application = await raw.application.create({
                data: {
                    applicationNumber: `WTS-RD-${sfx}`, healthId: farmer.canonicalId, areaType: 'OUTDOOR',
                    organizationId: orgB.id, status: 'REVISION_REQUESTED', formData: {},
                },
            });
            ids.applications.push(application.id);
            await raw.revisionDeadline.create({
                data: {
                    applicationId: application.id, organizationId: orgB.id,
                    revisionDue: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                    status: 'PENDING', createdBy: 'system', updatedBy: 'system',
                },
            });

            await checkExpiredDeadlines();

            const expired = await raw.application.findUnique({ where: { id: application.id }, select: { status: true } });
            expect(expired.status).toBe('EXPIRED');
            const got = async (u) => raw.notification.count({
                where: { userId: u.id, type: 'REVISION_DEADLINE_EXPIRED' },
            });
            expect(await got(dispatcherB)).toBe(1);
            expect(await got(dispatcherC)).toBe(0);
        });
    });

    describe('money path — settlement-reconcile runs with no tenant (behaviour unchanged)', () => {
        test('stale PENDING_PAYMENT orders from every org reach the gateway question', async () => {
            const now = new Date();
            const stale = new Date(now.getTime() - SETTLEMENT.RECONCILE_STALE_MS - 60 * 1000);
            const zero = '0';
            const pis = [];
            for (const org of [orgA, orgB]) {
                const pi = `pi_wts_${org.id.slice(0, 8)}_${sfx}`;
                const farmer = await raw.user.create({
                    data: {
                        canonicalId: `wts-farmer-${org.id.slice(0, 8)}-${sfx}`,
                        email: `wts-farmer-${org.id.slice(0, 8)}-${sfx}@example.test`, password: 'not-a-real-hash',
                        role: 'health', status: 'ACTIVE', authType: 'EMAIL_LEGACY', organizationId: org.id,
                    },
                });
                ids.users.push(farmer.id);
                const application = await raw.application.create({
                    data: {
                        applicationNumber: `WTS-${org.id.slice(0, 8)}-${sfx}`,
                        healthId: farmer.canonicalId, areaType: 'OUTDOOR',
                        organizationId: org.id, status: 'DRAFT', formData: {},
                    },
                });
                ids.applications.push(application.id);
                const o = await raw.checkoutOrder.create({
                    data: {
                        applicationId: application.id,
                        milestone: 'M1',
                        platformFeeNet: zero, platformFeeVat: zero,
                        platformFeeGross: zero, totalPayableAmount: zero,
                        status: 'PENDING_PAYMENT', stripePaymentIntentId: pi,
                        organizationId: org.id, createdAt: stale,
                    },
                });
                ids.orders.push(o.id);
                pis.push(pi);
            }
            mockAskedIntents.length = 0;
            const summary = await runSettlementReconcile(now);
            expect(mockAskedIntents).toEqual(expect.arrayContaining(pis));
            expect(summary.reDrivenOrders).toBe(0);
            const rows = await raw.checkoutOrder.findMany({ where: { id: { in: ids.orders } }, select: { status: true } });
            expect(rows.map((r) => r.status)).toEqual(['PENDING_PAYMENT', 'PENDING_PAYMENT']);
        });
    });
});
