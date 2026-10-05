/**
 * RLS Phase 0 (shadow / measure-first) — Task 3: GUC-setting wiring.
 *
 * Verifies the by-id verbs (findUnique/update/delete/upsert) wrap their
 * bound query in a batch $transaction that pins app.tenant_id (or
 * app.rls_bypass) via set_config(..., true) BEFORE running the query —
 * but ONLY when RLS_SHADOW_GUC=true (default OFF, mirrors the shape of
 * orgReadScopeEnabled). The DB policy itself is still SELECT TRUE
 * (permissive) at this phase: this proves the MECHANISM, it enforces
 * nothing.
 *
 * DB-FREE: every $transaction/$executeRawUnsafe call below is a jest mock
 * passed in directly as the hook's `client` field — no real Postgres
 * involved. Real Prisma (@prisma/client@5.22.0, confirmed empirically) does
 * NOT put a `client` field on $allModels hook args, ever — not on
 * auto-commit calls, not inside an interactive transaction either. That
 * means:
 *   - Passing a mock `client` here tests COMPOSITION/SHAPE only — what
 *     arguments withTenantGuc/withBypassGuc build and pass to
 *     $transaction/$executeRawUnsafe. It does NOT and CANNOT prove
 *     anything about connection-pinning or in-tx safety, because real
 *     Prisma never hands the hook a client that differs between those two
 *     situations in the first place — see tenant-prisma-extension.js's
 *     withShadowGuc doc comment for why no in-extension guard is possible
 *     on this Prisma version. Connection-pinning is proven only by
 *     rls-shadow-guc.int.test.js, against a real Postgres connection.
 *   - There is deliberately NO "tx-client" mock/scenario in this file
 *     (an earlier version had one — it tested a client shape real Prisma
 *     never produces, which papered over the in-tx danger instead of
 *     revealing it; see the CRITICAL fix in task-3-report.md).
 *   - In production `client` is always undefined, so every wired verb
 *     falls back to getClosureExtendedClient() — the real fallback path is
 *     exercised for real by rls-shadow-guc.int.test.js, which SKIPs
 *     cleanly here without DATABASE_URL.
 *
 * Same idiom as rls-shadow-crosstenant.test.js: mock services/rls-shadow-metrics
 * so emitMissingContext/emitWouldBeBlocked call args can be asserted
 * directly; use REAL tenant-context (AsyncLocalStorage) for context binding.
 */

'use strict';

jest.mock('../../services/rls-shadow-metrics', () => ({
  emitMissingContext: jest.fn(),
  emitWouldBeBlocked: jest.fn(),
}));

const { emitMissingContext, emitWouldBeBlocked } = require('../../services/rls-shadow-metrics');
const { runWithTenantContext, withoutTenantScope } = require('../../services/tenant-context');
const { tenantInjectExtension, shadowGucEnabled } = require('../../services/tenant-prisma-extension');

const findUniqueHook = tenantInjectExtension.query.$allModels.findUnique;
const updateHook = tenantInjectExtension.query.$allModels.update;
const deleteHook = tenantInjectExtension.query.$allModels.delete;
const upsertHook = tenantInjectExtension.query.$allModels.upsert;

// A "FULL" client: has a working batch $transaction. This is the ONLY kind
// of client mock in this file — real Prisma never gives the hook anything
// else (see header comment above). It stands in for the closure-captured
// extended singleton that production always falls back to.
function makeFullClient(transactionResolvesTo) {
  const rawSentinel = Symbol('rawSetConfigCall');
  return {
    __rawSentinel: rawSentinel,
    $executeRawUnsafe: jest.fn(() => rawSentinel),
    $transaction: jest.fn(() => Promise.resolve(transactionResolvesTo)),
  };
}

const ORIGINAL_FLAG = process.env.RLS_SHADOW_GUC;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.RLS_SHADOW_GUC;
});

afterAll(() => {
  if (ORIGINAL_FLAG === undefined) { delete process.env.RLS_SHADOW_GUC; }
  else { process.env.RLS_SHADOW_GUC = ORIGINAL_FLAG; }
});

describe('shadowGucEnabled — flag shape (mirrors orgReadScopeEnabled)', () => {
  test('default (unset) is OFF', () => {
    expect(shadowGucEnabled()).toBe(false);
  });

  test('anything other than the literal string "true" is OFF', () => {
    process.env.RLS_SHADOW_GUC = '1';
    expect(shadowGucEnabled()).toBe(false);
  });

  test('"true" is ON', () => {
    process.env.RLS_SHADOW_GUC = 'true';
    expect(shadowGucEnabled()).toBe(true);
  });
});

