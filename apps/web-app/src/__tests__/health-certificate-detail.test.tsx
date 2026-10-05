/**
 * X1-FIX-A / C-2 — `/health/certificates/[id]` detail page state coverage.
 *
 * The cert detail page itself was added in Iter 23 (see
 * `apps/web-app/src/app/health/certificates/[id]/client-view.tsx`), but it
 * shipped without a Jest test for the three UI states. The X1-A audit
 * incorrectly recorded the page as missing; the page exists, but the
 * absence of test coverage means a regression that drops the loading
 * skeleton, error card, or success markup would not be caught.
 *
 * This file closes that gap with three contracts:
 *   1. loading                       → `PageSkeleton type="detail"` renders,
 *                                       success card is NOT yet present.
 *   2. fetch failure / unauth        → error card renders with the fallback
 *                                       "ไม่สามารถแสดงรายละเอียดใบรับรองได้"
 *                                       heading and a back link, and the
 *                                       success card is NOT present.
 *   3. success                       → certificate metadata renders
 *                                       (cert number + status), the success
 *                                       card is present, and the error
 *                                       card is NOT present.
 *
 * Pattern mirrors `apps/web-app/src/app/health/certificates/__tests__/
 * certificates-error-state.test.tsx` — direct ReactDOM `createRoot` + act,
 * with the service modules mocked at module-import boundaries so the test
 * stays hermetic (no real fetch / no clipboard / no QR generation).
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    // jsdom test mode requires this to be set explicitly otherwise React
    // warns on every render — same global toggle the sibling cert tests
    // already enable.
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ── Mocks (declared before importing the SUT) ───────────────────────────
//
// jest.mock factories are hoisted ABOVE the surrounding code so we declare
// the jest.fn() instances INSIDE the factory body, then read them back via
// jest.requireMock after hoisting completes (TDZ-safe).

jest.mock('@/lib/services/certificate-service', () => ({
    __esModule: true,
    CertificateService: {
        getCertificateById: jest.fn(),
        getCertificateVerifyUrl: jest.fn(
            (n: string) => `https://verify.example.test/verify/${n}`,
        ),
        downloadCertificatePdf: jest.fn(async () => true),
    },
}));

// AuthService.getUser() is called early in the component's effect; if it
// returns null the page bails out and redirects to login. Stub a logged-in
// user so the fetch branch runs.
jest.mock('@/lib/services/auth-service', () => ({
    __esModule: true,
    AuthService: {
        getUser: jest.fn(() => ({ id: 'user-1', healthId: 'h-1' })),
        getToken: jest.fn(() => 'fake-token'),
    },
}));

// Override `useRouter` so it returns the SAME object instance every
// render. The repo-wide jest.setup.tsx mock returns a fresh object on
// every call, which would invalidate the SUT's `[id, router]` effect
// deps every render → infinite fetch loop → test deadlock.
const STABLE_ROUTER = {
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    prefetch: jest.fn(),
    pathname: '/',
    query: {},
};
jest.mock('next/navigation', () => ({
    useRouter: () => STABLE_ROUTER,
    usePathname: () => '/',
    useSearchParams: () => new URLSearchParams(),
}));

// qrcode.toDataURL writes to a canvas — JSDOM ships a no-op canvas. Mock
// the module so the QR-rendering effect resolves synchronously instead of
// throwing on the absent 2D context.
jest.mock('qrcode', () => {
    const fn = () => Promise.resolve('data:image/png;base64,QRSTUB');
    return {
        __esModule: true,
        default: { toDataURL: fn },
        toDataURL: fn,
    };
});

// StatusBadge transitively imports the finance index barrel which pulls
// in heavy chart dependencies (recharts, jspdf-autotable). For the
// cert-detail rendering all we need is a stub element bearing the
// `data-testid` we assert on; the real visual chrome doesn't matter for
// a state-coverage test.
jest.mock('@/components/finance', () => ({
    __esModule: true,
    StatusBadge: ({ label }: { label?: string }) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- reason: jest factory closure
        const React = require('react');
        return React.createElement('span', { 'data-testid': 'status-badge' }, label);
    },
}));

// PageSkeleton ships sr-only "กำลังโหลด..." copy which is fine but the
// component subscribes to setInterval/animation frames that leave open
// handles. Replace with a trivial stub.
jest.mock('@/components/ui/page-skeleton', () => ({
    __esModule: true,
    PageSkeleton: () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- reason: jest factory closure
        const React = require('react');
        return React.createElement('div', { 'data-testid': 'page-skeleton' }, 'loading');
    },
}));

// Resolve mocks after jest.mock hoists. `jest.requireMock` always
// returns the mocked module even if a transitive import already loaded
// the real one in the jest module cache.
const certificateServiceModule = jest.requireMock('@/lib/services/certificate-service') as {
    CertificateService: { getCertificateById: jest.Mock };
};
const mockGetCertificateById = certificateServiceModule.CertificateService.getCertificateById;

import ClientView from '@/app/health/certificates/[id]/client-view';

/**
 * Render the SUT and flush enough microtask ticks for both the fetch
 * effect AND the dependent QR effect to commit.
 *
 * The SUT chains TWO effects:
 *   useEffect#1 → await fetch → setCert + setLoading(false)
 *   useEffect#2 (deps: cert.certificateNumber) → await QRCode → setQrDataUrl
 *
 * The pattern mirrors `apps/web-app/src/app/health/certificates/__tests__/
 * certificates-error-state.test.tsx` (which works for the list page) but
 * uses TWO `await act(async () => {})` passes because the dependent QR
 * effect needs a separate commit cycle after setCert lands.
 */
