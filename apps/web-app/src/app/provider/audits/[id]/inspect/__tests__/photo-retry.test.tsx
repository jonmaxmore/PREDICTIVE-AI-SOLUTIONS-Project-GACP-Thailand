/**
 * photo-retry.test.tsx — V3-B mobile network-tolerance fix.
 *
 * On a flaky 3G connection (typical field auditor environment), the
 * inspect flow's photo upload could silently drop the file: the catch
 * block flashed a toast that scrolled away in 4 s with no way to
 * re-submit. The auditor was left believing the evidence was attached
 * when it wasn't.
 *
 * V3-B keeps a per-item failed-photo list. The ChecklistScreen renders
 * an amber alert per checklist item, with a "ลองอีกครั้ง" (retry) and
 * "ยกเลิก" (discard) button — both ≥44px tap targets per WCAG 2.5.5.
 *
 * What we assert:
 *   1. A failed upload surfaces a retry pill with the file name + the
 *      raw error message + the Thai "อัปโหลดภาพไม่สำเร็จ" header.
 *   2. Clicking "ลองอีกครั้ง" re-invokes AuditService.uploadPhoto with
 *      the same File reference; on success the pill is removed and
 *      the photo is appended to the checklist item's `photos`.
 *   3. Both retry + discard buttons satisfy WCAG 2.5.5 (≥44 px).
 *
 * Strategy: we need to drive the InspectClient through the start phase
 * into the checklist phase. The cleanest path is to seed the context
 * with `startedAt` so the client jumps straight to 'checklist' on
 * mount — bypassing the GPS capture entirely.
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
const mockUploadPhoto = jest.fn();

jest.mock('@/lib/services/audit-service', () => ({
    AuditService: {
        getOnsiteContext: (...args: unknown[]) => mockGetOnsiteContext(...args),
        startInspection: jest.fn(),
        // Task 10: startWithFix (unreached here — seededContext.startedAt
        // skips straight to 'checklist') now calls verifyGps too; keep the
        // double's shape complete regardless.
        verifyGps: jest.fn().mockResolvedValue({ success: false }),
        submitChecklistItem: jest.fn().mockResolvedValue({ success: true }),
        uploadPhoto: (...args: unknown[]) => mockUploadPhoto(...args),
        submitDecision: jest.fn(),
    },
}));

jest.mock('@/lib/notifications', () => ({
    notifications: { show: jest.fn() },
}));

import InspectClient from '../client-view';

const seededContext = {
    audit: {
        id: 'aud-1',
        applicationId: 'app-1',
        applicationNumber: 'GACP-2026-0042',
        applicantName: 'นาย เกษตรกร ทดสอบ',
        farmAddress: '123 ม.4',
        farmLat: 18.78,
        farmLng: 98.98,
    },
    checklist: [
        {
            itemId: 'item-a',
            title: 'การใช้สารเคมีเกษตร',
            description: 'ไม่มีการใช้สารเคมีต้องห้าม',
        },
    ],
    // startedAt is non-empty — InspectClient skips the StartScreen and
    // mounts the ChecklistScreen directly.
    startedAt: new Date('2026-05-01T08:00:00Z').toISOString(),
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
 * Fire a `change` event on the hidden file input inside the rendered
 * ChecklistItem. We can't construct a real FileList in jsdom, so we
 * stub the input.files getter with a 1-file array.
 */
