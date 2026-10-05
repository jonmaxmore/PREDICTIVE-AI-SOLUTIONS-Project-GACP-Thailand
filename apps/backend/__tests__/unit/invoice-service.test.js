jest.mock('../../services/prisma-database', () => {
  // getById() resolves via prisma.invoice.findFirst (the org-scoped IDOR-safe
  // lookup); some older tests set up the snapshot via .findUnique. Share ONE
  // mock fn behind both names so either setup style feeds getById.
  const invoiceFindMock = jest.fn();
  const invoiceMock = {
    update: jest.fn(),
    updateMany: jest.fn(),
    findUnique: invoiceFindMock,
    findFirst: invoiceFindMock,
    count: jest.fn(),
    findMany: jest.fn(),
  };
  return {
    prisma: {
      invoice: invoiceMock,
      auditLog: {
        findMany: jest.fn(),
      },
      // $transaction executes the callback with the same prisma mock as `tx`
      $transaction: jest.fn(async (fn) => {
        const tx = { invoice: invoiceMock };
        return fn(tx);
      }),
    },
  };
});

// `mock-promptpay-service` and the legacy `pdf-service` were both
// siblings of earlier payment / PDF prototypes that have since been
// removed. invoice-service.js no longer requires either of them
// (the new path is `services/pdf/invoice-template-service.js` via
// `invoiceTemplateService.generateInvoicePdf` etc.). Their stale
// jest.mock entries used to point at deleted modules and made this
// whole test suite fail to load — they have been cleaned out.

jest.mock('../../services/notification-service', () => ({
  sendNotification: jest.fn().mockResolvedValue(null),
  NotifyType: {
    SUCCESS: 'SUCCESS',
  },
}));

// X4-FIX-A RC-2: invoice-service.issueReceipt now delegates receipt
// numbering to receipt-numbering-service.allocateReceiptNumber per
// R5-B (per-issuer atomic counter). The mock below provides a
// minimal but contract-faithful surface: separate counters per issuer,
// resolveIssuerForServiceType keyed on `_STATE_FEE` suffix.
jest.mock('../../services/receipt-numbering-service', () => {
  const counters = { DTAM: 0, PLATFORM: 0, PLATFORM_RECEIPT: 0 };
  const prefixes = {
    DTAM: 'RCP-DTAM',
    PLATFORM: 'TAX-PRD',
    PLATFORM_RECEIPT: 'RCP-PRD',
  };
  return {
    __counters: counters,
    allocateReceiptNumber: jest.fn(async ({ issuer }) => {
      counters[issuer] = (counters[issuer] || 0) + 1;
      const seq = counters[issuer];
      const year = issuer === 'DTAM' ? 2569 : 2026;
      const padded = String(seq).padStart(6, '0');
      return {
        number: `${prefixes[issuer]}-${year}-${padded}`,
        prefix: prefixes[issuer],
        year,
        sequence: seq,
        useThaiNumerals: issuer === 'DTAM',
      };
    }),
    resolveIssuerForServiceType: jest.fn((serviceType) => {
      const s = String(serviceType || '').toUpperCase();
      if (s.includes('STATE_FEE')) { return 'DTAM'; }
      return 'PLATFORM';
    }),
    ISSUER: { DTAM: 'DTAM', PLATFORM: 'PLATFORM', PLATFORM_RECEIPT: 'PLATFORM_RECEIPT' },
  };
});

const { prisma } = require('../../services/prisma-database');
const invoiceService = require('../../services/invoice-service');
const receiptNumberingService = require('../../services/receipt-numbering-service');

