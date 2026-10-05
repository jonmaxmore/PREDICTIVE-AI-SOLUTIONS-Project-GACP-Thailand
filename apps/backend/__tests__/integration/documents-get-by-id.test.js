/**
 * BUG B — GET /api/documents/:id (single document detail).
 *
 * The health /documents/[id] viewer called GET /documents/:id which did NOT
 * exist (only GET / + POST /verify) → 404 → the FE fell back to HARDCODED mock
 * metadata + iframed a 404 URL. This adds the real, owner-scoped route.
 *
 * A "document" here is a draftDocuments[] entry embedded in Application.formData
 * (same model the list route flattens), scoped by healthId. Ownership is
 * enforced by only ever reading the caller's own applications, so a cross-owner
 * id is simply absent → 404 (anti-IDOR, no scope invented).
 */

const mockLogger = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
jest.mock('../../shared/logger', () => {
  const logger = { ...mockLogger, stream: { write: jest.fn() } };
  logger.createLogger = jest.fn(() => ({ ...mockLogger }));
  return logger;
});

jest.mock('../../services/prisma-database', () => ({
  prisma: { $queryRaw: jest.fn() },
}));

jest.mock('../../middleware/upload-middleware', () => ({
  single: jest.fn(() => (req, _res, next) => { req.file = null; next(); }),
  array: jest.fn(() => (_req, _res, next) => next()),
}));

// The route reads draft documents via document-service; mock its boundary.
// findApplicantDraftDocument is the owner-scoped lookup the route calls.
const mockFindDoc = jest.fn();
jest.mock('../../services/document-service', () => ({
  findApplicantDraftDocument: (...args) => mockFindDoc(...args),
}));

jest.mock('../../middleware/auth-middleware', () => ({
  authenticateHealth: (req, _res, next) => {
    // healthId = decrypted PLAINTEXT national ID; canonicalId = the live FK
    // key (keyed-HMAC token post-STAGE-A). Only the latter may reach queries.
    req.user = { id: 'user-1', userId: 'user-1', healthId: 'plain-9876543210987', canonicalId: 'fk-token-1', role: 'HEALTH' };
    next();
  },
}));

const request = require('supertest');
const express = require('express');
const documentsRouter = require('../../routes/api/documents/documents');

describe('GET /api/documents/:id (BUG B — owner-scoped document detail)', () => {
  let app;
  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/documents', documentsRouter);
  });
  afterEach(() => jest.clearAllMocks());

  // The shape findApplicantDraftDocument returns for an owned draft document.
  const ownedDoc = {
    id: 'doc-777',
    fileName: 'sop.pdf',
    fileUrl: '/uploads/application-drafts/sop.pdf',
    documentType: 'farm_info',
    mimeType: 'application/pdf',
    size: 1024,
    applicationId: 'app-1',
    applicationNumber: 'GACP-001',
    uploadedAt: '2026-07-01T00:00:00.000Z',
  };

  it('returns the real document metadata for an owned document (200)', async () => {
    mockFindDoc.mockResolvedValue(ownedDoc);
    const res = await request(app).get('/api/documents/doc-777');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: 'doc-777',
      fileName: 'sop.pdf',
      fileUrl: '/uploads/application-drafts/sop.pdf',
      applicationId: 'app-1',
    });
    // scoped by the caller's own identity + the requested id (anti-IDOR).
    // STAGE-A token contract: the scope carries the User.id UUID (never
    // re-keyed) and the FK token — NEVER the plaintext national ID.
    expect(mockFindDoc).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      'doc-777',
    );
    expect(JSON.stringify(mockFindDoc.mock.calls)).not.toContain('plain-9876543210987');
    // must NOT return the hardcoded mock the FE used to fabricate
    expect(JSON.stringify(res.body)).not.toContain('app_12345');
  });

  it('404 when the id is not in any of the caller\'s own documents (cross-owner / nonexistent)', async () => {
    mockFindDoc.mockResolvedValue(null);
    const res = await request(app).get('/api/documents/doc-does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('404 when the caller owns no applications at all', async () => {
    mockFindDoc.mockResolvedValue(null);
    const res = await request(app).get('/api/documents/doc-777');
    expect(res.status).toBe(404);
  });

  it('does not leak plaintext PII beyond the list route fields', async () => {
    mockFindDoc.mockResolvedValue(ownedDoc);
    const res = await request(app).get('/api/documents/doc-777');
    const keys = Object.keys(res.body.data).sort();
    // no healthId, no formData dump
    expect(keys).not.toContain('healthId');
    expect(keys).not.toContain('formData');
  });
});
