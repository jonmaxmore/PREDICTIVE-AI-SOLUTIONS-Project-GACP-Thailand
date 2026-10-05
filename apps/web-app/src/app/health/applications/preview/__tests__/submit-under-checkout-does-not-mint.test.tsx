/**
 * The preview page's file door under the quotation gate (F-G4-64, final round,
 * last items — BE-2 review r2 BLOCKER 1).
 *
 * R9 put `assertQuotationAcceptedForPayment` in front of
 * `POST /api/payments/create` (apps/backend/routes/api/finance/payments.js).
 * That endpoint has exactly one caller in the product: this page's
 * "ยื่นคำขอแล้วไปหน้าชำระเงินงวดที่ 1" button, which files the application and then, in the
 * same press, asked for a phase-1 payment record. At that instant the
 * application has just been submitted, so its quotation exists at PENDING
 * (services/quotation-service.js) and the gate answers 409
 * QUOTATION_NOT_ACCEPTED on EVERY first submission — a document the applicant
 * could not have accepted one HTTP call ago. The refusal reached the screen as
 * the raw enum, because api-client has no friendly branch for a QUOTATION_*
 * string, and the redirect never ran.
 *
 * Coordinator ruling: under the checkout rail this page does not mint a
 * payment record at all. It files the application and sends the applicant to
 * /health/payments, which is where the quotation card, the ยอมรับ tick and the
 * pay door live. With the flag off the legacy mint stays, and a quotation-gate
 * refusal becomes the catalogue's Thai plus the same routing.
 *
 * Harness copied from resubmit-button-renders.test.tsx in this directory
 * (createRoot + act with microtask flushes; api-client and next/navigation
 * mocked before the page is imported).
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApiGet = jest.fn<(url: string) => Promise<unknown>>();
const mockApiPost = jest.fn<(url: string, body?: unknown) => Promise<unknown>>();
jest.mock('@/lib/api/api-client', () => ({
    apiClient: {
        get: (url: string) => mockApiGet(url),
        post: (url: string, body?: unknown) => mockApiPost(url, body),
    },
}));

const mockRouterPush = jest.fn<(href: string) => void>();
jest.mock('next/navigation', () => {
    const router = {
        push: (href: string) => mockRouterPush(href),
        replace: jest.fn(),
        refresh: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        prefetch: jest.fn(),
    };
    const searchParams = new URLSearchParams({ id: 'app-preview-1' });
    return {
        useRouter: () => router,
        usePathname: () => '/health/applications/preview',
        useSearchParams: () => searchParams,
    };
});

// The same flag helper the payments list and the checkout page read, mocked the
// way those suites mock it, so no test writes process.env.
const mockIsCheckoutUiEnabled = jest.fn<() => boolean>();
jest.mock('@/lib/config/checkout-mode', () => ({
    getCheckoutApiMode: () => 'live',
    isCheckoutUiEnabled: () => mockIsCheckoutUiEnabled(),
}));

import ApplicationPreviewPage from '../client-view';
import {
    QUOTATION_EXPIRED_COPY_TH,
    QUOTATION_NOT_ISSUED_COPY_TH,
    QUOTATION_NOT_ACCEPTED_COPY_TH,
} from '@/lib/services/payment-service';

const PAYMENTS_HREF = '/health/payments?app=app-preview-1&phase=1';

/** A complete DRAFT application with nothing paid — the door's own happy path. */
function draftPreview() {
    return {
        applicationId: 'app-preview-1',
        status: 'DRAFT',
        nextRequiredAction: 'PAY_PHASE_1',
        farmInfo: {},
        productionInfo: {},
        documents: [],
        summary: { totalSteps: 7, completedSteps: 7, isComplete: true, missingFields: [] as string[] },
        payment: {
            phase1Amount: 5885,
            phase1Status: 'PENDING',
            phase2Amount: 29425,
            scopeCount: 1,
            totalEstimated: 35310,
            breakdown: {
                phase1: {
                    stateAmount: 5000, platformAmount: 500, phaseTotal: 5885,
                    stateStatus: 'PENDING', platformStatus: 'PENDING', isPhasePaid: false,
                },
                phase2: {
                    stateAmount: 25000, platformAmount: 2500, phaseTotal: 29425,
                    stateStatus: 'PENDING', platformStatus: 'PENDING', isPhasePaid: false,
                },
                totals: { stateTotal: 30000, platformTotal: 3000, grandTotal: 35310 },
            },
        },
        financialDocuments: {},
    };
}

async function flushAsync(rounds = 8): Promise<void> {
    for (let i = 0; i < rounds; i += 1) {
        await act(async () => {
            await Promise.resolve();
        });
    }
}

