/**
 * application-flow-config-i18n.test.ts — Y1-FIX-A acceptance for the
 * dict-driven wizard chrome.
 *
 * What we cover:
 *   1. `getStepDescriptions('th')` returns the canonical Thai
 *      descriptions for every FLOW_STEP key (regression guard against
 *      a future refactor that drops one).
 *   2. `getStepDescriptions('en')` returns the English description for
 *      each FLOW_STEP key (verifying the Y1-FIX-A labelEN/titleEN/
 *      descriptionEN population shipped).
 *   3. Every FLOW_STEP now carries `labelEN`, `titleEN`, `descriptionEN`
 *      (parity invariant — without this, mixed-language UI returns).
 *   4. Every PAYMENT_STEP carries `labelEN` + `titleEN`.
 *   5. The wizard dict carries `wizard.chrome.*` keys in both TH and EN
 *      with placeholders that the consumer can interpolate.
 *
 * Note: we cannot import FLOW_STEPS / PAYMENT_STEPS in unit-test
 * isolation because they pull in `@/components/ui/icons` which contains
 * Tabler ESM. Instead we import via a lazy dynamic import that loads
 * the config under ts-jest's transform — same trick used by other
 * tests that exercise the full step list.
 */

import { describe, expect, it } from '@jest/globals';

import { en } from '@/lib/i18n/dictionaries/en';
import { th } from '@/lib/i18n/dictionaries/th';

describe('Y1-FIX-A wizard dict chrome keys', () => {
    it('exposes wizard.chrome.stepCounter with {n} and {total} placeholders in TH and EN', () => {
        const thChrome = th.wizard.chrome as Record<string, string>;
        const enChrome = en.wizard.chrome as Record<string, string>;
        expect(typeof thChrome.stepCounter).toBe('string');
        expect(typeof enChrome.stepCounter).toBe('string');
        expect(thChrome.stepCounter).toContain('{n}');
        expect(thChrome.stepCounter).toContain('{total}');
        expect(enChrome.stepCounter).toContain('{n}');
        expect(enChrome.stepCounter).toContain('{total}');
    });

    it('exposes wizard.chrome.tipShow / tipHide in TH and EN', () => {
        const thChrome = th.wizard.chrome as Record<string, string>;
        const enChrome = en.wizard.chrome as Record<string, string>;
        expect(thChrome.tipShow).toBeTruthy();
        expect(thChrome.tipHide).toBeTruthy();
        expect(enChrome.tipShow).toBeTruthy();
        expect(enChrome.tipHide).toBeTruthy();
        // Distinct values per language (TH ≠ EN).
        expect(thChrome.tipShow).not.toBe(enChrome.tipShow);
        expect(thChrome.tipHide).not.toBe(enChrome.tipHide);
    });

    it('exposes wizard.chrome.headerTitleEdit / headerTitlePayment / headerTitleNew in both langs', () => {
        const thChrome = th.wizard.chrome as Record<string, string>;
        const enChrome = en.wizard.chrome as Record<string, string>;
        for (const key of ['headerTitleEdit', 'headerTitlePayment', 'headerTitleNew']) {
            expect(thChrome[key]).toBeTruthy();
            expect(enChrome[key]).toBeTruthy();
            expect(thChrome[key]).not.toBe(enChrome[key]);
        }
    });

    it('exposes wizard.chrome.headerSubtitleStatus with {label} placeholder', () => {
        const thChrome = th.wizard.chrome as Record<string, string>;
        const enChrome = en.wizard.chrome as Record<string, string>;
        expect(thChrome.headerSubtitleStatus).toContain('{label}');
        expect(enChrome.headerSubtitleStatus).toContain('{label}');
    });

    it('exposes common.languageToggle + common.languageToggleAria in both langs', () => {
        // common dict additions for the LanguageToggle primitive.
        const thCommon = th.common as Record<string, string>;
        const enCommon = en.common as Record<string, string>;
        // The aria strings used to be cross-scripted — the EN dictionary
        // carried Thai and vice versa, on the reasoning that the label names
        // the destination. That put Thai codepoints in the English dictionary,
        // which EN mode must never contain. Each side now speaks its own
        // language and names the destination.
        expect(thCommon.languageToggle).toBe('EN');
        expect(enCommon.languageToggle).toBe('TH');
        expect(thCommon.languageToggleAria).toBe('สลับภาษาเป็นภาษาอังกฤษ');
        expect(enCommon.languageToggleAria).toBe('Switch language to Thai');
    });

    it('exposes common.actionPanel.{actionRequired,pendingDecision} in both langs', () => {
        const thAction = (th.common as Record<string, Record<string, string>>).actionPanel;
        const enAction = (en.common as Record<string, Record<string, string>>).actionPanel;
        expect(thAction.actionRequired).toBeTruthy();
        expect(thAction.pendingDecision).toBeTruthy();
        expect(enAction.actionRequired).toBeTruthy();
        expect(enAction.pendingDecision).toBeTruthy();
    });

    it('exposes common.timeline.{statusUpdated,by,system,createdAt,updatedAt} in both langs', () => {
        const thTimeline = (th.common as Record<string, Record<string, string>>).timeline;
        const enTimeline = (en.common as Record<string, Record<string, string>>).timeline;
        for (const key of ['statusUpdated', 'by', 'system', 'createdAt', 'updatedAt']) {
            expect(thTimeline[key]).toBeTruthy();
            expect(enTimeline[key]).toBeTruthy();
        }
    });
});

describe('Y1-FIX-A FLOW_STEPS / PAYMENT_STEPS language coverage', () => {
    it('every FLOW_STEP has labelEN, titleEN, descriptionEN', async () => {
        const { FLOW_STEPS } = await import('../application-flow-config');
        for (const step of FLOW_STEPS) {
            expect(step.labelEN).toBeTruthy();
            expect(step.titleEN).toBeTruthy();
            expect(step.descriptionEN).toBeTruthy();
        }
    });

    it('every PAYMENT_STEP has labelEN and titleEN', async () => {
        const { PAYMENT_STEPS } = await import('../application-flow-config');
        for (const step of PAYMENT_STEPS) {
            expect(step.labelEN).toBeTruthy();
            expect(step.titleEN).toBeTruthy();
        }
    });

    it('getStepDescriptions returns canonical Thai descriptions for language=th', async () => {
        const { getStepDescriptions, FLOW_STEPS } = await import('../application-flow-config');
        const desc = getStepDescriptions('th');
        for (const step of FLOW_STEPS) {
            expect(desc[step.key]).toBe(step.description);
        }
    });

    it('getStepDescriptions returns English descriptions for language=en when present', async () => {
        const { getStepDescriptions, FLOW_STEPS } = await import('../application-flow-config');
        const desc = getStepDescriptions('en');
        for (const step of FLOW_STEPS) {
            expect(desc[step.key]).toBe(step.descriptionEN);
        }
    });
});
