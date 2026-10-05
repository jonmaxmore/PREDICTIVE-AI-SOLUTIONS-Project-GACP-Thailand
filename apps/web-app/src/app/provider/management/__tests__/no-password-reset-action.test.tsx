/**
 * /provider/management offers no password-reset action (operator 2026-09-17:
 * "เราไม่มีการกู้บัญชี").
 *
 * The row used to carry a key button that asked the backend for a one-time
 * reset token and showed it in a dialog to copy. No page could redeem that
 * token (audit UXUI-X02), and with no account recovery there is nothing for it
 * to do. The backend route is gone too (apps/backend/__tests__/unit/
 * password-reset-routes-behaviour.test.js).
 *
 * Rendered, not grepped: the page is mounted with a locked, 2FA-enabled officer,
 * every row action that opens a confirmation is pressed and confirmed, and the
 * test reads what the officer would see and what the page sent.
 * createRoot + act, per repo convention (no @testing-library/react render).
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
jest.mock('@/lib/api/api-client', () => ({
    apiClient: {
        get: (url: string) => mockGet(url),
        post: (url: string, body?: unknown) => mockPost(url, body),
        put: jest.fn(),
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

const RESET_WORDS = /password|reset|รหัสผ่าน|รีเซ็ต|โทเค็น|token/i;

describe('/provider/management — no password-reset action (no account recovery)', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        mockGet.mockImplementation(async (url: string) => (
            url === '/provider/directory' ? { success: true, data: [OFFICER] } : { success: true, data: {} }
        ));
        mockPost.mockImplementation(async (url: string) => ({
            success: true,
            data: { id: OFFICER.id, resetToken: 'a'.repeat(64), expiresAt: '2026-09-17T11:00:00.000Z', url },
        }));
        mockDelete.mockResolvedValue({ success: true });
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

    const rowActions = () => Array.from(container!.querySelectorAll<HTMLButtonElement>('button[aria-label]'))
        .filter((b) => (b.getAttribute('aria-label') || '').includes(OFFICER.lastName));

    it('the officer row has no reset button, only the staff-administration actions', async () => {
        await mount();

        // positive control: the directory really rendered this officer
        expect(container!.textContent).toContain('สมชาย ใจดี');
        const labels = rowActions().map((b) => b.getAttribute('aria-label'));
        expect(labels).toEqual(expect.arrayContaining([
            `Unlock account for ${OFFICER.firstName} ${OFFICER.lastName}`,
            `ลบพนักงาน ${OFFICER.firstName} ${OFFICER.lastName}`,
        ]));
        expect(labels.filter((label) => RESET_WORDS.test(label || ''))).toEqual([]);
        // Operator 2026-09-26 "ถอดทั้งสองประตู": no one clears another account's 2FA,
        // so the officer row (2FA enabled) has no disable-2FA button either.
        expect(labels.filter((label) => /2FA|MFA/i.test(label || ''))).toEqual([]);
    });

    it('pressing and confirming every row action never asks for a reset token or shows one', async () => {
        await mount();

        const dialogTitles: string[] = [];
        // By label, re-queried each time: a confirmed action refetches the
        // directory and the row re-mounts, so an element held from before is detached.
        const labels = rowActions()
            .map((b) => b.getAttribute('aria-label') || '')
            .filter((label) => !/^(Manage|แก้ไข)/.test(label));
        expect(labels.length).toBeGreaterThanOrEqual(2);
        for (const label of labels) {
            const button = rowActions().find((b) => b.getAttribute('aria-label') === label);
            if (!button) { throw new Error(`row action disappeared: ${label}`); }
            await act(async () => { button.click(); });
            await flush(5);
            const dialog = document.body.querySelector('[role="dialog"]');
            if (!dialog) { continue; }
            dialogTitles.push(dialog.querySelector('h2')?.textContent || '');
            // Footer buttons are [cancel, confirm]; the corner close (X) carries an sr-only label.
            const footer = Array.from(dialog.querySelectorAll('button')).filter((b) => !b.querySelector('.sr-only'));
            const confirm = footer[footer.length - 1];
            expect(footer).toHaveLength(2);
            await act(async () => { confirm.click(); });
            await flush(10);
        }

        // each confirmation the row offers, and nothing else
        expect(dialogTitles.sort()).toEqual(['ปลดล็อกบัญชี', 'ยืนยันการลบพนักงาน'].sort());
        const posted = mockPost.mock.calls.map(([url]) => url);
        expect(posted).toEqual([`/provider/directory/${OFFICER.id}/unlock`]);
        expect(mockDelete).toHaveBeenCalledWith(`/provider/directory/${OFFICER.id}`);
        expect(posted.filter((url) => RESET_WORDS.test(url))).toEqual([]);
        expect(document.body.textContent).not.toMatch(/โทเค็น/);
        expect(document.body.textContent).not.toContain('a'.repeat(64));
    });
});
