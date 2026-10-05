/**
 * PDPA close-natid-ROUND-6 — application_bundles.healthId is an FK to
 * users.canonicalId, so it must be keyed on the canonicalId TOKEN, NEVER the
 * plaintext national ID. normalizeHealthId(req) feeds BOTH the
 * applicationBundle.create write AND every GET read filter (where:{healthId}),
 * so this guard asserts write + read both use the TOKEN and stay consistent.
 *
 * Flag-agnostic: the test fixture's req.user.healthId is a PLAINTEXT 13-digit
 * ID and req.user.canonicalId is the TOKEN — we assert the value that reaches
 * Prisma is the token, never the plaintext.
 */

const express = require('express');
const request = require('supertest');

// req.user.healthId = DECRYPTED plaintext national ID (the leak source).
// req.user.canonicalId = the re-key TOKEN (the FK-safe value).
const PLAINTEXT_NATIONAL_ID = '1234567890123';
const CANONICAL_TOKEN = 'hmac-token-abcdef';

jest.mock('../../middleware/auth-middleware', () => ({
  authenticateHealth: (req, _res, next) => {
    req.user = { id: 'user-uuid-1', healthId: '1234567890123', canonicalId: 'hmac-token-abcdef' };
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

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/applications/bundles', require('../../routes/api/applications/application-bundles'));
  return app;
}

describe('application-bundles — healthId FK uses the canonicalId TOKEN, not the plaintext national ID', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it('GET /my read filter uses the TOKEN (where.healthId === canonicalId)', async () => {
    prismaMock.applicationBundle.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/applications/bundles/my');
    expect(res.status).toBe(200);

    expect(prismaMock.applicationBundle.findMany).toHaveBeenCalledTimes(1);
    const where = prismaMock.applicationBundle.findMany.mock.calls[0][0].where;
    expect(where.healthId).toBe(CANONICAL_TOKEN);
    expect(where.healthId).not.toBe(PLAINTEXT_NATIONAL_ID);
  });

  it('POST / write stamps the TOKEN into applicationBundle.create data.healthId', async () => {
    prismaMock.applicationBundle.create.mockResolvedValue({ id: 'bundle-1', healthId: CANONICAL_TOKEN, status: 'DRAFT' });
    // getOwnedBundle re-hydrate after create.
    prismaMock.applicationBundle.findFirst.mockResolvedValue({ id: 'bundle-1', healthId: CANONICAL_TOKEN, status: 'DRAFT', applications: [] });

    const res = await request(app).post('/api/applications/bundles').send({});
    expect(res.status).toBe(200);

    expect(prismaMock.applicationBundle.create).toHaveBeenCalledTimes(1);
    const data = prismaMock.applicationBundle.create.mock.calls[0][0].data;
    expect(data.healthId).toBe(CANONICAL_TOKEN);
    expect(data.healthId).not.toBe(PLAINTEXT_NATIONAL_ID);

    // CONSISTENCY: the post-create re-hydrate read uses the SAME token key.
    const hydrateWhere = prismaMock.applicationBundle.findFirst.mock.calls[0][0].where;
    expect(hydrateWhere.healthId).toBe(CANONICAL_TOKEN);
  });

  it('GET /:id read filter uses the TOKEN', async () => {
    prismaMock.applicationBundle.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/applications/bundles/bundle-xyz');
    expect(res.status).toBe(404); // not found, but the WHERE is what we assert

    const where = prismaMock.applicationBundle.findFirst.mock.calls[0][0].where;
    expect(where.healthId).toBe(CANONICAL_TOKEN);
    expect(where.healthId).not.toBe(PLAINTEXT_NATIONAL_ID);
  });
});
