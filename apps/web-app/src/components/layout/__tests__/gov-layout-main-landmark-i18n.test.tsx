import * as React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * The `<main>` landmark label follows the language.
 *
 * SkipToContent was split out of GovLayout for exactly this reason — its own
 * comment claims the skip link "was the last Thai string left on an English
 * screen". It was not: GovLayout still defaulted `mainLabel` to a Thai literal,
 * which lands on `<main aria-label>` on every route the layout wraps.
 *
 * The page-scoped i18n suites did not catch it because they scan `textContent`
 * across the page but only scan *attributes* inside `<article>`, and `<main>`
 * sits outside that. An aria-label is invisible to a sighted reader and
 * invisible to a textContent scan, so nothing surfaced it — while a screen
 * reader in English mode announced the landmark in Thai.
 *
 * Thai block is U+0E00–U+0E7F. `—`, `§` and `·` are NOT in it; a shell
 * `[ก-๙]` range matches them via locale collation, so this is codepoint-exact.
 */

jest.mock('next/navigation', () => {
    const stableRouter = {
        push: jest.fn(), replace: jest.fn(), refresh: jest.fn(),
        back: jest.fn(), forward: jest.fn(), prefetch: jest.fn(),
        pathname: '/', query: {},
    };
    return {
        useRouter: () => stableRouter,
        usePathname: () => '/accessibility',
        useSearchParams: () => new URLSearchParams(),
    };
});

declare global {

    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.unmock('@/lib/i18n/language-context');

import { LanguageProvider } from '@/lib/i18n/language-context';
import { GovLayout } from '../GovLayout';

const THAI = /[฀-๿]/;

describe('GovLayout — main landmark label', () => {
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

    function renderIn(language: 'th' | 'en'): HTMLElement {
        localStorage.setItem('language', language);
        act(() => {
            root = createRoot(container!);
            root.render(
                <LanguageProvider>
                    <GovLayout chrome="minimal">
                        <p>body</p>
                    </GovLayout>
                </LanguageProvider>,
            );
        });
        return container!;
    }

    it('labels the main landmark in Thai on a Thai page', () => {
        const main = renderIn('th').querySelector('main')!;
        expect(main.getAttribute('aria-label')).toBe('เนื้อหาหลัก');
    });

    it('labels the main landmark in English on an English page', () => {
        const main = renderIn('en').querySelector('main')!;
        const label = main.getAttribute('aria-label') ?? '';
        expect(THAI.test(label)).toBe(false);
        expect(label).toBe('Main content');
    });

    it('still honours an explicit mainLabel override', () => {
        localStorage.setItem('language', 'en');
        act(() => {
            root = createRoot(container!);
            root.render(
                <LanguageProvider>
                    <GovLayout chrome="minimal" mainLabel="Certificate register">
                        <p>body</p>
                    </GovLayout>
                </LanguageProvider>,
            );
        });
        expect(container!.querySelector('main')!.getAttribute('aria-label')).toBe(
            'Certificate register',
        );
    });

    it('leaves ZERO Thai codepoints in ANY attribute in English mode', () => {
        // Whole-subtree attribute sweep — the check the page-scoped suites
        // stopped short of. `<main aria-label>` is the element it missed.
        const el = renderIn('en');
        const offenders: string[] = [];
        for (const node of Array.from(el.querySelectorAll('*'))) {
            for (const attr of Array.from(node.attributes)) {
                if (THAI.test(attr.value)) {
                    offenders.push(`${node.tagName.toLowerCase()}[${attr.name}]="${attr.value}"`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('keeps the layout free of hardcoded Thai literals', () => {
        // Source-level pin: the default belongs in the dictionary, not inline.
        // Comments are stripped first — a previous pass in this repo had two
        // tests match strings inside their own explanatory comments.
        const src = fs
            .readFileSync(path.join(__dirname, '..', 'GovLayout.tsx'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');

        expect(THAI.test(src)).toBe(false);
    });
});
