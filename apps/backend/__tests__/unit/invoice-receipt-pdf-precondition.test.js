'use strict';

/**
 * L5 regression — GET /invoices/:id/receipt/pdf must NOT 500 when the invoice
 * exists but no receipt has been issued yet. generateReceiptPdf() previously
 * threw a plain Error('Receipt not issued yet') which fell through respondError
 * to a generic 500 (the "swallow a precondition as a server fault" anti-pattern,
 * the project rules golden rule #3). It now carries statusCode 409 so respondError maps
 * it to a 4xx.
 */
jest.mock('../../services/prisma-database', () => ({
  prisma: { invoice: { findUnique: jest.fn() } },
}));

const invoiceService = require('../../services/invoice-service');

describe('invoice-service.generateReceiptPdf — receipt-not-issued precondition (L5)', () => {
  afterEach(() => {
    if (invoiceService.getForDocument.mockRestore) { invoiceService.getForDocument.mockRestore(); }
  });

  it('throws a 409 (not a bare 500) when the invoice has no receiptNumber yet', async () => {
    jest.spyOn(invoiceService, 'getForDocument').mockResolvedValue({ id: 'inv-1', receiptNumber: null });
    await expect(invoiceService.generateReceiptPdf('inv-1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'RECEIPT_NOT_ISSUED',
      message: 'Receipt not issued yet',
    });
  });

  it('still surfaces a not-found invoice distinctly (no receiptNumber short-circuit)', async () => {
    jest.spyOn(invoiceService, 'getForDocument').mockResolvedValue(null);
    await expect(invoiceService.generateReceiptPdf('missing')).rejects.toThrow('Invoice not found');
  });
});
