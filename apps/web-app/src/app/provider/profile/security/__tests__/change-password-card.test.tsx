/**
 * /provider/profile/security — staff change their OWN password (operator 2026-09-26:
 * "ปิด + เพิ่มเปลี่ยนรหัสของตัวเองให้เจ้าหน้าที่").
 *
 * The staff directory no longer sets anyone's password, so this card is the only
 * way a staff password changes after the account is created. It posts the
 * current + new password to POST /auth/provider/change-password (the staff twin
 * of the applicant door). A successful change revokes every session of the
 * account, this one included, so the card signs the officer out and sends them
 * to the staff login.
 *
 * Rendered with the real page (createRoot + act, per repo convention).
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type ApiResult = { success: boolean; data?: unknown; error?: string; code?: string };
const mockGet = jest.fn<(url: string) => Promise<ApiResult>>();
const mockPost = jest.fn<(url: string, body?: unknown) => Promise<ApiResult>>();
jest.mock('@/lib/api/api-client', () => ({
    apiClient: {
        get: (url: string) => mockGet(url),
        post: (url: string, body?: unknown) => mockPost(url, body),
        delete: jest.fn(),
    },
}));

const mockLogout = jest.fn<() => Promise<void>>();
jest.mock('@/lib/services/auth-service', () => ({
    AuthService: { logout: () => mockLogout() },
}));

jest.mock('@/lib/notifications', () => ({ notifications: { show: jest.fn() } }));
jest.mock('qrcode', () => ({ toDataURL: jest.fn() }));

const mockPush = jest.fn();
jest.mock('next/navigation', () => {
    const router = { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn(), refresh: jest.fn(), back: jest.fn(), prefetch: jest.fn() };
    return {
        useRouter: () => router,
        usePathname: () => '/provider/profile/security',
        useSearchParams: () => new URLSearchParams(),
    };
});

jest.mock('../../../components/provider-layout', () => {
    const Passthrough = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    Passthrough.displayName = 'MockProviderLayout';
    return { __esModule: true, default: Passthrough };
});

import ProviderSecurityPage from '../page';

describe('/provider/profile/security — change own password', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        mockGet.mockResolvedValue({ success: true, data: { enabled: false } });
        mockLogout.mockResolvedValue(undefined);
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
            root.render(<ProviderSecurityPage />);
        });
        await flush();
    }

    const card = () => container!.querySelector('[data-testid="change-own-password"]');
    const field = (name: string) => card()!.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;

    // React tracks input values itself; set through the native setter so onChange fires.
    function type(input: HTMLInputElement, value: string) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        act(() => {
            setter.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    }

    async function submit() {
        const form = card()!.querySelector('form')!;
        await act(async () => { form.requestSubmit(); });
        await flush(10);
    }

    it('shows a change-password form with three masked fields', async () => {
        await mount();
        expect(card()).not.toBeNull();
        expect(card()!.textContent).toContain('เปลี่ยนรหัสผ่าน');
        for (const name of ['currentPassword', 'newPassword', 'confirmPassword']) {
            expect(field(name).type).toBe('password');
        }
    });

    it('posts the current and new password to the staff door, then signs out to the staff login', async () => {
        mockPost.mockResolvedValue({ success: true, data: { message: 'เปลี่ยนรหัสผ่านสำเร็จ' } });
        await mount();
        type(field('currentPassword'), 'OldStaff#Pass2026');
        type(field('newPassword'), 'NewStaff#Pass2027');
        type(field('confirmPassword'), 'NewStaff#Pass2027');
        await submit();

        expect(mockPost).toHaveBeenCalledWith('/auth/provider/change-password', {
            oldPassword: 'OldStaff#Pass2026',
            newPassword: 'NewStaff#Pass2027',
        });
        expect(mockLogout).toHaveBeenCalledTimes(1);
        expect(mockPush).toHaveBeenCalledWith('/auth/provider/login');
    });

    it('a mismatched confirmation is refused before the network', async () => {
        await mount();
        type(field('currentPassword'), 'OldStaff#Pass2026');
        type(field('newPassword'), 'NewStaff#Pass2027');
        type(field('confirmPassword'), 'NewStaff#Pass2028');
        await submit();

        expect(mockPost).not.toHaveBeenCalled();
        expect(card()!.textContent).toContain('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
    });

    it('a wrong current password shows the backend reason and keeps the officer signed in', async () => {
        mockPost.mockResolvedValue({ success: false, error: 'รหัสผ่านเดิมไม่ถูกต้อง', code: 'INVALID_CREDENTIALS' });
        await mount();
        type(field('currentPassword'), 'Wrong#Pass2026');
        type(field('newPassword'), 'NewStaff#Pass2027');
        type(field('confirmPassword'), 'NewStaff#Pass2027');
        await submit();

        expect(card()!.textContent).toContain('รหัสผ่านเดิมไม่ถูกต้อง');
        expect(mockLogout).not.toHaveBeenCalled();
        expect(mockPush).not.toHaveBeenCalled();
    });
});
