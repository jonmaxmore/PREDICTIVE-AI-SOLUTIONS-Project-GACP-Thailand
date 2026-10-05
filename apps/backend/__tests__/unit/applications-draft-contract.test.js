const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
  const passHealthUser = (req, _res, next) => {
    req.user = {
      id: 'user-1',
      healthId: 'health-1',
      canonicalRole: 'health',
      role: 'HEALTH_USER',
    };
    next();
  };

  return {
    authenticateHealth: passHealthUser,
    authenticateAny: passHealthUser,
  };
});

jest.mock('../../services/application-service', () => ({
  resolveHealthIdentity: jest.fn(),
  deleteDraft: jest.fn(),
  // Batch 11 (2026-05-16) — applications.js now calls these service
  // methods instead of reaching into prisma.* directly. The shape of
  // each mock mirrors the previously-mocked prisma method one-to-one
  // so the test assertions only swap the target.
  findApplicationByIdForHealth: jest.fn(),
  findLatestOpenDraftForHealth: jest.fn(),
  healDraftEntityColumns: jest.fn(),
  createDraftForHealth: jest.fn(),
  updateApplicantDraftColumns: jest.fn(),
  findDraftForSubmit: jest.fn(),
  getApplicationSlice: jest.fn(),
  findUserOrganizationId: jest.fn(),
  getApplicantReadinessSnapshot: jest.fn(),
  getLatestOpenDraftForApplicant: jest.fn(),
}));
// R2 Task 8: the caller's holder scope (editIds) — the draft door checks it.
jest.mock('../../services/holder-access', () => ({
    ...jest.requireActual('../../services/holder-access'),
    holderScope: jest.fn(async () => ({ userId: 'user-1', readIds: ['entity-1'], editIds: ['entity-1'] })),
}));

jest.mock('../../services/prisma-database', () => ({
  prisma: {},
}));

jest.mock('../../services/storage-service', () => ({
  createUploader: jest.fn(() => ({
    single: jest.fn(() => (_req, _res, next) => next()),
  })),
}));

jest.mock('../../shared/logger', () => {
  const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  // Tier 18: receipt-numbering-service uses { createLogger } destructure
  // so the mock must expose createLogger as a factory.
  return { ...mockLogger, createLogger: jest.fn(() => mockLogger) };
});
jest.mock('../../services/notification-service', () => ({
  createNotification: jest.fn().mockResolvedValue(null),
  createBulkNotifications: jest.fn().mockResolvedValue({ count: 0 }),
}));


jest.mock('../../shared/workflow-event-builder', () => ({
  buildWorkflowEvent: jest.fn((event) => ({
    ...event,
    id: 'workflow-event-1',
    createdAt: '2026-04-21T00:00:00.000Z',
  })),
}));

jest.mock('../../routes/api/helpers/applications-helpers', () => ({
  getHealthScopeOptions: jest.fn((user) => ({
    healthId: user.healthId,
    strictHealthScope: true,
  })),
}));

jest.mock('../../routes/api/helpers/application-constants', () => ({
  MASTER_STEPS: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  asObject: (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {}),
  asArray: (value) => (Array.isArray(value) ? value : []),
  upper: (value) => String(value || '').toUpperCase(),
  ensureApplicationNumber: jest.fn(() => 'APP-TEST-001'),
  mergeMasterSteps: jest.fn((formData, payload) => ({
    ...((formData && formData.steps) || {}),
    ...((payload && payload.steps) || {}),
  })),
  validateMasterSubmission: jest.fn(() => ({ isValid: true, missingByStep: {} })),
  // F-G4-14 — the REAL allowlist, not a stand-in. What POST /draft is allowed
  // to write out of `payload.formData` is a security decision; a mock of it
  // here would let this contract suite stay green over a door that had been
  // widened. Behaviour of the list itself is pinned in
  // applications-draft-formdata-allowlist.test.js.
  pickWizardOwnedFormData: jest.requireActual('../../routes/api/helpers/application-constants').pickWizardOwnedFormData,
}));

jest.mock('../../routes/api/preview/preview-utils', () => ({
  normalizeDocuments: jest.fn(() => []),
  summarizeCompletion: jest.fn(() => ({ isComplete: true, missingFields: [] })),
}));

jest.mock('../../validation/application-schemas', () => ({
  validateStep: jest.fn(() => ({ success: true, errors: [] })),
  validateAllSteps: jest.fn(() => ({ isValid: true, errorsByStep: {} })),
}));

jest.mock('../../routes/api/applications/application-listing-handlers', () => {
  const router = require('express').Router();
  return router;
});

jest.mock('../../routes/api/applications/application-workflow-handlers', () => {
  const router = require('express').Router();
  return router;
});

const applicationService = require('../../services/application-service');
const applicationsRouter = require('../../routes/api/applications/applications');

// R2 Task 8 (spec 2026-09-30 §3.2): a draft write without an id names its holder;
// the caller edits for entity-1 (the resume path finds the mocked draft).
const named = (body) => ({ entityId: 'entity-1', ...body });

