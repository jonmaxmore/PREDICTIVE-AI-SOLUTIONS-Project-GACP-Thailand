/**
 * X2-FIX-C / H-6 — /provider/applications/[id] activities tab
 * silent-fetch-error regression guard.
 *
 * Before X2-FIX-C the activities-tab-panel's catch branch and the
 * !success envelope branch both fell through to setActivities([]) with
 * no UI feedback. A reviewer hitting the tab during an API outage saw
 * the identical "ยังไม่มี activity..." empty state as an application
 * that genuinely had no activity log — so the outage was invisible.
 *
 * The fix introduces:
 *   - `fetchError` state
 *   - A rose Card data-testid="activities-fetch-error" with the
 *     dict.common.fetchError.title + retry button
 *   - Retry bumps `retryToken` which drives the effect dep array
 *
 * Pattern mirrors X1-FIX-C health/notifications and uses
 * createRoot+act per repo conventions (no @testing-library/react).
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
jest.mock('@/lib/api/api-client', () => ({
    apiClient: { get: (url: string) => mockApiGet(url) },
    api: { get: (url: string) => mockApiGet(url) },
}));

// Stable next/navigation per I-016 even though ActivitiesTabPanel
// doesn't reach for the router — defensive against future imports.
jest.mock('next/navigation', () => {
    const router = {
        push: jest.fn(),
        replace: jest.fn(),
        refresh: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        prefetch: jest.fn(),
    };
    return {
        useRouter: () => router,
        usePathname: () => '/provider/applications/test-id',
        useSearchParams: () => new URLSearchParams(),
    };
});

import { ActivitiesTabPanel } from '../activities-tab-panel';
import { LanguageProvider } from '@/lib/i18n/language-context';

describe('[X2-FIX-C / H-6] activities-tab-panel — silent fetch error', () => {
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
                    <ActivitiesTabPanel applicationId="app-123" />
                </LanguageProvider>,
            );
        });
    }

    async function flushMicrotasks(rounds = 10) {
        for (let i = 0; i < rounds; i++) {
            await act(async () => {
                await Promise.resolve();
            });
        }
    }

    it('renders the rose error card when the api envelope reports success=false', async () => {
        mockApiGet.mockResolvedValueOnce({
            success: false,
            error: 'ระบบ activity ล่ม',
        });
        mount();
        await flushMicrotasks();

        const errCard = container!.querySelector('[data-testid="activities-fetch-error"]');
        expect(errCard).not.toBeNull();
        // The backend error string is surfaced for context.
        expect(errCard!.textContent).toContain('ระบบ activity ล่ม');
        // The retry CTA must be present (TH default).
        expect(errCard!.textContent).toContain('ลองอีกครั้ง');
        // The empty-state caption must NOT also render — that was the
        // silent-error bug pre-X2-FIX-C.
        expect(container!.textContent).not.toContain('ยังไม่มี activity');
    });

    it('renders the error state when the underlying promise rejects', async () => {
        mockApiGet.mockRejectedValueOnce(new Error('network outage'));
        mount();
        await flushMicrotasks();

        const errCard = container!.querySelector('[data-testid="activities-fetch-error"]');
        expect(errCard).not.toBeNull();
        // The thrown message gets surfaced verbatim.
        expect(errCard!.textContent).toContain('network outage');
        expect(errCard!.textContent).toContain('ลองอีกครั้ง');
    });
});
