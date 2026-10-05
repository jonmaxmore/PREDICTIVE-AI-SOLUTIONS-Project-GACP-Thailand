/**
 * R2 Task 15 - the farm-create form names the holder (spec 2026-09-30 §3.6).
 * Rendered for real (mocked doors), not scanned as source: the body that leaves
 * the form is what is asserted.
 */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { buildFarmCreatePayload } from '../farm-create-payload';
import { PERSONAL, COMPANY, COMMUNITY, FORBIDDEN_COPY } from '@/components/holder/__tests__/fixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPost = jest.fn(async () => ({ success: true }));
let mockEntities: unknown[] = [];
let mockSearch = '';
const mockHas = jest.fn(() => true);

jest.mock('@/lib/api', () => ({ apiClient: { post: (...a: unknown[]) => (mockPost as (...x: unknown[]) => unknown)(...a) } }));
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    useSearchParams: () => new URLSearchParams(mockSearch),
}));
jest.mock('@/lib/services/my-entities-provider', () => ({
    useMyEntities: () => ({ entities: mockEntities, isLoading: false, error: null, refresh: async () => {} }),
}));
jest.mock('@/lib/services/use-entity-permissions', () => ({
    NO_PERMISSION_TOOLTIP_TH: 'ไม่มีสิทธิ์',
    useEntityPermissions: (id: string | null) => ({ has: mockHas, personal: id === null, isLoading: false, reportPermissionDenial: () => false }),
}));

import NewEstablishmentPage from '../client-view';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    mockPost.mockClear();
    mockSearch = '';
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const mount = () => act(() => { root.render(<NewEstablishmentPage />); });
const submit = async () => {
    const form = container.querySelector('form')!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
};
const pressHolder = (name: string) => act(() => {
    Array.from(container.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(name))!.click();
});

describe('payload', () => {
    it('carries entityId at the top level', () => {
        const p = buildFarmCreatePayload({
            name: 'ก', address: 'ข', province: 'ค', district: 'ง', subDistrict: 'จ',
            type: 'INDOOR', areaSize: '1', licenseNumber: '', entityId: ' e-company ',
        });
        expect(p.entityId).toBe('e-company');
    });
});

describe('the form', () => {
    it('with several holders there is no default: submit is blocked until one is chosen', async () => {
        mockEntities = [PERSONAL, COMPANY];
        mount();
        expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
        await submit();
        expect(mockPost).not.toHaveBeenCalled();
        expect(container.textContent).toContain('เลือกก่อนว่าจะลงทะเบียนสถานที่ปลูกในนามใคร');
    });

    it('posts the chosen holder as entityId', async () => {
        mockEntities = [PERSONAL, COMPANY];
        mount();
        pressHolder('บริษัท สมุนไพรไทย');
        await submit();
        expect(mockPost).toHaveBeenCalledWith('/farms', expect.objectContaining({ entityId: 'e-company' }));
    });

    it('?holder=<id> preselects it', async () => {
        mockEntities = [PERSONAL, COMPANY];
        mockSearch = 'holder=e-company';
        mount();
        await submit();
        expect(mockPost).toHaveBeenCalledWith('/farms', expect.objectContaining({ entityId: 'e-company' }));
    });

    it('a holder without the right to create a farm cannot be chosen', () => {
        mockEntities = [PERSONAL, COMPANY, COMMUNITY];
        mount();
        const community = Array.from(container.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('วิสาหกิจชุมชนบ้านสวน')) as HTMLButtonElement;
        expect(community.disabled).toBe(true);
    });

    it('prints no workspace word and no emoji', () => {
        mockEntities = [PERSONAL, COMPANY, COMMUNITY];
        mount();
        expect(container.textContent).not.toMatch(FORBIDDEN_COPY);
    });
});