function makeDraft(overrides = {}) {
  const now = new Date('2026-04-21T00:00:00.000Z');
  return {
    id: 'draft-1',
    applicationNumber: 'APP-2026-000001',
    status: 'DRAFT',
    serviceType: 'new_application',
    areaType: 'OUTDOOR',
    formData: {
      steps: {
        '1': { plantId: 'cannabis' },
      },
      certificationPurposes: ['EXPORT'],
    },
    workflowHistory: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('Applications draft API contract', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/applications', applicationsRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    applicationService.resolveHealthIdentity.mockResolvedValue({
      userId: 'user-1',
      healthId: 'health-1',
    });
  });

  it('POST /draft returns the canonical id alongside draftId, and no `_id`', async () => {
    const existingDraft = makeDraft();
    const updatedDraft = makeDraft({
      formData: {
        ...existingDraft.formData,
        lastDraftSavedAt: '2026-04-21T00:00:00.000Z',
      },
    });

    // findOrCreateApplicationForHealth: no requestedId -> goes to
    // findLatestOpenDraftForHealth which returns the existing draft.
    applicationService.findApplicationByIdForHealth.mockResolvedValue(null);
    applicationService.findLatestOpenDraftForHealth.mockResolvedValue(existingDraft);
    applicationService.updateApplicantDraftColumns.mockResolvedValue(updatedDraft);

    const response = await request(app)
      .post('/api/applications/draft')
      .send(named({
        serviceType: 'new_application',
        areaType: 'OUTDOOR',
        step: 1,
        steps: {
          '1': { plantId: 'cannabis' },
        },
      }));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.draftId).toBe('draft-1');
    expect(response.body.data.id).toBe('draft-1');
    expect(response.body.data.applicationNumber).toBe('APP-2026-000001');
    expect(response.body.data).not.toHaveProperty('syncVersion');
    expect(response.body.data).not.toHaveProperty('etag');
  });

  it('POST /draft does NOT wipe saved certificationPurposes when the request sends an empty array (Bug 8.2)', async () => {
    // The saved draft has certificationPurposes: ['EXPORT']. A draft-save
    // from a step that does not touch purposes may send an empty [] — that must
    // NOT overwrite the saved selection (the old `Array.isArray(payload.x)`
    // check treated [] as "provided" and preferred it, wiping the value).
    const existingDraft = makeDraft();
    applicationService.findApplicationByIdForHealth.mockResolvedValue(null);
    applicationService.findLatestOpenDraftForHealth.mockResolvedValue(existingDraft);
    applicationService.updateApplicantDraftColumns.mockResolvedValue(existingDraft);

    const response = await request(app)
      .post('/api/applications/draft')
      .send(named({
        serviceType: 'new_application',
        areaType: 'OUTDOOR',
        step: 1,
        certificationPurposes: [], // empty — must be ignored in favour of the saved value
      }));

    expect(response.status).toBe(200);
    const savedArg = applicationService.updateApplicantDraftColumns.mock.calls[0][1];
    expect(savedArg.certificationPurposes).toEqual(['EXPORT']);
    expect(savedArg.formData.certificationPurposes).toEqual(['EXPORT']);
  });

  it('POST /draft DOES apply a non-empty certificationPurposes from the request', async () => {
    const existingDraft = makeDraft();
    applicationService.findApplicationByIdForHealth.mockResolvedValue(null);
    applicationService.findLatestOpenDraftForHealth.mockResolvedValue(existingDraft);
    applicationService.updateApplicantDraftColumns.mockResolvedValue(existingDraft);

    await request(app)
      .post('/api/applications/draft')
      .send(named({ serviceType: 'new_application', areaType: 'OUTDOOR', certificationPurposes: ['EXPORT', 'RESEARCH'] }));

    const savedArg = applicationService.updateApplicantDraftColumns.mock.calls[0][1];
    expect(savedArg.certificationPurposes).toEqual(['EXPORT', 'RESEARCH']);
  });

  it('GET /draft returns the canonical id alongside draftId for the latest draft', async () => {
    applicationService.getLatestOpenDraftForApplicant.mockResolvedValue(makeDraft());

    const response = await request(app).get('/api/applications/draft');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.draftId).toBe('draft-1');
    expect(response.body.data.id).toBe('draft-1');
    expect(response.body.data.status).toBe('DRAFT');
    // Spec 2026-09-30 §3.1: the caller's holder scope, not the filer's healthId.
    expect(applicationService.getLatestOpenDraftForApplicant).toHaveBeenCalledWith({
      holderScope: expect.objectContaining({ userId: expect.any(String), readIds: expect.any(Array) }),
      // R2 Task 8 (spec §3.2 resume): only the caller's own draft, on a holder it may edit.
      submitterId: 'user-1',
      editIds: ['entity-1'],
    });
  });

  it('GET /draft carries the holder (entityId) of the resumed draft - R2 task 15 fix 1', async () => {
    applicationService.getLatestOpenDraftForApplicant.mockResolvedValue({ ...makeDraft(), entityId: 'entity-1' });

    const response = await request(app).get('/api/applications/draft');

    expect(response.status).toBe(200);
    expect(response.body.data.entityId).toBe('entity-1');
  });

  it('GET /draft returns success with null data when no draft exists', async () => {
    applicationService.getLatestOpenDraftForApplicant.mockResolvedValue(null);

    const response = await request(app).get('/api/applications/draft');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: null });
  });

  it('DELETE /draft/:id delegates to health-scoped soft delete and reports deletion', async () => {
    applicationService.deleteDraft.mockResolvedValue({ id: 'draft-1' });

    const response = await request(app).delete('/api/applications/draft/draft-1');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({ deleted: true, draftId: 'draft-1' });
    expect(applicationService.deleteDraft).toHaveBeenCalledWith(
      'user-1',
      'draft-1',
      expect.objectContaining({
        healthId: 'health-1',
        strictHealthScope: true,
      }),
    );
  });

  it('DELETE /draft/:id reports deleted false when draft is missing or not owned', async () => {
    applicationService.deleteDraft.mockResolvedValue(null);

    const response = await request(app).delete('/api/applications/draft/not-owned');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({ deleted: false, draftId: 'not-owned' });
  });
});
