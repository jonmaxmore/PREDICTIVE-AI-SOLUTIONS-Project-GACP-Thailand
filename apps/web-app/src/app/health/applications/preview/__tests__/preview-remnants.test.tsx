/**
 * F-G4-50 + F-G4-51 — the applicant's pre-submission preview page still
 * carried two remnants of the retired per-side billing / per-application
 * enum:
 *
 *   F-G4-50  the farm section printed `farmInfo.areaType` — the single
 *            Application.areaType enum derived from the FIRST cultivation
 *            method — raw and in English capitals ("รูปแบบการปลูก: OUTDOOR"),
 *            on an application that had selected three methods. The step-1
 *            section above it already prints the full list through
 *            METHOD_LABELS. One fact, one place.
 *
 *   F-G4-51  the "เอกสารการเงินงวดที่ 1" block showed four slots for the
 *            PHASE_1 state/platform quote+invoice pair. Under the checkout
 *            rail (F-G4-35) that pair is retired and never minted, so the
 *            slots read '-' with a raw 'PENDING' pill forever. The applicant
 *            needs the phase-1 payment state of the ONE checkout invoice
 *            instead — while an application that still HAS legacy rows must
 *            keep showing them.
 *
 * Scaffolded from resubmit-button-renders.test.tsx (same api-client +
 * next/navigation mocks, same act/createRoot harness).
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

jest.mock('next/navigation', () => {
    const router = {
        push: jest.fn(),
        replace: jest.fn(),
        refresh: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        prefetch: jest.fn(),
        pathname: '/',
        query: {},
    };
    const searchParams = new URLSearchParams({ id: 'app-preview-1' });
    return {
        useRouter: () => router,
        usePathname: () => '/',
        useSearchParams: () => searchParams,
    };
});

import ApplicationPreviewPage from '../client-view';
import { METHOD_LABELS, NEXT_ACTION_LABELS, INVOICE_STATUS_LABELS } from '../preview-page-config';
// Fix round 2 (B2-2) — one document, one name. The checkout invoice is the
// company-issued combined document, so its receipt row is named by the same
// helper /health/payments names it with, never by a second literal typed here.
import { receiptNumberRowLabelTH } from '@/lib/services/payment-service';

type PreviewOverrides = {
    phase1Status?: string;
    isPhasePaid?: boolean;
    checkout?: unknown;
    financialDocuments?: unknown;
    nextRequiredAction?: string;
};

/** The paid M1 checkout summary the settled applications below share. */
const PAID_CHECKOUT_PHASE1 = {
    invoiceNumber: 'INV-CO-59E32623-M1',
    status: 'paid',
    isPaid: true,
    paidAt: '2026-08-27T04:27:41.396Z',
    receiptNumber: 'TAX-PRD-2026-000005',
    receiptIssuedAt: '2026-08-27T04:27:41.396Z',
    totalAmount: 17655,
};

/**
 * Fix round 2 (B2-1) — an M1 checkout row that exists but was never paid.
 * Its number is not a document of record: no money moved on it.
 */
const UNPAID_CHECKOUT_PHASE1 = {
    invoiceNumber: 'INV-CO-UNPAID01-M1',
    status: 'pending',
    isPaid: false,
    paidAt: null,
    receiptNumber: null,
    receiptIssuedAt: null,
    totalAmount: 17655,
};

function makePreviewData(overrides: PreviewOverrides = {}) {
    const phase1Status = overrides.phase1Status ?? 'PENDING';
    const isPhasePaid = overrides.isPhasePaid ?? false;
    return {
        applicationId: 'app-preview-1',
        status: 'SUBMITTED',
        nextRequiredAction: overrides.nextRequiredAction ?? 'PAY_PHASE_1',
        selectionInfo: {
            plantId: 'กัญชา',
            serviceType: 'NEW',
            purpose: 'EXPORT',
            cultivationMethods: ['OUTDOOR', 'GREENHOUSE', 'INDOOR'],
        },
        farmInfo: {
            farmName: 'ไร่ทดสอบ',
            standardCode: 'GACP',
            areaType: 'OUTDOOR',
            areaSize: 5,
            location: 'เชียงใหม่',
        },
        productionInfo: {},
        documents: [],
        summary: { totalSteps: 7, completedSteps: 7, isComplete: true, missingFields: [] as string[] },
        payment: {
            phase1Amount: 17655,
            phase1Status,
            phase2Amount: 27675,
            scopeCount: 3,
            totalEstimated: 45330,
            breakdown: {
                phase1: {
                    stateAmount: 15000, platformAmount: 1500, phaseTotal: 17655,
                    stateStatus: phase1Status, platformStatus: phase1Status, isPhasePaid,
                },
                phase2: {
                    stateAmount: 25000, platformAmount: 2500, phaseTotal: 27675,
                    stateStatus: 'PENDING', platformStatus: 'PENDING', isPhasePaid: false,
                },
                totals: { stateTotal: 40000, platformTotal: 4000, grandTotal: 45330 },
            },
            checkout: overrides.checkout ?? { phase1: null, phase2: null },
        },
        financialDocuments: overrides.financialDocuments ?? {
            quote: null,
            invoice: null,
            phase1: {
                state: { quote: null, invoice: null },
                platform: { quote: null, invoice: null },
            },
        },
    };
}

