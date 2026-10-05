/**
 * B2 ADVERSARIAL VERIFICATION (design-cleanup-2026-08-21).
 *
 * The fixer's suite covers refund-happy, refund-rejected and hold-403.
 * This file attacks what it did NOT cover:
 *   - the RELEASE handler (claimed fixed at invoice-detail-modal.tsx:86-90,
 *     never asserted),
 *   - success paths for hold/release (over-restriction regression: the new
 *     `if (!res.success) return` must not strand a modal whose call worked),
 *   - a transport failure (api-client returns {success:false} with a generic
 *     string — no `code`),
 *   - a {success:false} with NO error field (does the toast say "undefined"?),
 *   - retry after a rejection (isRefunding must be released by `finally`),
 *   - a double press in one tick (two POSTs = two credit notes),
 *   - which invoice states render the button at all.
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

jest.mock('@/components/ui/primitives/dialog', () => ({
    Dialog: ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
        open ? <div data-testid="dialog">{children}</div> : null,
    DialogContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    DialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
}));

import { InvoiceDetailModal } from '../invoice-detail-modal';
import type { InvoiceItem } from '../accounting-types';

/** Live shape (preview.gacpth.com, 2026-08-23): a paid invoice is
 *  status=paid + erpStatus=PAID_PENDING_RECEIPT. */
const PAID: InvoiceItem = {
    id: 'inv-adv',
    invoiceNumber: 'INV-ADV',
    applicationNumber: 'APP-ADV',
    healthName: 'ผู้สมัคร',
    amount: 5000,
    status: 'paid',
    erpStatus: 'PAID_PENDING_RECEIPT',
    dueDate: '2026-08-30T00:00:00.000Z',
    paidAt: '2026-08-20T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
};

let container: HTMLDivElement;
let root: Root;
let onClose: ReturnType<typeof jest.fn>;
let onRefresh: ReturnType<typeof jest.fn>;

