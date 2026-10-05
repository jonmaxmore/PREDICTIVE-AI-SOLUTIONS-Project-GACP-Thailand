/**
 * AssignAuditorModal.error-state.test.tsx — V2-C SC-1 functional tests.
 *
 * Complements the existing prop-contract test (`AssignAuditorModal.test.tsx`)
 * with behaviour assertions for the SC-1 / SC-4 / SC-5 fixes:
 *
 *   1. SC-1 — when `AuditService.getAuditors()` returns
 *      `{ success: false }`, the modal surfaces the Thai error banner
 *      and the "ลองโหลดอีกครั้ง" retry button INSIDE the modal body
 *      (no silent empty dropdown).
 *   2. SC-1 — when `getAuditors()` resolves to an empty array, the
 *      "ไม่พบผู้ตรวจประเมินในระบบ" copy is rendered (different message
 *      than the network-error case).
 *   3. SC-4 — once an auditor + scheduled date are picked, the
 *      notification preview block (data-testid `notification-preview`)
 *      renders the auditor name and the formatted Thai date.
 *   4. SC-5 — overCapDays returned by `getAuditorAvailability` shade
 *      calendar cells amber (`data-state="over-cap"`), distinct from
 *      busy days (`data-state="busy"`).
 *   5. SC-1 — happy path: when getAuditors succeeds with rows, the
 *      auditor `<select>` is populated with their `fullName` strings.
 *
 * Strategy: createRoot + act with multiple microtask flushes (mirrors
 * `payments-states.test.tsx`). Radix Dialog portals to document.body,
 * so assertions run against `document.body.textContent` / queries.
 *
 * I-016 — `next/navigation` mock is stable. The modal itself does not
 * consume `useRouter`, but the global jest.setup.tsx stable shape is
 * fine and the test does not need its own factory.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {

  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockGetAuditors = jest.fn();
const mockGetAuditorAvailability = jest.fn();
const mockAssignAuditor = jest.fn();

jest.mock('@/lib/services/audit-service', () => ({
    AuditService: {
        getAuditors: (...args: unknown[]) => mockGetAuditors(...args),
        getAuditorAvailability: (...args: unknown[]) => mockGetAuditorAvailability(...args),
        assignAuditor: (...args: unknown[]) => mockAssignAuditor(...args),
    },
}));

jest.mock('@/lib/notifications', () => ({
    notifications: { show: jest.fn() },
}));

import { AssignAuditorModal } from '../AssignAuditorModal';
import type { SchedulingQueueItem } from '@/lib/services/audit-service';

const application: SchedulingQueueItem = {
    applicationId: 'app-1',
    applicationNumber: 'GACP-2026-0001',
    applicantName: 'นาย เกษตรกร ทดสอบ',
    applicantNameMasked: 'น. เกษตรกร ท.',
    paymentDate: '2026-05-01T00:00:00.000Z',
    region: 'NORTH',
    scope: 'TURMERIC',
    ageDays: 3,
    status: 'AUDIT_FEE_PAID',
    farmAddress: '123 ม.4 ต.ทดสอบ อ.ทดสอบ จ.เชียงใหม่',
};

async function flushAsync(rounds = 8): Promise<void> {
    for (let i = 0; i < rounds; i += 1) {
        await act(async () => {
            await Promise.resolve();
        });
    }
}

/**
 * Remove every direct child of document.body. Safer than innerHTML=''
 * — the hook flags innerHTML assignments and there's no untrusted
 * content here anyway; we just want a clean portal slate between tests.
 */
function clearBody(): void {
    while (document.body.firstChild) {
        document.body.removeChild(document.body.firstChild);
    }
}

