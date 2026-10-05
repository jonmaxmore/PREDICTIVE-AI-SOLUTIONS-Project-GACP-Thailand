/**
 * Unit tests for soft-delete auto-filter Prisma extension.
 * No DB needed — exercises the AsyncLocalStorage scope and the extension's
 * pure where-injection logic via stubbed `query` functions.
 */

const {
  getSoftDeleteContext,
  withDeletedRows,
} = require('../services/soft-delete-context');

const {
  softDeleteFilterExtension,
  hasSoftDelete,
} = require('../services/soft-delete-extension');

describe('soft-delete-context service', () => {
  it('returns null by default', () => {
    expect(getSoftDeleteContext()).toBeNull();
  });

  it('binds includeDeleted=true for the duration of withDeletedRows', () => {
    withDeletedRows(() => {
      expect(getSoftDeleteContext()).toEqual({ includeDeleted: true });
    });
    expect(getSoftDeleteContext()).toBeNull();
  });

  it('preserves includeDeleted across async boundaries', async () => {
    await withDeletedRows(async () => {
      await Promise.resolve();
      expect(getSoftDeleteContext()).toEqual({ includeDeleted: true });
      await new Promise((resolve) => setImmediate(resolve));
      expect(getSoftDeleteContext()).toEqual({ includeDeleted: true });
    });
  });
});

describe('soft-delete-extension — model classification', () => {
  it('classifies soft-delete-aware models', () => {
    expect(hasSoftDelete('Application')).toBe(true);
    expect(hasSoftDelete('Invoice')).toBe(true);   // เดิมเป็น Subscription ซึ่งถูกปลดระวาง 2026-09-11
    expect(hasSoftDelete('AuditChecklist')).toBe(true);
    expect(hasSoftDelete('ConsumerFeedback')).toBe(true);
  });

  it('classifies non-soft-delete models', () => {
    expect(hasSoftDelete('Notification')).toBe(false);
    expect(hasSoftDelete('AuditLog')).toBe(false);
    expect(hasSoftDelete('Organization')).toBe(false);
    expect(hasSoftDelete('SystemConfig')).toBe(false);
    // WorkActivity uses state='CANCELLED' instead of isDeleted
    expect(hasSoftDelete('WorkActivity')).toBe(false);
  });
});

describe('soft-delete-extension — findMany filter injection', () => {
  async function callFindMany({ model, args, withCtx }) {
    let observed;
    const queryStub = (a) => {
      observed = a;
      return Promise.resolve([]);
    };
    const handler = softDeleteFilterExtension.query.$allModels.findMany;
    const run = () => handler({ model, args, query: queryStub });
    if (withCtx) {
      await withDeletedRows(run);
    } else {
      await run();
    }
    return observed;
  }

  it('injects isDeleted=false when caller did not specify it', async () => {
    const args = await callFindMany({
      model: 'Application',
      args: { where: { status: 'DRAFT' } },
    });
    expect(args.where).toEqual({ status: 'DRAFT', isDeleted: false });
  });

  it('handles undefined where cleanly', async () => {
    const args = await callFindMany({
      model: 'Application',
      args: {},
    });
    expect(args.where).toEqual({ isDeleted: false });
  });

  it('handles undefined args cleanly', async () => {
    const args = await callFindMany({
      model: 'Application',
      args: undefined,
    });
    expect(args.where).toEqual({ isDeleted: false });
  });

  it('preserves explicit where.isDeleted=true (find tombstones)', async () => {
    const args = await callFindMany({
      model: 'Application',
      args: { where: { isDeleted: true } },
    });
    expect(args.where).toEqual({ isDeleted: true });
  });

  it('preserves explicit where.isDeleted with object operator', async () => {
    const args = await callFindMany({
      model: 'Application',
      args: { where: { isDeleted: { in: [true, false] } } },
    });
    expect(args.where).toEqual({ isDeleted: { in: [true, false] } });
  });

  it('does not touch models without an isDeleted column', async () => {
    const args = await callFindMany({
      model: 'WorkActivity',
      args: { where: { state: 'TODO' } },
    });
    expect(args.where).toEqual({ state: 'TODO' });
  });

  it('does not inject inside withDeletedRows', async () => {
    const args = await callFindMany({
      model: 'Application',
      args: { where: { status: 'APPROVED' } },
      withCtx: true,
    });
    expect(args.where).toEqual({ status: 'APPROVED' });
  });
});

describe('soft-delete-extension — count + updateMany', () => {
  async function callCount(args) {
    let observed;
    const queryStub = (a) => {
      observed = a;
      return Promise.resolve(0);
    };
    await softDeleteFilterExtension.query.$allModels.count({
      model: 'Application',
      args,
      query: queryStub,
    });
    return observed;
  }

  async function callUpdateMany(args) {
    let observed;
    const queryStub = (a) => {
      observed = a;
      return Promise.resolve({ count: 0 });
    };
    await softDeleteFilterExtension.query.$allModels.updateMany({
      model: 'Application',
      args,
      query: queryStub,
    });
    return observed;
  }

  it('count: filters tombstones by default', async () => {
    const args = await callCount({ where: { status: 'DRAFT' } });
    expect(args.where).toEqual({ status: 'DRAFT', isDeleted: false });
  });

  it('updateMany: filters tombstones so bulk updates skip them', async () => {
    const args = await callUpdateMany({
      where: { status: 'DRAFT' },
      data: { status: 'REGISTERED' },
    });
    expect(args.where).toEqual({ status: 'DRAFT', isDeleted: false });
    expect(args.data).toEqual({ status: 'REGISTERED' });
  });

  it('updateMany: explicit isDeleted=true lets a restore happen', async () => {
    // Pattern for restoring a tombstoned row in bulk:
    //   updateMany({ where: { id: ..., isDeleted: true }, data: { isDeleted: false } })
    const args = await callUpdateMany({
      where: { id: 'x', isDeleted: true },
      data: { isDeleted: false },
    });
    expect(args.where).toEqual({ id: 'x', isDeleted: true });
  });
});
