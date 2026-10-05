/**
 * One language per screen, in the glossary data itself.
 *
 * The entries were authored once, mixing both languages in a single
 * string: `Scope (ขอบเขต)`, `CB (Certification Body)`, `ใบแจ้งหนี้
 * (Invoice)`. Whichever language a user picked, they read the other one
 * too — and a farmer scanning a Thai screen met English acronyms with no
 * way to skip past them.
 *
 * Each entry now carries a Thai and an English form, and the client
 * picks. The proper names of things that appear verbatim on a legal
 * document — GACP on the certificate, PDPA in the Act's own title — keep
 * their acronym in parentheses after the Thai, because a farmer holding
 * that certificate needs to match what they are reading to what they are
 * holding. Everything else leads in Thai with no English at all.
 *
 * `aliases` keeps the acronyms findable: the search box has to match "CB"
 * even on a screen that no longer shows those letters, or translating the
 * display would quietly break the way people look things up.
 */

import { describe, expect, it } from '@jest/globals';
import { GLOSSARY_ENTRIES } from '../faq-data';

const THAI = /[฀-๿]/;
const LATIN_WORD = /[A-Za-z]{2,}/;

/** Proper names that may keep a parenthetical acronym on the Thai side. */
const LEGAL_ACRONYMS = ['GACP', 'PDPA'];

describe('every glossary entry is authored in both languages', () => {
    it('has a Thai and an English term and definition', () => {
        for (const entry of GLOSSARY_ENTRIES) {
            expect(typeof entry.term).toBe('string');
            expect(typeof entry.termEn).toBe('string');
            expect(typeof entry.definition).toBe('string');
            expect(typeof entry.definitionEn).toBe('string');
            expect(entry.term.length).toBeGreaterThan(0);
            expect(entry.termEn.length).toBeGreaterThan(0);
        }
    });
});

describe('the Thai side reads as Thai', () => {
    it('leads every term in Thai', () => {
        for (const entry of GLOSSARY_ENTRIES) {
            expect(entry.term).toMatch(THAI);
        }
    });

    it('carries no bare English words in a term, only legal acronyms', () => {
        for (const entry of GLOSSARY_ENTRIES) {
            const latin = entry.term.match(/[A-Za-z]+/g) ?? [];
            const unexpected = latin.filter((w) => !LEGAL_ACRONYMS.includes(w));
            expect({ id: entry.id, unexpected }).toEqual({ id: entry.id, unexpected: [] });
        }
    });

    it('carries no bare English words in a definition, only legal acronyms', () => {
        for (const entry of GLOSSARY_ENTRIES) {
            const latin = entry.definition.match(/[A-Za-z]{2,}/g) ?? [];
            const unexpected = latin.filter((w) => !LEGAL_ACRONYMS.includes(w));
            expect({ id: entry.id, unexpected }).toEqual({ id: entry.id, unexpected: [] });
        }
    });
});

describe('the English side reads as English', () => {
    it('carries no Thai characters at all', () => {
        for (const entry of GLOSSARY_ENTRIES) {
            expect({ id: entry.id, term: entry.term ? entry.termEn : '' })
                .toEqual({ id: entry.id, term: entry.termEn });
            expect(entry.termEn).not.toMatch(THAI);
            expect(entry.definitionEn).not.toMatch(THAI);
        }
    });

    it('is actually English, not an untranslated placeholder', () => {
        for (const entry of GLOSSARY_ENTRIES) {
            expect(entry.definitionEn).toMatch(LATIN_WORD);
            expect(entry.definitionEn).not.toBe(entry.definition);
        }
    });
});

describe('translating the display does not break search', () => {
    it('keeps every English acronym reachable as an alias', () => {
        // Someone reading "CB" on a certificate must still find the entry
        // on a screen that shows only หน่วยรับรองมาตรฐาน.
        const byId = Object.fromEntries(GLOSSARY_ENTRIES.map((e) => [e.id, e]));
        for (const [id, acronym] of [['cb', 'CB'], ['car', 'CAR'], ['wht', 'WHT'], ['scope', 'Scope']]) {
            const entry = byId[id];
            expect(entry).toBeDefined();
            const haystack = [entry.termEn, ...(entry.aliases ?? [])].join(' ').toLowerCase();
            expect(haystack).toContain(acronym.toLowerCase());
        }
    });
});