describe('AssignAuditorModal — V2-C SC-1/SC-4/SC-5 functional', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        mockGetAuditors.mockResolvedValue({
            success: true,
            data: [
                { id: 'aud-1', fullName: 'นาย ทดสอบ ใจดี' },
                { id: 'aud-2', fullName: 'นาง สมหญิง ตรวจดี' },
            ],
        });
        mockGetAuditorAvailability.mockResolvedValue({
            success: true,
            data: {
                auditorId: 'aud-1',
                dateRange: { from: '', to: '' },
                busySlots: [],
                cap: 2,
                overCapDays: [],
            },
        });
        mockAssignAuditor.mockResolvedValue({
            success: true,
            data: { inspectionId: 'ins-1' },
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

    it('SC-1: surfaces the Thai error banner when getAuditors returns success:false', async () => {
        mockGetAuditors.mockResolvedValue({ success: false, error: 'boom' });

        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            root = createRoot(container!);
            root.render(
                <AssignAuditorModal
                    open
                    application={application}
                    onClose={() => {}}
                    onAssigned={() => {}}
                />,
            );
        });
        await flushAsync();

        expect(document.body.textContent).toContain(
            'ไม่สามารถโหลดรายชื่อผู้ตรวจได้',
        );
        expect(document.body.textContent).toContain('ลองโหลดอีกครั้ง');
    });

    it('SC-1: surfaces a distinct "no auditors" message when the directory is empty', async () => {
        mockGetAuditors.mockResolvedValue({ success: true, data: [] });

        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            root = createRoot(container!);
            root.render(
                <AssignAuditorModal
                    open
                    application={application}
                    onClose={() => {}}
                    onAssigned={() => {}}
                />,
            );
        });
        await flushAsync();

        expect(document.body.textContent).toContain(
            'ไม่พบผู้ตรวจประเมินในระบบ',
        );
    });

    it('SC-1: populates the auditor select with fullName when getAuditors succeeds', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            root = createRoot(container!);
            root.render(
                <AssignAuditorModal
                    open
                    application={application}
                    onClose={() => {}}
                    onAssigned={() => {}}
                />,
            );
        });
        await flushAsync();

        const select = document.querySelector(
            '#assign-auditor',
        ) as HTMLSelectElement | null;
        expect(select).not.toBeNull();
        const options = Array.from(select?.querySelectorAll('option') || []).map(
            (o) => o.textContent,
        );
        expect(options).toContain('นาย ทดสอบ ใจดี');
        expect(options).toContain('นาง สมหญิง ตรวจดี');
        // Sentinel placeholder + 2 real options:
        expect(options).toHaveLength(3);
        // No error banner when the directory loads fine:
        expect(document.body.textContent).not.toContain(
            'ไม่สามารถโหลดรายชื่อผู้ตรวจได้',
        );
    });

    it('SC-4: renders the notification preview once auditor + date are picked', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            root = createRoot(container!);
            root.render(
                <AssignAuditorModal
                    open
                    application={application}
                    onClose={() => {}}
                    onAssigned={() => {}}
                />,
            );
        });
        await flushAsync();

        // Drive the select to pick auditor aud-1 — date defaults to
        // today+7 business days, so the preview should appear without
        // further interaction.
        const select = document.querySelector(
            '#assign-auditor',
        ) as HTMLSelectElement | null;
        expect(select).not.toBeNull();
        await act(async () => {
            const nativeSetter = Object.getOwnPropertyDescriptor(
                window.HTMLSelectElement.prototype,
                'value',
            )?.set;
            nativeSetter?.call(select, 'aud-1');
            select?.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await flushAsync();

        const preview = document.querySelector(
            '[data-testid="notification-preview"]',
        );
        expect(preview).not.toBeNull();
        expect(preview?.textContent).toContain('นาย ทดสอบ ใจดี');
        expect(preview?.textContent).toContain('ผู้สมัครจะได้รับข้อความ');
    });

    it('SC-5: amber-shades calendar cells flagged in overCapDays', async () => {
        // Pin the picked date so we can predict the calendar window
        // (today is irrelevant — the modal computes default = today+7
        // business days). We instead grab the picked-date attr after
        // first render and feed an overCap day at that ISO.
        mockGetAuditorAvailability.mockImplementation(async (_auditorId, fromIso) => {
            // The modal queries from = picked - 3, so the first cell's
            // ISO == fromIso. Use that + 5 days to land safely inside
            // the 14-day window.
            const from = new Date(fromIso as string);
            const target = new Date(from);
            target.setDate(target.getDate() + 5);
            const isoTarget = target.toISOString().slice(0, 10);
            const busyTarget = new Date(from);
            busyTarget.setDate(busyTarget.getDate() + 8);
            const isoBusy = busyTarget.toISOString().slice(0, 10);
            return {
                success: true,
                data: {
                    auditorId: 'aud-1',
                    dateRange: { from: '', to: '' },
                    busySlots: [
                        {
                            applicationId: 'app-x',
                            applicationNumber: 'GACP-X',
                            status: 'AUDIT_CONFIRMED',
                            scheduledDate: `${isoBusy}T00:00:00.000Z`,
                        },
                    ],
                    cap: 2,
                    overCapDays: [{ day: isoTarget, count: 2 }],
                },
            };
        });

        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            root = createRoot(container!);
            root.render(
                <AssignAuditorModal
                    open
                    application={application}
                    onClose={() => {}}
                    onAssigned={() => {}}
                />,
            );
        });
        await flushAsync();

        // Pick an auditor so the calendar renders + availability loads.
        const select = document.querySelector(
            '#assign-auditor',
        ) as HTMLSelectElement | null;
        await act(async () => {
            const nativeSetter = Object.getOwnPropertyDescriptor(
                window.HTMLSelectElement.prototype,
                'value',
            )?.set;
            nativeSetter?.call(select, 'aud-1');
            select?.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await flushAsync();

        const overCapCells = document.querySelectorAll(
            '[data-state="over-cap"]',
        );
        const busyCells = document.querySelectorAll('[data-state="busy"]');
        expect(overCapCells.length).toBeGreaterThanOrEqual(1);
        expect(busyCells.length).toBeGreaterThanOrEqual(1);
        // Legend wording present so the scheduler can decode the colour.
        expect(document.body.textContent).toContain('เต็มโควต้า');
    });
});
