const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => ({
  authenticateProvider: (req, _res, next) => {
    req.user = { id: 'provider-1', role: 'ADMIN', canonicalRole: 'ADMIN' };
    next();
  },
}));

jest.mock('../../services/prisma-database', () => ({
  prisma: {
    certificate: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    plantingCycle: { findFirst: jest.fn() },
    harvestBatch: { findFirst: jest.fn() },
    lot: { findFirst: jest.fn() },
    // No `plantUnit` delegate: the interoperability resolver stopped resolving a
    // PLANT_UNIT entity on 2026-08-25 (R8 of design notes
    // 2026-08-20-planting-tnt-design.md retires per-plant tracking). A re-added
    // branch fails loudly here instead of reading a mocked null.
    traceQrSecurity: { findFirst: jest.fn() },
  },
}));

jest.mock('../../services/crypto/signature-service', () => ({
  getSignatureService: jest.fn(() => ({
    sign: jest.fn().mockResolvedValue('mock-signature'),
    verify: jest.fn().mockResolvedValue(true),
    getPublicKey: jest.fn().mockResolvedValue('mock-public-key'),
  })),
}));

jest.mock('../../shared/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
}));

// SEC-AUDIT-012: bulk/export interoperability endpoints now require a partner API key.
process.env.INTEROP_PARTNER_API_KEYS = JSON.stringify({ 'test-partner': 'test-partner-key' });

const { prisma } = require('../../services/prisma-database');
const logger = require('../../shared/logger');
require('../../middleware/partner-api-key').requirePartnerApiKey._reload();
const interoperabilityRouter = require('../../routes/api/integration/interoperability');

describe('Interoperability 500 error response sanitization', () => {
  let app;

  // Realistic Prisma-style error string that leaks schema details.
  const SENSITIVE_PRISMA_MESSAGE =
    'Invalid `prisma.certificate.findFirst()` invocation in /app/services/prisma-database.js:42\n' +
    'PrismaClientKnownRequestError: \n' +
    'Foreign key constraint failed on the field: `Certificate_userId_fkey (index)`\n' +
    '    at Object.<anonymous> (/app/node_modules/@prisma/client/runtime/library.js:123:45)';

  const SENSITIVE_SUBSTRINGS = [
    'prisma',
    'Prisma',
    'Foreign key constraint',
    'Certificate_userId_fkey',
    'node_modules',
    'prisma.certificate.findFirst',
    '/app/services/prisma-database.js',
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/integration', interoperabilityRouter);
  });

  function expectSanitized(body) {
    expect(body.success).toBe(false);
    expect(typeof body.message).toBe('string');
    const serialized = JSON.stringify(body);
    SENSITIVE_SUBSTRINGS.forEach((needle) => {
      expect(serialized).not.toContain(needle);
    });
  }

  test('GET trust registry route does not leak raw Prisma error message', async () => {
    prisma.certificate.findMany.mockRejectedValueOnce(new Error(SENSITIVE_PRISMA_MESSAGE));

    const res = await request(app)
      .get('/api/integration/v1/trust/registry')
      .set('x-api-key', 'test-partner-key');

    expect(res.status).toBe(500);
    expectSanitized(res.body);
    expect(logger.error).toHaveBeenCalled();
  });

  test('GET revocation feed route does not leak raw Prisma error message', async () => {
    prisma.certificate.findMany.mockRejectedValueOnce(new Error(SENSITIVE_PRISMA_MESSAGE));

    const res = await request(app)
      .get('/api/integration/v1/trust/revocations')
      .set('x-api-key', 'test-partner-key');

    expect(res.status).toBe(500);
    expectSanitized(res.body);
    expect(logger.error).toHaveBeenCalled();
  });

  test('GET query verification route does not leak raw Prisma error message', async () => {
    prisma.certificate.findFirst.mockRejectedValueOnce(new Error(SENSITIVE_PRISMA_MESSAGE));

    const res = await request(app).get('/api/integration/v1/verification?certificateNumber=CERT-LEAK');

    expect(res.status).toBe(500);
    expectSanitized(res.body);
    expect(logger.error).toHaveBeenCalled();
  });

  test('safeErrorMessage allowlist preserves known-safe messages (e.g. "not found")', async () => {
    // A safe phrase like "not found" should pass through unchanged
    // (used elsewhere in the code; this asserts we did not break that contract).
    const { safeErrorMessage } = require('../../shared/api-response');
    expect(safeErrorMessage(new Error('Certificate not found'), 'fallback')).toBe('Certificate not found');
    expect(safeErrorMessage(new Error(SENSITIVE_PRISMA_MESSAGE), 'fallback')).toBe('fallback');
  });
});
