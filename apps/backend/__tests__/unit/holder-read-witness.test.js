'use strict';

/**
 * The read witness (spec 2026-09-30-remove-workspace-mode §3.1 guard, plan Task 2).
 *
 * On a health request, a read of a watched (holder-bearing) model whose `where`
 * holds no holder fragment registered (by value) in this request counts
 * health_read_unscoped_total{model,op} and logs signal HEALTH_READ_UNSCOPED with
 * model, op, route and principal. Mode comes from HOLDER_READ_WITNESS
 * ('off' | 'shadow' (default) | 'throw'), read once and cached.
 *
 * These unit tests call the REAL tenantInjectExtension hooks directly, under the
 * REAL tenant AsyncLocalStorage, with the original args. They pin the
 * logic only: Prisma 5.22 clones args before its hooks, and the proof that the
 * witness works on those clones is holder-read-witness-real-postgres.test.js.
 * Pinned here:
 *   - every read op the extension hooks is witnessed (8 ops);
 *   - throw mode rejects with code HEALTH_READ_UNSCOPED before the query runs;
 *   - a registered fragment, a staff principal, no tenant context,
 *     withoutTenantScope, an unwatched model and mode 'off' are all silent;
 *   - the witness reads the where before applyReadScopes (R2 Task 12: nothing
 *     rewrites entityId any more; the fragment reaches the query as built);
 *   - canonical form: `in` order ignored, override/deletion/foreign id not;
 *     BigInt handled;
 *   - a fragment built outside the request (or in another) is not registered;
 *   - a check that throws never breaks a read in shadow/off, fails closed in throw;
 *   - a throwing logger never breaks the read in shadow mode;
 *   - off mode is near-free: the mode is read once, an unwatched model never
 *     reads it, and nothing registers when the mode is off or the principal is
 *     not health;
 *   - the tenant-context middleware sets principal 'health' only for
 *     canonicalRole 'health', and a non-enumerable route string snapshot;
 *   - holder fragments are deep-frozen, so a vouched value cannot be widened in
 *     place (Task 1 reviewer carry-forward).
 */

jest.mock('../../services/prisma-database', () => ({
    prisma: { entityMembership: { findMany: jest.fn(), findFirst: jest.fn() } },
}));

const mockWarn = jest.fn();
jest.mock('../../shared/logger', () => {
    const noop = () => {};
    const warn = (...a) => mockWarn(...a);
    return {
        debug: noop, info: noop, warn, error: noop,
        createLogger: () => ({ debug: noop, info: noop, warn, error: noop }),
    };
});

const { runWithTenantContext, withoutTenantScope, getTenantContext } = require('../../services/tenant-context');
const { tenantInjectExtension } = require('../../services/tenant-prisma-extension');
const { holderReadWhere } = require('../../services/holder-access');
const { buildFarmAccessWhere } = require('../../services/farm-access');
const { checkHolderScoped } = require('../../services/holder-read-witness');
const { canonicalHolderForm, isRegisteredHolderScoped } = require('../../services/holder-fragment-registry');
const witnessConfig = require('../../config/holder-read-witness');

const { holderReadWitnessMode } = witnessConfig;
/** Set the mode and drop the cached read (the witness reads HOLDER_READ_WITNESS once). */
function setMode(mode) {
    if (mode === undefined) { delete process.env.HOLDER_READ_WITNESS; }
    else { process.env.HOLDER_READ_WITNESS = mode; }
    witnessConfig.resetHolderReadWitnessModeCache?.();
}
const { tenantContextMiddleware } = require('../../middleware/tenant-context-middleware');
const { register } = require('../../shared/prometheus');

const hooks = tenantInjectExtension.query.$allModels;
const OPS = [
    'findMany', 'findFirst', 'findUnique', 'findFirstOrThrow', 'findUniqueOrThrow',
    'count', 'aggregate', 'groupBy',
];
// A fresh context object per call: the registry lives on the context object.
const health = (fn) => runWithTenantContext({ organizationId: 'org-A', principal: 'health' }, fn);
const staff = (fn) => runWithTenantContext({ organizationId: 'org-A', principal: 'staff' }, fn);
const SCOPE = { userId: 'u-1', readIds: ['E1', 'E2'], editIds: ['E1'] };

