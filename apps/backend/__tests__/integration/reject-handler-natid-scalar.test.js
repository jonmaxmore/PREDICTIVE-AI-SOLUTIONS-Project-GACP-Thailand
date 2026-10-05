/**
 * PDPA close-natid-ROUND-6 — PATCH /:id/reject stamps the User UUID (req.user.id)
 * into EVERY scalar audit column it writes, NEVER req.user.providerId (the
 * DECRYPTED plaintext provider national ID):
 *   - applications.updatedBy        (via writeApplicationStatus actorId + override)
 *   - application_comments.authorId
 *   - revision_deadlines.createdBy / updatedBy
 *
 * Drives the REAL reject route; Prisma + auth are mocked (no DB). The fixture's
 * req.user.providerId is a plaintext 13-digit ID and req.user.id is a UUID, so
 * we can prove the scalar columns receive the UUID, not the 13-digit ID.
 */

const express = require('express');
const request = require('supertest');

const PLAINTEXT_PROVIDER_ID = '1112223334445';
const USER_UUID = 'provider-user-uuid-1';

// jest hoists jest.mock above imports, so the factory may only reference
// `mock`-prefixed module-scope vars. Capture the scalar writes here.
const mockCaptured = { comment: null, deadlineCreate: null, deadlineUpdate: null };

jest.mock('../../middleware/auth-middleware', () => ({
  authenticateAny: (req, _res, next) => {
    req.user = { id: 'provider-user-uuid-1', providerId: '1112223334445', canonicalRole: 'DOCUMENT_REVIEWER', role: 'DOCUMENT_REVIEWER' };
    next();
  },
  authenticateProvider: (req, _res, next) => {
    req.user = { id: 'provider-user-uuid-1', providerId: '1112223334445', canonicalRole: 'DOCUMENT_REVIEWER', role: 'DOCUMENT_REVIEWER' };
    next();
  },
}));

jest.mock('../../services/application-status-writer', () => ({
  writeApplicationStatus: jest.fn(async () => ({})),
}));

// R2 M2 (D-8): the reject handler now mints the official correction letter
// inside the same tx as the status write, via decision-letter-service. The
// letter's own behaviour (atomicity, content, recipient resolution) is pinned
// in __tests__/unit/atomic-decision-letter.test.js — here it is stubbed so this
// suite keeps pinning ONLY its scalar-PII contract.
jest.mock('../../services/decision-letter-service', () => ({
  mintCorrectionLetter: jest.fn(async () => ({ id: 'letter-1' })),
  CORRECTION_LETTER_STAGE: { DOC_REVIEW: 'DOC_REVIEW', FIELD_AUDIT_CAR: 'FIELD_AUDIT_CAR' },
}));

// Blocker F: the handler now uses the Thai-holiday-aware utils/working-days
// (2-arg signature, no holiday Set) instead of services/working-days-service.
jest.mock('../../utils/working-days', () => ({
  addWorkingDays: (d) => new Date(d.getTime() + 5 * 24 * 3600 * 1000),
}));

jest.mock('../../services/prisma-database', () => {
  const tx = {
    application: { findUnique: jest.fn(async () => ({ id: 'app-1', applicationNumber: 'GACP-1', status: 'REVISION_REQUESTED' })) },
    applicationComment: { create: jest.fn(async (args) => { mockCaptured.comment = args.data; return {}; }) },
    revisionDeadline: {
      findUnique: jest.fn(async () => null),
      upsert: jest.fn(async (args) => { mockCaptured.deadlineCreate = args.create; mockCaptured.deadlineUpdate = args.update; return {}; }),
    },
  };
  return {
    prisma: {
      application: { findFirst: jest.fn(async () => ({ id: 'app-1', applicationNumber: 'GACP-1', status: 'ASSIGNED_FOR_REVIEW', formData: {}, workflowHistory: [] })) },
      $transaction: jest.fn(async (cb) => cb(tx)),
    },
  };
});

const { writeApplicationStatus } = require('../../services/application-status-writer');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/applications', require('../../routes/api/applications/application-workflow-handlers'));
  return app;
}

describe('PATCH /:id/reject — scalar audit columns get the User UUID, not the plaintext providerId', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    mockCaptured.comment = null;
    mockCaptured.deadlineCreate = null;
    mockCaptured.deadlineUpdate = null;
    app = buildApp();
  });

  it('stamps req.user.id (UUID) into applications.updatedBy, application_comments.authorId, revision_deadlines.{createdBy,updatedBy}', async () => {
    const res = await request(app)
      .patch('/api/applications/app-1/reject')
      .send({ comment: 'please fix section 3', type: 'DOC_REVISION' });

    expect(res.status).toBe(200);

    // writeApplicationStatus.actorId → scalar applications.updatedBy.
    expect(writeApplicationStatus).toHaveBeenCalledTimes(1);
    const writerArgs = writeApplicationStatus.mock.calls[0][0];
    expect(writerArgs.actorId).toBe(USER_UUID);
    expect(writerArgs.actorId).not.toBe(PLAINTEXT_PROVIDER_ID);
    // The explicit scalar override too.
    expect(writerArgs.additionalData.updatedBy).toBe(USER_UUID);
    expect(writerArgs.additionalData.updatedBy).not.toBe(PLAINTEXT_PROVIDER_ID);

    // application_comments.authorId scalar.
    expect(mockCaptured.comment).toBeTruthy();
    expect(mockCaptured.comment.authorId).toBe(USER_UUID);
    expect(mockCaptured.comment.authorId).not.toBe(PLAINTEXT_PROVIDER_ID);

    // revision_deadlines.{createdBy,updatedBy} scalars.
    expect(mockCaptured.deadlineCreate.createdBy).toBe(USER_UUID);
    expect(mockCaptured.deadlineCreate.updatedBy).toBe(USER_UUID);
    expect(mockCaptured.deadlineUpdate.updatedBy).toBe(USER_UUID);
    expect(mockCaptured.deadlineCreate.createdBy).not.toBe(PLAINTEXT_PROVIDER_ID);

    // The encrypted JSON workflowHistory MAY keep the providerId (value-net +
    // hook encrypted) — that is acceptable and not asserted away here.
    const lastEvent = writerArgs.additionalData.workflowHistory.slice(-1)[0];
    expect(lastEvent).toBeTruthy();
  });
});
