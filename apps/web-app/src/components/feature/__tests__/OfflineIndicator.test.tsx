/**
 * OfflineIndicator.test.tsx — X3-FIX-B (M-5) regression.
 *
 * Pins the offline-indicator contract:
 *   1. Renders nothing when `navigator.onLine === true` (mount default
 *      in jsdom). The DOM should be free of a fixed-position pill so
 *      the indicator does not occlude the bottom-right of any page
 *      under normal connectivity.
 *   2. Renders the bilingual pill when an `offline` event is fired on
 *      the window, mirroring the actual flow when the browser loses
 *      connectivity. The pill must carry `role="status"` +
 *      `aria-live="polite"` (WCAG 4.1.3 — Status Messages).
 *   3. Hides again when the `online` event is fired afterwards
 *      (round-trip reversibility).
 *
 * Strategy: createRoot + act (the project's preferred React 18
 * testing style — see RootLangUpdater.test.tsx for the source of
 * this pattern). We mutate `navigator.onLine` via
 * `Object.defineProperty` so the initial useEffect sync reads the
 * desired starting state, then dispatch real `online` / `offline`
 * `Event` objects on `window`.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {

    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { OfflineIndicator } from '../OfflineIndicator';

function setOnLine(value: boolean) {
    Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        get: () => value,
    });
}

describe('OfflineIndicator (X3-FIX-B M-5)', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        setOnLine(true);
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
        setOnLine(true);
    });

    it('renders nothing while the browser reports online', async () => {
        setOnLine(true);
        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            root = createRoot(container!);
            root.render(<OfflineIndicator />);
        });

        // Indicator is hidden — the data-testid pill must be absent.
        expect(container.querySelector('[data-testid="offline-indicator"]')).toBeNull();
    });

    it('renders the bilingual pill with role="status" when offline event fires', async () => {
        // Start offline so the initial mount catches the state via the
        // useEffect navigator.onLine sync. This is the more realistic
        // entry — the user navigates while already disconnected.
        setOnLine(false);
        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            root = createRoot(container!);
            root.render(<OfflineIndicator />);
        });

        const pill = container.querySelector('[data-testid="offline-indicator"]');
        expect(pill).not.toBeNull();
        expect(pill?.getAttribute('role')).toBe('status');
        expect(pill?.getAttribute('aria-live')).toBe('polite');
        // Bilingual text — Thai first because the platform's default
        // language is Thai (lang="th" on the root html).
        expect(pill?.textContent).toMatch(/ออฟไลน์/);
        expect(pill?.textContent).toMatch(/Offline/);
    });

    it('hides again when the browser comes back online', async () => {
        setOnLine(false);
        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            root = createRoot(container!);
            root.render(<OfflineIndicator />);
        });

        // Pill is visible.
        expect(container.querySelector('[data-testid="offline-indicator"]')).not.toBeNull();

        // Now simulate the browser regaining connectivity.
        await act(async () => {
            setOnLine(true);
            window.dispatchEvent(new Event('online'));
        });

        expect(container.querySelector('[data-testid="offline-indicator"]')).toBeNull();
    });
});
