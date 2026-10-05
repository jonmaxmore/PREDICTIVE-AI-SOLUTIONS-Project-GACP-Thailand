/**
 * An invoice's phase comes from what the invoice says, never from its amount.
 *
 * normalizeServiceType used to label an invoice that arrived without a
 * serviceType by comparing its amount to PHASE_1_FEE_THRESHOLD (5,500, the
 * phase-1 ค่าบริการ BEFORE VAT) while `amount` is the VAT-inclusive invoice
 * total. A 5,885 phase-1 invoice was therefore labelled phase 2, and the guess
 * would move again the day the operator changed a fee.
 *
 * Now: serviceType first; else the phase every line item carries; else no
 * phase at all (UNKNOWN), which the payments page renders without a phase
 * label rather than with a wrong one.
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';

type Envelope = { success: boolean; data?: unknown; error?: string };
const mockGet = jest.fn<(path: string) => Promise<Envelope>>();
jest.mock('@/lib/api/api-client', () => {
    const api = { get: (path: string) => mockGet(path), post: jest.fn(), getBlob: jest.fn() };
    return { api, apiClient: api };
});

import { PaymentService } from '@/lib/services/payment-service';

const base = {
    id: 'inv-1',
    invoiceNumber: 'INV-PRD-2569-000001',
    applicationId: 'app-1',
    status: 'pending',
    createdAt: '2026-10-03T03:00:00.000Z',
};

async function readOne(invoice: Record<string, unknown>) {
    mockGet.mockResolvedValue({ success: true, data: [{ ...base, ...invoice }] });
    const [row] = await PaymentService.getMyPayments();
    return row;
}

beforeEach(() => mockGet.mockReset());

describe('the phase of an invoice is read, not guessed', () => {
    it('a 5,885 invoice with no serviceType and no line items gets no phase, not phase 2', async () => {
        const row = await readOne({ totalAmount: '5885.00' });
        expect(row.phase).toBe('UNKNOWN');
    });

    it('a small invoice with no serviceType is not called phase 1 either', async () => {
        const row = await readOne({ totalAmount: '100.00' });
        expect(row.phase).toBe('UNKNOWN');
    });

    it('line items that all name one phase decide it', async () => {
        const row = await readOne({
            totalAmount: '5885.00',
            lineItems: [{ lineNumber: 1, code: 'DOC_REVIEW', description: 'x', quantity: 1, unitPrice: 5500, amount: '5885.00', phase: 'PHASE_1', isTaxable: true }],
        });
        expect(row.phase).toBe('PHASE_1');
    });

    it('line items that disagree decide nothing', async () => {
        const row = await readOne({
            totalAmount: '35310.00',
            lineItems: [
                { lineNumber: 1, code: 'A', description: 'x', quantity: 1, unitPrice: 1, amount: 1, phase: 'PHASE_1', isTaxable: true },
                { lineNumber: 2, code: 'B', description: 'y', quantity: 1, unitPrice: 1, amount: 1, phase: 'PHASE_2', isTaxable: true },
            ],
        });
        expect(row.phase).toBe('UNKNOWN');
    });

    it('a serviceType wins over the amount, whatever the amount', async () => {
        expect((await readOne({ serviceType: 'PHASE_1_STATE_FEE', totalAmount: '99999.00' })).phase).toBe('PHASE_1');
        expect((await readOne({ serviceType: 'PHASE_2_STATE_FEE', totalAmount: '1.00' })).phase).toBe('PHASE_2');
        expect((await readOne({ serviceType: 'CERTIFICATION_CHECKOUT_M1', totalAmount: '29425.00' })).phase).toBe('PHASE_1');
    });
});
