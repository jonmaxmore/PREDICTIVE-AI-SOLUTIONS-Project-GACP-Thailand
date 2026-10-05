/**
 * Canonical Application.phase1Amount / phase2Amount semantics.
 *
 * Contract: every writer of these columns must persist the FULL phase total
 * (state + platform + VAT) — i.e. `feeService.calculatePhaseNFee().total`.
 *
 * This test exercises the four primary writers and asserts they all converge
 * on `fees.phase{1,2}.total`. The numeric value depends on the active fee-
 * service shape (state-only on origin/main, full-total after the P0 fix to
 * fee-service.js), so we assert SEMANTIC equivalence (`=== fees.phase1.total`)
 * rather than a hardcoded number.
 */

// The submission/draft/review modules eagerly require ../audit-trail, which in
// turn requires ../prisma-database — and that module fails fast on missing
// DATABASE_URL. Stub both so this test can run without a Docker DB.
jest.mock('../../services/prisma-database', () => ({
  prisma: {},
  default: {},
}));
jest.mock('../../services/audit-trail', () => ({
  log: jest.fn().mockResolvedValue(null),
  logAction: jest.fn().mockResolvedValue(null),
  ACTIONS: { APPROVE: 'APPROVE', REJECT: 'REJECT', REVISION: 'REVISION' },
  ENTITIES: { APPLICATION: 'APPLICATION' },
  SEVERITY: { INFO: 'INFO', WARNING: 'WARNING', CRITICAL: 'CRITICAL' },
  AuditCategory: {},
  AuditSeverity: {},
  ResourceType: {},
}));

const feeService = require('../../services/fee-service');

