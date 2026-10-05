/**
 * Every price a screen shows is the one GET /api/pricing/fees serves.
 *
 * The amount the platform bills comes from SystemConfig (fee.* keys) through
 * apps/backend/config/business-rules.js and is served by GET /api/pricing/fees.
 * Until this suite, the screens below printed literal constants instead
 * (constants/fees.ts: 5,500 / 27,500 / 33,000 and their VAT totals). They
 * matched the server on the day they were typed, and would have kept showing
 * the old price the day the operator changed a fee, while invoices billed the
 * new one (operator 2026-10-03: "ต้องปิดก่อนเปิดใช้จริง").
 *
 * The pricing response here deliberately differs from every retired literal,
 * so a screen that still reads a constant shows 33,000 / 35,310 / 5,885 /
 * 29,425 and fails. When the fetch fails a screen shows NO number and says
 * where the current price is, rather than a stale one.
 */

import * as React from 'react';
import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Envelope = { success: boolean; data?: unknown; error?: string };
const mockGet = jest.fn<(url: string) => Promise<Envelope>>();
jest.mock('@/lib/api/api-client', () => ({
    apiClient: { get: (url: string) => mockGet(url) },
}));
jest.mock('@/lib/api', () => ({
    apiClient: { get: (url: string) => mockGet(url) },
}));

import PricingPage from '@/app/(marketing)/pricing/page';
import TermsOfServicePage from '@/app/(marketing)/terms-of-service/page';
import { OnboardingModal } from '@/components/onboarding/OnboardingModal';
import FaqClient from '@/app/help/faq/faq-client';
import { PaymentStep } from '@/app/health/applications/renewal/payment-step';
import { ACTION_META } from '@/app/health/applications/[id]/application-detail-page-config';
import { resolveActionTarget } from '@/app/health/applications/[id]/application-detail-page-helpers';
import { LanguageProvider } from '@/lib/i18n/language-context';

/** What the server answers in this suite: no figure equals a retired literal. */
const SERVER = {
    applicationFee: 6_000,
    inspectionFee: 30_000,
    renewalFee: 40_000,
    renewalTotalPerScope: 42_800,
    renewalChargeCount: 1,
    currency: 'THB',
    vatRate: 0.07,
    phase1TotalPerScope: 6_420,
    phase2TotalPerScope: 32_100,
    lastUpdated: '2026-10-03',
    validUntil: '2026-12-31',
};

/** The literals the screens used to print (constants/fees.ts, 2026-09-11). */
const RETIRED = ['5,500', '27,500', '33,000', '5,885', '29,425', '35,310', '385', '1,925', '2,310'];

/** The copy a screen shows instead of a number when the price cannot be read. */
const UNAVAILABLE = 'ดูอัตราค่าบริการล่าสุดได้ที่ใบเสนอราคาในระบบ';

const th = (n: number) => n.toLocaleString('th-TH');

function textOf(html: string): string {
    const div = document.createElement('div');
    div.innerHTML = html;
    return (div.textContent || '').replace(/\s+/g, ' ');
}

function expectNoRetired(text: string) {
    for (const figure of RETIRED) {
        // A bare figure inside a longer number (e.g. 385 in 13,385) is not a hit.
        expect({ figure, found: new RegExp(`(^|[^0-9,])${figure}([^0-9,]|$)`).test(text) })
            .toEqual({ figure, found: false });
    }
}

const fetchMock = jest.fn<(input: unknown, init?: unknown) => Promise<unknown>>();

function serveOk() {
    fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: SERVER }),
    });
    mockGet.mockResolvedValue({ success: true, data: SERVER });
}

function serveDown() {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));
    mockGet.mockResolvedValue({ success: false, error: 'PRICING_UNAVAILABLE' });
}

beforeEach(() => {
    fetchMock.mockReset();
    mockGet.mockReset();
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
});

// ── server components ────────────────────────────────────────────────────────

async function renderServer(Page: () => unknown): Promise<string> {
    const element = (await Page()) as React.ReactElement;
    return textOf(renderToStaticMarkup(element));
}

describe('pricing page (server component) reads GET /api/pricing/fees', () => {
    it('prints every figure the server serves, and no retired literal', async () => {
        serveOk();
        const text = await renderServer(PricingPage as () => unknown);
        expect(text).toContain(`${th(6_420)} บาท`);
        expect(text).toContain(`${th(32_100)} บาท`);
        expect(text).toContain(`${th(42_800)} บาท`);
        // the parts: ค่าบริการ + VAT, both from the server
        expect(text).toContain(th(6_000));
        expect(text).toContain(th(30_000));
        expect(text).toContain(th(40_000));
        expect(text).toContain(th(420));
        expect(text).toContain(th(2_100));
        expect(text).toContain(th(2_800));
        // the hero total is phase 1 + phase 2 as served
        expect(text).toContain(`${th(38_520)} บาท`);
        expectNoRetired(text);
    });

    it('when the fetch fails it prints no amount at all and says where the price is', async () => {
        serveDown();
        const text = await renderServer(PricingPage as () => unknown);
        expect(text).toContain(UNAVAILABLE);
        expect(text).not.toMatch(/[0-9][0-9,]*\s*บาท/);
        expectNoRetired(text);
    });
});

