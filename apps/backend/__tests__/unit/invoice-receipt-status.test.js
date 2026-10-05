'use strict';

// B-RCPT-STATUS (2026-06-04): the slip-approve path auto-issues receipts
// asynchronously. The old code swallowed failures silently ("non-fatal").
// autoIssueReceiptTracked must instead PERSIST the outcome on the invoice
// (receiptStatus PENDING→ISSUED/FAILED) so a failure is visible to the ACCOUNT
// queue + retryable — and must NEVER throw back into the approve path.
jest.mock('../../services/prisma-database', () => ({
  prisma: { invoice: { update: jest.fn(), findMany: jest.fn() } },
}));

const { prisma } = require('../../services/prisma-database');
const invoiceService = require('../../services/invoice-service');

function statusWrites() {
  return prisma.invoice.update.mock.calls.map((c) => c[0].data);
}

describe('invoice-service.autoIssueReceiptTracked (B-RCPT-STATUS)', () => {
  beforeEach(() => {
    prisma.invoice.update.mockReset().mockResolvedValue({});
    prisma.invoice.findMany.mockReset().mockResolvedValue([]);
  });
  afterEach(() => {
    if (invoiceService.issueReceipt.mockRestore) {
      invoiceService.issueReceipt.mockRestore();
    }
  });

  it('marks PENDING (with attempt increment) then ISSUED on success; returns ok and does not throw', async () => {
    jest.spyOn(invoiceService, 'issueReceipt').mockResolvedValue({ id: 'inv1', receiptNumber: 'RCP-1' });
    const r = await invoiceService.autoIssueReceiptTracked('inv1', 'acc1', 'BANK_TRANSFER', 'x');
    expect(r.ok).toBe(true);
    const writes = statusWrites();
    expect(writes[0].receiptStatus).toBe('PENDING');
    expect(writes[0].receiptAttempts).toEqual({ increment: 1 });
    expect(writes[writes.length - 1].receiptStatus).toBe('ISSUED');
    expect(writes[writes.length - 1].receiptError).toBeNull();
  });

  it('records FAILED + truncated error and does NOT throw when issueReceipt fails', async () => {
    jest.spyOn(invoiceService, 'issueReceipt').mockRejectedValue(new Error('RECEIPT_SEQUENCE_DB_UNAVAILABLE'));
    const r = await invoiceService.autoIssueReceiptTracked('inv2', 'acc1', 'BANK_TRANSFER', 'x');
    expect(r.ok).toBe(false);
    const failWrite = statusWrites().find((d) => d.receiptStatus === 'FAILED');
    expect(failWrite).toBeTruthy();
    expect(failWrite.receiptError).toContain('RECEIPT_SEQUENCE_DB_UNAVAILABLE');
    expect(failWrite.receiptError.length).toBeLessThanOrEqual(500);
  });

  it('reconciles to ISSUED (ok, no false FAILED) on a benign "already issued" race', async () => {
    jest.spyOn(invoiceService, 'issueReceipt').mockRejectedValue(new Error('Receipt already issued for this invoice'));
    const r = await invoiceService.autoIssueReceiptTracked('inv3', 'acc1', 'BANK_TRANSFER', 'x');
    expect(r.ok).toBe(true);
    expect(r.alreadyIssued).toBe(true);
    const writes = statusWrites();
    expect(writes.some((d) => d.receiptStatus === 'ISSUED')).toBe(true);
    expect(writes.some((d) => d.receiptStatus === 'FAILED')).toBe(false);
  });

  it('listReceiptFailures queries only receiptStatus=FAILED (the ACCOUNT follow-up queue)', async () => {
    await invoiceService.listReceiptFailures();
    const { where } = prisma.invoice.findMany.mock.calls[0][0];
    expect(where.receiptStatus).toBe('FAILED');
    expect(where.isDeleted).toBe(false);
  });

  it('retryReceiptIssue delegates to the tracked path (idempotent retry)', async () => {
    jest.spyOn(invoiceService, 'issueReceipt').mockResolvedValue({ id: 'inv4', receiptNumber: 'RCP-4' });
    const r = await invoiceService.retryReceiptIssue('inv4', 'acc9');
    expect(r.ok).toBe(true);
    expect(statusWrites().some((d) => d.receiptStatus === 'ISSUED')).toBe(true);
  });
});
