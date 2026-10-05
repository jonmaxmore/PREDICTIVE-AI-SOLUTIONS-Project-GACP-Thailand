/**
 * V-02 (audit 2026-06-10) — provider dashboard queue must render Thai status labels.
 *
 * The dashboard queue (toQueueItem → item.stageLabel) used to carry a LOCAL English
 * STATUS_LABELS map that shadowed the canonical Thai map and was missing REJECTED/
 * EXPIRED (so "REJECTED" rendered as the raw enum). It now uses the canonical Thai
 * labels from workflow-states.ts. These assertions lock that — a future regression to
 * an English/duplicate map would fail here.
 */
import { describe, expect, it } from '@jest/globals';
import { toQueueItem } from '../dashboard-utils';
import { STATUS_LABELS as CANONICAL } from '@/lib/constants/workflow-states';

describe('[audit-2026-06-10 V-02] provider dashboard status labels are Thai', () => {
  it('maps a raw CERTIFIED enum to the canonical Thai label (not "Certified")', () => {
    const item = toQueueItem({ id: 'a1', workflowState: 'CERTIFIED' });
    expect(item.stageLabel).toBe(CANONICAL.CERTIFIED);
    expect(item.stageLabel).toBe('ออกใบรับรองแล้ว');
    expect(item.stageLabel).not.toMatch(/[A-Za-z]/); // no English
  });

  it('maps REJECTED to Thai (the state the old local map was missing)', () => {
    const item = toQueueItem({ id: 'a2', status: 'REJECTED' });
    expect(item.stageLabel).toBe(CANONICAL.REJECTED);
    expect(item.stageLabel).toBe('ปฏิเสธ');
  });

  it('maps the common queue states to Thai', () => {
    const cases: Array<[string, string]> = [
      ['CAR_REVIEWING', CANONICAL.CAR_REVIEWING],
      ['AUDIT_PASSED', CANONICAL.AUDIT_PASSED],
      ['ASSIGNED_FOR_REVIEW', CANONICAL.ASSIGNED_FOR_REVIEW],
      ['PENDING_DOC_FEE', CANONICAL.PENDING_DOC_FEE],
      ['REVISION_REQUESTED', CANONICAL.REVISION_REQUESTED],
    ];
    for (const [state, thai] of cases) {
      expect(toQueueItem({ id: 'x', workflowState: state }).stageLabel).toBe(thai);
    }
  });
});
