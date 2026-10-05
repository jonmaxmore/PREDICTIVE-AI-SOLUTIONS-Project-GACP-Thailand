/**
 * RLS Phase 0 (shadow / measure-first) — Task 2: would-be-blocked
 * cross-tenant metric.
 *
 * Verifies the tenant-prisma-extension's POST-READ compare: once a
 * tenant-scoped read's query() has resolved, if the returned row's
 * organizationId differs from the bound tenant context's organizationId,
 * emitWouldBeBlocked fires — the exact row RLS enforcement would have
 * hidden. Shadow only: the row is STILL returned, unchanged, to the caller.
 *
 * Same idiom as __tests__/unit/rls-shadow-metrics.test.js (Task 1): real
 * tenant-context (AsyncLocalStorage) + real extension. Unlike that file,
 * HERE services/rls-shadow-metrics itself is mocked, so assertions target
 * emitWouldBeBlocked's call args directly rather than logger.warn's payload
 * — rls-shadow-metrics.test.js already covers emitWouldBeBlocked's own
 * logging/resilience behaviour; this file is only about the NEW call site.
 */

'use strict';

jest.mock('../../services/rls-shadow-metrics', () => ({
  emitMissingContext: jest.fn(),
  emitWouldBeBlocked: jest.fn(),
}));

const { emitWouldBeBlocked, emitMissingContext } = require('../../services/rls-shadow-metrics');
const { runWithTenantContext, withoutTenantScope } = require('../../services/tenant-context');
const {
  tenantInjectExtension,
  WOULD_BE_BLOCKED_SCAN_CAP,
} = require('../../services/tenant-prisma-extension');

// Fallback keeps array-sizing well-formed even before the cap constant is
// exported (pre-implementation RED phase); once implemented this is just
// the real exported constant (50).
const CAP = WOULD_BE_BLOCKED_SCAN_CAP || 50;

const findUniqueHook = tenantInjectExtension.query.$allModels.findUnique;
const findFirstHook = tenantInjectExtension.query.$allModels.findFirst;
const findManyHook = tenantInjectExtension.query.$allModels.findMany;

const stubQuery = (result) => () => Promise.resolve(result);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('findUnique — cross-tenant compare (the high-value by-id case; applyReadScopes does not scope it)', () => {
  test('row.organizationId !== context org → emits WOULD_BE_BLOCKED and still returns the row unchanged', async () => {
    const row = { id: 'app-1', organizationId: 'org-B' };
    const result = await runWithTenantContext({ organizationId: 'org-A' }, () =>
      findUniqueHook({ model: 'Application', args: { where: { id: 'app-1' } }, query: stubQuery(row) }),
    );
    expect(result).toBe(row); // exact same reference — no filtering
    expect(emitWouldBeBlocked).toHaveBeenCalledTimes(1);
    expect(emitWouldBeBlocked).toHaveBeenCalledWith({
      model: 'Application',
      action: 'findUnique',
      rowOrgId: 'org-B',
      contextOrgId: 'org-A',
    });
  });

  test('row.organizationId === context org → does NOT emit', async () => {
    const row = { id: 'app-2', organizationId: 'org-A' };
    const result = await runWithTenantContext({ organizationId: 'org-A' }, () =>
      findUniqueHook({ model: 'Application', args: { where: { id: 'app-2' } }, query: stubQuery(row) }),
    );
    expect(result).toBe(row);
    expect(emitWouldBeBlocked).not.toHaveBeenCalled();
  });

  test('row has no organizationId field at all → does NOT emit, does NOT throw', async () => {
    const row = { id: 'app-3' }; // e.g. a select projection, or a parent-scoped model
    const result = await runWithTenantContext({ organizationId: 'org-A' }, () =>
      findUniqueHook({ model: 'Application', args: { where: { id: 'app-3' } }, query: stubQuery(row) }),
    );
    expect(result).toBe(row);
    expect(emitWouldBeBlocked).not.toHaveBeenCalled();
  });

  test('result is null (not found) → does NOT emit, does NOT throw', async () => {
    const result = await runWithTenantContext({ organizationId: 'org-A' }, () =>
      findUniqueHook({ model: 'Application', args: { where: { id: 'missing' } }, query: stubQuery(null) }),
    );
    expect(result).toBeNull();
    expect(emitWouldBeBlocked).not.toHaveBeenCalled();
  });

  test('no tenant context bound (genuinely missing) → nothing to compare against, does NOT emit WOULD_BE_BLOCKED', async () => {
    const row = { id: 'app-4', organizationId: 'org-B' };
    const result = await findUniqueHook({ model: 'Application', args: { where: { id: 'app-4' } }, query: stubQuery(row) });
    expect(result).toBe(row);
    expect(emitWouldBeBlocked).not.toHaveBeenCalled();
  });

  test('inside withoutTenantScope (intentional bypass) → does NOT emit', async () => {
    const row = { id: 'app-5', organizationId: 'org-B' };
    const result = await withoutTenantScope(() =>
      findUniqueHook({ model: 'Application', args: { where: { id: 'app-5' } }, query: stubQuery(row) }),
    );
    expect(result).toBe(row);
    expect(emitWouldBeBlocked).not.toHaveBeenCalled();
  });

  test('non-tenant-scoped model → does NOT emit even with a mismatched organizationId-shaped row', async () => {
    const row = { id: 'x', organizationId: 'org-B' };
    const result = await runWithTenantContext({ organizationId: 'org-A' }, () =>
      findUniqueHook({ model: 'SystemConfig', args: { where: { id: 'x' } }, query: stubQuery(row) }),
    );
    expect(result).toBe(row);
    expect(emitWouldBeBlocked).not.toHaveBeenCalled();
  });
});

