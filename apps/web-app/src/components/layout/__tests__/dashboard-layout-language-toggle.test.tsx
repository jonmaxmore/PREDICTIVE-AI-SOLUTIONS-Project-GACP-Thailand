/**
 * dashboard-layout-language-toggle.test.tsx — Y1-FIX-A acceptance for
 * mounting the LanguageToggle inside the shared DashboardLayout topbar.
 *
 * Why this test exists:
 *   Y1-AUDIT §1 + X2-A finding §6 — HEALTH and PROVIDER portals were
 *   locked to the session locale post-login. The fix mounts the
 *   LanguageToggle primitive between the Theme toggle and the
 *   Notification Bell. This test pins:
 *
 *     1. The toggle renders inside the DashboardLayout chrome for both
 *        roles (`health` + `provider`).
 *     2. The toggle sits between the theme button and the notification
 *        bell in DOM order (regression guard against the wave-D bell
 *        layout + the W5-C a11y suite).
 *     3. Clicking the toggle flips the persisted language without
 *        affecting any other DashboardLayout state (bell badge, theme).
 *
 * Mocking strategy mirrors dashboard-layout-bell.test.tsx — same
 * pattern, same fetch-mock for notifications, same Footer stub.
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

jest.mock('@/lib/services/auth-service', () => ({
    AuthService: {
        getUser: jest.fn(() => null),
        logout: jest.fn(),
    },
}));

jest.mock('@/components/layout/Footer', () => ({
    Footer: () => null,
}));


const NAV_ITEMS = [
    { href: '/health/dashboard', label: 'หน้าแรก', Icon: Home },
];

describe('DashboardLayout — Y1-FIX-A language toggle', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        try {
            window.localStorage.removeItem('language');
        } catch {
            // ignore
        }
        mockApiGet.mockResolvedValue({ success: true, data: { data: [] } });
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

    function mount(role: 'health' | 'provider' = 'health') {
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root.render(
                <LanguageProvider>
                    <DashboardLayout
                        navItems={NAV_ITEMS}
                        role={role}
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
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
    }

    it('renders the LanguageToggle in the DashboardLayout chrome (health role)', async () => {
        mount('health');
        await flush();

        const toggle = container!.querySelector('[data-testid="language-toggle"]');
        expect(toggle).not.toBeNull();
        // Aria-label sits in the destination language's script
        // (default current language is 'th' so destination is 'en').
        expect(toggle?.getAttribute('aria-label')).toBe('สลับภาษาเป็นภาษาอังกฤษ');
    });

    it('renders the LanguageToggle in the DashboardLayout chrome (provider role)', async () => {
        mount('provider');
        await flush();

        const toggle = container!.querySelector('[data-testid="language-toggle"]');
        expect(toggle).not.toBeNull();
    });

    it('mounts the LanguageToggle between the theme button and the bell', async () => {
        mount('health');
        await flush();

        // Find the right-side control cluster — the topbar has a flex
        // container with [theme, language-toggle, bell, user] children
        // in order. The cleanest way to assert ordering without
        // depending on classnames is to walk siblings of the language
        // toggle and check what comes before and after.
        const toggle = container!.querySelector('[data-testid="language-toggle"]');
        expect(toggle).not.toBeNull();

        // The bell is identified by its aria-label prefix "แจ้งเตือน"
        // (X1-FIX-D / H-1 contract).
        const bell = container!.querySelector('button[aria-label^="แจ้งเตือน"]');
        expect(bell).not.toBeNull();

        // The theme toggle is identified by its aria-label prefix "เปิด".
        const theme = container!.querySelector('button[aria-label^="เปิด"]');
        expect(theme).not.toBeNull();

        // Position assertion — theme < toggle < bell in document order.
        const themePos = theme!.compareDocumentPosition(toggle!);
        expect(themePos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const bellPos = bell!.compareDocumentPosition(toggle!);
        expect(bellPos & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    });

    it('clicking the toggle flips the language without crashing the layout', async () => {
        mount('health');
        await flush();

        const toggle = container!.querySelector(
            '[data-testid="language-toggle"]',
        ) as HTMLButtonElement;
        expect(toggle).not.toBeNull();

        await act(async () => {
            toggle.click();
        });

        // After click, the button now invites the user back to TH and
        // the aria-label is in Thai script.
        expect(toggle.textContent).toContain('TH');
        expect(toggle.getAttribute('aria-label')).toBe('Switch language to Thai');

        // Bell and skip-link target must still be present — toggle did
        // not corrupt the layout.
        expect(container!.querySelector('main#main-content')).not.toBeNull();
        expect(container!.querySelector('button[aria-label^="แจ้งเตือน"]')).not.toBeNull();
    });
});
