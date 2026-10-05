/**
 * Who is allowed to be standing on a wizard step, and what to say when they
 * are not.
 *
 * F-G4-11 (2026-08-26). The wizard is nine numbered URLs. Typing a higher
 * number used to work: with a populated store the guard in
 * application-step-page.tsx never even ran (it waited on a flag that only the
 * fresh-store branch ever set), and on the branch where it did run the step
 * rendered anyway and the farmer was teleported with no explanation.
 *
 * This module holds the decision on its own so it can be tested without a
 * browser, and so the page has one thing to ask instead of four conditions to
 * re-derive. The refusal it produces is a decision, not a redirect: navigating
 * and rendering stay in the component.
 *
 * The server has the same decision, expressed over the same canonical field
 * names, in `apps/backend/validation/wizard-step-prerequisites.js`. That one is
 * the authority; this one is the convenience that keeps the wizard usable
 * before (and between) saves.
 */

import { firstIncompleteStep } from './use-application-flow-store';
import type { WizardState } from './use-application-flow-store.state-types';
import { FLOW_STEPS, PAYMENT_STEPS } from '../application-flow-config';

/** The numbered slots the wizard's own completeness rules govern: 1, 2, 4..9. */
export const FLOW_STEP_NUMBERS: readonly number[] = FLOW_STEPS.map((step) => step.stepNumber);

/** The post-submission slots: payment (10) and success (12). */
export const PAYMENT_STEP_NUMBERS: readonly number[] = PAYMENT_STEPS.map((step) => step.stepNumber);

/** Review — the last step the wizard's completeness rules can reach. */
export const LAST_FLOW_STEP = FLOW_STEP_NUMBERS[FLOW_STEP_NUMBERS.length - 1] as number;

export type StepAccess =
  /** Nothing is known yet: the store has not settled. Render neither step nor refusal. */
  | { kind: 'pending' }
  | { kind: 'allowed' }
  | { kind: 'blocked'; requestedStep: number; allowedStep: number };

export interface StepAccessInput {
  /** The step number in the URL. */
  stepNumber: number;
  /** The wizard store as it currently stands. */
  state: WizardState;
  /** A draft being corrected: every step was satisfied in an earlier session. */
  isEditMode: boolean;
  /**
   * Whether the store can be trusted yet — persisted state rehydrated AND the
   * server draft fetch settled. Judging before that bounces a farmer whose
   * data simply had not loaded, which is how a resume gets broken.
   */
  ready: boolean;
}

/**
 * Decide whether this step may render.
 *
 * Rules, in order:
 *  - Not ready → 'pending'.
 *  - A step number the wizard does not have → 'allowed'; the page's own
 *    step-not-found card is the right answer to /step/99, not a bounce.
 *  - Edit mode → 'allowed'. A reviewer asked for a fix on one step; sending
 *    the applicant back to step 1 to reach it is the bug, not the guard.
 *  - A payment slot (10, 12) → allowed only once the wizard itself is
 *    finished. These screens are about a filed application, and what they show
 *    is decided by the server's status, so the wizard's only stake in them is
 *    that nobody arrives before filing.
 *  - A wizard slot → allowed up to and including the first incomplete step.
 *    At or behind the frontier is always allowed: going back is legitimate.
 */
export function evaluateStepAccess({ stepNumber, state, isEditMode, ready }: StepAccessInput): StepAccess {
  if (!ready) return { kind: 'pending' };
  if (!Number.isFinite(stepNumber)) return { kind: 'allowed' };

  const isFlowStep = FLOW_STEP_NUMBERS.includes(stepNumber);
  const isPaymentStep = PAYMENT_STEP_NUMBERS.includes(stepNumber);
  if (!isFlowStep && !isPaymentStep) return { kind: 'allowed' };

  if (isEditMode) return { kind: 'allowed' };

  const allowedStep = firstIncompleteStep(state);

  if (isPaymentStep) {
    return allowedStep === LAST_FLOW_STEP
      ? { kind: 'allowed' }
      : { kind: 'blocked', requestedStep: stepNumber, allowedStep };
  }

  return stepNumber <= allowedStep
    ? { kind: 'allowed' }
    : { kind: 'blocked', requestedStep: stepNumber, allowedStep };
}

/** Where a blocked farmer is sent. */
export function bounceTarget(allowedStep: number): string {
  return `/health/applications/new/step/${allowedStep}`;
}

export interface BounceNotice {
  requestedStep: number;
  allowedStep: number;
}

/**
 * What the farmer reads on the step they were sent back to.
 *
 * A bounce with no words reads as a broken app: the address bar changes on its
 * own and the screen is not the one that was asked for. So the notice names
 * the step that was refused, the step that is blocking, and the one action
 * that clears it.
 */
export function bounceNoticeCopy(notice: BounceNotice, allowedStepTitle: string): { title: string; body: string } {
  return {
    title: `ยังไปที่ขั้นตอนที่ ${notice.requestedStep} ไม่ได้`,
    body: `คุณยังกรอกข้อมูลขั้นตอนที่ ${notice.allowedStep} ${allowedStepTitle} ไม่ครบ `
      + `ระบบจึงพาคุณกลับมาที่ขั้นตอนนี้ กรุณากรอกข้อมูลในหน้านี้ให้ครบแล้วกดปุ่มถัดไป `
      + `เพื่อไปยังขั้นตอนต่อไป`,
  };
}

/**
 * The bounce and the notice happen on two different URLs, so the reason has to
 * survive one `router.replace`. Module scope is the whole lifetime it needs:
 * it must not outlive a page reload (a reload is not a bounce and should show
 * nothing), and it must not be stored anywhere a later session could read it.
 */
let pendingBounce: BounceNotice | null = null;

export function recordBounce(notice: BounceNotice): void {
  pendingBounce = notice;
}

/**
 * Hand over the pending bounce if it was aimed at `stepNumber`, clearing it so
 * it is read exactly once. A bounce aimed elsewhere is dropped: it belongs to a
 * navigation that has been overtaken.
 */
export function takeBounce(stepNumber: number): BounceNotice | null {
  if (!pendingBounce) return null;
  const notice = pendingBounce;
  pendingBounce = null;
  return notice.allowedStep === stepNumber ? notice : null;
}
