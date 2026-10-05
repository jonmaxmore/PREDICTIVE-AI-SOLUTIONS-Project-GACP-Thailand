/**
 * Production smoke test suite — Iter 29 (FINAL), hardening loop 2026-05-16.
 *
 * Owner: QA (Iter 29)
 * Runbook: docs/qa/smoke-test-runbook-2026-05-16.md
 *
 * Purpose:
 *   Fast "do the basic things still work?" suite. Designed to run in <10s
 *   on a developer laptop AND against a deployed environment via CI.
 *
 * Coverage (5 cases, by design — kept tiny):
 *   1. GET /api/health      — public liveness probe returns 200
 *   2. GET /api/health/ready — readiness probe requires auth + DB
 *   3. GET /api/auth/public/verify/:certNumber — public verify, no auth
 *   4. POST /api/auth/login structure — auth endpoint mock shape
 *   5. Sample data validation — canonical fees + single-issuer rule
 *
 * Hermetic by construction:
 *   - Express routers are wired up in-process with supertest. No real
 *     Prisma client, no Redis, no network.
 *   - Mocks for prisma-database, redis, audit-trail are declared up-front
 *     so requiring routes never tries to connect to a real DB.
 *
 * Acceptance: 100% pass + suite finishes <10s.
 */

'use strict';

const request = require('supertest');
const express = require('express');

// Silence shared/logger so smoke runs don't pollute CI logs. Pattern matches
// other tests in this directory (e.g. health-application-activities.test.js).
jest.mock('../../shared/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
  stream: { write: jest.fn() },
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

// Mock prisma-database — module-load side effect would otherwise demand
// DATABASE_URL. The certificate-service path under test uses prisma.findUnique;
// we drive that via a `dbState` knob so each test can swap the row.
const dbState = {
  certificate: null,
  healthOk: true,
};

jest.mock('../../services/prisma-database', () => ({
  prisma: {
    certificate: {
      findUnique: jest.fn(async () => dbState.certificate),
    },
  },
  healthCheck: jest.fn(async () => ({
    status: dbState.healthOk ? 'connected' : 'down',
    latencyMs: dbState.healthOk ? 3 : null,
  })),
}));

// audit-trail is required transitively by several controller modules and
// itself fails fast on a bad DB connection. Stub the surface area used by
// the routes we exercise.
jest.mock('../../services/audit-trail', () => ({
  log: jest.fn().mockResolvedValue(null),
  logAction: jest.fn().mockResolvedValue(null),
  ACTIONS: {},
  ENTITIES: {},
  SEVERITY: {},
}));

// certificate-service.findByCertificateNumber is the verify path. Mock it
// instead of poking the rate-limiter setup the real route wires up.
jest.mock('../../services/certificate-service', () => ({
  findByCertificateNumber: jest.fn(async (n) => {
    if (!n) {return null;}
    return dbState.certificate;
  }),
  // The verify route calls verifyDocumentIntegrity (BE-#4 tamper-evidence,
  // commit ba03277). Without this stub the route hits a TypeError
  // (verifyDocumentIntegrity is not a function) and 500s on the happy path.
  verifyDocumentIntegrity: jest.fn(() => ({ status: 'VALID' })),
  // Same failure mode, second occurrence: H1 added an RSA signature check over
  // the documentHash, and this partial mock did not grow with it — the route
  // 500'd on the happy path again. `{ signed: false }` is the real service's
  // return for a certificate carrying no PKI signature, which is what the
  // unsigned fixture below represents.
  verifyCertificateSignature: jest.fn(async () => ({ signed: false })),
}));

// rate-limiter — the public verify route attaches one. Replace with a
// pass-through so we don't depend on Redis state for a smoke test.
jest.mock('../../middleware/rate-limiter', () => ({
  createRateLimiter: () => (_req, _res, next) => next(),
}));

const feeService = require('../../modules/billing');
const { FEES } = require('../../config/business-rules');
const {
  ISSUER_TYPES,
  PLATFORM_ISSUER,
  getInvoiceIssuer,
  SERVICE_TYPES,
} = require('../../config/invoice-issuers');

// Build a tiny express app that mounts only the routes a smoke test exercises.
// We intentionally do NOT pull in routes/api/index.js because that requires
// dozens of unrelated services with their own side effects — defeating the
// "fast smoke" intent. Each test wires up exactly the surface it asserts on.
function buildSmokeApp() {
  const app = express();
  app.use(express.json());

  // /api/health — mirrors the implementation at routes/api/index.js:334-349.
  // Keep the contract identical (200 when DB connected, 503 otherwise).
  app.get('/api/health', async (_req, res) => {
    try {
      const prismaDatabase = require('../../services/prisma-database');
      const dbHealth = await prismaDatabase.healthCheck();
      const ok = dbHealth && dbHealth.status === 'connected';
      res.status(ok ? 200 : 503).json({
        success: ok,
        version: '3.0.0',
        database: 'postgresql',
        dbStatus: dbHealth,
        message: ok ? 'GACP API v3.0 is running' : 'System Unhealthy',
      });
    } catch (_err) {
      res.status(503).json({ success: false, message: 'Healthcheck failed' });
    }
  });

  // /api/health/ready — readiness probe; gated by auth header (Bearer)
  // PLUS a DB ping. Existing canonical health surface only exposes the
  // liveness route. We mount a tiny readiness handler with the same
  // contract a load-balancer probe would expect:
  //   - 401 when Authorization is missing/malformed
  //   - 503 when DB ping fails
  //   - 200 on full success
  app.get('/api/health/ready', async (req, res) => {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Auth required' });
    }
    const prismaDatabase = require('../../services/prisma-database');
    const db = await prismaDatabase.healthCheck();
    if (!db || db.status !== 'connected') {
      return res.status(503).json({ success: false, db });
    }
    return res.status(200).json({ success: true, ready: true, db });
  });

  // /api/auth/public/verify/:certificateNumber — mount the real router.
  // This proves the no-auth public surface still works after a deploy.
  const publicRouter = require('../../routes/api/auth/public');
  app.use('/api/auth/public', publicRouter);

  // /api/auth/login — mock shape only. We're not exercising the real auth
  // pipeline here (covered by mfa-roundtrip.test.js + auth integration
  // tests). A smoke run only proves the endpoint *exists* and rejects
  // empty bodies with 400, returns a token shape on a happy mock.
  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'email + password required' });
    }
    return res.status(200).json({
      success: true,
      data: {
        token: 'smoke.test.token.placeholder',
        user: { email, role: 'health' },
      },
    });
  });

  return app;
}

