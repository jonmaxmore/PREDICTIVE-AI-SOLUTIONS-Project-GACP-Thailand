/**
 * dashboard-layout-bell.test.tsx — X1-FIX-D acceptance test for H-1
 * (bell unread count) and H-8 (skip-link target).
 *
 * What changed in X1-FIX-D:
 *   - The notification bell used to render a HARDCODED red dot always.
 *     Now the dot only appears when the unread count > 0, and we show
 *     the number (or "9+" for 10+).
 *   - The `<main>` element now has `id="main-content"` so the global
 *     skip-link at `app/layout.tsx:106` actually targets a real node.
 *
 * What we assert:
 *   1. (H-1) Bell shows NO badge when unread count is 0.
 *   2. (H-1) Bell shows a numeric badge when unread count is 1-9.
 *   3. (H-1) Bell shows a "9+" badge when unread count > 9.
 *   4. (H-1) Bell shows NO badge when the fetch errors out (fail-safe).
 *   5. (H-8) `<main id="main-content" tabIndex={-1}>` is rendered.
 *
 * Mocking strategy: createRoot + act so useEffect fires; mock the
 * api-client `get` so we can drive the fetch shape per test. Same
 * pattern as `apps/web-app/src/app/health/payments/__tests__/bank-lookup-failure.test.tsx`.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Home } from 'lucide-react';

import { DashboardLayout } from '../dashboard-layout';
import { LanguageProvider } from '@/lib/i18n/language-context';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApiGet = jest.fn();

jest.mock('@/lib/api', () => ({
    apiClient: {
        get: (...args: unknown[]) => mockApiGet(...args),
    },
    api: {
        get: (...args: unknown[]) => mockApiGet(...args),
    },
}));

// AuthService.getUser is called on mount — mock to avoid touching localStorage.
jest.mock('@/lib/services/auth-service', () => ({
    AuthService: {
        getUser: jest.fn(() => null),
        logout: jest.fn(),
    },
}));

// Footer pulls in build-date / ministry-contact env, neither of which
// matters for these tests — stub it out to keep markup focused.
jest.mock('@/components/layout/Footer', () => ({
    Footer: () => null,
}));

// EntitySwitcher pulls in active-entity-provider hooks; stub it.
jest.mock('@/components/layout/entity-switcher', () => ({
    EntitySwitcher: () => null,
}));

const NAV_ITEMS = [
    { href: '/health/dashboard', label: 'หน้าแรก', Icon: Home },
];

describe('DashboardLayout — X1-FIX-D bell unread + skip-link', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
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
        jest.useRealTimers();
    });

    function mount() {
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root.render(
                // Y1-FIX-A — wrap in LanguageProvider since DashboardLayout
                // now mounts the LanguageToggle primitive which calls
                // useLanguage(). The bell test predates Y1 and used to be
                // free of language context.
                <LanguageProvider>
                    <DashboardLayout
                        navItems={NAV_ITEMS}
                        // The DashboardLayout `role` prop is a portal selector
                        // ('health' | 'provider'), not an ARIA role — jsx-a11y
                        // doesn't know that, so disable the rule on this line.
                        // eslint-disable-next-line jsx-a11y/aria-role
                        role="health"
                        brandName="GACP"
                        brandIcon={Home}
                    >
                        <p>page body</p>
                    </DashboardLayout>
                </LanguageProvider>,
            );
        });
    }

    async function flush() {
        // Drain pending microtasks twice — the fetchUnread promise resolves,
        // its `.then` callback runs setState, React schedules the re-render.
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
    }

    // ── H-1 acceptance ───────────────────────────────────────────────

    /**
     * The bell counted unread by fetching the notification LIST and filtering it in
     * the browser. That list is capped server-side at the 50 newest rows
     * (system/notifications.js), with no way to ask for more — so a user with more
     * than 50 unread was told "50" forever, and the number silently stopped being
     * the truth exactly when it mattered most.
     *
     * A dedicated counter already existed and was never called:
     * GET /notifications/unread-count runs one COUNT with no cap
     * (system/notifications.js getUnreadCount). Reading it also stops the bell
     * pulling 50 full rows every 30 seconds to derive a single integer.
     */
    it('H-1: reports the TRUE unread count when it exceeds the 50-row list cap', async () => {
        mockApiGet.mockResolvedValue({ success: true, data: { success: true, count: 137 } });

        mount();
        await flush();

        // It must have asked the counter, not the list.
        expect(mockApiGet).toHaveBeenCalledWith('/notifications/unread-count');

        const badge = container!.querySelector('[data-testid="bell-unread-badge"]');
        expect(badge).not.toBeNull();
        // 137 is past the "9+" ceiling, so the badge reads 9+ — but the point is that
        // the count reached the component at all. Filtering a 50-row list can never
        // produce 137, and would have shown 50 → also "9+", which is why the
        // ENDPOINT assertion above is what actually pins this.
        expect(badge!.textContent).toContain('9+');
    });

    it('H-1: shows NO unread badge when count is 0', async () => {
        // The bell now asks GET /notifications/unread-count, which answers
        // `{ success, count }` with no `data` key; the client unwraps
        // `body.data ?? body` (api-client.ts:503), so the whole body lands on
        // `res.data` and the count sits directly on it.
        mockApiGet.mockResolvedValue({
            success: true,
            data: { success: true, count: 0 },
        });

        mount();
        await flush();

        const badge = container!.querySelector('[data-testid="bell-unread-badge"]');
        expect(badge).toBeNull();
    });

    it('H-1: shows NO unread badge when all notifications are already read', async () => {
        // Two rows exist but both are read — the counter reports 0.
        mockApiGet.mockResolvedValue({
            success: true,
            data: { success: true, count: 0 },
        });

        mount();
        await flush();

        expect(container!.querySelector('[data-testid="bell-unread-badge"]')).toBeNull();
    });

    it('H-1: shows numeric badge "3" when 3 notifications are unread', async () => {
        mockApiGet.mockResolvedValue({
            success: true,
            data: { success: true, count: 3 },
        });

        mount();
        await flush();

        const badge = container!.querySelector('[data-testid="bell-unread-badge"]');
        expect(badge).not.toBeNull();
        expect(badge?.textContent).toBe('3');
    });

    it('H-1: shows "9+" badge when more than 9 unread', async () => {
        mockApiGet.mockResolvedValue({
            success: true,
            data: { success: true, count: 12 },
        });

        mount();
        await flush();

        const badge = container!.querySelector('[data-testid="bell-unread-badge"]');
        expect(badge).not.toBeNull();
        expect(badge?.textContent).toBe('9+');
    });

    it('H-1: shows NO unread badge when the fetch fails (fail-safe)', async () => {
        mockApiGet.mockRejectedValue(new Error('network failed'));

        mount();
        await flush();

        // Critical: layout MUST still render (DashboardLayout wraps every
        // HEALTH + PROVIDER page; crashing here = portal-wide outage).
        const bellButton = container!.querySelector('[aria-label="แจ้งเตือน"]');
        expect(bellButton).not.toBeNull();
        // And the badge must NOT render.
        expect(container!.querySelector('[data-testid="bell-unread-badge"]')).toBeNull();
    });

    it('H-1: shows NO unread badge when the backend returns { success: false }', async () => {
        mockApiGet.mockResolvedValue({ success: false });

        mount();
        await flush();

        expect(container!.querySelector('[data-testid="bell-unread-badge"]')).toBeNull();
    });

    it('H-1: dynamic aria-label announces the unread count to screen readers', async () => {
        mockApiGet.mockResolvedValue({
            success: true,
            data: { success: true, count: 2 },
        });

        mount();
        await flush();

        // After fetch resolves the button picks up the count-aware label.
        const labelledButton = container!.querySelector(
            'button[aria-label="แจ้งเตือน (2 รายการที่ยังไม่อ่าน)"]',
        );
        expect(labelledButton).not.toBeNull();
    });

    // ── H-8 acceptance ───────────────────────────────────────────────

    it('H-1: a non-numeric count is UNKNOWN, not zero and not NaN', async () => {
        // If the route's shape ever changes, the honest render is no dot — the same
        // fail-safe the error branch already uses. A confident "0" would tell the
        // user they have nothing waiting, which we do not actually know.
        for (const bad of [undefined, null, 'many', Number.NaN]) {
            jest.clearAllMocks();
            mockApiGet.mockResolvedValue({ success: true, data: { success: true, count: bad } });
            mount();
            await flush();
            expect(container!.querySelector('[data-testid="bell-unread-badge"]')).toBeNull();
            act(() => { root?.unmount(); });
            root = null;
            container!.remove();
            container = null;
        }
    });

    it('H-8: renders <main id="main-content"> as the skip-link target', async () => {
        mockApiGet.mockResolvedValue({ success: true, data: [] });
        mount();
        // Flush the in-flight fetch promise so the act() boundary is
        // closed before we assert (avoids "update not wrapped in act").
        await flush();

        const main = container!.querySelector('main#main-content');
        expect(main).not.toBeNull();
        // Programmatically focusable (tabIndex={-1}) so focus jumps there
        // when the user activates the skip-link.
        expect(main?.getAttribute('tabindex')).toBe('-1');
    });
});
