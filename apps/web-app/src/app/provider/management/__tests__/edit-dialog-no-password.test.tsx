/**
 * /provider/management — the edit dialog sets no password (operator 2026-09-26: "ปิด").
 *
 * The edit dialog had a "รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)" field and sent the whole
 * form to PUT /api/provider/directory/:id, which hashed it onto the officer's
 * account: an admin setting someone else's password, i.e. a staff-issued reset
 * (security review 2026-09-26-no-recovery-review.md, HIGH). The backend now
 * refuses a password on that door (DIRECTORY_PASSWORD_WRITE_FORBIDDEN); the
 * dialog no longer asks for one and the PUT body no longer carries one.
 * Creating an account still takes an initial password (control).
 *
 * Rendered with the real page (createRoot + act), harness copied from
 * no-password-reset-action.test.tsx.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const OFFICER = {
    id: 'staff-1',
    username: 'somchai',
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    email: '',
    role: 'document_reviewer',
    isActive: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    lastLoginAt: null,
    loginAttempts: 5,
    isLocked: true,
    lockedUntil: '2026-09-17T10:00:00.000Z',
    twoFactorEnabled: true,
};

type ApiResult = { success: boolean; data?: unknown; error?: string };
const mockGet = jest.fn<(url: string) => Promise<ApiResult>>();
const mockPost = jest.fn<(url: string, body?: unknown) => Promise<ApiResult>>();
const mockDelete = jest.fn<(url: string) => Promise<ApiResult>>();
const mockPut = jest.fn<(url: string, body?: unknown) => Promise<ApiResult>>();
jest.mock('@/lib/api/api-client', () => ({
    apiClient: {
        get: (url: string) => mockGet(url),
        post: (url: string, body?: unknown) => mockPost(url, body),
        put: (url: string, body?: unknown) => mockPut(url, body),
        delete: (url: string) => mockDelete(url),
    },
}));

jest.mock('sonner', () => ({
    toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

// A stable router: the page's mount effect depends on it, and the global mock
// hands out a new object per render, which would refetch forever.
jest.mock('next/navigation', () => {
    const router = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), back: jest.fn(), prefetch: jest.fn() };
    return {
        useRouter: () => router,
        usePathname: () => '/provider/management',
        useSearchParams: () => new URLSearchParams(),
    };
});

jest.mock('../../components/provider-layout', () => {
    const Passthrough = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    Passthrough.displayName = 'MockProviderLayout';
    return { __esModule: true, default: Passthrough };
});

import ProviderManagementPage from '../page';



describe('/provider/management — edit dialog', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        mockGet.mockImplementation(async (url: string) => (
            url === '/provider/directory' ? { success: true, data: [{ ...OFFICER, email: 'somchai@example.test' }] } : { success: true, data: {} }
        ));
        mockPut.mockResolvedValue({ success: true, data: OFFICER });
        mockPost.mockResolvedValue({ success: true, data: OFFICER });
    });

    afterEach(() => {
        if (root) {
            act(() => { root?.unmount(); });
            root = null;
        }
        container?.remove();
        container = null;
        document.body.innerHTML = '';
    });

    async function flush(rounds = 20) {
        for (let i = 0; i < rounds; i++) {
            await act(async () => { await Promise.resolve(); });
        }
    }

    async function mount() {
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root.render(<ProviderManagementPage />);
        });
        await flush();
    }

    const dialog = () => document.body.querySelector('[role="dialog"]');
    const buttonByText = (scope: ParentNode, text: string) => Array.from(scope.querySelectorAll('button'))
        .find((b) => (b.textContent || '').trim() === text);

    async function openEdit() {
        const edit = container!.querySelector<HTMLButtonElement>(`button[aria-label="แก้ไขพนักงาน ${OFFICER.firstName} ${OFFICER.lastName}"]`);
        expect(edit).not.toBeNull();
        await act(async () => { edit!.click(); });
        await flush(5);
        expect(dialog()).not.toBeNull();
    }

    it('the edit dialog has no password field', async () => {
        await mount();
        await openEdit();
        const d = dialog()!;
        // positive control: this is the edit dialog, filled with the officer
        expect(d.textContent).toContain('แก้ไขข้อมูลพนักงาน');
        expect(d.querySelector<HTMLInputElement>('input[value="somchai@example.test"]')).not.toBeNull();
        expect(d.querySelectorAll('input[type="password"]')).toHaveLength(0);
        expect(d.textContent).not.toContain('รหัสผ่าน');
    });

    it('saving an edit sends no password (and no providerId) to the directory', async () => {
        await mount();
        await openEdit();
        const save = buttonByText(dialog()!, 'บันทึก');
        expect(save).toBeDefined();
        await act(async () => { save!.click(); });
        await flush(10);
        expect(mockPut).toHaveBeenCalledTimes(1);
        const [url, body] = mockPut.mock.calls[0];
        expect(url).toBe(`/provider/directory/${OFFICER.id}`);
        expect(body).toEqual(expect.objectContaining({ email: 'somchai@example.test', firstName: OFFICER.firstName }));
        expect(Object.keys(body as object)).not.toContain('password');
        expect(Object.keys(body as object)).not.toContain('providerId');
    });

    it('control: creating an account still asks for an initial password', async () => {
        await mount();
        const add = buttonByText(container!, 'เพิ่มพนักงาน');
        expect(add).toBeDefined();
        await act(async () => { add!.click(); });
        await flush(5);
        const d = dialog()!;
        expect(d.textContent).toContain('รหัสผ่าน');
        // and it is masked (the field was a plain text input that showed the password as typed)
        expect(d.querySelectorAll('input[type="password"]')).toHaveLength(1);
    });
});