async function flushAsync(rounds = 8): Promise<void> {
    for (let i = 0; i < rounds; i += 1) {
        await act(async () => {
            await Promise.resolve();
        });
    }
}

describe('/health/applications/preview — no raw enum, no dead legacy finance slots (F-G4-50, F-G4-51)', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        if (root) {
            act(() => {
                root?.unmount();
            });
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

    async function mountWith(preview: unknown) {
        mockApiGet.mockResolvedValueOnce({ success: true, data: { success: true, preview } });
        mount();
        await flushAsync();
        return container!.textContent || '';
    }

    /**
     * The status pills rendered inside the legacy "เอกสารการเงินงวดที่ 1"
     * block, in document order. An empty slot must contribute nothing.
     */
    function legacyBlockPills(): string[] {
        const heading = Array.from(container!.querySelectorAll('h2'))
            .find((h) => h.textContent === 'เอกสารการเงินงวดที่ 1');
        if (!heading?.parentElement) {
            return [];
        }
        return Array.from(heading.parentElement.querySelectorAll('span'))
            .map((pill) => pill.textContent || '');
    }

    /**
     * The LABEL of the label/value fact row whose value is `value`, or null when
     * no row carries that value. Reads the row the applicant actually sees, so
     * the assertion cannot pass on a label rendered somewhere else.
     */
    function factRowLabel(value: string): string | null {
        const row = Array.from(container!.querySelectorAll('div'))
            .find((el) => el.children.length === 2 && el.children[1]?.textContent === value);
        return row ? (row.children[0]?.textContent ?? null) : null;
    }

    it('(1) unpaid application on the checkout rail: no raw enum anywhere, and the retired 4-slot block is gone', async () => {
        const text = await mountWith(makePreviewData());

        // F-G4-50 — the derived single-method enum must not reach the applicant.
        expect(text).not.toContain('OUTDOOR');
        // ...but the three methods the applicant actually selected still do,
        // through the step-1 section's METHOD_LABELS.
        expect(text).toContain(METHOD_LABELS.OUTDOOR);
        expect(text).toContain(METHOD_LABELS.GREENHOUSE);
        expect(text).toContain(METHOD_LABELS.INDOOR);

        // F-G4-51 — the retired per-side documents block, and the raw status
        // enum it printed, are gone; the phase-1 payment state replaces it.
        expect(text).not.toContain('เอกสารการเงินงวดที่ 1');
        expect(text).not.toContain('PENDING');
        expect(text).toContain('การชำระเงินงวดที่ 1');
        expect(text).toContain('ยังไม่ชำระ');
        expect(text).toContain('ชำระได้ที่หน้าชำระเงินหลังยื่นคำขอ ระบบจะออกใบเสร็จให้คุณอัตโนมัติหลังชำระเงิน');
        // Footer chip: Thai sentence, not `สถานะงวดที่ 1: PENDING`.
        expect(text).toContain('ยังไม่ชำระงวดที่ 1');
    });

    it('(2) paid checkout: the applicant sees the receipt number, its Buddhist-era date and the amount', async () => {
        const text = await mountWith(makePreviewData({
            phase1Status: 'PAID',
            isPhasePaid: true,
            checkout: { phase1: PAID_CHECKOUT_PHASE1, phase2: null },
        }));

        expect(text).toContain('ชำระแล้ว');
        expect(text).toContain('INV-CO-59E32623-M1');
        expect(text).toContain('TAX-PRD-2026-000005');
        expect(text).toContain('2569');
        expect(text).toContain('17,655');
        expect(text).not.toContain('เอกสารการเงินงวดที่ 1');
        expect(text).not.toContain('OUTDOOR');

        // B2-2 — the checkout invoice is the company-issued combined document
        // (tax invoice + receipt). This page called its number 'เลขที่ใบเสร็จ'
        // while /health/payments called the SAME number something else: one
        // document with two names. The name comes from the shared helper.
        expect(factRowLabel('TAX-PRD-2026-000005'))
            .toBe(receiptNumberRowLabelTH({ component: 'CHECKOUT' }));
    });

    it('(3) legacy data stays visible: an application that really has a per-side invoice still shows it, with no PENDING fallback on the empty slot', async () => {
        const text = await mountWith(makePreviewData({
            financialDocuments: {
                quote: null,
                invoice: null,
                phase1: {
                    state: {
                        quote: null,
                        // B-F4: the stored value is the UPPERCASE enum — the
                        // shape the demo DB actually holds.
                        invoice: { invoiceNumber: 'INV-202608260007', status: 'PENDING' },
                    },
                    platform: { quote: null, invoice: null },
                },
            },
        }));

        expect(text).toContain('เอกสารการเงินงวดที่ 1');
        expect(text).toContain('INV-202608260007');
        // B-F4: the pill printed the raw English status at the applicant.
        expect(text).toContain(INVOICE_STATUS_LABELS.PENDING);
        expect(text).not.toContain('PENDING');
        expect(text).not.toContain('RECEIPT_ISSUED');
        // Exactly one status pill in the block: the one row that exists. The
        // three empty slots carry no pill at all.
        expect(legacyBlockPills()).toEqual([INVOICE_STATUS_LABELS.PENDING]);
    });

    /**
     * B-F2 — the footer chip printed `ขั้นตอนถัดไป: PAY_PHASE_1`: an internal
     * action enum, in English capitals, as the applicant's instruction.
     */
    it('(4) the next-action chip is a Thai instruction, never the raw action enum', async () => {
        const text = await mountWith(makePreviewData({ nextRequiredAction: 'PAY_PHASE_1' }));

        expect(text).toContain(`ขั้นตอนถัดไป: ${NEXT_ACTION_LABELS.PAY_PHASE_1}`);
        expect(text).not.toContain('PAY_PHASE_1');
    });

    /**
     * B2-3 — NEXT_ACTION_LABELS is a plain object, so an action key reading
     * '__proto__' (or 'constructor') resolved to an INHERITED value of
     * Object.prototype rather than undefined. That value is not a string: React
     * throws on rendering it and the applicant gets a blank page instead of a
     * preview. An action counts only when the table owns the key — the same
     * own-property rule the public verify page uses for its reason codes.
     */
    it('(5) an action the page has no words for shows no chip at all, not a raw key and not a crash', async () => {
        const text = await mountWith(makePreviewData({ nextRequiredAction: '__proto__' }));

        expect(text).not.toContain('ขั้นตอนถัดไป');
        expect(text).not.toContain('__proto__');
        // The rest of the page still rendered: no crash, just no chip.
        expect(text).toContain('การชำระเงินงวดที่ 1');
    });

    /**
     * B-F2, second half — the footer chip read only the split-rail settlement,
     * so an applicant whose checkout invoice had settled was still told
     * "ยังไม่ชำระงวดที่ 1" right under a section saying ชำระแล้ว.
     */
    it('(6) a settled checkout invoice alone makes the footer say the phase is paid', async () => {
        const text = await mountWith(makePreviewData({
            phase1Status: 'PENDING',
            isPhasePaid: false,
            checkout: { phase1: PAID_CHECKOUT_PHASE1, phase2: null },
        }));

        expect(text).toContain('ชำระงวดที่ 1 แล้ว');
        expect(text).not.toContain('ยังไม่ชำระงวดที่ 1');
    });

    /**
     * B-F3 — the legacy block treated a CANCELLED row as live: an application
     * whose ghost split invoices were voided and whose real money went through
     * the checkout rail saw four dead slots instead of its own receipt.
     */
    it('(7) voided legacy rows are not live: the checkout section wins and carries the receipt', async () => {
        const text = await mountWith(makePreviewData({
            phase1Status: 'PAID',
            isPhasePaid: true,
            checkout: { phase1: PAID_CHECKOUT_PHASE1, phase2: null },
            financialDocuments: {
                quote: null,
                invoice: null,
                phase1: {
                    state: {
                        quote: null,
                        invoice: { invoiceNumber: 'INV-202608260007', status: 'CANCELLED' },
                    },
                    platform: {
                        quote: null,
                        invoice: { invoiceNumber: 'INV-202608260008', status: 'CANCELLED' },
                    },
                },
            },
        }));

        expect(text).not.toContain('เอกสารการเงินงวดที่ 1');
        expect(text).toContain('การชำระเงินงวดที่ 1');
        expect(text).toContain('TAX-PRD-2026-000005');
        expect(text).not.toContain('CANCELLED');
        expect(text).not.toContain('INV-202608260007');
    });

    /**
     * B-F5c — a checkout row with no amount is UNKNOWN, not ฿0. The backend
     * now answers null; the page must render no amount row rather than a
     * fabricated zero.
     */
    it('(8) a paid checkout row with no amount renders no amount line', async () => {
        const text = await mountWith(makePreviewData({
            phase1Status: 'PAID',
            isPhasePaid: true,
            checkout: {
                phase1: { ...PAID_CHECKOUT_PHASE1, totalAmount: null },
                phase2: null,
            },
        }));

        expect(text).toContain('TAX-PRD-2026-000005');
        expect(text).not.toContain('ยอดชำระ');
        expect(text).not.toContain('฿0');
    });

    /**
     * Fix round 2 (B2-1) — the document of record is the rail the money moved
     * on, not the rail a row happens to exist on.
     *
     * The branch used to turn on the mere EXISTENCE of a checkout row
     * (`!checkoutPhase1`). An application whose phase 1 settled on the split
     * rail, and which also carried an abandoned unpaid checkout invoice, was
     * therefore shown the checkout branch — printing the number of an invoice
     * nobody ever paid under a "ชำระแล้ว" heading, while the legacy invoice its
     * money really moved on was hidden.
     */
    it('(9) an unpaid checkout row does not displace the legacy invoice the money moved on', async () => {
        const text = await mountWith(makePreviewData({
            phase1Status: 'PAID',
            isPhasePaid: true,
            checkout: { phase1: UNPAID_CHECKOUT_PHASE1, phase2: null },
            financialDocuments: {
                quote: null,
                invoice: null,
                phase1: {
                    state: {
                        quote: null,
                        invoice: { invoiceNumber: 'INV-202608260007', status: 'PAID' },
                    },
                    platform: { quote: null, invoice: null },
                },
            },
        }));

        expect(text).toContain('เอกสารการเงินงวดที่ 1');
        expect(text).toContain('INV-202608260007');
        // The number of an invoice nobody paid is not a document of record.
        expect(text).not.toContain('INV-CO-UNPAID01-M1');
        expect(text).not.toContain('PAID');
        expect(legacyBlockPills()).toEqual([INVOICE_STATUS_LABELS.PAID]);
    });

    /**
     * Fix round 2 (B2-1), second half — with the phase settled on the split
     * rail and no live legacy document left, the page says the phase is paid
     * and stops there. The fact rows (invoice number, receipt, date, amount)
     * belong to the checkout invoice, so they render only when THAT invoice was
     * the one paid; an unpaid row contributes no facts.
     */
    it('(10) a phase paid on the split rail says ชำระแล้ว and prints no fact row off an unpaid checkout invoice', async () => {
        const text = await mountWith(makePreviewData({
            phase1Status: 'PAID',
            isPhasePaid: true,
            checkout: { phase1: UNPAID_CHECKOUT_PHASE1, phase2: null },
        }));

        expect(text).toContain('การชำระเงินงวดที่ 1');
        expect(text).toContain('ชำระแล้ว');
        expect(text).not.toContain('INV-CO-UNPAID01-M1');
        expect(text).not.toContain('เลขที่ใบแจ้งหนี้');
        expect(text).not.toContain('ยอดชำระ');
    });

    /**
     * Fix round 2 (B2-1) — the liveness rule is what decides this shape, and
     * only this shape: no checkout row at all, and every legacy row cancelled.
     * Without isLiveLegacyInvoice the applicant would be sent to a four-slot
     * block of voided ghosts instead of being told they have not paid yet.
     *
     * Green at birth on the code under test: this PINS isLiveLegacyInvoice
     * against the B2-1 rewrite of the branch condition above.
     */
    it('(11) no checkout row and only cancelled legacy rows: the phase reads ยังไม่ชำระ, not four dead slots', async () => {
        const text = await mountWith(makePreviewData({
            phase1Status: 'PENDING',
            isPhasePaid: false,
            checkout: { phase1: null, phase2: null },
            financialDocuments: {
                quote: null,
                invoice: null,
                phase1: {
                    state: {
                        quote: null,
                        invoice: { invoiceNumber: 'INV-202608260007', status: 'CANCELLED' },
                    },
                    platform: {
                        quote: null,
                        invoice: { invoiceNumber: 'INV-202608260008', status: 'CANCELLED' },
                    },
                },
            },
        }));

        expect(text).not.toContain('เอกสารการเงินงวดที่ 1');
        expect(text).toContain('การชำระเงินงวดที่ 1');
        expect(text).toContain('ยังไม่ชำระ');
        expect(text).not.toContain('INV-202608260007');
        expect(text).not.toContain('INV-202608260008');
        expect(text).not.toContain('CANCELLED');
    });
});