describe('terms of service (server component) reads GET /api/pricing/fees', () => {
    it('states the served amounts in the fee clause', async () => {
        serveOk();
        const text = await renderServer(TermsOfServicePage as () => unknown);
        expect(text).toContain(`ค่าบริการตรวจสอบเอกสาร ${th(6_000)} บาท`);
        expect(text).toContain(`รวม ${th(6_420)} บาท`);
        expect(text).toContain(`งวดที่ 2 ค่าบริการตรวจประเมินแปลงและออกใบรับรอง ${th(30_000)} บาท`);
        expect(text).toContain(`รวม ${th(32_100)} บาท`);
        // operator 2026-10-03 "เพิ่มต่ออายุไปด้วย": the renewal charge is a real
        // cost and belongs in the binding fee clause (ToS 1.1).
        expect(text).toContain(`ค่าบริการต่ออายุใบรับรอง ${th(40_000)} บาท`);
        expect(text).toContain(`รวม ${th(42_800)} บาท`);
        expect(text).toContain('ชำระครั้งเดียว');
        expect(text).toContain('1.1');
        expectNoRetired(text);
    });

    it('when the fetch fails the clause carries no amount', async () => {
        serveDown();
        const text = await renderServer(TermsOfServicePage as () => unknown);
        expect(text).toContain(UNAVAILABLE);
        expect(text).not.toMatch(/[0-9][0-9,]*\s*บาท/);
    });
});

// ── client components ────────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.location.hash = '';
});

async function mount(node: React.ReactNode): Promise<string> {
    await act(async () => {
        root.render(node);
    });
    // let the pricing request resolve and the screen re-render
    await act(async () => {
        await Promise.resolve();
    });
    return (container.textContent || '').replace(/\s+/g, ' ');
}

describe('onboarding modal reads the served fees', () => {
    it('the fee step names the served phase totals', async () => {
        serveOk();
        const text = await mount(<OnboardingModal initialStep={2} persist={false} />);
        expect(mockGet).toHaveBeenCalledWith('/api/pricing/fees');
        expect(text).toContain(`งวดที่ 1 ค่าบริการตรวจสอบเอกสาร ${th(6_420)} บาท`);
        expect(text).toContain(`งวดที่ 2 ค่าบริการตรวจประเมินแปลงและออกใบรับรอง ${th(32_100)} บาท`);
        expectNoRetired(text);
    });

    it('the validity step names the served renewal amount', async () => {
        serveOk();
        const text = await mount(<OnboardingModal initialStep={3} persist={false} />);
        expect(text).toContain(`ค่าบริการต่ออายุใบรับรอง ${th(42_800)} บาท`);
        expectNoRetired(text);
    });

    it('when the fetch fails the fee step shows no number', async () => {
        serveDown();
        const text = await mount(<OnboardingModal initialStep={2} persist={false} />);
        expect(text).toContain(UNAVAILABLE);
        expect(text).not.toMatch(/[0-9][0-9,]*\s*บาท/);
        expectNoRetired(text);
    });
});