function attachPhoto(container: HTMLElement, file: File): void {
    const input = container.querySelector(
        'input[type="file"]',
    ) as HTMLInputElement | null;
    if (!input) throw new Error('no file input found');
    Object.defineProperty(input, 'files', {
        configurable: true,
        value: [file] as unknown as FileList,
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * A RESUMED visit (seededContext.startedAt is set, so the client lands on the checklist
 * without pressing start) must still have a position before it can attach a photograph —
 * every photograph is bound to where it was taken, and since 2026-08-27 both the client
 * (re-acquire on resume, and again before the first upload if none is held) and the
 * server (PHOTO_GPS_REQUIRED, 400) enforce it. Before that date this suite uploaded with
 * gps === null and nothing objected, which was the defect. jsdom has no geolocation, so the
 * fixture supplies a succeeding stub exactly as inspect-gps-verify.test.tsx does; without
 * it, every upload here would now correctly be refused before the network was touched.
 */
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

describe('InspectClient — V3-B photo retry on upload failure', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        stubGeoSuccess(18.796143, 98.953608);
        mockGetOnsiteContext.mockResolvedValue({
            success: true,
            data: seededContext,
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

    it('surfaces a retry pill when uploadPhoto fails (does not silently swallow)', async () => {
        mockUploadPhoto.mockResolvedValue({
            success: false,
            error: 'network timeout',
        });

        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            root = createRoot(container!);
            root.render(<InspectClient applicationId="aud-1" />);
        });
        await flushAsync();

        const file = new File(['x'], 'farm-1.jpg', { type: 'image/jpeg' });
        await act(async () => {
            attachPhoto(container!, file);
        });
        await flushAsync();

        const alertEl = container!.querySelector(
            '[data-testid="failed-photos-item-a"]',
        );
        expect(alertEl).toBeTruthy();
        expect(alertEl?.textContent).toContain('อัปโหลดภาพไม่สำเร็จ');
        expect(alertEl?.textContent).toContain('farm-1.jpg');
        expect(alertEl?.textContent).toContain('network timeout');

        const retryBtn = alertEl!.querySelector(
            'button[data-testid^="retry-photo-"]',
        ) as HTMLButtonElement | null;
        expect(retryBtn).toBeTruthy();
        expect(retryBtn?.textContent).toContain('ลองอีกครั้ง');
        // WCAG 2.5.5 ≥44px tap target — Tailwind min-h-[44px] class.
        expect(retryBtn?.className).toMatch(/min-h-\[44px\]/);

        const discardBtn = alertEl!.querySelector(
            'button[data-testid^="discard-photo-"]',
        ) as HTMLButtonElement | null;
        expect(discardBtn?.className).toMatch(/min-h-\[44px\]/);
    });

    it('removes the retry pill and appends the photo when retry succeeds', async () => {
        mockUploadPhoto.mockResolvedValueOnce({
            success: false,
            error: 'network timeout',
        });

        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            root = createRoot(container!);
            root.render(<InspectClient applicationId="aud-1" />);
        });
        await flushAsync();

        const file = new File(['x'], 'farm-2.jpg', { type: 'image/jpeg' });
        await act(async () => {
            attachPhoto(container!, file);
        });
        await flushAsync();

        // First upload failed — pill is up.
        let alertEl = container!.querySelector(
            '[data-testid="failed-photos-item-a"]',
        );
        expect(alertEl).toBeTruthy();

        // Arm the retry call to succeed this time.
        mockUploadPhoto.mockResolvedValueOnce({
            success: true,
            data: { photoId: 'photo-99', url: '/storage/photo-99.jpg' },
        });

        const retryBtn = alertEl!.querySelector(
            'button[data-testid^="retry-photo-"]',
        ) as HTMLButtonElement | null;
        await act(async () => {
            retryBtn!.click();
        });
        await flushAsync();

        // Retry call was made with the same File instance.
        expect(mockUploadPhoto).toHaveBeenCalledTimes(2);
        const secondCallArgs = mockUploadPhoto.mock.calls[1] as [
            string,
            File,
            unknown,
        ];
        expect(secondCallArgs[0]).toBe('aud-1');
        expect(secondCallArgs[1]).toBe(file);

        // Pill is gone after the success.
        alertEl = container!.querySelector(
            '[data-testid="failed-photos-item-a"]',
        );
        expect(alertEl).toBeNull();

        // Photo count on the checklist item shows 1.
        expect(container!.textContent).toContain('ภาพถ่ายหลักฐาน (1)');
        expect(container!.textContent).toContain('farm-2.jpg');
    });

    it('discards the failed photo without invoking uploadPhoto when discard is clicked', async () => {
        mockUploadPhoto.mockResolvedValue({
            success: false,
            error: 'too big',
        });

        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            root = createRoot(container!);
            root.render(<InspectClient applicationId="aud-1" />);
        });
        await flushAsync();

        const file = new File(['x'], 'huge.jpg', { type: 'image/jpeg' });
        await act(async () => {
            attachPhoto(container!, file);
        });
        await flushAsync();

        const alertEl = container!.querySelector(
            '[data-testid="failed-photos-item-a"]',
        );
        expect(alertEl).toBeTruthy();

        const discardBtn = alertEl!.querySelector(
            'button[data-testid^="discard-photo-"]',
        ) as HTMLButtonElement | null;

        // Capture call count BEFORE the discard to assert it does not grow.
        const callsBefore = mockUploadPhoto.mock.calls.length;
        await act(async () => {
            discardBtn!.click();
        });
        await flushAsync();

        expect(mockUploadPhoto.mock.calls.length).toBe(callsBefore);
        expect(
            container!.querySelector('[data-testid="failed-photos-item-a"]'),
        ).toBeNull();
    });
});
