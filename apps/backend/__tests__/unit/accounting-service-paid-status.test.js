// A1 (UAT) — accounting dashboard reported ฿0 revenue because the paid-status
// filter used the bare literal 'paid', which never matches the real terminal
// paid state RECEIPT_ISSUED (the canonical PAID set is
// ['paid','PAID','PAID_PENDING_RECEIPT','RECEIPT_ISSUED']).
//
// Live UAT evidence: /api/v1/accounting/ returned revenue.total=0 while the DB
// held 5 RECEIPT_ISSUED invoices totalling 16070.00 and 0 rows status='paid'.
//
// This test uses a FILTERING fake prisma (respects where.status) so the bug is
// genuinely reproduced: with the bare 'paid' literal the RECEIPT_ISSUED rows are
// excluded → revenue/paid-count = 0 (RED); after the fix they are counted (GREEN).

jest.mock('../../services/prisma-database', () => ({
  prisma: {
    invoice: { count: jest.fn(), aggregate: jest.fn(), findMany: jest.fn() },
    quote: { count: jest.fn() },
  },
}));

const { prisma } = require('../../services/prisma-database');
const accountingService = require('../../services/accounting-service');

const PAID_STATE = 'RECEIPT_ISSUED';

// 5 invoices in the real terminal paid state, summing to 16070.00.
// createdAt is old (so "today" counts are 0); paidAt is now (always within the
// current month, so the slip-queue monthly windows always include them).
const NOW = new Date();
const OLD = new Date('2020-01-01T00:00:00.000Z');
const INVOICES = [
  { status: PAID_STATE, totalAmount: 5535, isDeleted: false, organizationId: 'org-1', serviceType: 'PHASE_1_STATE_FEE', createdAt: OLD, paidAt: NOW },
  { status: PAID_STATE, totalAmount: 5535, isDeleted: false, organizationId: 'org-1', serviceType: 'PHASE_1_STATE_FEE', createdAt: OLD, paidAt: NOW },
  { status: PAID_STATE, totalAmount: 500, isDeleted: false, organizationId: 'org-1', serviceType: 'PHASE_2_STATE_FEE', createdAt: OLD, paidAt: NOW },
  { status: PAID_STATE, totalAmount: 2500, isDeleted: false, organizationId: 'org-1', serviceType: 'PHASE_1_PLATFORM_FEE', createdAt: OLD, paidAt: NOW },
  { status: PAID_STATE, totalAmount: 2000, isDeleted: false, organizationId: 'org-1', serviceType: 'PHASE_2_PLATFORM_FEE', createdAt: OLD, paidAt: NOW },
];
// STATE wallet = 5535 + 5535 + 500 = 11570 ; PLATFORM wallet = 2500 + 2000 = 4500 ; total = 16070

function statusMatches(whereStatus, rowStatus) {
  if (whereStatus === undefined) { return true; }
  if (typeof whereStatus === 'string') { return rowStatus === whereStatus; }
  if (whereStatus && Array.isArray(whereStatus.in)) { return whereStatus.in.includes(rowStatus); }
  return false;
}

function rowMatches(where = {}, row) {
  if (where.isDeleted !== undefined && row.isDeleted !== where.isDeleted) { return false; }
  if (where.organizationId !== undefined && row.organizationId !== where.organizationId) { return false; }
  if (!statusMatches(where.status, row.status)) { return false; }
  if (where.serviceType && Array.isArray(where.serviceType.in) && !where.serviceType.in.includes(row.serviceType)) { return false; }
  if (where.createdAt && where.createdAt.gte && !(row.createdAt >= where.createdAt.gte)) { return false; }
  if (where.paidAt && where.paidAt.gte && !(row.paidAt >= where.paidAt.gte)) { return false; }
  return true;
}

beforeEach(() => {
  prisma.invoice.count.mockImplementation(async ({ where }) => INVOICES.filter((r) => rowMatches(where, r)).length);
  prisma.invoice.aggregate.mockImplementation(async ({ where }) => ({
    _sum: { totalAmount: INVOICES.filter((r) => rowMatches(where, r)).reduce((s, r) => s + r.totalAmount, 0) },
  }));
  prisma.quote.count.mockResolvedValue(0);
});

describe('accounting-service paid-status filter (RECEIPT_ISSUED terminal state)', () => {
  it('getRootSummary counts RECEIPT_ISSUED invoices as paid + revenue', async () => {
    const summary = await accountingService.getRootSummary();
    expect(summary.invoices.total).toBe(5);
    expect(summary.invoices.paid).toBe(5);       // bare 'paid' literal → 0 (RED)
    expect(summary.revenue.total).toBe(16070);   // bare 'paid' literal → 0 (RED)
  });

  it('getDashboardStats counts RECEIPT_ISSUED invoices as paid + revenue', async () => {
    const stats = await accountingService.getDashboardStats();
    expect(stats.invoices.total).toBe(5);
    expect(stats.invoices.paid).toBe(5);         // bare 'paid' literal → 0 (RED)
    expect(stats.revenue.total).toBe(16070);     // bare 'paid' literal → 0 (RED)
  });
});
