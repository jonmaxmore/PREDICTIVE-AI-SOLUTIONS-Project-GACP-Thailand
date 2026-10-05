/**
 * B2 (design-cleanup-2026-08-21/07-BUG-HUNT.md) — the Void/Refund control
 * in the accounting invoice modal.
 *
 * TWO defects, both proved here:
 *
 *  1. WRONG ROUTE. The handler called `apiClient.patch('/invoices/:id')`.
 *     That route does not exist on the backend: `routes/api/index.js:154`
 *     mounts `finance/invoices.js`, which registers GET only (`:51 :75 :96
 *     :122 :146`) plus `invoice-payment-handlers.js` (POST hold/release +
 *     receipts). Live proof against preview.gacpth.com:
 *       PATCH /api/invoices/<id>                  -> 404 text/html "Cannot PATCH ..."
 *       POST  /api/finance/refunds/<id>/initiate  -> 401 application/json NO_TOKEN
 *     i.e. the 404 is a missing route, not an auth rejection. The real
 *     cancel/refund path is `routes/api/finance/refunds.js:49`.
 *
 *  2. UNCHECKED RESULT (systemic pattern P1). `api-client.ts` NEVER throws —
 *     every failure returns `{ success:false, ... }` (see its `request()`
 *     error branches). The handler's try/catch was therefore dead code, and
 *     `onClose()` + `onRefresh()` ran on failure exactly as on success, so
 *     finance staff saw a successful-looking close for an invoice that was
 *     never cancelled.
 *
 * Shape: the repo has @testing-library/jest-dom but NOT
 * @testing-library/react, so we render with `createRoot` + `act` and drive
 * clicks with dispatchEvent (same pattern as
 * `health/applications/preview/__tests__/resubmit-button-renders.test.tsx`).
 * Radix Dialog portals away, so the dialog primitives are mocked inline —
 * the documented workaround from `reopen-period-modal.test.tsx`.
 *
 * NOTE (LAW L3): this test asserts ONLY which URL is called and whether the
 * modal closes. It asserts nothing about amounts, credit notes or ledger
 * postings — those stay entirely in the backend refund-service.
 */

import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type ApiResult = { success: boolean; error?: string; code?: string; data?: unknown };

const mockPost = jest.fn<(url: string, body?: unknown) => Promise<ApiResult>>();
const mockPatch = jest.fn<(url: string, body?: unknown) => Promise<ApiResult>>();
const mockToastError = jest.fn<(msg: string) => void>();
const mockToastSuccess = jest.fn<(msg: string) => void>();

jest.mock('@/lib/api/api-client', () => ({
    apiClient: {
        post: (url: string, body?: unknown) => mockPost(url, body),
        patch: (url: string, body?: unknown) => mockPatch(url, body),
    },
}));

jest.mock('sonner', () => ({
    toast: {
        error: (msg: string) => mockToastError(msg),
        success: (msg: string) => mockToastSuccess(msg),
    },
}));

// Radix Dialog portals out of the container in jsdom — render inline.
jest.mock('@/components/ui/primitives/dialog', () => ({
    Dialog: ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
        open ? <div data-testid="dialog">{children}</div> : null,
    DialogContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    DialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
}));

import { InvoiceDetailModal } from '../invoice-detail-modal';
import type { InvoiceItem } from '../accounting-types';

const PAID_INVOICE: InvoiceItem = {
    id: 'inv-b2-fixture',
    invoiceNumber: 'INV-TEST-B2',
    applicationNumber: 'APP-TEST-B2',
    healthName: 'ผู้สมัครทดสอบ',
    amount: 5000,
    status: 'PAID',
    dueDate: '2026-08-30T00:00:00.000Z',
    paidAt: '2026-08-20T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
};

let container: HTMLDivElement;
let root: Root;
let onClose: ReturnType<typeof jest.fn>;
let onRefresh: ReturnType<typeof jest.fn>;

