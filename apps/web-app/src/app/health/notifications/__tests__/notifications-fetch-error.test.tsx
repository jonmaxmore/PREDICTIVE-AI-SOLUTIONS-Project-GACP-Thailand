/**
 * X1-FIX-C / H-2 — /health/notifications silent-error regression guard.
 *
 * Before X1-FIX-C the notifications page swallowed both the envelope-
 * level !success branch and the catch handler by calling setNotifications([])
 * with no UI feedback. An applicant whose notification API was down saw
 * the empty "No notifications" EmptyState card and assumed all was quiet,
 * missing real status updates during incidents. The fix introduces a
 * `fetchError` state and a rose error card with retry.
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
jest.mock('@/lib/api', () => ({
    apiClient: { get: (url: string) => mockApiGet(url) },
    api: { get: (url: string) => mockApiGet(url) },
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

// CRITICAL: stable router so `useEffect(loadNotifications, [router])`
// doesn't loop forever (the default mock returns a fresh object on each
// render). See payments-states.test.tsx for the same pattern.
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

import NotificationsPage from '../client-view';
import { LanguageProvider } from '@/lib/i18n/language-context';

describe('[X1-FIX-C / H-2] /health/notifications — error state regression guard', () => {
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
                    <NotificationsPage />
                </LanguageProvider>,
            );
        });
    }

    it('renders the rose error card when the api envelope reports success=false', async () => {
        mockApiGet.mockResolvedValueOnce({
            success: false,
            error: 'ระบบแจ้งเตือนล่ม',
        });
        mount();
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        const errCard = container!.querySelector('[data-testid="notifications-fetch-error"]');
        expect(errCard).not.toBeNull();
        expect(errCard!.textContent).toContain('ระบบแจ้งเตือนล่ม');
        expect(errCard!.textContent).toContain('ลองอีกครั้ง');
        // The EmptyState must NOT also render — that was the silent-error bug.
        expect(container!.textContent).not.toContain('ไม่มีการแจ้งเตือน');
    });

    it('renders the error state when the fetch throws', async () => {
        mockApiGet.mockRejectedValueOnce(new Error('network outage'));
        mount();
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        const errCard = container!.querySelector('[data-testid="notifications-fetch-error"]');
        expect(errCard).not.toBeNull();
        expect(errCard!.textContent).toContain('network outage');
    });
});
