/**
 * chatter-composer.test.tsx — Wave-3 ERP primitive (per-record CHATTER).
 *
 * Source-shape test (repo FE convention — no @testing-library/react; sibling
 * tests read the page source as a string to lock JSX-level invariants — see
 * x2-fix-a-detail-page.test.tsx). Pins the comment composer + internal-note
 * toggle + thread render on the provider application detail page.
 *
 * Guards:
 *   - a discussion tab + composer card + textarea render;
 *   - the "โน้ตภายใน (เจ้าหน้าที่เท่านั้น)" internal-note checkbox renders;
 *   - submit posts to the relative /api proxy (CSRF auto-minted by apiClient);
 *   - internal-note rows in the thread carry a distinct "ภายใน" badge with a
 *     warning-tone treatment (token-only — no raw hex color).
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PAGE_SOURCE = readFileSync(
    path.resolve(__dirname, '..', 'page.tsx'),
    'utf8',
);

describe('Wave-3 chatter — composer renders', () => {
    it('renders a discussion tab trigger', () => {
        expect(PAGE_SOURCE).toMatch(
            /NotebookTabsTrigger value="discussion"[\s\S]*?การพูดคุย/,
        );
    });

    it('renders the composer card with a textarea', () => {
        expect(PAGE_SOURCE).toMatch(/data-testid="comment-composer"/);
        expect(PAGE_SOURCE).toMatch(/data-testid="comment-textarea"/);
        expect(PAGE_SOURCE).toMatch(/onChange=\{\(e\) => setCommentDraft\(e\.target\.value\)\}/);
    });

    it('renders the internal-note checkbox labelled "โน้ตภายใน (เจ้าหน้าที่เท่านั้น)"', () => {
        expect(PAGE_SOURCE).toMatch(/โน้ตภายใน \(เจ้าหน้าที่เท่านั้น\)/);
        expect(PAGE_SOURCE).toMatch(
            /data-testid="comment-internal-toggle"[\s\S]*?type="checkbox"[\s\S]*?checked=\{commentInternal\}/,
        );
    });

    it('submits via the relative /api proxy (apiClient auto-mints CSRF)', () => {
        expect(PAGE_SOURCE).toMatch(
            /apiClient\.post<[^>]*>\(\s*`\/api\/provider\/applications\/\$\{encodeURIComponent\(application\.id\)\}\/comments`/,
        );
        // Body carries content + the server-trusted internalOnly flag.
        expect(PAGE_SOURCE).toMatch(/\{ content, internalOnly: commentInternal \}/);
    });

    it('appends the returned comment to the thread + clears the textarea on success', () => {
        expect(PAGE_SOURCE).toMatch(/comments: \[result\.data as ApplicationComment, \.\.\.\(prev\.comments \|\| \[\]\)\]/);
        expect(PAGE_SOURCE).toMatch(/setCommentDraft\(""\)/);
    });
});

describe('Wave-3 chatter — internal-note visual marker', () => {
    it('marks internal-note rows with a "ภายใน" badge', () => {
        expect(PAGE_SOURCE).toMatch(/data-testid="comment-internal-badge"[\s\S]*?ภายใน/);
    });

    it('uses a warning-tone token treatment for internal rows (no raw hex color)', () => {
        // Internal rows get border-warning/bg-warning; NEVER a raw hex color.
        expect(PAGE_SOURCE).toMatch(/border-warning\/40 bg-warning\/10/);
        // gacp/no-raw-color: the composer/thread block must not hardcode hex.
        const discussionBlock = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf('data-testid="comment-composer"'));
        expect(discussionBlock).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    });
});
