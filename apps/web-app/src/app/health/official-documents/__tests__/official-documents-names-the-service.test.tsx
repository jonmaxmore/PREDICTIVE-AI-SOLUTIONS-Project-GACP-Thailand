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


/** round 5 (review): the subtitle names the row's service from the server (`service`). */
describe('official documents name each invoice by its service', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
    afterEach(() => { act(() => root.unmount()); container.remove(); });

    it('a renewal invoice reads ค่าบริการต่ออายุใบรับรอง, never the phase-2 name', async () => {
        mockApiGet.mockImplementation((url: string) => {
            if (url === '/api/invoices/my') {
                return Promise.resolve({ success: true, data: [{
                    id: 'r1', invoiceNumber: 'INV-CO-RENEW001-M2', amount: 70620, status: 'pending',
                    serviceType: 'CERTIFICATION_CHECKOUT_M2', createdAt: '2026-10-03T00:00:00.000Z',
                    service: { key: 'RENEWAL', name: 'ค่าบริการต่ออายุใบรับรอง', coverage: 'ครอบคลุม: x' },
                }] });
            }
            return Promise.resolve({ success: true, data: [] });
        });
        await act(async () => { root.render(<OfficialDocumentsPage />); });
        for (let i = 0; i < 8; i += 1) { await act(async () => { await Promise.resolve(); }); }
        const text = (container.textContent || '').replace(/\s+/g, ' ');
        expect(text).toContain('ค่าบริการต่ออายุใบรับรอง');
        expect(text).not.toContain('ค่าบริการตรวจประเมินแปลงและออกใบรับรอง');
        expect(text).not.toContain('ค่าบริการตรวจสอบเอกสาร');
    });
});
