/**
 * payment-service-receipt-download.test.ts — staging walk 2026-09-29, P1.
 *
 * The applicant's receipt is served by the owner's door
 * GET /api/invoices/my/:invoiceId/receipt/pdf (apps/backend/routes/api/finance/
 * invoices.js). The staff door /invoices/:id/receipt/pdf answers 403 to an
 * applicant, so the path matters. The request goes through api.getBlob so the
 * bearer token and the x-active-entity-id header ride along, and the saved file
 * is named after the receipt number the applicant reads on the screen.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { api } from '@/lib/api/api-client';
import { PaymentService } from '../payment-service';

jest.mock('@/lib/api/api-client', () => ({
    api: {
        get: jest.fn(),
        getBlob: jest.fn(),
    },
}));

const mockedGetBlob = api.getBlob as jest.MockedFunction<typeof api.getBlob>;

describe('PaymentService.downloadReceiptPdf', () => {
    let clicked: string[];
    const originalCreate = window.URL.createObjectURL;
    const originalRevoke = window.URL.revokeObjectURL;

    beforeEach(() => {
        mockedGetBlob.mockReset();
        clicked = [];
        window.URL.createObjectURL = jest.fn(() => 'blob:receipt') as unknown as typeof window.URL.createObjectURL;
        window.URL.revokeObjectURL = jest.fn() as unknown as typeof window.URL.revokeObjectURL;
        jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            clicked.push(this.download);
        });
    });

    afterEach(() => {
        window.URL.createObjectURL = originalCreate;
        window.URL.revokeObjectURL = originalRevoke;
        jest.restoreAllMocks();
    });

    it('asks the owner\'s receipt door, not the staff one, and saves the file under the receipt number', async () => {
        mockedGetBlob.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));

        await expect(PaymentService.downloadReceiptPdf('inv-1', 'TAX-PRD-2026-000002')).resolves.toBe(true);

        expect(mockedGetBlob).toHaveBeenCalledWith('/invoices/my/inv-1/receipt/pdf');
        expect(clicked).toEqual(['TAX-PRD-2026-000002.pdf']);
    });

    it('answers false (never throws) when the door gives no file', async () => {
        mockedGetBlob.mockResolvedValue(null);

        await expect(PaymentService.downloadReceiptPdf('inv-1', 'TAX-PRD-2026-000002')).resolves.toBe(false);
        expect(clicked).toEqual([]);
    });

    it('answers false when the request itself throws', async () => {
        mockedGetBlob.mockRejectedValue(new Error('network'));

        await expect(PaymentService.downloadReceiptPdf('inv-1', 'TAX-PRD-2026-000002')).resolves.toBe(false);
    });
});