function capture() {
    const calls = [];
    return { calls, query: (args) => { calls.push(args); return Promise.resolve('rows'); } };
}

async function counterValue(model, op) {
    const metric = register.getSingleMetric('health_read_unscoped_total');
    if (!metric) { return 0; }
    const { values } = await metric.get();
    const hit = values.find((v) => v.labels.model === model && v.labels.op === op);
    return hit ? hit.value : 0;
}

const witnessLogs = () => mockWarn.mock.calls
    .map((c) => c[1])
    .filter((meta) => meta && meta.signal === 'HEALTH_READ_UNSCOPED');

const ORIGINAL_MODE = process.env.HOLDER_READ_WITNESS;
beforeEach(() => {
    mockWarn.mockReset();
    setMode(undefined);
});
afterAll(() => { setMode(ORIGINAL_MODE); });

describe('holderReadWitnessMode', () => {
    test("defaults to 'throw' under NODE_ENV=test (Task 6; 'shadow' elsewhere — see the throw-guard suite)", () => {
        expect(process.env.NODE_ENV).toBe('test');
        expect(holderReadWitnessMode()).toBe('throw');
    });
    test.each(['off', 'shadow', 'throw'])("reads '%s' from HOLDER_READ_WITNESS", (mode) => {
        setMode(mode);
        expect(holderReadWitnessMode()).toBe(mode);
    });
    test("an unknown value falls back to the default, 'throw' under NODE_ENV=test (never silently off)", () => {
        setMode('loud');
        expect(holderReadWitnessMode()).toBe('throw');
    });
});

describe('health + watched model + no marker (shadow)', () => {
    beforeEach(() => { setMode('shadow'); });
    test.each(OPS)('%s → counter +1 {model,op}, warn log with signal, route and principal, read proceeds', async (op) => {
        expect(typeof hooks[op]).toBe('function');
        const before = await counterValue('Application', op);
        const { calls, query } = capture();
        const result = await health(() => hooks[op]({
            model: 'Application', args: { where: { status: 'DRAFT' } }, query,
        }));
        expect(result).toBe('rows');
        expect(calls).toHaveLength(1);
        expect(await counterValue('Application', op)).toBe(before + 1);
        const logs = witnessLogs();
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({
            signal: 'HEALTH_READ_UNSCOPED', model: 'Application', op, principal: 'health', route: null,
        });
    });

    test('a spread-then-override where is unscoped (value-bound marker)', async () => {
        const before = await counterValue('Application', 'findMany');
        const { query } = capture();
        await health(() => hooks.findMany({
            model: 'Application',
            args: { where: { ...holderReadWhere(SCOPE, 'Application'), entityId: 'victim' } },
            query,
        }));
        expect(await counterValue('Application', 'findMany')).toBe(before + 1);
    });
});

describe('throw mode', () => {
    beforeEach(() => { setMode('throw'); });

    test.each(OPS)('%s rejects with HEALTH_READ_UNSCOPED before the query runs', async (op) => {
        const { calls, query } = capture();
        await expect(health(() => hooks[op]({
            model: 'Invoice', args: { where: { status: 'PAID' } }, query,
        }))).rejects.toMatchObject({ code: 'HEALTH_READ_UNSCOPED' });
        expect(calls).toHaveLength(0);
    });

    test('checkHolderScoped throws synchronously with the model and op', () => {
        let caught;
        health(() => {
            try { checkHolderScoped('Certificate', 'findUnique', { where: { id: 'c-1' } }); } catch (e) { caught = e; }
        });
        expect(caught).toBeInstanceOf(Error);
        expect(caught.code).toBe('HEALTH_READ_UNSCOPED');
        expect(caught.message).toMatch(/Certificate\.findUnique/);
    });

    test('args with no where at all is unscoped', () => {
        expect(() => health(() => checkHolderScoped('Application', 'count', undefined)))
            .toThrow(expect.objectContaining({ code: 'HEALTH_READ_UNSCOPED' }));
    });
});

