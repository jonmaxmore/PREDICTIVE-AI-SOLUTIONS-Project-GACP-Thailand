/**
 * Task 8 — a card that says "กำลังตรวจเอกสาร…" must eventually say something else.
 *
 * The pre-check runs in a queue after the upload returns, so the first answer the
 * step reads has the slot PENDING. Nothing else re-reads it: without a poll the
 * applicant would stare at "checking" until they navigated away and back. So the
 * one requirements read (useRequirementSlots) asks again every 5 s while ANY slot
 * is checking, stops the moment none is, and never outlives the step.
 *
 * Pattern: HookHarness + createRoot/act + jest fake timers (no
 * @testing-library/react in this repo).
 */
import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockFetch = jest.fn<(appId: string) => Promise<{ slots: unknown[] }>>();
jest.mock('@/lib/services/application-requirements', () => ({
    fetchApplicationRequirements: (appId: string) => mockFetch(appId),
}));

import { useRequirementSlots } from '../use-requirement-slots';

const withPrecheck = (slotId: string, status: 'PENDING' | 'DONE' | 'FAILED' | null) => ({
    slotId, labelTH: slotId, required: true, satisfied: true,
    precheck: status ? { id: `pc-${slotId}`, status, flags: [], acknowledgedAt: null } : null,
});

function HookHarness({ appId }: { appId: string }) {
    useRequirementSlots(appId);
    return null;
}

let container: HTMLDivElement;
let root: Root;

async function mount(appId: string): Promise<void> {
    await act(async () => { root.render(<HookHarness appId={appId} />); });
}

// The async variant drains promise callbacks between timers, so a read that
// answers mid-advance has finished (finally included) before the next tick fires.
async function advance(ms: number): Promise<void> {
    await act(async () => { await jest.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => {
    jest.useFakeTimers();
    mockFetch.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    jest.useRealTimers();
});

describe('polling while a slot is checking', () => {
    it('asks again every 5 s while any slot is checking, and stops once none is', async () => {
        mockFetch
            .mockResolvedValueOnce({ slots: [withPrecheck('land_rights', 'DONE'), withPrecheck('id_house_reg', 'PENDING')] })
            .mockResolvedValueOnce({ slots: [withPrecheck('land_rights', 'DONE'), withPrecheck('id_house_reg', 'PENDING')] })
            .mockResolvedValue({ slots: [withPrecheck('land_rights', 'DONE'), withPrecheck('id_house_reg', 'DONE')] });

        await mount('app-1');
        expect(mockFetch).toHaveBeenCalledTimes(1);

        await advance(4999);
        expect(mockFetch).toHaveBeenCalledTimes(1);   // not before 5 s

        await advance(1);
        expect(mockFetch).toHaveBeenCalledTimes(2);

        await advance(5000);
        expect(mockFetch).toHaveBeenCalledTimes(3);   // this answer has nothing checking

        await advance(30000);
        expect(mockFetch).toHaveBeenCalledTimes(3);   // stopped
        expect(mockFetch.mock.calls.every(([id]) => id === 'app-1')).toBe(true);
    });

    it('never polls when nothing is checking (done, failed, or no pre-check at all)', async () => {
        mockFetch.mockResolvedValue({ slots: [
            withPrecheck('land_rights', 'DONE'), withPrecheck('id_house_reg', 'FAILED'), withPrecheck('water_test', null),
        ] });

        await mount('app-1');
        await advance(30000);
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('a read slower than the interval is never overlapped by the next poll', async () => {
        const checking = { slots: [withPrecheck('land_rights', 'PENDING')] };
        let inFlight = 0;
        let maxInFlight = 0;
        mockFetch.mockImplementation(() => {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            // The first read answers at once; every later one takes 6 s.
            const delay = mockFetch.mock.calls.length === 1 ? 0 : 6000;
            return new Promise((resolve) => {
                setTimeout(() => { inFlight -= 1; resolve(checking); }, delay);
            });
        });

        await mount('app-1');
        await advance(0);
        expect(mockFetch).toHaveBeenCalledTimes(1);

        await advance(5000);                          // t=5 s: poll read #2 starts, answers at 11 s
        expect(mockFetch).toHaveBeenCalledTimes(2);

        await advance(5000);                          // t=10 s: #2 still in flight, so no #3
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(maxInFlight).toBe(1);

        await advance(5000);                          // t=15 s: #2 answered at 11 s, next poll goes
        expect(mockFetch).toHaveBeenCalledTimes(3);
        expect(maxInFlight).toBe(1);
    });

    it('stops when the step unmounts, even mid-check', async () => {
        mockFetch.mockResolvedValue({ slots: [withPrecheck('land_rights', 'PENDING')] });

        await mount('app-1');
        await advance(5000);
        expect(mockFetch).toHaveBeenCalledTimes(2);

        await act(async () => { root.unmount(); });
        root = createRoot(container);   // afterEach unmounts again; give it something harmless
        await advance(30000);
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });
});
