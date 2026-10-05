/**
 * official-documents-envelope.test.tsx — RD-FE-DATA-LOSS acceptance test.
 *
 * Bug class: the FE `apiClient` ALREADY unwraps one envelope level
 * (`res.data = body.data ?? body`, api-client.ts:410). The backend
 * `/api/certificates/my` and `/api/invoices/my` routes return a
 * SINGLE-level envelope `{ success: true, data: [...] }`
 * (certificates.js:144-147, invoices.js:82). The page used to read
 * `certsRes.data?.data` / `invoicesRes.data?.data` — one level too
 * deep — so `res.data` is already the array and `.data` is undefined.
 * Result: the official-documents screen rendered EMPTY for users who
 * actually have certificates / invoices.
 *
 * This test feeds the page the REAL single-level apiClient shape
 * (`{ success: true, data: [cert] }`) and asserts the cert + invoice
 * DATA renders (and the empty-state does NOT). It FAILS against the
 * old `res.data?.data` read and passes once the read is `res.data`.
 *
 * createRoot + act pattern (mirrors dashboard-layout-bell.test.tsx) so
 * the on-mount useEffect fetch fires under jsdom.
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
    apiClient: {
        get: (...args: unknown[]) => mockApiGet(...args),
    },
}));

jest.mock('@/lib/services/auth-service', () => ({
    AuthService: {
        // Truthy user so the page does not redirect to /auth/health/login.
        getUser: jest.fn(() => ({ id: 'u-1', name: 'ทดสอบ' })),
    },
}));

// Return a STABLE router object — the page's load effect depends on
// `[router]`, so a fresh object per render would re-fire the fetch and
// spin an infinite render loop under jsdom (the real Next router is stable).
// `mock`-prefixed so jest's hoisting allows the out-of-scope reference.
const mockStableRouter = { replace: jest.fn(), push: jest.fn() };
jest.mock('next/navigation', () => ({
    useRouter: () => mockStableRouter,
}));

// sonner toast is a side-effect-only dependency in this page; stub it.
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const CERT = {
    id: 'cert-1',
    certificateNumber: 'GACP-TH-2569-AAA111',
    farmName: 'ฟาร์มทดสอบ',
    cropType: 'Cannabis',
    status: 'active',
    issuedDate: '2026-01-15T00:00:00.000Z',
    expiryDate: '2029-01-14T00:00:00.000Z',
    pdfGenerated: true,
};

const INVOICE = {
    id: 'inv-1',
    invoiceNumber: 'INV-2569-0001',
    amount: 5535,
    status: 'PAID',
    phase: 'phase1',
    createdAt: '2026-01-10T00:00:00.000Z',
    paidAt: '2026-01-11T00:00:00.000Z',
};

describe('OfficialDocumentsPage — single-level envelope data renders', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        if (root) {
            act(() => {
                root?.unmount();
            });
            root = null;
        }
        if (container) {
            container.remove();
            container = null;
        }
    });

    function mount() {
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root.render(<OfficialDocumentsPage />);
        });
    }

    async function flush() {
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });
    }

    it('renders certificate + invoice rows from the REAL single-level apiClient envelope', async () => {
        // Real apiClient already unwraps ONE level: res.data IS the array.
        mockApiGet.mockImplementation((url: string) => {
            if (url === '/api/certificates/my') {
                return Promise.resolve({ success: true, data: [CERT] });
            }
            if (url === '/api/invoices/my') {
                return Promise.resolve({ success: true, data: [INVOICE] });
            }
            return Promise.resolve({ success: true, data: [] });
        });

        mount();
        await flush();

        const html = container!.innerHTML;
        // The certificate number must surface in the rendered card title.
        expect(html).toContain('GACP-TH-2569-AAA111');
        // The invoice/receipt number must surface too.
        expect(html).toContain('INV-2569-0001');
        // And the "no documents" empty-state must NOT be shown.
        expect(html).not.toContain('ยังไม่มีเอกสารทางการ');
    });
});
