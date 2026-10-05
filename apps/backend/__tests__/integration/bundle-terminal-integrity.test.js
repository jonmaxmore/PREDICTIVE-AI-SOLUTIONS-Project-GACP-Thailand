/**
 * R1a — terminal-integrity guard for application-bundles.
 *
 * Q3 resurrection hole: an applicant (authenticateHealth) could take one of
 * their OWN terminal applications (REJECTED / CERTIFIED / EXPIRED /
 * CANCEL_EXPIRED) and:
 *   (1) link it into a bundle (create `/` or add `/:id/applications`), then
 *   (2) submit the bundle (`/:id/submit`), whose loop called
 *       writeApplicationStatus({ toStatus: 'SUBMITTED' }) with NO
 *       assertTransition — resurrecting a finished case back to SUBMITTED.
 *
 * These tests drive the REAL application-bundles router (Prisma + auth mocked,
 * no DB) and assert the request is REJECTED with BUNDLE_TERMINAL_APPLICATION
 * (409) and that NO status/link write happens. Defence-in-depth: both the
 * link-time and the submit-time gate are exercised.
 *
 * The terminal set is imported from the canonical writer (requireActual) — the
 * test never re-lists state names (SSOT: application-status-writer.js).
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => ({
  authenticateHealth: (req, _res, next) => {
    req.user = { id: 'user-1', healthId: 'health-1', canonicalId: 'health-1' };
    next();
  },
}));

// M1 PR-C — the bundle submit door now asks the central guard about EVERY
// linked case before it opens a transaction. The engine primitive and the
// audit writer are mocked with their real shapes so this suite keeps measuring
// the terminal-integrity gate and nothing else (plan D5/D10).
jest.mock('../../services/entity-effective-permissions-service', () => ({
  assertEntityActionPermission: jest.fn(async () => ({ allowed: true, via: 'ENTITY_PERMISSION' })),
}));
jest.mock('../../middleware/audit-logger', () => {
  const actual = jest.requireActual('../../middleware/audit-logger');
  return {
    ...actual,
    auditLogger: {
      log: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      logWithin: jest.fn(() => jest.fn()),
    },
  };
});

// M2a — and now it asks the document law about every linked case too. It reads
// entity / requirementRule / applicationDocument, which the prisma stub below
// does not carry, so it is stubbed to "nothing is missing" for the same reason
// the guard above is: this suite measures the terminal-integrity gate. The law
// itself is proven in __tests__/unit/m2a-doc-requirements{,-doors}.test.js.
jest.mock('../../services/application-document-requirements', () => {
  const actual = jest.requireActual('../../services/application-document-requirements');
  return {
    ...actual,
    assertRequiredDocumentsPresent: jest.fn(async () => ({ appliedRules: [] })),
  };
});

jest.mock('../../services/application-status-writer', () => {
  const actual = jest.requireActual('../../services/application-status-writer');
  return {
    writeApplicationStatus: jest.fn(async () => ({})),
    // Keep the real terminal set so the router-under-test and the test agree
    // on the single source of truth without re-declaring state names here.
    TERMINAL_STATUSES: actual.TERMINAL_STATUSES,
  };
});

// A0 / PR-A0-2: the submit route now flips the bundle and walks every linked
// case inside one `prisma.$transaction`, so the stub needs the entry point. The
// callback runs against this same object, which keeps every assertion below
// (including `applicationBundle.update` NOT being called on a rejected submit)
// pointing at the mocks it already pointed at.
jest.mock('../../services/prisma-database', () => {
  const prisma = {
    applicationBundle: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    application: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  prisma.$transaction = jest.fn(async (fn) => fn(prisma));
  return { prisma };
});

const { prisma: prismaMock } = require('../../services/prisma-database');
const { writeApplicationStatus, TERMINAL_STATUSES } = require('../../services/application-status-writer');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/applications/bundles', require('../../routes/api/applications/application-bundles'));
  return app;
}

const BUNDLE = '11111111-1111-4111-8111-111111111111';
const TERMINAL = [...TERMINAL_STATUSES];

describe('R1a — application-bundles terminal-integrity (no resurrection)', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  // ── submit-time gate (the resurrection the writer loop performed) ──────────
  describe('POST /:id/submit — must not resurrect a linked terminal case', () => {
    test.each(TERMINAL)('linked %s case is rejected, not pushed to SUBMITTED', async (state) => {
      prismaMock.applicationBundle.findFirst.mockResolvedValue({
        id: BUNDLE,
        status: 'DRAFT',
        applications: [{ id: 'app-term', status: state }],
      });
      prismaMock.applicationBundle.update.mockResolvedValue({
        id: BUNDLE, status: 'SUBMITTED', applications: [],
      });

      const r = await request(app).post(`/api/applications/bundles/${BUNDLE}/submit`).send({});

      expect(r.status).toBe(409);
      expect(r.body.code).toBe('BUNDLE_TERMINAL_APPLICATION');
      // No resurrection: neither the bundle status nor the app status is written.
      expect(writeApplicationStatus).not.toHaveBeenCalled();
      expect(prismaMock.applicationBundle.update).not.toHaveBeenCalled();
    });

    test('non-terminal (DRAFT) linked case still submits (regression pin)', async () => {
      prismaMock.applicationBundle.findFirst.mockResolvedValue({
        id: BUNDLE,
        // M1 PR-C: a linked case carries `entityId` now — the submit guard
        // refuses a case that names no entity (plan D7), so the fixture of a
        // case that IS allowed to submit must name one.
        applications: [{ id: 'app-ok', status: 'DRAFT', entityId: 'ent-ok' }],
        status: 'DRAFT',
      });
      prismaMock.applicationBundle.update.mockResolvedValue({
        id: BUNDLE, status: 'SUBMITTED', applications: [],
      });

      const r = await request(app).post(`/api/applications/bundles/${BUNDLE}/submit`).send({});

      expect(r.status).toBe(200);
      expect(writeApplicationStatus).toHaveBeenCalledTimes(1);
    });
  });

  // ── link-time gate: create bundle with a terminal case in the id list ──────
  describe('POST / — must not link a terminal case into a new bundle', () => {
    test.each(TERMINAL)('creating a bundle around a %s case is rejected, no DB write', async (state) => {
      prismaMock.application.findMany.mockResolvedValue([{ id: 'app-term', status: state }]);
      prismaMock.applicationBundle.create.mockResolvedValue({ id: BUNDLE, status: 'DRAFT' });
      prismaMock.application.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.applicationBundle.findFirst.mockResolvedValue({ id: BUNDLE, status: 'DRAFT', applications: [] });

      const r = await request(app)
        .post('/api/applications/bundles/')
        .send({ applications: ['app-term'] });

      expect(r.status).toBe(409);
      expect(r.body.code).toBe('BUNDLE_TERMINAL_APPLICATION');
      expect(prismaMock.applicationBundle.create).not.toHaveBeenCalled();
      expect(prismaMock.application.updateMany).not.toHaveBeenCalled();
    });
  });

  // ── link-time gate: add a terminal case to an existing draft bundle ────────
  describe('POST /:id/applications — must not add a terminal case', () => {
    test.each(TERMINAL)('adding a %s case to a bundle is rejected, no link write', async (state) => {
      prismaMock.applicationBundle.findFirst.mockResolvedValue({
        id: BUNDLE, status: 'DRAFT', applications: [],
      });
      prismaMock.application.findFirst.mockResolvedValue({
        id: 'app-term', status: state, healthId: 'health-1', bundleId: null,
      });
      prismaMock.application.update.mockResolvedValue({ id: 'app-term', bundleId: BUNDLE });

      const r = await request(app)
        .post(`/api/applications/bundles/${BUNDLE}/applications`)
        .send({ applicationId: 'app-term' });

      expect(r.status).toBe(409);
      expect(r.body.code).toBe('BUNDLE_TERMINAL_APPLICATION');
      expect(prismaMock.application.update).not.toHaveBeenCalled();
    });
  });
});
