/**
 * The phase-1 pay doors' fail-closed refusal reaches the applicant in Thai
 * (fix/fees-from-server round 4, operator 2026-10-03 "fail closed").
 *
 * POST /api/payments/create and /api/payments/phase1/:id now answer
 * `503 { error: 'QUOTATION_GATE_UNAVAILABLE', message: <Thai> }` when the
 * accepted quotation (or its locked price) cannot be read. api-client turns a
 * bare code into "ไม่สามารถดำเนินการได้ (HTTP 503)" in `.error`, keeping the code
 * in `.code`, so a screen that prints `.error` tells the applicant nothing about
 * the cause or what to do. The screens map the code instead.
 */
import { describe, expect, it, jest, beforeEach } from '@jest/globals';

const mockPost = jest.fn<(url: string, body?: unknown) => Promise<Record<string, unknown>>>();
jest.mock('@/lib/api/api-client', () => ({ apiClient: { post: (u: string, b?: unknown) => mockPost(u, b) } }));
jest.mock('@/lib/config/checkout-mode', () => ({ isCheckoutUiEnabled: () => false }));
jest.mock('@/app/health/applications/new/_steps/hooks/use-auto-save', () => ({
    saveCurrentDraftNow: async () => 'SAVED',
    submitClockFor: () => null,
    ensureLatestDraftSaved: async () => 'SAVED',
    forgetFiledApplication: async () => undefined,
    DETACHED_NOTICE_TH: { APPLICATION_NOT_EDITABLE: 'x', APPLICATION_NOT_FOUND: 'y' },
}));

import { submitAndHandOver } from '../submit-and-hand-over';

/** What api-client hands back for that 503 (api-client.ts error branch). */
const REFUSAL_AS_RECEIVED = {
    success: false,
    error: 'ไม่สามารถดำเนินการได้ (HTTP 503)',
    status: 503,
    code: 'QUOTATION_GATE_UNAVAILABLE',
};

beforeEach(() => {
    mockPost.mockReset();
    mockPost.mockImplementation(async (url: string) => (
        url === '/payments/create' ? REFUSAL_AS_RECEIVED : { success: true }
    ));
});

describe('the legacy filing rail, when /payments/create fails closed', () => {
    it('tells the applicant the cause and to try again, and stays on the page', async () => {
        const out = await submitAndHandOver({ applicationId: 'app-1', isInitialSubmit: true, isResubmit: false });
        expect(out.kind).toBe('REFUSED');
        const message = (out as { message?: string }).message ?? '';
        expect(message).toContain('ใบเสนอราคา');
        expect(message).toContain('ยังไม่มีการเรียกเก็บเงิน');
        expect(message).toContain('ลองใหม่อีกครั้ง');
        expect(message).not.toContain('HTTP 503');
    });
});

// Added with the implementation (pins, not RED-first): the wizard's pay button
// reads the same mapping. It is not render-tested here; the source pin keeps it
// on the helper.
describe('the shared mapping', () => {
    it('names only the fail-closed refusal, and nothing else', async () => {
        const { phase1PaymentRefusalTh, QUOTATION_LOOKUP_UNAVAILABLE_COPY_TH } = await import('../payment-service');
        expect(phase1PaymentRefusalTh('QUOTATION_GATE_UNAVAILABLE')).toBe(QUOTATION_LOOKUP_UNAVAILABLE_COPY_TH);
        expect(phase1PaymentRefusalTh('QUOTATION_NOT_ACCEPTED')).toBeNull();
        expect(phase1PaymentRefusalTh(undefined)).toBeNull();
    });

    it('the wizard pay button (invoice-step) maps the code before printing .error', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const src = fs.readFileSync(path.join(__dirname, '../../../app/health/applications/new/_steps/steps/invoice-step.tsx'), 'utf8');
        expect(src).toMatch(/phase1PaymentRefusalTh\(response\.code\)\s*\n?\s*\|\|\s*response\.error/);
    });
});
