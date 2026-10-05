/**
 * Defect batch B item 8 (farmer side): once the audit is booked (AUDIT_CONFIRMED) the
 * application detail page says when the inspector comes and who it is. The page showed
 * neither (no "scheduledDate" anywhere under app/health), so a farmer with a confirmed visit
 * had to wait for the notification to learn the date.
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
const mockRouter = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), back: jest.fn(), prefetch: jest.fn() };
const mockParams = { id: 'app-booked' };
jest.mock('next/navigation', () => ({
    useParams: () => mockParams,
    useRouter: () => mockRouter,
    usePathname: () => '/health/applications/app-booked',
    useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@/lib/services/auth-service-session', () => ({
    getStoredUser: () => ({ id: 'user-1', role: 'HEALTH' }),
}));

import ApplicationDetailPage from '../client-view';

// 2026-10-12 09:30 Bangkok
const WHEN = '2026-10-12T02:30:00.000Z';

const base = {
    id: 'app-booked', applicationId: 'app-booked', applicationNumber: 'APP-2569-BOOK', status: 'AUDIT_CONFIRMED',
    workflowState: 'AUDIT_CONFIRMED', phase1Status: 'PAID', phase2Status: 'PAID',
    createdAt: '2026-09-30T03:00:00.000Z', updatedAt: '2026-10-01T03:00:00.000Z',
};

function route(detail: Record<string, unknown>) {
    mockGet.mockImplementation(async (path: string) => {
        if (path.endsWith('/status')) { return { success: true, data: { displayStatus: detail.status } }; }
        if (path.endsWith('/history')) { return { success: true, data: { history: [] } }; }
        if (path === '/applications/app-booked') { return { success: true, data: detail }; }
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
    await act(async () => { root.render(<ApplicationDetailPage />); });
    for (let i = 0; i < 6; i += 1) { await act(async () => { await Promise.resolve(); }); }
    return container;
}

describe('the booked visit on the farmer detail page', () => {
    it('shows the Bangkok date, the time, and the inspector by name', async () => {
        route({ ...base, auditSchedule: { scheduledDate: WHEN, inspectionMode: 'ONSITE', auditorName: 'สมชาย ใจดี', meetingLink: null } });
        const el = await mount();
        const card = el.querySelector('[data-testid="audit-schedule-card"]');
        expect(card).not.toBeNull();
        const text = (card?.textContent || '').replace(/\s+/g, ' ');
        expect(text).toContain('สมชาย ใจดี');
        expect(text).toContain('12');
        expect(text).toContain('2569');
        expect(text).toMatch(/09[:.]30/);
        expect(text).not.toMatch(/ONSITE|ONLINE_MEET/);
    });

    it('an online visit offers the meeting link', async () => {
        route({ ...base, auditSchedule: { scheduledDate: WHEN, inspectionMode: 'ONLINE_MEET', auditorName: 'สมชาย ใจดี', meetingLink: 'https://meet.example/x' } });
        const el = await mount();
        const link = el.querySelector('[data-testid="audit-schedule-card"] a[href="https://meet.example/x"]');
        expect(link).not.toBeNull();
    });

    it('no booked visit, no card (and never a 1970 date)', async () => {
        route({ ...base, status: 'AUDIT_FEE_PAID', workflowState: 'AUDIT_FEE_PAID', auditSchedule: null });
        const el = await mount();
        expect(el.querySelector('[data-testid="audit-schedule-card"]')).toBeNull();
        expect(el.textContent || '').not.toContain('2513');
    });

    it('the waiting-for-a-date hint no longer says "Coordinator"', async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const cfg = require('../application-detail-page-config') as { resolveActionMeta: (k: string) => { hint?: string } };
        expect(JSON.stringify(cfg.resolveActionMeta('WAIT_SCHEDULE'))).not.toContain('Coordinator');
    });
});
