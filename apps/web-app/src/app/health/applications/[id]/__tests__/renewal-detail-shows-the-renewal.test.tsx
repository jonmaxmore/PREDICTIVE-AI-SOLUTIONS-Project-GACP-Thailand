/**
 * fix/fee-line-descriptions round 3 (operator 2026-10-03: "prices are real costs and must
 * be shown completely and correctly"). A renewal's detail page used to show the งวดที่ 2
 * name and the phase-2 per-type price (and a งวดที่ 1 card it never pays). It now shows
 * the renewal service and the renewal amount: the application's own invoice, else its
 * quotation, else the served renewal price × its cultivation types — as the quotation
 * prices it. Display only; nothing is charged differently.
 */
import * as React from 'react';
import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Envelope = { success: boolean; data?: unknown; error?: string };
const mockGet = jest.fn<(path: string) => Promise<Envelope>>();
jest.mock('@/lib/api/api-client', () => {
    const api = { get: (path: string) => mockGet(path), post: jest.fn(), getBlob: jest.fn() };
    return { api, apiClient: api, ApiClient: function ApiClient() {} };
});
jest.mock('@/lib/api', () => {
    const api = { get: (path: string) => mockGet(path), post: jest.fn(), getBlob: jest.fn() };
    return { api, apiClient: api };
});
// A stable router: the page's load effect depends on it, and a fresh object per
// render would reload the page forever.
const mockRouter = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), back: jest.fn(), prefetch: jest.fn() };
const mockParams = { id: 'app-2types' };
jest.mock('next/navigation', () => ({
    useParams: () => mockParams,
    useRouter: () => mockRouter,
    usePathname: () => '/health/applications/app-2types',
    useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@/lib/services/auth-service-session', () => ({
    getStoredUser: () => ({ id: 'user-1', role: 'HEALTH' }),
}));

import ApplicationDetailPage from '../client-view';

const SERVED_FEES = {
    applicationFee: 6_000,
    inspectionFee: 30_000,
    renewalFee: 40_000,
    renewalTotalPerScope: 42_800,
    phase1TotalPerScope: 6_420,
    phase2TotalPerScope: 32_100,
    vatRate: 0.07,
};

const DETAIL = {
    id: 'app-2types',
    applicationId: 'app-2types',
    applicationNumber: 'APP-2569-TWO',
    status: 'PENDING_AUDIT_FEE',
    phase1Status: 'PAID',
    phase1PaidAt: '2026-10-01T03:00:00.000Z',
    phase2Status: 'PENDING',
    createdAt: '2026-09-30T03:00:00.000Z',
    updatedAt: '2026-10-01T03:00:00.000Z',
};

/** Phase 1 of a two-type application: 2 × 6,420. */
const PHASE1_INVOICE = {
    id: 'inv-p1',
    invoiceNumber: 'INV-PRD-2569-000201',
    applicationId: 'app-2types',
    serviceType: 'CERTIFICATION_CHECKOUT_M1',
    totalAmount: '12840.00',
    status: 'paid',
    createdAt: '2026-10-01T03:00:00.000Z',
};

