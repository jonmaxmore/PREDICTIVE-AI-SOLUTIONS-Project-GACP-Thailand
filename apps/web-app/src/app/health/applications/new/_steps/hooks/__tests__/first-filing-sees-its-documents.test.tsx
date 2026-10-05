/**
 * A filing that has not been saved yet has not FAILED — and it must still end up
 * showing its documents.
 *
 * Walked on the live demo 2026-09-07 with five freshly registered accounts
 * (evidence/apple-qa-audit-2026-09-07). On the first application an account ever
 * opens, step 2 renders:
 *
 *     role=alert  "ระบบอ่านรายการเอกสารของคำขอนี้ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง
 *                  หรือย้อนกลับหนึ่งขั้นแล้วกลับมาใหม่"
 *     slot cards  0
 *
 * Nothing had failed. There is simply no application id yet: the draft row is
 * created by the autosave debounce, which cannot fire before the applicant types.
 * `useRequirementSlots` called that state a failed read — the right instinct
 * (never claim "no documents needed" on a failed read, see the hook's own header)
 * applied to the wrong case.
 *
 * Two consequences, both measured on the wire:
 *  - the first thing a new farmer is told is that the system is broken, and the
 *    advice it gives ("go back one step and come back") changes nothing;
 *  - `/applications/<id>/requirements` was never requested after
 *    `POST /applications/draft` returned the id, so the papers never appeared at
 *    all in that session — slot cards stayed at 0.
 *
 * So the hook needs a third state, and it needs to ask again the moment the
 * filing becomes askable.
 *
 * Pattern: HookHarness + createRoot/act — this repo has no
 * @testing-library/react-hooks; mirrors src/lib/navigation/__tests__/use-nav-chips.test.tsx.
 */
import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockFetch = jest.fn<(appId: string) => Promise<{ slots: unknown[] }>>();
jest.mock('@/lib/services/application-requirements', () => ({
    fetchApplicationRequirements: (appId: string) => mockFetch(appId),
}));

import { useRequirementSlots, SLOTS_ERROR_TH, type RequirementSlotsState } from '../use-requirement-slots';

const SLOT = { slotId: 'id_card', required: true, satisfied: false, label: 'สำเนาบัตรประชาชน' };

function HookHarness({ appId, onChange }: { appId: string; onChange: (v: RequirementSlotsState) => void }) {
    const value = useRequirementSlots(appId);
    useEffect(() => { onChange(value); });
    return null;
}

let container: HTMLDivElement;
let root: Root;
let latest: RequirementSlotsState;

async function mount(appId: string): Promise<void> {
    await act(async () => {
        root.render(<HookHarness appId={appId} onChange={(v) => { latest = v; }} />);
    });
}

beforeEach(() => {
    mockFetch.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
});

describe('a draft that does not exist yet', () => {
    it('is not reported as a failed read', async () => {
        await mount('');
        expect(latest.loading).toBe(false);
        expect(latest.error).toBeNull();
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('says so in its own words, and never claims nothing is owed', async () => {
        await mount('');
        // The state the screen must be able to distinguish: no answer YET, which is
        // not the same as "the answer is: nothing".
        expect(latest.pending).toBe(true);
        expect([...latest.slots]).toEqual([]);
        expect(typeof latest.notice).toBe('string');
        expect(latest.notice).not.toEqual(SLOTS_ERROR_TH);
    });

    it('asks the server the moment the id arrives', async () => {
        mockFetch.mockResolvedValue({ slots: [SLOT] });
        await mount('');
        expect(mockFetch).not.toHaveBeenCalled();

        await mount('draft-1');

        expect(mockFetch).toHaveBeenCalledWith('draft-1');
        expect([...latest.slots]).toHaveLength(1);
        expect(latest.pending).toBe(false);
        expect(latest.error).toBeNull();
    });
});

describe('a read that really did fail', () => {
    it('is still reported as an error, not as an empty list', async () => {
        mockFetch.mockRejectedValue(new Error('boom'));
        await mount('draft-1');

        expect(latest.error).not.toBeNull();
        expect(latest.pending).toBe(false);
        expect([...latest.slots]).toEqual([]);
    });

    it('recovers on retry without remounting the step', async () => {
        mockFetch
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce({ slots: [SLOT] });
        await mount('draft-1');
        expect(latest.error).not.toBeNull();

        await act(async () => { await latest.reload(); });

        expect(latest.error).toBeNull();
        expect([...latest.slots]).toHaveLength(1);
    });
});

describe('a settled, successful read', () => {
    it('may render an empty list as "nothing left to attach"', async () => {
        mockFetch.mockResolvedValue({ slots: [] });
        await mount('draft-1');

        expect(latest.error).toBeNull();
        expect(latest.pending).toBe(false);
        expect([...latest.slots]).toEqual([]);
    });
});
