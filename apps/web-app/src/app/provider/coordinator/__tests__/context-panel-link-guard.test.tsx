/**
 * context-panel-link-guard.test.tsx — role-correctness follow-up (live-caught).
 *
 * The Coordinator right-rail Urgent Monitor deep-links each stuck/deadline row to
 * /provider/applications/:id. The SCHEDULER (this panel's primary consumer) cannot
 * enter /provider/applications, so an unguarded <Link> bounced them straight back
 * to /provider/dashboard — the "เด่งไปเด่งมา" class. #479 guarded the queue table's
 * "รายละเอียด" link in client-view.tsx but MISSED this child panel; the bounce was
 * caught by live Playwright testing on staging (scheduler 3333333333333), not by the
 * unit suite.
 *
 * Fix: the panel takes a `canOpenApplications` prop (computed once in the parent via
 * providerRoleCanOpen) and renders the row as a non-clickable <div> when false —
 * keeping the urgent item VISIBLE (the scheduler still needs to see it) but removing
 * the bouncing navigation. This test pins both directions.
 */

import * as React from 'react';
import { describe, expect, it } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';

import CoordinatorContextPanel from '../coordinator-context-panel';
import { EMPTY, type UrgentMonitorData } from '../coordinator-types';

// next/link → plain anchor so the rendered href is deterministic in static markup.
// The panel always passes a non-empty string href, so no empty-href fallback is needed
// (an empty href would trip jsx-a11y/anchor-is-valid under the repo's --max-warnings=0).
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

const urgent: UrgentMonitorData = {
  stuckItems: [
    { id: 'app-stuck-1', applicationNumber: 'GACP-STUCK-1', applicantName: 'ก เกษตร', status: 'ASSIGNED_FOR_REVIEW', hoursStuck: 30, severity: 'CRITICAL' },
  ],
  deadlineItems: [
    { id: 'app-dl-1', applicationNumber: 'GACP-DL-1', applicantName: 'ข ไร่ดี', status: 'CAR_PENDING', hoursStuck: 0, severity: 'WARNING', hoursLeft: 5, deadlineDue: '2026-06-20T00:00:00.000Z' },
  ],
  summary: { totalStuck: 1, critical: 1, warning: 0, approachingDeadlines: 1 },
};

describe('[role-correctness] CoordinatorContextPanel urgent-monitor link guard', () => {
  it('deep-links to /provider/applications/:id when the role CAN open applications', () => {
    const html = renderToStaticMarkup(
      <CoordinatorContextPanel data={EMPTY} urgent={urgent} workload={null} canOpenApplications={true} />,
    );
    expect(html).toContain('href="/provider/applications/app-stuck-1"');
    expect(html).toContain('href="/provider/applications/app-dl-1"');
  });

  it('renders NO /provider/applications link when the role CANNOT (scheduler) — but keeps the item visible', () => {
    const html = renderToStaticMarkup(
      <CoordinatorContextPanel data={EMPTY} urgent={urgent} workload={null} canOpenApplications={false} />,
    );
    // No bouncing navigation …
    expect(html).not.toContain('/provider/applications/');
    // … but the urgent information stays on screen for the scheduler.
    expect(html).toContain('GACP-STUCK-1');
    expect(html).toContain('GACP-DL-1');
  });
});
