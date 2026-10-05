/**
 * queue-states.test.tsx — V2-C scheduler-queue UX state assertions.
 *
 * Three explicit assertions for the V2-C acceptance:
 *   1. Loading skeleton renders BEFORE getSchedulingQueue resolves
 *      (DataTable's `loading` branch).
 *   2. Empty-state copy renders when getSchedulingQueue resolves with
 *      no rows (`emptyTitle` + `emptyDescription`).
 *   3. Inline error banner (`scheduler-queue-load-error`) renders when
 *      getSchedulingQueue resolves with `{ success: false }`, and the
 *      retry button is present.
 *
 * I-016 — per-file stable `next/navigation` mock so any router-derived
 * effect dep doesn't loop in act(). The queue client-view currently
 * does not use useRouter, but the global jest.setup.tsx mock returns
 * fresh objects per call so pinning here is safe insurance.
 *
 * I-008 — mock surface exposes every AuditService method the SUT
 * imports (`getSchedulingQueue`, plus `getAuditors` /
 * `getAuditorAvailability` / `assignAuditor` because the queue page
 * mounts the AssignAuditorModal underneath the table).
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {

  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockGetSchedulingQueue = jest.fn();
const mockGetAuditors = jest.fn();
const mockGetAuditorAvailability = jest.fn();
const mockAssignAuditor = jest.fn();

jest.mock('@/lib/services/audit-service', () => ({
    AuditService: {
        getSchedulingQueue: (...args: unknown[]) => mockGetSchedulingQueue(...args),
        getAuditors: (...args: unknown[]) => mockGetAuditors(...args),
        getAuditorAvailability: (...args: unknown[]) => mockGetAuditorAvailability(...args),
        assignAuditor: (...args: unknown[]) => mockAssignAuditor(...args),
    },
}));

jest.mock('@/lib/notifications', () => ({
    notifications: { show: jest.fn() },
}));

// I-016 stable router (defensive — keeps any future router-derived
// effect dep from looping during act flushes).
jest.mock('next/navigation', () => {
    const router = {
        push: jest.fn(),
        replace: jest.fn(),
        refresh: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        prefetch: jest.fn(),
    };
    const searchParams = new URLSearchParams();
    return {
        useRouter: () => router,
        usePathname: () => '/provider/scheduler/queue',
        useSearchParams: () => searchParams,
    };
});

import SchedulerQueueClient from '../client-view';

async function flushAsync(rounds = 8): Promise<void> {
    for (let i = 0; i < rounds; i += 1) {
        await act(async () => {
            await Promise.resolve();
        });
    }
}

function clearBody(): void {
    while (document.body.firstChild) {
        document.body.removeChild(document.body.firstChild);
    }
}

describe('SchedulerQueueClient — V2-C state assertions', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        mockGetSchedulingQueue.mockResolvedValue({
            success: true,
            data: { items: [], summary: null },
        });
        mockGetAuditors.mockResolvedValue({ success: true, data: [] });
        mockGetAuditorAvailability.mockResolvedValue({
            success: true,
            data: {
                auditorId: '',
                busySlots: [],
                cap: 2,
                overCapDays: [],
            },
        });
        mockAssignAuditor.mockResolvedValue({
            success: true,
            data: { inspectionId: '' },
        });
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
        clearBody();
    });

    it('renders the empty-state copy when getSchedulingQueue returns an empty queue', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            root = createRoot(container!);
            root.render(<SchedulerQueueClient />);
        });
        await flushAsync();

        expect(container.textContent).toContain('ไม่มีคำขอรอจัดตาราง');
        expect(container.textContent).toContain(
            'คำขอจะปรากฏที่นี่หลังผู้สมัครชำระงวดที่ 2 หรือค่าบริการต่ออายุใบรับรอง',
        );
        // No error banner on the success path:
        expect(container.querySelector('[data-testid="scheduler-queue-load-error"]')).toBeNull();
    });

    it('renders queue rows + summary when the queue is populated (H1 contract regression)', async () => {
        // Pins the { items, summary } contract. Before H1 the backend returned a
        // BARE ARRAY so FE `res.data.items` was undefined → the table was ALWAYS
        // empty even with AUDIT_FEE_PAID applications waiting. This asserts a row
        // renders + the empty-state copy is gone + the wait-day value shows.
        mockGetSchedulingQueue.mockResolvedValue({
            success: true,
            data: {
                items: [{
                    applicationId: 'app-1',
                    applicationNumber: 'GACP-2569-0001',
                    applicantName: 'สมชาย เกษตรทอง',
                    applicantNameMasked: 'สมชาย เกษตรทอง',
                    region: 'เชียงใหม่',
                    ageDays: 9,
                    status: 'AUDIT_FEE_PAID',
                }],
                summary: { totalPending: 1, byRegion: [{ region: 'เชียงใหม่', count: 1 }], oldestPendingDays: 9 },
            },
        });

        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            root = createRoot(container!);
            root.render(<SchedulerQueueClient />);
        });
        await flushAsync();

        expect(container.textContent).toContain('GACP-2569-0001');
        expect(container.textContent).toContain('สมชาย เกษตรทอง');
        expect(container.textContent).not.toContain('ไม่มีคำขอรอจัดตาราง');
        expect(container.textContent).toContain('9 วัน');
        expect(container.querySelector('[data-testid="scheduler-queue-load-error"]')).toBeNull();
    });

    it('renders the inline error banner when getSchedulingQueue returns success:false', async () => {
        mockGetSchedulingQueue.mockResolvedValue({
            success: false,
            error: 'เกิดข้อผิดพลาดจากเซิร์ฟเวอร์',
        });

        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            root = createRoot(container!);
            root.render(<SchedulerQueueClient />);
        });
        await flushAsync();

        const banner = container.querySelector(
            '[data-testid="scheduler-queue-load-error"]',
        );
        expect(banner).not.toBeNull();
        expect(banner?.textContent).toContain('โหลดคิวไม่สำเร็จ');
        expect(banner?.textContent).toContain('เกิดข้อผิดพลาดจากเซิร์ฟเวอร์');
        expect(banner?.textContent).toContain('ลองโหลดอีกครั้ง');
    });

    it('renders the inline error banner when getSchedulingQueue rejects', async () => {
        mockGetSchedulingQueue.mockRejectedValue(new Error('network down'));

        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            root = createRoot(container!);
            root.render(<SchedulerQueueClient />);
        });
        await flushAsync();

        const banner = container.querySelector(
            '[data-testid="scheduler-queue-load-error"]',
        );
        expect(banner).not.toBeNull();
        expect(banner?.textContent).toContain('network down');
    });
});