function route(map: Record<string, Envelope>) {
    mockGet.mockImplementation(async (path: string) => {
        for (const [needle, answer] of Object.entries(map)) {
            if (path.includes(needle)) return answer;
        }
        return { success: false, error: 'unrouted ' + path };
    });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    mockGet.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

async function mount(): Promise<HTMLElement> {
    await act(async () => {
        root.render(<ApplicationDetailPage />);
    });
    for (let i = 0; i < 4; i += 1) {
        await act(async () => {
            await Promise.resolve();
        });
    }
    return container;
}

function rowText(el: HTMLElement, label: string): string {
    const rows = Array.from(el.querySelectorAll('div')).filter((d) =>
        /rounded-xl border p-3/.test(d.className) && (d.textContent || '').includes(label));
    return (rows[0]?.textContent || '').replace(/\s+/g, ' ');
}


// The server sends renewalPriceEstimate for every renewal (round 4/5): 2 types × 42,800.
const RENEWAL_DETAIL = { ...DETAIL, status: 'PENDING_AUDIT_FEE', phase1Status: null, phase1PaidAt: null, isRenewal: true, cultivationScopeCount: 2, renewalPriceEstimate: 85600 };
const RENEWAL_TRACKING = { displayStatus: 'PENDING_AUDIT_FEE', workflowState: 'PENDING_AUDIT_FEE', isRenewal: true, actionCard: { key: 'PAY_AUDIT_FEE' } };
const RENEWAL_QUOTATION = {
    dtam: null,
    platform: {
        id: 'q-r', applicationId: 'app-2types', issuerType: 'PLATFORM', quotationNumber: 'QT-PRD-2569-000300',
        subtotal: '66000.00', vat: '4620.00', totalAmount: '70620.00', status: 'ACCEPTED', createdAt: '2026-10-01T03:00:00.000Z',
        installments: [{ phase: 'PHASE_2', amount: 70620, serviceFeeAmount: 66000, vatAmount: 4620, phaseTotal: 70620, scopeCount: 2 }],
    },
    copy: { intro: 'i', note: 'n', services: { PHASE_1: null, PHASE_2: { name: 'ค่าบริการต่ออายุใบรับรอง', nameEn: 'x', coverage: 'ครอบคลุม: x', coverageEn: 'x' } } },
};

describe('a renewal detail page names the renewal and shows the renewal amount', () => {
    it('from the application quotation: 70,620, never the phase-2 figure or name', async () => {
        route({
            '/quotations': { success: true, data: RENEWAL_QUOTATION },
            '/pricing/fees': { success: true, data: SERVED_FEES },
            '/invoices/my': { success: true, data: [] },
            '/status': { success: true, data: RENEWAL_TRACKING },
            '/history': { success: false },
            '/applications/app-2types': { success: true, data: RENEWAL_DETAIL },
        });
        const el = await mount();
        const text = (el.textContent || '').replace(/\s+/g, ' ');
        expect(text).toContain('ค่าบริการต่ออายุใบรับรอง');
        expect(text).toContain('70,620');
        expect(text).toContain('ชำระค่าบริการต่ออายุใบรับรอง ฿70,620');
        expect(text).not.toContain('32,100');
        expect(text).not.toContain('ค่าบริการตรวจประเมินแปลงและออกใบรับรอง');
        expect(text).not.toContain('ค่าบริการตรวจสอบเอกสาร');
        expect(text).not.toMatch(/งวดที่ 2/);
    });

    it('with no quotation and no invoice: the server renewal estimate for its 2 types = 85,600', async () => {
        route({
            '/quotations': { success: false },
            '/pricing/fees': { success: true, data: SERVED_FEES },
            '/invoices/my': { success: true, data: [] },
            '/status': { success: true, data: RENEWAL_TRACKING },
            '/history': { success: false },
            '/applications/app-2types': { success: true, data: RENEWAL_DETAIL },
        });
        const el = await mount();
        const text = (el.textContent || '').replace(/\s+/g, ' ');
        expect(text).toContain('ค่าบริการต่ออายุใบรับรอง');
        expect(text).toContain('85,600');
        expect(text).not.toContain('32,100');
        expect(text).not.toMatch(/งวดที่ 2/);
    });

    it('with no quotation, no invoice and no served fees: the server renewal estimate (85,600)', async () => {
        route({
            '/quotations': { success: false },
            '/pricing/fees': { success: false },
            '/invoices/my': { success: true, data: [] },
            '/status': { success: true, data: RENEWAL_TRACKING },
            '/history': { success: false },
            '/applications/app-2types': { success: true, data: { ...RENEWAL_DETAIL, renewalPriceEstimate: 85600 } },
        });
        const el = await mount();
        const text = (el.textContent || '').replace(/\s+/g, ' ');
        expect(text).toContain('85,600');
        expect(text).not.toMatch(/งวดที่ 2/);
    });

    // round 5 (review): an old row whose stored count says 1 while it declares two
    // methods. The engine (and the quotation) count the declared methods, so the
    // server estimate (2 types) is the figure — not served price × the stale count.
    it('old row, stored count 1 but two declared methods: the server estimate 85,600, not 42,800', async () => {
        route({
            '/quotations': { success: false },
            '/pricing/fees': { success: true, data: SERVED_FEES },
            '/invoices/my': { success: true, data: [] },
            '/status': { success: true, data: RENEWAL_TRACKING },
            '/history': { success: false },
            '/applications/app-2types': { success: true, data: { ...RENEWAL_DETAIL, cultivationScopeCount: 1, renewalPriceEstimate: 85600 } },
        });
        const el = await mount();
        const text = (el.textContent || '').replace(/\s+/g, ' ');
        expect(text).toContain('85,600');
        expect(text).not.toContain('42,800');
    });
});