describe('silent cases', () => {
    // `buildArgs` runs INSIDE the context, where holderReadWhere registers.
    async function expectSilent(ctxRun, model, buildArgs, op = 'findMany') {
        const before = await counterValue(model, op);
        const { calls, query } = capture();
        await ctxRun(() => hooks[op]({ model, args: buildArgs(), query }));
        expect(calls).toHaveLength(1);
        expect(await counterValue(model, op)).toBe(before);
        expect(witnessLogs()).toHaveLength(0);
    }

    describe.each(['shadow', 'throw'])('mode %s', (mode) => {
        beforeEach(() => { setMode(mode); });

        test.each(OPS)('registered fragment → nothing (%s)', async (op) => {
            await expectSilent(health, 'Application',
                () => ({ where: { ...holderReadWhere(SCOPE, 'Application'), status: 'DRAFT' } }), op);
        });

        test('registered fragment inside AND → nothing', async () => {
            await expectSilent(health, 'Invoice',
                () => ({ where: { AND: [holderReadWhere(SCOPE, 'Invoice'), { status: 'PAID' }] } }));
        });

        test('registered Farm fragment → nothing', async () => {
            await expectSilent(health, 'Farm', () => ({ where: { ...holderReadWhere(SCOPE, 'Farm'), isDeleted: false } }));
        });

        test('a deep copy of a registered where, symbol dropped (what Prisma hands the hook) → nothing', async () => {
            await expectSilent(health, 'Application',
                () => ({ where: JSON.parse(JSON.stringify({ ...holderReadWhere(SCOPE, 'Application'), status: 'DRAFT' })) }));
        });

        test('staff principal → nothing', async () => {
            await expectSilent(staff, 'Application', () => ({ where: { status: 'DRAFT' } }));
        });

        test('a tenant context with no principal (jobs re-entering a tenant) → nothing', async () => {
            await expectSilent((fn) => runWithTenantContext({ organizationId: 'org-A' }, fn),
                'Application', () => ({ where: { status: 'DRAFT' } }));
        });

        test('no tenant context (cron/scripts) → nothing', async () => {
            await expectSilent((fn) => fn(), 'Application', () => ({ where: { status: 'DRAFT' } }));
        });

        test('withoutTenantScope inside a health request → nothing', async () => {
            await expectSilent((fn) => health(() => withoutTenantScope(fn)),
                'Application', () => ({ where: { status: 'DRAFT' } }));
        });

        test('unwatched model (User) → nothing', async () => {
            await expectSilent(health, 'User', () => ({ where: { id: 'u-1' } }));
        });
    });

    test("mode 'off' → nothing, even unmarked", async () => {
        setMode('off');
        await expectSilent(health, 'Application', () => ({ where: { status: 'DRAFT' } }));
    });
});

