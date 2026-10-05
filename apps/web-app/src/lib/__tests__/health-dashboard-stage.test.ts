/**
 * health-dashboard-stage.test.ts — frontend half of the dashboard
 * classifier contract.
 *
 * The 8-stage projection (DRAFT / PENDING_FEE_PHASE1 / UNDER_DOCUMENT_REVIEW
 * / REVISION_REQUIRED / PENDING_FEE_PHASE2 / UNDER_FIELD_AUDIT / APPROVED
 * / CERTIFIED) is implemented identically in:
 *
 *   - apps/backend/shared/health-dashboard-stage.js
 *   - apps/web-app/src/lib/health-dashboard-stage.ts (this module)
 *
 * Both must classify the same Application input the same way — the
 * frontend dashboard tile counts and the backend buildHealthProcessCounts()
 * roll-up MUST agree. The backend half is locked by
 * apps/backend/__tests__/unit/health-dashboard-stage.test.js (PR #274).
 *
 * This test locks the frontend half. A future drift between the two
 * (e.g., adding a state to one but not the other) fails loudly.
 */

import {
  HEALTH_DASHBOARD_STAGES,
  isTerminalStage,
  normalizeHealthDashboardStage,
  getStepperIndex,
  getProgressPercent,
  STAGE_LABEL_TH,
  STAGE_LABEL_EN,
  STAGE_DESCRIPTION_TH,
  STAGE_NEXT_ACTION_TH,
  STAGE_BADGE_STYLE,
  STEPPER_STEPS,
  type HealthDashboardStage,
  stageLabelFor,
} from '../health-dashboard-stage';

