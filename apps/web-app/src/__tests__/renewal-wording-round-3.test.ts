/**
 * fix/fee-line-descriptions round 3 (operator 2026-10-03: "prices are real costs and must be
 * shown completely and correctly").
 *
 * A renewal sits in PENDING_AUDIT_FEE too. A label rendered WITHOUT an application at hand
 * cannot know which it is, so it must be true for both — it may not name "งวดที่ 2". A label
 * rendered WITH the application uses the renewal wording for a renewal and the instalment
 * wording for a new filing (stageLabelFor and friends).
 */
import { describe, expect, it } from '@jest/globals';
import { STATUS_LABELS } from '@/lib/constants/workflow-states';
import {
  STAGE_LABEL_TH,
  STAGE_DESCRIPTION_TH,
  STAGE_NEXT_ACTION_TH,
  stageLabelFor,
  stageDescriptionFor,
  stageNextActionFor,
  stepperStepsFor,
} from '@/lib/health-dashboard-stage';
import { STEP_LABEL_TH, mapStatusToDisplay } from '@/lib/status-display/stage-map';
import { STATUS_NEXT_ACTIONS } from '@/lib/status-mapping';
import { ACTION_META } from '@/app/health/applications/[id]/application-detail-page-config';
import { thCore } from '@/lib/i18n/dictionaries/sections/th-core';

const NOT_PHASE_2 = /งวดที่ 2|ตรวจประเมินแปลงและออกใบรับรอง/;

describe('context-free labels for the state a renewal shares are true for both', () => {
  it.each([
    ['workflow-states PENDING_AUDIT_FEE', () => STATUS_LABELS.PENDING_AUDIT_FEE],
    ['stage label PENDING_FEE_PHASE2', () => STAGE_LABEL_TH.PENDING_FEE_PHASE2],
    ['stage description PENDING_FEE_PHASE2', () => STAGE_DESCRIPTION_TH.PENDING_FEE_PHASE2],
    ['stage description PENDING_AUDIT_SCHEDULE', () => STAGE_DESCRIPTION_TH.PENDING_AUDIT_SCHEDULE],
    ['stage next action PENDING_FEE_PHASE2', () => STAGE_NEXT_ACTION_TH.PENDING_FEE_PHASE2],
    ['display step 3', () => STEP_LABEL_TH[3]],
    ['display actor PENDING_AUDIT_FEE', () => mapStatusToDisplay('PENDING_AUDIT_FEE').actorTH],
    ['next action PENDING_AUDIT_FEE', () => STATUS_NEXT_ACTIONS.PENDING_AUDIT_FEE.nextAction],
    ['description PENDING_AUDIT_FEE', () => STATUS_NEXT_ACTIONS.PENDING_AUDIT_FEE.description],
    ['action meta PAY_AUDIT_FEE hint', () => ACTION_META.PAY_AUDIT_FEE.hint],
    ['action meta PAY_AUDIT_FEE button', () => ACTION_META.PAY_AUDIT_FEE.buttonLabel],
    ['th-core status PENDING_AUDIT_FEE', () => JSON.stringify(thCore).match(/"PENDING_AUDIT_FEE":"([^"]*)"/)?.[1] ?? ''],
    ['th-core status PAYMENT_2_PENDING', () => JSON.stringify(thCore).match(/"PAYMENT_2_PENDING":"([^"]*)"/)?.[1] ?? ''],
  ])('%s', (_label, get) => {
    const text = get();
    expect(text).toBeTruthy();
    expect(text).not.toMatch(NOT_PHASE_2);
  });
});

describe('with the application at hand the label says which it is', () => {
  it('a renewal names the renewal service', () => {
    expect(stageLabelFor('PENDING_FEE_PHASE2', { isRenewal: true })).toBe('รอชำระค่าบริการต่ออายุใบรับรอง');
    expect(stageNextActionFor('PENDING_FEE_PHASE2', { isRenewal: true })).toBe('ชำระค่าบริการต่ออายุใบรับรอง');
    expect(stageDescriptionFor('PENDING_FEE_PHASE2', { isRenewal: true })).not.toMatch(NOT_PHASE_2);
    expect(stageDescriptionFor('PENDING_FEE_PHASE2', { isRenewal: true })).toContain('ค่าบริการต่ออายุใบรับรอง');
    const step = stepperStepsFor({ isRenewal: true }).find((s) => s.stage === 'PENDING_FEE_PHASE2')!;
    expect(`${step.label} ${step.shortLabel}`).not.toMatch(NOT_PHASE_2);
  });

  it('a new filing names its instalment', () => {
    expect(stageLabelFor('PENDING_FEE_PHASE2', { isRenewal: false })).toBe('รอชำระงวดที่ 2 ค่าบริการตรวจประเมินแปลงและออกใบรับรอง');
    expect(stageNextActionFor('PENDING_FEE_PHASE2', { isRenewal: false })).toBe('ชำระงวดที่ 2');
  });

  it('without the answer it falls back to the neutral map', () => {
    expect(stageLabelFor('PENDING_FEE_PHASE2', {})).toBe(STAGE_LABEL_TH.PENDING_FEE_PHASE2);
  });
});

// round 5 (review): a renewal pays ONE charge and skips document review, so its stepper
// has a single payment step (the renewal service) and no instalment-1 / review steps.
describe('a renewal stepper has a single renewal payment step', () => {
  it('drops instalment 1 and document review, names the payment step as the renewal', () => {
    const steps = stepperStepsFor({ isRenewal: true });
    const pay = steps.filter((s) => s.icon === 'CreditCard');
    expect(pay).toHaveLength(1);
    expect(pay[0]!.stage).toBe('PENDING_FEE_PHASE2');
    expect(steps.map((s) => s.stage)).not.toEqual(expect.arrayContaining(['PENDING_FEE_PHASE1']));
    expect(steps.map((s) => s.stage)).not.toEqual(expect.arrayContaining(['UNDER_DOCUMENT_REVIEW']));
    for (const s of steps) expect(`${s.label} ${s.shortLabel}`).not.toMatch(/งวดที่/);
  });
});
