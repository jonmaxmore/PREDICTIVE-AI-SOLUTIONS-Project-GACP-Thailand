/**
 * There is ONE accounting model, and no environment can switch it off.
 *
 * ── WHAT WAS WRONG ────────────────────────────────────────────────────────────
 * Operator, 2026-09-05: "ผมจะลบแบบที่ไม่ถูกต้องออกทั้งหมดแล้วแทนค่า หรือทำสิ่งที่ถูกต้อง
 * เท่านั้น." Until this change the incorrect model was not merely still present —
 * it was the DEFAULT.
 *
 *   isPhaseSplitInvoicingRetired() { return isStripeCheckoutEnabled(); }
 *   isStripeCheckoutEnabled()      { return process.env.STRIPE_CHECKOUT_ENABLED === 'true'; }
 *
 * One environment variable decided two unrelated things: whether the payment
 * GATEWAY is available, and which ACCOUNTING MODEL the platform uses. Unset it —
 * the default in every environment that has not been told otherwise — and the
 * platform quietly reverted to minting the retired STATE/PLATFORM invoice pair,
 * whose STATE half `recordPaymentEntry` then refused to book at all
 * (STATE_FEE_NOT_IN_PLATFORM_BOOKS), on the 2026-05-16 reasoning that the money
 * never reached the company. Under W14 it does. Money in the bank, no journal
 * entry, and the skip recorded as `{ skipped: true }` rather than an error, so
 * nothing would ever have surfaced it.
 *
 * Whether a gateway is configured is properly an environment decision — the
 * checkout door still answers 503 when Stripe is absent, and should. What may
 * never be an environment decision is how the company recognises its revenue.
 *
 * ── WHAT THESE TESTS PIN ──────────────────────────────────────────────────────
 * That the retired path is GONE rather than merely off: the flag is exercised in
 * both positions and the answer does not move.
 */

'use strict';

const ORIGINAL = process.env.STRIPE_CHECKOUT_ENABLED;

afterEach(() => {
    if (ORIGINAL === undefined) {
        delete process.env.STRIPE_CHECKOUT_ENABLED;
    } else {
        process.env.STRIPE_CHECKOUT_ENABLED = ORIGINAL;
    }
    jest.resetModules();
});

function withFlag(value) {
    jest.resetModules();
    if (value === undefined) {
        delete process.env.STRIPE_CHECKOUT_ENABLED;
    } else {
        process.env.STRIPE_CHECKOUT_ENABLED = value;
    }
    // eslint-disable-next-line global-require
    return require('../../services/phase-billing-service');
}

describe('split invoicing is retired unconditionally', () => {
    test.each([
        ['unset (the default in most environments)', undefined],
        ['explicitly false', 'false'],
        ['empty', ''],
        ['true', 'true'],
    ])('%s → still retired', (_label, value) => {
        expect(withFlag(value).isPhaseSplitInvoicingRetired()).toBe(true);
    });

    test('it does not read the gateway flag at all any more', () => {
        const src = require('fs').readFileSync(
            require('path').resolve(__dirname, '../../services/phase-billing-service.js'), 'utf8',
        );
        const fn = src.slice(src.indexOf('function isPhaseSplitInvoicingRetired'));
        const body = fn.slice(0, fn.indexOf('}') + 1);
        expect(body).not.toContain('isStripeCheckoutEnabled');
    });
});

describe('a payment is never passed over unbooked', () => {
    /**
     * The short-circuit returned `{ skipped: true }` for any invoice whose
     * serviceType resolved to the DTAM issuer. Silence is the wrong answer to
     * money: if such an invoice ever appears again it is a defect, and a defect
     * about cash must be loud.
     */
    test('recordPaymentEntry no longer answers `skipped` for a STATE invoice', async () => {
        jest.resetModules();
        jest.doMock('../../services/prisma-database', () => ({ prisma: null }));
        // eslint-disable-next-line global-require
        const { recordPaymentEntry } = require('../../services/journal-entry-service');

        await expect(recordPaymentEntry('inv-state', 5000, null, {
            invoiceNumber: 'RCP-DTAM-2569-0001',
            serviceType: 'PHASE_1_STATE_FEE',
        })).rejects.toMatchObject({ code: 'RETIRED_STATE_INVOICE' });
    });

    test('the skip reason is gone from the source entirely', () => {
        const src = require('fs').readFileSync(
            require('path').resolve(__dirname, '../../services/journal-entry-service.js'), 'utf8',
        );
        const code = src.split('\n')
            .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
            .join('\n');
        expect(code).not.toContain("reason: 'STATE_FEE_NOT_IN_PLATFORM_BOOKS'");
    });

    test('a normal checkout settlement is unaffected', async () => {
        jest.resetModules();
        jest.doMock('../../services/prisma-database', () => ({ prisma: null }));
        // eslint-disable-next-line global-require
        const { buildPaymentEntryLines } = require('../../services/journal-entry-service');
        const entry = buildPaymentEntryLines({
            invoiceId: 'inv-1',
            invoiceNumber: 'TAX-PRD-2569-0001',
            serviceType: 'PHASE_1_FEE',
            totalAmount: 5885,
            components: { platformFee: 5500, vat: 385 },
        });
        expect(entry.balanced).toBe(true);
    });
});
