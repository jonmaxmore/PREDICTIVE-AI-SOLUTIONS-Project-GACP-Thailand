'use strict';
const logger = require('../../shared/logger');
jest.mock('../../shared/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), createLogger: () => ({ warn: jest.fn() }) }));
const { emitMissingContext, emitWouldBeBlocked } = require('../../services/rls-shadow-metrics');
// Real tenant-context (AsyncLocalStorage) + real extension — same idiom as
// __tests__/unit/tenant-aggregate-groupby-scope.test.js. Only shared/logger
// is mocked (above); everything else here is the actual wiring under test.
const { runWithTenantContext, withoutTenantScope } = require('../../services/tenant-context');
const { tenantInjectExtension } = require('../../services/tenant-prisma-extension');

beforeEach(() => {
  jest.clearAllMocks();
});

test('emitMissingContext logs one structured rls-shadow event with model+action, no row data', () => {
  emitMissingContext({ model: 'Application', action: 'findUnique' });
  expect(logger.warn).toHaveBeenCalledTimes(1);
  const [msg, meta] = logger.warn.mock.calls[0];
  expect(msg).toMatch(/rls-shadow/i);
  expect(meta).toMatchObject({ signal: 'MISSING_CONTEXT', model: 'Application', action: 'findUnique' });
  expect(JSON.stringify(meta)).not.toMatch(/password|content|payload/i); // no row data
});

// Not in the brief's Step 2 sample, added here because Task 1 is what ships
// emitWouldBeBlocked (Step 4's code block) — Task 2 only wires a NEW call
// site for it, so leaving the function itself unverified at creation time
// would mean a shipped export with zero coverage.
test('emitWouldBeBlocked logs one structured rls-shadow event with org ids, no row data', () => {
  emitWouldBeBlocked({ model: 'Farm', action: 'findMany', rowOrgId: 'org-A', contextOrgId: 'org-B' });
  expect(logger.warn).toHaveBeenCalledTimes(1);
  const [msg, meta] = logger.warn.mock.calls[0];
  expect(msg).toMatch(/rls-shadow/i);
  expect(meta).toMatchObject({
    signal: 'WOULD_BE_BLOCKED',
    model: 'Farm',
    action: 'findMany',
    rowOrgId: 'org-A',
    contextOrgId: 'org-B',
  });
  expect(JSON.stringify(meta)).not.toMatch(/password|content|payload/i); // no row data
});

describe('wired into tenant-prisma-extension (Step 5) — missing-context hook on read/by-id verbs', () => {
  const findUniqueHook = tenantInjectExtension.query.$allModels.findUnique;
  const findManyHook = tenantInjectExtension.query.$allModels.findMany;

  const stubQuery = (result) => () => Promise.resolve(result);

  test('tenant-scoped findUnique, genuinely missing context → emits MISSING_CONTEXT and still returns the underlying result', async () => {
    const sentinel = { id: 'app-1' };
    const result = await findUniqueHook({
      model: 'Application',
      args: { where: { id: 'app-1' } },
      query: stubQuery(sentinel),
    });
    expect(result).toBe(sentinel); // zero behaviour change — same object the underlying query returned
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [msg, meta] = logger.warn.mock.calls[0];
    expect(msg).toMatch(/rls-shadow/i);
    expect(meta).toMatchObject({ signal: 'MISSING_CONTEXT', model: 'Application', action: 'findUnique' });
  });

  test('tenant-scoped findUnique inside withoutTenantScope (intentional bypass) → does NOT emit', async () => {
    const sentinel = { id: 'app-2' };
    const result = await withoutTenantScope(() =>
      findUniqueHook({ model: 'Application', args: { where: { id: 'app-2' } }, query: stubQuery(sentinel) }),
    );
    expect(result).toBe(sentinel);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('tenant-scoped findUnique with a bound tenant context → does NOT emit', async () => {
    const sentinel = { id: 'app-3' };
    const result = await runWithTenantContext({ organizationId: 'org-1' }, () =>
      findUniqueHook({ model: 'Application', args: { where: { id: 'app-3' } }, query: stubQuery(sentinel) }),
    );
    expect(result).toBe(sentinel);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('non-tenant-scoped model, missing context → does NOT emit', async () => {
    const sentinel = { key: 'x' };
    const result = await findUniqueHook({
      model: 'SystemConfig',
      args: { where: { key: 'x' } },
      query: stubQuery(sentinel),
    });
    expect(result).toBe(sentinel);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('tenant-scoped findMany, genuinely missing context → also emits (parity across read verbs, not just findUnique)', async () => {
    const sentinel = [{ id: 'a' }];
    const result = await findManyHook({ model: 'Application', args: { where: {} }, query: stubQuery(sentinel) });
    expect(result).toBe(sentinel);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [, meta] = logger.warn.mock.calls[0];
    expect(meta).toMatchObject({ signal: 'MISSING_CONTEXT', model: 'Application', action: 'findMany' });
  });
});

// Fix round 1 — checkMissingContext runs BEFORE query() in every hooked verb,
// so a throwing logger would turn a previously-succeeding read into a
// failure: a shadow probe must never be able to take down the path it only
// measures. Both emitters must swallow a logging failure.
describe('resilience — a throwing logger.warn must never propagate', () => {
  test('emitMissingContext swallows a throwing logger.warn', () => {
    logger.warn.mockImplementationOnce(() => {
      throw new Error('log transport down');
    });
    expect(() => emitMissingContext({ model: 'Application', action: 'findMany' })).not.toThrow();
  });

  test('emitWouldBeBlocked swallows a throwing logger.warn', () => {
    logger.warn.mockImplementationOnce(() => {
      throw new Error('log transport down');
    });
    expect(() =>
      emitWouldBeBlocked({ model: 'Farm', action: 'findMany', rowOrgId: 'org-A', contextOrgId: 'org-B' }),
    ).not.toThrow();
  });

  test('a hooked verb (findUnique, genuinely missing context) still returns its result when logger.warn throws', async () => {
    logger.warn.mockImplementationOnce(() => {
      throw new Error('log transport down');
    });
    const sentinel = { id: 'app-throw' };
    const findUniqueHook = tenantInjectExtension.query.$allModels.findUnique;
    await expect(
      findUniqueHook({
        model: 'Application',
        args: { where: { id: 'app-throw' } },
        query: () => Promise.resolve(sentinel),
      }),
    ).resolves.toBe(sentinel);
  });
});
