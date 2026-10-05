/**
 * BE-EDGE-01 regression guard — application-bundles bad-input → 4xx (not 500).
 *
 * Promoted from the hardening re-verify (the hardening findings). Drives the
 * REAL application-bundles router with the bad-input scenarios from the carpet
 * sweep; Prisma + auth are mocked (no DB, no prod). Two prisma behaviours per
 * route: (A) findFirst returns null → handler not-found guard → 404;
 * (B) findFirst THROWS a Prisma error (PrismaClientValidationError / P2023) →
 * the catch now routes through the shared `respondError` (#314) which maps it to
 * 4xx instead of a blanket 500. This guard fails loudly if a future edit
 * reverts a catch to a bare `res.status(500)`.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => ({
  authenticateHealth: (req, _res, next) => {
    req.user = { id: 'user-1', healthId: 'health-1', canonicalId: 'health-1' };
    next();
  },
}));

jest.mock('../../services/application-status-writer', () => ({
  writeApplicationStatus: jest.fn(async () => ({})),
}));

jest.mock('../../services/prisma-database', () => ({
  prisma: {
    applicationBundle: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    application: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));
const { prisma: prismaMock } = require('../../services/prisma-database');

function makePrismaValidationError() {
  const e = new Error(
    'Invalid `prisma.applicationBundle.findFirst()` invocation: Argument id: Got invalid value',
  );
  e.name = 'PrismaClientValidationError';
  return e;
}
function makeP2023() {
  const e = new Error('Inconsistent column data: Error creating UUID, malformed id');
  e.name = 'PrismaClientKnownRequestError';
  e.code = 'P2023';
  return e;
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/applications/bundles', require('../../routes/api/applications/application-bundles'));
  return app;
}

const BOGUS = '00000000-0000-0000-0000-000000000000';
const MALFORMED = 'not-a-uuid';

describe('BE-EDGE-01 — application-bundles bad input maps to 4xx (not 500)', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  describe('findFirst returns null (well-formed-but-absent id) → 404', () => {
    test('GET /:id bogus id', async () => {
      prismaMock.applicationBundle.findFirst.mockResolvedValue(null);
      expect((await request(app).get(`/api/applications/bundles/${BOGUS}`)).status).toBe(404);
    });
    test('DELETE /:id bogus id', async () => {
      prismaMock.applicationBundle.findFirst.mockResolvedValue(null);
      expect((await request(app).delete(`/api/applications/bundles/${BOGUS}`)).status).toBe(404);
    });
    test('POST /:id/submit bogus id', async () => {
      prismaMock.applicationBundle.findFirst.mockResolvedValue(null);
      expect((await request(app).post(`/api/applications/bundles/${BOGUS}/submit`).send({})).status).toBe(404);
    });
    test('POST /:id/applications bogus bundle id (after body validation)', async () => {
      prismaMock.applicationBundle.findFirst.mockResolvedValue(null);
      const r = await request(app)
        .post(`/api/applications/bundles/${BOGUS}/applications`)
        .send({ applicationId: 'app-x' });
      expect(r.status).toBe(404);
    });
    test('DELETE /:id/applications/:appId bogus ids', async () => {
      prismaMock.applicationBundle.findFirst.mockResolvedValue(null);
      const r = await request(app).delete(`/api/applications/bundles/${BOGUS}/applications/${BOGUS}`);
      expect(r.status).toBe(404);
    });
  });

  describe('missing fields / bad types caught BEFORE prisma → 400', () => {
    test('POST /:id/applications missing applicationId (no prisma call)', async () => {
      const r = await request(app).post(`/api/applications/bundles/${BOGUS}/applications`).send({});
      expect(r.status).toBe(400);
      expect(prismaMock.applicationBundle.findFirst).not.toHaveBeenCalled();
    });
    test('POST /:id/applications bad-typed applicationId (no prisma call)', async () => {
      const r = await request(app)
        .post(`/api/applications/bundles/${BOGUS}/applications`)
        .send({ applicationId: 12345 });
      expect(r.status).toBe(400);
      expect(prismaMock.applicationBundle.findFirst).not.toHaveBeenCalled();
    });
    test('POST / bad bundleType (no prisma create)', async () => {
      const r = await request(app).post('/api/applications/bundles/').send({ bundleType: 'GARBAGE' });
      expect(r.status).toBe(400);
      expect(prismaMock.applicationBundle.create).not.toHaveBeenCalled();
    });
  });

  describe('prisma THROWS on the lookup → 4xx via respondError (was a 500 leak)', () => {
    test('GET /:id PrismaClientValidationError → 400', async () => {
      prismaMock.applicationBundle.findFirst.mockRejectedValue(makePrismaValidationError());
      expect((await request(app).get(`/api/applications/bundles/${MALFORMED}`)).status).toBe(400);
    });
    test('GET /:id P2023 malformed UUID → 400', async () => {
      prismaMock.applicationBundle.findFirst.mockRejectedValue(makeP2023());
      expect((await request(app).get(`/api/applications/bundles/${MALFORMED}`)).status).toBe(400);
    });
    test('DELETE /:id P2023 → 400', async () => {
      prismaMock.applicationBundle.findFirst.mockRejectedValue(makeP2023());
      expect((await request(app).delete(`/api/applications/bundles/${MALFORMED}`)).status).toBe(400);
    });
    test('POST /:id/applications P2023 on bundle lookup → 400', async () => {
      prismaMock.applicationBundle.findFirst.mockRejectedValue(makeP2023());
      const r = await request(app)
        .post(`/api/applications/bundles/${MALFORMED}/applications`)
        .send({ applicationId: 'app-x' });
      expect(r.status).toBe(400);
    });
    test('POST /:id/submit P2023 → 400', async () => {
      prismaMock.applicationBundle.findFirst.mockRejectedValue(makeP2023());
      expect((await request(app).post(`/api/applications/bundles/${MALFORMED}/submit`).send({})).status).toBe(400);
    });
  });
});
