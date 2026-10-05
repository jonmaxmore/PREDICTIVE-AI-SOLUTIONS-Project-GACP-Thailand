/**
 * renewal-certificate-envelope.test.tsx — RD-FE-DATA-LOSS acceptance test.
 *
 * Bug class: the FE `apiClient` ALREADY unwraps one envelope level
 * (`res.data = body.data ?? body`, api-client.ts:410). The backend
 * `GET /api/certificates/:id` route returns a SINGLE-level envelope
 * `{ success: true, data: cert }` (certificates.js:236-239). The renewal
 * page used to read `result.data?.data` — one level too deep — so
 * `result.data` is already the certificate and `.data` is undefined.
 * Result: `setCertificate` was never called, the renewal UploadStep's
 * certificate card stayed hidden, and the applicant's cert number /
 * site never rendered.
 *
 * This test feeds the page the REAL single-level apiClient shape
 * (`{ success: true, data: cert }`) and asserts the certificate number
 * renders in the UploadStep card. It FAILS against the old
 * `result.data?.data` read and passes once the read is `result.data`.
 *
 * createRoot + act pattern (mirrors dashboard-layout-bell.test.tsx) so
 * the on-mount useEffect fetch fires under jsdom.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import RenewalPage from '../client-view';
import { LanguageProvider } from '@/lib/i18n/language-context';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApiGet = jest.fn();

jest.mock('@/lib/api', () => ({
    apiClient: {
        get: (...args: unknown[]) => mockApiGet(...args),
        post: jest.fn(),
    },
}));

// Truthy stored user so the page does not redirect to the login route.
jest.mock('@/lib/services/auth-service-session', () => ({
    getStoredUser: jest.fn(() => ({ id: 'u-1', name: 'ทดสอบ' })),
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
    useSearchParams: () => new URLSearchParams('certId=cert-42'),
}));

const CERT = {
    id: 'cert-42',
    certificateNumber: 'GACP-TH-2569-RENEW1',
    applicationId: 'app-9',
    siteName: 'ฟาร์มต่ออายุ',
    plantType: 'Cannabis',
    expiryDate: '2026-12-31T00:00:00.000Z',
    status: 'active',
};

describe('RenewalPage — single-level certificate envelope renders', () => {
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
            root.render(
                <LanguageProvider>
                    <RenewalPage />
                </LanguageProvider>,
            );
        });
    }

    async function flush() {
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });
    }

    it('renders the certificate number from the REAL single-level apiClient envelope', async () => {
        // Real apiClient already unwraps ONE level: result.data IS the cert.
        mockApiGet.mockResolvedValue({ success: true, data: CERT });

        mount();
        await flush();

        const html = container!.innerHTML;
        // The UploadStep renders the cert card only when `certificate` is set.
        expect(html).toContain('GACP-TH-2569-RENEW1');
        expect(html).toContain('ฟาร์มต่ออายุ');
    });
});
