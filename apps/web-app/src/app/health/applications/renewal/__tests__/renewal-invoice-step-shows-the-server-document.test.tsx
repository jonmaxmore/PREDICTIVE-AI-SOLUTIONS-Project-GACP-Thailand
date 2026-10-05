/**
 * The renewal wizard's invoice step shows the register's document, or none.
 *
 * Before (fix/fees-from-server round 1, 2026-10-03) this step printed a
 * document the browser invented: `INV-${Date.now()}` as the number, today as
 * its date, today + 7 days as its due date, and the per-cultivation-type
 * renewal price as "ยอดรวมที่ต้องชำระ" whatever the number of types. Now:
 *   - an invoice for this renewal exists: its own number and its own total;
 *   - none yet, but a quotation: no document number, the quotation's own
 *     number and total, and what happens next;
 *   - neither: no number at all, and what happens next;
 *   - the read failed: say so, offer a retry, show no number.
 */

import * as React from 'react';
import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Envelope = { success: boolean; data?: unknown; error?: string };
const mockGet = jest.fn<(path: string) => Promise<Envelope>>();
jest.mock('@/lib/api/api-client', () => {
    const api = { get: (path: string) => mockGet(path), post: jest.fn(), getBlob: jest.fn() };
    return { api, apiClient: api };
});

import { InvoiceStep } from '../invoice-step';
import { LanguageProvider } from '@/lib/i18n/language-context';

const RENEWAL_ID = 'renewal-app-77';

const INVOICE = {
    id: 'inv-77',
    invoiceNumber: 'INV-PRD-2569-000777',
    applicationId: RENEWAL_ID,
    serviceType: 'CERTIFICATION_CHECKOUT_M1',
    totalAmount: '70620.00',
    status: 'pending',
    createdAt: '2026-10-01T03:00:00.000Z',
};
const OTHER_APP_INVOICE = { ...INVOICE, id: 'inv-x', invoiceNumber: 'INV-PRD-2569-000001', applicationId: 'other-app', totalAmount: '5885.00' };
const QUOTATION = {
    id: 'qt-77',
    applicationId: RENEWAL_ID,
    issuerType: 'PLATFORM',
    quotationNumber: 'QT-PRD-2569-000077',
    subtotal: '66000.00',
    vat: '4620.00',
    totalAmount: '70620.00',
    status: 'SENT',
};

function route(map: Record<string, Envelope>) {
    mockGet.mockImplementation(async (path: string) => {
        for (const [prefix, answer] of Object.entries(map)) {
            if (path.includes(prefix)) return answer;
        }
        return { success: false, error: 'unrouted ' + path };
    });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    mockGet.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

async function mount(): Promise<string> {
    await act(async () => {
        root.render(
            <LanguageProvider>
                <InvoiceStep certificate={null} renewalId={RENEWAL_ID} isDark={false} onBack={() => undefined} onProceed={() => undefined} />
            </LanguageProvider>,
        );
    });
    for (let i = 0; i < 3; i += 1) {
        await act(async () => {
            await Promise.resolve();
        });
    }
    return (container.textContent || '').replace(/\s+/g, ' ');
}

/** The browser-made number this step used to print. */
const INVENTED = /INV-[0-9A-Z]{6}(?![0-9A-Z-])/;

describe('renewal invoice step', () => {
    it('prints the invoice the register holds for this renewal: its number and its total', async () => {
        route({ '/invoices/my': { success: true, data: [OTHER_APP_INVOICE, INVOICE] } });
        const text = await mount();
        expect(text).toContain('INV-PRD-2569-000777');
        expect(text).toContain('70,620');
        expect(text).not.toContain('INV-PRD-2569-000001');
        expect(text).not.toMatch(INVENTED);
    });

    it('with no invoice yet: no document number, the quotation number and total, and what happens next', async () => {
        route({
            '/invoices/my': { success: true, data: [OTHER_APP_INVOICE] },
            '/quotations': { success: true, data: { dtam: null, platform: QUOTATION } },
        });
        const text = await mount();
        expect(text).not.toMatch(INVENTED);
        expect(text).not.toContain('INV-PRD');
        expect(text).toContain('ยังไม่มีใบแจ้งหนี้');
        expect(text).toContain('QT-PRD-2569-000077');
        expect(text).toContain('70,620');
    });

    it('with neither: no number of any kind, and what happens next', async () => {
        route({
            '/invoices/my': { success: true, data: [] },
            '/quotations': { success: true, data: { dtam: null, platform: null } },
        });
        const text = await mount();
        expect(text).not.toMatch(INVENTED);
        expect(text).toContain('ยังไม่มีใบแจ้งหนี้');
        expect(text).not.toMatch(/[0-9],[0-9]{3}/);
    });

    it('when the read fails: says so, offers a retry, prints no number', async () => {
        route({ '/invoices/my': { success: false, error: 'boom' } });
        const text = await mount();
        expect(text).not.toMatch(INVENTED);
        expect(text).toContain('ลองอีกครั้ง');
        expect(text).not.toMatch(/[0-9],[0-9]{3}/);
    });
});

/**
 * Round 5 (review IMPORTANT, 2026-10-03): with a real invoice number on it,
 * the browser-drawn "document" was a finance paper with the wrong issuer: its
 * header named the ministry and it offered "พิมพ์ใบวางบิล". Finance paper is
 * issued only by the backend pipeline (company issuer, logo, payer block), so
 * the step shows the facts on screen and hands the paper to the server PDF door
 * the payments page uses (GET /api/invoices/:id/pdf).
 */
describe('renewal invoice step prints no finance paper of its own', () => {
    const fetchMock = jest.fn<(url: string, init?: unknown) => Promise<unknown>>();
    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob(['%PDF']) });
        (globalThis as { fetch?: unknown }).fetch = fetchMock;
        (window.URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
        (window.URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
    });

    it('names no ministry and no billing note, and offers the server document', async () => {
        route({ '/invoices/my': { success: true, data: [INVOICE] } });
        const text = await mount();
        expect(text).toContain('INV-PRD-2569-000777');
        expect(text).not.toContain('Department of Thai Traditional');
        expect(text).not.toContain('Ministry of Public Health');
        expect(text).not.toContain('กรมการแพทย์แผนไทย');
        expect(text).not.toContain('ใบวางบิล');
        const download = Array.from(container.querySelectorAll('button')).find((b) => (b.textContent || '').includes('ดาวน์โหลดใบแจ้งหนี้'));
        expect(download).toBeDefined();
        await act(async () => {
            download!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/invoices/inv-77/pdf');
    });

    it('with no invoice there is nothing to print or download', async () => {
        route({
            '/invoices/my': { success: true, data: [] },
            '/quotations': { success: true, data: { dtam: null, platform: QUOTATION } },
        });
        const text = await mount();
        expect(text).not.toContain('ดาวน์โหลดใบแจ้งหนี้');
        expect(text).not.toContain('ใบวางบิล');
        expect(text).not.toMatch(/พิมพ์/);
    });
});