describe('Application.phase1Amount / phase2Amount canonical writer semantics', () => {
  const formData = {
    cultivationMethods: ['indoor', 'greenhouse', 'outdoor'],
    plots: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }],
  };

  // The expected canonical value the writer should persist.
  const expectedFees = feeService.calculateApplicationFees(formData);
  const EXPECTED_PHASE1 = expectedFees.phase1.total;
  const EXPECTED_PHASE2 = expectedFees.phase2.total;

  describe('writer: application-submission-methods.executeWizardSubmission', () => {
    let mockPrisma;
    let methods;

    beforeEach(() => {
      const captured = { applicationCreate: null };
      mockPrisma = {
        $transaction: jest.fn(async (fn) => fn({
          user: { update: jest.fn().mockResolvedValue(null) },
          farm: { create: jest.fn().mockResolvedValue({ id: 'farm-1' }) },
          plot: {
            create: jest.fn().mockResolvedValue(null),
            createMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          application: {
            create: jest.fn(async (args) => {
              captured.applicationCreate = args.data;
              return { id: 'app-1', ...args.data };
            }),
          },
          applicationDraft: { deleteMany: jest.fn().mockResolvedValue(null) },
        })),
      };
      mockPrisma.__captured = captured;
      const { createApplicationSubmissionMethods } = require('../../services/application-service/application-submission-methods');
      methods = createApplicationSubmissionMethods({
        prisma: mockPrisma,
        feeService,
        logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });
    });

    it('persists phase1Amount/phase2Amount as the full phase total (state + platform + VAT)', async () => {
      await methods.executeWizardSubmission('user-1', 'health-1', {
        applicantData: { firstName: 'A', lastName: 'B' },
        farmData: { farmName: 'F', totalAreaSize: 1, gpsLat: 0, gpsLng: 0 },
        plots: [{ name: 'p', areaSize: 1 }],
        documents: [],
        locationType: 'OUTDOOR',
        cultivationMethods: ['indoor', 'greenhouse', 'outdoor'],
      });
      const data = mockPrisma.__captured.applicationCreate;
      expect(data).toBeTruthy();
      expect(data.phase1Amount).toBe(EXPECTED_PHASE1);
      expect(data.phase2Amount).toBe(EXPECTED_PHASE2);
    });
  });

  describe('writer: application-draft-query-methods.saveDraft', () => {
    let mockPrisma;
    let methods;

    beforeEach(() => {
      const captured = { applicationCreate: null };
      mockPrisma = {
        application: {
          findFirst: jest.fn().mockResolvedValue(null),
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn(async (args) => {
            captured.applicationCreate = args.data;
            return { id: 'app-1', ...args.data };
          }),
          update: jest.fn(),
        },
      };
      mockPrisma.__captured = captured;
      const { createApplicationDraftQueryMethods } = require('../../services/application-service/application-draft-query-methods');
      methods = createApplicationDraftQueryMethods({
        prisma: mockPrisma,
        feeService,
        sendNotification: jest.fn(),
        NotifyType: {},
        logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });
      // resolveHealthIdentity is normally provided by sibling methods on the
      // service; stub it directly on the returned object.
      methods.resolveHealthIdentity = jest.fn().mockResolvedValue({
        userId: 'user-1',
        healthId: 'health-1',
      });
    });

    it('persists phase1Amount/phase2Amount as the full phase total when creating a new draft', async () => {
      await methods.saveDraft('user-1', {
        plantId: 'plant-1',
        plantName: 'P',
        serviceType: 'GACP',
        areaType: 'OUTDOOR',
        cultivationMethods: ['indoor', 'greenhouse', 'outdoor'],
        applicantData: {},
        locationData: {},
        productionData: {},
        harvestData: {},
        documents: [],
      });
      const data = mockPrisma.__captured.applicationCreate;
      expect(data).toBeTruthy();
      expect(data.phase1Amount).toBe(EXPECTED_PHASE1);
      expect(data.phase2Amount).toBe(EXPECTED_PHASE2);
    });
  });

  describe('writer: payment-service-phase-flow.createPhase1Payment', () => {
    let mockPrisma;
    let phaseFlow;
    let updates;

    beforeEach(() => {
      updates = [];
      mockPrisma = {
        application: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'app-1',
            applicationNumber: 'APP-1',
            status: 'REGISTERED',
            phase1Status: 'PENDING',
            phase1Amount: 0, // forces the writer to patch
            phase2Status: 'PENDING',
            phase2Amount: 0,
            totalAreaTypes: 3,
            formData: { cultivationMethods: ['indoor', 'greenhouse', 'outdoor'] },
            workflowHistory: [],
          }),
          findUnique: jest.fn(),
          update: jest.fn(async (args) => {
            updates.push(args.data);
            return args.data;
          }),
        },
        paymentTransaction: {
          create: jest.fn().mockResolvedValue(null),
        },
        // Support BOTH transaction forms:
        // - array of pre-built ops:   prisma.$transaction([op1, op2])
        // - callback form (canonical): prisma.$transaction(async (tx) => { ... })
        // The canonical writeApplicationStatus path uses the callback form so we have
        // to recursively pass the same mock as `tx`.
        $transaction: jest.fn(async (opsOrCallback) => {
          if (typeof opsOrCallback === 'function') {
            return opsOrCallback(mockPrisma);
          }
          return Promise.all(opsOrCallback);
        }),
      };
      const { createPhaseFlow } = require('../../services/payment-service-phase-flow');
      phaseFlow = createPhaseFlow({
        prisma: mockPrisma,
        feeService,
        CONFIG: {
          invoiceExpiryMinutes: 30,
        },
        generateSecureIdFragment: () => 'abcdefghij',
        asArray: (v) => (Array.isArray(v) ? v : []),
        buildWorkflowEvent: (action, from, to, meta) => ({ action, from, to, meta }),
        logWebhookAudit: jest.fn(),
        generateApplicationNumber: () => 'APP-NEW-1',
        syncPhaseStatusesFromInvoices: jest.fn().mockResolvedValue({ phase1Paid: false, settlements: { requiredInvoices: { phase1: [] } } }),
        getInvoiceSettlementsForApplication: jest.fn().mockResolvedValue({ phase1: { phasePaid: false }, requiredInvoices: { phase1: [] } }),
        verifyWebhookSignature: jest.fn(),
        notifySchedulerReadyForAudit: jest.fn(),
        notifyApplicantPaymentSuccess: jest.fn(),
        notifyApplicantPaymentFailed: jest.fn(),
        AuditSeverity: {},
        logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });
    });

    it('patches Application.phase1Amount/phase2Amount to the full phase total', async () => {
      const out = await phaseFlow.createPhase1Payment('app-1', 'health-1');
      expect(out.success).toBe(true);
      const feePatch = updates.find((u) =>
        Object.prototype.hasOwnProperty.call(u, 'phase1Amount')
        && Object.prototype.hasOwnProperty.call(u, 'phase2Amount'),
      );
      expect(feePatch).toBeTruthy();
      expect(feePatch.phase1Amount).toBe(EXPECTED_PHASE1);
      expect(feePatch.phase2Amount).toBe(EXPECTED_PHASE2);
    });
  });

  // GAP-5: when an accepted quotation exists, the phase-payment writer must COPY
  // its frozen totals — never recompute from (mutable) formData. Here the live
  // recompute (scope 3 → 16,605 / 83,025) drifts from the accepted quote
  // (scope 1 → 5,535 / 27,675); the writer must bill the FROZEN amount and log.
  describe('writer: createPhase1Payment — frozen price-of-record (GAP-5)', () => {
    let mockPrisma;
    let phaseFlow;
    let updates;
    let txCreates;
    let logger;

    const frozenFees = {
      scopeCount: 1,
      phase1: { serviceFeeAmount: 5500, vatAmount: 35, phaseTotal: 5535 },
      phase2: { serviceFeeAmount: 27500, vatAmount: 175, phaseTotal: 27675 },
    };

    beforeEach(() => {
      updates = [];
      txCreates = [];
      logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
      mockPrisma = {
        application: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'app-1', applicationNumber: 'APP-1', status: 'REGISTERED',
            phase1Status: 'PENDING', phase1Amount: 0,
            phase2Status: 'PENDING', phase2Amount: 0,
            totalAreaTypes: 3, // drifted scope
            formData: { cultivationMethods: ['indoor', 'greenhouse', 'outdoor'] },
            workflowHistory: [],
          }),
          findUnique: jest.fn(),
          update: jest.fn(async (args) => { updates.push(args.data); return args.data; }),
        },
        paymentTransaction: { create: jest.fn(async (args) => { txCreates.push(args.data); return null; }) },
        $transaction: jest.fn(async (opsOrCallback) => (
          typeof opsOrCallback === 'function' ? opsOrCallback(mockPrisma) : Promise.all(opsOrCallback)
        )),
      };
      const { createPhaseFlow } = require('../../services/payment-service-phase-flow');
      phaseFlow = createPhaseFlow({
        prisma: mockPrisma,
        feeService,
        CONFIG: { invoiceExpiryMinutes: 30 },
        generateSecureIdFragment: () => 'abcdefghij',
        asArray: (v) => (Array.isArray(v) ? v : []),
        buildWorkflowEvent: (action, from, to, meta) => ({ action, from, to, meta }),
        logWebhookAudit: jest.fn(),
        generateApplicationNumber: () => 'APP-NEW-1',
        syncPhaseStatusesFromInvoices: jest.fn().mockResolvedValue({ phase1Paid: false, settlements: { requiredInvoices: { phase1: [] } } }),
        getInvoiceSettlementsForApplication: jest.fn().mockResolvedValue({ phase1: { phasePaid: false }, requiredInvoices: { phase1: [] } }),
        verifyWebhookSignature: jest.fn(),
        notifySchedulerReadyForAudit: jest.fn(),
        notifyApplicantPaymentSuccess: jest.fn(),
        notifyApplicantPaymentFailed: jest.fn(),
        AuditSeverity: {},
        logger,
        getFrozenPhaseFees: jest.fn().mockResolvedValue(frozenFees),
      });
    });

    it('bills the FROZEN accepted totals (5,535 / 27,675), not the drifted recompute, and logs the drift', async () => {
      const out = await phaseFlow.createPhase1Payment('app-1', 'health-1');
      expect(out.success).toBe(true);

      const feePatch = updates.find((u) => Object.prototype.hasOwnProperty.call(u, 'phase1Amount'));
      expect(feePatch.phase1Amount).toBe(5535);
      expect(feePatch.phase2Amount).toBe(27675);
      expect(feePatch.totalAreaTypes).toBe(1); // frozen scope, not the drifted 3

      // paymentTransaction charges the frozen amount (satang).
      expect(txCreates[0].amount).toBe(5535 * 100);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[QUOTE_PRICE_DRIFT]'),
        expect.objectContaining({ frozenPhase1: 5535, recomputedPhase1: EXPECTED_PHASE1 }),
      );
    });
  });
});