describe('invoice-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the per-issuer mock counters between tests so each test
    // observes a fresh DTAM=0 / PLATFORM=0 starting point.
    receiptNumberingService.__counters.DTAM = 0;
    receiptNumberingService.__counters.PLATFORM = 0;
    receiptNumberingService.__counters.PLATFORM_RECEIPT = 0;
  });

  it('marks invoice as PAID_PENDING_RECEIPT when paid', async () => {
    prisma.invoice.update.mockResolvedValue({ id: 'inv-1', status: 'PAID_PENDING_RECEIPT' });

    const result = await invoiceService.markAsPaid('inv-1', 'txn-1');

    expect(prisma.invoice.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'inv-1' },
      data: expect.objectContaining({
        status: 'PAID_PENDING_RECEIPT',
        paymentTransactionId: 'txn-1',
      }),
    }));
    expect(result.status).toBe('PAID_PENDING_RECEIPT');
  });

  it('issues receipt and sets RECEIPT_ISSUED status', async () => {
    prisma.invoice.findUnique.mockResolvedValue({
      id: 'inv-2',
      status: 'PAID_PENDING_RECEIPT',
      receiptNumber: null,
      notes: null,
      totalAmount: 25000,
      healthId: 'Applicant-1',
      serviceType: 'PHASE_1_PLATFORM_FEE',
      application: { applicationNumber: 'APP-1' },
      Applicant: { id: 'Applicant-1' },
    });
    // Compare-and-set (audit 2026-06-11 3.6): the write is a conditional
    // updateMany guarded on receiptNumber:null; count===1 means we won.
    prisma.invoice.updateMany.mockResolvedValue({ count: 1 });

    const result = await invoiceService.issueReceipt('inv-2', 'provider-123', 'BANK_TRANSFER', 'Issued by test');

    expect(prisma.invoice.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'inv-2', receiptNumber: null },
      data: expect.objectContaining({
        status: 'RECEIPT_ISSUED',
        receiptIssuedBy: 'provider-123',
      }),
    }));
    expect(result.status).toBe('RECEIPT_ISSUED');
  });

  it('does NOT overwrite when a concurrent issuance already set a receipt number (race-loser)', async () => {
    prisma.invoice.findUnique
      .mockResolvedValueOnce({ id: 'inv-r', status: 'PAID_PENDING_RECEIPT', receiptNumber: null, notes: null, totalAmount: 5000, serviceType: 'PHASE_1_STATE_FEE', application: {}, Applicant: { id: 'a' } })
      .mockResolvedValueOnce({ id: 'inv-r', status: 'RECEIPT_ISSUED', receiptNumber: 'RCP-DTAM-2569-000001' });
    prisma.invoice.updateMany.mockResolvedValue({ count: 0 }); // lost the race

    const result = await invoiceService.issueReceipt('inv-r', 'dtam', 'BANK_TRANSFER', null);

    // Returns the persisted (winner's) receipt, does not overwrite it.
    expect(result.receiptNumber).toBe('RCP-DTAM-2569-000001');
  });

  // ── X4-FIX-A RC-2 — R5-B per-issuer atomic counter ────────────────────
  // Pre-fix, issueReceipt used `tx.invoice.count({where:{receiptNumber:...}})`
  // for a SHARED counter across all issuers. A DTAM receipt issued seconds
  // before a PLATFORM receipt would have adjacent numbers in the same
  // sequence — violating the B16-D / R5-B contract that DTAM uses an
  // independent counter under the `RCP-DTAM-๒๕๖๙-*` prefix and PLATFORM
  // uses an independent counter under `TAX-PRD-2026-*`. The tests below
  // pin the post-fix contract: two issuers, two counters.
  describe('[X4-FIX-A RC-2] R5-B per-issuer atomic counter', () => {
    function makeInvoice(id, serviceType) {
      return {
        id,
        status: 'PAID_PENDING_RECEIPT',
        receiptNumber: null,
        notes: null,
        totalAmount: 5000,
        healthId: `applicant-${id}`,
        serviceType,
        application: { applicationNumber: `APP-${id}` },
        Applicant: { id: `applicant-${id}` },
      };
    }

    it('issues a DTAM receipt for *_STATE_FEE invoices (RCP-DTAM prefix)', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice('inv-state-1', 'PHASE_1_STATE_FEE'));
      prisma.invoice.updateMany.mockResolvedValue({ count: 1 });

      await invoiceService.issueReceipt('inv-state-1', 'dtam-staff', 'BANK_TRANSFER', null);

      expect(receiptNumberingService.resolveIssuerForServiceType)
        .toHaveBeenCalledWith('PHASE_1_STATE_FEE');
      expect(receiptNumberingService.allocateReceiptNumber)
        .toHaveBeenCalledWith({ issuer: 'DTAM', dateOrYear: expect.any(Date) });
      const updateCall = prisma.invoice.updateMany.mock.calls[0][0];
      // The number's year is read from the instant the receipt is dated with
      // (Bangkok, operator 2026-09-26): one instant for both.
      expect(receiptNumberingService.allocateReceiptNumber.mock.calls[0][0].dateOrYear)
        .toBe(updateCall.data.receiptIssuedAt);
      expect(updateCall.data.receiptNumber).toMatch(/^RCP-DTAM-/);
    });

    it('issues a PLATFORM receipt for *_PLATFORM_FEE invoices (TAX-PRD prefix)', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice('inv-plat-1', 'PHASE_1_PLATFORM_FEE'));
      prisma.invoice.updateMany.mockResolvedValue({ count: 1 });

      await invoiceService.issueReceipt('inv-plat-1', 'platform-staff', 'BANK_TRANSFER', null);

      expect(receiptNumberingService.allocateReceiptNumber)
        .toHaveBeenCalledWith({ issuer: 'PLATFORM', dateOrYear: expect.any(Date) });
      const updateCall = prisma.invoice.updateMany.mock.calls[0][0];
      // The number's year is read from the instant the receipt is dated with
      // (Bangkok, operator 2026-09-26): one instant for both.
      expect(receiptNumberingService.allocateReceiptNumber.mock.calls[0][0].dateOrYear)
        .toBe(updateCall.data.receiptIssuedAt);
      expect(updateCall.data.receiptNumber).toMatch(/^TAX-PRD-/);
    });

    it('DTAM and PLATFORM receipts allocate from INDEPENDENT counter streams (no collision)', async () => {
      // The bug-of-record: pre-fix code used `tx.invoice.count(...)` as
      // the counter source, so a DTAM receipt at count=1 and a PLATFORM
      // receipt at count=2 would have receipt numbers RCP-2569-00001 and
      // RCP-2569-00002 — sharing the same monotonic stream. Post-fix
      // each issuer has its own ReceiptSequence row; both `sequence=1`
      // can coexist because the row keys are (RCP-DTAM, 2569) vs
      // (TAX-PRD, 2026). This test asserts independence.

      // First DTAM allocation
      prisma.invoice.findUnique.mockResolvedValueOnce(makeInvoice('inv-d-1', 'PHASE_1_STATE_FEE'));
      prisma.invoice.updateMany.mockResolvedValueOnce({ count: 1 });
      const dtamResult = await invoiceService.issueReceipt('inv-d-1', 'dtam-staff', 'BANK_TRANSFER', null);

      // Then PLATFORM allocation
      prisma.invoice.findUnique.mockResolvedValueOnce(makeInvoice('inv-p-1', 'PHASE_1_PLATFORM_FEE'));
      prisma.invoice.updateMany.mockResolvedValueOnce({ count: 1 });
      const platResult = await invoiceService.issueReceipt('inv-p-1', 'plat-staff', 'BANK_TRANSFER', null);

      // The numbers MUST come from independent streams — both have sequence=1.
      expect(dtamResult.receiptNumber).toBe('RCP-DTAM-2569-000001');
      expect(platResult.receiptNumber).toBe('TAX-PRD-2026-000001');
      // Sanity: never share a monotonic stream
      expect(dtamResult.receiptNumber).not.toEqual(platResult.receiptNumber);
    });

    it('same-issuer sequential allocations increment monotonically (DTAM)', async () => {
      // Two DTAM receipts in a row → sequence 1 then 2 on the SAME
      // (RCP-DTAM, 2569) ReceiptSequence row.
      prisma.invoice.findUnique
        .mockResolvedValueOnce(makeInvoice('inv-d-a', 'PHASE_1_STATE_FEE'))
        .mockResolvedValueOnce(makeInvoice('inv-d-b', 'PHASE_2_STATE_FEE'));
      prisma.invoice.updateMany.mockResolvedValue({ count: 1 });

      const r1 = await invoiceService.issueReceipt('inv-d-a', 'dtam', 'BANK_TRANSFER', null);
      const r2 = await invoiceService.issueReceipt('inv-d-b', 'dtam', 'BANK_TRANSFER', null);

      expect(r1.receiptNumber).toBe('RCP-DTAM-2569-000001');
      expect(r2.receiptNumber).toBe('RCP-DTAM-2569-000002');
    });

    it('does NOT call tx.invoice.count anymore (legacy shared counter removed)', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice('inv-c', 'PHASE_1_STATE_FEE'));
      prisma.invoice.updateMany.mockResolvedValue({ count: 1 });

      await invoiceService.issueReceipt('inv-c', 'dtam', 'BANK_TRANSFER', null);

      // The previous implementation called `tx.invoice.count` inside the
      // serialisable transaction to derive the receipt number. The fix
      // delegates entirely to receipt-numbering-service.allocateReceiptNumber,
      // so the count() call must no longer fire.
      expect(prisma.invoice.count).not.toHaveBeenCalled();
    });
  });

  it('returns mapped webhook exceptions for accounting queue', async () => {
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: 'log-1',
        action: 'WEBHOOK_UNMATCHED',
        severity: 'WARNING',
        createdAt: new Date('2026-02-07T00:00:00.000Z'),
        errorMessage: null,
        metadata: JSON.stringify({
          invoiceId: 'INV-404',
          transactionId: 'TXN-404',
          message: 'Transaction not found',
          payloadHash: 'abc123',
        }),
      },
    ]);

    const result = await invoiceService.listReceiptExceptions(10);

    expect(prisma.auditLog.findMany).toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      action: 'WEBHOOK_UNMATCHED',
      invoiceId: 'INV-404',
      transactionId: 'TXN-404',
      payloadRef: 'abc123',
    }));
  });
});


