/**
 * Provider domain (apps/backend/routes/api/provider/**) info-disclosure hardening.
 *
 * Proves that a thrown internal/Prisma error inside a provider route handler
 * surfaces as a 500 WITHOUT leaking the raw error.message (ORM/schema/path
 * detail), while the real cause is still logged server-side. Mirrors the
 * existing interoperability-error-sanitization.test.js contract.
 *
 * Also proves the new UUID-shape concern is moot for these routes: the
 * provider :id columns are String @default(uuid()) (not native @db.Uuid), so a
 * malformed id returns a clean 404, never a 500 — the tests assert no 5xx leak
 * regardless of the id value.
 */
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => ({
  authenticateProvider: (req, _res, next) => {
    req.user = { id: 'provider-1', role: 'system_admin_dtam', canonicalRole: 'system_admin_dtam', organizationId: 'org-1' };
    next();
  },
  requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../../shared/logger', () => {
  const stub = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
  return { ...stub, createLogger: () => stub };
});

// shared.js pulls in services/prisma-database, which process.exit(1)s when
// DATABASE_URL is unset. The route's only DB touchpoint is the (mocked)
// work-config-service, so a bare prisma stub is enough.
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

// The route reaches the work-config service (the only DB touchpoint); stub it
// so we can force a thrown internal error without a live database.
jest.mock('../../services/work-config-service', () => ({
  listStageConfigs: jest.fn(),
  listSlaPolicies: jest.fn(),
  createStageConfig: jest.fn(),
  updateStageConfig: jest.fn(),
  findStageConfigById: jest.fn(),
  deleteStageConfig: jest.fn(),
  updateSlaPolicy: jest.fn(),
  exportStageConfigs: jest.fn(),
  exportSlaPolicies: jest.fn(),
  bulkImportConfigs: jest.fn(),
}));

// audit-logger is only hit on success paths but is required at module load.
jest.mock('../../middleware/audit-logger', () => ({
  auditLogger: { log: jest.fn().mockResolvedValue(undefined) },
  AuditCategory: { ADMIN: 'ADMIN' },
  ResourceType: { SYSTEM: 'SYSTEM' },
  AuditSeverity: { INFO: 'INFO' },
}));

const logger = require('../../shared/logger');
const workConfigService = require('../../services/work-config-service');
const adminWorkConfigRouter = require('../../routes/api/provider/admin-work-config');

// Realistic Prisma-style error string that leaks schema/path/ORM internals.
const SENSITIVE_PRISMA_MESSAGE =
  'Invalid `prisma.stageActivityConfig.findUnique()` invocation in /app/services/work-config-service.js:42\n' +
  'PrismaClientKnownRequestError: \n' +
  'Foreign key constraint failed on the field: `StageActivityConfig_pkey`\n' +
  '    at Object.<anonymous> (/app/node_modules/@prisma/client/runtime/library.js:123:45)';

const SENSITIVE_SUBSTRINGS = [
  'prisma',
  'Prisma',
  'Foreign key constraint',
  'StageActivityConfig_pkey',
  'node_modules',
  'stageActivityConfig.findUnique',
  '/app/services/work-config-service.js',
];

function expectSanitized(body) {
  expect(body.success).toBe(false);
  const serialized = JSON.stringify(body);
  SENSITIVE_SUBSTRINGS.forEach((needle) => {
    expect(serialized).not.toContain(needle);
  });
}

describe('Provider admin/work-config 500 error response sanitization', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/provider/admin/work-config', adminWorkConfigRouter);
  });

  test('GET / does not leak the raw Prisma error message on an internal fault', async () => {
    workConfigService.listStageConfigs.mockRejectedValueOnce(new Error(SENSITIVE_PRISMA_MESSAGE));
    workConfigService.listSlaPolicies.mockResolvedValueOnce([]);

    const res = await request(app).get('/api/provider/admin/work-config/');

    expect(res.status).toBe(500);
    expectSanitized(res.body);
    // Real cause is still logged server-side for diagnostics.
    expect(logger.error).toHaveBeenCalled();
  });

  test('PUT /stage-configs/:id does not leak the raw Prisma error message', async () => {
    workConfigService.updateStageConfig.mockRejectedValueOnce(new Error(SENSITIVE_PRISMA_MESSAGE));

    const res = await request(app)
      .put('/api/provider/admin/work-config/stage-configs/not-a-uuid')
      .send({ labelTH: 'x' });

    // Not a clean 404 (service threw), but it must NOT leak internals.
    expect(res.status).toBe(500);
    expectSanitized(res.body);
    expect(logger.error).toHaveBeenCalled();
  });

  test('DELETE /stage-configs/:id with an unknown id returns a clean 404 (no 5xx, no leak)', async () => {
    // String @default(uuid()) id column: a malformed/unknown id does not throw —
    // findStageConfigById returns null → 404. Proves no malformed-uuid 500.
    workConfigService.findStageConfigById.mockResolvedValueOnce(null);

    const res = await request(app)
      .delete('/api/provider/admin/work-config/stage-configs/definitely-not-a-uuid');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expectSanitized(res.body);
  });

  test('validation errors (4xx) still pass their safe message through', async () => {
    // SLA hours validation throws "<field> must be ..." — a deliberate 400
    // contract that must keep flowing to the client unchanged.
    const res = await request(app)
      .put('/api/provider/admin/work-config/sla-policies/DOC_REVIEW')
      .send({ targetHours: 0 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(String(res.body.error)).toMatch(/must be/);
  });
});
