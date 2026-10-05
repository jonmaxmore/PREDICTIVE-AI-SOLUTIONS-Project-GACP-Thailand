/**
 * Help Center home — the rendered copy IS the dictionary.
 *
 * Phase 3 found this the hard way: `th.health.help.home` carries a full
 * set of Thai strings for this page, and the page rendered a completely
 * separate hardcoded set. Editing the dictionary changed nothing on
 * screen — the hero still read the old line. A dictionary entry nothing
 * renders is not translation, it is dead weight that drifts silently.
 *
 * These tests render the real page component and compare the visible
 * text against the dictionary, so the two cannot diverge again. They
 * also re-assert the two Thai copy rules on the rendered output, where
 * `scripts/ci/check-thai-copy-style.js` only sees source literals.
 *
 * Rendering follows the FaqAccordion convention (`renderToStaticMarkup`)
 * rather than Testing Library, which this workspace does not install.
 * The page is a plain synchronous server component — no hooks, no data
 * fetching — so static markup is exactly what production emits.
 */

import * as React from 'react';
import { beforeAll, describe, expect, it } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';

import HelpHome from '../page';
import { th } from '@/lib/i18n/dictionaries/th';

const copy = th.health.help.home;

let markup = '';
let text = '';

beforeAll(() => {
    markup = renderToStaticMarkup(<HelpHome />);
    const host = document.createElement('div');
    host.innerHTML = markup;
    // `textContent` concatenates across element boundaries, so JSX that
    // wraps a sentence over several source lines shows up here exactly
    // as the browser lays it out — which is what the copy rules govern.
    text = host.textContent || '';
});

describe('Help Center home copy', () => {
    it('renders the hero from the dictionary', () => {
        expect(text).toContain(copy.eyebrow);
        expect(text).toContain(copy.heroTitle);
        expect(text).toContain(copy.heroBody);
    });

    it('renders the hero calls to action from the dictionary', () => {
        expect(text).toContain(copy.readFaqCta);
        expect(text).toContain(copy.contactCta);
    });

    it('renders the section headings and closing block from the dictionary', () => {
        expect(text).toContain(copy.shortcutsTitle);
        expect(text).toContain(copy.topicsTitle);
        expect(text).toContain(copy.noAnswerTitle);
        expect(text).toContain(copy.noAnswerBody);
    });

    it('renders every shortcut card from the dictionary', () => {
        for (const value of [
            copy.shortcutFaqTitle,
            copy.shortcutContactTitle,
            copy.shortcutContactDesc,
            copy.shortcutGlossaryTitle,
            copy.shortcutGlossaryDesc,
            copy.shortcutOnboardingTitle,
            copy.shortcutOnboardingDesc,
        ]) {
            expect(text).toContain(value);
        }
    });

    it('keeps the rendered Thai free of em dashes and tight ไม้ยมก', () => {
        expect(text).not.toContain('—');
        expect(text).not.toMatch(/[฀-๿]ๆ/);
    });

    it('never renders a doubled space inside Thai copy', () => {
        // JSX line wrapping is the usual source: a sentence split across
        // two lines can render with the indentation collapsed to one
        // space, or to two when a trailing space survives the wrap.
        expect(text).not.toMatch(/[฀-๿]\s{2,}[฀-๿]/);
    });
});