async function mountAndAwait(
    el: React.ReactElement,
): Promise<{ container: HTMLDivElement; root: Root }> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root!: Root;
    await act(async () => {
        root = createRoot(container);
        root.render(el);
    });
    // First flush — fetch resolves, setCert/setLoading land.
    await act(async () => {
        await Promise.resolve();
    });
    // Second flush — QR effect fires (deps changed), QR promise resolves,
    // setQrDataUrl lands.
    await act(async () => {
        await Promise.resolve();
    });
    return { container, root };
}

describe('[X1-FIX-A / C-2] /health/certificates/[id] — loading vs error vs success', () => {
    const cleanups: Array<() => void> = [];

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        cleanups.splice(0).forEach((fn) => fn());
    });

    /**
     * Mount + register cleanup so afterEach can unmount + remove DOM.
     */
    async function mountAndTrack(
        id: string,
    ): Promise<HTMLDivElement> {
        const { container, root } = await mountAndAwait(<ClientView id={id} />);
        cleanups.push(() => {
            act(() => {
                root.unmount();
            });
            container.remove();
        });
        return container;
    }

    /**
     * Synchronous mount for the loading branch — we observe BEFORE any
     * effect resolves, so the async helper would erase exactly what we
     * want to assert.
     */
    function mountSyncForLoading(id: string): HTMLDivElement {
        const container = document.createElement('div');
        document.body.appendChild(container);
        let root!: Root;
        act(() => {
            root = createRoot(container);
            root.render(<ClientView id={id} />);
        });
        cleanups.push(() => {
            act(() => {
                root.unmount();
            });
            container.remove();
        });
        return container;
    }

    it('renders the detail loading skeleton before the fetch resolves', () => {
        // Pending forever — observe the initial render branch only.
        mockGetCertificateById.mockReturnValue(new Promise(() => undefined));
        const container = mountSyncForLoading('cert-1');

        // Loading skeleton stub is rendered (mocked PageSkeleton emits
        // a [data-testid="page-skeleton"] node).
        expect(
            container.querySelector('[data-testid="page-skeleton"]'),
        ).not.toBeNull();
        // The success card carries data-testid="cert-success-card";
        // it must NOT be on screen during the loading branch.
        expect(
            container.querySelector('[data-testid="cert-success-card"]'),
        ).toBeNull();
        // Error fallback copy must not leak into loading.
        expect(container.textContent).not.toContain(
            'ไม่สามารถแสดงรายละเอียดใบรับรองได้',
        );
    });

    it('renders the error card when the fetch reports failure (cross-tenant or 404)', async () => {
        mockGetCertificateById.mockResolvedValue({
            success: false,
            error: 'ไม่พบใบรับรองนี้ หรือท่านไม่มีสิทธิ์เข้าถึง',
        });
        const container = await mountAndTrack('cert-not-mine');

        // Heading is shown.
        expect(container.textContent).toContain(
            'ไม่สามารถแสดงรายละเอียดใบรับรองได้',
        );
        // Surfaces the upstream error string so the user knows WHY.
        expect(container.textContent).toContain('ไม่พบใบรับรองนี้');
        // Provides a route back so the user is not stranded.
        expect(container.textContent).toContain('กลับไปยังรายการใบรับรอง');
        // The success card must NOT render in the error branch.
        expect(
            container.querySelector('[data-testid="cert-success-card"]'),
        ).toBeNull();
    });

    it('renders the certificate metadata when the fetch succeeds', async () => {
        mockGetCertificateById.mockResolvedValue({
            success: true,
            data: {
                id: 'cert-1',
                certificateNumber: 'GACP-2026-000123',
                status: 'ACTIVE',
                issuedDate: '2026-01-15T00:00:00.000Z',
                expiryDate: '2029-01-14T23:59:59.000Z',
                siteName: 'ฟาร์มสมุนไพรตัวอย่าง',
                plantType: 'กัญชา',
                farm: { location: 'อ.เชียงดาว จ.เชียงใหม่' },
            },
        });
        const container = await mountAndTrack('cert-1');

        // Success card visible.
        expect(
            container.querySelector('[data-testid="cert-success-card"]'),
        ).not.toBeNull();
        // Cert number rendered in the metadata block.
        expect(container.textContent).toContain('GACP-2026-000123');
        // Site name rendered.
        expect(container.textContent).toContain('ฟาร์มสมุนไพรตัวอย่าง');
        // Status label resolved from ACTIVE → "ใช้งานได้ (ACTIVE)".
        expect(container.textContent).toContain('ใช้งานได้');
        // Error card must NOT render alongside success.
        expect(container.textContent).not.toContain(
            'ไม่สามารถแสดงรายละเอียดใบรับรองได้',
        );
    });
});
