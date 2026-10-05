/**
 * The platform's contact mailboxes are spelled in ONE file,
 * constants/contact-emails.ts (review of fix/truthful-copy, operator 2026-09-26:
 * support@, privacy@ and finance@gacpth.com stay as contact addresses). Before
 * it, each address was typed out in 8+ places; this suite fails when a page
 * spells one again instead of importing it.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from '@jest/globals';

import { FINANCE_EMAIL, PRIVACY_EMAIL, SUPPORT_EMAIL, mailtoHref } from '@/constants/contact-emails';
import { th } from '@/lib/i18n/dictionaries/th';
import { en } from '@/lib/i18n/dictionaries/en';

const SRC = path.join(__dirname, '..', '..');
const HOME = path.join('constants', 'contact-emails.ts');

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
            sourceFiles(full, out);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

describe('contact mailboxes: one source', () => {
    it('names the three addresses', () => {
        expect([SUPPORT_EMAIL, PRIVACY_EMAIL, FINANCE_EMAIL]).toEqual([
            'support@gacpth.com',
            'privacy@gacpth.com',
            'finance@gacpth.com',
        ]);
        expect(mailtoHref(SUPPORT_EMAIL)).toBe('mailto:support@gacpth.com');
    });

    it('no other source file under src/ spells them', () => {
        const offenders = sourceFiles(SRC)
            .filter((file) => path.relative(SRC, file) !== HOME)
            .filter((file) => /(support|privacy|finance)@gacpth\.com/.test(fs.readFileSync(file, 'utf8')))
            .map((file) => path.relative(SRC, file));
        expect(offenders).toEqual([]);
    });

    it('the dictionaries carry the constant, unchanged text', () => {
        expect(th.renewalAdvisory.contactEmail).toBe(SUPPORT_EMAIL);
        expect(en.renewalAdvisory.contactEmail).toBe(SUPPORT_EMAIL);
    });
});
