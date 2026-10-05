'use strict';

/**
 * F-PREVIEW-REVISION-WRITE — direct no-write proof (fix round 2, Item 4a,
 * 2026-08-18).
 *
 * `preview-previewable-states.test.js` proves the ROUTE skips writes in
 * REVISION_REQUESTED/CAR_PENDING by mocking the whole `preview-financial-utils`
 * module — so `readPhase1FinancialDocuments`'s own "read-only" property never
 * ran against the real function; it rested on source reading. This file
 * imports the REAL `readPhase1FinancialDocuments` against a fake prisma and
 * spies on every quote/invoice/application method, so a future edit that
 * sneaks a write into this function fails a test even if the route-level
 * mock hides it.
 */

const mockPrisma = {
  invoice: {
    findFirst: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  quote: {
    findFirst: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  application: {
    update: jest.fn(),
  },
};

jest.mock('../../services/prisma-database', () => ({ prisma: mockPrisma }));

jest.mock('../../services/phase-billing-service', () => ({
  getServiceTypesForPhaseComponent: (_phase, component) => [`PHASE_1_${component}_FEE`],
  getCanonicalServiceTypeForComponent: (_phase, component) => `PHASE_1_${component}_FEE`,
  isInvoicePaidStatus: () => false,
}));

const { readPhase1FinancialDocuments } = require('../../routes/api/preview/preview-financial-utils');

describe('readPhase1FinancialDocuments — direct no-write proof (fix round 2, Item 4a)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls ONLY find* methods — never invoice.update/create, quote.update/create, application.update', async () => {
    mockPrisma.invoice.findFirst
      .mockResolvedValueOnce({
        id: 'inv-state', invoiceNumber: 'INV-1', status: 'pending',
        dueDate: null, totalAmount: 5000, serviceType: 'PHASE_1_STATE_FEE',
      })
      .mockResolvedValueOnce({
        id: 'inv-plat', invoiceNumber: 'INV-2', status: 'pending',
        dueDate: null, totalAmount: 535, serviceType: 'PHASE_1_PLATFORM_FEE',
      });
    mockPrisma.quote.findFirst
      .mockResolvedValueOnce({ id: 'q-state', quoteNumber: 'QT-1', status: 'sent', validUntil: null })
      .mockResolvedValueOnce({ id: 'q-plat', quoteNumber: 'QT-2', status: 'sent', validUntil: null });

    const result = await readPhase1FinancialDocuments({ id: 'app-1', healthId: '1186494077533' });

    expect(mockPrisma.invoice.findFirst).toHaveBeenCalledTimes(2);
    expect(mockPrisma.quote.findFirst).toHaveBeenCalledTimes(2);
    expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
    expect(mockPrisma.quote.update).not.toHaveBeenCalled();
    expect(mockPrisma.quote.create).not.toHaveBeenCalled();
    expect(mockPrisma.application.update).not.toHaveBeenCalled();

    expect(result.phase1.state.invoice).toMatchObject({ id: 'inv-state' });
    expect(result.phase1.platform.invoice).toMatchObject({ id: 'inv-plat' });
    expect(result.phase1.state.quote).toMatchObject({ id: 'q-state' });
    expect(result.phase1.platform.quote).toMatchObject({ id: 'q-plat' });
  });

  it('returns nulls (not a crash) when nothing exists yet — still zero writes', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(null);
    mockPrisma.quote.findFirst.mockResolvedValue(null);

    const result = await readPhase1FinancialDocuments({ id: 'app-2', healthId: '1100100100013' });

    expect(result.phase1.state.invoice).toBeNull();
    expect(result.phase1.platform.invoice).toBeNull();
    expect(result.phase1.state.quote).toBeNull();
    expect(result.phase1.platform.quote).toBeNull();
    expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
    expect(mockPrisma.quote.update).not.toHaveBeenCalled();
    expect(mockPrisma.quote.create).not.toHaveBeenCalled();
    expect(mockPrisma.application.update).not.toHaveBeenCalled();
  });

  it('keys the quote lookup by the SAME shared tags the retired writer used (drift-proof, Item 4b)', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(null);
    mockPrisma.quote.findFirst.mockResolvedValue(null);

    await readPhase1FinancialDocuments({ id: 'app-3', healthId: '1100100100014' });

    const notesArgs = mockPrisma.quote.findFirst.mock.calls.map((call) => call[0].where.notes.contains);
    expect(notesArgs).toEqual(['AUTO_PHASE_1_STATE_PREVIEW', 'AUTO_PHASE_1_PLATFORM_PREVIEW']);
  });

  it('an appId-less application short-circuits to an all-null shape with zero prisma calls at all', async () => {
    const result = await readPhase1FinancialDocuments({ id: '' });

    expect(result).toEqual({
      quote: null,
      invoice: null,
      phase1: {
        state: { quote: null, invoice: null },
        platform: { quote: null, invoice: null },
      },
    });
    expect(mockPrisma.invoice.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.quote.findFirst).not.toHaveBeenCalled();
  });

  it('the writing twin ensurePhase1FinancialDocuments is gone (M5, 2026-10-02) — only the reader is exported', () => {
    const utils = require('../../routes/api/preview/preview-financial-utils');
    expect(utils.ensurePhase1FinancialDocuments).toBeUndefined();
    expect(typeof utils.readPhase1FinancialDocuments).toBe('function');
  });
});
