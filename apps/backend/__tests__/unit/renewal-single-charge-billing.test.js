/**
 * W12-Q1 — the renewal is billed ONCE, and the three numbers agree.
 *
 * Operator rulings (the change log): 67ef3612 "ต่ออายุ 30,000 ครั้งเดียว",
 * 851fd516 (30,000 is the pre-VAT, pre-platform base), and eabfc020 which
 * authorises this billing change as a ONE-TIME L3 exception.
 *
 * Before this change a renewal sat at PENDING_AUDIT_FEE and the quotation
 * builder billed it the ordinary PHASE_2 amount (27,675) while /api/pricing
 * quoted the applicant 33,210 — the screen and the invoice disagreed.
 *
 * The three numbers this suite holds together:
 *   1. what the API (and therefore the screen) shows      -> pricing route
 *   2. what the quotation bills                            -> quotation-service
 *   3. what settlement would record for that checkout      -> the frozen quote
 *      read back through getFrozenPhaseFees, which is what
 *      payment-service-phase-flow.resolveLockedPhaseTotals honours
 *
 * All three are read from the real code paths. The only literals are the
 * operator's own numbers, asserted once.
 */

'use strict';

jest.mock('../../services/system-config-service', () => ({
    getValue: jest.fn().mockResolvedValue(null),
}));

const express = require('express');
const request = require('supertest');

const quotationService = require('../../services/quotation-service');
const { calculateRenewalFee } = require('../../modules/billing');

/**
 * Per ONE cultivation scope. Multiplied by scope count — see SCOPE_TABLE.
 *
 * `RENEWAL_BASE` was 30,000 until 2026-09-11 and is 33,000 now. **The renewal
 * costs the same 35,310 it always did** — what changed is which number the
 * system declares. It used to declare a 30,000 state base and derive ค่าบริการ
 * by adding a 10% platform cut; the operator retired that split, so the
 * declared rate IS ค่าบริการ. Same money, one fewer step.
 */
const RENEWAL_BASE = 33000;
const RENEWAL_PAYABLE = 35310;

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/pricing', require('../../routes/api/finance/pricing'));
    return app;
}

const renewalApplication = {
    id: 'app-renewal-1',
    totalAreaTypes: 1,
    organizationId: 'org-1',
    formData: {
        renewalOf: 'cert-1',
        renewalOfCertificateNumber: 'GACP-TH-2569-ABCDEF',
        cultivationMethods: ['OUTDOOR'],
    },
};