describe('findFirst — cross-tenant compare (parity with findUnique)', () => {
  test('row.organizationId !== context org → emits WOULD_BE_BLOCKED and still returns the row unchanged', async () => {
    const row = { id: 'farm-1', organizationId: 'org-B' };
    const result = await runWithTenantContext({ organizationId: 'org-A' }, () =>
      findFirstHook({ model: 'Farm', args: { where: {} }, query: stubQuery(row) }),
    );
    expect(result).toBe(row);
    expect(emitWouldBeBlocked).toHaveBeenCalledTimes(1);
    expect(emitWouldBeBlocked).toHaveBeenCalledWith({
      model: 'Farm',
      action: 'findFirst',
      rowOrgId: 'org-B',
      contextOrgId: 'org-A',
    });
  });

  test('row.organizationId === context org → does NOT emit', async () => {
    const row = { id: 'farm-2', organizationId: 'org-A' };
    const result = await runWithTenantContext({ organizationId: 'org-A' }, () =>
      findFirstHook({ model: 'Farm', args: { where: {} }, query: stubQuery(row) }),
    );
    expect(result).toBe(row);
    expect(emitWouldBeBlocked).not.toHaveBeenCalled();
  });

  test('result is null (no match) → does NOT emit, does NOT throw', async () => {
    const result = await runWithTenantContext({ organizationId: 'org-A' }, () =>
      findFirstHook({ model: 'Farm', args: { where: {} }, query: stubQuery(null) }),
    );
    expect(result).toBeNull();
    expect(emitWouldBeBlocked).not.toHaveBeenCalled();
  });
});

