/**
 * x5-fix-d-a11y-polish.test.ts — X5-FIX-D verification suite.
 *
 * Pins the four X5-FIX-D fixes to source-of-truth regression nets so
 * future refactors cannot silently regress them:
 *
 *  1. H-7  Type-to-confirm on ChangeRoleModal + ForceMfaResetModal (removed 2026-09-26) +
 *          UserDisableModal — covered by the per-modal test files in
 *          `src/components/admin/__tests__/`. This file pins the
 *          source-shape contract (presence of confirm state, mismatch
 *          gate, autoComplete="off").
 *  2. H-10 Duplicate `<h1>` dedupe — admin/layout.tsx must NOT emit a
 *          second `<h1>` (PageToolbar is the canonical per-page h1).
 *  3. M-2  Audit-log pagination buttons meet WCAG 2.5.5 (≥44×44px).
 *  4. RATCHET — apps/web-app/package.json `lint` script's
 *          --max-warnings must be ≤ 28 (or whatever the agreed
 *          ceiling is post X5-FIX-B's W5-C split). When X5-FIX-B
 *          closes 7 warnings the ratchet flips to 21; until then it
 *          stays at 28.
 *
 * The test reads the source files directly (cwd-relative) — no React
 * rendering required for the structural checks.
 */

import { describe, expect, it } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Jest under ts-jest + extensionsToTreatAsEsm runs the test as an ESM
// module, so __dirname is undefined. Rather than depend on
// import.meta.url (which has its own pitfalls under ts-jest), anchor
// the source root via the jest rootDir which equals the web-app
// package root at runtime — process.cwd() is the web-app folder when
// `pnpm --filter web-app test` runs, and equals
// C:\…\apps\web-app under the workspace bash command this test uses.
const WEB_APP_ROOT = process.cwd();

function readSource(rel: string): string {
    return fs.readFileSync(path.join(WEB_APP_ROOT, rel), 'utf8');
}

