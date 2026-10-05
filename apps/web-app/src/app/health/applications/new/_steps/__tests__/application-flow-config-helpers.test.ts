/**
 * Tests for application-flow-config language resolver helpers.
 *
 * System deep-dive Tier 7 — Frontend + i18n + QA (2026-05-15).
 *
 * Pure-function tests — intentionally do NOT import FLOW_STEPS /
 * PAYMENT_STEPS, because those pull in `@/components/ui/icons` which
 * transitively imports Tabler/Lucide ESM bundles that ts-jest stumbles on.
 * The helpers themselves don't depend on icons; we feed them inline
 * fixtures so the test stays hermetic and fast.
 *
 * What the helpers guarantee (and what these tests anchor):
 *   1. `resolveStepLabel(step, 'en')` returns `labelEN` when present,
 *      Thai `label` otherwise — pure fallback semantics.
 *   2. `resolveStepLabel(step, 'th')` ALWAYS returns Thai `label` —
 *      English translation is opt-in via language='en' only.
 *   3. Same fallback semantics for `resolveStepTitle` and
 *      `resolveStepDescription`.
 *
 * Backward-compat invariant: existing callers that read `step.label`
 * directly continue to see Thai text — these helpers add an EN path
 * without changing the Thai default.
 */

import {
    resolveStepLabel,
    resolveStepTitle,
    resolveStepDescription,
    type FlowStep,
    type PaymentStep,
} from '../application-flow-config';

// Hand-crafted fixtures — no icon imports.
const mkFlowStep = (overrides: Partial<FlowStep> = {}): FlowStep => ({
    stepNumber: 1,
    key: 'fixture',
    label: 'ฉลากไทย',
    titleTH: 'หัวข้อไทย',
    description: 'คำอธิบายไทย',
    // `icon` is required by the type; for the resolver helpers it's
    // unused, so a no-op component literal is fine.
    icon: (() => null) as unknown as FlowStep['icon'],
    isRequired: true,
    ...overrides,
});

const mkPaymentStep = (overrides: Partial<PaymentStep> = {}): PaymentStep => ({
    stepNumber: 10,
    key: 'fixture-pay',
    label: 'ฉลากชำระเงินไทย',
    titleTH: 'หัวข้อชำระเงินไทย',
    isRequired: true,
    ...overrides,
});

describe('[Tier 7] resolveStepLabel', () => {
    it('returns labelEN when language=en and labelEN is defined', () => {
        const step = mkFlowStep({ labelEN: 'English Label' });
        expect(resolveStepLabel(step, 'en')).toBe('English Label');
    });

    it('falls back to Thai label when language=en but labelEN is missing', () => {
        const step = mkFlowStep(); // no labelEN
        expect(resolveStepLabel(step, 'en')).toBe('ฉลากไทย');
    });

    it('falls back to Thai label when language=en and labelEN is empty string', () => {
        // Empty-string EN is treated as "not provided" — fall through to Thai.
        const step = mkFlowStep({ labelEN: '' });
        expect(resolveStepLabel(step, 'en')).toBe('ฉลากไทย');
    });

    it('always returns Thai label when language=th, even if labelEN is defined', () => {
        const step = mkFlowStep({ labelEN: 'English Label' });
        expect(resolveStepLabel(step, 'th')).toBe('ฉลากไทย');
    });

    it('works symmetrically for PaymentStep', () => {
        const step = mkPaymentStep({ labelEN: 'Payment EN' });
        expect(resolveStepLabel(step, 'en')).toBe('Payment EN');
        expect(resolveStepLabel(step, 'th')).toBe('ฉลากชำระเงินไทย');
    });
});

describe('[Tier 7] resolveStepTitle', () => {
    it('returns titleEN when language=en and titleEN is defined', () => {
        const step = mkFlowStep({ titleEN: 'English Title' });
        expect(resolveStepTitle(step, 'en')).toBe('English Title');
    });

    it('falls back to titleTH when language=en but titleEN is missing', () => {
        const step = mkFlowStep();
        expect(resolveStepTitle(step, 'en')).toBe('หัวข้อไทย');
    });

    it('returns titleTH when language=th regardless of titleEN', () => {
        const step = mkFlowStep({ titleEN: 'English Title' });
        expect(resolveStepTitle(step, 'th')).toBe('หัวข้อไทย');
    });

    it('works for PaymentStep', () => {
        const step = mkPaymentStep({ titleEN: 'Invoice EN' });
        expect(resolveStepTitle(step, 'en')).toBe('Invoice EN');
        expect(resolveStepTitle(step, 'th')).toBe('หัวข้อชำระเงินไทย');
    });
});

describe('[Tier 7] resolveStepDescription', () => {
    it('returns descriptionEN when language=en and it is defined', () => {
        const step = mkFlowStep({ descriptionEN: 'English description text' });
        expect(resolveStepDescription(step, 'en')).toBe('English description text');
    });

    it('falls back to Thai description when language=en but descriptionEN missing', () => {
        const step = mkFlowStep();
        expect(resolveStepDescription(step, 'en')).toBe('คำอธิบายไทย');
    });

    it('returns Thai description when language=th regardless of descriptionEN', () => {
        const step = mkFlowStep({ descriptionEN: 'English description text' });
        expect(resolveStepDescription(step, 'th')).toBe('คำอธิบายไทย');
    });
});

describe('[Tier 7] backward-compatibility invariant', () => {
    it('Thai language path produces identical output regardless of EN translation presence', () => {
        // The invariant: adding EN translations MUST NOT change anything for
        // Thai consumers. This anchors against accidental regressions where
        // someone might "improve" the helper and break Thai display.
        const withoutEN = mkFlowStep();
        const withEN = mkFlowStep({
            labelEN: 'EN', titleEN: 'EN T', descriptionEN: 'EN D',
        });

        expect(resolveStepLabel(withoutEN, 'th')).toBe(resolveStepLabel(withEN, 'th'));
        expect(resolveStepTitle(withoutEN, 'th')).toBe(resolveStepTitle(withEN, 'th'));
        expect(resolveStepDescription(withoutEN, 'th')).toBe(resolveStepDescription(withEN, 'th'));
    });
});