function renderModal() {
    act(() => {
        root.render(
            <InvoiceDetailModal
                invoice={PAID_INVOICE}
                onClose={onClose as unknown as () => void}
                onRefresh={onRefresh as unknown as () => void}
                formatCurrency={(n: number) => String(n)}
                formatDate={(v: string) => v}
                getStatusBadge={(s: string) => <span>{s}</span>}
                // write-capable viewer (finance_officer_platform / admin) — the DTAM finance
                // role gets canHold/canRefund=false (finance-one-view.test.tsx pins that)
                canHold
                canRefund
            />,
        );
    });
}

function findButton(text: string): HTMLButtonElement {
    const btn = Array.from(container.querySelectorAll('button')).find((b) =>
        (b.textContent || '').includes(text),
    );
    if (!btn) throw new Error(`button not found: ${text}`);
    return btn as HTMLButtonElement;
}

async function click(text: string) {
    const btn = findButton(text);
    await act(async () => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
}

/** Open the confirm pane and press the destructive confirm button. */
async function pressVoidRefund() {
    renderModal();
    await click('ยกเลิก / คืนเงิน (Void/Refund)');
    await click('ยืนยัน ยกเลิกรายการ');
}

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onClose = jest.fn();
    onRefresh = jest.fn();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockToastError.mockReset();
    mockToastSuccess.mockReset();
    mockPost.mockResolvedValue({ success: true, data: {} });
    mockPatch.mockResolvedValue({ success: true, data: {} });
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe('B2 defect 1 — the Void/Refund button must call a route that exists', () => {
    it('POSTs the real refund route (finance/refunds/:id/initiate), never PATCH /invoices/:id', async () => {
        await pressVoidRefund();

        expect(mockPatch).not.toHaveBeenCalled();
        expect(mockPost).toHaveBeenCalledTimes(1);
        expect(mockPost.mock.calls[0][0]).toBe(`/finance/refunds/${PAID_INVOICE.id}/initiate`);
    });

    it('sends the reason + reasonCode that refund-service requires (refund-service.js:272-277)', async () => {
        await pressVoidRefund();

        const body = mockPost.mock.calls[0][1] as { reason?: string; reasonCode?: string };
        expect(typeof body.reason).toBe('string');
        expect((body.reason || '').trim().length).toBeGreaterThanOrEqual(3);
        // credit-note-service.js:84-89 VALID_REASON_CODES
        expect(['CANCELLATION', 'PRICE_REDUCTION', 'CORRECTION', 'RETURN']).toContain(body.reasonCode);
    });

    it('does not send an amount — the credit-note figure belongs to the backend (LAW L3)', async () => {
        await pressVoidRefund();

        const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
        expect(Object.keys(body)).not.toContain('amount');
        expect(Object.keys(body)).not.toContain('totalAmount');
    });
});

describe('B2 defect 2 — the modal must not claim success on a failed response', () => {
    it('keeps the modal open and surfaces the error when the refund is rejected', async () => {
        mockPost.mockResolvedValue({
            success: false,
            error: 'Refund requires a PAID invoice',
            code: 'INVOICE_NOT_PAID',
        });

        await pressVoidRefund();

        expect(onClose).not.toHaveBeenCalled();
        expect(onRefresh).not.toHaveBeenCalled();
        expect(mockToastError).toHaveBeenCalled();
    });

    it('closes and refreshes only when the backend actually succeeded', async () => {
        mockPost.mockResolvedValue({ success: true, data: { refundStatus: 'INITIATED' } });

        await pressVoidRefund();

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(mockToastError).not.toHaveBeenCalled();
    });

    it('hold: a 403 must not close the modal as though the invoice were held', async () => {
        mockPost.mockResolvedValue({ success: false, error: 'Forbidden', code: 'FORBIDDEN' });
        renderModal();

        await click('ระงับ / Hold (Finance)');

        expect(mockPost.mock.calls[0][0]).toBe(`/invoices/${PAID_INVOICE.id}/hold`);
        expect(onClose).not.toHaveBeenCalled();
        expect(onRefresh).not.toHaveBeenCalled();
        expect(mockToastError).toHaveBeenCalled();
    });
});
