/**
 * X2-FIX-C / H-6 — /provider/dashboard silent-fetch-error regression guard.
 *
 * Before X2-FIX-C the provider dashboard's loadDashboard catch block
 * swallowed every network/5xx error with only a setError('Unable to
 * load provider dashboard data...') amber pill — no retry button, and
 * the queue silently reset to zeros that looked identical to a brand-
 * new staff account with no work. Reviewers had no path back to retry
 * the load and would either guess or bounce.
 *
 * X2-FIX-C introduces:
 *   - `fetchError` state (replacing `error`)
 *   - A rose Card data-testid="dashboard-fetch-error" with the
 *     dict.common.fetchError.title + retry CTA
 *   - Retry triggers loadDashboard(user) again (no separate retryToken;
 *     loadDashboard is a stable useCallback)
 *
 * Pattern mirrors X1-FIX-C health/dashboard + health/notifications and
 * uses createRoot+act per repo conventions (no @testing-library/react).
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
// stub. The dashboard reads `/auth/provider/me` first then either
// /provider/reviewer/dashboard (DR), /provider/scheduler/dashboard,
// /provider/auditor/dashboard, or /provider/applications.
const mockApiGet = jest.fn<(url: string) => Promise<unknown>>();
jest.mock('@/lib/api/api-client', () => ({
    apiClient: { get: (url: string) => mockApiGet(url) },
    api: { get: (url: string) => mockApiGet(url) },
}));

// CRITICAL: useRouter MUST return a STABLE reference per I-016. The
// default jest.setup.tsx mock returns a fresh object on every render;
// the dashboard's useEffect would re-fire and never let the error
// surface settle. Define the refs inside the factory so jest.mock
// hoisting stays valid.
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
    return {
        useRouter: () => router,
        usePathname: () => '/provider/dashboard',
        useSearchParams: () => new URLSearchParams(),
    };
});

// Mock ProviderLayout to a passthrough so the test doesn't pull in the
// sidebar / auth provider stack. The error card lives in this file's
// own JSX, not in the layout, so passthrough is sufficient.
jest.mock('../../components/provider-layout', () => {
    const Passthrough = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    Passthrough.displayName = 'MockProviderLayout';
    return { __esModule: true, default: Passthrough };
});

import ProviderDashboardPage from '../page';
import { LanguageProvider } from '@/lib/i18n/language-context';

describe('[X2-FIX-C / H-6] /provider/dashboard — silent fetch error', () => {
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
                    <ProviderDashboardPage />
                </LanguageProvider>,
            );
        });
    }

    async function flushMicrotasks(rounds = 20) {
        for (let i = 0; i < rounds; i++) {
            await act(async () => {
                await Promise.resolve();
            });
        }
    }

    it('renders the rose error card when the dashboard fetch rejects', async () => {
        // /auth/provider/me succeeds as an UNRECOGNIZED role. Task 7
        // (tile-home-nav) gave ADMIN + legacy ACCOUNT their own
        // providerLandingPath entry (both now land on /provider/home, N1) —
        // every real provider role now has a dedicated landing, so this
        // page's OWN content is only ever rendered for a role
        // providerLandingPath doesn't recognize (falls through to null).
        // The follow-on applications fetch then rejects to simulate an
        // outage — the generic dashboard's silent-fetch-error guard is the
        // contract under test here, independent of which role triggers it.
        mockApiGet.mockImplementation((url: string) => {
            if (url.includes('/auth/provider/me')) {
                return Promise.resolve({
                    success: true,
                    data: {
                        id: 'staff-1',
                        firstName: 'Alice',
                        lastName: 'Legacy',
                        canonicalRole: 'legacy_unrouted_staff',
                        role: 'legacy_unrouted_staff',
                    },
                });
            }
            return Promise.reject(new Error('network outage'));
        });

        mount();
        await flushMicrotasks();

        const errCard = container!.querySelector('[data-testid="dashboard-fetch-error"]');
        expect(errCard).not.toBeNull();
        // The thrown error message must be surfaced for context — the
        // silent failure before X2-FIX-C is what we're locking out.
        expect(errCard!.textContent).toContain('network outage');
        // Retry CTA must be present (TH default — fetchError.retry).
        expect(errCard!.textContent).toContain('ลองอีกครั้ง');
    });

    it('renders the error card when every endpoint returns success=false', async () => {
        // /auth/provider/me succeeds as an UNRECOGNIZED role — see the test
        // above for why (Task 7: every real provider role now has its own
        // providerLandingPath entry, so this page's content only renders
        // for a role providerLandingPath doesn't route). The applications
        // endpoint then returns success=false; loadDashboard throws
        // 'Unable to load dashboard data' which the catch block converts
        // into a user-facing fetchError.
        mockApiGet.mockImplementation((url: string) => {
            if (url.includes('/auth/provider/me')) {
                return Promise.resolve({
                    success: true,
                    data: {
                        id: 'staff-2',
                        firstName: 'Bob',
                        lastName: 'Legacy',
                        canonicalRole: 'legacy_unrouted_staff',
                        role: 'legacy_unrouted_staff',
                    },
                });
            }
            // All dashboard endpoints fail — loadDashboard then throws
            // 'Unable to load dashboard data', caught and surfaced.
            return Promise.resolve({ success: false, error: 'backend offline' });
        });

        mount();
        await flushMicrotasks();

        const errCard = container!.querySelector('[data-testid="dashboard-fetch-error"]');
        expect(errCard).not.toBeNull();
        // The catch path raises a generic 'Unable to load dashboard
        // data' Error when no endpoint succeeds — surface it.
        expect(errCard!.textContent).toContain('Unable to load dashboard data');
        expect(errCard!.textContent).toContain('ลองอีกครั้ง');
    });
});
