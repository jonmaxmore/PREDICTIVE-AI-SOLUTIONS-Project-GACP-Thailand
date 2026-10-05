/**
 * official-documents-invoice-status.test.tsx — the หน้าเอกสารทางการ reads the register's
 * own words, not one hand-typed pair of them.
 *
 * This page fetches `/api/invoices/my` RAW — it does not go through PaymentService — and
 * then decided everything the farmer sees from two literals: `status === 'PAID'` and
 * `status === 'PENDING'`. The register does not speak only those two words:
 *
 *   - the same word is not stored in the same case everywhere. Measured 2026-09-10: the
 *     demo/prod register holds `paid` and `pending` lower-case, staging holds `PAID` and
 *     `PENDING` upper-case. On demo the comparison therefore missed, and the Thai screen
 *     printed the English word `pending` in the status column, in the grey
 *     "unrecognised" tone — while a `paid` bill was titled ใบแจ้งหนี้ with its download
 *     refused.
 *   - a settled bill is stored `RECEIPT_ISSUED` once its receipt is allocated
 *     (invoice-service.js:430). It matched neither literal, so a receipted document was
 *     titled ใบแจ้งหนี้, stamped with the raw enum, and its download refused.
 *   - `CANCELLED` matched neither either, so a voided bill sat there looking like any
 *     other unrecognised row — next to nothing telling the farmer not to pay it. That is
 *     the operator's "จ่ายซ้ำได้อีก งง มาก" (2026-09-10) one screen over.
 *
 * The fix is not a third literal: it is reading the ONE vocabulary the invoice mapper
 * already owns (payment-service.ts), which normalises case and knows every settled word.
 *
 * Scaffold per official-documents-envelope.test.tsx in this folder.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import OfficialDocumentsPage from '../client-view';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApiGet = jest.fn();

jest.mock('@/lib/api/api-client', () => ({
    apiClient: { get: (...args: unknown[]) => mockApiGet(...args) },
}));

jest.mock('@/lib/services/auth-service', () => ({
    AuthService: { getUser: jest.fn(() => ({ id: 'u-1', name: 'ทดสอบ' })) },
}));

const mockStableRouter = { replace: jest.fn(), push: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => mockStableRouter }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const PAID_LABEL = 'ชำระแล้ว';
const PENDING_LABEL = 'รอชำระ';
const CANCELLED_LABEL = 'ยกเลิก';

function invoice(id: string, status: string, paid: boolean): Record<string, unknown> {
    return {
        id,
        invoiceNumber: `INV-2569-${id}`,
        amount: 5535,
        status,
        phase: 'phase1',
        createdAt: '2026-07-16T00:00:00.000Z',
        ...(paid ? { paidAt: '2026-07-20T00:00:00.000Z' } : {}),
    };
}

describe('OfficialDocumentsPage reads the register’s own invoice words', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    function serve(invoices: unknown[]): void {
        mockApiGet.mockImplementation((url: string) => {
            if (url === '/api/invoices/my') return Promise.resolve({ success: true, data: invoices });
            return Promise.resolve({ success: true, data: [] });
        });
    }

    beforeEach(() => { jest.clearAllMocks(); });

    afterEach(() => {
        if (root) { act(() => { root?.unmount(); }); root = null; }
        if (container) { container.remove(); container = null; }
    });

    async function mountPage(): Promise<string> {
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root.render(<OfficialDocumentsPage />);
        });
        await act(async () => {
            await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        });
        return container!.innerHTML;
    }

    it('calls a lower-case `pending` bill รอชำระ, and never prints the English word', async () => {
        serve([invoice('a', 'pending', false)]);
        const html = await mountPage();

        expect(html).toContain(PENDING_LABEL);
        expect(html).not.toContain('pending');
    });

    it('treats RECEIPT_ISSUED as settled — a receipt, downloadable, labelled ชำระแล้ว', async () => {
        serve([invoice('b', 'RECEIPT_ISSUED', true)]);
        const html = await mountPage();

        expect(html).toContain(`ใบเสร็จ INV-2569-b`);
        expect(html).not.toContain(`ใบแจ้งหนี้ INV-2569-b`);
        expect(html).toContain(PAID_LABEL);
        expect(html).not.toContain('RECEIPT_ISSUED');
        // The download control is live for a settled document.
        expect(container!.querySelector('button[disabled]')).toBeNull();
    });

    it('PAID is still settled — the word that already worked keeps working', async () => {
        serve([invoice('c', 'PAID', true)]);
        const html = await mountPage();

        expect(html).toContain(`ใบเสร็จ INV-2569-c`);
        expect(html).toContain(PAID_LABEL);
    });

    it('a lower-case `paid` is settled too — that is how demo/prod stores it today', async () => {
        // The live case, measured 2026-09-10. Under the old `=== 'PAID'` read, a farmer
        // on demo saw their settled bill titled ใบแจ้งหนี้, stamped with the English word
        // `paid`, and its download refused.
        serve([invoice('e', 'paid', true)]);
        const html = await mountPage();

        expect(html).toContain(`ใบเสร็จ INV-2569-e`);
        expect(html).not.toContain(`ใบแจ้งหนี้ INV-2569-e`);
        expect(html).toContain(PAID_LABEL);
        expect(html).not.toContain('paid');
    });

    it('erpStatus leads: a row voided after receipting is ยกเลิก, not ชำระแล้ว', async () => {
        // toErpStatus (invoice-service.js:74) answers RECEIPT_ISSUED for ANY row holding
        // a receipt number. A voided one must not inherit the settled reading.
        serve([{ ...invoice('f', 'CANCELLED', true), erpStatus: 'CANCELLED' }]);
        const html = await mountPage();

        expect(html).toContain(CANCELLED_LABEL);
        expect(html).not.toContain(PAID_LABEL);
        expect(html).not.toContain(`ใบเสร็จ INV-2569-f`);
    });

    it('names a cancelled bill ยกเลิก, so nobody pays a dead document twice', async () => {
        serve([invoice('d', 'CANCELLED', false)]);
        const html = await mountPage();

        expect(html).toContain(CANCELLED_LABEL);
        expect(html).not.toContain(PENDING_LABEL);
        expect(html).not.toContain('CANCELLED');
    });
});
