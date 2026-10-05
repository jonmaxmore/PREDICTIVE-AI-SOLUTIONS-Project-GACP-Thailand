/**
 * Walk D3 (2026-09-29): the wizard slot card offered only "แทนที่ไฟล์". The delete door
 * (DELETE /applications/draft-documents/:documentId) — which also retires the file's
 * document pre-check — was reachable by API only. The card now offers "ลบไฟล์":
 *
 *   - confirmed IN THE PAGE (never window.confirm), with a cancel that changes nothing;
 *   - sent for THIS filing (`?applicationId=`), so the door refuses a filed application
 *     instead of silently editing the latest draft;
 *   - disabled when the server says the filing is no longer editable (the requirements
 *     answer's `editable`, read from the same status set the door refuses with);
 *   - after success the card re-asks the server; on failure it says so in Thai.
 *
 * Pattern: createRoot/act — this repo has no @testing-library/react.
 */
import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockDelete = jest.fn<(url: string) => Promise<{ success: boolean; code?: string; error?: string }>>();
jest.mock('@/lib/api/api-client', () => ({
    apiClient: { delete: (url: string) => mockDelete(url), get: jest.fn(), post: jest.fn() },
}));
jest.mock('@/lib/services/draft-document-upload', () => ({
    uploadDraftDocument: jest.fn(async () => ({ error: null })),
}));

import { RequirementSlotCard } from '../requirement-slot-card';
import type { RequirementSlot } from '@/lib/services/application-requirements';

// Exact copy, typed here on purpose so a drifted constant fails instead of agreeing with itself.
const DELETE = 'ลบไฟล์';
const CONFIRM_DELETE = 'ยืนยันลบไฟล์';
const CANCEL = 'ยกเลิก';
const DELETE_FAILED = 'ลบไฟล์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
const DELETE_LOCKED = 'คำขอนี้ยื่นแล้ว จึงลบไฟล์ไม่ได้';

const attached = (patch: Partial<RequirementSlot> = {}): RequirementSlot => ({
    slotId: 'land_rights',
    labelTH: 'เอกสารสิทธิ์ที่ดิน',
    description: null,
    sourceHint: null,
    required: true,
    requiredReason: 'ALWAYS',
    satisfied: true,
    documentId: 'doc-1',
    fileUrl: '/uploads/application-drafts/a.pdf',
    fileName: 'โฉนด.pdf',
    uploadedAt: '2026-09-29T03:00:00.000Z',
    ...patch,
});

let container: HTMLDivElement;
let root: Root;
const onChanged = jest.fn();

async function mount(s: RequirementSlot, editable: boolean): Promise<void> {
    await act(async () => {
        root.render(<RequirementSlotCard slot={s} appId="app-1" onChanged={onChanged} editable={editable} />);
    });
}
const button = (label: string): HTMLButtonElement | undefined =>
    Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label);
async function press(label: string): Promise<void> {
    const b = button(label);
    if (!b) { throw new Error(`no button "${label}"`); }
    await act(async () => { b.click(); });
    await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
    mockDelete.mockReset();
    onChanged.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
});

describe('the delete control on an attached slot (walk D3)', () => {
    it('is offered beside "แทนที่ไฟล์" on an attached file of an editable filing', async () => {
        await mount(attached(), true);
        expect(button('แทนที่ไฟล์')).toBeDefined();
        expect(button(DELETE)).toBeDefined();
        expect(button(DELETE)!.disabled).toBe(false);
    });

    it('is not offered on an empty slot, nor on a slot with no documentId to delete', async () => {
        await mount(attached({ satisfied: false, documentId: null, fileUrl: null, fileName: null }), true);
        expect(button(DELETE)).toBeUndefined();
        await mount(attached({ documentId: null }), true);
        expect(button(DELETE)).toBeUndefined();
    });

    it('asks in the page first — never window.confirm — and cancel sends nothing', async () => {
        const confirmSpy = jest.spyOn(window, 'confirm').mockImplementation(() => true);
        await mount(attached(), true);
        await press(DELETE);
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(mockDelete).not.toHaveBeenCalled();
        const dialog = container.querySelector('[role="alertdialog"]');
        expect(dialog).not.toBeNull();
        expect(dialog!.textContent).toContain('โฉนด.pdf');
        await press(CANCEL);
        expect(container.querySelector('[role="alertdialog"]')).toBeNull();
        expect(mockDelete).not.toHaveBeenCalled();
        confirmSpy.mockRestore();
    });

    it('confirmed: DELETEs this document of THIS filing, then re-asks the server', async () => {
        mockDelete.mockResolvedValue({ success: true });
        await mount(attached(), true);
        await press(DELETE);
        await press(CONFIRM_DELETE);
        expect(mockDelete).toHaveBeenCalledWith('/applications/draft-documents/doc-1?applicationId=app-1');
        expect(onChanged).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    it('a refused delete says so in Thai and does not pretend the file is gone', async () => {
        mockDelete.mockResolvedValue({ success: false, error: 'Failed to delete draft document' });
        await mount(attached(), true);
        await press(DELETE);
        await press(CONFIRM_DELETE);
        expect(onChanged).not.toHaveBeenCalled();
        expect(container.querySelector('[role="alert"]')!.textContent).toBe(DELETE_FAILED);
    });

    it('a filing that is no longer editable: the button is there, disabled, and says why', async () => {
        await mount(attached(), false);
        const b = button(DELETE)!;
        expect(b.disabled).toBe(true);
        const describedBy = b.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        expect(container.querySelector(`[id="${describedBy}"]`)!.textContent).toBe(DELETE_LOCKED);
    });

    it('the door refusing a filed application reads the same locked sentence', async () => {
        mockDelete.mockResolvedValue({ success: false, code: 'APPLICATION_NOT_EDITABLE', error: 'x' });
        await mount(attached(), true);
        await press(DELETE);
        await press(CONFIRM_DELETE);
        expect(container.querySelector('[role="alert"]')!.textContent).toBe(DELETE_LOCKED);
    });

    it('without an `editable` answer the control fails closed (disabled)', async () => {
        await act(async () => {
            root.render(<RequirementSlotCard slot={attached()} appId="app-1" onChanged={onChanged} />);
        });
        expect(button(DELETE)!.disabled).toBe(true);
    });
});
