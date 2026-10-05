'use strict';

/**
 * The read witness on a real Postgres, through the real prisma-database client
 * (plot-code → tenant-inject → soft-delete → PDPA, the chain production runs),
 * with the real tenant-context middleware building the request context.
 *
 * Prisma 5.22 hands every query-extension hook a deep clone of the caller's args
 * (runtime `_a(t.args)`), so the symbol marker never reaches the hook. The
 * witness therefore checks by value: holderReadWhere / farmAccessWhere register
 * a canonical form of each fragment in the request's tenant context, and a
 * health read of a watched model is scoped only when its where (top level, a
 * top-level AND member, or every OR branch) holds a sub-object equal to a
 * fragment registered for that model in THIS request.
 *
 * Every query is AWAITED inside the contexts: a PrismaPromise is lazy, and one
 * returned unawaited runs after the contexts have exited.
 *
 *   (a) registered Application fragment → scoped, shadow and throw; the
 *       fragment's entityId reaches SQL unchanged (R2 Task 12 removed the entity
 *       ALS that used to rewrite it);
 *   (b) the same read with entityId overridden → unscoped, counted, throws;
 *   (c) a fragment registered in request 1 (user A, [X]), reused in request 2
 *       (user B, which registered its own [W]) → unscoped;
 *   (d) Invoice relation fragment → scoped; with an Invoice fragment for [X]
 *       registered in the same request, a hand-written in:[W] or in:[X,W] is
 *       unscoped (a value-equal hand-written in:[X] is scoped, by design);
 *   (e) an OR with one unregistered branch → unscoped;
 *   (f) a non-health principal is never counted;
 *   (M2) two requests (users A and B, different entities) interleaved with
 *       Promise.all each see only their own registration.
 */

const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');
const { prisma } = require('../../services/prisma-database');
const { tenantContextMiddleware } = require('../../middleware/tenant-context-middleware');
const { holderScope, holderReadWhere } = require('../../services/holder-access');
const { farmAccessWhere } = require('../../services/farm-access');
const { register } = require('../../shared/prometheus');
const sharedLogger = require('../../shared/logger');
const witnessConfig = require('../../config/holder-read-witness');

/** Set the mode and drop the cached read (the witness reads HOLDER_READ_WITNESS once). */
function setMode(mode) {
    if (mode === undefined) { delete process.env.HOLDER_READ_WITNESS; }
    else { process.env.HOLDER_READ_WITNESS = mode; }
    witnessConfig.resetHolderReadWitnessModeCache();
}

