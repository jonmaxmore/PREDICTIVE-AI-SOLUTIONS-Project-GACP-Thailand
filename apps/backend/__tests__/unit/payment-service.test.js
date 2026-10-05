jest.mock('../../services/prisma-database', () => ({
  prisma: {
    auditLog: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    application: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    paymentTransaction: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    invoice: {
      findMany: jest.fn(),
    },
    // fix/fees-from-server round 4: the locked-price read now fails closed, so
    // this mock has to answer it. No quotation rows = "no quotation of record",
    // which keeps the recompute this suite always exercised. (It passed before
    // only because the missing `quotation` model threw and the throw was
    // swallowed into a recompute.)
    quotation: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(async (fnOrArray) => {
      if (Array.isArray(fnOrArray)) {
        return Promise.all(fnOrArray);
      }
      const { prisma } = require('../../services/prisma-database');
      return fnOrArray(prisma);
    }),
  },
}));

jest.mock('../../services/notification-service', () => ({
  sendNotification: jest.fn().mockResolvedValue(null),
  NotifyType: {
    SCHEDULER_NEW_SUBMISSION: 'SCHEDULER_NEW_SUBMISSION',
    SCHEDULER_AUDIT_READY: 'SCHEDULER_AUDIT_READY',
    PAYMENT_SUCCESS: 'PAYMENT_SUCCESS',
    PAYMENT_FAILED: 'PAYMENT_FAILED',
  },
}));

jest.mock('../../shared/logger', () => {
  const mockLog = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
  mockLog.createLogger = jest.fn(() => ({ ...mockLog }));
  mockLog.stream = { write: jest.fn() };
  return mockLog;
});

jest.mock('../../services/fee-service', () => ({
  // .total is the FULL phase amount (state + platform + VAT) post P0-5 fix
  calculateApplicationFees: jest.fn(() => ({
    phase1: { total: 5535, serviceFeeAmount: 5500, vatAmount: 35 },
    phase2: { total: 27675, serviceFeeAmount: 27500, vatAmount: 175 },
    scopeCount: 1,
  })),
}));

jest.mock('../../services/phase-billing-service', () => ({
  computePhaseSettlement: jest.fn(),
  flattenRequiredInvoices: jest.fn(() => []),
}));

jest.mock('../../middleware/audit-logger', () => ({
  auditLogger: { log: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
  AuditCategory: { APPLICATION: 'APPLICATION', PAYMENT: 'PAYMENT' },
  AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING', ERROR: 'ERROR' },
  ResourceType: { SYSTEM: 'SYSTEM' },
}));

const { prisma } = require('../../services/prisma-database');
const { createPhase1Payment } = require('../../services/payment-service');

describe('Payment Service workflow history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.auditLog.findFirst.mockResolvedValue(null);
    prisma.auditLog.create.mockResolvedValue({ id: 'audit-1' });
    prisma.invoice.findMany.mockResolvedValue([]);
  });

  it('appends workflow event when phase 1 payment is created', async () => {
    prisma.application.findFirst.mockResolvedValue({
      id: 'app-1',
      healthId: 'Applicant-1',
      status: 'PENDING_PAYMENT',
      applicationNumber: 'APP-2026-000001',
      phase1Status: 'PENDING',
      workflowHistory: [],
    });
    prisma.application.update.mockResolvedValue({ id: 'app-1' });
    prisma.paymentTransaction.create.mockResolvedValue({ id: 'txn-1' });

    const result = await createPhase1Payment('app-1', 'Applicant-1');

    expect(result.success).toBe(true);
    expect(result.invoiceId).toMatch(/^INV-\d{13}-[A-F0-9]{9}$/);
    const updateInput = prisma.application.update.mock.calls
      .map((call) => call[0])
      .find((input) => input?.data?.status === 'PENDING_DOC_FEE');
    expect(updateInput).toBeDefined();
    // Canonical, not 'PAYMENT_PHASE_1'. That string was in no state list, so
    // payment-slip-service resolved it to itself and refused the slip upload
    // after the farmer had already transferred the fee.
    expect(updateInput.data.status).toBe('PENDING_DOC_FEE');
    expect(updateInput.data.workflowHistory[0].action).toBe('PHASE_1_PAYMENT_CREATED');
    expect(updateInput.data.workflowHistory[0].fromStatus).toBe('PENDING_PAYMENT');
  });

});
