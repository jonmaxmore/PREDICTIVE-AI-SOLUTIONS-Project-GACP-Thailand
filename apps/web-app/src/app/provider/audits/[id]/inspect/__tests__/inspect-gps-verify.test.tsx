/**
 * inspect-gps-verify.test.tsx — Task 10 (fixes B8).
 *
 * `verifyGpsAgainstFarm` (BE) existed but the FE never called it — an
 * auditor could be nowhere near the farm and nothing flagged it. This
 * pins the wiring in `client-view.tsx`'s `startWithFix`:
 *
 *   1. Out-of-tolerance + known farm location -> a Thai warning toast
 *      naming the distance + tolerance.
 *   2. Unknown farm location (`unknownFarmLocation: true`) -> NO warning
 *      toast (nothing to compare against).
 *   3. A failed verifyGps call (`success:false`, e.g. network/500) -> NO
 *      warning toast AND the inspection is NOT blocked (stage still
 *      advances to 'checklist') — the check is best-effort telemetry,
 *      not a hard gate (the hard evidence gate is photos+checklist).
 *   4. Same as (3) but the call rejects outright (thrown/network error)
 *      instead of resolving success:false — must be equally non-fatal.
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
const mockVerifyGps = jest.fn();

jest.mock('@/lib/services/audit-service', () => ({
    AuditService: {
        getOnsiteContext: (...args: unknown[]) => mockGetOnsiteContext(...args),
        startInspection: (...args: unknown[]) => mockStartInspection(...args),
        verifyGps: (...args: unknown[]) => mockVerifyGps(...args),
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

async function flushAsync(rounds = 10): Promise<void> {
    for (let i = 0; i < rounds; i += 1) {
        await act(async () => {
            await Promise.resolve();
        });
    }
}

/** Install a navigator.geolocation stub that SUCCEEDS with a fixed fix. */
function stubGeoSuccess(lat: number, lng: number): void {
    Object.defineProperty(globalThis.navigator, 'geolocation', {
        configurable: true,
        value: {
            getCurrentPosition: (success: PositionCallback) => {
                success({
                    coords: { latitude: lat, longitude: lng, accuracy: 5 },
                } as GeolocationPosition);
            },
        },
    });
}

function showCalls(): Array<{ title?: string; message?: string; color?: string }> {
    const showMock = (notifications as unknown as { show: jest.Mock }).show;
    return showMock.mock.calls.map(([payload]) => payload as { title?: string; message?: string; color?: string });
}

describe('InspectClient — Task 10 gps-verify physical-presence check (fixes B8)', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        mockGetOnsiteContext.mockResolvedValue({ success: true, data: baseContext });
        mockStartInspection.mockResolvedValue({
            success: true,
            data: { sessionId: 'sess-1', startedAt: new Date().toISOString() },
        });
        stubGeoSuccess(18.7883, 98.9853);
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

    async function mountAndStart(): Promise<void> {
        container = document.createElement('div');
        document.body.appendChild(container);
        await act(async () => {
            root = createRoot(container!);
            root!.render(<InspectClient applicationId="aud-1" />);
        });
        await flushAsync();
        const startBtn = Array.from(container!.querySelectorAll('button')).find((b) =>
            b.textContent?.includes('เริ่มตรวจ'),
        );
        expect(startBtn).toBeTruthy();
        await act(async () => {
            startBtn!.click();
        });
        await flushAsync();
    }

    it('calls verifyGps with the just-captured fix + auditId after a successful start', async () => {
        mockVerifyGps.mockResolvedValue({
            success: true,
            data: { withinTolerance: true, unknownFarmLocation: false, distanceMeters: 3, toleranceMeters: 500, farmLatitude: 18.7883, farmLongitude: 98.9853 },
        });
        await mountAndStart();
        expect(mockVerifyGps).toHaveBeenCalledWith('aud-1', 18.7883, 98.9853);
    });

    it('shows a Thai warning toast when out of tolerance at a known farm location', async () => {
        mockVerifyGps.mockResolvedValue({
            success: true,
            data: { withinTolerance: false, unknownFarmLocation: false, distanceMeters: 842, toleranceMeters: 500, farmLatitude: 18.7883, farmLongitude: 98.9853 },
        });
        await mountAndStart();

        const warn = showCalls().find((c) => c.title === 'เตือน: อยู่นอกรัศมีฟาร์ม');
        expect(warn).toBeTruthy();
        expect(warn?.message).toContain('842');
        expect(warn?.message).toContain('500');
        expect(warn?.color).toBe('orange');
    });

    it('does NOT warn when the farm location is unknown, even if withinTolerance is false', async () => {
        mockVerifyGps.mockResolvedValue({
            success: true,
            data: { withinTolerance: false, unknownFarmLocation: true, distanceMeters: null, toleranceMeters: 500, farmLatitude: null, farmLongitude: null },
        });
        await mountAndStart();

        const warn = showCalls().find((c) => c.title === 'เตือน: อยู่นอกรัศมีฟาร์ม');
        expect(warn).toBeUndefined();
    });

    it('does NOT warn and does NOT block the inspection when verifyGps itself fails (network/500)', async () => {
        mockVerifyGps.mockResolvedValue({ success: false, error: 'Unable to connect to server' });
        await mountAndStart();

        const warn = showCalls().find((c) => c.title === 'เตือน: อยู่นอกรัศมีฟาร์ม');
        expect(warn).toBeUndefined();
        // Advisory-only: the inspection must still proceed to the checklist
        // stage (its progress bar renders only in that stage).
        expect(container!.querySelector('[data-testid="inspect-progress-bar"]')).toBeTruthy();
    });

    it('does NOT warn and does NOT block the inspection when verifyGps rejects outright', async () => {
        mockVerifyGps.mockRejectedValue(new Error('boom'));
        await mountAndStart();

        const warn = showCalls().find((c) => c.title === 'เตือน: อยู่นอกรัศมีฟาร์ม');
        expect(warn).toBeUndefined();
        expect(container!.querySelector('[data-testid="inspect-progress-bar"]')).toBeTruthy();
    });
});
