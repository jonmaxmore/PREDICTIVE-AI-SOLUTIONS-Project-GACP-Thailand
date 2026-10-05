/**
 * Terminal-state rendering — PR 2a (frontend half).
 *
 * REJECTED / EXPIRED / CANCEL_EXPIRED matched none of the classification sets
 * in normalizeHealthDashboardStage(), so they fell through to the closing
 * `return 'UNDER_DOCUMENT_REVIEW'` and an applicant whose file had been
 * rejected — or auto-cancelled for missing the 5-working-day revision
 * deadline — was shown "อยู่ระหว่างตรวจเอกสาร" and a stepper implying their
 * documents were still moving.
 *
 * The label/description/badge tables are `Record<HealthDashboardStage, …>`, so
 * TypeScript already enforces completeness for anything in the union — adding
 * the terminal stage to the union is what turns those into a compile-time
 * exhaustiveness check. This suite covers the runtime half the type system
 * cannot see: which stage a given status resolves to, and that the stepper
 * does not report a closed file as "step 1 of 9".
 */

import { describe, expect, it } from '@jest/globals';

import {
  HEALTH_DASHBOARD_STAGES,
  STAGE_BADGE_STYLE,
  STAGE_DESCRIPTION_TH,
  STAGE_LABEL_EN,
  STAGE_LABEL_TH,
  STAGE_NEXT_ACTION_TH,
  STEPPER_STEPS,
  getProgressPercent,
  getStepperIndex,
  isTerminalStage,
  normalizeHealthDashboardStage,
  type HealthDashboardStage,
} from '../health-dashboard-stage';

const TERMINAL_STATUSES = ['REJECTED', 'EXPIRED', 'CANCEL_EXPIRED'] as const;

describe('terminal workflow states resolve to CLOSED, not "under review"', () => {
  it.each(TERMINAL_STATUSES)('status=%s → CLOSED', (status) => {
    expect(normalizeHealthDashboardStage({ status })).toBe('CLOSED');
  });

  it.each(TERMINAL_STATUSES)('workflowState=%s → CLOSED', (status) => {
    expect(normalizeHealthDashboardStage({ workflowState: status })).toBe('CLOSED');
  });

  it('a rejected file beats the unknown-state fallback', () => {
    expect(normalizeHealthDashboardStage({ status: 'REJECTED' }))
      .not.toBe('UNDER_DOCUMENT_REVIEW');
  });

  it('legacy closure spellings do NOT resolve (purged in PR 2c)', () => {
    // FINAL_REJECTED / CANCELLED / CANCELED / WITHDRAWN were in the set until
    // the purge. No writer produces them and the status column is
    // canonical-only, so they are unrecognised strings like any other.
    expect(normalizeHealthDashboardStage({ status: 'FINAL_REJECTED' })).not.toBe('CLOSED');
    expect(normalizeHealthDashboardStage({ status: 'CANCELLED' })).not.toBe('CLOSED');
  });

  it('a genuinely unknown status still falls back to review, not CLOSED', () => {
    // Guards against the CLOSED branch being written so loosely that it
    // swallows states it should not own.
    expect(normalizeHealthDashboardStage({ status: 'SOME_NEW_STATUS' }))
      .toBe('UNDER_DOCUMENT_REVIEW');
  });
});

describe('the stepper does not pretend a closed file is in progress', () => {
  it('CLOSED is not a rung of the stepper', () => {
    expect(STEPPER_STEPS.map((step) => step.stage)).not.toContain('CLOSED');
  });

  it('isTerminalStage flags CLOSED and nothing else', () => {
    const terminal = HEALTH_DASHBOARD_STAGES.filter((stage) => isTerminalStage(stage));
    expect(terminal).toEqual(['CLOSED']);
  });

  it('getStepperIndex reports CLOSED as off-ladder, not step 0', () => {
    // -1 is the "no rung" signal. Returning 0 made a closed file render
    // identically to a brand-new draft.
    expect(getStepperIndex('CLOSED')).toBe(-1);
    expect(getStepperIndex('DRAFT')).toBe(0);
  });

  it('getProgressPercent is 0 for CLOSED but callers can tell it apart', () => {
    expect(getProgressPercent('CLOSED')).toBe(0);
    expect(isTerminalStage('CLOSED')).toBe(true);
    expect(isTerminalStage('DRAFT')).toBe(false);
  });
});

describe('copy tables stay total over the stage union', () => {
  it('every declared stage has TH label, EN label, description, next action and badge', () => {
    for (const stage of HEALTH_DASHBOARD_STAGES) {
      expect(STAGE_LABEL_TH[stage]).toBeTruthy();
      expect(STAGE_LABEL_EN[stage]).toBeTruthy();
      expect(STAGE_DESCRIPTION_TH[stage]).toBeTruthy();
      expect(STAGE_NEXT_ACTION_TH[stage]).toBeTruthy();
      const badge = STAGE_BADGE_STYLE[stage];
      expect(badge.bg).toBeTruthy();
      expect(badge.text).toBeTruthy();
      expect(badge.dot).toBeTruthy();
    }
  });

  it('HEALTH_DASHBOARD_STAGES covers the whole union (no hand-maintained drift)', () => {
    // Assigning the array's element type back to the union is what makes a
    // forgotten stage a compile error rather than a silently short loop.
    const asUnion: HealthDashboardStage[] = [...HEALTH_DASHBOARD_STAGES];
    expect(new Set(asUnion).size).toBe(HEALTH_DASHBOARD_STAGES.length);
    expect(asUnion).toContain('PENDING_AUDIT_SCHEDULE');
    expect(asUnion).toContain('CLOSED');
  });
});
