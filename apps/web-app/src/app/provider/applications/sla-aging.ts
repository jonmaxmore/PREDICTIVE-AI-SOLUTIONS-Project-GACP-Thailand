// SLA-aging badge helper for the /provider/applications list.
//
// Extracted from page.tsx: Next.js forbids a page module from exporting
// anything but the default component + route segment config, so `next build`
// rejected `export function getSlaAgingBadge`. Kept here as a pure, testable
// module imported by both the page and __tests__/sla-aging-badge.test.tsx.

import { getSlaDays } from './[id]/provider-application-detail-config';

// DR-5: surface "ค้าง N วัน" inline only for rows the reviewer can actually
// act on — ASSIGNED_FOR_REVIEW is the doc-review queue state. Threshold
// mirrors the backend SLA (> 5 days = overdue; `getSlaDays` flips its danger
// flag at the same boundary).
const SLA_BADGE_WORKFLOW_STATES: ReadonlySet<string> = new Set([
  'ASSIGNED_FOR_REVIEW',
]);
const SLA_BADGE_DAYS_THRESHOLD = 5;

// Minimal structural shape (the page's local `Application` interface satisfies
// it). Avoids a circular import back into page.tsx.
type SlaAgingApplication = {
  status: string;
  workflowState?: string;
  submittedAt: string;
  createdAt?: string;
};

// DR-5: pure helper — derives the SLA badge for a row when the workflow
// state is in the doc-review queue AND days-since-submission crosses the
// threshold. Returns null when the row should not show the badge.
export function getSlaAgingBadge(
  application: SlaAgingApplication,
): { days: number; label: string } | null {
  const workflowStatus = String(application.workflowState || application.status || '').toUpperCase();
  if (!SLA_BADGE_WORKFLOW_STATES.has(workflowStatus)) {
    return null;
  }
  const reference = application.createdAt || application.submittedAt;
  const sla = getSlaDays(reference);
  if (sla.label === '-') {
    return null;
  }
  const days = Number.parseInt(sla.label.split(' ')[0] ?? '', 10);
  if (!Number.isFinite(days) || days < SLA_BADGE_DAYS_THRESHOLD) {
    return null;
  }
  return { days, label: `ค้าง ${days} วัน` };
}