// B1 (2026-08-23) — every invoice download/view returned 500 for 22 days
// because getById() selected `Entity.entityType`, a column that does not
// exist on the Entity model (`prisma/schema/entity.prisma:33` calls it
// `type`). Prisma rejects the whole query with
//   Unknown field `entityType` for select statement on model `Entity`
// which takes down GET /api/invoices/:id, GET /api/invoices/:id/pdf and
// issueReceipt() (all three call getById first).
//
// The prisma mock in this file cannot reproduce that rejection — a jest mock
// accepts any shape. So this guard validates the select the production code
// ACTUALLY sends against the generated Prisma schema (DMMF), which is the
// same source of truth the real client validates against. No DB required.
describe('invoice-service getById — selects only fields that exist in the schema', () => {
  const { Prisma } = require('@prisma/client');

  function fieldNames(modelName) {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
    if (!model) { throw new Error(`Model ${modelName} not found in Prisma DMMF`); }
    return model.fields.map((f) => f.name);
  }

  // getById = the billing view (application via `select`, S1 2026-09-27);
  // getForDocument = the PDF path (application via `include`). Both carry the
  // same narrow Entity select, so both are guarded here.
  it.each([
    ['getById', (a) => a?.include?.application?.select?.entity?.select],
    ['getForDocument', (a) => a?.include?.application?.include?.entity?.select],
  ])('Entity select in %s() contains no unknown field', async (fn, pick) => {
    prisma.invoice.findFirst.mockResolvedValue(null);

    await invoiceService[fn]('inv-select-guard');

    expect(prisma.invoice.findFirst).toHaveBeenCalled();
    const args = prisma.invoice.findFirst.mock.calls[prisma.invoice.findFirst.mock.calls.length - 1][0];
    const entitySelect = pick(args);
    expect(entitySelect).toBeTruthy();

    const known = fieldNames('Entity');
    const unknown = Object.keys(entitySelect).filter((k) => !known.includes(k));
    expect(unknown).toEqual([]);
  });

  it('additionally carries the tax-id columns the PDF payer block prints — never thaiCitizenId (2026-09-27)', async () => {
    prisma.invoice.findFirst.mockResolvedValue(null);

    await invoiceService.getForDocument('inv-select-guard-2');

    const args = prisma.invoice.findFirst.mock.calls[prisma.invoice.findFirst.mock.calls.length - 1][0];
    const entitySelect = args.include.application.include.entity.select;
    // getForDocument (this INTERNAL-ONLY, never-returned-to-a-route function)
    // is now WIDER than the four route-facing call sites (invoice-service.js
    // getById / listPendingReceipts / generateReceiptPdf / listReceiptExceptions
    // — see the `%s()` table above): it also carries `juristicId` +
    // `communityRegNo`, decrypted transparently by the PDPA prisma
    // extension's generic read-time walker, because the invoice/receipt/
    // tax-invoice PDF payer block prints one of them
    // (utils/applicant-resolver.js:36/38) and used to always render
    // "Tax ID -" without them (invoice-tax-id fix round, 2026-09-27; staging
    // evidence INV-CO-CAFF6646-M1).
    //
    // `thaiCitizenId` is DELIBERATELY EXCLUDED — operator ruling 2026-09-27:
    // an INDIVIDUAL payer's national ID is never printed, in full or in
    // part. Fix round 1 of this select briefly added it and leaked the full
    // 13-digit national ID onto the invoice/receipt PDF's PAYER_ID for an
    // individual payer; caught before merge. This assertion is the pin that
    // keeps it out.
    expect(entitySelect).toEqual({
      id: true, type: true, displayName: true, juristicId: true, communityRegNo: true,
    });
    expect(entitySelect.thaiCitizenId).toBeUndefined();
  });
});