d('read witness by value (real Postgres, full prisma-database chain)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    const suffix = crypto.randomUUID().slice(0, 8);
    const fx = { entities: [], apps: [] };
    const ORIGINAL_MODE = process.env.HOLDER_READ_WITNESS;

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        const org = await raw.organization.create({
            data: { name: `hw-${suffix}`, slug: `hw-${suffix}`, code: `HW_${suffix}`.toUpperCase() },
        });
        fx.orgId = org.id;
        fx.userId = crypto.randomUUID();
        await raw.user.create({
            data: {
                id: fx.userId, canonicalId: `hw-${suffix}`, password: 'x', role: 'health', authType: 'EMAIL_LEGACY',
                email: `hw-${suffix}@example.test`, firstName: 'ทดสอบ', lastName: 'witness', organizationId: fx.orgId,
            },
        });
        const entity = async (label) => {
            const row = await raw.entity.create({
                data: { type: 'JURISTIC', displayName: `บริษัท ${label} จำกัด`, organizationId: fx.orgId },
            });
            fx.entities.push(row.id);
            return row.id;
        };
        fx.X = await entity('member');
        fx.W = await entity('stranger');
        await raw.entityMembership.create({
            data: { userId: fx.userId, entityId: fx.X, role: 'OWNER', status: 'ACTIVE', organizationId: fx.orgId },
        });
        // User B holds W only (M2 interleaving, (c) value comparison).
        fx.userB = crypto.randomUUID();
        await raw.user.create({
            data: {
                id: fx.userB, canonicalId: `hw-b-${suffix}`, password: 'x', role: 'health', authType: 'EMAIL_LEGACY',
                email: `hw-b-${suffix}@example.test`, firstName: 'ทดสอบ', lastName: 'witness-b', organizationId: fx.orgId,
            },
        });
        await raw.entityMembership.create({
            data: { userId: fx.userB, entityId: fx.W, role: 'OWNER', status: 'ACTIVE', organizationId: fx.orgId },
        });
        const app = async (entityId, n) => {
            const row = await raw.application.create({
                data: {
                    applicationNumber: `APP-HW-${suffix}-${n}`, healthId: `hw-${suffix}`, areaType: 'OUTDOOR',
                    organizationId: fx.orgId, entityId, status: 'DRAFT',
                },
            });
            fx.apps.push(row.id);
            return row.id;
        };
        fx.appX = await app(fx.X, 1);
        fx.appW = await app(fx.W, 2);
    });

    afterAll(async () => {
        setMode(ORIGINAL_MODE);
        if (!raw) { return; }
        await raw.application.deleteMany({ where: { id: { in: fx.apps } } }).catch(() => {});
        await raw.entityMembership.deleteMany({ where: { entityId: { in: fx.entities } } }).catch(() => {});
        await raw.entity.deleteMany({ where: { id: { in: fx.entities } } }).catch(() => {});
        const users = [fx.userId, fx.userB].filter(Boolean);
        if (users.length) { await raw.user.deleteMany({ where: { id: { in: users } } }).catch(() => {}); }
        if (fx.orgId) { await raw.organization.deleteMany({ where: { id: fx.orgId } }).catch(() => {}); }
        await raw.$disconnect();
    });

    let warn;
    beforeEach(() => {
        setMode(undefined);
        warn = jest.spyOn(sharedLogger, 'warn').mockImplementation(() => {});
    });
    afterEach(() => { jest.restoreAllMocks(); });

    const witnessLogs = () => warn.mock.calls.map((c) => c[1]).filter((m) => m && m.signal === 'HEALTH_READ_UNSCOPED');

    async function counter(model, op) {
        const metric = register.getSingleMetric('health_read_unscoped_total');
        if (!metric) { return 0; }
        const hit = (await metric.get()).values.find((v) => v.labels.model === model && v.labels.op === op);
        return hit ? hit.value : 0;
    }

    /**
     * One request through the real tenant-context middleware, `fn` awaited inside
     * the context. Rethrows what `fn` threw.
     */
    async function asRequest(fn, { canonicalRole = 'health', userId = fx.userId } = {}) {
        const req = {
            method: 'GET',
            baseUrl: '/api/applications',
            path: `/${fx.appX}`,
            user: { id: userId, organizationId: fx.orgId, canonicalRole },
        };
        let out;
        let failure = null;
        await tenantContextMiddleware()(req, { status: () => ({ json: () => {} }) }, async () => {
            try {
                out = await fn(req);
            } catch (error) { failure = error; }
        });
        if (failure) { throw failure; }
        return out;
    }

    describe.each(['shadow', 'throw'])('(a) mode %s: a registered Application fragment is scoped', (mode) => {
        test('findMany / findUniqueOrThrow / findFirstOrThrow / count run, nothing counted or logged', async () => {
            setMode(mode);
            const before = await counter('Application', 'findMany');
            const result = await asRequest(async (req) => {
                const scope = await holderScope(req);
                const frag = holderReadWhere(scope, 'Application');
                return {
                    rows: await prisma.application.findMany({ where: { ...frag, status: 'DRAFT' }, select: { id: true } }),
                    byId: await prisma.application.findUniqueOrThrow({ where: { id: fx.appX, ...frag }, select: { id: true } }),
                    first: await prisma.application.findFirstOrThrow({ where: { AND: [frag, { status: 'DRAFT' }] }, select: { id: true } }),
                    n: await prisma.application.count({ where: frag }),
                };
            });
            expect(result.rows).toEqual([{ id: fx.appX }]);
            expect(result.byId).toEqual({ id: fx.appX });
            expect(result.first).toEqual({ id: fx.appX });
            expect(result.n).toBe(1);
            expect(await counter('Application', 'findMany')).toBe(before);
            expect(witnessLogs()).toEqual([]);
        });

        test('nothing rewrites the fragment any more (R2 Task 12): the fragment alone selects the X row, no witness hit', async () => {
            setMode(mode);
            const rows = await asRequest(async (req) => {
                const frag = holderReadWhere(await holderScope(req), 'Application');
                return prisma.application.findMany({ where: frag, select: { id: true } });
            });
            // Pre-R2 a bound entity W overwrote entityId after the witness (W row back).
            expect(rows).toEqual([{ id: fx.appX }]);
            expect(witnessLogs()).toEqual([]);
        });

        test('a registered Farm fragment (holderReadWhere and farmAccessWhere) is scoped', async () => {
            setMode(mode);
            const counts = await asRequest(async (req) => {
                const scope = await holderScope(req);
                return [
                    await prisma.farm.count({ where: { ...holderReadWhere(scope, 'Farm'), isDeleted: false } }),
                    await prisma.farm.count({ where: { ...(await farmAccessWhere(fx.userId)), isDeleted: false } }),
                ];
            });
            expect(counts).toEqual([0, 0]);
            expect(witnessLogs()).toEqual([]);
        });
    });

    describe('(b) entityId overridden after the spread', () => {
        const overridden = async (req) => {
            const frag = holderReadWhere(await holderScope(req), 'Application');
            return prisma.application.findMany({ where: { ...frag, entityId: fx.W }, select: { id: true } });
        };

        test('shadow: the read runs, counted +1, logged with model/op/route/principal', async () => {
            setMode('shadow');
            const before = await counter('Application', 'findMany');
            const rows = await asRequest(overridden);
            expect(rows).toEqual([{ id: fx.appW }]);
            expect(await counter('Application', 'findMany')).toBe(before + 1);
            expect(witnessLogs()).toEqual([expect.objectContaining({
                signal: 'HEALTH_READ_UNSCOPED', model: 'Application', op: 'findMany',
                route: `GET /api/applications/${fx.appX}`, principal: 'health',
            })]);
        });

        test('throw: rejects HEALTH_READ_UNSCOPED', async () => {
            setMode('throw');
            await expect(asRequest(overridden)).rejects.toMatchObject({ code: 'HEALTH_READ_UNSCOPED' });
        });

        test('throw: a deleted key (fragment keys dropped) rejects too', async () => {
            setMode('throw');
            await expect(asRequest(async (req) => {
                const { entityId: _dropped, ...rest } = { ...holderReadWhere(await holderScope(req), 'Application'), status: 'DRAFT' };
                return prisma.application.findMany({ where: rest });
            })).rejects.toMatchObject({ code: 'HEALTH_READ_UNSCOPED' });
        });
    });

    test('(c) a fragment registered in request 1 (A, [X]) is unscoped in request 2 (B, registered [W])', async () => {
        const fragA = await asRequest(async (req) => holderReadWhere(await holderScope(req), 'Application'));
        setMode('shadow');
        const before = await counter('Application', 'count');
        const shadow = await asRequest(async (req) => {
            const fragB = holderReadWhere(await holderScope(req), 'Application');
            return {
                own: await prisma.application.count({ where: fragB }),
                reused: await prisma.application.count({ where: fragA }),
            };
        }, { userId: fx.userB });
        // Both reads run in shadow (entity W bound rewrites both to W); only the reuse is counted.
        expect(shadow).toEqual({ own: 1, reused: 1 });
        expect(await counter('Application', 'count')).toBe(before + 1);
        setMode('throw');
        await expect(asRequest(async (req) => {
            holderReadWhere(await holderScope(req), 'Application');
            return prisma.application.count({ where: fragA });
        }, { userId: fx.userB })).rejects.toMatchObject({ code: 'HEALTH_READ_UNSCOPED' });
    });

    describe('(d) Invoice relation fragment', () => {
        beforeEach(() => { setMode('throw'); });

        test('a registered application.entityId fragment is scoped', async () => {
            await expect(asRequest(async (req) => prisma.invoice.count({
                where: { ...holderReadWhere(await holderScope(req), 'Invoice'), status: 'PAID' },
            }))).resolves.toBe(0);
        });

        test('a hand-written { application: { entityId: { in } } } never registered is unscoped', async () => {
            await expect(asRequest(() => prisma.invoice.count({
                where: { application: { entityId: { in: [fx.X] } } },
            }))).rejects.toMatchObject({ code: 'HEALTH_READ_UNSCOPED' });
        });

        test.each([['[W]', () => [fx.W]], ['[X,W]', () => [fx.X, fx.W]]])(
            'with an Invoice fragment for [X] registered in the same request, hand-written in:%s is unscoped',
            async (_label, ids) => {
                await expect(asRequest(async (req) => {
                    const frag = holderReadWhere(await holderScope(req), 'Invoice');
                    expect(frag.application.entityId.in).toEqual([fx.X]);
                    return prisma.invoice.count({ where: { application: { entityId: { in: ids() } } } });
                })).rejects.toMatchObject({ code: 'HEALTH_READ_UNSCOPED' });
            },
        );

        test('with the [X] fragment registered, a value-equal hand-written in:[X] is scoped (by design)', async () => {
            await expect(asRequest(async (req) => {
                holderReadWhere(await holderScope(req), 'Invoice');
                return prisma.invoice.count({ where: { application: { entityId: { in: [fx.X] } } } });
            })).resolves.toBe(0);
        });
    });

    describe('(e) OR', () => {
        beforeEach(() => { setMode('throw'); });

        test('one unregistered branch → unscoped', async () => {
            await expect(asRequest(async (req) => {
                const frag = holderReadWhere(await holderScope(req), 'Application');
                return prisma.application.findMany({ where: { OR: [frag, { entityId: fx.W }] } });
            })).rejects.toMatchObject({ code: 'HEALTH_READ_UNSCOPED' });
        });

        test('every branch registered → scoped', async () => {
            const rows = await asRequest(async (req) => {
                const frag = holderReadWhere(await holderScope(req), 'Application');
                return prisma.application.findMany({
                    where: { OR: [{ ...frag, status: 'DRAFT' }, { ...frag, status: 'SUBMITTED' }] }, select: { id: true },
                });
            });
            expect(rows).toEqual([{ id: fx.appX }]);
        });
    });

    test.each(['shadow', 'throw'])('(f) mode %s: a non-health principal is never counted', async (mode) => {
        setMode(mode);
        const before = await counter('Application', 'findMany');
        const rows = await asRequest(
            () => prisma.application.findMany({ where: { id: { in: fx.apps } }, select: { id: true }, orderBy: { applicationNumber: 'asc' } }),
            { canonicalRole: 'document_reviewer' },
        );
        // R2 Task 12: no entity context narrows a staff read any more (spec §3.1 (b)).
        expect(rows.map((r) => r.id).sort()).toEqual([fx.appX, fx.appW].sort());
        expect(await counter('Application', 'findMany')).toBe(before);
        expect(witnessLogs()).toEqual([]);
    });

    test('(M2) two interleaved requests (users A and B) each see only their own registration', async () => {
        setMode('throw');
        const frags = {};
        let release;
        const bothRegistered = new Promise((resolve) => { release = resolve; });
        let arrived = 0;
        const arrive = () => {
            arrived += 1;
            if (arrived === 2) { release(); }
            return bothRegistered;
        };
        const run = (who, other, userId, entityId) => asRequest(async (req) => {
            frags[who] = holderReadWhere(await holderScope(req), 'Application');
            await arrive(); // both requests have registered before either reads
            const own = await prisma.application.findMany({ where: frags[who], select: { id: true } });
            let foreign = null;
            try { await prisma.application.findMany({ where: frags[other], select: { id: true } }); }
            catch (error) { foreign = error.code; }
            return { own: own.map((r) => r.id), foreign };
        }, { userId, entityId });
        const [a, b] = await Promise.all([
            run('A', 'B', fx.userId, fx.X),
            run('B', 'A', fx.userB, fx.W),
        ]);
        expect(frags.A.entityId.in).toEqual([fx.X]);
        expect(frags.B.entityId.in).toEqual([fx.W]);
        expect(a).toEqual({ own: [fx.appX], foreign: 'HEALTH_READ_UNSCOPED' });
        expect(b).toEqual({ own: [fx.appW], foreign: 'HEALTH_READ_UNSCOPED' });
    });
});
