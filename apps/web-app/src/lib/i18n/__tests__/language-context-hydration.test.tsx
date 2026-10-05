/**
 * LanguageProvider — the first client render must match what the server sent.
 *
 * The provider read `localStorage` inside its `useState` initializer. On the
 * server there is no `window`, so SSR always produced Thai; on the client the
 * initializer ran during the very first render and could produce English. React
 * compares that first client render against the server HTML, so every visitor
 * with `language=en` stored hit:
 *
 *   Hydration failed because the server rendered text didn't match the client
 *
 * Measured in the visual-QA sweep (2026-07-26): 21 of 21 English captures threw
 * it, 0 of 21 Thai captures did. The sibling component states the contract this
 * spec now enforces — RootLangUpdater.tsx's comment already assumes the provider
 * "defaults to `th` before localStorage hydrates", which was not true.
 *
 * The fix is the standard SSR pattern: start from the server-rendered default,
 * then adopt the stored preference in an effect. This spec pins both halves —
 * the first render is Thai, and it still converges to the stored language.
 *
 * Uses createRoot + act, the React 18 style this repo prefers over
 * @testing-library/react (see RootLangUpdater.test.tsx).
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {

    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jest.setup.tsx globally mocks this module; this spec exercises the real one.
jest.unmock('@/lib/i18n/language-context');

jest.mock('next/navigation', () => {
    const stableRouter = {
        push: jest.fn(), replace: jest.fn(), refresh: jest.fn(),
        back: jest.fn(), forward: jest.fn(), prefetch: jest.fn(),
        pathname: '/', query: {},
    };
    const stableSearchParams = new URLSearchParams();
    return {
        useRouter: () => stableRouter,
        usePathname: () => '/',
        useSearchParams: () => stableSearchParams,
    };
});

import { LanguageProvider, useLanguage } from '@/lib/i18n/language-context';

/** Appends the language seen on every render, in order. */
function LanguageRecorder({ log }: { log: string[] }) {
    const { language } = useLanguage();
    log.push(language);
    return null;
}

describe('LanguageProvider hydration safety', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        localStorage.clear();
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        act(() => { root?.unmount(); });
        container?.remove();
        container = null;
        root = null;
        localStorage.clear();
    });

    function renderProvider(): string[] {
        const log: string[] = [];
        act(() => {
            root = createRoot(container!);
            root.render(
                <LanguageProvider>
                    <LanguageRecorder log={log} />
                </LanguageProvider>,
            );
        });
        return log;
    }

    it('renders Thai first even when English is stored, so hydration matches the server', () => {
        localStorage.setItem('language', 'en');

        const renders = renderProvider();

        // The server has no localStorage and always emits Thai. If the first
        // client render disagrees, React throws a hydration mismatch.
        expect(renders[0]).toBe('th');
    });

    it('still adopts the stored English preference after mount', () => {
        localStorage.setItem('language', 'en');

        const renders = renderProvider();

        expect(renders[renders.length - 1]).toBe('en');
    });

    it('stays Thai throughout when nothing is stored', () => {
        const renders = renderProvider();

        expect(new Set(renders)).toEqual(new Set(['th']));
    });

    it('ignores a corrupt stored value instead of rendering it', () => {
        localStorage.setItem('language', 'klingon');

        const renders = renderProvider();

        expect(renders[0]).toBe('th');
        expect(renders[renders.length - 1]).toBe('th');
    });
});
