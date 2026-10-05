const {
  computePhaseSettlement,
  flattenRequiredInvoices,
} = require('../../services/phase-billing-service');

describe('phase-billing-service', () => {
  it('requires state and platform invoices to mark phase as paid', () => {
    const invoices = [
      {
        id: 'inv-p1-state',
        invoiceNumber: 'INV-STATE',
        serviceType: 'PHASE_1_STATE_FEE',
        status: 'PAID_PENDING_RECEIPT',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'inv-p1-platform',
        invoiceNumber: 'INV-PLATFORM',
        serviceType: 'PHASE_1_PLATFORM_FEE',
        status: 'PENDING',
        createdAt: new Date('2026-01-01T00:00:01.000Z'),
      },
    ];

    const settlement = computePhaseSettlement(invoices, 'PHASE_1');
    expect(settlement.phasePaid).toBe(false);
    expect(settlement.state.isPaid).toBe(true);
    expect(settlement.platform.isPaid).toBe(false);
  });

  it('marks phase receipt as issued only when both components have receipt evidence', () => {
    const invoices = [
      {
        id: 'inv-p2-state',
        invoiceNumber: 'INV-P2-STATE',
        serviceType: 'PHASE_2_STATE_FEE',
        status: 'RECEIPT_ISSUED',
        receiptIssuedAt: new Date('2026-01-02T00:00:00.000Z'),
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      },
      {
        id: 'inv-p2-platform',
        invoiceNumber: 'INV-P2-PLATFORM',
        serviceType: 'PHASE_2_PLATFORM_FEE',
        status: 'PAID_PENDING_RECEIPT',
        createdAt: new Date('2026-01-02T00:00:01.000Z'),
      },
    ];

    const settlement = computePhaseSettlement(invoices, 'PHASE_2');
    expect(settlement.phasePaid).toBe(true);
    expect(settlement.phaseReceiptIssued).toBe(false);
    expect(flattenRequiredInvoices(settlement)).toHaveLength(2);
  });

  it('does not mark canonical phase as paid when platform invoice is missing', () => {
    const invoices = [
      {
        id: 'inv-p2-state-only',
        invoiceNumber: 'INV-P2-STATE',
        serviceType: 'PHASE_2_STATE_FEE',
        status: 'PAID',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    ];

    const settlement = computePhaseSettlement(invoices, 'PHASE_2');
    expect(settlement.hasLegacyStateOnly).toBe(false);
    expect(settlement.phasePaid).toBe(false);
    expect(settlement.platform.status).toBe('MISSING');
  });

  it('supports legacy state-only invoices without blocking historical records', () => {
    const invoices = [
      {
        id: 'inv-legacy',
        invoiceNumber: 'INV-LEGACY',
        serviceType: 'AUDIT_FEE',
        status: 'PAID',
        createdAt: new Date('2025-12-01T00:00:00.000Z'),
      },
    ];

    const settlement = computePhaseSettlement(invoices, 'PHASE_2');
    expect(settlement.phasePaid).toBe(true);
    expect(settlement.hasLegacyStateOnly).toBe(true);
    expect(settlement.platform.status).toBe('LEGACY_NOT_REQUIRED');
  });
});
