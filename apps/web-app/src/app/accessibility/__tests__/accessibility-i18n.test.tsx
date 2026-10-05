import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * The accessibility statement answers the language toggle.
 *
 * Its own §3 promised that the site "supports switching between Thai and
 * English via the header control" while the page itself rendered hardcoded
 * Thai and mounted no toggle. That is now true on the page that claims it.
 *
 * The mandate this pins: in English mode the page must contain ZERO Thai
 * codepoints, in text and in attributes alike. Asserted, not assumed.
 *
 * Thai block is U+0E00–U+0E7F. Note that `—`, `§` and `·` are NOT in it —
 * a naive `[ก-๙]` shell range matches them through locale collation and
 * produces false positives, which is why the check here is codepoint-exact.
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
import AccessibilityClientView from '../client-view';

const THAI = /[฀-๿]/;

describe('accessibility statement — i18n', () => {
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
                    <AccessibilityClientView />
                </LanguageProvider>,
            );
        });
        return container!;
    }

    it('renders all seven numbered sections in Thai', () => {
        const text = renderIn('th').textContent ?? '';

        expect(text).toContain('นโยบายการเข้าถึงเว็บไซต์');
        for (const numeral of ['๑.', '๒.', '๓.', '๔.', '๕.', '๖.', '๗.']) {
            expect(text).toContain(numeral);
        }
    });

    it('renders all seven numbered sections in English', () => {
        const text = renderIn('en').textContent ?? '';

        expect(text).toContain('Website accessibility statement');
        for (const numeral of ['1.', '2.', '3.', '4.', '5.', '6.', '7.']) {
            expect(text).toContain(numeral);
        }
    });

    it('contains ZERO Thai characters in English mode', () => {
        // Scoped to <article>, the page's own content. The site Footer that
        // GovLayout renders is still Thai-only and is shared by every route,
        // so it is tracked as its own piece of work rather than silently
        // widening this page's scope. See the next test, which records that.
        const el = renderIn('en').querySelector('article')!;

        const textOffenders = (el.textContent ?? '')
            .split(/\s+/)
            .filter((token) => THAI.test(token));
        expect(textOffenders).toEqual([]);

        const attrOffenders: string[] = [];
        for (const node of Array.from(el.querySelectorAll('*'))) {
            for (const attr of Array.from(node.attributes)) {
                if (THAI.test(attr.value)) {
                    attrOffenders.push(`${node.tagName.toLowerCase()}[${attr.name}]="${attr.value}"`);
                }
            }
        }
        expect(attrOffenders).toEqual([]);
    });

    it('mounts the language toggle the statement promises', () => {
        const el = renderIn('th');

        const toggle = Array.from(el.querySelectorAll('button')).find((b) =>
            /EN|TH/i.test(b.textContent ?? ''),
        );
        expect(toggle).toBeDefined();
    });

    // Was: "still renders a Thai-only shared footer". The Footer had no i18n
    // and GovLayout renders it on every route, so it kept Thai on every English
    // page and made the zero-Thai mandate unreachable page by page. Now wired,
    // so the assertion is inverted and the whole page — chrome included — is
    // checked.
    it('renders a fully English footer, chrome included', () => {
        const el = renderIn('en');
        const footer = el.querySelector('footer');
        expect(footer).not.toBeNull();
        expect(THAI.test(footer!.textContent ?? '')).toBe(false);

        const attrOffenders: string[] = [];
        for (const node of Array.from(footer!.querySelectorAll('*'))) {
            for (const attr of Array.from(node.attributes)) {
                if (THAI.test(attr.value)) attrOffenders.push(`${node.tagName.toLowerCase()}[${attr.name}]`);
            }
        }
        expect(attrOffenders).toEqual([]);
    });

    it('contains ZERO Thai characters in English mode across the WHOLE page', () => {
        const el = renderIn('en');
        const offenders = (el.textContent ?? '').split(/\s+/).filter((t) => THAI.test(t));
        expect(offenders).toEqual([]);

        // Attributes too, across the whole subtree — not just inside <article>.
        // The narrower scope above let `<main aria-label="เนื้อหาหลัก">` (from
        // GovLayout's default) survive on every English page: an aria-label is
        // invisible to a sighted reader AND to a textContent scan, so nothing
        // failed while a screen reader announced the landmark in Thai.
        const attrOffenders: string[] = [];
        for (const node of Array.from(el.querySelectorAll('*'))) {
            for (const attr of Array.from(node.attributes)) {
                if (THAI.test(attr.value)) {
                    attrOffenders.push(`${node.tagName.toLowerCase()}[${attr.name}]="${attr.value}"`);
                }
            }
        }
        expect(attrOffenders).toEqual([]);
    });

    it('closes the sentence after the W3C link instead of running on', () => {
        // Caught by reading a real 390px screenshot, not by a unit test: §2
        // rendered as "...as set out in the W3C specification Development is
        // ongoing..." — the link ended a sentence but nothing terminated it, so
        // two sentences ran together on screen. English needs the full stop;
        // Thai must NOT get one, because Thai marks a sentence break with a
        // space and a stray "." would be a typographic error in formal Thai.
        const en = renderIn('en').textContent ?? '';
        expect(en).toContain('the W3C specification. Development is ongoing');

        act(() => { root?.unmount(); });

        const th = renderIn('th').textContent ?? '';
        expect(th).toContain('ข้อกำหนดของ W3C ปัจจุบันอยู่ระหว่างการพัฒนา');
        expect(th).not.toContain('ข้อกำหนดของ W3C.');
    });

    it('keeps the ministry contact details identical in both languages', () => {
        // Email, phone and address are facts, not copy — they must not drift
        // between the two dictionaries.
        const th = renderIn('th').textContent ?? '';
        act(() => { root?.unmount(); });
        const en = renderIn('en').textContent ?? '';

        for (const fact of ['@', '0 2']) {
            expect(th.includes(fact)).toBe(en.includes(fact));
        }
    });
});
