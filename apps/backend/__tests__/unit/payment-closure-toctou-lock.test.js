'use strict';

/**
 * R2 M5 — payment-closure TOCTOU / optimistic-lock guard (RED-first).
 *
 * Operator ground truth under test (money-safety, non-reopenable close):
 *   The 03:00 scan snapshot of Application.status is STALE by the time the
 *   per-case write runs. If a PromptPay settlement (webhook: PENDING_*_FEE ->
 *   *_FEE_PAID) lands between the scan and the write, stamping the terminal
 *   EXPIRED/PAYMENT_ABANDONED over the freshly-PAID state buries a paying
 *   customer's application forever (reopen is unbuilt). The close therefore MUST:
 *     1. Re-read the application (status + version) and the invoice status
 *        INSIDE the tx and SKIP (not write) if the case is no longer at a
 *        closeable pre-payment gate or the invoice is no longer pending.
 *     2. Pass the FRESH version as writeApplicationStatus.expectedVersion so a
 *        writer that advanced the row AFTER our re-read but BEFORE our write is
 *        caught by the WF-F7 optimistic lock (CONCURRENCY_CONFLICT) and the
 *        case is SKIPPED, never clobbered.
 *
 * These are mocked-prisma unit tests (observable locally). Each simulates the
 * race at a different interleaving and asserts NO EXPIRED write happens +
 * summary.skipped incremented + the sweep does NOT throw.
 */

const mockInvoiceFindMany = jest.fn();
const mockReminderFindMany = jest.fn();
const mockUserFindFirst = jest.fn();
const mockCheckoutOrderFindFirst = jest.fn();
const mockTxAppFindUnique = jest.fn();
const mockTxInvoiceFindUnique = jest.fn();
const mockTransaction = jest.fn(async (cb) => cb({
    application: { findUnique: (...a) => mockTxAppFindUnique(...a) },
    invoice: { findUnique: (...a) => mockTxInvoiceFindUnique(...a) },
}));

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        invoice: { findMany: (...a) => mockInvoiceFindMany(...a) },
        paymentReminderLog: { findMany: (...a) => mockReminderFindMany(...a) },
        user: { findFirst: (...a) => mockUserFindFirst(...a) },
        checkoutOrder: { findFirst: (...a) => mockCheckoutOrderFindFirst(...a) },
        $transaction: (...a) => mockTransaction(...a),
    },
}));

jest.mock('../../services/tenant-context', () => ({
    withoutTenantScope: (fn) => fn(),
    runWithTenantContext: (_ctx, fn) => fn(),
}));

// Money-safety guard #3 (gateway truth, Task 6) — the sweep now checks Stripe
// before every close. Default: no checkout order on file, so the guard
// resolves false and never touches the gateway; the guard #3 describe block
// below overrides this to exercise the "captured payment" and fail-safe paths.
const mockGetPaymentIntent = jest.fn();
jest.mock('../../services/payment/payment-adapter', () => ({
    getPaymentAdapter: () => ({ getPaymentIntent: (...a) => mockGetPaymentIntent(...a) }),
}));

const mockWriteStatus = jest.fn();
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: (...a) => mockWriteStatus(...a),
}));

const mockBuildTransition = jest.fn();
jest.mock('../../services/workflow-transition-service', () => {
    const actual = jest.requireActual('../../services/workflow-transition-service');
    return {
        ...actual,
        buildTransitionUpdate: (...a) => mockBuildTransition(...a),
    };
});

const mockSendNotification = jest.fn();
jest.mock('../../services/notification-service', () => ({
    sendNotification: (...a) => mockSendNotification(...a),
    NotifyType: { APPLICATION_EXPIRED: 'APPLICATION_EXPIRED' },
}));

const mockAuditLog = jest.fn();
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: (...a) => mockAuditLog(...a) },
    AuditCategory: { APPLICATION: 'APPLICATION' },
    ResourceType: { APPLICATION: 'APPLICATION' },
}));

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('../../shared/logger', () => ({ ...mockLogger, createLogger: jest.fn(() => mockLogger) }));

const { runPaymentClosureSweep } = require('../../jobs/payment-closure-job');
const { APPLICATION_STATUSES } = require('../../shared/workflow-state-machine');

const DAY_MS = 24 * 60 * 60 * 1000;
const ALL_REMINDERS = [{ reminderType: 'PRE_DUE' }, { reminderType: 'DUE_DATE' }, { reminderType: 'OVERDUE_NOTICE' }];

