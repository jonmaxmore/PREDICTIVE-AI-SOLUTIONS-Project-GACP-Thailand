/**
 * gps-fallback.test.tsx — V3-B DM-4 mobile-critical fix.
 *
 * The auditor lands on `/provider/audits/[id]/inspect`. In a low-signal
 * greenhouse or indoor facility, `navigator.geolocation` rejects with
 * PERMISSION_DENIED / POSITION_UNAVAILABLE / TIMEOUT — before this
 * fix the auditor was hard-stopped: the error rendered as a toast and
 * an inline alert, with no fallback affordance.
 *
 * What we assert:
 *   1. After a GPS error, the inline alert renders a Thai
 *      "ใช้พิกัดที่อยู่ฟาร์มแทน" button when the audit context exposes
 *      `farmLat` + `farmLng`.
 *   2. Clicking the fallback button calls AuditService.startInspection
 *      with the farm's registered coordinates and an explanatory
 *      success toast.
 *   3. The fallback affordance is NOT rendered when the application
 *      predates the location-data field (no farm coordinates). The
 *      auditor sees a Thai instruction to contact the admin instead —
 *      they are still hard-stopped, but at least the failure mode is
 *      explained.
 *
 * I-016 — `next/navigation` is stabilised at the global jest.setup
 * level; this client doesn't read router-derived state, so no per-file
 * factory override is needed.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {

    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockGetOnsiteContext = jest.fn();
const mockStartInspection = jest.fn();

jest.mock('@/lib/services/audit-service', () => ({
    AuditService: {
        getOnsiteContext: (...args: unknown[]) => mockGetOnsiteContext(...args),
        startInspection: (...args: unknown[]) => mockStartInspection(...args),
        // Task 10: startWithFix calls verifyGps right after a successful
        // start. This suite doesn't exercise the fraud-check path itself
        // (see inspect-gps-verify.test.tsx) — resolve `success:false` so
        // the advisory toast never fires and existing assertions here
        // stay unaffected.
        verifyGps: jest.fn().mockResolvedValue({ success: false }),
        submitChecklistItem: jest.fn(),
        uploadPhoto: jest.fn(),
        submitDecision: jest.fn(),
    },
}));

jest.mock('@/lib/notifications', () => ({
    notifications: { show: jest.fn() },
}));

import InspectClient from '../client-view';
import { notifications } from '@/lib/notifications';

const baseContext = {
    audit: {
        id: 'aud-1',
        applicationId: 'app-1',
        applicationNumber: 'GACP-2026-0042',
        applicantName: 'นาย เกษตรกร ทดสอบ',
        farmAddress: '123 ม.4 ต.ทดสอบ อ.ทดสอบ จ.เชียงใหม่',
        farmLat: 18.7883,
        farmLng: 98.9853,
    },
    checklist: [
        {
            itemId: 'item-1',
            title: 'การใช้สารเคมีเกษตร',
            description: 'ไม่มีการใช้สารเคมีต้องห้าม',
            required: true,
        },
    ],
    savedAnswers: [],
};

async function flushAsync(rounds = 8): Promise<void> {
    for (let i = 0; i < rounds; i += 1) {
        await act(async () => {
            await Promise.resolve();
        });
    }
}

/**
 * Install a navigator.geolocation stub that REJECTS with the supplied
 * PositionError. Mirrors the browser shape closely enough for the
 * client-view's reject handler to read `.message`.
 */
function stubGeoError(message: string): void {
    Object.defineProperty(globalThis.navigator, 'geolocation', {
        configurable: true,
        value: {
            getCurrentPosition: (
                _success: PositionCallback,
                error?: PositionErrorCallback,
            ) => {
                if (error) {
                    error({
                        code: 1,
                        message,
                        PERMISSION_DENIED: 1,
                        POSITION_UNAVAILABLE: 2,
                        TIMEOUT: 3,
                    } as GeolocationPositionError);
                }
            },
        },
    });
}