describe('value registration', () => {
    beforeEach(() => { setMode('throw'); });
    const unscoped = expect.objectContaining({ code: 'HEALTH_READ_UNSCOPED' });

    test('canonical form ignores key order and `in` order, nothing else', () => {
        expect(canonicalHolderForm({ b: 1, a: { in: ['y', 'x'] } }))
            .toBe(canonicalHolderForm({ a: { in: ['x', 'y'] }, b: 1 }));
        expect(canonicalHolderForm({ OR: [{ a: 1 }, { b: 2 }] }))
            .not.toBe(canonicalHolderForm({ OR: [{ b: 2 }, { a: 1 }] }));
        expect(canonicalHolderForm({ a: { in: ['x'] } })).not.toBe(canonicalHolderForm({ a: { in: ['x', 'y'] } }));
    });

    test('a fragment built outside any request is not registered', () => {
        const where = holderReadWhere(SCOPE, 'Application');
        expect(() => health(() => checkHolderScoped('Application', 'findMany', { where }))).toThrow(unscoped);
    });

    test('a fragment built in request 1 is not registered in request 2', () => {
        const where = health(() => holderReadWhere(SCOPE, 'Application'));
        expect(() => health(() => checkHolderScoped('Application', 'findMany', { where }))).toThrow(unscoped);
    });

    test('a fragment registered for Application does not scope an Invoice read', () => {
        expect(() => health(() => {
            const app = holderReadWhere(SCOPE, 'Application');
            checkHolderScoped('Invoice', 'findMany', { where: { application: { entityId: app.entityId } } });
        })).toThrow(unscoped);
    });

    test('a foreign id added to a copied `in` breaks equality', () => {
        expect(() => health(() => {
            const frag = holderReadWhere(SCOPE, 'Application');
            checkHolderScoped('Application', 'findMany', { where: { entityId: { in: [...frag.entityId.in, 'E9'] } } });
        })).toThrow(unscoped);
    });

    test('the same ids in another order still match (Prisma may not, but canonical form sorts `in`)', () => {
        expect(() => health(() => {
            holderReadWhere(SCOPE, 'Application');
            checkHolderScoped('Application', 'findMany', { where: { entityId: { in: ['E2', 'E1'] } } });
        })).not.toThrow();
    });

    test('isRegisteredHolderScoped is false with no context bound', () => {
        expect(isRegisteredHolderScoped('Application', holderReadWhere(SCOPE, 'Application'))).toBe(false);
    });
});

describe('the witness reads the caller where, before applyReadScopes', () => {
    test.each(['shadow', 'throw'])('%s: a marked Application read counts as scoped, and its entityId reaches the query unchanged', async (mode) => {
        setMode(mode);
        const before = await counterValue('Application', 'findMany');
        const { calls, query } = capture();
        await health(() => hooks.findMany({
            model: 'Application',
            args: { where: { ...holderReadWhere(SCOPE, 'Application'), status: 'DRAFT' } },
            query,
        }));
        // R2 Task 12: no entity dimension rewrites entityId any more ...
        expect(calls).toHaveLength(1);
        expect(calls[0].where.entityId).toEqual({ in: [...SCOPE.readIds] });
        // ... and the witness matched the registered fragment.
        expect(await counterValue('Application', 'findMany')).toBe(before);
        expect(witnessLogs()).toHaveLength(0);
    });
});

describe('a throwing logger never breaks the read in shadow mode', () => {
    beforeEach(() => { setMode('shadow'); });
    test('the read still resolves with the query result', async () => {
        mockWarn.mockImplementation(() => { throw new Error('log transport down'); });
        const { calls, query } = capture();
        await expect(health(() => hooks.findMany({
            model: 'Application', args: { where: { status: 'DRAFT' } }, query,
        }))).resolves.toBe('rows');
        expect(calls).toHaveLength(1);
    });
});

describe('tenant-context middleware sets the principal', () => {
    async function principalFor(user) {
        let seen;
        const req = { user: { id: 'u-1', organizationId: 'org-A', ...user } };
        await tenantContextMiddleware()(req, {}, () => { seen = getTenantContext(); });
        return { seen, req };
    }

    test("canonicalRole 'health' → principal 'health', on req.tenantContext and in the ALS", async () => {
        const { seen, req } = await principalFor({ canonicalRole: 'health' });
        expect(req.tenantContext).toEqual({ organizationId: 'org-A', principal: 'health' });
        expect(seen).toBe(req.tenantContext);
    });

    test.each([['document_reviewer'], ['system_admin_platform'], [undefined]])(
        "canonicalRole %s → principal 'staff'", async (canonicalRole) => {
            const { seen } = await principalFor({ canonicalRole });
            expect(seen.principal).toBe('staff');
        },
    );

    test('route: a string snapshot "METHOD baseUrl+path" taken at bind time; no getter, not enumerable', async () => {
        const req = {
            method: 'GET', baseUrl: '/api/applications', path: '/abc-123',
            user: { id: 'u-1', organizationId: 'org-A', canonicalRole: 'health' },
        };
        let ctx;
        await tenantContextMiddleware()(req, {}, () => { ctx = getTenantContext(); });
        expect(ctx.route).toBe('GET /api/applications/abc-123');
        const descriptor = Object.getOwnPropertyDescriptor(ctx, 'route');
        expect(descriptor.get).toBeUndefined();
        expect(typeof descriptor.value).toBe('string');
        expect(descriptor.enumerable).toBe(false);
        // A snapshot: later changes to req do not reach the context (req is not retained).
        req.path = '/other';
        req.method = 'POST';
        expect(ctx.route).toBe('GET /api/applications/abc-123');
        expect(Object.keys(ctx)).toEqual(['organizationId', 'principal']);
    });

    test("a legacy role string 'health' without canonicalRole is not trusted as health", async () => {
        const { seen } = await principalFor({ role: 'health' });
        expect(seen.principal).toBe('staff');
    });
});

