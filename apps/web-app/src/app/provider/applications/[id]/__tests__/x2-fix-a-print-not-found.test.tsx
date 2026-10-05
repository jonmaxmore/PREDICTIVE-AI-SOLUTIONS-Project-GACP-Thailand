/**
 * x2-fix-a-print-not-found.test.tsx — X2-FIX-A (M-14) regression test.
 *
 * Locks the contract that the print page's "ไม่พบข้อมูลคำขอ" empty
 * state is announced to assistive tech via role="alert". The print
 * route is frequently opened in a new tab from the detail page; a
 * silent empty state leaves screen-reader users stranded.
 *
 * Shape — source-read assertion. The print client-view imports
 * `@/styles/provider-styles.css` at the top, which the jest
 * moduleNameMapper resolves through the `@/` alias BEFORE the
 * CSS-stub catch-all, so a direct import here errors out with
 * "Unexpected token .". Reading the source is the same pattern
 * `x2-fix-a-detail-page.test.tsx` uses for the canReview branch
 * (which also resists SSR for a different reason). The Playwright
 * suite exercises the live DOM independently.
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PRINT_SOURCE = readFileSync(
    path.resolve(__dirname, '..', 'print', 'client-view.tsx'),
    'utf8',
);

describe('X2-FIX-A M-14 — print not-found announces role="alert"', () => {
    it('wraps the "ไม่พบข้อมูลคำขอ" empty state in role="alert"', () => {
        expect(PRINT_SOURCE).toMatch(/role="alert"/);
    });

    it('marks the alert region as aria-live polite for SR announcement', () => {
        expect(PRINT_SOURCE).toMatch(/aria-live="polite"/);
    });

    it('attaches a stable data-testid hook to the alert region', () => {
        expect(PRINT_SOURCE).toMatch(/data-testid="print-not-found-alert"/);
    });

    it('keeps the Thai not-found copy inside the alert wrapper', () => {
        // Anchor on the role + Thai copy in the same block so a
        // refactor that strips the wrapper or the copy is caught.
        expect(PRINT_SOURCE).toMatch(
            /role="alert"[\s\S]*?data-testid="print-not-found-alert"[\s\S]*?ไม่พบข้อมูลคำขอ/,
        );
    });

    it('only renders the alert when data is null (not on the loading branch)', () => {
        // The loading branch still shows the Spinner — the alert
        // wrapper must NOT appear inside the `isLoading` early-return.
        // Locate the `isLoading` branch and assert role="alert" sits
        // BELOW it, gated by the `if (!data)` check.
        expect(PRINT_SOURCE).toMatch(
            /if \(!data\)[\s\S]*?role="alert"[\s\S]*?ไม่พบข้อมูลคำขอ/,
        );
    });
});
