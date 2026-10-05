/**
 * Unit tests for tenant context service + Prisma write injection extension.
 * No DB needed — exercises the AsyncLocalStorage scope and the extension's
 * pure injection logic via stubbed `query` functions.
 */

const {
  getTenantContext,
  requireTenantContext,
  runWithTenantContext,
  withoutTenantScope,
  isWithoutTenantScope,
} = require('../services/tenant-context');

const {
  tenantInjectExtension,
  isTenantScoped,
} = require('../services/tenant-prisma-extension');

describe('tenant-context service', () => {
  it('returns null when no scope is active', () => {
    expect(getTenantContext()).toBeNull();
  });

  it('binds context for the duration of the callback', () => {
    const ctx = { organizationId: 'org-abc' };
    runWithTenantContext(ctx, () => {
      expect(getTenantContext()).toEqual(ctx);
    });
    expect(getTenantContext()).toBeNull();
  });

  it('preserves context across async boundaries (AsyncLocalStorage)', async () => {
    const ctx = { organizationId: 'org-async' };
    await runWithTenantContext(ctx, async () => {
      await Promise.resolve();
      expect(getTenantContext()).toEqual(ctx);
      await new Promise((resolve) => setImmediate(resolve));
      expect(getTenantContext()).toEqual(ctx);
    });
  });

  it('isolates concurrent contexts', async () => {
    const results = await Promise.all([
      runWithTenantContext({ organizationId: 'A' }, async () => {
        await new Promise((r) => setImmediate(r));
        return getTenantContext().organizationId;
      }),
      runWithTenantContext({ organizationId: 'B' }, async () => {
        await new Promise((r) => setImmediate(r));
        return getTenantContext().organizationId;
      }),
    ]);
    expect(results).toEqual(['A', 'B']);
  });

  it('rejects empty context', () => {
    expect(() => runWithTenantContext(null, () => {})).toThrow(/organizationId is required/);
    expect(() => runWithTenantContext({}, () => {})).toThrow(/organizationId is required/);
  });

  it('requireTenantContext throws when no scope is active', () => {
    expect(() => requireTenantContext()).toThrow(/TenantContext required/);
  });

  it('withoutTenantScope clears context inside the callback', () => {
    runWithTenantContext({ organizationId: 'org-outer' }, () => {
      withoutTenantScope(() => {
        expect(getTenantContext()).toBeNull();
      });
      expect(getTenantContext()).toEqual({ organizationId: 'org-outer' });
    });
  });

  // rls-shadow-metrics (Phase 0) needs to tell "genuinely no context bound"
  // apart from "intentionally inside withoutTenantScope" — getTenantContext()
  // alone can't do this (both read back as null). isWithoutTenantScope() is
  // the accessor that makes the distinction.
  it('isWithoutTenantScope is false when no scope was ever entered (genuinely missing)', () => {
    expect(isWithoutTenantScope()).toBe(false);
  });

  it('isWithoutTenantScope is true only inside withoutTenantScope, not for a plain bound context', () => {
    runWithTenantContext({ organizationId: 'org-outer' }, () => {
      expect(isWithoutTenantScope()).toBe(false);
      withoutTenantScope(() => {
        expect(isWithoutTenantScope()).toBe(true);
      });
      expect(isWithoutTenantScope()).toBe(false);
    });
  });
});

describe('tenant-prisma-extension — model classification', () => {
  it('classifies tenant-scoped models', () => {
    expect(isTenantScoped('User')).toBe(true);
    expect(isTenantScoped('Application')).toBe(true);
    expect(isTenantScoped('Invoice')).toBe(true);
    expect(isTenantScoped('AuditLog')).toBe(true);
  });

  it('classifies global models as NOT tenant-scoped', () => {
    expect(isTenantScoped('Organization')).toBe(false);
    expect(isTenantScoped('SystemConfig')).toBe(false);
    expect(isTenantScoped('CertificationStandard')).toBe(false);
    expect(isTenantScoped('PlantSpecies')).toBe(false);
  });
});

describe('tenant-prisma-extension — create injection', () => {
  // Helper: simulates how Prisma calls a query handler under an extension.
  // Returns the args that the inner `query` function would have received.
  async function callCreate({ model, args, ctx }) {
    let observedArgs;
    const queryStub = (a) => {
      observedArgs = a;
      return Promise.resolve({ ok: true });
    };
    const handler = tenantInjectExtension.query.$allModels.create;
    const run = () => handler({ model, args, query: queryStub });
    if (ctx) {
      await runWithTenantContext(ctx, run);
    } else {
      await run();
    }
    return observedArgs;
  }

  it('injects organizationId on tenant-scoped create when context is set', async () => {
    const args = await callCreate({
      model: 'Application',
      args: { data: { applicationNumber: 'APP-001' } },
      ctx: { organizationId: 'org-1' },
    });
    expect(args.data.organizationId).toBe('org-1');
  });

  it('does NOT inject when context is missing (script/migration path)', async () => {
    const args = await callCreate({
      model: 'Application',
      args: { data: { applicationNumber: 'APP-002' } },
      ctx: null,
    });
    expect(args.data.organizationId).toBeUndefined();
  });

  it('does NOT touch global models even when context is set', async () => {
    const args = await callCreate({
      model: 'SystemConfig',
      args: { data: { key: 'foo', value: 'bar' } },
      ctx: { organizationId: 'org-1' },
    });
    expect(args.data.organizationId).toBeUndefined();
  });

  it('preserves explicit matching organizationId', async () => {
    const args = await callCreate({
      model: 'Application',
      args: { data: { applicationNumber: 'APP-003', organizationId: 'org-1' } },
      ctx: { organizationId: 'org-1' },
    });
    expect(args.data.organizationId).toBe('org-1');
  });

  it('rejects cross-tenant write attempts', async () => {
    await expect(
      callCreate({
        model: 'Application',
        args: { data: { applicationNumber: 'APP-004', organizationId: 'org-OTHER' } },
        ctx: { organizationId: 'org-1' },
      }),
    ).rejects.toThrow(/Cross-tenant write blocked/);
  });
});

describe('tenant-prisma-extension — createMany injection', () => {
  async function callCreateMany({ model, args, ctx }) {
    let observedArgs;
    const queryStub = (a) => {
      observedArgs = a;
      return Promise.resolve({ count: 0 });
    };
    const handler = tenantInjectExtension.query.$allModels.createMany;
    const run = () => handler({ model, args, query: queryStub });
    if (ctx) {
      await runWithTenantContext(ctx, run);
    } else {
      await run();
    }
    return observedArgs;
  }

  it('injects on every record in the array', async () => {
    const args = await callCreateMany({
      model: 'CultivationLog',
      args: {
        data: [
          { logType: 'IRRIGATION' },
          { logType: 'FERTILIZER' },
          { logType: 'OBSERVATION' },
        ],
      },
      ctx: { organizationId: 'org-9' },
    });
    expect(args.data.every((r) => r.organizationId === 'org-9')).toBe(true);
  });
});