/** One scan-snapshot invoice whose application is (as of the scan) closeable. */
function scanInvoice(overrides = {}) {
    return {
        id: 'inv-1',
        invoiceNumber: 'INV-1',
        dueDate: new Date(Date.now() - 40 * DAY_MS),
        organizationId: 'org-1',
        application: {
            id: 'app-1',
            applicationNumber: 'APP-1',
            status: APPLICATION_STATUSES.PENDING_DOC_FEE, // STALE snapshot
            healthId: 'canon-1',
            organizationId: 'org-1',
            formData: { plot: 'keep-me' },
            workflowHistory: [],
            version: 3, // STALE version
            ...overrides,
        },
    };
}

function concurrencyConflict() {
    const err = new Error('concurrent modification of application app-1');
    err.code = 'CONCURRENCY_CONFLICT';
    return err;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockInvoiceFindMany.mockResolvedValue([scanInvoice()]);
    mockReminderFindMany.mockResolvedValue(ALL_REMINDERS); // fully reminded
    mockUserFindFirst.mockResolvedValue(null);
    // Guard #3 default: no checkout order on file -> isInvoicePaidAtGateway
    // resolves false without ever calling the gateway. Individual tests below
    // override this to exercise the "captured payment" / fail-safe paths.
    mockCheckoutOrderFindFirst.mockResolvedValue(null);
    mockWriteStatus.mockResolvedValue({ id: 'app-1', applicationNumber: 'APP-1' });
    mockBuildTransition.mockReturnValue({ updateData: { workflowHistory: [{ to: 'EXPIRED' }] } });
    mockSendNotification.mockResolvedValue({ id: 'n1' });
    mockAuditLog.mockResolvedValue({});
});

describe('scan query pins the closeable pre-payment states + version (step 1)', () => {
    test('findMany selects application.version, filters application.status to the closeable gates, and matches the checkout serviceType by PREFIX', async () => {
        await runPaymentClosureSweep();

        expect(mockInvoiceFindMany).toHaveBeenCalledTimes(1);
        const arg = mockInvoiceFindMany.mock.calls[0][0];
        // version is required so the fresh row can drive the optimistic lock.
        expect(arg.select.application.select.version).toBe(true);
        // Already-closed cases must not be re-fetched forever: the WHERE constrains
        // application.status to the closeable pre-payment gates.
        const statusIn = arg.where.application.status.in;
        expect(statusIn).toEqual(expect.arrayContaining([
            APPLICATION_STATUSES.PENDING_DOC_FEE,
            APPLICATION_STATUSES.PENDING_AUDIT_FEE,
        ]));
        // F-CHECKOUT-M2 (2026-08-18): prefix match (legacy 'CERTIFICATION_CHECKOUT'
        // + milestone-dimensioned '_M1'/'_M2'), not the old exact-equality read —
        // equality would silently stop closing abandoned _M1/_M2 checkouts.
        expect(arg.where.serviceType).toEqual({ startsWith: 'CERTIFICATION_CHECKOUT' });
    });
});

describe('TOCTOU race — payment settled between the 03:00 scan and the in-tx write', () => {
    test('in-tx re-read shows the app already DOC_FEE_PAID → SKIP, no EXPIRED write, no throw', async () => {
        // The webhook settled the case after the scan snapshot.
        mockTxAppFindUnique.mockResolvedValue({
            id: 'app-1',
            status: APPLICATION_STATUSES.DOC_FEE_PAID,
            version: 4,
            formData: { plot: 'keep-me' },
            workflowHistory: [],
        });
        mockTxInvoiceFindUnique.mockResolvedValue({ status: 'paid' });

        const summary = await runPaymentClosureSweep();

        // The paid application is NEVER stamped terminal.
        expect(mockWriteStatus).not.toHaveBeenCalled();
        expect(mockBuildTransition).not.toHaveBeenCalled();
        expect(summary.closed).toBe(0);
        expect(summary.errors).toBe(0);
        expect(summary.skipped).toBe(1);
    });

    test('in-tx re-read shows the invoice already paid (status !== pending) → SKIP', async () => {
        // App status lagging but the invoice row already settled.
        mockTxAppFindUnique.mockResolvedValue({
            id: 'app-1',
            status: APPLICATION_STATUSES.PENDING_DOC_FEE,
            version: 4,
            formData: { plot: 'keep-me' },
            workflowHistory: [],
        });
        mockTxInvoiceFindUnique.mockResolvedValue({ status: 'paid' });

        const summary = await runPaymentClosureSweep();

        expect(mockWriteStatus).not.toHaveBeenCalled();
        expect(summary.closed).toBe(0);
        expect(summary.errors).toBe(0);
        expect(summary.skipped).toBe(1);
    });
});

