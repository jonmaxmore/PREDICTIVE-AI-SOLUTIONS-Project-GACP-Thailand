/**
 * renewal-load-error-retry.test.tsx — W1-RETRY acceptance test.
 *
 * Bug: with the backend down, `loadCertificate` failed SILENTLY
 * (`if (result.success && result.data) …` with no else, catch only
 * console.error'd). The applicant landed on the upload wizard with no
 * certificate card, no error, and no way to recover except a full page
 * reload. Live probe 2026-07-24 (correct-key HEALTH session, backend
 * 503): page rendered the upload step with zero error surface.
 *
 * Fix under test: a load failure (unsuccessful envelope OR throw) now
 * renders the amber indeterminate ServiceUnavailable pattern
 * (role="status", never a definitive bad state) with a retry action
 * that re-fires the SAME fetch, plus an escape hatch to the cert list.
 *
 * Harness mirrors renewal-certificate-envelope.test.tsx (createRoot +
 * act so the on-mount useEffect fetch fires under jsdom).
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

// Exact shape the real apiClient returns when the Next proxy answers
// 503 BACKEND_UNREACHABLE (backend down).
const UNREACHABLE_ENVELOPE = {
    success: false,
    error: 'ยังเชื่อมต่อระบบไม่ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง',
    status: 503,
    code: 'Backend service unavailable',
};

describe('RenewalPage — certificate load failure shows amber retry state (W1-RETRY)', () => {
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
            for (let i = 0; i < 10; i++) await Promise.resolve();
        });
        await act(async () => {
            for (let i = 0; i < 10; i++) await Promise.resolve();
        });
    }

    it('renders the amber role="status" card with a retry action on a 503 envelope (no silent wizard)', async () => {
        mockApiGet.mockResolvedValueOnce(UNREACHABLE_ENVELOPE);

        mount();
        await flush();

        const card = container!.querySelector('[data-testid="renewal-load-error"]');
        expect(card).not.toBeNull();
        // Indeterminate state — role=status, never a definitive verdict.
        expect(card!.getAttribute('role')).toBe('status');
        // Retry CTA present.
        const retry = container!.querySelector('[data-testid="renewal-load-retry"]');
        expect(retry).not.toBeNull();
        // The broken silent path rendered the docs list — it must be gone.
        expect(container!.innerHTML).not.toContain('เอกสารที่ต้องอัปโหลด');
    });

    it('retry re-fires the SAME certificate fetch and recovers into the wizard', async () => {
        mockApiGet
            .mockResolvedValueOnce(UNREACHABLE_ENVELOPE)
            .mockResolvedValueOnce({ success: true, data: CERT });

        mount();
        await flush();
        expect(mockApiGet).toHaveBeenCalledTimes(1);

        const retry = container!.querySelector<HTMLButtonElement>('[data-testid="renewal-load-retry"]');
        expect(retry).not.toBeNull();
        await act(async () => {
            retry!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await flush();

        // Same endpoint re-fired.
        expect(mockApiGet).toHaveBeenCalledTimes(2);
        expect(mockApiGet).toHaveBeenNthCalledWith(2, '/api/certificates/cert-42');
        // Recovered: the certificate card renders, error state gone.
        expect(container!.innerHTML).toContain('GACP-TH-2569-RENEW1');
        expect(container!.querySelector('[data-testid="renewal-load-error"]')).toBeNull();
    });

    it('renders the amber retry state when the fetch throws (network failure)', async () => {
        mockApiGet.mockRejectedValueOnce(new Error('network down'));

        mount();
        await flush();

        expect(container!.querySelector('[data-testid="renewal-load-error"]')).not.toBeNull();
        expect(container!.querySelector('[data-testid="renewal-load-retry"]')).not.toBeNull();
    });
});