describe('InspectClient — V3-B DM-4 GPS fallback', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        mockGetOnsiteContext.mockResolvedValue({
            success: true,
            data: baseContext,
        });
        mockStartInspection.mockResolvedValue({
            success: true,
            data: { sessionId: 'sess-1', startedAt: new Date().toISOString() },
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
    });

    it('renders the "ใช้พิกัดที่อยู่ฟาร์มแทน" fallback after a GPS denial when farm coords exist', async () => {
        stubGeoError('User denied geolocation');

        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            root = createRoot(container!);
            root.render(<InspectClient applicationId="aud-1" />);
        });
        await flushAsync();

        // Click the primary "เริ่มตรวจ" button to trigger captureGps.
        const startBtn = Array.from(
            container!.querySelectorAll('button'),
        ).find((b) => b.textContent?.includes('เริ่มตรวจ'));
        expect(startBtn).toBeTruthy();

        await act(async () => {
            startBtn!.click();
        });
        await flushAsync();

        const fallbackBtn = container!.querySelector(
            '[data-testid="gps-fallback-button"]',
        ) as HTMLButtonElement | null;
        expect(fallbackBtn).toBeTruthy();
        expect(fallbackBtn?.textContent).toContain('ใช้พิกัดที่อยู่ฟาร์มแทน');
        // WCAG 2.5.5 — Tailwind min-h-[44px] is rendered as an inline
        // class; check the className includes the modifier rather than
        // a computed style (jsdom doesn't apply Tailwind).
        expect(fallbackBtn?.className).toMatch(/min-h-\[44px\]/);

        // The inline alert should also surface the Thai explanation
        // about greenhouses / low-signal.
        expect(container!.textContent).toContain('โรงเรือน');
    });

    it('submits the farm coordinates when the fallback button is clicked', async () => {
        stubGeoError('Timeout expired');

        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            root = createRoot(container!);
            root.render(<InspectClient applicationId="aud-1" />);
        });
        await flushAsync();

        const startBtn = Array.from(
            container!.querySelectorAll('button'),
        ).find((b) => b.textContent?.includes('เริ่มตรวจ'));
        await act(async () => {
            startBtn!.click();
        });
        await flushAsync();

        const fallbackBtn = container!.querySelector(
            '[data-testid="gps-fallback-button"]',
        ) as HTMLButtonElement | null;
        expect(fallbackBtn).toBeTruthy();

        await act(async () => {
            fallbackBtn!.click();
        });
        await flushAsync();

        // startInspection must have been called with the farm's
        // registered coordinates (accuracy = 0 marks the synthetic fix).
        expect(mockStartInspection).toHaveBeenCalledWith(
            'aud-1',
            expect.objectContaining({
                latitude: 18.7883,
                longitude: 98.9853,
                accuracy: 0,
            }),
        );

        // A Thai success toast distinguishes the fallback path from
        // the normal GPS path.
        const showMock = (notifications as unknown as {
            show: jest.Mock;
        }).show;
        const sawFallbackToast = showMock.mock.calls.some(([payload]) => {
            const p = payload as { message?: string };
            return typeof p?.message === 'string'
                && p.message.includes('พิกัดที่อยู่ฟาร์ม');
        });
        expect(sawFallbackToast).toBe(true);
    });

    it('hides the fallback button when farm coordinates are not registered (legacy application)', async () => {
        mockGetOnsiteContext.mockResolvedValue({
            success: true,
            data: {
                ...baseContext,
                audit: {
                    ...baseContext.audit,
                    farmLat: undefined,
                    farmLng: undefined,
                },
            },
        });
        stubGeoError('Permission denied');

        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            root = createRoot(container!);
            root.render(<InspectClient applicationId="aud-1" />);
        });
        await flushAsync();

        const startBtn = Array.from(
            container!.querySelectorAll('button'),
        ).find((b) => b.textContent?.includes('เริ่มตรวจ'));
        await act(async () => {
            startBtn!.click();
        });
        await flushAsync();

        const fallbackBtn = container!.querySelector(
            '[data-testid="gps-fallback-button"]',
        );
        expect(fallbackBtn).toBeNull();

        // The alert still explains why the auditor is stuck.
        expect(container!.textContent).toContain(
            'ฟาร์มยังไม่ได้บันทึกพิกัดในใบสมัคร',
        );
    });
});
