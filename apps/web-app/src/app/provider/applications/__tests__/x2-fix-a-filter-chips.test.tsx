/**
 * x2-fix-a-filter-chips.test.tsx — X2-FIX-A (H-5) regression test.
 *
 * Locks the contract that the doc-review listing surfaces filter chips
 * for the two reviewer-relevant states that were previously missing:
 *   - REVISION_REQUESTED — applicant is revising; reviewer can see
 *     the rows but the clock is paused on their side.
 *   - DOC_APPROVED — reviewer has approved; surface for visibility
 *     into the next-phase queue.
 *
 * Shape — file-read assertion. The filter-chip block is a tiny array
 * literal so reading the source is more deterministic than mounting
 * the whole DataTable + ProviderLayout SSR pass (which depends on
 * Tailwind + apiClient + Radix + Spinner, none of which the existing
 * applications-page tests instantiate).
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PAGE_SOURCE = readFileSync(
    path.resolve(__dirname, '..', 'page.tsx'),
    'utf8',
);

describe('X2-FIX-A H-5 — listing exposes REVISION_REQUESTED + DOC_APPROVED chips', () => {
    it('includes REVISION_REQUESTED in the chip array', () => {
        // Match the chip array literal — string token must appear in
        // the filter source line. The array is defined inline at
        // applications/page.tsx; locating by the surrounding "all"
        // anchor prevents a stray match elsewhere.
        expect(PAGE_SOURCE).toMatch(
            /\[\s*'all'[\s\S]*?'REVISION_REQUESTED'[\s\S]*?\]/,
        );
    });

    it('includes DOC_APPROVED in the chip array', () => {
        expect(PAGE_SOURCE).toMatch(
            /\[\s*'all'[\s\S]*?'DOC_APPROVED'[\s\S]*?\]/,
        );
    });

    it('keeps the original chips in their original positions', () => {
        // Lock the ordering so the visual layout is stable. The two
        // new chips append at the end per the spec.
        expect(PAGE_SOURCE).toMatch(
            /\['all', 'SUBMITTED', 'ASSIGNED_FOR_REVIEW', 'APPROVED', 'CERTIFIED', 'REVISION_REQUESTED', 'DOC_APPROVED'\]/,
        );
    });

    it('attaches a stable data-testid prefix to every chip for E2E hooks', () => {
        expect(PAGE_SOURCE).toMatch(/data-testid={`filter-chip-\$\{value\}`}/);
    });
});
