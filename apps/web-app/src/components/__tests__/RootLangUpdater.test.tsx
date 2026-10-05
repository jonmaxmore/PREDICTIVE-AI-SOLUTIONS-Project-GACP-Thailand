/**
 * RootLangUpdater.test.tsx — W3-D (Iter W3)
 *
 * Pins the reactive `<html lang>` contract:
 *   1. After mount, the component mirrors `useLanguage().language` onto
 *      `document.documentElement.lang` (default 'th').
 *   2. When `setLanguage('en')` is dispatched, the effect re-runs and
 *      the DOM attribute updates to 'en' (WCAG 3.1.1 — Language of Page).
 *   3. The flip is reversible — `setLanguage('th')` after 'en' resets to 'th'.
 *
 * Strategy: render the real `<LanguageProvider>` so `useLanguage()`
 * resolves; expose a tiny helper child that calls `setLanguage` so the
 * test can drive the context. Uses createRoot + act per the
 * payments-states.test.tsx pattern in this repo (the project's
 * preferred React 18 testing style — no @testing-library/react render).
 *
 * I-016 (stable router mock): RootLangUpdater itself does NOT use
 * next/navigation, and LanguageProvider does NOT use next/navigation
 * (verified via grep on language-context.tsx). The per-file stable
 * router mock is therefore defensive — it locks identity in case a
 * future refactor pulls navigation into the providers chain, and
 * prevents the global jest.setup.tsx mock's fresh-object pattern from
 * destabilising effect dependency arrays during this test.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {

    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Y1 — this test specifically validates the REAL LanguageProvider's
// setLanguage reactivity. The Y1 jest.setup.tsx global mock makes
// setLanguage a no-op (which is correct for component-render tests
// that don't switch language), but breaks this contract test. Unmock
// here so the real provider is used.
jest.unmock('@/lib/i18n/language-context');

// I-016 stable router mock — even though this test does NOT mount any
// router-aware component, locking identity is the cheap insurance
// against future regressions if RootLangUpdater grows a useRouter dep.
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
    const stableSearchParams = new URLSearchParams();
    return {
        useRouter: () => stableRouter,
        usePathname: () => '/',
        useSearchParams: () => stableSearchParams,
    };
});

import { LanguageProvider, useLanguage } from '@/lib/i18n/language-context';
import { RootLangUpdater } from '../RootLangUpdater';

// Test harness that exposes setLanguage to the test via ref.
function LanguageDriver({ onReady }: { onReady: (setLang: (l: 'th' | 'en') => void) => void }) {
    const { setLanguage } = useLanguage();
    React.useEffect(() => {
        onReady(setLanguage);
    }, [setLanguage, onReady]);
    return null;
}

describe('RootLangUpdater (W3-D)', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        // Reset between tests so the first assertion always observes
        // the post-mount write rather than residue from a prior test.
        document.documentElement.setAttribute('lang', 'th');
        // Wipe persisted language so each test starts from the th default.
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
        document.documentElement.setAttribute('lang', 'th');
    });

    it('mirrors the default language (th) onto documentElement.lang after mount', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);

        // Pre-flip to a non-default value so the post-mount assertion
        // proves the effect actually fired (not a stale default).
        document.documentElement.setAttribute('lang', 'xx');

        await act(async () => {
            root = createRoot(container!);
            root.render(
                <LanguageProvider>
                    <RootLangUpdater />
                </LanguageProvider>,
            );
        });

        expect(document.documentElement.getAttribute('lang')).toBe('th');
    });

    it('updates documentElement.lang when setLanguage(\'en\') is invoked', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);

        let setLang: (l: 'th' | 'en') => void = () => {
            throw new Error('LanguageDriver not ready');
        };
        const onReady = (s: (l: 'th' | 'en') => void) => {
            setLang = s;
        };

        await act(async () => {
            root = createRoot(container!);
            root.render(
                <LanguageProvider>
                    <RootLangUpdater />
                    <LanguageDriver onReady={onReady} />
                </LanguageProvider>,
            );
        });

        expect(document.documentElement.getAttribute('lang')).toBe('th');

        await act(async () => {
            setLang('en');
        });

        expect(document.documentElement.getAttribute('lang')).toBe('en');
    });

    it('returns to th when setLanguage(\'th\') is called after en (reversibility)', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);

        let setLang: (l: 'th' | 'en') => void = () => {
            throw new Error('LanguageDriver not ready');
        };
        const onReady = (s: (l: 'th' | 'en') => void) => {
            setLang = s;
        };

        await act(async () => {
            root = createRoot(container!);
            root.render(
                <LanguageProvider>
                    <RootLangUpdater />
                    <LanguageDriver onReady={onReady} />
                </LanguageProvider>,
            );
        });

        await act(async () => {
            setLang('en');
        });
        expect(document.documentElement.getAttribute('lang')).toBe('en');

        await act(async () => {
            setLang('th');
        });
        expect(document.documentElement.getAttribute('lang')).toBe('th');
    });
});