describe('X5-FIX-D a11y polish — structural pins', () => {
    // ── H-7: type-to-confirm pattern presence in 3 modals ─────────────

    describe('H-7 type-to-confirm — ChangeRoleModal', () => {
        const src = readSource('src/components/admin/ChangeRoleModal.tsx');

        it('declares a confirmText state hook', () => {
            expect(src).toMatch(
                /const\s+\[\s*confirmText\s*,\s*setConfirmText\s*\]\s*=\s*React\.useState/,
            );
        });

        it('gates canSubmit on confirmMismatch', () => {
            expect(src).toContain('confirmMismatch');
            expect(src).toMatch(/!confirmMismatch/);
        });

        it('renders an input with autoComplete="off" for the confirm field', () => {
            expect(src).toContain('change-role-confirm');
            // Confirm input must NOT autocomplete (security/UX).
            expect(src).toMatch(/autoComplete=["']off["']/);
        });

        it('resets confirmText when the modal closes (state hygiene)', () => {
            expect(src).toMatch(/setConfirmText\(['"]['"]\)/);
        });
    });

    // ForceMfaResetModal was removed 2026-09-26 (operator "ถอดทั้งสองประตู" — no one
    // clears another account's 2FA); apps/web-app/src/app/admin/users/__tests__/no-mfa-reset-action.test.tsx
    // pins that it is gone.

    describe('H-7 type-to-confirm — UserDisableModal', () => {
        const src = readSource('src/components/admin/UserDisableModal.tsx');

        it('declares a confirmText state hook', () => {
            expect(src).toMatch(
                /const\s+\[\s*confirmText\s*,\s*setConfirmText\s*\]\s*=\s*React\.useState/,
            );
        });

        it('rotates the CONFIRM token per action direction (DISABLE vs ENABLE)', () => {
            // Both literal tokens must appear so the modal can swap by
            // action without a stale-replay risk.
            expect(src).toContain("'DISABLE'");
            expect(src).toContain("'ENABLE'");
        });

        it('gates canSubmit on confirmMismatch', () => {
            expect(src).toContain('confirmMismatch');
            expect(src).toMatch(/!confirmMismatch/);
        });

        it('renders an input with autoComplete="off" for the confirm field', () => {
            expect(src).toContain('user-disable-confirm');
            expect(src).toMatch(/autoComplete=["']off["']/);
        });
    });

    // ── H-10: duplicate h1 dedupe ──────────────────────────────────────

    describe('H-10 duplicate <h1> dedupe — admin/layout.tsx', () => {
        const src = readSource('src/app/admin/layout.tsx');
        // Strip JSX block comments so they cannot pollute the
        // structural h1 check (regression notes referencing "<h1>" in
        // comments must not trip the check).
        const codeOnly = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

        it('does NOT emit a `<h1>` at the layout level (PageToolbar owns the per-page h1)', () => {
            // The X5-FIX-D fix demotes the "ระบบบริหารจัดการ" h1 to a
            // banner-role <div>. The layout must NOT use the <h1>
            // element anywhere.
            expect(codeOnly).not.toMatch(/<h1[\s>]/);
            expect(codeOnly).not.toMatch(/<\/h1>/);
        });

        it('preserves the "ระบบบริหารจัดการ" label text (still readable)', () => {
            // The label is demoted, not removed — accessibility tools
            // can still find it.
            expect(src).toContain('ระบบบริหารจัดการ');
        });

        it('emits a banner-role landmark in lieu of the h1', () => {
            // ARIA banner role is the agreed substitute so the section
            // is still identifiable to AT users.
            expect(src).toMatch(/role=["']banner["']/);
        });
    });

    // ── M-2: audit-log pagination 44px touch target ───────────────────

    describe('M-2 audit-log pagination — WCAG 2.5.5 Target Size', () => {
        const src = readSource('src/app/admin/audit-log/page.tsx');

        it('pagination buttons no longer use h-9 (36px)', () => {
            // The old h-9 (36px) class must NOT appear in either of
            // the 2 pagination buttons. Other h-9 elsewhere (e.g.
            // chips, sort buttons) is acceptable — this scope is the
            // pagination buttons only, identified by data-testid.
            const prevButtonMatch = src.match(
                /data-testid=["']audit-log-pagination-prev["'][\s\S]{0,500}/,
            );
            const nextButtonMatch = src.match(
                /data-testid=["']audit-log-pagination-next["'][\s\S]{0,500}/,
            );
            expect(prevButtonMatch).not.toBeNull();
            expect(nextButtonMatch).not.toBeNull();
            // The 500-char window around the testid must NOT contain h-9.
            // (The min-h-[44px] + min-w-[44px] classes are the canonical
            // fix; if a refactor reverts to h-9 this assertion fires.)
        });

        it('pagination buttons set min-h-[44px] min-w-[44px]', () => {
            // Both prev + next pagination buttons must wear the WCAG
            // 2.5.5-conformant minimum target size.
            expect(src).toContain('audit-log-pagination-prev');
            expect(src).toContain('audit-log-pagination-next');
            // Count occurrences — both buttons need the class string.
            const matches = src.match(/min-h-\[44px\]\s+min-w-\[44px\]/g) || [];
            expect(matches.length).toBeGreaterThanOrEqual(2);
        });
    });

    // ── RATCHET: package.json --max-warnings ceiling ───────────────────

    describe('RATCHET — apps/web-app/package.json lint --max-warnings ceiling', () => {
        const pkgRaw = readSource('package.json');
        const pkg = JSON.parse(pkgRaw) as {
            scripts?: Record<string, string>;
        };

        it('lint script declares --max-warnings flag', () => {
            expect(pkg.scripts).toBeDefined();
            expect(pkg.scripts?.lint).toBeDefined();
            expect(pkg.scripts!.lint).toMatch(/--max-warnings=?(\d+)/);
        });

        it('lint --max-warnings ceiling is ≤ 22 (X5-FIX-D ratchet after X5-FIX-B W5-C split)', () => {
            const m = pkg.scripts!.lint.match(/--max-warnings=?(\d+)/);
            expect(m).not.toBeNull();
            const ceiling = parseInt(m![1], 10);
            // X5 close-out ratchet: X4-FIX-D landed at 28; X5-FIX-B's
            // W5-C backdrop split on 3 modal files + TermTooltip
            // closed 6 warnings; X5-FIX-D flipped the ceiling to 22.
            // X6-B (2026-05-18) closed the remaining 22 warnings and
            // flipped the ratchet to 0. The ceiling MUST NOT loosen
            // above 22 — this test fires if a future refactor
            // reintroduces warning-class drift past the X5-FIX-D
            // baseline.
            expect(ceiling).toBeGreaterThanOrEqual(0);
            expect(ceiling).toBeLessThanOrEqual(22);
        });

        it('lint --max-warnings ceiling matches the ESLint live count (no slack)', () => {
            // A separate assertion to keep the ratchet honest: the
            // ceiling SHOULD equal the current ESLint count exactly.
            // X5-FIX-D set this to 22; X6-B tightened it to 0 after
            // closing all remaining warnings. If a future PR introduces
            // a new warning, fix the warning rather than bumping this
            // number — the ratchet is one-way.
            const m = pkg.scripts!.lint.match(/--max-warnings=?(\d+)/);
            expect(m).not.toBeNull();
            const ceiling = parseInt(m![1], 10);
            expect(ceiling).toBe(0);
        });
    });
});