function renderModal(invoice: InvoiceItem = PAID) {
    act(() => {
        root.render(
            <InvoiceDetailModal
                invoice={invoice}
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

function maybeButton(text: string): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll('button')).find((b) =>
        (b.textContent || '').includes(text),
    ) as HTMLButtonElement | undefined;
}

function findButton(text: string): HTMLButtonElement {
    const btn = maybeButton(text);
    if (!btn) throw new Error(`button not found: ${text}`);
    return btn;
}

async function click(text: string) {
    const btn = findButton(text);
    await act(async () => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
}

async function pressRefund() {
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
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe('B2-ADV — the RELEASE handler (untested by the fixer)', () => {
    const HELD: InvoiceItem = { ...PAID, status: 'HELD', erpStatus: 'HELD' };

    it('a failed release must not close the modal', async () => {
        mockPost.mockResolvedValue({ success: false, error: 'Forbidden', code: 'FORBIDDEN' });
        renderModal(HELD);

        await click('ปลดล็อก (Release Hold)');

        expect(mockPost.mock.calls[0][0]).toBe(`/invoices/${HELD.id}/release`);
        expect(onClose).not.toHaveBeenCalled();
        expect(onRefresh).not.toHaveBeenCalled();
        expect(mockToastError).toHaveBeenCalled();
    });

    it('REGRESSION GUARD — a successful release still closes + refreshes', async () => {
        mockPost.mockResolvedValue({ success: true, data: { id: HELD.id } });
        renderModal(HELD);

        await click('ปลดล็อก (Release Hold)');

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(mockToastSuccess).toHaveBeenCalled();
        expect(mockToastError).not.toHaveBeenCalled();
    });
});

describe('B2-ADV — over-restriction regression on the success paths', () => {
    it('a successful hold still closes + refreshes', async () => {
        mockPost.mockResolvedValue({ success: true, data: { id: PAID.id } });
        renderModal();

        await click('ระงับ / Hold (Finance)');

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('a successful refund still closes + refreshes', async () => {
        mockPost.mockResolvedValue({ success: true, data: { refundStatus: 'INITIATED' } });
        renderModal();

        await pressRefund();

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });
});

describe('B2-ADV — failure shapes the fixer did not consider', () => {
    it('transport failure (no code, generic string) keeps the modal open', async () => {
        // api-client.ts network branch: { success:false, error:'Unable to connect to server' }
        mockPost.mockResolvedValue({ success: false, error: 'Unable to connect to server' });
        renderModal();

        await pressRefund();

        expect(onClose).not.toHaveBeenCalled();
        expect(mockToastError).toHaveBeenCalledWith('Unable to connect to server');
    });

    it('a {success:false} with NO error field must not print "undefined" to the accountant', async () => {
        mockPost.mockResolvedValue({ success: false });
        renderModal();

        await pressRefund();

        const msg = String(mockToastError.mock.calls[0][0]);
        expect(msg).not.toContain('undefined');
        expect(msg).not.toBe('');
        expect(onClose).not.toHaveBeenCalled();
    });

    it('after a rejection the confirm pane stays open and a retry can succeed', async () => {
        mockPost.mockResolvedValueOnce({ success: false, error: 'INVOICE_NOT_PAID' });
        renderModal();
        await pressRefund();

        // still on the confirm pane (setRefundConfirm was not cleared) and the
        // confirm button is re-enabled (isRefunding released by `finally`)
        const confirmBtn = findButton('ยืนยัน ยกเลิกรายการ');
        expect(confirmBtn.disabled).toBe(false);

        mockPost.mockResolvedValueOnce({ success: true, data: {} });
        await click('ยืนยัน ยกเลิกรายการ');

        expect(mockPost).toHaveBeenCalledTimes(2);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('RACE — two confirm presses inside one tick: how many refunds are initiated?', async () => {
        let resolveFirst: ((v: ApiResult) => void) | null = null;
        mockPost.mockImplementationOnce(
            () => new Promise<ApiResult>((r) => { resolveFirst = r; }),
        );
        mockPost.mockResolvedValue({ success: true, data: {} });

        renderModal();
        await click('ยกเลิก / คืนเงิน (Void/Refund)');
        const confirmBtn = findButton('ยืนยัน ยกเลิกรายการ');

        await act(async () => {
            confirmBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            confirmBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        // DOCUMENTED OUTCOME, not an aspiration. `disabled={isRefunding}` is a
        // re-render guard: both handlers run before React repaints, so TWO
        // POST /finance/refunds/:id/initiate leave the browser for one invoice.
        // The backend's only defence is refund-service.js:320-330, a
        // read-then-write on Invoice.metadata with no unique constraint — two
        // concurrent initiates can both miss the existing block and each mint a
        // ใบลดหนี้. Harmless while the button was a no-op; live now.
        expect(mockPost).toHaveBeenCalledTimes(2);
        await act(async () => { resolveFirst?.({ success: true, data: {} }); });
    });

    it('a HUMAN double-click is blocked — the button is disabled while in flight', async () => {
        let resolveFirst: ((v: ApiResult) => void) | null = null;
        mockPost.mockImplementationOnce(
            () => new Promise<ApiResult>((r) => { resolveFirst = r; }),
        );

        renderModal();
        await click('ยกเลิก / คืนเงิน (Void/Refund)');
        await click('ยืนยัน ยกเลิกรายการ');

        // second click arrives in a LATER task — React has re-rendered by then
        expect(findButton('กำลังดำเนินการ...').disabled).toBe(true);
        expect(mockPost).toHaveBeenCalledTimes(1);
        await act(async () => { resolveFirst?.({ success: true, data: {} }); });
    });
});

describe('B2-ADV — which invoice states offer the button at all', () => {
    it('PENDING (the state named in the bug report) never shows Void/Refund', async () => {
        renderModal({ ...PAID, status: 'pending', erpStatus: 'PENDING' });
        expect(maybeButton('ยกเลิก / คืนเงิน (Void/Refund)')).toBeUndefined();
        expect(maybeButton('ระงับ / Hold (Finance)')).toBeDefined();
    });

    it('RECEIPT_ISSUED — a fully paid invoice with a receipt has NO refund control', async () => {
        renderModal({ ...PAID, status: 'paid', erpStatus: 'RECEIPT_ISSUED' });
        // refund-service accepts it (invoice.status === 'paid') but the UI hides
        // the button: normalizeInvoiceStatus() === 'RECEIPT_ISSUED', which does
        // not contain 'PAID'.
        expect(maybeButton('ยกเลิก / คืนเงิน (Void/Refund)')).toBeUndefined();
    });

    it('UNPAID would show the button — .includes("PAID") is a substring test', async () => {
        renderModal({ ...PAID, status: 'UNPAID', erpStatus: 'UNPAID' });
        expect(maybeButton('ยกเลิก / คืนเงิน (Void/Refund)')).toBeDefined();
    });
});