describe('the preview page files the application, then hands over to the payments page', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        mockApiGet.mockResolvedValue({ success: true, data: { success: true, preview: draftPreview() } });
    });

    afterEach(() => {
        if (root) {
            act(() => { root?.unmount(); });
            root = null;
        }
        if (container) {
            container.remove();
            container = null;
        }
    });

    function mount() {
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root!.render(<ApplicationPreviewPage />);
        });
    }

    async function pressSubmit(): Promise<void> {
        const btn = Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find(
            (b) => (b.textContent || '').includes('ยื่นคำขอแล้วไปหน้าชำระเงินงวดที่ 1'),
        );
        expect(btn).not.toBeUndefined();
        expect(btn!.disabled).toBe(false);
        await act(async () => { btn!.click(); });
        await flushAsync();
    }

    function postedUrls(): string[] {
        return mockApiPost.mock.calls.map(([url]) => url);
    }

    describe('checkout rail on', () => {
        beforeEach(() => {
            mockIsCheckoutUiEnabled.mockReturnValue(true);
            mockApiPost.mockResolvedValue({ success: true, data: { status: 'PENDING_DOC_FEE' } });
        });

        it('submits and routes to the payments page without asking for a payment record', async () => {
            mount();
            await flushAsync();
            await pressSubmit();

            expect(postedUrls()).toEqual(['/applications/submit']);
            expect(postedUrls()).not.toContain('/payments/create');
            expect(mockRouterPush).toHaveBeenCalledWith(PAYMENTS_HREF);
        });

        it('shows no error at all: the gate refusal that used to appear cannot be raised', async () => {
            mount();
            await flushAsync();
            await pressSubmit();

            const text = container!.textContent || '';
            expect(text).not.toContain('QUOTATION_NOT_ACCEPTED');
            expect(text).not.toContain('ไม่สามารถสร้างรายการชำระเงินได้');
        });

        // PIN (written after the change, declared as such): an application
        // already filed is the shape s07 presses — isInitialSubmit is false, so
        // the door used to skip /submit and call /payments/create on its own.
        // Under this rail a second press mints nothing either; it just hands
        // over again.
        it('a second press on an already-filed application asks the backend for nothing', async () => {
            mockApiGet.mockResolvedValue({
                success: true,
                data: { success: true, preview: { ...draftPreview(), status: 'PENDING_DOC_FEE' } },
            });

            mount();
            await flushAsync();
            await pressSubmit();

            expect(mockApiPost).not.toHaveBeenCalled();
            expect(mockRouterPush).toHaveBeenCalledWith(PAYMENTS_HREF);
        });

        it('a failed submit still stops the press, and still shows the submit failure', async () => {
            mockApiPost.mockResolvedValueOnce({
                success: false, error: 'APPLICATION_INCOMPLETE', code: 'APPLICATION_INCOMPLETE', status: 422,
                meta: { messageTh: 'ข้อความทดสอบจากแบ็กเอนด์' },
            });

            mount();
            await flushAsync();
            await pressSubmit();

            expect(container!.textContent).toContain('ข้อความทดสอบจากแบ็กเอนด์');
            expect(mockRouterPush).not.toHaveBeenCalled();
        });
    });

    describe('checkout rail off — the legacy mint stays, and its refusals become Thai', () => {
        beforeEach(() => {
            mockIsCheckoutUiEnabled.mockReturnValue(false);
        });

        it('still mints the phase-1 record and redirects when the gate lets it through', async () => {
            mockApiPost.mockResolvedValue({ success: true, data: { status: 'PENDING_DOC_FEE' } });

            mount();
            await flushAsync();
            await pressSubmit();

            expect(postedUrls()).toEqual(['/applications/submit', '/payments/create']);
            expect(mockRouterPush).toHaveBeenCalledWith(PAYMENTS_HREF);
        });

        it.each([
            ['QUOTATION_NOT_ACCEPTED', QUOTATION_NOT_ACCEPTED_COPY_TH],
            ['QUOTATION_NOT_ISSUED', QUOTATION_NOT_ISSUED_COPY_TH],
            ['QUOTATION_EXPIRED', QUOTATION_EXPIRED_COPY_TH],
        ])('%s reaches the applicant as Thai, and the door sends them where the tick is', async (code, copy) => {
            mockApiPost
                .mockResolvedValueOnce({ success: true, data: { status: 'PENDING_DOC_FEE' } })
                // What api-client really returns for {success:false, error:'<CODE>'}
                // at 409: `code` carries the identifier and `error` carries it
                // too, because toUserFriendlyError has no branch for it.
                .mockResolvedValueOnce({ success: false, error: code, code, status: 409 });

            mount();
            await flushAsync();
            await pressSubmit();

            const text = container!.textContent || '';
            expect(text).not.toContain(code);
            expect(text).toContain(copy);
            expect(mockRouterPush).toHaveBeenCalledWith(PAYMENTS_HREF);
        });

        it('a failure that is not the quotation gate keeps its own message and stays put', async () => {
            mockApiPost
                .mockResolvedValueOnce({ success: true, data: { status: 'PENDING_DOC_FEE' } })
                .mockResolvedValueOnce({ success: false, error: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง', status: 500 });

            mount();
            await flushAsync();
            await pressSubmit();

            expect(container!.textContent).toContain('ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง');
            expect(mockRouterPush).not.toHaveBeenCalled();
        });
    });
});