describe('holder fragments are deep-frozen (a vouched value cannot be widened in place)', () => {
    test('holderReadWhere(Application).entityId.in.push throws', () => {
        const fragment = holderReadWhere(SCOPE, 'Application');
        expect(() => fragment.entityId.in.push('x')).toThrow(TypeError);
        expect(() => { fragment.entityId.in[0] = 'x'; }).toThrow(TypeError);
        expect(() => { fragment.entityId.in = ['x']; }).toThrow(TypeError);
        expect(fragment.entityId.in).toEqual(['E1', 'E2']);
    });

    test('a relation fragment (Invoice) is frozen at every level', () => {
        const fragment = holderReadWhere(SCOPE, 'Invoice');
        expect(Object.isFrozen(fragment)).toBe(true);
        expect(Object.isFrozen(fragment.application)).toBe(true);
        expect(Object.isFrozen(fragment.application.entityId)).toBe(true);
        expect(Object.isFrozen(fragment.application.entityId.in)).toBe(true);
    });

    test('the Farm fragment (built and marked by farm-access) is frozen, OR branches included', () => {
        const fragment = holderReadWhere(SCOPE, 'Farm');
        expect(() => fragment.OR.push({ ownerId: 'x' })).toThrow(TypeError);
        expect(() => fragment.OR[2].entityId.in.push('x')).toThrow(TypeError);
        const direct = buildFarmAccessWhere('u-1', ['E1'], ['E1']);
        expect(() => direct.OR.push({})).toThrow(TypeError);
    });

    test('spread still works and keeps the marker (the intended use)', async () => {
        const where = { ...holderReadWhere(SCOPE, 'Application'), status: 'DRAFT' };
        expect(Object.isFrozen(where)).toBe(false);
        setMode('throw');
        expect(() => health(() => checkHolderScoped('Application', 'findMany', {
            where: { ...holderReadWhere(SCOPE, 'Application'), status: 'DRAFT' },
        }))).not.toThrow();
    });
});