describe('findMany — cross-tenant compare over the returned array (bounded scan)', () => {
  test('one mismatched row among matches → emits once, array returned unchanged (same reference)', async () => {
    const rows = [
      { id: 'a', organizationId: 'org-A' },
      { id: 'b', organizationId: 'org-B' },
      { id: 'c', organizationId: 'org-A' },
    ];
    const result = await runWithTenantContext({ organizationId: 'org-A' }, () =>
      findManyHook({ model: 'Farm', args: { where: {} }, query: stubQuery(rows) }),
    );
    expect(result).toBe(rows); // same array reference — nothing filtered out
    expect(emitWouldBeBlocked).toHaveBeenCalledTimes(1);
    expect(emitWouldBeBlocked).toHaveBeenCalledWith({
      model: 'Farm',
      action: 'findMany',
      rowOrgId: 'org-B',
      contextOrgId: 'org-A',
    });
  });

  test('all rows match context org → does NOT emit', async () => {
    const rows = [
      { id: 'a', organizationId: 'org-A' },
      { id: 'b', organizationId: 'org-A' },
    ];
    const result = await runWithTenantContext({ organizationId: 'org-A' }, () =>
      findManyHook({ model: 'Farm', args: { where: {} }, query: stubQuery(rows) }),
    );
    expect(result).toBe(rows);
    expect(emitWouldBeBlocked).not.toHaveBeenCalled();
  });

  test('empty array → does NOT emit, does NOT throw', async () => {
    const rows = [];
    const result = await runWithTenantContext({ organizationId: 'org-A' }, () =>
      findManyHook({ model: 'Farm', args: { where: {} }, query: stubQuery(rows) }),
    );
    expect(result).toBe(rows);
    expect(emitWouldBeBlocked).not.toHaveBeenCalled();
  });

  test('row missing organizationId inside the array → skipped silently (no emit, no throw), other rows still compared', async () => {
    const rows = [
      { id: 'a' }, // no organizationId — e.g. a select projection
      { id: 'b', organizationId: 'org-B' },
    ];
    const result = await runWithTenantContext({ organizationId: 'org-A' }, () =>
      findManyHook({ model: 'Farm', args: { where: {} }, query: stubQuery(rows) }),
    );
    expect(result).toBe(rows);
    expect(emitWouldBeBlocked).toHaveBeenCalledTimes(1);
    expect(emitWouldBeBlocked).toHaveBeenCalledWith({
      model: 'Farm',
      action: 'findMany',
      rowOrgId: 'org-B',
      contextOrgId: 'org-A',
    });
  });

  test(`scan is capped at ${CAP} rows — a mismatch strictly beyond the cap is not scanned`, async () => {
    const rows = Array.from({ length: CAP + 5 }, (_, i) => ({
      id: `row-${i}`,
      organizationId: 'org-A',
    }));
    // Mismatches placed strictly AFTER the cap boundary (index CAP is the
    // first row NOT scanned when exactly CAP rows — indices 0..CAP-1 — are
    // compared).
    rows[CAP].organizationId = 'org-B';
    rows[CAP + 4].organizationId = 'org-B';

    const result = await runWithTenantContext({ organizationId: 'org-A' }, () =>
      findManyHook({ model: 'Farm', args: { where: {} }, query: stubQuery(rows) }),
    );
    expect(result).toBe(rows); // full array still returned — the cap only bounds the SCAN
    expect(emitWouldBeBlocked).not.toHaveBeenCalled();
  });

  test('a mismatch WITHIN the cap is still caught on a large array (cap does not silently disable the signal)', async () => {
    const rows = Array.from({ length: CAP + 5 }, (_, i) => ({
      id: `row-${i}`,
      organizationId: 'org-A',
    }));
    rows[0].organizationId = 'org-B'; // well within the cap

    const result = await runWithTenantContext({ organizationId: 'org-A' }, () =>
      findManyHook({ model: 'Farm', args: { where: {} }, query: stubQuery(rows) }),
    );
    expect(result).toBe(rows);
    expect(emitWouldBeBlocked).toHaveBeenCalledTimes(1);
    expect(emitWouldBeBlocked).toHaveBeenCalledWith({
      model: 'Farm',
      action: 'findMany',
      rowOrgId: 'org-B',
      contextOrgId: 'org-A',
    });
  });

  test('no tenant context bound → does NOT emit (nothing to compare against)', async () => {
    const rows = [{ id: 'a', organizationId: 'org-B' }];
    const result = await findManyHook({ model: 'Farm', args: { where: {} }, query: stubQuery(rows) });
    expect(result).toBe(rows);
    expect(emitWouldBeBlocked).not.toHaveBeenCalled();
  });
});

describe('coexistence with Task 1 (checkMissingContext must not be replaced)', () => {
  test('findUnique with genuinely missing context still emits MISSING_CONTEXT, and WOULD_BE_BLOCKED does not also fire', async () => {
    const row = { id: 'app-6', organizationId: 'org-B' };
    const result = await findUniqueHook({ model: 'Application', args: { where: { id: 'app-6' } }, query: stubQuery(row) });
    expect(result).toBe(row);
    expect(emitMissingContext).toHaveBeenCalledTimes(1);
    expect(emitMissingContext).toHaveBeenCalledWith({ model: 'Application', action: 'findUnique' });
    expect(emitWouldBeBlocked).not.toHaveBeenCalled(); // no bound context ⇒ nothing to compare against
  });
});
