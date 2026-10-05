/**
 * The application-detail payment card names amounts that are true for THIS
 * application (fix/fees-from-server round 1, 2026-10-03).
 *
 * It printed the per-cultivation-type phase price beside "ค่าตรวจเอกสาร" /
 * "ค่าประเมินหน้างาน" and the paid/pending badge, so an application with two
 * cultivation types read as owing (or having paid) half of what it was billed.
 * Now, per phase: the register's invoice total for this application when an
 * invoice exists; otherwise the served price labelled as per cultivation type.
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

describe('application detail payment card', () => {
    it('an invoiced phase shows the invoice total for this application, not the per-type price', async () => {
        route({
            '/pricing/fees': { success: true, data: SERVED_FEES },
            '/invoices/my': { success: true, data: [PHASE1_INVOICE] },
            '/status': { success: false },
            '/history': { success: false },
            '/applications/app-2types': { success: true, data: DETAIL },
        });
        const el = await mount();
        const doc = rowText(el, 'ค่าบริการตรวจสอบเอกสาร');
        expect(doc).toContain('12,840');
        expect(doc).not.toContain('6,420');
    });

    it('a phase with no invoice yet shows the served price, labelled per cultivation type', async () => {
        route({
            '/pricing/fees': { success: true, data: SERVED_FEES },
            '/invoices/my': { success: true, data: [PHASE1_INVOICE] },
            '/status': { success: false },
            '/history': { success: false },
            '/applications/app-2types': { success: true, data: DETAIL },
        });
        const el = await mount();
        const audit = rowText(el, 'ค่าบริการตรวจประเมินแปลงและออกใบรับรอง');
        expect(audit).toContain('32,100');
        expect(audit).toContain('ต่อ 1 รูปแบบการปลูก');
    });
});
