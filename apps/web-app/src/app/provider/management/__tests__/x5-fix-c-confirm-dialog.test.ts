/**
 * x5-fix-c-confirm-dialog.test.ts — H-2 (PM-1) regression.
 *
 * Pins X5-FIX-C's retirement of the 4 `window.confirm()` calls in
 * /provider/management. The pre-X5 implementation used native
 * `confirm()` popups for delete / unlock / disable-2FA (removed 2026-09-26) /
 * force-password-reset — locale-locked, screen-reader-hostile, and
 * unable to render a meaningful description with the target name.
 *
 * Strategy — source-grep (same pattern as
 * `x4-fix-d-a11y-polish.test.ts`). Mounting /provider/management
 * directly requires heavy provider mocks (router, language provider,
 * api-client, sonner) plus a Radix Dialog portal — orthogonal to the
 * source-level contract being pinned here. The JSX-level contract is
 * the truth.
 *
 * Asserts:
 *   1. ZERO occurrences of `window.confirm(` or the bare `confirm(`
 *      pattern in the SOURCE CODE (comments may legitimately mention
 *      them while explaining the fix).
 *   2. The ConfirmDialog import is wired up.
 *   3. The pending-action kinds (delete/unlock) are
 *      declared via the discriminated union state (forceReset was
 *      retired 2026-09-17 with the reset-token action).
 *   4. The `<ConfirmDialog ...>` element is rendered in the JSX so
 *      clicking a destructive action surfaces a real dialog, not a
 *      native popup.
 *   5. The `data-testid="mgmt-delete-XXX"` selector is present so
 *      Playwright + integration tests can find the delete button.
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MGMT_PAGE = readFileSync(
    path.resolve(__dirname, '..', 'page.tsx'),
    'utf8',
);

/**
 * Strip block + line comments (including JSX `{` + slash-star-comment
 * pairs) so the "no-window.confirm" assertions exercise actual code,
 * not the documentation prose that legitimately mentions the pre-X5
 * pattern while explaining the fix.
 */
function stripComments(src: string): string {
    return src
        // /* ... */ block comments (handles JSX {/* ... */} too because
        // the inner block is what we want to clear)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        // // line comments
        .replace(/^\s*\/\/.*$/gm, '');
}

const MGMT_CODE = stripComments(MGMT_PAGE);

describe('[X5-FIX-C / H-2] /provider/management retires window.confirm', () => {
    it('contains zero `window.confirm(` invocations in source code', () => {
        expect(MGMT_CODE).not.toMatch(/window\.confirm\s*\(/);
    });

    it('contains zero bare `confirm(...)` invocations on destructive paths', () => {
        // The 4 pre-X5 sites were the only callers of bare `confirm()`
        // in this file. If any return we want to know — even a single
        // bare `confirm(` regresses the H-2 fix.
        expect(MGMT_CODE).not.toMatch(/(?<![\w.])confirm\s*\(/);
    });

    it('imports ConfirmDialog from the feature primitive', () => {
        expect(MGMT_PAGE).toContain(
            "import { ConfirmDialog } from '@/components/feature/confirm-dialog'",
        );
    });

    it('declares the 2-branch PendingProviderAction discriminated union', () => {
        // The union encodes which action is awaiting confirmation —
        // replacing the separate inline confirm() bodies with a single
        // ConfirmDialog driven by this state. 'forceReset' went with the
        // reset-token action on 2026-09-17 (operator: no account recovery)
        // and 'disable2fa' on 2026-09-26 (operator: "ถอดทั้งสองประตู" — no one
        // clears another account's 2FA) — see no-password-reset-action.test.tsx
        // next to this file.
        expect(MGMT_PAGE).toContain("kind: 'delete'");
        expect(MGMT_PAGE).toContain("kind: 'unlock'");
        expect(MGMT_CODE).not.toContain("kind: 'disable2fa'");
        expect(MGMT_CODE).not.toContain("kind: 'forceReset'");
    });

    it('renders a <ConfirmDialog ...> element in the JSX tree', () => {
        expect(MGMT_PAGE).toMatch(/<ConfirmDialog\b/);
    });

    it('routes the destructive button through setPendingAction (not confirm())', () => {
        // The delete button's onClick was `confirm('ยืนยัน...') && ...`.
        // Post-X5 it sets the pending action; the dialog handles the rest.
        expect(MGMT_PAGE).toContain('setPendingAction(');
    });

    it('exposes a data-testid for the delete button so tests can find it', () => {
        // Backtick-delimited template literal — easier to assert via
        // toContain than a precise regex with escape gymnastics.
        expect(MGMT_PAGE).toContain('data-testid={`mgmt-delete-${member.id}`}');
    });
});