describe('W12-Q1 — the three numbers agree for a renewal', () => {
    test('the canonical renewal fee is the operator\'s number, grossed up once', () => {
        const fee = calculateRenewalFee();
        expect(fee.serviceFeeAmount).toBe(RENEWAL_BASE);
        expect(fee.phaseTotal).toBe(RENEWAL_PAYABLE);
        expect(fee.vatAmount).toBe(RENEWAL_PAYABLE - RENEWAL_BASE);
        // และไม่มีซากของการแยกส่วนหลงเหลือให้ใครหยิบไปคำนวณต่อ
        expect(fee).not.toHaveProperty('stateAmount');
        expect(fee).not.toHaveProperty('platformAmount');
    });

    test('1 == 2: what the API shows is what the quotation bills', async () => {
        const res = await request(buildApp()).get('/api/pricing/fees');
        const shown = { base: res.body.data.renewalFee, payable: res.body.data.renewalTotalPerScope };

        const billed = quotationService._internals.resolveBillableFees(renewalApplication);

        expect(shown.base).toBe(billed.serviceFeeTotal);
        expect(shown.payable).toBe(billed.grandTotal);
        // and it really is a single charge, not the phase pair
        expect(billed.phase1).toBeNull();
        expect(billed.isRenewal).toBe(true);
    });

    test('2 == 3: the quotation lines read back as the price settlement honours', () => {
        const billed = quotationService._internals.resolveBillableFees(renewalApplication);
        const installments = quotationService._internals.buildInstallments(billed);

        // No PHASE_1 line is stored at all.
        expect(installments.company.map((i) => i.phase)).toEqual(['PHASE_2']);
        expect(installments.platform.map((i) => i.phase)).toEqual(['PHASE_2']);

        // W14 — ONE issuer, so ONE line billing the WHOLE payable. The retired
        // model split it: a DTAM line for the state fee and a PLATFORM line for
        // platform + VAT.
        expect(installments.company[0].amount).toBe(RENEWAL_PAYABLE);

        // Read back exactly as getFrozenPhaseFees reconstructs it — this is the
        // shape resolveLockedPhaseTotals hands to the payment path.
        const frozen = quotationService._internals.reconstructFrozenFromInstallments(
            installments.company,
        );
        expect(frozen).not.toBeNull();
        expect(frozen.singleCharge).toBe(true);
        expect(frozen.phase1.phaseTotal).toBe(0);
        expect(frozen.phase2.phaseTotal).toBe(RENEWAL_PAYABLE);
        // What settlement would record in total for this application:
        expect(frozen.phase1.phaseTotal + frozen.phase2.phaseTotal).toBe(RENEWAL_PAYABLE);
    });

    test('all three at once, asserted against each other rather than a literal', async () => {
        const res = await request(buildApp()).get('/api/pricing/fees');
        const billed = quotationService._internals.resolveBillableFees(renewalApplication);
        const frozen = quotationService._internals.reconstructFrozenFromInstallments(
            quotationService._internals.buildInstallments(billed).company,
        );

        const screen = res.body.data.renewalTotalPerScope;
        const quotation = billed.grandTotal;
        const settlement = frozen.phase1.phaseTotal + frozen.phase2.phaseTotal;

        expect(new Set([screen, quotation, settlement]).size).toBe(1);
        expect(screen).toBe(RENEWAL_PAYABLE);
    });

    /**
     * Operator correction 2026-08-22 (the change log 8b8d581f):
     * "ฟาร์ม 1 รูปแบบ 30000 / 2 รูปแบบ 60000 / 3 รูปแบบ 90000 ราคารวม ต้องแบบนี้
     *  ไม่ว่าใหม่ หรือต่อ ต้องคิดเงินแยกรูปแบบการปลูก"
     *
     * This test previously asserted the OPPOSITE — that three scopes still bill
     * one 30,000 base — because the first reading of the ruling was that a
     * renewal is a flat per-certificate charge. It is inverted here rather than
     * deleted, so the change of meaning stays visible in the history.
     */
    // `base` = ค่าบริการ ก่อน VAT. It reads 33,000/66,000/99,000 since 2026-09-11
    // where it used to read 30,000/60,000/90,000 — the declared rate absorbed the
    // 10% that used to be added on top. `payable` did not move.
    const SCOPE_TABLE = [
        { scopes: 1, base: 33000, payable: 35310 },
        { scopes: 2, base: 66000, payable: 70620 },
        { scopes: 3, base: 99000, payable: 105930 },
    ];

    // fee-service.js no longer states these figures in prose (they went stale there
    // twice); this is where they live. Called on calculateRenewalFee itself, and the
    // base is tied to the declared per-scope rate so a rate change fails here loudly.
    test.each(SCOPE_TABLE)(
        'calculateRenewalFee for $scopes scope(s): base $base, payable $payable, base = FEES.RENEWAL_PER_SCOPE x scopes',
        ({ scopes, base, payable }) => {
            const { FEES } = require('../../config/business-rules');
            const fee = calculateRenewalFee({}, { scopeCount: scopes });
            expect({ scopeCount: fee.scopeCount, base: fee.serviceFeeAmount, payable: fee.phaseTotal })
                .toEqual({ scopeCount: scopes, base, payable });
            expect(fee.serviceFeeAmount).toBe(FEES.RENEWAL_PER_SCOPE * scopes);
        },
    );

    test.each(SCOPE_TABLE)(
        'a renewal is charged PER SCOPE: $scopes scope(s) -> base $base, payable $payable',
        ({ scopes, base, payable }) => {
            const application = {
                ...renewalApplication,
                totalAreaTypes: scopes,
                formData: {
                    ...renewalApplication.formData,
                    cultivationMethods: ['OUTDOOR', 'GREENHOUSE', 'INDOOR'].slice(0, scopes),
                },
            };
            const billed = quotationService._internals.resolveBillableFees(application);
            expect(billed.scopeCount).toBe(scopes);
            expect(billed.serviceFeeTotal).toBe(base);
            expect(billed.grandTotal).toBe(payable);
            // still ONE charge, however many scopes
            expect(billed.phase1).toBeNull();
            const installments = quotationService._internals.buildInstallments(billed);
            expect(installments.company.map((i) => i.phase)).toEqual(['PHASE_2']);
        },
    );

    test.each(SCOPE_TABLE)(
        'the three numbers still agree at $scopes scope(s)',
        ({ scopes, base, payable }) => {
            const application = {
                ...renewalApplication,
                totalAreaTypes: scopes,
                formData: {
                    ...renewalApplication.formData,
                    cultivationMethods: ['OUTDOOR', 'GREENHOUSE', 'INDOOR'].slice(0, scopes),
                },
            };
            // 1. what a screen would show for this application: the per-scope
            //    catalogue figure multiplied by the application's scope count.
            const screen = calculateRenewalFee({}, { scopeCount: 1 }).phaseTotal * scopes;
            // 2. what the quotation bills
            const billed = quotationService._internals.resolveBillableFees(application);
            const quotation = billed.grandTotal;
            // 3. what settlement honours, read back off the stored lines
            const frozen = quotationService._internals.reconstructFrozenFromInstallments(
                quotationService._internals.buildInstallments(billed).company,
            );
            const settlement = frozen.phase1.phaseTotal + frozen.phase2.phaseTotal;

            expect(new Set([screen, quotation, settlement]).size).toBe(1);
            expect(settlement).toBe(payable);
            expect(billed.serviceFeeTotal).toBe(base);
        },
    );

    test('a renewal and a NEW application come to the same total for the same farm', () => {
        // Worth stating outright so nobody later reports it as a bug: the
        // renewal base per scope (30,000) equals PHASE1 + PHASE2 per scope
        // (5,000 + 25,000), so the AMOUNTS match. What differs is the schedule —
        // a renewal is charged once, a new application across two phases.
        for (const { scopes, payable } of SCOPE_TABLE) {
            const methods = ['OUTDOOR', 'GREENHOUSE', 'INDOOR'].slice(0, scopes);
            const renewal = quotationService._internals.resolveBillableFees({
                id: 'r', totalAreaTypes: scopes, formData: { renewalOf: 'cert-x', cultivationMethods: methods },
            });
            const fresh = quotationService._internals.resolveBillableFees({
                id: 'n', totalAreaTypes: scopes, formData: { cultivationMethods: methods },
            });
            expect(renewal.grandTotal).toBe(fresh.grandTotal);
            expect(renewal.grandTotal).toBe(payable);
            // one instalment vs two — the real difference
            expect(quotationService._internals.buildInstallments(renewal).company).toHaveLength(1);
            expect(quotationService._internals.buildInstallments(fresh).company).toHaveLength(2);
        }
    });
});

