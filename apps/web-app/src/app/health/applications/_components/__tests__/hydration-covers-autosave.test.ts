/**
 * You may not SEND a key you did not LOAD.
 *
 * The wizard autosaves its whole store to POST /draft, and the server persists every
 * wizard-owned key it receives. So the two lists — what the hydrator restores from the
 * server, and what the autosave posts back — are two halves of one round trip. If the
 * autosave sends a key the hydrator does not restore, that key sits at its initial value
 * ([] / null / 0 / '') after a reload, and the save that fires ~3 seconds later writes the
 * emptiness over the real data. Hydration is itself a state change, which is what schedules
 * that save: no user edit is needed, and nothing on screen shows it happening.
 *
 * That was not hypothetical. On 2026-08-26, when POST /draft started persisting the wizard
 * blob, eleven keys were in exactly that position and were measured being destroyed by a
 * single save on a fresh browser — serviceTypes, stepDocuments (the eleven-slot document
 * record), cultivationDetails, plantTracking, generalInfo, siteData, securityData,
 * youtubeUrl, qrCount, estimatedQRCost and locationType. The same reload that used to lose
 * the farmer's uploads on screen would now have lost them on the server.
 *
 * This test reads both lists out of the source rather than importing the modules, because
 * what it is pinning is a relationship the shape of a future edit will change without
 * noticing. A runtime test would need a rendered wizard and would still not see a key
 * someone forgets to add.
 *
 * CHANGED 2026-09-06 — the SENT half is no longer a literal. The autosave's payload was a
 * hand-typed list of field names and it had gone stale: seven fields the six-step wizard
 * writes were missing from it, so those answers never reached the server at all. It now
 * sends the whole store minus declared bookkeeping (`answersForDraft`), which means the
 * question this file asks is unchanged but its left-hand side moved: what the autosave
 * sends IS the wizard's state, so the comparison is now the state's own field list against
 * the hydrator. That is strictly stronger — a field added to the wizard tomorrow is covered
 * the day it is added, rather than the day someone remembers to type it in twice.
 */

import fs from 'fs';
import path from 'path';

const HERE = __dirname;
const AUTOSAVE = path.join(
    HERE, '..', '..', 'new', '_steps', 'hooks', 'use-auto-save.ts',
);
const STEP_PAGE = path.join(HERE, '..', 'application-step-page.tsx');
const STATE_TYPES = path.join(
    HERE, '..', '..', 'new', '_steps', 'hooks', 'use-application-flow-store.state-types.ts',
);

/** The wizard's own field list — what `answersForDraft` will send, minus the exemptions. */
function wizardAnswerKeys(): string[] {
    const src = fs.readFileSync(STATE_TYPES, 'utf8');
    const start = src.indexOf('interface WizardState');
    if (start === -1) { throw new Error('interface WizardState not found'); }
    const body = src.slice(src.indexOf('{', start), src.indexOf('\n}', start));
    const declared = body.split('\n')
        .map((line) => line.match(/^\s{4}([A-Za-z_][A-Za-z0-9_]*)\??:/))
        .filter((m): m is RegExpMatchArray => Boolean(m))
        .map((m) => m[1]);
    // ทั้งสองรายการที่ประกาศไว้ว่า "ไม่ใช่คำตอบ" และ "ไม่ส่ง" — อ่านจากซอร์สของ autosave เอง
    // เพื่อไม่ให้ไฟล์นี้ถือสำเนาที่ค้างได้อีกชุด
    const autosave = fs.readFileSync(AUTOSAVE, 'utf8');
    const exempt = new Set<string>();
    for (const name of ['HASH_EXEMPT_KEYS', 'NOT_SENT_KEYS']) {
        const at = autosave.indexOf(`export const ${name}`);
        if (at === -1) { throw new Error(`${name} not found in use-auto-save.ts`); }
        const open = autosave.indexOf('Object.freeze([', at);
        const close = autosave.indexOf(']', open);
        (autosave.slice(open, close).match(/'([a-zA-Z0-9]+)'/g) || [])
            .forEach((q) => exempt.add(q.replace(/'/g, '')));
    }
    return declared.filter((key) => !exempt.has(key)).sort();
}

/** Keys of the object literal that starts at `marker` and ends at the matching brace. */
function keysOfLiteral(source: string, marker: string): string[] {
    const start = source.indexOf(marker);
    if (start === -1) { throw new Error(`marker not found: ${marker}`); }

    const open = source.indexOf('{', start);
    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i += 1) {
        if (source[i] === '{') { depth += 1; }
        if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) { end = i; break; }
        }
    }
    if (end === -1) { throw new Error(`unbalanced literal after ${marker}`); }

    const body = source.slice(open + 1, end);
    const keys = new Set<string>();
    // Top-level keys only: a nested object's keys are indented deeper, and every key in
    // both literals is written `name: value` at one indent level.
    let nest = 0;
    for (const line of body.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) { continue; }
        if (nest === 0) {
            const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:/);
            if (match) { keys.add(match[1]); }
        }
        nest += (line.match(/[{[(]/g) || []).length;
        nest -= (line.match(/[}\])]/g) || []).length;
        if (nest < 0) { nest = 0; }
    }
    return [...keys].sort();
}

describe('the wizard round trip is closed', () => {
    const autosaveSource = fs.readFileSync(AUTOSAVE, 'utf8');
    const stepPageSource = fs.readFileSync(STEP_PAGE, 'utf8');

    const sent = wizardAnswerKeys();
    // hydrateDraft since O1 (2026-09-30): the load is marked as a load.
    const hydrated = keysOfLiteral(stepPageSource, 'hydrateDraft({');

    it('reads both lists — a parser that found nothing would pass everything', () => {
        // Guards against the vacuous pass: if either extractor breaks, the comparison below
        // becomes [] vs [] and reports success while pinning nothing at all.
        expect(sent.length).toBeGreaterThan(15);
        expect(hydrated.length).toBeGreaterThan(15);
        expect(sent).toContain('applicantData');
        expect(hydrated).toContain('applicantData');
        // the exemption list was actually read, not silently empty
        expect(sent).not.toContain('syncStatus');
        expect(sent).not.toContain('applicationId');
    });

    it('restores every key the autosave sends', () => {
        const missing = sent.filter((key) => !hydrated.includes(key));

        // If this fails, do not delete the key from the autosave to make it pass unless the
        // wizard genuinely does not own it. Add it to the hydrator: the farmer's data is on
        // the losing side of this comparison.
        expect(missing).toEqual([]);
    });

    it('sends no key the store does not actually have', () => {
        // previousCertNumber was sent through a cast that always evaluated to null, so every
        // save erased the column it fed. A cast is how a key that does not exist gets past
        // the compiler — so no key in this payload may be reached through one.
        //
        // Comments are stripped first: the explanation of why that cast is gone names the
        // cast, and a test that cannot tell code from prose about code would fail on its own
        // documentation and teach the next person to delete the explanation.
        const code = autosaveSource
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split('\n')
            .filter((line) => !line.trim().startsWith('//'))
            .join('\n');

        expect(code).not.toMatch(/state as unknown as Record<string, unknown>/);
    });
});