describe('help-centre FAQ reads the served fees', () => {
    async function openAnswer(topic: string, itemId: string): Promise<string> {
        window.location.hash = `#${topic}`;
        await mount(
            <LanguageProvider>
                <FaqClient />
            </LanguageProvider>,
        );
        const button = container.querySelector<HTMLButtonElement>(`[data-testid="faq-toggle-${itemId}"]`);
        expect(button).not.toBeNull();
        await act(async () => {
            button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        return (container.querySelector(`#faq-a-${itemId}`)?.textContent || '').replace(/\s+/g, ' ');
    }

    it('the per-scope answer names the served phase totals', async () => {
        serveOk();
        const answer = await openAnswer('payment', 'pay-scope-fee');
        expect(answer).toContain(`${th(6_420)} บาทต่อขอบเขต`);
        expect(answer).toContain(`${th(32_100)} บาทต่อขอบเขต`);
        expectNoRetired(answer);
    });

    it('the renewal answer names the served renewal amount', async () => {
        serveOk();
        const answer = await openAnswer('certificate', 'cert-renewal');
        expect(answer).toContain(`${th(42_800)} บาทต่อรูปแบบการปลูก`);
        expectNoRetired(answer);
    });

    it('when the fetch fails the answers carry no amount', async () => {
        serveDown();
        const answer = await openAnswer('payment', 'pay-scope-fee');
        expect(answer).toContain(UNAVAILABLE);
        expect(answer).not.toMatch(/[0-9][0-9,]*\s*บาท/);
    });
});

describe('renewal wizard reads the served renewal amount', () => {
    const paymentStep = (
        <LanguageProvider>
            <PaymentStep renewalId="renewal-srv" isDark={false} onBack={() => undefined} onConfirm={() => undefined} />
        </LanguageProvider>
    );
    // Round 1 (2026-10-03): the invoice step no longer prints a catalogue
    // price; it shows the register's invoice or quotation for this renewal
    // (renewal-invoice-step-shows-the-server-document.test.tsx).

    it('payment step prints the served payable', async () => {
        serveOk();
        const text = await mount(paymentStep);
        expect(text).toContain(th(42_800));
        expectNoRetired(text);
    });

    it('when the fetch fails the payment step prints no amount', async () => {
        serveDown();
        const pay = await mount(paymentStep);
        expect(pay).toContain(UNAVAILABLE);
        expectNoRetired(pay);
    });

    it('the payment step labels the served amount as per cultivation type (round 1)', async () => {
        serveOk();
        const text = await mount(paymentStep);
        expect(text).toContain('ต่อ 1 รูปแบบการปลูก');
    });
});

describe('application detail: the pay buttons name the served amount', () => {
    const fees = { ...SERVER };

    it('phase 1 button', () => {
        const target = (resolveActionTarget as (...a: unknown[]) => { label: string } | null)(
            'PAY_DOC_FEE', 'app-1', ACTION_META.PAY_DOC_FEE, fees,
        );
        expect(target?.label).toContain(th(6_420));
        expectNoRetired(target?.label ?? '');
    });

    it('phase 2 button', () => {
        const target = (resolveActionTarget as (...a: unknown[]) => { label: string } | null)(
            'PAY_AUDIT_FEE', 'app-1', ACTION_META.PAY_AUDIT_FEE, fees,
        );
        expect(target?.label).toContain(th(32_100));
        expectNoRetired(target?.label ?? '');
    });

    it('without served fees the buttons carry no amount', () => {
        const doc = (resolveActionTarget as (...a: unknown[]) => { label: string } | null)(
            'PAY_DOC_FEE', 'app-1', ACTION_META.PAY_DOC_FEE, null,
        );
        expect(doc?.label).toBe('ชำระงวดที่ 1');
        // the only digit is the instalment number, never an amount
        expect(doc?.label.replace(/งวดที่ [12]/g, '')).not.toMatch(/[0-9]/);
    });
});

// ── added with the implementation (pins, not RED-first) ─────────────────────

describe('the served table is taken whole or not at all', () => {
    it('a payload missing a printed figure is treated as no answer', async () => {
        const { parsePublicFees } = await import('@/lib/pricing/public-fees');
        expect(parsePublicFees(SERVER)).not.toBeNull();
        // e.g. a stored `pricing_fees` SystemConfig blob written before the
        // per-scope totals existed: the route would serve it as-is.
        const partial: Record<string, unknown> = { ...SERVER };
        delete partial.phase2TotalPerScope;
        expect(parsePublicFees(partial)).toBeNull();
        expect(parsePublicFees({ ...SERVER, renewalFee: '40000' })).toBeNull();
        expect(parsePublicFees({ ...SERVER, vatRate: 7 })).toBeNull();
        expect(parsePublicFees(null)).toBeNull();
    });

    it('a 200 that is not success:true is treated as no answer on the server path', async () => {
        fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: false }) });
        const text = await renderServer(PricingPage as () => unknown);
        expect(text).toContain(UNAVAILABLE);
        expectNoRetired(text);
    });

    // Deployed 2026-10-03: with `revalidate = 300` Next prerendered both pages at
    // `docker build`, where no backend exists, so the image shipped the
    // no-number fallback and served it as a cache HIT on staging and demo.
    // The pages must render per request; only the fee fetch is cached.
    it('both server pages render per request (never baked at build without a backend)', async () => {
        const pricing = await import('@/app/(marketing)/pricing/page');
        const terms = await import('@/app/(marketing)/terms-of-service/page');
        for (const page of [pricing, terms] as Array<{ dynamic?: string; revalidate?: number }>) {
            expect(page.dynamic).toBe('force-dynamic');
            expect(page.revalidate).toBeUndefined();
        }
    });

    it('the server path asks the backend for /api/pricing/fees', async () => {
        serveOk();
        await renderServer(PricingPage as () => unknown);
        expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/api\/pricing\/fees$/);
    });
});