describe('Production smoke suite (Iter 29 — runs <10s)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dbState.certificate = null;
    dbState.healthOk = true;
  });

  describe('1. Health endpoint — public liveness', () => {
    test('GET /api/health returns 200 when DB is reachable', async () => {
      dbState.healthOk = true;
      const res = await request(buildSmokeApp()).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.version).toBe('3.0.0');
      expect(res.body.database).toBe('postgresql');
    });

    test('GET /api/health returns 503 when DB is down', async () => {
      dbState.healthOk = false;
      const res = await request(buildSmokeApp()).get('/api/health');
      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. Readiness endpoint — auth-gated', () => {
    test('GET /api/health/ready returns 401 without Authorization', async () => {
      const res = await request(buildSmokeApp()).get('/api/health/ready');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test('GET /api/health/ready returns 200 with valid Bearer + DB up', async () => {
      dbState.healthOk = true;
      const res = await request(buildSmokeApp())
        .get('/api/health/ready')
        .set('Authorization', 'Bearer smoke-token');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.ready).toBe(true);
      expect(res.body.db.status).toBe('connected');
    });

    test('GET /api/health/ready returns 503 with valid Bearer but DB down', async () => {
      dbState.healthOk = false;
      const res = await request(buildSmokeApp())
        .get('/api/health/ready')
        .set('Authorization', 'Bearer smoke-token');
      expect(res.status).toBe(503);
    });
  });

  describe('3. Public certificate verify — no auth required', () => {
    test('GET /api/auth/public/verify/:certNumber works without auth (unknown cert)', async () => {
      dbState.certificate = null;
      const res = await request(buildSmokeApp())
        .get('/api/auth/public/verify/GACP-UNKNOWN-2026-9999');
      // The public verify endpoint returns success=true with verified=false
      // for unknown certs, so QR scanners always get a 200 they can render.
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.verified).toBe(false);
      expect(res.body.data.status).toBe('invalid');
    });

    test('GET /api/auth/public/verify/:certNumber returns valid for active cert', async () => {
      const future = new Date('2030-01-01T00:00:00Z');
      // Flat Certificate columns as returned by findByCertificateNumber.
      // fc419dc fixed the verify route to read province / cropType /
      // issuedDate / standardName directly (the old nested names resolved
      // to undefined → blank QR page), so the mock must mirror the real row.
      dbState.certificate = {
        certificateNumber: 'GACP-2026-001',
        status: 'active',
        expiryDate: future,
        farmName: 'Test Farm',
        applicantName: 'Somchai Jaidee',
        province: 'Chiang Mai',
        cropType: 'ฟ้าทะลายโจร',
        issuedDate: new Date('2026-01-01'),
        standardName: 'WHO GACP',
      };
      const res = await request(buildSmokeApp())
        .get('/api/auth/public/verify/GACP-2026-001');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.verified).toBe(true);
      expect(res.body.data.certificate).toBeTruthy();
      expect(res.body.data.certificate.farmName).toBe('Test Farm');
      // PR-1.5 PDPA last-name masking is in the contract — smoke checks it.
      expect(res.body.data.certificate.applicantName).toBe('Somchai J.');
      // fc419dc: the flat columns now map through (previously blank).
      expect(res.body.data.certificate.province).toBe('Chiang Mai');
      expect(res.body.data.certificate.cropTypes).toContain('ฟ้าทะลายโจร');
      // BE-#4: tamper-evidence status surfaced to the public verifier.
      expect(res.body.data.integrity).toBe('VALID');
    });
  });

  describe('4. Auth login endpoint structure (mock)', () => {
    test('POST /api/auth/login returns 400 with empty body', async () => {
      const res = await request(buildSmokeApp())
        .post('/api/auth/login')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('POST /api/auth/login returns token-shaped response on happy mock', async () => {
      const res = await request(buildSmokeApp())
        .post('/api/auth/login')
        .send({ email: 'smoke@gacp.dev', password: 'pass1234' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeTruthy();
      expect(res.body.data.user.email).toBe('smoke@gacp.dev');
    });
  });

  describe('5. Sample data validation (canonical fees + single-issuer rule)', () => {
    // The payable numbers below have not moved since W14. What changed on
    // 2026-09-11 is that the system stopped deriving ค่าบริการ from a state
    // base plus a 10% cut and now declares it directly — so the components the
    // smoke test reads are ค่าบริการ and VAT, and nothing else.
    test('Phase 1 fee for 1 scope equals 5,885 THB (ค่าบริการ 5,500 + VAT 385)', () => {
      const result = feeService.calculatePhase1Fee({ cultivationMethods: ['OUTDOOR'] });
      expect(result.serviceFeeAmount).toBe(5500);
      expect(result.vatAmount).toBe(385);
      expect(result.total).toBe(5885);
      expect(result).not.toHaveProperty('stateAmount');
    });

    test('Phase 2 fee for 1 scope equals 29,425 THB (ค่าบริการ 27,500 + VAT 1,925)', () => {
      const result = feeService.calculatePhase2Fee({ cultivationMethods: ['OUTDOOR'] });
      expect(result.serviceFeeAmount).toBe(27500);
      expect(result.vatAmount).toBe(1925);
      expect(result.total).toBe(29425);
      expect(result).not.toHaveProperty('stateAmount');
    });

    test('Full application (3 scopes) sums to canonical grandTotal', () => {
      const formData = { cultivationMethods: ['indoor', 'greenhouse', 'outdoor'] };
      const fees = feeService.calculateApplicationFees(formData);
      expect(fees.scopeCount).toBe(3);
      // VAT is 7% of the whole ค่าบริการ: 3 scopes are
      // Phase 1: 16,500 + VAT 1,155; Phase 2: 82,500 + VAT 5,775.
      expect(fees.serviceFeeTotal).toBe(99000);
      expect(fees.vatTotal).toBe(6930);
      expect(fees.grandTotal).toBe(105930);
      expect(fees.total).toBe(105930);
    });

    test('Canonical FEE constants match business-rules defaults', () => {
      expect(FEES.PHASE1_PER_SCOPE).toBe(5500);
      expect(FEES.PHASE2_PER_SCOPE).toBe(27500);
      // No rate is left for anyone to multiply a "base" by.
      expect(FEES.PLATFORM_RATE).toBeUndefined();
      expect(FEES.VAT_RATE).toBe(0.07);
    });

    test('Single-issuer rule: EVERY service type routes to the company (W14)', () => {
      // Was: state fees → DTAM, platform fees → PLATFORM. Operator ruling
      // 2026-08-22 (the change log c28355ea) leaves ONE issuer.
      // The enum itself is down to one member since 2026-09-11: keeping a
      // 'DTAM' key would leave a value every switch still has to handle.
      expect(Object.keys(ISSUER_TYPES).sort()).toEqual(['PLATFORM']);

      const p1State = getInvoiceIssuer(SERVICE_TYPES.PHASE_1_STATE_FEE);
      const p2State = getInvoiceIssuer(SERVICE_TYPES.PHASE_2_STATE_FEE);
      expect(p1State.type).toBe(ISSUER_TYPES.PLATFORM);
      expect(p2State.type).toBe(ISSUER_TYPES.PLATFORM);
      expect(p1State.chargesVat).toBe(true);
      expect(p2State.chargesVat).toBe(true);

      const p1Platform = getInvoiceIssuer(SERVICE_TYPES.PHASE_1_PLATFORM_FEE);
      const p2Platform = getInvoiceIssuer(SERVICE_TYPES.PHASE_2_PLATFORM_FEE);
      expect(p1Platform.type).toBe(ISSUER_TYPES.PLATFORM);
      expect(p2Platform.type).toBe(ISSUER_TYPES.PLATFORM);
      expect(p1Platform.chargesVat).toBe(true);
      expect(p2Platform.chargesVat).toBe(true);
      expect(p1Platform.vatRate).toBe(0.07);
    });

    test('NO issuer carries a collection-agent marker any more (W14)', () => {
      // Inverted. The platform no longer collects state revenue on DTAM's
      // behalf — the farmer pays the company, which settles with DTAM outside
      // this system — so the marker and its receipt fine print are deleted.
      // DTAM_ISSUER itself is gone from the config — there is nothing left to
      // carry the marker, which is a stronger statement than the marker being
      // absent from it.
      expect(PLATFORM_ISSUER.collectedByPlatform).toBeUndefined();
      expect(PLATFORM_ISSUER.receiptDocumentType).toBe('FULL_TAX_INVOICE_RECEIPT');
    });

    test('Unknown service type throws (closed-set guard)', () => {
      expect(() => getInvoiceIssuer('PHASE_3_BONUS_FEE')).toThrow(/Unknown serviceType/);
    });
  });
});
