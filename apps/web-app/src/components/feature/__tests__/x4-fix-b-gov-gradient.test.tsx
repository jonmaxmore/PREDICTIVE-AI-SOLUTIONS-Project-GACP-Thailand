/**
 * x4-fix-b-gov-gradient.test.tsx — X4-FIX-B (H-6) regression.
 *
 * Originally pinned the `gov-gradient` DTAM brand cue on the 8
 * PageToolbar headers in the ACCOUNT cluster identified by the X4-B
 * audit. The minimal redesign (2026-07) retired that cue across the
 * whole cluster — see the HEADERS comment below — so this suite now
 * pins its ABSENCE, keeping the same file list as the regression
 * ledger.
 *
 * 8 PageToolbar headers (per X4-B §1.2 enumeration):
 *
 *   1. accounting/page.tsx                         — main dashboard
 *   2. accounting/period-close/client-view.tsx     — period close
 *   3. accounting/manual-journal-entries/client-view.tsx — MJE
 *   4. accounting/purchase-invoices/client-view.tsx — purchase invoices
 *   5. accounting/wht/client-view.tsx               — WHT (ทบ.50 ทวิ)
 *   6. accounting/reports/client-view.tsx          — reports outer
 *   7. accounting/reports/ArAgingReport.tsx        — AR aging
 *   8. accounting/reports/TrialBalanceTable.tsx    — Trial Balance tab
 *
 * Strategy: source-grep assertions (same approach as
 * `x3-fix-b-gov-gradient.test.tsx`) — pins the className contract
 * without the cost of mounting these client-view pages (which
 * require api + notifications mocks that are orthogonal to the
 * visual contract being tested here).
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ACCOUNTING_ROOT = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'app',
    'provider',
    'accounting',
);

// B4 (SAP-Fiori launchpad rollout) replaced the accounting/page.tsx
// gov-gradient PageToolbar HERO with a <LaunchpadHeader> band — the same
// B-series migration that swapped the /provider/dashboard (B1) and
// /provider/coordinator (B2) gov-gradient heroes.
//
// MINIMAL REDESIGN (2026-07): the 7 ACCOUNT sub-pages below finish that
// migration. The gov-gradient cue was a full-bleed dark-green gradient
// behind a PageToolbar whose own title/subtitle render in
// text-foreground / text-muted-foreground — dark type on a dark fill, i.e.
// a contrast failure as well as the "too designed" hero the owner asked us
// to remove. The brand cue now lives in the shell (sidebar/topbar), and
// these dense finance sub-pages lead with a plain hairline PageToolbar.
// The assertions below are inverted so the gradient cannot creep back.
const HEADERS: ReadonlyArray<{ name: string; relative: string }> = [
    { name: 'period-close/client-view.tsx', relative: 'period-close/client-view.tsx' },
    { name: 'manual-journal-entries/client-view.tsx', relative: 'manual-journal-entries/client-view.tsx' },
    { name: 'purchase-invoices/client-view.tsx', relative: 'purchase-invoices/client-view.tsx' },
    { name: 'wht/client-view.tsx', relative: 'wht/client-view.tsx' },
    { name: 'reports/client-view.tsx', relative: 'reports/client-view.tsx' },
    { name: 'reports/ArAgingReport.tsx', relative: 'reports/ArAgingReport.tsx' },
    { name: 'reports/TrialBalanceTable.tsx', relative: 'reports/TrialBalanceTable.tsx' },
];

describe('Minimal redesign — the 7 ACCOUNT sub-page PageToolbar headers are plain', () => {
    for (const header of HEADERS) {
        it(`${header.name} PageToolbar carries no gov-gradient hero`, () => {
            const source = readFileSync(path.join(ACCOUNTING_ROOT, header.relative), 'utf8');
            expect(source).not.toMatch(/gov-gradient/);
            // The gradient always shipped with the same heavy-elevation
            // partner classes — pin their absence too so a partial
            // re-introduction is caught.
            expect(source).not.toMatch(/shadow-xl shadow-primary\/20/);
        });
    }
});

describe('B4 — accounting dashboard leads with the SAP-Fiori LaunchpadHeader', () => {
    // W4 refresh: B5 moved the dashboard UI out of page.tsx into
    // accounting-dashboard-client.tsx so /dtam and /platform render the same
    // component; page.tsx is a thin wrapper now. The B4 invariants this suite
    // pins (launchpad hero, no gov-gradient hero, H-6 lineage comment) live
    // in the client component — read that, and keep a wrapper check so the
    // page can't silently grow a second hero.
    const CLIENT = readFileSync(
        path.join(ACCOUNTING_ROOT, 'accounting-dashboard-client.tsx'),
        'utf8',
    );
    const PAGE = readFileSync(path.join(ACCOUNTING_ROOT, 'page.tsx'), 'utf8');

    it('renders <LaunchpadHeader> as the dashboard hero (replacing the gov-gradient PageToolbar)', () => {
        expect(CLIENT).toMatch(/<LaunchpadHeader/);
        // The gov-gradient PageToolbar hero must no longer be present on
        // the dashboard after the B4 launchpad rollout — in the client
        // component or the wrapper page.
        expect(CLIENT).not.toMatch(
            /className="gov-gradient border-none shadow-xl shadow-primary\/20"/,
        );
        expect(PAGE).not.toMatch(/gov-gradient/);
    });

    it('keeps the X4-FIX-B H-6 trace comment for audit lineage', () => {
        expect(CLIENT).toMatch(/X4-FIX-B H-6/);
    });
});
