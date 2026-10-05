/**
 * T5 — the wizard is SIX steps, and the registry is the only place that says so.
 *
 * The old flow had nine entries with a hole at 3 (a merged step whose number was
 * left vacant so deep links kept resolving) and a second hole at 11. Numbers that
 * do not mean anything are how a stepper and a URL come to disagree, so v2
 * renumbers 1..6 with no gaps and the keys carry the meaning.
 *
 * The order is กทล.1's own: who is asking and for what (1), who they are (2),
 * where the land is (3), what they grow and why (4), the plans and papers (5),
 * then the server's own account of the filing (6).
 */

import { FLOW_STEPS, getStepByKey, getStepByNumber } from '../application-flow-config';

const EXPECTED_KEYS = [
    'request-type',
    'identity',
    'site-land',
    'variety-purpose',
    'plans-docs',
    'review',
] as const;

describe('wizard v2 registry — six steps, numbered 1..6, no gaps', () => {
    it('carries exactly the six keys, in กทล.1 order', () => {
        expect(FLOW_STEPS.map((s) => s.key)).toEqual([...EXPECTED_KEYS]);
    });

    it('numbers them 1..6 with no vacant slot', () => {
        expect(FLOW_STEPS.map((s) => s.stepNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('every step is required — v2 has no optional step to skip past', () => {
        expect(FLOW_STEPS.every((s) => s.isRequired)).toBe(true);
    });

    it('speaks Thai to the applicant and never shows a raw key', () => {
        FLOW_STEPS.forEach((step) => {
            expect(step.label).toMatch(/[ก-๙]/);
            expect(step.titleTH).toMatch(/[ก-๙]/);
            // The key is an identifier, not copy. It must never leak into what is read.
            expect(step.label).not.toContain(step.key);
            expect(step.titleTH).not.toContain(step.key);
        });
    });

    it('is reachable by number and by key, and they agree', () => {
        EXPECTED_KEYS.forEach((key, i) => {
            const byKey = getStepByKey(key);
            const byNumber = getStepByNumber(i + 1);
            expect(byKey).toBeDefined();
            expect(byKey).toBe(byNumber);
        });
    });

    it('keeps the success slot, which is not one of the six', () => {
        const success = getStepByKey('success');
        expect(success).toBeDefined();
        expect(FLOW_STEPS.map((s) => s.key)).not.toContain('success');
    });

    it('drops every v1 key, so a stale import fails loudly instead of rendering the old screen', () => {
        const retired = [
            'consent', 'plant_selection', 'general', 'farm_info',
            'production_info', 'quality_control', 'documents',
        ];
        const live = FLOW_STEPS.map((s) => s.key);
        retired.forEach((key) => expect(live).not.toContain(key));
    });
});
