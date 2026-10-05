/**
 * X1-FIX-C / M-6 — certificates list renewal CTA href regression guard.
 *
 * X1-A flagged that the renewal CTA in the certificates list pointed at
 * `/health/applications/new` (which starts a fresh GACP application from
 * scratch) instead of the renewal flow. The fix swaps the href to
 * `/health/applications/renewal?certId=${cert.id}` so the wizard
 * pre-selects the correct certificate via its existing `useSearchParams`
 * read of `certId`.
 *
 * Source-level assertion only — the certificates page already has an
 * end-to-end render test (`certificates-error-state.test.tsx`); we don't
 * need another full mount just to confirm a single href.
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const clientView = readFileSync(
    resolve(__dirname, '../client-view.tsx'),
    'utf8',
);

describe('[X1-FIX-C / M-6] /health/certificates renewal CTA href', () => {
    it('renewal button links to /health/applications/renewal?certId=${cert.id}', () => {
        // The exact template literal must appear in the file. Captures both
        // the path swap AND the dynamic certId param so a future refactor
        // that drops the query string (back to the old "new application"
        // dead-end) is caught.
        expect(clientView).toContain('/health/applications/renewal?certId=${cert.id}');
    });

    it('no longer pairs the old /new href with the certDict.renew label', () => {
        // The `/health/applications/new` href can legitimately appear
        // elsewhere on the page (e.g. the "no certificates yet" empty
        // state's CTA -> `certDict.newApplication`). What MUST NOT happen
        // is `/health/applications/new` paired with `certDict.renew` —
        // that pairing identifies the broken renewal CTA we fixed. We
        // scan a windowed substring around each `certDict.renew`
        // occurrence and require none of them to mention the old href.
        const segments = clientView.split('certDict.renew').slice(1);
        // For each "renew" callsite, look at the 400 chars BEFORE the
        // reference (where the surrounding <Link href=...> lives) and
        // 100 chars after, and assert the old href is absent.
        const beforeSegments = clientView.split('certDict.renew').slice(0, -1);
        for (let i = 0; i < beforeSegments.length; i++) {
            const before = beforeSegments[i].slice(-400);
            const after = segments[i].slice(0, 100);
            const window = before + after;
            expect(window).not.toContain('href="/health/applications/new"');
        }
    });
});
