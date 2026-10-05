/**
 * The web's service facts cannot drift from the backend records they mirror.
 *
 * Operator decision 6 (2026-09-17): the web copy must state the truth about
 * certificate validity, payment channels and the rest, and audit 2026-09-17
 * UXUI-01 found the onboarding modal saying "ใบรับรองมีอายุ 3 ปี" while
 * CERTIFICATE.VALIDITY_YEARS said 1. The web now takes those facts from ONE
 * module, apps/web-app/src/constants/service-facts.ts. This file is the
 * backend half of the guard, in the pattern frontend-fee-mirror-cannot-drift
 * uses for the fees: the web value is compared to the backend value, never to
 * a literal typed here, so moving one and forgetting the other turns this red.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { CERTIFICATE, PAYMENT } = require('../../config/business-rules');
// The real values, required, not read as text (review minor 5).
const { REMINDER_DAYS } = require('../../services/renewal-service');
const { CHECKOUT_PAYMENT_METHOD_TYPES } = require('../../services/checkout/stripe-checkout-service');

/**
 * How the Thai channel sentence names each method the rail could offer. A
 * mapping of names, not a list of what is offered: the offered list is
 * CHECKOUT_PAYMENT_METHOD_TYPES. A method the checkout starts offering with no
 * row here fails the test, which is the reminder to rewrite PAYMENT_CHANNEL_TH.
 */
const METHOD_NAME_TH = Object.freeze({ promptpay: 'พร้อมเพย์', card: 'บัตร' });
/** English mirror of METHOD_NAME_TH, for PAYMENT_CHANNEL_EN (one-fee residue sweep 2026-09-26). */
const METHOD_NAME_EN = Object.freeze({ promptpay: 'PromptPay', card: 'card' });

const FE_FACTS_FILE = path.resolve(__dirname, '../../../web-app/src/constants/service-facts.ts');

function feSource() {
    return fs.readFileSync(FE_FACTS_FILE, 'utf8');
}

/** The value a TS `export const NAME = <literal>;` holds, read without a bundler. */
function feLiteral(name, pattern) {
    const m = feSource().match(new RegExp(`export\\s+const\\s+${name}(?:\\s*:[^=]+)?\\s*=\\s*${pattern}`));
    if (!m) throw new Error(`${name} is not a literal of the expected shape in ${FE_FACTS_FILE}`);
    return m[1];
}

describe('web service facts mirror the backend records', () => {
    test('certificate validity === CERTIFICATE.VALIDITY_YEARS (operator 2026-09-11, a22007e4)', () => {
        expect(Number(feLiteral('GACP_CERTIFICATE_VALIDITY_YEARS', '(\\d+)\\s*;'))).toBe(CERTIFICATE.VALIDITY_YEARS);
    });

    test('CAR revision deadline === PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS (one-fee residue sweep 2026-09-26)', () => {
        expect(Number(feLiteral('GACP_CAR_REVISION_DEADLINE_BUSINESS_DAYS', '(\\d+)\\s*;')))
            .toBe(PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS);
    });

    test('renewal reminder days === renewal-service REMINDER_DAYS', () => {
        const fe = feLiteral('GACP_RENEWAL_REMINDER_DAYS', '\\[([^\\]]+)\\]')
            .split(',').map((d) => Number(d.trim()));
        expect(fe).toEqual([...REMINDER_DAYS]);
    });

    test('the channel the copy names is the list the checkout offers (CHECKOUT_PAYMENT_METHOD_TYPES)', () => {
        const channel = feLiteral('PAYMENT_CHANNEL_TH', "\\s*'([^']+)'");
        const offered = [...CHECKOUT_PAYMENT_METHOD_TYPES];
        expect(offered.length).toBeGreaterThan(0);
        for (const method of offered) {
            expect(Object.keys(METHOD_NAME_TH)).toContain(method);
            expect(channel).toContain(METHOD_NAME_TH[method]);
        }
        // Every method NOT offered is refused by name ("ไม่รับบัตร").
        for (const [method, name] of Object.entries(METHOD_NAME_TH)) {
            if (!offered.includes(method)) expect(channel).toContain(`ไม่รับ${name}`);
        }
        if (offered.length === 1) expect(channel).toContain('ช่องทางเดียว');
        // Operator ruling 2026-09-27: the payment provider is not named in any user-facing text.
        // The channel is PromptPay, through "the payment provider", unnamed.
        expect(offered).toEqual(['promptpay']);
        expect(channel).toContain('QR พร้อมเพย์');
        expect(channel).toContain('ผู้ให้บริการรับชำระเงิน');
        expect(channel).not.toMatch(/stripe/i);
    });

    test('the English channel sentence names the same offered list, one source per language (one-fee residue sweep 2026-09-26)', () => {
        const channelEn = feLiteral('PAYMENT_CHANNEL_EN', "\\s*'([^']+)'");
        const offered = [...CHECKOUT_PAYMENT_METHOD_TYPES];
        for (const method of offered) {
            expect(Object.keys(METHOD_NAME_EN)).toContain(method);
            expect(channelEn).toContain(METHOD_NAME_EN[method]);
        }
        for (const [method, name] of Object.entries(METHOD_NAME_EN)) {
            if (!offered.includes(method)) expect(channelEn).toMatch(new RegExp(`not accepted|refused`, 'i'));
        }
        // Operator ruling 2026-09-27: the payment provider is not named in any user-facing text.
        expect(channelEn).toContain('PromptPay');
        expect(channelEn).toContain('the payment provider');
        expect(channelEn).not.toMatch(/stripe/i);
    });
});
