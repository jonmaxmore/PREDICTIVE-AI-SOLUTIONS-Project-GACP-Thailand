/**
 * R2 Task 15 — step 1 asks "ยื่นในนาม" and the type follows from the entity.
 * The real store reaches for IndexedDB at import, so the hook is mocked (same as
 * step1-shows-hydrated-answers.test.tsx).
 */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { restartFromStep1 } from '../../hooks/restart-draft';
import { PERSONAL, COMPANY, COMMUNITY, FORBIDDEN_COPY } from '@/components/holder/__tests__/fixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockUpdateState = jest.fn();
let mockState: Record<string, unknown> = {};
let mockEntities: unknown[] = [];
let mockSearch = '';

jest.mock('../../hooks/use-application-flow-store', () => ({
    useApplicationFlowStore: () => ({ state: mockState, updateState: mockUpdateState }),
}));
jest.mock('@/lib/services/my-entities-provider', () => ({
    useMyEntities: () => ({ entities: mockEntities, isLoading: false, error: null, refresh: async () => {} }),
}));
jest.mock('next/navigation', () => ({
    useSearchParams: () => new URLSearchParams(mockSearch),
}));

import Step1RequestType from '../step1-request-type';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    mockUpdateState.mockClear();
    mockState = { requestType: null, applicantType: null, holderEntityId: null, certScope: null, plantId: null, previousCertificateNumber: null };
    mockSearch = '';
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const mount = () => act(() => { root.render(<Step1RequestType />); });

describe('step 1 holder question', () => {
    it('shows ยื่นในนาม instead of the three type cards', () => {
        mockEntities = [PERSONAL, COMPANY, COMMUNITY];
        mount();
        const text = container.textContent ?? '';
        expect(text).toContain('ยื่นในนาม');
        expect(text).not.toContain('ผู้ยื่นคำขอ');
        expect(text).not.toMatch(FORBIDDEN_COPY);
    });

    it('choosing a holder writes holderEntityId AND the type taken from the entity', () => {
        mockEntities = [PERSONAL, COMPANY, COMMUNITY];
        mount();
        const company = Array.from(container.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('บริษัท สมุนไพรไทย'))!;
        act(() => { company.click(); });
        expect(mockUpdateState).toHaveBeenCalledWith({ holderEntityId: 'e-company', applicantType: 'JURISTIC' });
    });

    it('?holder=<id> preselects an entity the user may file for', () => {
        mockEntities = [PERSONAL, COMPANY];
        mockSearch = 'holder=e-company';
        mockState = { ...mockState, requestType: 'NEW' };
        mount();
        const company = Array.from(container.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('บริษัท สมุนไพรไทย'))!;
        expect(company.getAttribute('aria-pressed')).toBe('true');
        expect(mockUpdateState).toHaveBeenCalledWith({ holderEntityId: 'e-company', applicantType: 'JURISTIC' });
    });

    it('?holder=<id> of a viewer-only or unknown entity is ignored', () => {
        mockEntities = [PERSONAL, COMPANY];
        mockSearch = 'holder=e-nobody';
        mount();
        expect(mockUpdateState).not.toHaveBeenCalledWith(expect.objectContaining({ holderEntityId: 'e-nobody' }));
    });

    it('a single editable entity is stated as a fact and written to the store', () => {
        mockEntities = [PERSONAL];
        mockState = { ...mockState, requestType: 'NEW' };
        mount();
        expect(container.textContent).toContain('ยื่นในนาม สมชาย ใจดี · ใบรับรองจะออกในนามนี้');
        expect(mockUpdateState).toHaveBeenCalledWith({ holderEntityId: 'e-personal', applicantType: 'INDIVIDUAL' });
    });

    it('merely looking at step 1 (no request type yet) writes nothing to the store', () => {
        mockEntities = [PERSONAL];
        mockSearch = 'holder=e-personal';
        mount();
        expect(mockUpdateState).not.toHaveBeenCalled();
    });

    it('does not rewrite a holder that is already chosen', () => {
        mockEntities = [PERSONAL];
        mockState = { ...mockState, requestType: 'NEW', holderEntityId: 'e-personal', applicantType: 'INDIVIDUAL' };
        mount();
        expect(mockUpdateState).not.toHaveBeenCalledWith(expect.objectContaining({ holderEntityId: expect.anything() }));
    });
});

describe('restartFromStep1 (the only way to change a wrong holder)', () => {
    it('deletes the draft, clears the wizard, and returns to step 1 with no holder', async () => {
        const order: string[] = [];
        const del = jest.fn(async (url: string) => { order.push(`delete ${url}`); return { success: true }; });
        const reset = jest.fn(() => { order.push('reset'); });
        const go = jest.fn((url: string) => { order.push(`go ${url}`); });
        const out = await restartFromStep1({ applicationId: 'app-1', deleteDraft: del, resetWizard: reset, navigate: go });
        expect(out).toBe('RESTARTED');
        expect(order).toEqual(['delete /applications/draft/app-1', 'reset', 'go /health/applications/new/step/1']);
    });

    it('with no draft yet it only resets and navigates', async () => {
        const del = jest.fn();
        const reset = jest.fn();
        const go = jest.fn();
        await restartFromStep1({ applicationId: null, deleteDraft: del, resetWizard: reset, navigate: go });
        expect(del).not.toHaveBeenCalled();
        expect(reset).toHaveBeenCalled();
        expect(go).toHaveBeenCalledWith('/health/applications/new/step/1');
    });

    it('when the delete fails the draft and the holder are kept', async () => {
        const del = jest.fn(async () => ({ success: false }));
        const reset = jest.fn();
        const go = jest.fn();
        const out = await restartFromStep1({ applicationId: 'app-1', deleteDraft: del, resetWizard: reset, navigate: go });
        expect(out).toBe('FAILED');
        expect(reset).not.toHaveBeenCalled();
        expect(go).not.toHaveBeenCalled();
    });
});
