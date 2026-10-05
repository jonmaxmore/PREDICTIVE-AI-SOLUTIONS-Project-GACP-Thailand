/**
 * notification-preferences.test.tsx — External-services cleanup, Task 4
 * (2026-08-19).
 *
 * RED-first pins for the FE prefs UI dropping the email/SMS channel
 * concept (backend already tracks only `inApp` per type — see
 * notification-preferences-service.js):
 *
 *   1. Renders in-app-only: no "อีเมล"/"SMS" column headers, and every
 *      row carries exactly ONE checkbox (the in-app toggle) instead of
 *      three.
 *   2. A legacy-shaped API response (an entry still carrying `email`/
 *      `sms` sub-keys, as a pre-cleanup persisted value would) does not
 *      crash the component; the in-app checkbox reflects `.inApp` and
 *      the retired fields are simply ignored.
 *
 * Mocking strategy: createRoot + act (project convention — see
 * OfflineIndicator.test.tsx / dashboard-layout-bell.test.tsx). Mock
 * `@/lib/api/api-client` so fetchPrefs() resolves synchronously with a
 * controlled payload.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockGet = jest.fn();
const mockPut = jest.fn();

jest.mock('@/lib/api/api-client', () => ({
    apiClient: {
        get: (...args: unknown[]) => mockGet(...args),
        put: (...args: unknown[]) => mockPut(...args),
    },
}));

import { NotificationPreferences } from '../notification-preferences';

describe('NotificationPreferences — external-services cleanup Task 4 (in-app only)', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        if (root) {
            act(() => { root?.unmount(); });
            root = null;
        }
        if (container) {
            container.remove();
            container = null;
        }
    });

    async function mount(portal: 'health' | 'provider' = 'health') {
        container = document.createElement('div');
        document.body.appendChild(container);
        await act(async () => {
            root = createRoot(container!);
            root!.render(
                <NotificationPreferences portal={portal} apiBase={portal === 'health' ? '/auth/health' : '/auth/provider'} />,
            );
        });
        // Flush the fetchPrefs() promise chain.
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
    }

    it('renders in-app-only: no "อีเมล"/"SMS" column headers, one checkbox per row', async () => {
        mockGet.mockResolvedValue({ success: true, data: { channels: {} } });

        await mount('health');

        const headerTexts = Array.from(container!.querySelectorAll('thead th')).map((th) => th.textContent);
        expect(headerTexts).toContain('ในแอป');
        expect(headerTexts).not.toContain('อีเมล');
        expect(headerTexts.some((t) => t?.includes('SMS'))).toBe(false);

        const rows = container!.querySelectorAll('tbody tr');
        expect(rows.length).toBeGreaterThan(0);
        rows.forEach((row) => {
            expect(row.querySelectorAll('input[type="checkbox"]').length).toBe(1);
        });
    });

    it('legacy-shaped stored entry (email/sms sub-keys, from before the cleanup) does not crash — in-app checkbox reflects .inApp only', async () => {
        mockGet.mockResolvedValue({
            success: true,
            data: {
                channels: {
                    // Pre-cleanup persisted shape: email/sms present, inApp
                    // explicitly opted out. This is the exact shape a user's
                    // stored notificationSettings JSON could carry.
                    PAYMENT_REMINDER: { email: true, sms: true, inApp: false },
                },
            },
        });

        await expect(mount('health')).resolves.not.toThrow();

        const rows = Array.from(container!.querySelectorAll('tbody tr'));
        const targetRow = rows.find((r) => r.textContent?.includes('PAYMENT_REMINDER'));
        expect(targetRow).toBeTruthy();
        const checkbox = targetRow!.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(checkbox.checked).toBe(false);
    });
});
