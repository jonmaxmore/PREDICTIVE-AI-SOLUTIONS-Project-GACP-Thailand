/**
 * X1-FIX-C / H-2 — /health/applications silent-error regression guard.
 *
 * Before X1-FIX-C the applications list rendered a tiny one-line
 * destructive-text card on error (easy to scroll past) and the catch
 * handler had no retry CTA. The fix replaces that with a prominent
 * rose-bordered card carrying data-testid="applications-list-error" +
 * a retry button so an outage no longer reads as "no applications".
 *
 * Strategy: createRoot + act, with the api-client mocked at the same
 * import path the page uses (`@/lib/api/api-client`).
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {

    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApiGet = jest.fn<(url: string) => Promise<unknown>>();
const mockApiDelete = jest.fn<(url: string) => Promise<unknown>>();
jest.mock('@/lib/api/api-client', () => ({
    apiClient: {
        get: (url: string) => mockApiGet(url),
        delete: (url: string) => mockApiDelete(url),
    },
    api: {
        get: (url: string) => mockApiGet(url),
        delete: (url: string) => mockApiDelete(url),
    },
}));

jest.mock('@/lib/services/auth-service', () => ({
    AuthService: {
        getUser: () => ({
            id: 'user-1',
            role: 'HEALTH',
            email: 'farmer@test',
        }),
    },
}));

// CRITICAL: stable router/searchParams so the page's
// `useEffect(loadApplications, [router, searchParams])` doesn't loop.
// (See payments-states.test.tsx for the same pattern.)
jest.mock('next/navigation', () => {
    const router = {
        push: jest.fn(),
        replace: jest.fn(),
        refresh: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        prefetch: jest.fn(),
        pathname: '/',
        query: {},
    };
    const searchParams = new URLSearchParams();
    return {
        useRouter: () => router,
        usePathname: () => '/',
        useSearchParams: () => searchParams,
    };
});

import ApplicationsPage from '../client-view';
import { LanguageProvider } from '@/lib/i18n/language-context';

describe('[X1-FIX-C / H-2] /health/applications — error state regression guard', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        try {
            window.localStorage.removeItem('language');
        } catch {
            /* ignore */
        }
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
                    <ApplicationsPage />
                </LanguageProvider>,
            );
        });
    }

    it('renders the rose error card with retry CTA when the envelope reports success=false', async () => {
        mockApiGet.mockResolvedValueOnce({
            success: false,
            error: 'เซิร์ฟเวอร์รายการคำขอไม่ตอบสนอง',
        });
        mount();
        // Flush several rounds so the api promise + setLoading(false)
        // settle. React 18 concurrent rendering needs multiple rounds.
        await act(async () => {
            for (let i = 0; i < 10; i++) await Promise.resolve();
        });
        await act(async () => {
            for (let i = 0; i < 10; i++) await Promise.resolve();
        });

        const errCard = container!.querySelector('[data-testid="applications-list-error"]');
        expect(errCard).not.toBeNull();
        expect(errCard!.textContent).toContain('เซิร์ฟเวอร์รายการคำขอไม่ตอบสนอง');
        // The retry CTA must be present so the user can recover without refresh.
        expect(errCard!.textContent).toContain('ลองอีกครั้ง');
    });

    it('renders the error card when the fetch throws', async () => {
        mockApiGet.mockRejectedValueOnce(new Error('network outage'));
        mount();
        // Flush several rounds so the api promise + setLoading(false)
        // settle. React 18 concurrent rendering needs multiple rounds.
        await act(async () => {
            for (let i = 0; i < 10; i++) await Promise.resolve();
        });
        await act(async () => {
            for (let i = 0; i < 10; i++) await Promise.resolve();
        });

        const errCard = container!.querySelector('[data-testid="applications-list-error"]');
        expect(errCard).not.toBeNull();
        // The TH fallback hint surfaces (loadErrorRetry).
        expect(errCard!.textContent).toContain('เกิดข้อผิดพลาดในการโหลดรายการคำขอ');
    });
});
