/**
 * LanguageToggle.test.tsx — Y1-FIX-A acceptance for the new
 * language-toggle primitive mounted in the DashboardLayout topbar.
 *
 * Why this test exists:
 *   Y1-AUDIT §1 + X2-A finding §6 — both HEALTH and PROVIDER portals
 *   were locked to the session locale post-login. Adding the toggle to
 *   DashboardLayout fixes the systemic gap. This test pins the
 *   primitive's contract so a future refactor (e.g. swapping `<Globe />`
 *   for a different icon, or moving from inline aria to dict-driven
 *   aria) doesn't silently regress the WCAG 3.1.1 a11y target.
 *
 * What we assert:
 *   1. Renders with default (topbar) variant including "EN" label when
 *      current language is TH.
 *   2. Clicking the button flips the language via the shared context.
 *   3. After the flip, the label switches to "TH" (showing the OTHER
 *      language as the click target).
 *   4. The `aria-label` announces the destination language in the
 *      destination's own script (matches login-page convention).
 *   5. The `pill` variant renders with the same a11y contract.
 *
 * Pattern: createRoot + act, real LanguageProvider so the context
 * persists language state across re-renders. Mirrors RootLangUpdater
 * which uses an identical harness.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// I-016 stable router mock — LanguageToggle itself does not use
// next/navigation but the test harness pulls in modules through
// jest's path-alias resolver, so locking router identity is cheap
// insurance against transitive imports.
jest.mock('next/navigation', () => {
    const stableRouter = {
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
        useRouter: () => stableRouter,
        usePathname: () => '/',
        useSearchParams: () => new URLSearchParams(),
    };
});

import { LanguageProvider } from '@/lib/i18n/language-context';
import { LanguageToggle, resolveLanguageToggleAria } from '../LanguageToggle';

describe('LanguageToggle (Y1-FIX-A)', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        try {
            window.localStorage.removeItem('language');
        } catch {
            // localStorage may be disabled in some jsdom configs — ignore.
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

    async function mount(node: React.ReactNode) {
        container = document.createElement('div');
        document.body.appendChild(container);
        await act(async () => {
            root = createRoot(container!);
            root.render(<LanguageProvider>{node}</LanguageProvider>);
        });
    }

    it('renders the topbar variant with the OTHER language label (TH default → EN)', async () => {
        await mount(<LanguageToggle />);

        const button = container!.querySelector('[data-testid="language-toggle"]');
        expect(button).not.toBeNull();
        expect(button?.getAttribute('data-variant')).toBe('topbar');
        // Initial language is 'th' so the button advertises 'EN' as
        // the destination.
        expect(button?.textContent).toContain('EN');
        // Aria-label is the destination language announced in the
        // destination's own script.
        expect(button?.getAttribute('aria-label')).toBe('สลับภาษาเป็นภาษาอังกฤษ');
    });

    it('flips language to en when clicked, then back to th on a second click', async () => {
        await mount(<LanguageToggle />);

        const button = container!.querySelector(
            '[data-testid="language-toggle"]',
        ) as HTMLButtonElement;
        expect(button).not.toBeNull();

        await act(async () => {
            button.click();
        });

        // After click, language is 'en' so the button now invites the
        // user back to 'TH'.
        expect(button.textContent).toContain('TH');
        expect(button.getAttribute('aria-label')).toBe('Switch language to Thai');

        // Click again to flip back.
        await act(async () => {
            button.click();
        });
        expect(button.textContent).toContain('EN');
        expect(button.getAttribute('aria-label')).toBe('สลับภาษาเป็นภาษาอังกฤษ');
    });

    it('renders the pill variant with the same a11y contract', async () => {
        await mount(<LanguageToggle variant="pill" />);

        const button = container!.querySelector('[data-testid="language-toggle"]');
        expect(button).not.toBeNull();
        expect(button?.getAttribute('data-variant')).toBe('pill');
        expect(button?.textContent).toContain('EN');
        expect(button?.getAttribute('aria-label')).toBe('สลับภาษาเป็นภาษาอังกฤษ');
    });

    it('persists language preference to localStorage on flip (cross-tab sync)', async () => {
        await mount(<LanguageToggle />);

        const button = container!.querySelector(
            '[data-testid="language-toggle"]',
        ) as HTMLButtonElement;
        await act(async () => {
            button.click();
        });

        expect(window.localStorage.getItem('language')).toBe('en');
    });
});

describe('resolveLanguageToggleAria', () => {
    // Was: aria written in the DESTINATION's script, so an English page
    // carried "เปลี่ยนภาษาเป็นภาษาไทย". That is the one thing EN mode must not
    // contain, and an English screen reader has no voice for Thai glyphs — it
    // reads noise instead of an instruction. The destination is now named in
    // the language the reader is already using.
    it('names the destination language, phrased in the page\'s current language', () => {
        expect(resolveLanguageToggleAria('th')).toBe('สลับภาษาเป็นภาษาอังกฤษ');
        expect(resolveLanguageToggleAria('en')).toBe('Switch language to Thai');
    });
});
