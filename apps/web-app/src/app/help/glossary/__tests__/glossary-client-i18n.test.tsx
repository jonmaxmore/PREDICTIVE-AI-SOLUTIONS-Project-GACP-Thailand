/**
 * The glossary must actually change language.
 *
 * Measured before this test existed: /help/glossary rendered byte-identical
 * text with `localStorage.language` set to 'en' and to 'th' — 1,281 Thai
 * characters served under `<html lang="en">`. The page held its copy in
 * literals, so there was nothing for the language choice to act on.
 *
 * Reading the dictionary is necessary but not sufficient. A server
 * component that imports `th` directly — which is what `help/page.tsx`
 * did after PR #705 — makes the dictionary live and drift-proof, and
 * leaves the page just as monolingual as inline literals did. Only a
 * client component reading `useLanguage()` can switch.
 *
 * These tests drive the component through both languages and assert the
 * rendered text differs, which is the property a user experiences.
 */

import * as React from 'react';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';

import { th } from '@/lib/i18n/dictionaries/th';
import { en } from '@/lib/i18n/dictionaries/en';

let currentLanguage: 'th' | 'en' = 'th';

jest.mock('@/lib/i18n/language-context', () => ({
    __esModule: true,
    useLanguage: () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const dicts = require('@/lib/i18n/dictionaries/th');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const enDict = require('@/lib/i18n/dictionaries/en');
        return {
            language: currentLanguage,
            setLanguage: jest.fn(),
            dict: currentLanguage === 'en' ? enDict.en : dicts.th,
            t: (key: string) => key,
        };
    },
    LanguageProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const GlossaryClient = require('../glossary-client').default;

const textOf = (markup: string) => {
    const host = document.createElement('div');
    host.innerHTML = markup;
    return host.textContent || '';
};

const renderAs = (language: 'th' | 'en') => {
    currentLanguage = language;
    return textOf(renderToStaticMarkup(React.createElement(GlossaryClient)));
};

describe('the glossary renders the language the user chose', () => {
    beforeEach(() => {
        currentLanguage = 'th';
    });

    it('renders the Thai heading and description in Thai', () => {
        const text = renderAs('th');
        expect(text).toContain(th.health.help.glossary.description);
        expect(text).toContain(th.health.help.glossary.eyebrow);
    });

    it('renders the English heading and description in English', () => {
        const text = renderAs('en');
        expect(text).toContain(en.health.help.glossary.description);
        expect(text).toContain(en.health.help.glossary.eyebrow);
    });

    it('produces different text in the two languages', () => {
        // The regression this whole phase exists to catch.
        expect(renderAs('th')).not.toBe(renderAs('en'));
    });

    it('translates the page chrome, including the category labels', () => {
        // The chrome is what the dictionary owns. Category labels and the
        // closing "can't find a term" line are the parts a partial
        // conversion leaves behind, so name them explicitly.
        const text = renderAs('en');
        expect(text).toContain(en.health.help.glossary.categories.finance);
        expect(text).toContain(en.health.help.glossary.notInListPrefix);
        expect(text).toContain(en.health.help.glossary.notInListLink);
        expect(text).not.toContain(th.health.help.glossary.categories.finance);
    });

    it('carries no Thai at all in English, entries included', () => {
        // This assertion used to say the opposite: the entries were domain
        // content and stayed Thai. The product decision changed — a farmer
        // should not meet English acronyms on a Thai screen, and an English
        // reader should not meet Thai — so every entry is now authored in
        // both languages and the page must be wholly one or the other.
        expect(renderAs('en')).not.toMatch(/[฀-๿]/);
    });

    it('carries no stray English words in Thai, only legal acronyms', () => {
        // GACP and PDPA stay: they are the names printed on the certificate
        // and in the Act, and a reader has to be able to match them.
        const text = renderAs('th');
        const latin = text.match(/[A-Za-z]{2,}/g) ?? [];
        expect(latin.filter((w) => !['GACP', 'PDPA'].includes(w))).toEqual([]);
    });
});
