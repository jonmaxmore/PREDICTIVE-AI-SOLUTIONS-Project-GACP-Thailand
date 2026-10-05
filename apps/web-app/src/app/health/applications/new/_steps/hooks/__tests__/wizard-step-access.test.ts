/**
 * F-G4-11 — which wizard step a farmer is allowed to be standing on.
 *
 * The decision only; the page's use of it (does the step render, does the
 * bounce carry a reason) is pinned in
 * `_components/__tests__/application-step-page-url-skip-guard.test.tsx`.
 */

import { describe, expect, it, beforeEach } from '@jest/globals';
import {
  evaluateStepAccess,
  bounceTarget,
  bounceNoticeCopy,
  recordBounce,
  takeBounce,
  FLOW_STEP_NUMBERS,
  PAYMENT_STEP_NUMBERS,
  LAST_FLOW_STEP,
} from '../wizard-step-access';
import type { WizardState } from '../use-application-flow-store.state-types';

const empty = {
  currentStep: 0,
  plantId: null,
  serviceType: null,
  serviceTypes: [],
  certificationPurposes: [],
  siteTypes: [],
  licensePdfUrl: null,
  consentedPDPA: false,
  acknowledgedStandards: false,
  applicantData: null,
  siteData: null,
  productionData: null,
  harvestData: null,
  securityData: null,
  documents: [],
  youtubeUrl: '',
  locationType: null,
  generalInfo: null,
  syncStatus: 'SYNCED',
  cultivationMethods: [],
  cultivationDetails: null,
  stepDocuments: [],
  plantTracking: [],
  qrCount: 0,
  estimatedQRCost: 0,
  farmData: null,
  plots: [],
  lots: [],
} as unknown as WizardState;

/** A store that has cleared v2 steps 1 and 2 (request type, then identity) and nothing else. */
const throughStepTwo = {
  ...empty,
  requestType: 'NEW',
  // plantId: step 1 asks the plant since F-QA-04, so "past step 1" must carry it.
  plantId: 'cannabis',
  applicantType: 'INDIVIDUAL',
  certScope: 'PLANTING',
  applicantData: { applicantType: 'INDIVIDUAL', firstName: 'สมชาย', lastName: 'ใจดี', idCard: '1234567890123', address: '99 หมู่ 3', phone: '0812345678' },
} as unknown as WizardState;

/** A store that has cleared every step the wizard gates. */
const complete = {
  ...throughStepTwo,
  farmData: {
      // 2026-09-06: ขั้น 3 เขียน siteName/siteAddress และไม่เคยสร้างแถว plots
      // fixture เดิมสร้างจากฟิลด์ที่ประตูอ่านผิด จึงเขียวอยู่ได้ทั้งที่ขั้นนั้นทำให้ครบไม่ได้จริง
      siteName: 'ไร่ใจดี', siteAddress: '99 หมู่ 3', landOwnership: 'OWNED',
      landDocumentDetail: { type: 'โฉนด', number: '12345' },
      // จังหวัด/อำเภอ/ตำบล — the certificate names them (43dd39c6)
      subDistrict: 'หนองหาร', district: 'สันทราย', province: 'เชียงใหม่',
      areaTypes: ['OUTDOOR'], areaSqm: '1600',
    },
  plots: [{ id: 'p1', name: 'แปลง 1' }],
  plantId: 'cannabis',
  certificationPurposes: ['EXPORT'],
  cultivationMethods: ['OUTDOOR'],
  productionData: { propagationType: ['SEED'], plantParts: ['LEAF'] },
  harvestData: { harvestMethod: 'MANUAL' },
  documents: [{ id: 'd1', uploaded: true }],
} as unknown as WizardState;

function access(stepNumber: number, state: WizardState, options: { isEditMode?: boolean; ready?: boolean } = {}) {
  return evaluateStepAccess({
    stepNumber,
    state,
    isEditMode: options.isEditMode ?? false,
    ready: options.ready ?? true,
  });
}

describe('the wizard slots', () => {
  it('gates six consecutive URL numbers — v2 has no vacant slot — and the two payment slots', () => {
    expect(FLOW_STEP_NUMBERS).toEqual([1, 2, 3, 4, 5, 6]);
    expect(PAYMENT_STEP_NUMBERS).toEqual([10, 12]);
    expect(LAST_FLOW_STEP).toBe(6);
  });
});

