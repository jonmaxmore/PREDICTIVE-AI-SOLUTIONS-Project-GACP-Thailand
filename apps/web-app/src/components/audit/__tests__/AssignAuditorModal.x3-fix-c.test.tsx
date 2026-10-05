/**
 * AssignAuditorModal.x3-fix-c.test.tsx — Loop X Iter 3 (X3-FIX-C).
 *
 * Covers two H-class fixes on the SCHEDULER's primary assignment modal:
 *
 *   1. H-12 — the 14-day availability widget previously declared
 *      `role="grid"` but the children were bare `<button>`s without
 *      `role="gridcell"` or `role="row"` grouping. That's a broken ARIA
 *      contract: screen readers announce a grid but the keyboard
 *      navigation pattern (arrow Up/Down/Left/Right, Home/End) isn't
 *      wired. X3-FIX-C drops the broken claim to `role="group"` — we
 *      keep the `aria-label="ปฏิทินผู้ตรวจ 14 วัน"` so the widget is
 *      still labelled, just not as a grid we don't actually implement.
 *      A future Radix Calendar migration can re-add real grid roles.
 *   2. H-11 — the date input is the first interactive control after
 *      the dialog title. Pre-X3 a keyboard user had to Tab past the
 *      title before they could pick a date. The fix adds `autoFocus`
 *      so opening the modal lands on the date picker.
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

function clearBody(): void {
    while (document.body.firstChild) {
        document.body.removeChild(document.body.firstChild);
    }
}

describe('AssignAuditorModal — X3-FIX-C H-11 / H-12 a11y', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        mockGetAuditors.mockResolvedValue({
            success: true,
            data: [{ id: 'aud-1', fullName: 'นาย ทดสอบ ใจดี' }],
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

    it('H-12: the 14-day availability widget no longer declares role="grid"', async () => {
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

        // Pick an auditor so the calendar block renders.
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

        // The widget should be present and labelled, but NOT as a grid.
        const calendarWidget = document.querySelector(
            '[aria-label="ปฏิทินผู้ตรวจ 14 วัน"]',
        );
        expect(calendarWidget).not.toBeNull();
        expect(calendarWidget!.getAttribute('role')).toBe('group');
        // Locked: no false grid contract anywhere on the calendar.
        expect(calendarWidget!.getAttribute('role')).not.toBe('grid');
        // No cell falsely claims gridcell either (the fix is "honest
        // about capability" — we don't implement the role contract).
        const fakeGridCells = calendarWidget!.querySelectorAll(
            '[role="gridcell"]',
        );
        expect(fakeGridCells.length).toBe(0);
    });

    it('H-11: the date input is focused when the modal opens', async () => {
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

        const dateInput = document.getElementById('assign-date') as HTMLInputElement | null;
        expect(dateInput).not.toBeNull();
        expect(document.activeElement).toBe(dateInput);
    });
});
