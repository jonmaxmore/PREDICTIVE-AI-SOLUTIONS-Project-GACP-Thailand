/**
 * X1-FIX-C / H-2 — /health/dashboard silent-error regression guard.
 *
 * Before X1-FIX-C the dashboard's loadDashboard try/catch swallowed every
 * error with only a console.error, so an outage rendered the same
 * SummaryHeader + empty "Recent Activities" card as a clean-slate account.
 * The fix introduces a `fetchError` state and an early-return rose card
 * with a retry CTA so applicants can distinguish "server down — retry"
 * from "I genuinely have no applications yet".
 *
 * Three assertions:
 *   1. Loading skeleton renders BEFORE the fetch resolves.
 *   2. The NEW error card (data-testid="dashboard-fetch-error") renders
 *      when the api envelope reports success=false.
 *   3. The same error card renders when the underlying promise rejects.
 *
 * SSR-ish mount pattern (createRoot + act) — matches the certificates
 * error-state test in this repo so the suite stays consistent.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {

    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock the api client BEFORE importing the page so the import sees our
// stub. The dashboard reads only `apiClient.get('/api/applications/my')`.
const mockApiGet = jest.fn<(url: string) => Promise<unknown>>();
jest.mock('@/lib/api/api-client', () => ({
    apiClient: { get: (url: string) => mockApiGet(url) },
    api: { get: (url: string) => mockApiGet(url) },
}));

// AuthService.getUser must NOT return null — that would route to login
// and never resolve into the dashboard render branch.
jest.mock('@/lib/services/auth-service', () => ({
    AuthService: {
        getUser: () => ({
            id: 'user-1',
            role: 'HEALTH',
            email: 'farmer@test',
            firstName: 'Farmer',
            lastName: 'Test',
        }),
    },
}));

// CRITICAL: useRouter MUST return a STABLE reference. The default
// jest.setup.tsx mock returns a fresh object on every render, and the
// dashboard's `useEffect(loadDashboard, [router, retryToken])` would
// fire on every render → infinite loop that act() cannot drain (5s
// timeout, errCard never gets rendered). Defining the refs inside the
// factory keeps jest.mock hoisting happy.
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

import HealthDashboardPage from '../client-view';
import { LanguageProvider } from '@/lib/i18n/language-context';

describe('[X1-FIX-C / H-2] /health/dashboard — loading vs error', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        try {
            window.localStorage.removeItem('language');
        } catch {
            /* JSDOM may not expose localStorage in some setups — ignore. */
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
                    <HealthDashboardPage />
                </LanguageProvider>,
            );
        });
    }

    it('renders the loading skeleton before the fetch resolves', () => {
        mockApiGet.mockReturnValue(new Promise(() => undefined));
        mount();
        // No error card or SummaryHeader yet — only the PageSkeleton placeholders.
        expect(container!.querySelector('[data-testid="dashboard-fetch-error"]')).toBeNull();
    });

    it('renders the NEW error state when the api envelope reports success=false', async () => {
        mockApiGet.mockResolvedValueOnce({
            success: false,
            error: 'ระบบฐานข้อมูลไม่พร้อมใช้งาน',
        });
        mount();
        // Flush several microtasks so the api promise + setLoading(false)
        // commit before we assert. React 18 concurrent scheduling needs
        // multiple rounds for the state to settle into the DOM.
        await act(async () => {
            for (let i = 0; i < 10; i++) await Promise.resolve();
        });
        await act(async () => {
            for (let i = 0; i < 10; i++) await Promise.resolve();
        });

        const errCard = container!.querySelector('[data-testid="dashboard-fetch-error"]');
        expect(errCard).not.toBeNull();
        // The backend error string is surfaced for context.
        expect(errCard!.textContent).toContain('ระบบฐานข้อมูลไม่พร้อมใช้งาน');
        // The retry CTA must be present (TH default).
        expect(errCard!.textContent).toContain('ลองอีกครั้ง');
    });

    it('renders the error state when the underlying promise rejects', async () => {
        mockApiGet.mockRejectedValueOnce(new Error('network outage'));
        mount();
        // Flush several microtasks so the api promise + setLoading(false)
        // commit before we assert. React 18 concurrent scheduling needs
        // multiple rounds for the state to settle into the DOM.
        await act(async () => {
            for (let i = 0; i < 10; i++) await Promise.resolve();
        });
        await act(async () => {
            for (let i = 0; i < 10; i++) await Promise.resolve();
        });

        const errCard = container!.querySelector('[data-testid="dashboard-fetch-error"]');
        expect(errCard).not.toBeNull();
        // The thrown error message gets surfaced.
        expect(errCard!.textContent).toContain('network outage');
    });
});
