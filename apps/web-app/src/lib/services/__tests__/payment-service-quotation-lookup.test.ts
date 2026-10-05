/**
 * payment-service-quotation-lookup.test.ts — F-G4-64, fix round 1 (review r0
 * minor 6).
 *
 * `getQuotations` used to answer `{dtam:null, platform:null}` on ANY failure, so
 * a 500, a dropped connection and "this application holds no quotation" were one
 * value. Two screens then told the applicant "ระบบกำลังออกใบเสนอราคาของคำขอนี้",
 * a fact about the server that a failed request cannot establish.
 *
 * The lookup now answers `null` for "I could not find out" and an empty pair for
 * "the register holds none". Both still read as NOT ACCEPTED at every gate, so
 * the fail-closed behaviour is unchanged; only what the screen may claim is.
 *
 * `api` is mocked per repo convention — see __tests__/checkout-service.test.ts.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { api } from '@/lib/api/api-client';
import { PaymentService, type QuotationRecord } from '../payment-service';

jest.mock('@/lib/api/api-client', () => ({
    api: {
        get: jest.fn(),
    },
}));

const mockedGet = api.get as jest.MockedFunction<typeof api.get>;

const ROW: QuotationRecord = {
    id: 'qt-1',
    applicationId: 'app-1',
    issuerType: 'PLATFORM',
    quotationNumber: 'QT-PRD-2026-000001',
    subtotal: '33000.00',
    vat: '2310.00',
    totalAmount: '35310.00',
    status: 'PENDING',
    createdAt: '2026-08-25T00:00:00.000Z',
};

describe('PaymentService.getQuotations tells a failed lookup apart from an empty one', () => {
    beforeEach(() => {
        mockedGet.mockReset();
    });

    it('answers null when the request failed', async () => {
        mockedGet.mockResolvedValue({ success: false, error: 'INTERNAL_ERROR', status: 500 });

        await expect(PaymentService.getQuotations('app-1')).resolves.toBeNull();
    });

    it('answers null when the envelope carries no body', async () => {
        mockedGet.mockResolvedValue({ success: true });

        await expect(PaymentService.getQuotations('app-1')).resolves.toBeNull();
    });

    it('answers an empty pair when the register really holds no quotation', async () => {
        mockedGet.mockResolvedValue({ success: true, data: { dtam: null, platform: null } });

        await expect(PaymentService.getQuotations('app-1')).resolves.toEqual({
            dtam: null,
            platform: null,
        });
    });

    it('answers both sides verbatim when the register holds them', async () => {
        mockedGet.mockResolvedValue({ success: true, data: { dtam: null, platform: ROW } });

        await expect(PaymentService.getQuotations('app-1')).resolves.toEqual({
            dtam: null,
            platform: ROW,
        });
    });

    it('asks nothing without an applicationId, and that is an empty pair, not a failure', async () => {
        // There is no lookup to fail: the caller has no application in hand.
        await expect(PaymentService.getQuotations('')).resolves.toEqual({
            dtam: null,
            platform: null,
        });
        expect(mockedGet).not.toHaveBeenCalled();
    });
});