describe('W12-Q1 — an ordinary application is untouched (golden values)', () => {
    /**
     * The regression that would hurt most is silently altering ordinary
     * applications. If a single satang moves, this fails, and it must never be
     * "updated to match" — a diff here means every applicant's bill changed.
     *
     * W14: every applicant's bill DID change, and these values were updated
     * deliberately under the operator's ruling of 2026-08-22 (the change log
     * c28355ea, figures confirmed d1c33ea0), NOT to make a red test go green.
     * VAT moved from the platform portion to the whole ค่าบริการ, so each vat
     * figure rose and each total with it: 33,210 → 35,310 at one scope and
     * 99,630 → 105,930 at three. The state and platform amounts are untouched,
     * which is the check that the change was the intended one.
     *
     * The list is also now SINGLE — one company installment list carrying the
     * full phase payable — where it used to be a DTAM/PLATFORM pair.
     */
    /*
     * 2026-09-06 — `scopeBreakdown` was ADDED to every installment, and every amount above
     * it is unchanged. Operator ruling: the fee is a SUM of the declared cultivation types
     * ("มันเป็นการบวกมากกว่า ... ราคาก็เอามารวมกัน"), so the price of record now carries the
     * per-type lines the quotation prints instead of leaving the document to divide a
     * total by a count. Written out by hand rather than computed, because a golden that
     * derives its own expectation checks nothing: at three scopes each type carries the
     * same figures as the one-scope filing, and the phase amounts are their sum.
     */
    const GOLDEN = {
        1: {
            company: [
                {
                    phase: 'PHASE_1', amount: 5885, serviceFeeAmount: 5500, vatAmount: 385, scopeCount: 1,
                    scopeBreakdown: [{ method: 'OUTDOOR', serviceFeeAmount: 5500, vatAmount: 385 }],
                },
                {
                    phase: 'PHASE_2', amount: 29425, serviceFeeAmount: 27500, vatAmount: 1925, scopeCount: 1,
                    scopeBreakdown: [{ method: 'OUTDOOR', serviceFeeAmount: 27500, vatAmount: 1925 }],
                },
            ],
            totals: { serviceFeeTotal: 33000, vatTotal: 2310, grandTotal: 35310 },
        },
        3: {
            company: [
                {
                    phase: 'PHASE_1', amount: 17655, serviceFeeAmount: 16500, vatAmount: 1155, scopeCount: 3,
                    scopeBreakdown: [
                        { method: 'OUTDOOR', serviceFeeAmount: 5500, vatAmount: 385 },
                        { method: 'GREENHOUSE', serviceFeeAmount: 5500, vatAmount: 385 },
                        { method: 'INDOOR', serviceFeeAmount: 5500, vatAmount: 385 },
                    ],
                },
                {
                    phase: 'PHASE_2', amount: 88275, serviceFeeAmount: 82500, vatAmount: 5775, scopeCount: 3,
                    scopeBreakdown: [
                        { method: 'OUTDOOR', serviceFeeAmount: 27500, vatAmount: 1925 },
                        { method: 'GREENHOUSE', serviceFeeAmount: 27500, vatAmount: 1925 },
                        { method: 'INDOOR', serviceFeeAmount: 27500, vatAmount: 1925 },
                    ],
                },
            ],
            totals: { serviceFeeTotal: 99000, vatTotal: 6930, grandTotal: 105930 },
        },
    };

    test.each([1, 3])('a NEW application with %i scope(s) bills byte-identically', (scopeCount) => {
        const application = {
            id: `app-new-${scopeCount}`,
            totalAreaTypes: scopeCount,
            formData: {
                cultivationMethods: ['OUTDOOR', 'GREENHOUSE', 'INDOOR'].slice(0, scopeCount),
            },
        };
        const fees = quotationService._internals.resolveBillableFees(application);
        const installments = quotationService._internals.buildInstallments(fees);
        const golden = GOLDEN[scopeCount];

        expect(installments.company).toEqual(golden.company);
        //  is the same list under the key the Quotation row uses.
        expect(installments.platform).toEqual(golden.company);
        expect({
            serviceFeeTotal: fees.serviceFeeTotal,
            vatTotal: fees.vatTotal,
            grandTotal: fees.grandTotal,
        }).toEqual(golden.totals);
        // A new application keeps BOTH phases; it did not inherit the fork.
        expect(fees.phase1).not.toBeNull();
        expect(fees.isRenewal).toBeUndefined();
    });

    test('the fork is keyed on formData.renewalOf and nothing else', () => {
        const noMarker = { id: 'a', totalAreaTypes: 1, formData: { cultivationMethods: ['OUTDOOR'] } };
        expect(quotationService._internals.resolveBillableFees(noMarker).phase1).not.toBeNull();

        const emptyMarker = { id: 'b', totalAreaTypes: 1, formData: { renewalOf: '', cultivationMethods: ['OUTDOOR'] } };
        expect(quotationService._internals.resolveBillableFees(emptyMarker).phase1).not.toBeNull();

        const marked = { id: 'c', totalAreaTypes: 1, formData: { renewalOf: 'cert-x' } };
        expect(quotationService._internals.resolveBillableFees(marked).phase1).toBeNull();
    });

    test('an ordinary two-phase quotation still reads back with both phases', () => {
        const application = { id: 'app-new-1', totalAreaTypes: 1, formData: { cultivationMethods: ['OUTDOOR'] } };
        const installments = quotationService._internals.buildInstallments(
            quotationService._internals.resolveBillableFees(application),
        );
        const frozen = quotationService._internals.reconstructFrozenFromInstallments(installments.company);
        expect(frozen.phase1.phaseTotal).toBe(5885);
        expect(frozen.phase2.phaseTotal).toBe(29425);
        expect(frozen.singleCharge).toBe(false);
    });
});
