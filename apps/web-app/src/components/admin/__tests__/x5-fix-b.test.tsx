/**
 * x5-fix-b.test.tsx — X5-FIX-B regression suite.
 *
 * Pins the contract for the 4 fixes shipped by X5-FIX-B:
 *
 *  H-1  Last 4 operational `color="teal"` Mantine callsites closed:
 *        - provider/admin/audit-log/page.tsx (2 sites — Button + Badge)
 *        - provider/management/users/[id]/groups/client-view.tsx (2 sites — notifications)
 *  M-1  `color="amber"` (invalid Mantine palette) → `color="yellow"` (canonical)
 *        - provider/management/page.tsx (Force password reset ActionIcon — the
 *          button itself was retired 2026-09-17, no account recovery)
 *  H-11 ADMIN page headers carry the `gov-gradient` brand cue
 *        - AdminPageShell defaults gov-gradient on PageToolbar
 *        - 5 SummaryHeader admin pages
 *        - 2 PageToolbar admin certificate pages
 *  H-9  W5-C <button> + <div role="dialog"> split applied to 3 modals + TermTooltip
 *        - ChangeRoleModal.tsx
 *        - ForceMfaResetModal.tsx (removed 2026-09-26 — no one clears another account's 2FA)
 *        - UserDisableModal.tsx
 *        - TermTooltip.tsx (separate but related — outer wrapper a11y refactor)
 *
 * Strategy: source-grep assertions only (same approach used by
 * x4-fix-b-gov-gradient.test.tsx + x3-fix-b-gov-gradient.test.tsx).
 * Mounting these pages requires API + notifications mocks that are
 * orthogonal to the visual / token contract being tested here. Future
 * audits searching for "X5-FIX-B" tags will trace why each line moved.
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const APP_ROOT = path.resolve(__dirname, '..', '..', '..', 'app');
const ADMIN_COMPONENTS_ROOT = path.resolve(__dirname, '..');

// Source loads (cached at module level — tests do not edit files).

// AUDIT_LOG_SOURCE removed — the legacy /provider/admin/audit-log page was retired
// (M3: orphan duplicate of the canonical /admin/audit-log). Its color="teal" guard
// goes with it; the canonical page has its own design-token coverage.
const USER_GROUPS_SOURCE = readFileSync(
    path.join(APP_ROOT, 'provider', 'management', 'users', '[id]', 'groups', 'client-view.tsx'),
    'utf8',
);
const MANAGEMENT_SOURCE = readFileSync(
    path.join(APP_ROOT, 'provider', 'management', 'page.tsx'),
    'utf8',
);

// AdminPageShell + the 5 SummaryHeader admin pages + 2 certificate pages
const ADMIN_PAGE_SHELL_SOURCE = readFileSync(
    path.join(ADMIN_COMPONENTS_ROOT, 'AdminPageShell.tsx'),
    'utf8',
);
const ADMIN_DASHBOARD_SOURCE = readFileSync(
    path.join(APP_ROOT, 'admin', 'dashboard', 'page.tsx'),
    'utf8',
);
const ADMIN_COMMUNICATION_SOURCE = readFileSync(
    path.join(APP_ROOT, 'admin', 'communication', 'page.tsx'),
    'utf8',
);
const ADMIN_PLANTING_SOURCE = readFileSync(
    path.join(APP_ROOT, 'admin', 'planting', 'page.tsx'),
    'utf8',
);
const ADMIN_ORGANIZATIONS_SOURCE = readFileSync(
    path.join(APP_ROOT, 'admin', 'organizations', 'page.tsx'),
    'utf8',
);
const ADMIN_SETTINGS_SOURCE = readFileSync(
    path.join(APP_ROOT, 'admin', 'settings', 'page.tsx'),
    'utf8',
);
const ADMIN_CERTIFICATES_LIST_SOURCE = readFileSync(
    path.join(APP_ROOT, 'admin', 'certificates', 'client-view.tsx'),
    'utf8',
);
const ADMIN_CERTIFICATES_DETAIL_SOURCE = readFileSync(
    path.join(APP_ROOT, 'admin', 'certificates', '[id]', 'detail-view.tsx'),
    'utf8',
);

const CHANGE_ROLE_SOURCE = readFileSync(
    path.join(ADMIN_COMPONENTS_ROOT, 'ChangeRoleModal.tsx'),
    'utf8',
);
const USER_DISABLE_SOURCE = readFileSync(
    path.join(ADMIN_COMPONENTS_ROOT, 'UserDisableModal.tsx'),
    'utf8',
);
const TERM_TOOLTIP_SOURCE = readFileSync(
    path.join(ADMIN_COMPONENTS_ROOT, 'TermTooltip.tsx'),
    'utf8',
);

const FORCE_STATUS_REFERENCE_SOURCE = readFileSync(
    path.join(ADMIN_COMPONENTS_ROOT, 'ForceStatusModal.tsx'),
    'utf8',
);

// H-1 — last 4 operational color="teal" callsites are closed.

describe('X5-FIX-B H-1 — last 4 operational color="teal" closed', () => {
    it('users/[id]/groups/client-view.tsx has 0 operational color: "teal" notification callsites', () => {
        // Lines 96 + 123 used `color: 'teal'`. Both should now be 'green'.
        expect(USER_GROUPS_SOURCE).not.toMatch(/color: 'teal'/);
        // Two `color: 'green'` success notifications remain.
        const greenMatches = USER_GROUPS_SOURCE.match(/color: 'green'/g) || [];
        expect(greenMatches.length).toBeGreaterThanOrEqual(2);
    });

    it('X5-FIX-B H-1 annotation comments present on the patched sites', () => {
        expect(USER_GROUPS_SOURCE).toMatch(/X5-FIX-B H-1/);
    });
});

// M-1 — provider/management/page.tsx amber palette typo fix.

describe('X5-FIX-B M-1 — provider/management ActionIcon palette is valid Mantine', () => {
    it('management/page.tsx has 0 invalid color="amber" attributes', () => {
        // Mantine palette names: red, pink, grape, violet, indigo, blue,
        // cyan, teal, green, lime, yellow, orange, gray, dark. "amber"
        // is NOT in this list — it silently drops to gray. Fix uses
        // the canonical "yellow" for caution.
        expect(MANAGEMENT_SOURCE).not.toMatch(/color="amber"/);
    });

    // The yellow "Force password reset" ActionIcon that carried the M-1 fix
    // was removed 2026-09-17 (operator: no account recovery), and its
    // annotation with it. The no-amber guard above still covers the palette;
    // provider/management/__tests__/no-password-reset-action.test.tsx pins
    // the button's absence.
    it('management/page.tsx no longer renders the Force password reset ActionIcon', () => {
        expect(MANAGEMENT_SOURCE).not.toMatch(/Force password reset/);
    });
});

// H-11 — gov-gradient brand cue on ADMIN page headers.

describe('X5-FIX-B H-11 — gov-gradient brand cue on ADMIN page headers', () => {
    it('AdminPageShell defaults the gov-gradient className on its inner PageToolbar', () => {
        // 3 callers (admin/audit-log, admin/users, admin/applications/[id]/force-status)
        // share AdminPageShell — landing gov-gradient at the shell layer
        // gives all 3 the brand cue from a single edit.
        expect(ADMIN_PAGE_SHELL_SOURCE).toMatch(
            /gov-gradient border-none shadow-xl shadow-primary\/20/,
        );
        expect(ADMIN_PAGE_SHELL_SOURCE).toMatch(/toolbarClassName/);
        expect(ADMIN_PAGE_SHELL_SOURCE).toMatch(/X5-FIX-B H-11/);
    });

    const SUMMARY_HEADER_PAGES: ReadonlyArray<{ name: string; source: string }> = [
        { name: 'admin/dashboard/page.tsx', source: ADMIN_DASHBOARD_SOURCE },
        { name: 'admin/communication/page.tsx', source: ADMIN_COMMUNICATION_SOURCE },
        { name: 'admin/planting/page.tsx', source: ADMIN_PLANTING_SOURCE },
        { name: 'admin/organizations/page.tsx', source: ADMIN_ORGANIZATIONS_SOURCE },
        { name: 'admin/settings/page.tsx', source: ADMIN_SETTINGS_SOURCE },
    ];

    for (const page of SUMMARY_HEADER_PAGES) {
        it(`${page.name} SummaryHeader carries gov-gradient`, () => {
            expect(page.source).toMatch(
                /className="gov-gradient border-none shadow-xl shadow-primary\/20"/,
            );
            expect(page.source).toMatch(/X5-FIX-B H-11/);
        });
    }

    const PAGE_TOOLBAR_PAGES: ReadonlyArray<{ name: string; source: string }> = [
        { name: 'admin/certificates/client-view.tsx', source: ADMIN_CERTIFICATES_LIST_SOURCE },
        { name: 'admin/certificates/[id]/detail-view.tsx', source: ADMIN_CERTIFICATES_DETAIL_SOURCE },
    ];

    for (const page of PAGE_TOOLBAR_PAGES) {
        it(`${page.name} PageToolbar carries gov-gradient`, () => {
            expect(page.source).toMatch(
                /className="gov-gradient border-none shadow-xl shadow-primary\/20"/,
            );
            expect(page.source).toMatch(/X5-FIX-B H-11/);
        });
    }
});

// H-9 — W5-C <button> + <div role="dialog"> split applied to 3 modals + TermTooltip.

describe('X5-FIX-B H-9 — W5-C <button> + <div role="dialog"> split on 3 modals + TermTooltip', () => {
    const SPLIT_REFERENCE_SNIPPETS = {
        // The clickable backdrop is now a real <button type="button"> with
        // aria-label="ปิดหน้าต่าง" + the slate-900/60 scrim — drops the
        // two jsx-a11y warnings that fired on the legacy
        // <div role="dialog" onClick=...>.
        backdropButton: /<button[\s\S]+?type="button"[\s\S]+?aria-label="ปิดหน้าต่าง"[\s\S]+?onClick={onClose}/,
        // The dialog root no longer carries a click listener; it's a
        // sibling of the backdrop button with `relative` positioning so
        // it overlays the absolute-positioned scrim.
        relativeDialog: /<div[\s\S]+?role="dialog"[\s\S]+?aria-modal="true"[\s\S]+?className="relative/,
    };

    it('ForceStatusModal.tsx remains the W5-C reference (sanity check)', () => {
        // ForceStatusModal already split — this is the gold standard the
        // 3 modals + TermTooltip mirror. Assert the reference still has
        // the contract so the test failure mode is clear if it regresses.
        expect(FORCE_STATUS_REFERENCE_SOURCE).toMatch(SPLIT_REFERENCE_SNIPPETS.backdropButton);
        expect(FORCE_STATUS_REFERENCE_SOURCE).toMatch(SPLIT_REFERENCE_SNIPPETS.relativeDialog);
    });

    it('ChangeRoleModal.tsx has the W5-C backdrop split', () => {
        expect(CHANGE_ROLE_SOURCE).toMatch(SPLIT_REFERENCE_SNIPPETS.backdropButton);
        expect(CHANGE_ROLE_SOURCE).toMatch(SPLIT_REFERENCE_SNIPPETS.relativeDialog);
        // The legacy <div role="dialog" onClick> is gone — assert no
        // onClick handler sits on the dialog root.
        expect(CHANGE_ROLE_SOURCE).not.toMatch(
            /role="dialog"[\s\S]{0,400}?onClick=\{\(e\) => \{[\s\S]+?if \(e\.target === e\.currentTarget\)/,
        );
        expect(CHANGE_ROLE_SOURCE).toMatch(/X5-FIX-B H-9/);
    });

    it('UserDisableModal.tsx has the W5-C backdrop split', () => {
        expect(USER_DISABLE_SOURCE).toMatch(SPLIT_REFERENCE_SNIPPETS.backdropButton);
        expect(USER_DISABLE_SOURCE).toMatch(SPLIT_REFERENCE_SNIPPETS.relativeDialog);
        expect(USER_DISABLE_SOURCE).not.toMatch(
            /role="dialog"[\s\S]{0,400}?onClick=\{\(e\) => \{[\s\S]+?if \(e\.target === e\.currentTarget\)/,
        );
        expect(USER_DISABLE_SOURCE).toMatch(/X5-FIX-B H-9/);
    });

    it('TermTooltip.tsx outer wrapper has no static-element listeners', () => {
        // The 5th W5-C residual warning was on TermTooltip.tsx:50 —
        // `<span onMouseEnter onMouseLeave>` (static element with mouse
        // listeners, no role, no keyboard). Fix moves the listeners onto
        // a real <button type="button"> trigger and the wrapper <span>
        // is now plain.
        //
        // Assert:
        // 1. The inner trigger is now a <button type="button"> (not a
        //    <span tabIndex={0} role="button">).
        expect(TERM_TOOLTIP_SOURCE).toMatch(
            /<button[\s\S]+?type="button"[\s\S]+?onMouseEnter={\(\) => setOpen\(true\)}/,
        );
        // 2. The wrong role="button" on a non-button is gone — the JSX
        //    attribute (not the comment prose) is what we forbid. Strip
        //    comments before asserting so the X5-FIX-B annotation that
        //    explains "previously claimed role=\"button\"" doesn't trip.
        const sourceWithoutComments = TERM_TOOLTIP_SOURCE
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');
        expect(sourceWithoutComments).not.toMatch(/role="button"/);
        // 3. The outer wrapper does NOT carry mouse/focus listeners
        //    (the old onMouseEnter on the <span> wrapper).
        const outerSpanRegion = TERM_TOOLTIP_SOURCE.match(
            /<span\s+className=\{cn\('relative inline-flex items-center', className\)\}\s*>/,
        );
        expect(outerSpanRegion).not.toBeNull();
        // 4. Annotation comment is present.
        expect(TERM_TOOLTIP_SOURCE).toMatch(/X5-FIX-B H-9/);
    });
});
