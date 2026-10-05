const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => ({
  authenticateProvider: (req, _res, next) => {
    const role = String(req.headers['x-test-role'] || 'REVIEWER');
    req.user = {
      id: String(req.headers['x-test-user-id'] || 'provider-1'),
      role,
      canonicalRole: role,
      // 1.2: org-guard needs the caller org. Forwarded from a test header so
      // the cross-tenant-block case can be exercised end-to-end.
      organizationId: req.headers['x-test-org'] ? String(req.headers['x-test-org']) : undefined,
    };
    next();
  },
}));

jest.mock('../../services/prisma-database', () => ({
  prisma: {
    certificate: {
      findFirst: jest.fn(),
      // 1.2: the revoke route now delegates to certificateService.revokeCertificate,
      // which resolves the cert via findUnique(certificateNumber) first, then
      // findFirst(id). Mock added so the resolution succeeds under the new path.
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    plantingCycle: {
      findFirst: jest.fn(),
    },
    harvestBatch: {
      findFirst: jest.fn(),
    },
    lot: {
      findFirst: jest.fn(),
    },
    // No `plantUnit` delegate: interoperability-resolve stopped resolving a
    // PLANT_UNIT entity on 2026-08-25 (spec R8). If a resolver branch is ever
    // re-added, it fails loudly here rather than reading a mocked null.
    traceQrSecurity: {
      findFirst: jest.fn(),
    },
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
require('../../middleware/partner-api-key').requirePartnerApiKey._reload();
const interoperabilityRouter = require('../../routes/api/integration/interoperability');

describe('Interoperability Track + Trust Layer API', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/interoperability', interoperabilityRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();

    prisma.certificate.findFirst.mockResolvedValue({
      id: 'cert-id-1',
      uuid: 'cert-uuid-1',
      certificateNumber: 'CERT-2026-0001',
      status: 'ACTIVE',
      issuedDate: new Date('2026-01-10T00:00:00.000Z'),
      expiryDate: new Date('2028-01-10T00:00:00.000Z'),
      revokedAt: null,
      revokedReason: null,
      revokedBy: null,
      userId: 'health-1',
      farmId: 'farm-1',
      farmName: 'Farm Alpha',
      applicantName: 'HEALTH_USER One',
      province: 'Chiang Mai',
      district: 'Mueang',
      standardCode: 'THAI_GACP',
      standardName: 'GACP',
      verificationCount: 2,
      lastVerifiedAt: new Date('2026-02-01T00:00:00.000Z'),
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      application: null,
    });

    // 1.2: revoke resolves via findUnique(certificateNumber). Return the same
    // cert carries organizationId 'org-1' so the service's org-guard (SF-1) has
    // something to compare against: a same-tenant admin must send x-test-org=org-1
    // (allowed), a different org or none → 404 (fail-closed).
    prisma.certificate.findUnique.mockResolvedValue({
      id: 'cert-id-1',
      certificateNumber: 'CERT-2026-0001',
      status: 'ACTIVE',
      organizationId: 'org-1',
      isDeleted: false,
    });

    prisma.certificate.findMany.mockResolvedValue([
      {
        certificateNumber: 'CERT-2026-0002',
        status: 'REVOKED',
        revokedAt: new Date('2026-02-01T00:00:00.000Z'),
        revokedReason: 'REGULATORY_DECISION',
        revokedBy: 'provider-2',
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        farmName: 'Farm Beta',
        province: 'Bangkok',
        district: 'Sai Mai',
        isDeleted: false,
      },
    ]);

    prisma.certificate.update.mockResolvedValue({
      certificateNumber: 'CERT-2026-0001',
      status: 'REVOKED',
      revokedAt: new Date('2026-02-03T00:00:00.000Z'),
      revokedReason: 'TEST',
    });

    prisma.traceQrSecurity.findFirst.mockResolvedValue({
      createdAt: new Date('2026-01-11T00:00:00.000Z'),
      qrCode: 'QR-CERT-1',
      publicUrl: 'https://example.com/trace/QR-CERT-1',
      keyFingerprint: 'fingerprint-1',
      signature: 'qr-signature',
      scans: [
        {
          createdAt: new Date('2026-01-12T00:00:00.000Z'),
          requestIp: '127.0.0.1',
          requestPath: '/trace/QR-CERT-1',
          verified: true,
        },
      ],
    });

    prisma.plantingCycle.findFirst.mockResolvedValue(null);
    prisma.harvestBatch.findFirst.mockResolvedValue(null);
    prisma.lot.findFirst.mockResolvedValue(null);
  });

  it('returns national traceability schema contract', async () => {
    const response = await request(app).get('/api/interoperability/v1/data-contracts/traceability');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.schemaVersion).toBe('DTAM_TRACEABILITY_SCHEMA_1.0.0');
  });

  it('verifies certificate via external query endpoint', async () => {
    const response = await request(app)
      .get('/api/interoperability/v1/verification')
      .query({ certificateNumber: 'CERT-2026-0001' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.valid).toBe(true);
    expect(response.body.trustStatus).toBe('ACTIVE');
  });

  it('returns revocation transparency feed', async () => {
    const response = await request(app)
      .get('/api/interoperability/v1/trust/revocations?limit=10')
      .set('x-api-key', 'test-partner-key');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.contract.feedType).toBe('REVOCATION_TRANSPARENCY');
    expect(response.body.data.length).toBe(1);
  });

  it('verifies signed payload hash', async () => {
    const response = await request(app)
      .post('/api/interoperability/v1/signatures/verify')
      .send({
        payload: { certificateNumber: 'CERT-2026-0001' },
        signature: 'test-signature',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.valid).toBe(true);
  });

  it('blocks certificate revocation without admin role', async () => {
    const response = await request(app)
      .post('/api/interoperability/v1/certificates/CERT-2026-0001/revoke')
      .set('x-test-role', 'REVIEWER')
      .send({ reason: 'TEST' });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(prisma.certificate.update).not.toHaveBeenCalled();
  });

  it('allows certificate revocation for a SAME-TENANT admin (org matches)', async () => {
    const response = await request(app)
      .post('/api/interoperability/v1/certificates/CERT-2026-0001/revoke')
      .set('x-test-role', 'system_admin_dtam')
      .set('x-test-user-id', 'admin-1')
      .set('x-test-org', 'org-1') // SF-1: same-tenant admin (cert is org-1) → allowed
      .send({ reason: 'TEST' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    // MF-1: revoked cert stays visible and reports REVOKED (not soft-deleted / not-found).
    expect(response.body.data.trustStatus).toBe('REVOKED');
    expect(prisma.certificate.update).toHaveBeenCalledTimes(1);
    // MF-1: the revoke must NOT soft-delete the row.
    expect(prisma.certificate.update.mock.calls[0][0].data.isDeleted).not.toBe(true);
  });

  it('1.2: blocks a tenant ADMIN from revoking ANOTHER tenant\'s cert (404, no update)', async () => {
    // The resolved cert lives in org-1; this ADMIN belongs to org-2 and is NOT
    // PLATFORM_ADMIN → the org-guard returns the same 404 as a missing cert.
    const response = await request(app)
      .post('/api/interoperability/v1/certificates/CERT-2026-0001/revoke')
      .set('x-test-role', 'system_admin_dtam')
      .set('x-test-user-id', 'admin-2')
      .set('x-test-org', 'org-2')
      .send({ reason: 'cross-tenant attempt' });

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(prisma.certificate.update).not.toHaveBeenCalled();
  });

  it('1.2: same-tenant ADMIN CAN revoke its own org\'s cert', async () => {
    const response = await request(app)
      .post('/api/interoperability/v1/certificates/CERT-2026-0001/revoke')
      .set('x-test-role', 'system_admin_dtam')
      .set('x-test-user-id', 'admin-1')
      .set('x-test-org', 'org-1')
      .send({ reason: 'legit same-tenant revoke' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(prisma.certificate.update).toHaveBeenCalledTimes(1);
  });

  it('returns trace events aligned to event contract', async () => {
    const response = await request(app)
      .get('/api/interoperability/v1/trace/events/CERTIFICATE/CERT-2026-0001')
      .set('x-api-key', 'test-partner-key');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.contractVersion).toBe('DTAM_TRACE_EVENT_CONTRACT_1.0.0');
    expect(response.body.data.events.length).toBeGreaterThanOrEqual(2);
    expect(response.body.data.events[0]).toEqual(expect.objectContaining({
      eventType: 'CERTIFICATE_ISSUED',
      entityType: 'CERTIFICATE',
    }));
  });
});
