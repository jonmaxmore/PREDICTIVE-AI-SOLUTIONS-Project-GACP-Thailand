/**
 * x3-fix-b-car-findings-rose.test.tsx — X3-FIX-B (M-4) regression.
 *
 * Pins the destructive-intent colour swap on the CAR (Corrective
 * Action Report) findings panel in
 * `apps/web-app/src/app/provider/audits/[id]/audit-record-tab-panel.tsx`.
 *
 * X3-B finding (M-4): the panel used amber-on-white for the title row,
 * the border, and the "Before" non-conformity column. Amber semantically
 * communicates "warning / soon-due" — but a CAR finding is, by
 * definition, a corrective request that the auditor has the authority
 * to require. The semantic correct intent is **destructive** (the
 * applicant must fix this), so the colour must read as rose/red per
 * the KPI tile semantic contract documented in
 * `apps/web-app/src/lib/design/kpi-tile-semantics.ts`.
 *
 * Strategy: file-shape assertion (the `x2-fix-a-detail-page.test.tsx`
 * pattern). The panel only renders when `latestDecision.findings` is
 * non-empty, which requires a fully-shaped queue item — orthogonal to
 * the visual contract being pinned here.
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PANEL_SOURCE = readFileSync(
    path.resolve(__dirname, '..', 'audit-record-tab-panel.tsx'),
    'utf8',
);

describe('X3-FIX-B M-4 — CAR findings panel rose/destructive tone', () => {
    it('section heading icon uses rose tone, not amber/orange', () => {
        // The IconAlertTriangle that anchors the "ข้อบกพร่อง (CAR Findings)"
        // heading was `text-orange-600` pre-X3 — flip to `text-rose-600`.
        expect(PANEL_SOURCE).toMatch(/IconAlertTriangle[\s\S]{0,80}text-rose-600/);
        expect(PANEL_SOURCE).not.toMatch(/IconAlertTriangle[\s\S]{0,80}text-orange-600/);
    });

    it('section count Badge uses destructive "red" color, not "orange"', () => {
        // The "{findings.length} รายการ" badge that lives in the
        // section header — was Mantine `color="orange"`, flip to
        // `color="red"` so it reads as destructive intent.
        expect(PANEL_SOURCE).toMatch(/<Badge color="red" size="sm">\{findings\.length\} รายการ<\/Badge>/);
    });

    it('per-finding row container border uses rose tones, not orange', () => {
        // The map() row container — was border-orange-200, flip to
        // border-rose-200 (and the dark-mode pair).
        expect(PANEL_SOURCE).toMatch(/border border-rose-200 dark:border-rose-800/);
        expect(PANEL_SOURCE).not.toMatch(/border border-orange-200 dark:border-orange-800/);
    });

    it('per-finding row header band uses rose-50 background, not orange-50', () => {
        // The "ข้อที่ N" header band on each finding row.
        expect(PANEL_SOURCE).toMatch(/bg-rose-50 px-3 py-2 dark:bg-rose-950\/30/);
        expect(PANEL_SOURCE).not.toMatch(/bg-orange-50 px-3 py-2 dark:bg-orange-950\/30/);
    });

    it('per-finding category Badge uses "red", not "orange"', () => {
        expect(PANEL_SOURCE).toMatch(/<Badge color="red" size="xs">\{finding\.category\}<\/Badge>/);
    });

    it('Before column inherits the rose border accent', () => {
        // The "Before" (non-conformity) column has a right border that
        // must visually tie back to the rose tone family — was
        // border-orange-100, flip to border-rose-100.
        expect(PANEL_SOURCE).toMatch(/border-r border-rose-100 p-3 dark:border-rose-900/);
    });

    it('Before column text label uses rose-700 tint, not red-600', () => {
        // The "ข้อบกพร่อง (Before)" label — was `text-red-600`. The
        // rose family is the platform's destructive scale per the M-4
        // / KPI tile semantic contract, so the text colour aligns to
        // the rose family here too.
        expect(PANEL_SOURCE).toMatch(/text-xs font-semibold text-rose-700/);
    });

    it('annotation comment carries the X3-FIX-B M-4 trace', () => {
        expect(PANEL_SOURCE).toMatch(/X3-FIX-B M-4/);
    });
});