describe('optimistic lock — a writer advanced the row between our re-read and our write', () => {
    test('writeApplicationStatus throwing CONCURRENCY_CONFLICT is a SKIP, not an error', async () => {
        mockTxAppFindUnique.mockResolvedValue({
            id: 'app-1',
            status: APPLICATION_STATUSES.PENDING_DOC_FEE,
            version: 5,
            formData: { plot: 'keep-me' },
            workflowHistory: [],
        });
        mockTxInvoiceFindUnique.mockResolvedValue({ status: 'pending' });
        mockWriteStatus.mockRejectedValue(concurrencyConflict());

        const summary = await runPaymentClosureSweep();

        // The FRESH version drove the optimistic lock.
        expect(mockWriteStatus).toHaveBeenCalledTimes(1);
        expect(mockWriteStatus.mock.calls[0][0].expectedVersion).toBe(5);
        // Conflict → skipped, NOT counted as an error, and the sweep did not throw.
        expect(summary.skipped).toBe(1);
        expect(summary.errors).toBe(0);
        expect(summary.closed).toBe(0);
    });
});

describe('happy path — the case is still genuinely abandoned at write time', () => {
    test('fresh re-read confirms closeable + invoice pending → EXPIRED write with the FRESH expectedVersion', async () => {
        mockTxAppFindUnique.mockResolvedValue({
            id: 'app-1',
            status: APPLICATION_STATUSES.PENDING_DOC_FEE,
            version: 7,
            formData: { plot: 'keep-me' },
            workflowHistory: [],
        });
        mockTxInvoiceFindUnique.mockResolvedValue({ status: 'pending' });

        const summary = await runPaymentClosureSweep();

        expect(mockWriteStatus).toHaveBeenCalledTimes(1);
        const writeArg = mockWriteStatus.mock.calls[0][0];
        expect(writeArg.toStatus).toBe(APPLICATION_STATUSES.EXPIRED);
        expect(writeArg.fromStatus).toBe(APPLICATION_STATUSES.PENDING_DOC_FEE);
        // expectedVersion is the FRESH (re-read) version, not the stale scan value 3.
        expect(writeArg.expectedVersion).toBe(7);
        expect(summary.closed).toBe(1);
        expect(summary.skipped).toBe(0);
        expect(summary.errors).toBe(0);
    });
});

describe('money-safety guard #3 (gateway truth, Task 6) — Stripe outranks a stale local PENDING invoice', () => {
    test('order PI already succeeded at Stripe -> SKIP before the close tx even opens, alert logged', async () => {
        mockCheckoutOrderFindFirst.mockResolvedValue({ stripePaymentIntentId: 'pi_paid' });
        mockGetPaymentIntent.mockResolvedValue({ status: 'succeeded' });

        const summary = await runPaymentClosureSweep();

        // The close tx must never even open once the gateway says PAID.
        expect(mockTransaction).not.toHaveBeenCalled();
        expect(mockWriteStatus).not.toHaveBeenCalled();
        expect(summary.closed).toBe(0);
        expect(summary.skipped).toBe(1);
        expect(summary.errors).toBe(0);
        expect(mockLogger.error).toHaveBeenCalledWith(
            expect.stringContaining('PAID-but-unsettled'),
            expect.objectContaining({ invoiceId: 'inv-1', applicationId: 'app-1' }),
        );
    });

    test('fail-SAFE: gateway unreachable -> SKIP (do not close), warning logged, no throw', async () => {
        mockCheckoutOrderFindFirst.mockResolvedValue({ stripePaymentIntentId: 'pi_unknown' });
        mockGetPaymentIntent.mockRejectedValue(new Error('Stripe unreachable'));

        const summary = await runPaymentClosureSweep();

        expect(mockTransaction).not.toHaveBeenCalled();
        expect(mockWriteStatus).not.toHaveBeenCalled();
        expect(summary.closed).toBe(0);
        expect(summary.skipped).toBe(1);
        expect(summary.errors).toBe(0);
        expect(mockLogger.warn).toHaveBeenCalled();
    });
});