describe('a failing check never changes a read in shadow/off, and fails closed in throw (M1)', () => {
    const TRAP = () => {
        const where = {};
        Object.defineProperty(where, 'entityId', { enumerable: true, get: () => { throw new Error('boom in where'); } });
        return where;
    };

    test('BigInt in a registered key: shadow reads on, counted once (unscoped, not a crash)', async () => {
        setMode('shadow');
        const before = await counterValue('Application', 'findMany');
        const { calls, query } = capture();
        await expect(health(() => {
            holderReadWhere(SCOPE, 'Application');
            return hooks.findMany({ model: 'Application', args: { where: { entityId: 5n } }, query });
        })).resolves.toBe('rows');
        expect(calls).toHaveLength(1);
        expect(await counterValue('Application', 'findMany')).toBe(before + 1);
        expect(witnessLogs()).toHaveLength(1);
    });

    test('BigInt beside a registered fragment: still scoped', async () => {
        setMode('throw');
        const { calls, query } = capture();
        await expect(health(() => hooks.count({
            model: 'Invoice',
            args: { where: { ...holderReadWhere(SCOPE, 'Invoice'), amountSatang: { gt: 10n } } },
            query,
        }))).resolves.toBe('rows');
        expect(calls).toHaveLength(1);
    });

    test('canonical form accepts BigInt and keeps it distinct from the number', () => {
        expect(() => canonicalHolderForm({ a: 5n })).not.toThrow();
        expect(canonicalHolderForm({ a: 5n })).not.toBe(canonicalHolderForm({ a: 5 }));
    });

    // checkHolderScoped is called directly here: the trap getter would also blow
    // up in applyReadScopes' own spread, which is not the witness's doing.
    test('shadow: a check that throws → no throw, counted once and logged once with the error', async () => {
        setMode('shadow');
        const before = await counterValue('Application', 'findFirst');
        expect(() => health(() => {
            holderReadWhere(SCOPE, 'Application');
            checkHolderScoped('Application', 'findFirst', { where: TRAP() });
        })).not.toThrow();
        expect(await counterValue('Application', 'findFirst')).toBe(before + 1);
        const logs = witnessLogs();
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({ model: 'Application', op: 'findFirst', checkError: 'boom in where' });
    });

    test('throw: a check that throws fails closed with HEALTH_READ_UNSCOPED', () => {
        setMode('throw');
        expect(() => health(() => {
            holderReadWhere(SCOPE, 'Application');
            checkHolderScoped('Application', 'findFirst', { where: TRAP() });
        })).toThrow(expect.objectContaining({ code: 'HEALTH_READ_UNSCOPED' }));
    });

    test('off: a trap where is never even inspected', () => {
        setMode('off');
        expect(() => health(() => checkHolderScoped('Application', 'findFirst', { where: TRAP() }))).not.toThrow();
        expect(witnessLogs()).toHaveLength(0);
    });
});

describe('off mode is near-free (M4)', () => {
    test('the mode is read once and cached: a later env change has no effect until reset', () => {
        setMode('throw');
        expect(holderReadWitnessMode()).toBe('throw');
        process.env.HOLDER_READ_WITNESS = 'off';
        expect(holderReadWitnessMode()).toBe('throw');
        witnessConfig.resetHolderReadWitnessModeCache();
        expect(holderReadWitnessMode()).toBe('off');
    });

    test('an unwatched model never reads the mode (isWatchedModel is checked first)', () => {
        const spy = jest.spyOn(witnessConfig, 'holderReadWitnessMode');
        try {
            health(() => checkHolderScoped('User', 'findMany', { where: {} }));
            expect(spy).not.toHaveBeenCalled();
            health(() => checkHolderScoped('Application', 'findMany', {
                where: { ...holderReadWhere(SCOPE, 'Application') },
            }));
            expect(spy).toHaveBeenCalled();
        } finally { spy.mockRestore(); }
    });

    test('mode off: holderReadWhere registers nothing (still deep-frozen)', () => {
        let scopedAfterSwitch;
        health(() => {
            setMode('off');
            const frag = holderReadWhere(SCOPE, 'Application');
            expect(Object.isFrozen(frag.entityId.in)).toBe(true);
            setMode('shadow');
            scopedAfterSwitch = isRegisteredHolderScoped('Application', { ...frag });
        });
        expect(scopedAfterSwitch).toBe(false);
    });

    test('a staff principal registers nothing', () => {
        let scoped;
        staff(() => {
            const frag = holderReadWhere(SCOPE, 'Application');
            scoped = isRegisteredHolderScoped('Application', { ...frag });
        });
        expect(scoped).toBe(false);
    });

    test('a health principal in shadow does register (the positive control)', () => {
        let scoped;
        health(() => {
            const frag = holderReadWhere(SCOPE, 'Application');
            scoped = isRegisteredHolderScoped('Application', { ...frag });
        });
        expect(scoped).toBe(true);
    });
});
