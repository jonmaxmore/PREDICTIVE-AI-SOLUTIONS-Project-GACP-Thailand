/**
 * p1j-search-box.test.tsx — Wave-3 P1-J applicant search.
 *
 * Locks the debounced server-side search wiring on the provider applications
 * list page. The header copy promised "search for applicants" but the page
 * previously fetched once unfiltered. This pins:
 *   - a search <input> with a stable testid + a11y label
 *   - a 300ms debounce feeding `debouncedSearch`
 *   - the fetch URL appends ?q=<encoded term> when a term is present
 *
 * Shape — source-read assertion (matches the sibling x2-fix-a-filter-chips
 * convention; the page mounts DataTable + ProviderLayout + apiClient).
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PAGE_SOURCE = readFileSync(
    path.resolve(__dirname, '..', 'page.tsx'),
    'utf8',
);

describe('P1-J applications list — debounced server search', () => {
    it('renders a search input with a stable testid', () => {
        expect(PAGE_SOURCE).toMatch(/data-testid="applications-search-input"/);
        expect(PAGE_SOURCE).toMatch(/type="search"/);
    });

    it('debounces the raw input into debouncedSearch (300ms)', () => {
        expect(PAGE_SOURCE).toMatch(/setDebouncedSearch\(search\.trim\(\)\)/);
        expect(PAGE_SOURCE).toMatch(/300\)/);
    });

    it('appends ?q=<encoded term> to the list fetch when a term is present', () => {
        expect(PAGE_SOURCE).toMatch(
            /\?q=\$\{encodeURIComponent\(debouncedSearch\)\}/,
        );
        // The load effect re-runs when the debounced term changes.
        expect(PAGE_SOURCE).toMatch(/\}, \[debouncedSearch\]\);/);
    });

    it('keeps the first-load full-page spinner gated to the initial empty state', () => {
        // So the search box does not vanish while a query re-fetches.
        expect(PAGE_SOURCE).toMatch(
            /isLoading && applications\.length === 0 && !debouncedSearch/,
        );
    });
});
