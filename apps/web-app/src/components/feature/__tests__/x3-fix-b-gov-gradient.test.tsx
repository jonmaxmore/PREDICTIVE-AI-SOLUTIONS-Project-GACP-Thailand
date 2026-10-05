/**
 * x3-fix-b-gov-gradient.test.tsx — X3-FIX-B (H-8) lineage.
 *
 * SUPERSEDED by the minimal-redesign pass (2026-07-24): all 4 SCHEDULER +
 * AUDITOR page headers below now carry NO gov-gradient. The file is kept
 * (inverted) so the migration is traceable and so a future change cannot
 * silently reinstate a full-bleed dark-green hero on these surfaces.
 *
 * Originally pinned the `gov-gradient` DTAM brand cue on the 4 SCHEDULER +
 * AUDITOR page headers identified by the X3-B audit:
 *
 *   1. PROVIDER/coordinator/client-view.tsx        — Coordinator Dashboard SummaryHeader
 *   2. PROVIDER/audits/client-view.tsx             — Auditor Dashboard SummaryHeader
 *   3. PROVIDER/calendar/client-view.tsx           — Scheduler Calendar SummaryHeader
 *   4. PROVIDER/audits/[id]/page.tsx               — Audit job-sheet page-header section
 *
 * X3-B finding: 7 other PROVIDER pages (dashboard, profile, planting,
 * analytics, documents, reports, applications/[id]) already wear the
 * `gov-gradient` class on their SummaryHeader to carry the Thai
 * government brand cue per `docs/design/gacp-brand-identity-2026-05-16.md`.
 * The 4 SCH + AUD surfaces omitted it — making them look like they
 * belong to a different product.
 *
 * Strategy: source-string assertions (same approach used by
 * `x2-fix-a-detail-page.test.tsx` in this repo) — the JSX-level
 * className contract is locked without the cost of mounting these
 * client-view pages (which require api + notifications mocks that
 * are orthogonal to the visual contract being tested here).
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const APP_ROOT = path.resolve(__dirname, '..', '..', '..', 'app', 'provider');

const COORDINATOR_SOURCE = readFileSync(path.join(APP_ROOT, 'coordinator', 'client-view.tsx'), 'utf8');
const AUDITS_DASHBOARD_SOURCE = readFileSync(path.join(APP_ROOT, 'audits', 'client-view.tsx'), 'utf8');
const CALENDAR_SOURCE = readFileSync(path.join(APP_ROOT, 'calendar', 'client-view.tsx'), 'utf8');
const AUDIT_JOB_SHEET_SOURCE = readFileSync(path.join(APP_ROOT, 'audits', '[id]', 'page.tsx'), 'utf8');

describe('X3-FIX-B H-8 lineage — no gov-gradient hero on SCH + AUD page headers', () => {
    // SAP-Fiori launchpad rollout (Phase B, 2026-06-25): the COORDINATOR
    // (B2) and AUDITS dashboard (B3) landing heroes were replaced with the
    // compact <LaunchpadHeader> launchpad band (same precedent as B1
    // dashboard + B4 accounting/page.tsx).
    //
    // Minimal-redesign pass (2026-07-24): the last two holdouts — the
    // Scheduler CALENDAR SummaryHeader and the Audit job-sheet ([id])
    // header strip — dropped the gradient too. Rationale: the job sheet
    // already gets its Thai title + applicant subtitle from ProviderLayout,
    // so the gradient block was a second competing header; and a dark
    // full-bleed band is the single loudest element on an otherwise calm
    // white-card staff console. Both are now plain hairline cards.

    it('coordinator/client-view.tsx leads with the SAP-Fiori LaunchpadHeader (gov-gradient hero removed)', () => {
        expect(COORDINATOR_SOURCE).toMatch(/<LaunchpadHeader/);
        expect(COORDINATOR_SOURCE).not.toMatch(/className="gov-gradient border-none shadow-xl shadow-primary\/20"/);
    });

    it('audits/client-view.tsx leads with the SAP-Fiori LaunchpadHeader (gov-gradient hero removed)', () => {
        expect(AUDITS_DASHBOARD_SOURCE).toMatch(/<LaunchpadHeader/);
        expect(AUDITS_DASHBOARD_SOURCE).not.toMatch(/className="gov-gradient border-none shadow-xl shadow-primary\/20"/);
    });

    it('calendar/client-view.tsx SummaryHeader is a plain card (gov-gradient hero removed)', () => {
        expect(CALENDAR_SOURCE).toMatch(/<SummaryHeader/);
        expect(CALENDAR_SOURCE).not.toMatch(/gov-gradient/);
    });

    it('audits/[id]/page.tsx page-header section is a plain hairline card', () => {
        // The job-sheet page does not use <SummaryHeader> — it has its own
        // header strip. That wrapping div is now a hairline card holding the
        // same badges/schedule line/actions, with no gradient and no
        // shadow-xl. Match either ordering since formatters can re-order.
        expect(AUDIT_JOB_SHEET_SOURCE).toMatch(/className="mb-4 rounded-lg border border-border bg-card p-4"/);
        expect(AUDIT_JOB_SHEET_SOURCE).not.toMatch(/gov-gradient/);
    });

    it('neither surface reinstates a shadow-xl hero band', () => {
        expect(CALENDAR_SOURCE).not.toMatch(/shadow-xl shadow-primary\/20/);
        expect(AUDIT_JOB_SHEET_SOURCE).not.toMatch(/shadow-xl shadow-primary\/20/);
    });
});
