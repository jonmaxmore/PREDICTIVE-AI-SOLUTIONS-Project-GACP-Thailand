/**
 * Step-component barrel for the PDPA ม.32 erasure flow.
 *
 * Each subcomponent is a pure presentational view; the orchestrator
 * (`client-view.tsx`) owns the state machine + service calls and passes
 * handlers via props. See R6-C handoff + R4 review M-2 for the split
 * rationale.
 */
export { ReviewStep } from './ReviewStep';
export type { ReviewStepProps } from './ReviewStep';
export { RequestStep } from './RequestStep';
export type { RequestStepProps } from './RequestStep';
export { AwaitingStep } from './AwaitingStep';
export type { AwaitingStepProps } from './AwaitingStep';
export { ConfirmStep } from './ConfirmStep';
export type { ConfirmStepProps } from './ConfirmStep';
export { SuccessStep } from './SuccessStep';
export type { SuccessStepProps } from './SuccessStep';
export { LegalFooter } from './LegalFooter';
