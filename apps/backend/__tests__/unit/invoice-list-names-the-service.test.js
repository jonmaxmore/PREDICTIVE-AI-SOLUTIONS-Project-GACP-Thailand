'use strict';
/**
 * fix/fee-line-descriptions round 5 (operator 2026-10-03). The applicant's invoice list
 * (GET /invoices/my → invoiceService.listForHolders) says which service each row bills,
 * from the one catalogue and renewal-aware: a renewal's M2 is the renewal service, never
 * งวดที่ 2. The application's formData is read for that answer and never returned.
 */
const invoiceService = require('../../services/invoice-service');
const { SERVICE_CATALOGUE } = require('../../shared/instalment-service-names');

const SCOPE = Object.freeze({ userId: 'u', readIds: ['e1'], editIds: [] });
const R1 = { healthId: 'h', activeEntity: { entityId: 'e1', personal: false } };
const row = (serviceType, formData) => ({
    id: `inv-${serviceType}`, serviceType, status: 'pending', totalAmount: '1.00',
    application: { applicationNumber: 'APP-1', formData },
});

describe('listForHolders names each row`s service', () => {
    let findMany;
    beforeEach(() => {
        const { prisma } = require('../../services/prisma-database');
        findMany = jest.spyOn(prisma.invoice, 'findMany').mockResolvedValue([
            row('CERTIFICATION_CHECKOUT_M1', {}),
            row('CERTIFICATION_CHECKOUT_M2', {}),
            row('CERTIFICATION_CHECKOUT_M2', { renewalOf: 'cert-1', applicantData: { idCard: '1234567890123' } }),
            row('SUBSCRIPTION_PREMIUM_MONTHLY', null),
        ]);
    });
    afterEach(() => jest.restoreAllMocks());

    test('M1 / M2 / renewal M2 / subscription', async () => {
        const out = await invoiceService.listForHolders({ scope: SCOPE, r1Legacy: R1 });
        const pick = (e) => ({ key: e.key, name: e.name, coverage: e.coverage });
        expect(out[0].service).toEqual(pick(SERVICE_CATALOGUE.PHASE_1));
        expect(out[1].service).toEqual(pick(SERVICE_CATALOGUE.PHASE_2));
        expect(out[2].service).toEqual(pick(SERVICE_CATALOGUE.RENEWAL));
        expect(out[3].service).toBeNull();
    });

    test('the application formData that answered it is not returned', async () => {
        const out = await invoiceService.listForHolders({ scope: SCOPE, r1Legacy: R1 });
        for (const r of out) {
            expect(r.application?.formData).toBeUndefined();
        }
        expect(JSON.stringify(out)).not.toContain('1234567890123');
        expect(out[0].application.applicationNumber).toBe('APP-1');
        // and the read asks for formData only to answer this
        const include = findMany.mock.calls[0][0].include;
        expect(include.application.select.formData).toBe(true);
    });
});
