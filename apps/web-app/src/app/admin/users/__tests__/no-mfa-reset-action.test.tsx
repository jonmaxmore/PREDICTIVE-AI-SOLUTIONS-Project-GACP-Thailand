/**
 * /admin/users offers no "รีเซ็ต MFA" action (operator 2026-09-26: "ถอดทั้งสองประตู").
 *
 * The row menu had "รีเซ็ต MFA", which opened ForceMfaResetModal and posted to
 * POST /api/admin/users/:id/force-reset-mfa, which cleared another user's 2FA.
 * No one clears another account's second factor: 2FA recovery belongs to
 * หมอพร้อม, and there is no account recovery (2026-09-17). The backend route is
 * gone (apps/backend/__tests__/unit/second-factor-doors.test.js). This test
 * renders the real page, opens the row menu and reads what the admin sees, and
 * checks that the client no longer has a function that calls that door.
 * createRoot + act, per repo convention.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const USER = {
    id: 'farmer-1',
    email: 'farmer@example.test',
    firstName: 'ชาวไร่',
    lastName: 'ทดสอบ',
    role: 'health',
    status: 'ACTIVE',
    accountType: 'INDIVIDUAL',
    authType: 'HEALTH_ID',
    providerId: null,
    healthId: 'MASKED',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    lastLoginAt: null,
};

type ApiResult = { success: boolean; data?: unknown; error?: string };
const mockGet = jest.fn<(url: string) => Promise<ApiResult>>();
const mockPost = jest.fn<(url: string, body?: unknown) => Promise<ApiResult>>();
jest.mock('@/lib/api/api-client', () => ({
    apiClient: {
        get: (url: string) => mockGet(url),
        post: (url: string, body?: unknown) => mockPost(url, body),
        patch: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
    },
}));

jest.mock('next/navigation', () => {
    const router = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), back: jest.fn(), prefetch: jest.fn() };
    return {
        useRouter: () => router,
        usePathname: () => '/admin/users',
        useSearchParams: () => new URLSearchParams(),
    };
});

import AdminUsersPage from '../page';
import { AdminB28Service } from '@/lib/services/admin-service-b28';
import * as adminComponents from '@/components/admin';

describe('/admin/users — no MFA reset', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        mockGet.mockResolvedValue({ success: true, data: { users: [USER], pagination: { total: 1 } } });
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

    it('the row menu offers role and status actions, and no MFA reset', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root.render(<AdminUsersPage />);
        });
        await flush();

        // positive control: the user row and its action menu rendered
        expect(container.textContent).toContain('farmer@example.test');
        const menuItems = Array.from(container.querySelectorAll('[role="menuitem"]')).map((el) => (el.textContent || '').trim());
        expect(menuItems).toContain('เปลี่ยนบทบาท');
        expect(menuItems.filter((label) => /MFA|2FA|รีเซ็ต/i.test(label))).toEqual([]);
        expect(container.textContent).not.toContain('รีเซ็ต MFA');
    });

    it('the client has no call to the removed door and the modal is gone', () => {
        expect((AdminB28Service as Record<string, unknown>).forceResetMfa).toBeUndefined();
        expect((adminComponents as Record<string, unknown>).ForceMfaResetModal).toBeUndefined();
    });
});
