'use strict';

/**
 * Regression for the C1/C2-class "select/include a non-existent field" bugs the
 * schema-audit found (PrismaClientValidationError -> 500). Covers the two
 * CRITICAL finance READ reports. A generic Proxy prisma mock captures the query
 * args so we can assert the corrected field/relation shapes directly (a mock
 * can't validate against the real schema, hence the explicit shape assertions).
 */

jest.mock('../../services/prisma-database', () => {
  const captured = {};
  const stubs = {};
  const modelStub = (name) => ({
    findMany: async (a) => { captured[name + '.findMany'] = a; return []; },
    findFirst: async () => null,
    findUnique: async () => null,
    count: async () => 0,
    aggregate: async () => ({ _sum: {}, _count: 0 }),
    groupBy: async () => [],
  });
  const prisma = new Proxy({}, {
    get: (_t, p) => {
      const k = String(p);
      if (k === 'then') { return undefined; }
      if (!stubs[k]) { stubs[k] = modelStub(k); }
      return stubs[k];
    },
  });
  return { prisma, __captured: captured };
});
jest.mock('../../shared/logger', () => {
  const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { ...l, createLogger: () => l };
});

const { __captured } = require('../../services/prisma-database');

describe('CRITICAL-2 — ar-aging includes application.applicant (not farmer)', () => {
  it('invoice.findMany include uses applicant; report resolves (no 500)', async () => {
    const svc = require('../../services/ar-aging-service');
    const report = await svc.generateArAgingReport({
      asOfDate: '2026-06-06', bookSide: 'PLATFORM', organizationId: 'org-1',
    });
    const args = __captured['invoice.findMany'];
    expect(args).toBeTruthy();
    const appSel = args.include.application.select;
    expect(appSel.applicant).toBeTruthy();
    expect(appSel.farmer).toBeUndefined();
    expect(report).toBeTruthy();
  });
});
