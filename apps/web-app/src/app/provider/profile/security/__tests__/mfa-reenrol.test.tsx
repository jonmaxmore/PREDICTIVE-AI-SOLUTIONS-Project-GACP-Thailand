/**
 * /provider/profile/security — moving an ENABLED 2FA to a new device asks for the
 * current code first (round 4 of fix/no-recovery, 2026-09-26).
 *
 * POST /api/mfa/setup used to overwrite an enabled secret on any session. It now
 * needs the current TOTP code, and the old factor stays active until the new one
 * is confirmed at /verify-setup (backend: apps/backend/__tests__/unit/
 * mfa-setup-reenrol.test.js). This page is the only web surface that calls
 * /setup on a signed-in account; the login enrolment form only runs for accounts
 * without 2FA. The health security page has no 2FA controls at all.
 * Harness copied from change-password-card.test.tsx next to this file.
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


describe('/provider/profile/security — 2FA enabled: move to a new device', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        mockGet.mockResolvedValue({ success: true, data: { enabled: true } });
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

    const card = () => container!.querySelector('[data-testid="mfa-reenrol"]');
    function type(input: HTMLInputElement, value: string) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        act(() => {
            setter.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    }
    const startButton = () => Array.from(card()!.querySelectorAll('button')).find((b) => (b.textContent || '').includes('เริ่มย้าย'))!;

    it('asks for the current code before anything is set up, and never calls setup on its own', async () => {
        await mount();
        expect(card()).not.toBeNull();
        expect(card()!.textContent).toContain('รหัส 6 หลักปัจจุบัน');
        expect(card()!.querySelector('input[name="reenrolCurrentCode"]')).not.toBeNull();
        expect(startButton().disabled).toBe(true);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it('sends the current code with setup, then shows the new QR and says the old one still works', async () => {
        mockPost.mockResolvedValue({ success: true, data: { secret: 'NEWSECRETBASE32', qrCodeUri: 'otpauth://totp/x?secret=NEWSECRETBASE32', reenrol: true } });
        await mount();
        type(card()!.querySelector<HTMLInputElement>('input[name="reenrolCurrentCode"]')!, '123456');
        await act(async () => { startButton().click(); });
        await flush(10);
        expect(mockPost).toHaveBeenCalledWith('/api/mfa/setup', { code: '123456' });
        expect(container!.textContent).toContain('ขั้นตอนที่ 1');
        expect(container!.textContent).toContain('NEWSECRETBASE32');
        expect(container!.textContent).toContain('แอปเดิมยังใช้ได้จนกว่า');
    });

    it('a wrong current code is refused and nothing moves', async () => {
        mockPost.mockResolvedValue({ success: false, error: 'Invalid code', code: 'MFA_CODE_REQUIRED' });
        await mount();
        type(card()!.querySelector<HTMLInputElement>('input[name="reenrolCurrentCode"]')!, '000000');
        await act(async () => { startButton().click(); });
        await flush(10);
        expect(container!.textContent).toContain('รหัสปัจจุบันไม่ถูกต้อง');
        expect(container!.textContent).not.toContain('ขั้นตอนที่ 1');
    });
    // Round 5 (2026-09-26): the backend deletes a re-enrol after 5 wrong codes and refuses
    // a different session. The page must not leave the officer typing into a dead QR step.
    it('after MFA_REENROL_RESTART the QR step closes and the officer is told to start again', async () => {
        mockPost.mockImplementation(async (url: string) => (url === '/api/mfa/setup'
            ? { success: true, data: { secret: 'NEWSECRETBASE32', qrCodeUri: 'otpauth://totp/x?secret=NEWSECRETBASE32', reenrol: true } }
            : { success: false, error: 'Too many wrong codes', code: 'MFA_REENROL_RESTART' }));
        await mount();
        type(card()!.querySelector<HTMLInputElement>('input[name="reenrolCurrentCode"]')!, '123456');
        await act(async () => { startButton().click(); });
        await flush(10);
        const qrInput = Array.from(container!.querySelectorAll<HTMLInputElement>('input')).find((i) => i.placeholder === '123456' && i.name !== 'reenrolCurrentCode')!;
        type(qrInput, '000000');
        const confirm = Array.from(container!.querySelectorAll('button')).find((b) => (b.textContent || '').includes('ยืนยันและเปิดใช้งาน'))!;
        await act(async () => { confirm.click(); });
        await flush(20);
        expect(mockPost).toHaveBeenCalledWith('/api/mfa/verify-setup', { code: '000000' });
        expect(container!.textContent).not.toContain('ขั้นตอนที่ 1');
        expect(card()).not.toBeNull();
        expect(container!.textContent).toContain('กรุณาเริ่มย้ายใหม่');
    });

    it('a store outage is not reported as a wrong code', async () => {
        mockPost.mockResolvedValue({ success: false, error: 'unavailable', code: 'MFA_REENROL_UNAVAILABLE' });
        await mount();
        type(card()!.querySelector<HTMLInputElement>('input[name="reenrolCurrentCode"]')!, '123456');
        await act(async () => { startButton().click(); });
        await flush(10);
        expect(container!.textContent).not.toContain('รหัสปัจจุบันไม่ถูกต้อง');
        expect(container!.textContent).toContain('ย้ายไม่ได้ในขณะนี้');
    });
});