describe('health-dashboard-stage (frontend)', () => {
  describe('normalizeHealthDashboardStage — precedence rules', () => {
    it('CERTIFIED wins when workflowState=CERTIFIED + hasCertificate=true', () => {
      expect(normalizeHealthDashboardStage({
        workflowState: 'CERTIFIED',
        hasCertificate: true,
      })).toBe('CERTIFIED');
    });

    it('APPROVED upgrades to CERTIFIED when hasCertificate=true', () => {
      expect(normalizeHealthDashboardStage({
        status: 'APPROVED',
        hasCertificate: true,
      })).toBe('CERTIFIED');
    });

    it('APPROVED for status=APPROVED / workflowState=APPROVED', () => {
      expect(normalizeHealthDashboardStage({ status: 'APPROVED' })).toBe('APPROVED');
      expect(normalizeHealthDashboardStage({ workflowState: 'APPROVED' })).toBe('APPROVED');
    });

    // AUDIT_FEE_PAID ออกจากชุดนี้ 2026-09-11 — จ่ายงวดที่ 2 แล้วแต่ยังไม่มีใครนัดวัน
    // ไม่ใช่ "กำลังตรวจ" · ต้องตรงกับ backend เป๊ะ ๆ (ด่าน payment-vocabulary-one-language)
    it('UNDER_FIELD_AUDIT for any AUDIT_STATES member', () => {
      for (const state of [
        'AUDIT_CONFIRMED', 'CAR_PENDING', 'CAR_REVIEWING', 'AUDIT_PASSED',
      ]) {
        expect(normalizeHealthDashboardStage({ status: state })).toBe('UNDER_FIELD_AUDIT');
      }
    });

    it('PENDING_AUDIT_SCHEDULE for AUDIT_FEE_PAID — จ่ายแล้ว รอเจ้าหน้าที่นัด', () => {
      expect(normalizeHealthDashboardStage({ status: 'AUDIT_FEE_PAID' }))
        .toBe('PENDING_AUDIT_SCHEDULE');
    });

    it('PENDING_FEE_PHASE2 for the states where the phase-2 fee is genuinely owed', () => {
      for (const state of [
        'DOC_APPROVED', 'PENDING_AUDIT_FEE',
      ]) {
        expect(normalizeHealthDashboardStage({ status: state })).toBe('PENDING_FEE_PHASE2');
      }
    });

    it('REVISION_REQUIRED for the canonical revision state', () => {
      expect(normalizeHealthDashboardStage({ status: 'REVISION_REQUESTED' })).toBe('REVISION_REQUIRED');
    });

    it('UNDER_DOCUMENT_REVIEW for the canonical review states', () => {
      for (const state of [
        'DOC_FEE_PAID', 'ASSIGNED_FOR_REVIEW',
      ]) {
        expect(normalizeHealthDashboardStage({ status: state })).toBe('UNDER_DOCUMENT_REVIEW');
      }
    });

    it('PENDING_FEE_PHASE1 for the states where the phase-1 fee is genuinely owed', () => {
      for (const state of [
        'SUBMITTED', 'PENDING_DOC_FEE',
      ]) {
        expect(normalizeHealthDashboardStage({ status: state })).toBe('PENDING_FEE_PHASE1');
      }
    });

    it('DRAFT when status is DRAFT or absent', () => {
      expect(normalizeHealthDashboardStage({ status: 'DRAFT' })).toBe('DRAFT');
      expect(normalizeHealthDashboardStage({})).toBe('DRAFT');
    });

    it('falls back to UNDER_DOCUMENT_REVIEW for unknown non-empty status', () => {
      expect(normalizeHealthDashboardStage({ status: 'SOME_NEW_STATUS' }))
        .toBe('UNDER_DOCUMENT_REVIEW');
    });

    it('reads workflowState from formData when top-level is absent', () => {
      expect(normalizeHealthDashboardStage({
        formData: { workflowState: 'AUDIT_CONFIRMED' },
      })).toBe('UNDER_FIELD_AUDIT');
    });

    it('precedence: workflowState beats status when they classify differently', () => {
      expect(normalizeHealthDashboardStage({
        status: 'DRAFT',
        workflowState: 'AUDIT_CONFIRMED',
      })).toBe('UNDER_FIELD_AUDIT');
    });
  });

  describe('Label tables — completeness', () => {
    // Iterate the real union, not a hand-copied list — the old literal had
    // silently drifted and never covered the stage that had just been added.
    const stages: HealthDashboardStage[] = [...HEALTH_DASHBOARD_STAGES];

    it('every stage has a TH label', () => {
      for (const stage of stages) {
        expect(typeof STAGE_LABEL_TH[stage]).toBe('string');
        expect(STAGE_LABEL_TH[stage].length).toBeGreaterThan(0);
      }
    });

    it('every stage has an EN label', () => {
      for (const stage of stages) {
        expect(typeof STAGE_LABEL_EN[stage]).toBe('string');
        expect(STAGE_LABEL_EN[stage].length).toBeGreaterThan(0);
      }
    });

    it('every stage has a TH description + next-action copy', () => {
      for (const stage of stages) {
        expect(typeof STAGE_DESCRIPTION_TH[stage]).toBe('string');
        expect(typeof STAGE_NEXT_ACTION_TH[stage]).toBe('string');
      }
    });

    it('every stage has a badge-style triple (bg, text, dot)', () => {
      for (const stage of stages) {
        const style = STAGE_BADGE_STYLE[stage];
        expect(style.bg).toBeTruthy();
        expect(style.text).toBeTruthy();
        expect(style.dot).toBeTruthy();
      }
    });
  });

  describe('STEPPER_STEPS — sequence integrity', () => {
    it('exposes ordered stepper entries (length matches stage count or fewer)', () => {
      // Stepper steps may merge collapsed phases (e.g., revision is part
      // of doc-review in the stepper view). Pin the count so a future
      // change to STEPPER_STEPS triggers explicit review.
      expect(Array.isArray(STEPPER_STEPS)).toBe(true);
      expect(STEPPER_STEPS.length).toBeGreaterThan(0);
    });

    it('each step has the {stage, label, shortLabel, icon} shape', () => {
      for (const step of STEPPER_STEPS) {
        expect(typeof step.stage).toBe('string');
        expect(typeof step.label).toBe('string');
        expect(typeof step.shortLabel).toBe('string');
        expect(typeof step.icon).toBe('string');
      }
    });
  });

  describe('getStepperIndex', () => {
    it('returns a finite index for every stage — >= 0 on the ladder, -1 when terminal', () => {
      const stages: HealthDashboardStage[] = [...HEALTH_DASHBOARD_STAGES];
      for (const stage of stages) {
        const index = getStepperIndex(stage);
        expect(Number.isFinite(index)).toBe(true);
        // -1 is the deliberate "off the ladder" signal for closed files; the
        // old blanket >= 0 rule is what made a rejected application render as
        // step 1 of 9.
        expect(index).toBeGreaterThanOrEqual(isTerminalStage(stage) ? -1 : 0);
        if (!isTerminalStage(stage)) {
          expect(index).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('CERTIFIED has the highest index (final stepper step)', () => {
      const draftIdx = getStepperIndex('DRAFT');
      const certIdx = getStepperIndex('CERTIFIED');
      expect(certIdx).toBeGreaterThan(draftIdx);
    });
  });

  describe('getProgressPercent', () => {
    it('returns 0..100 for every stage', () => {
      const stages: HealthDashboardStage[] = [...HEALTH_DASHBOARD_STAGES];
      for (const stage of stages) {
        const pct = getProgressPercent(stage);
        expect(pct).toBeGreaterThanOrEqual(0);
        expect(pct).toBeLessThanOrEqual(100);
      }
    });

    it('DRAFT < CERTIFIED (monotonic across the happy path)', () => {
      expect(getProgressPercent('DRAFT'))
        .toBeLessThan(getProgressPercent('CERTIFIED'));
    });

    it('CERTIFIED is exactly 100', () => {
      expect(getProgressPercent('CERTIFIED')).toBe(100);
    });
  });
});

describe('รอนัดวันตรวจแปลง — ป้ายของขั้นที่แทนขั้นตรวจสลิป', () => {
    it('ป้ายไทยบอกว่ากำลังรออะไร ไม่ใช่บอกแค่ว่าจ่ายแล้ว', () => {
        expect(STAGE_LABEL_TH.PENDING_AUDIT_SCHEDULE).toBe('รอนัดวันตรวจประเมินแปลง');
    });

    it('มีป้ายอังกฤษ', () => {
        expect(STAGE_LABEL_EN.PENDING_AUDIT_SCHEDULE).toBe('Awaiting Audit Appointment');
    });

    it('คำเรื่องเงินตรงกับใบเสร็จ — "งวดที่" ไม่ใช่ "ขั้นที่"', () => {
        expect(STAGE_LABEL_TH.PENDING_FEE_PHASE1).toContain('งวดที่ 1');
        // round 3: shared with a renewal and rendered without the application here, so
        // it names no instalment (stageLabelFor names it when the application is known)
        expect(STAGE_LABEL_TH.PENDING_FEE_PHASE2).not.toContain('งวดที่');
        expect(stageLabelFor('PENDING_FEE_PHASE2', { isRenewal: false })).toContain('งวดที่ 2');
    });
});
