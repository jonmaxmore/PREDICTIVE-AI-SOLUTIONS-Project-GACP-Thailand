'use strict';

/**
 * Regression for the write-payload field-mismatch fixes (C1/C2-class in
 * create/update/where blocks). Captures the prisma args to assert the corrected
 * column names (a mock can't validate against the real schema). The CRITICAL
 * cert-issuance / admin-plant / reject-comment fixes are heavier route/tx paths
 * verified by schema + audit; this covers the service-level ones cheaply.
 */

const captured = {};
jest.mock('../../services/prisma-database', () => {
  const handler = (model) => new Proxy({}, {
    get: (_t, op) => async (args) => {
      captured[model + '.' + String(op)] = args;
      if (op === 'count') { return 0; }
      if (op === 'findMany') { return []; }
      if (op === 'findUnique' || op === 'findFirst') {
        return model === 'harvestBatch' ? { id: 'b1', status: 'GROWING', notes: 'n0' } : null;
      }
      return { id: 'x', ...(args && args.data ? args.data : {}) };
    },
  });
  const prisma = new Proxy({}, {
    get: (_t, m) => {
      const k = String(m);
      if (k === 'then') { return undefined; }
      // harvest-service writes inside an interactive transaction after a row lock
      if (k === '$transaction') { return async (fn) => fn(prisma); }
      if (k === '$queryRaw') { return async () => [{ id: 'b1' }]; }
      return handler(k);
    },
  });
  return { prisma };
});
jest.mock('../../shared/logger', () => {
  const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { ...l, createLogger: () => l };
});

beforeEach(() => { for (const k of Object.keys(captured)) { delete captured[k]; } });

describe('HIGH-1/2 — quote-service write payloads', () => {
  const quoteService = require('../../services/quote-service');

  it('markAcceptedWithInvoice does NOT write a (non-existent) invoiceId column', async () => {
    await quoteService.markAcceptedWithInvoice('q1', 'inv1');
    const data = captured['quote.update'].data;
    expect(data.status).toBeDefined();
    expect(data.acceptedAt).toBeInstanceOf(Date);
    expect(data.invoiceId).toBeUndefined();
  });

  it('markRejected writes `notes` (not the non-existent ApplicantNotes)', async () => {
    await quoteService.markRejected('q1', 'changed my mind');
    const data = captured['quote.update'].data;
    expect(data.notes).toBe('changed my mind');
    expect(data.ApplicantNotes).toBeUndefined();
  });
});

describe('MEDIUM — harvest-service.recordHarvest maps yield to freshWeight', () => {
  const harvestService = require('../../services/harvest-service');

  it('writes freshWeight (kg) and NOT actualYield/yieldUnit', async () => {
    await harvestService.recordHarvest('b1', { actualYield: '12.5', yieldUnit: 'kg', qualityGrade: 'A' });
    const data = captured['harvestBatch.update'].data;
    expect(data.freshWeight).toBe(12.5);
    expect(data.actualYield).toBeUndefined();
    expect(data.yieldUnit).toBeUndefined();
    expect(data.status).toBe('HARVESTED');
  });
});

describe('HIGH-5 — auditor-workload counts filter on auditorId (not assignedAuditorId)', () => {
  const { createApplicationProviderQueryMethods } = require('../../services/application-service/application-provider-query-methods');
  const where = {};
  const methods = createApplicationProviderQueryMethods({
    prisma: { application: { count: async (a) => { where.last = a.where; return 0; } } },
  });

  it('countAuditorCompletedAuditsSince uses auditorId', async () => {
    await methods.countAuditorCompletedAuditsSince('aud-1', new Date('2026-01-01'));
    expect(where.last.auditorId).toBe('aud-1');
    expect(where.last.assignedAuditorId).toBeUndefined();
  });
});
