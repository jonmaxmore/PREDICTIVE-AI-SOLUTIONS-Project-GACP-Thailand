/**
 * workload-layout.test.tsx — Phase 1C scheduler work-distribution view.
 *
 * Mirrors reassign-layout.test.tsx (createRoot + act; no @testing-library).
 * Asserts:
 *   1. Layout — outer container is widened (max-w-7xl), no max-w-sm regression.
 *   2. Data render — fairness rows + the HONEST throughput column label, fed
 *      entirely from res.data (apiClient envelope-strip — no sibling fields).
 *   3. Honest-metric guard — the page states the number is "not current load"
 *      and never labels it ภาระงานปัจจุบัน / current load.
 *   4. Empty state.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {

  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockGet = jest.fn();

jest.mock('@/lib/api/api-client', () => ({
    apiClient: { get: (...args: unknown[]) => mockGet(...args) },
}));

jest.mock('@/lib/notifications', () => ({
    notifications: { show: jest.fn() },
}));

jest.mock('next/navigation', () => {
    const router = {
        push: jest.fn(), replace: jest.fn(), refresh: jest.fn(),
        back: jest.fn(), forward: jest.fn(), prefetch: jest.fn(),
    };
    return {
        useRouter: () => router,
        usePathname: () => '/provider/scheduler/workload',
        useSearchParams: () => new URLSearchParams(),
    };
});

import SchedulerWorkloadPage from '../page';

async function flushAsync(rounds = 8): Promise<void> {
    for (let i = 0; i < rounds; i += 1) {
        await act(async () => { await Promise.resolve(); });
    }
}

function clearBody(): void {
    while (document.body.firstChild) {
        document.body.removeChild(document.body.firstChild);
    }
}

// Default mock: one fairness row + one reassignment. All payload nested under
// `data` (the backend contract — apiClient returns body.data on the success path).
function mockPopulated() {
    mockGet.mockImplementation(async (url: string) => {
        if (url.startsWith('/provider/ledger/fairness')) {
            return {
                success: true,
                data: {
                    metric: 'assignments_given',
                    people: 1,
                    totalAssignments: 5,
                    rows: [{ assigneeUserId: 'u-1', assigneeName: 'Anna Auditor', role: 'field_inspector', assignmentsGivenInWindow: 5 }],
                    window: { days: 30 },
                },
            };
        }
        if (url.startsWith('/provider/ledger/reassignments')) {
            return {
                success: true,
                data: {
                    events: [{
                        id: 'r-1', createdAt: '2026-06-10T03:00:00Z',
                        assigneeName: 'Anna Auditor', previousAssigneeName: 'Bob Auditor',
                        assignedByName: 'Sam Scheduler', reason: 'งานล่าช้า', source: 'dispatcher',
                    }],
                },
            };
        }
        return { success: true, data: {} };
    });
}

describe('SchedulerWorkloadPage — Phase 1C', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => { jest.clearAllMocks(); });

    afterEach(() => {
        if (root) { act(() => { root?.unmount(); }); root = null; }
        if (container) { container.remove(); container = null; }
        clearBody();
    });

    async function render() {
        container = document.createElement('div');
        document.body.appendChild(container);
        await act(async () => {
            root = createRoot(container!);
            root.render(<SchedulerWorkloadPage />);
        });
        await flushAsync();
    }

    it('layout: container is widened (max-w-7xl) with no max-w-sm regression', async () => {
        mockPopulated();
        await render();
        expect(container!.querySelectorAll('.max-w-7xl').length).toBeGreaterThanOrEqual(1);
        expect(container!.querySelectorAll('.max-w-sm').length).toBe(0);
    });

    it('renders fairness rows fed from res.data, with the assignee + count', async () => {
        mockPopulated();
        await render();
        expect(container!.textContent).toContain('Anna Auditor');
        expect(container!.textContent).toContain('การมอบหมายใหม่ล่าสุด');
        expect(container!.textContent).toContain('Bob Auditor'); // previous assignee in reassignments
    });

    it('honest metric: labels the count as "งานที่ได้รับมอบหมาย" and states it is NOT current load', async () => {
        mockPopulated();
        await render();
        expect(container!.textContent).toContain('งานที่ได้รับมอบหมาย');
        // Must explicitly disclaim current-load semantics, and never use that label.
        expect(container!.textContent).toContain('ไม่ใช่จำนวนงานค้างปัจจุบัน');
        expect(container!.textContent).not.toContain('ภาระงานปัจจุบัน');
    });

    it('empty state: renders the no-data Alert when fairness has no rows', async () => {
        mockGet.mockImplementation(async (url: string) => {
            if (url.startsWith('/provider/ledger/fairness')) {
                return { success: true, data: { metric: 'assignments_given', people: 0, totalAssignments: 0, rows: [] } };
            }
            return { success: true, data: { events: [] } };
        });
        await render();
        expect(container!.textContent).toContain('ยังไม่มีการมอบหมายงานในช่วงเวลานี้');
    });
});