describe('flag OFF (default) — byte-equivalent to today: no $transaction attempted', () => {
  test('findUnique calls the bound query(args) directly; client.$transaction is NOT called', async () => {
    const client = makeFullClient([null, { id: 'a' }]);
    const sentinel = { id: 'a', organizationId: 'org-A' };
    const query = jest.fn(() => Promise.resolve(sentinel));
    const args = { where: { id: 'a' } };

    const result = await runWithTenantContext({ organizationId: 'org-A' }, () =>
      findUniqueHook({ model: 'Application', args, query, client }),
    );

    expect(query).toHaveBeenCalledWith(args);
    expect(client.$transaction).not.toHaveBeenCalled();
    expect(client.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(result).toBe(sentinel);
  });

  test('update calls the bound query(args) directly; client.$transaction is NOT called', async () => {
    const client = makeFullClient([null, { id: 'b' }]);
    const sentinel = { id: 'b' };
    const query = jest.fn(() => Promise.resolve(sentinel));
    const args = { where: { id: 'b' }, data: { name: 'x' } };

    const result = await runWithTenantContext({ organizationId: 'org-A' }, () =>
      updateHook({ model: 'Application', args, query, client }),
    );

    expect(query).toHaveBeenCalledWith(args);
    expect(client.$transaction).not.toHaveBeenCalled();
    expect(result).toBe(sentinel);
  });

  test('delete calls the bound query(args) directly; client.$transaction is NOT called', async () => {
    const client = makeFullClient([null, { id: 'c' }]);
    const sentinel = { id: 'c' };
    const query = jest.fn(() => Promise.resolve(sentinel));
    const args = { where: { id: 'c' } };

    const result = await runWithTenantContext({ organizationId: 'org-A' }, () =>
      deleteHook({ model: 'Application', args, query, client }),
    );

    expect(query).toHaveBeenCalledWith(args);
    expect(client.$transaction).not.toHaveBeenCalled();
    expect(result).toBe(sentinel);
  });

  test('upsert still injects args.create.organizationId (E.1, unaffected by the flag) but does not wrap in $transaction', async () => {
    const client = makeFullClient([null, { id: 'd' }]);
    const sentinel = { id: 'd' };
    const query = jest.fn(() => Promise.resolve(sentinel));
    const args = { where: { id: 'd' }, create: { name: 'x' }, update: { name: 'y' } };

    const result = await runWithTenantContext({ organizationId: 'org-A' }, () =>
      upsertHook({ model: 'Application', args, query, client }),
    );

    expect(args.create.organizationId).toBe('org-A');
    expect(query).toHaveBeenCalledWith(args);
    expect(client.$transaction).not.toHaveBeenCalled();
    expect(result).toBe(sentinel);
  });

  test('non-tenant-scoped model: findUnique is untouched even if somehow called with a client', async () => {
    const client = makeFullClient([null, { id: 'e' }]);
    const sentinel = { key: 'x' };
    const query = jest.fn(() => Promise.resolve(sentinel));
    const result = await findUniqueHook({ model: 'SystemConfig', args: { where: { key: 'x' } }, query, client });
    expect(result).toBe(sentinel);
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});

// SHAPE/COMPOSITION ONLY — see header comment. These tests prove what
// withTenantGuc builds and passes to $transaction/$executeRawUnsafe; they
// do NOT prove connection-pinning or in-tx safety (that's
// rls-shadow-guc.int.test.js, against real Postgres).
describe('flag ON + bound context — batch-array SHAPE (withTenantGuc composition)', () => {
  beforeEach(() => { process.env.RLS_SHADOW_GUC = 'true'; });

  test('findUnique calls client.$transaction with a 2-element array [set_config raw, query(args)] and returns the unwrapped result', async () => {
    const sentinel = { id: 'a', organizationId: 'org-A' };
    const client = makeFullClient([null, sentinel]);
    const queryReturn = Symbol('queryReturn');
    const query = jest.fn(() => queryReturn);
    const args = { where: { id: 'a' } };

    const result = await runWithTenantContext({ organizationId: 'org-A' }, () =>
      findUniqueHook({ model: 'Application', args, query, client }),
    );

    expect(result).toBe(sentinel); // unwrapped from $transaction's resolved [_, result]
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    const batchArg = client.$transaction.mock.calls[0][0];
    expect(batchArg).toEqual([client.__rawSentinel, queryReturn]); // element-0 = raw set_config call, element-1 = query(args)
    expect(query).toHaveBeenCalledWith(args);
    expect(client.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("set_config('app.tenant_id'"),
      'org-A',
    );
  });

  test('update routes through the same batch wrap', async () => {
    const sentinel = { id: 'b' };
    const client = makeFullClient([null, sentinel]);
    const query = jest.fn(() => Symbol('q'));
    const args = { where: { id: 'b' }, data: { name: 'x' } };

    const result = await runWithTenantContext({ organizationId: 'org-B' }, () =>
      updateHook({ model: 'Application', args, query, client }),
    );

    expect(result).toBe(sentinel);
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(client.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("set_config('app.tenant_id'"),
      'org-B',
    );
  });

  test('delete routes through the same batch wrap', async () => {
    const sentinel = { id: 'c' };
    const client = makeFullClient([null, sentinel]);
    const query = jest.fn(() => Symbol('q'));
    const args = { where: { id: 'c' } };

    const result = await runWithTenantContext({ organizationId: 'org-C' }, () =>
      deleteHook({ model: 'Application', args, query, client }),
    );

    expect(result).toBe(sentinel);
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(client.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("set_config('app.tenant_id'"),
      'org-C',
    );
  });

  test('upsert injects args.create.organizationId AND routes through the batch wrap', async () => {
    const sentinel = { id: 'd' };
    const client = makeFullClient([null, sentinel]);
    const query = jest.fn(() => Symbol('q'));
    const args = { where: { id: 'd' }, create: { name: 'x' }, update: { name: 'y' } };

    const result = await runWithTenantContext({ organizationId: 'org-D' }, () =>
      upsertHook({ model: 'Application', args, query, client }),
    );

    expect(args.create.organizationId).toBe('org-D');
    expect(result).toBe(sentinel);
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(client.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("set_config('app.tenant_id'"),
      'org-D',
    );
  });
});

// INTENTIONAL bypass specifically (withoutTenantScope) — NOT the same code
// path as a genuinely-missing context; see the "context branching" describe
// block below, which pins the distinction (Important-2 fix).
describe('flag ON + withoutTenantScope (intentional bypass) — batch-array SHAPE (withBypassGuc composition)', () => {
  beforeEach(() => { process.env.RLS_SHADOW_GUC = 'true'; });

  test('findUnique with no bound context (withoutTenantScope) sets app.rls_bypass instead of app.tenant_id', async () => {
    const sentinel = { id: 'x' };
    const client = makeFullClient([null, sentinel]);
    const query = jest.fn(() => Symbol('q'));
    const args = { where: { id: 'x' } };

    const result = await withoutTenantScope(() =>
      findUniqueHook({ model: 'Application', args, query, client }),
    );

    expect(result).toBe(sentinel);
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(client.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("set_config('app.rls_bypass', 'on'"),
    );
    // bypass form's SQL is a literal, not parameterized — only 1 argument.
    expect(client.$executeRawUnsafe.mock.calls[0]).toHaveLength(1);
  });

  test('upsert with no bound context: create-inject is skipped (unchanged E.1 behaviour) but bypass GUC still wraps', async () => {
    const sentinel = { id: 'y' };
    const client = makeFullClient([null, sentinel]);
    const query = jest.fn(() => Symbol('q'));
    const args = { where: { id: 'y' }, create: { name: 'x' } };

    const result = await withoutTenantScope(() =>
      upsertHook({ model: 'Application', args, query, client }),
    );

    expect(args.create.organizationId).toBeUndefined(); // no ctx -> no inject, same as today
    expect(result).toBe(sentinel);
    expect(client.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("set_config('app.rls_bypass', 'on'"),
    );
  });
});

// Important-2 fix: withShadowGuc's THREE-way context branch, side by side.
// null-context used to collapse two different situations into one
// (`!ctx` -> always bypass) — a fail-OPEN bug, because a genuinely-missing
// context (nobody ever bound one — a bug/misconfiguration) would silently
// get app.rls_bypass='on' (platform-admin-equivalent) once real enforcement
// lands. isWithoutTenantScope() is what tells "intentional bypass" apart
// from "genuinely missing" (see tenant-context.js); withShadowGuc now
// checks it before falling back to a bare `query(args)` with NO GUC set —
// so a genuinely-missing context fails CLOSED under future enforcement
// instead of being silently bypassed. findUnique used throughout since it's
// the verb with full Task 1/2 coexistence; the other three verbs are
// covered by the SHAPE describe blocks above.
describe('flag ON — context branching on withShadowGuc (all three cases)', () => {
  beforeEach(() => { process.env.RLS_SHADOW_GUC = 'true'; });

  test('bound tenant context -> tenant GUC shape (withTenantGuc): batches [set_config(app.tenant_id,...), query(args)]', async () => {
    const sentinel = { id: 'bound-1' };
    const client = makeFullClient([null, sentinel]);
    const query = jest.fn(() => Symbol('q'));
    const args = { where: { id: 'bound-1' } };

    const result = await runWithTenantContext({ organizationId: 'org-BRANCH' }, () =>
      findUniqueHook({ model: 'Application', args, query, client }),
    );

    expect(result).toBe(sentinel);
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(client.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("set_config('app.tenant_id'"),
      'org-BRANCH',
    );
  });

  test('withoutTenantScope (intentional bypass) -> bypass GUC shape (withBypassGuc): batches [set_config(app.rls_bypass,on,...), query(args)]', async () => {
    const sentinel = { id: 'bypass-1' };
    const client = makeFullClient([null, sentinel]);
    const query = jest.fn(() => Symbol('q'));
    const args = { where: { id: 'bypass-1' } };

    const result = await withoutTenantScope(() =>
      findUniqueHook({ model: 'Application', args, query, client }),
    );

    expect(result).toBe(sentinel);
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(client.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("set_config('app.rls_bypass', 'on'"),
    );
  });

  test('genuinely-missing context (no ctx bound, NOT withoutTenantScope) -> plain query(args), NO $transaction attempted (fails closed, not bypassed)', async () => {
    const sentinel = { id: 'missing-1' };
    const client = makeFullClient([null, sentinel]);
    const query = jest.fn(() => Promise.resolve(sentinel));
    const args = { where: { id: 'missing-1' } };

    const result = await findUniqueHook({ model: 'Application', args, query, client });

    expect(result).toBe(sentinel);
    expect(query).toHaveBeenCalledWith(args);
    expect(client.$transaction).not.toHaveBeenCalled();
    expect(client.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});

describe('coexistence with Task 1/2 hooks on findUnique (flag ON) — checkMissingContext / checkWouldBeBlockedResult must keep firing', () => {
  beforeEach(() => { process.env.RLS_SHADOW_GUC = 'true'; });

  test('genuinely missing context still emits MISSING_CONTEXT (Task 1 unaffected) and runs the plain query — NO GUC set at all (Important-2 fix: fails closed, not bypassed)', async () => {
    const row = { id: 'm' };
    const client = makeFullClient([null, row]); // must NOT be used — no $transaction expected on this path
    const query = jest.fn(() => Promise.resolve(row));
    const args = { where: { id: 'm' } };

    const result = await findUniqueHook({ model: 'Application', args, query, client });

    expect(emitMissingContext).toHaveBeenCalledTimes(1);
    expect(emitMissingContext).toHaveBeenCalledWith({ model: 'Application', action: 'findUnique' });
    expect(result).toBe(row);
    expect(query).toHaveBeenCalledWith(args);
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  test('cross-tenant row still emits WOULD_BE_BLOCKED and returns the row unchanged (Task 2 unaffected)', async () => {
    const row = { id: 'n', organizationId: 'org-B' };
    const client = makeFullClient([null, row]);
    const query = jest.fn(() => Symbol('q'));

    const result = await runWithTenantContext({ organizationId: 'org-A' }, () =>
      findUniqueHook({ model: 'Application', args: { where: { id: 'n' } }, query, client }),
    );

    expect(result).toBe(row);
    expect(emitWouldBeBlocked).toHaveBeenCalledTimes(1);
    expect(emitWouldBeBlocked).toHaveBeenCalledWith({
      model: 'Application', action: 'findUnique', rowOrgId: 'org-B', contextOrgId: 'org-A',
    });
  });

  test('same-tenant row: neither signal fires, row returned via the GUC wrap', async () => {
    const row = { id: 'p', organizationId: 'org-A' };
    const client = makeFullClient([null, row]);
    const query = jest.fn(() => Symbol('q'));

    const result = await runWithTenantContext({ organizationId: 'org-A' }, () =>
      findUniqueHook({ model: 'Application', args: { where: { id: 'p' } }, query, client }),
    );

    expect(result).toBe(row);
    expect(emitMissingContext).not.toHaveBeenCalled();
    expect(emitWouldBeBlocked).not.toHaveBeenCalled();
    expect(client.$transaction).toHaveBeenCalledTimes(1);
  });
});
