/**
 * stage-map.test.ts — Task 6 (tile-home-redesign N8).
 *
 * The task brief presumed `import { ALL_WORKFLOW_STATUSES } from
 * '@/lib/workflow-status'` — that module does not exist in this FE. The real
 * canonical FE vocabulary (20 states, matches the backend SSOT at
 * apps/backend/services/workflow-transition-service.js:18-39) is
 * `WORKFLOW_STATES` / `WorkflowState` in
 * `@/lib/constants/workflow-states.ts` — already consumed by
 * application-detail-page-config.ts, dashboard-utils.ts, etc. Imported here
 * (aliased to the brief's name) as the completeness-test source.
 */
import { describe, expect, it } from '@jest/globals';
import { mapStatusToDisplay } from '../stage-map';
import { WORKFLOW_STATES as ALL_WORKFLOW_STATUSES } from '@/lib/constants/workflow-states';

describe('mapStatusToDisplay', () => {
  it('ทุกสถานะใน vocabulary มี mapping (ไม่มีสถานะตกหล่น)', () => {
    for (const s of ALL_WORKFLOW_STATUSES) expect(() => mapStatusToDisplay(s)).not.toThrow();
  });

  it('PENDING_AUDIT_FEE = ขั้น 3 และรอผู้ใช้จ่าย', () => {
    expect(mapStatusToDisplay('PENDING_AUDIT_FEE')).toMatchObject({
      step: 3,
      needsUserAction: true,
      actionTH: 'ชำระเงินตอนนี้',
    });
  });

  it('AUDIT_PASSED = ขั้น 5 ไม่ต้องทำอะไร', () => {
    expect(mapStatusToDisplay('AUDIT_PASSED')).toMatchObject({ step: 5, needsUserAction: false });
  });

  it('REVISION_REQUESTED = ขั้น 2 รอผู้ใช้แก้เอกสาร', () => {
    expect(mapStatusToDisplay('REVISION_REQUESTED')).toMatchObject({ step: 2, needsUserAction: true });
  });

  it('every mapping carries a non-empty Thai stepLabelTH + actorTH', () => {
    for (const s of ALL_WORKFLOW_STATUSES) {
      const result = mapStatusToDisplay(s);
      expect(result.stepLabelTH.length).toBeGreaterThan(0);
      expect(result.actorTH.length).toBeGreaterThan(0);
      expect(result.step).toBeGreaterThanOrEqual(1);
      expect(result.step).toBeLessThanOrEqual(5);
    }
  });

  it('the 5 step labels match spec verbatim, in step order', () => {
    const labelsByStep = new Map<number, string>();
    for (const s of ALL_WORKFLOW_STATUSES) {
      const { step, stepLabelTH } = mapStatusToDisplay(s);
      labelsByStep.set(step, stepLabelTH);
    }
    expect(labelsByStep.get(1)).toBe('ยื่นคำขอ');
    expect(labelsByStep.get(2)).toBe('ตรวจเอกสาร');
    expect(labelsByStep.get(3)).toBe('ชำระค่าบริการ');
    expect(labelsByStep.get(4)).toBe('ตรวจแปลง');
    expect(labelsByStep.get(5)).toBe('ออกใบรับรอง');
  });

  it('needsUserAction true always carries a non-empty actionTH', () => {
    for (const s of ALL_WORKFLOW_STATUSES) {
      const result = mapStatusToDisplay(s);
      if (result.needsUserAction) {
        expect(result.actionTH).toBeTruthy();
      }
    }
  });

  // Fix round 1 — coordinator ruling: EXPIRED/CANCEL_EXPIRED have 4 possible
  // origins landing at steps 2/2/3/4 (workflow-transition-service.js), not
  // recoverable from the status string alone on the list endpoint. `terminal:
  // true` tells the client to never render `step` as an active-step marker
  // for these. REJECTED keeps a real step (single origin: AUDIT_CONFIRMED).
  it('EXPIRED and CANCEL_EXPIRED are terminal (step is a floor, not a claimed current step)', () => {
    expect(mapStatusToDisplay('EXPIRED')).toMatchObject({ terminal: true, step: 2 });
    expect(mapStatusToDisplay('CANCEL_EXPIRED')).toMatchObject({ terminal: true, step: 2 });
  });

  it('REJECTED is terminal at step 4 (single accurate origin: AUDIT_CONFIRMED)', () => {
    expect(mapStatusToDisplay('REJECTED')).toMatchObject({ terminal: true, step: 4 });
  });

  it('no non-terminal status carries terminal: true', () => {
    const NON_TERMINAL = ALL_WORKFLOW_STATUSES.filter(
      (s) => s !== 'REJECTED' && s !== 'EXPIRED' && s !== 'CANCEL_EXPIRED',
    );
    for (const s of NON_TERMINAL) {
      expect(mapStatusToDisplay(s).terminal).toBeUndefined();
    }
  });
});