describe('a step whose prerequisites are unmet', () => {
  it('BLOCKS every forward slot for an empty wizard', () => {
    for (const step of [2, 3, 4, 5, 6]) {
      expect(access(step, empty)).toEqual({ kind: 'blocked', requestedStep: step, allowedStep: 1 });
    }
  });

  it('BLOCKS the review step for a wizard that stopped after step 2', () => {
    // The exact defect the operator reported, in v2 numbering: the review step
    // with the site, the plant and the papers all still missing.
    expect(access(6, throughStepTwo)).toEqual({ kind: 'blocked', requestedStep: 6, allowedStep: 3 });
  });

  it('blocks the payment slots until the wizard itself is finished', () => {
    expect(access(10, throughStepTwo)).toEqual({ kind: 'blocked', requestedStep: 10, allowedStep: 3 });
    expect(access(12, throughStepTwo)).toEqual({ kind: 'blocked', requestedStep: 12, allowedStep: 3 });
  });
});

describe('the cases that must keep working', () => {
  it('allows the step the farmer is actually on', () => {
    expect(access(1, empty).kind).toBe('allowed');
    expect(access(3, throughStepTwo).kind).toBe('allowed');
  });

  it('allows going BACK to a completed step', () => {
    for (const step of [1, 2, 3, 4, 5, 6]) {
      expect(access(step, complete).kind).toBe('allowed');
    }
  });

  it('allows the payment slots once the wizard is complete', () => {
    // A farmer who has filed and is going to pay must not be sent back to
    // review. This is the regression a naive `stepNumber > allowed` would cause.
    expect(access(10, complete).kind).toBe('allowed');
    expect(access(12, complete).kind).toBe('allowed');
  });

  it('allows anything in edit mode — a reviewer flagged one step, not the wizard', () => {
    expect(access(6, empty, { isEditMode: true }).kind).toBe('allowed');
    expect(access(10, empty, { isEditMode: true }).kind).toBe('allowed');
  });

  it('waits instead of judging while the store is still settling', () => {
    // Bouncing here is how a resumed draft gets thrown back to step 1.
    expect(access(6, empty, { ready: false })).toEqual({ kind: 'pending' });
  });

  it('leaves a slot the wizard does not have to the step-not-found card', () => {
    expect(access(99, empty).kind).toBe('allowed');
    // 7, 8 and 9 were real slots in v1 and are not slots at all in v2.
    expect(access(9, empty).kind).toBe('allowed');
    expect(access(Number.NaN, empty).kind).toBe('allowed');
  });
});

describe('the bounce', () => {
  beforeEach(() => { takeBounce(-1); });

  it('points at the first incomplete step', () => {
    expect(bounceTarget(3)).toBe('/health/applications/new/step/3');
  });

  it('is handed to the step it was aimed at, exactly once', () => {
    recordBounce({ requestedStep: 6, allowedStep: 3 });
    expect(takeBounce(3)).toEqual({ requestedStep: 6, allowedStep: 3 });
    expect(takeBounce(3)).toBeNull();
  });

  it('is dropped when the farmer ended up somewhere else', () => {
    recordBounce({ requestedStep: 6, allowedStep: 3 });
    expect(takeBounce(2)).toBeNull();
    // …and not left lying around for a later navigation to pick up.
    expect(takeBounce(3)).toBeNull();
  });

  it('names the refused step, the blocking step and the way out — in Thai', () => {
    const copy = bounceNoticeCopy({ requestedStep: 6, allowedStep: 3 }, 'ข้อมูลผู้ยื่นคำขอ');
    expect(copy.title).toContain('6');
    expect(copy.body).toContain('ขั้นตอนที่ 3');
    expect(copy.body).toContain('ข้อมูลผู้ยื่นคำขอ');
    expect(copy.body).toContain('คุณ');
    expect(copy.body).toContain('กรุณา');
    // Thai UI copy law: no em dash.
    expect(copy.title + copy.body).not.toContain('—');
  });
});
