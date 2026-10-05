/**
 * X4-FIX-C / M-1 — split-finance dashboard auto-route.
 *
 * Closes X4-A audit gap D-1: V4-A widened middleware to admit
 * ACCOUNT_DTAM + ACCOUNT_PLATFORM to /provider/accounting, but the
 * dashboard's role-based auto-route (scheduler → /provider/coordinator,
 * auditor → /provider/audits) didn't add the new split roles. Both
 * still landed on the generic Officer Dashboard — wasted click per
 * login.
 *
 * Pattern mirrors dashboard-fetch-error.test.tsx (createRoot + act,
 * mocked apiClient + next/navigation). We assert router.replace was
 * called with /provider/accounting AFTER the /auth/provider/me fetch
 * resolves with the split role.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {

    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApiGet = jest.fn<(url: string) => Promise<unknown>>();
jest.mock('@/lib/api/api-client', () => ({
    apiClient: { get: (url: string) => mockApiGet(url) },
    api: { get: (url: string) => mockApiGet(url) },
}));

// Stable router ref — required so the dashboard's useEffect does not
// re-fire on every render and chew through the test timeout.
const routerReplace = jest.fn<(url: string) => void>();
jest.mock('next/navigation', () => {
    const router = {
        push: jest.fn(),
        replace: (url: string) => routerReplace(url),
        refresh: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        prefetch: jest.fn(),
        pathname: '/',
        query: {},
    };
    return {
        useRouter: () => router,
        usePathname: () => '/provider/dashboard',
        useSearchParams: () => new URLSearchParams(),
    };
});

// Passthrough layout — sidebar + auth context not relevant to the
// auto-route assertion.
jest.mock('../../components/provider-layout', () => {
    const Passthrough = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    Passthrough.displayName = 'MockProviderLayout';
    return { __esModule: true, default: Passthrough };
});

import ProviderDashboardPage from '../page';
import { LanguageProvider } from '@/lib/i18n/language-context';

describe('[X4-FIX-C / M-1] /provider/dashboard — split-finance auto-route', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        routerReplace.mockClear();
    });

    afterEach(() => {
        if (root) {
            act(() => {
                root?.unmount();
            });
            root = null;
        }
        if (container) {
            container.remove();
            container = null;
        }
    });

    function mount() {
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root.render(
                <LanguageProvider>
                    <ProviderDashboardPage />
                </LanguageProvider>,
            );
        });
    }

    async function flushMicrotasks(rounds = 20) {
        for (let i = 0; i < rounds; i++) {
            await act(async () => {
                await Promise.resolve();
            });
        }
    }

    function mockMeAs(canonicalRole: string) {
        mockApiGet.mockImplementation((url: string) => {
            if (url.includes('/auth/provider/me')) {
                return Promise.resolve({
                    success: true,
                    data: {
                        id: 'staff-1',
                        firstName: 'Alice',
                        lastName: 'Accountant',
                        canonicalRole,
                        role: canonicalRole,
                    },
                });
            }
            // Subsequent dashboard fetches don't matter for the redirect
            // test — return an empty envelope so any straggler call
            // resolves quickly.
            return Promise.resolve({ success: true, data: { applications: [] } });
        });
    }

    // operator 2026-09-11 "finance ต้องเห็นเหมือนกัน" — the per-side landings
    // /provider/accounting/dtam and /provider/accounting/platform (B5) were
    // removed. Both finance roles land on the same /provider/accounting.
    it.each(['finance_officer_dtam', 'finance_officer_platform'])(
        '%s auto-routes to the one /provider/accounting landing',
        async (role) => {
            mockMeAs(role);
            mount();
            await flushMicrotasks();
            expect(routerReplace).toHaveBeenCalledWith('/provider/accounting');
        },
    );

    it('DOCUMENT_REVIEWER auto-routes to its dedicated /provider/reviewer landing', async () => {
        // B5: the document reviewer now lands on its own launchpad instead of
        // STAYING on the generic dashboard (was: null → generic dashboard).
        mockMeAs('document_reviewer');
        mount();
        await flushMicrotasks();
        expect(routerReplace).toHaveBeenCalledWith('/provider/reviewer');
    });

    it('ผู้ดูแลระบบอยู่หน้ารวม ไม่ถูกพาไปหน้าของฝั่งใดฝั่งหนึ่ง', async () => {
        // เดิมข้อนี้ตรึงว่าผู้ใช้คำเปล่า `account` ต้องไม่ถูกพาไปหน้าของฝั่งใดฝั่งหนึ่ง
        // จนกว่าจะถูกย้ายข้างอย่างชัดเจน · คำเปล่าถูกปลดระวาง 2026-09-10 แล้ว
        // สิ่งที่ยังต้องจริงคือ: คนที่ไม่ใช่ฝ่ายบัญชีต้องไม่ถูกพาเข้าหน้าของฝ่ายบัญชี
        mockMeAs('system_admin_dtam');
        mount();
        await flushMicrotasks();
        const calls = routerReplace.mock.calls.map((c) => c[0]);
        expect(calls).not.toContain('/provider/accounting');
    });

    it('SCHEDULER still routes to /provider/coordinator (regression guard)', async () => {
        // Pin: the existing auto-routes must not regress when B5 is added.
        mockMeAs('dispatcher');
        mount();
        await flushMicrotasks();
        expect(routerReplace).toHaveBeenCalledWith('/provider/coordinator');
    });
});
