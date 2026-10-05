/**
 * IdpCallbackPage — Task 1 of the ThaiD sandbox-readiness plan
 * (design notes).
 *
 * Before this page existed, BORA's redirect to /auth/callback/thaid landed
 * on a bare 404 — this suite is the RED-first proof that the browser leg
 * now exists and does the right thing in every branch: BORA-level error
 * (no POST), success (POST via the direct backend origin + routes by
 * role), the R-A mfaRequired hand-off (built now against the password
 * path's existing wire contract, mocked here since the IdP path itself
 * only starts emitting it in Task 2), and a backend catalog error.
 *
 * Harness note: this repo does NOT ship @testing-library/react — uses the
 * createRoot + act idiom (see login-chooser.test.tsx / resubmit-button-
 * renders.test.tsx). next/navigation is mocked per-file (the jest.setup.tsx
 * default has no useParams), and the underlying fetch is stubbed directly
 * since `idpFetch` is a thin wrapper around the global `fetch` — no
 * apiClient involved (that's the whole point of R-B).
 */

import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockReplace = jest.fn();
let mockParams: Record<string, string> = { provider: 'thaid' };
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
    useParams: () => mockParams,
    useRouter: () => ({
        push: jest.fn(),
        replace: mockReplace,
        refresh: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        prefetch: jest.fn(),
    }),
    usePathname: () => '/auth/callback/thaid',
    useSearchParams: () => mockSearchParams,
}));

// The MFA hand-off is the password path's EXISTING, already-tested UI
// (mfa-challenge-form.test.tsx covers its own OTP logic). This page's job
// is only to render it with the right mfaSession and route on its
// onSuccess — a lightweight stub proves exactly that without re-testing
// MfaChallengeForm's internals here.
jest.mock('@/app/auth/_components/mfa-challenge-form', () => ({
    __esModule: true,
    default: ({ mfaSession, onSuccess }: { mfaSession: string; onSuccess: () => void }) => (
        <div data-testid="mfa-stub" data-mfa-session={mfaSession}>
            <button type="button" onClick={onSuccess}>stub-mfa-success</button>
        </div>
    ),
}));

const mockGetUser = jest.fn<() => { role?: string } | null>();
// Fix round 1: the non-MFA success branch must hydrate AuthService's
// session cache (saveSession) BEFORE navigating — every /health/* page
// gates synchronously on AuthService.getUser() before its first network
// call, and ThaID's cookie-only success body left that cache empty.
const mockSaveSession = jest.fn<(data: unknown) => Promise<void>>().mockResolvedValue(undefined);
jest.mock('@/lib/services/auth-service', () => ({
    AuthService: {
        getUser: () => mockGetUser(),
        saveSession: (data: unknown) => mockSaveSession(data),
    },
}));

import IdpCallbackPage, { BORA_OAUTH_ERROR_MAP, IDP_CALLBACK_ERROR_MAP } from '../client-view';

describe('/auth/callback/[provider] — the OAuth callback landing page (Task 1)', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;
    const realFetch = globalThis.fetch;

    beforeEach(() => {
        jest.clearAllMocks();
        mockParams = { provider: 'thaid' };
        mockSearchParams = new URLSearchParams();
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
        (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
    });

    function mount() {
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root.render(<IdpCallbackPage />);
        });
    }

    async function flush(rounds = 10) {
        for (let i = 0; i < rounds; i++) {
            await act(async () => {
                await Promise.resolve();
            });
        }
    }

    function installFetch(impl: (...args: unknown[]) => Promise<unknown>) {
        const fetchMock = jest.fn(impl);
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
        return fetchMock;
    }

    // (a) BORA-level error — error card, no POST.
    it('renders a Thai error card for ?error= and never POSTs to the callback', async () => {
        mockSearchParams = new URLSearchParams({
            error: 'access_denied',
            error_description: 'User denied access',
        });
        const fetchMock = installFetch(async () => {
            throw new Error('must not be called');
        });

        mount();
        await flush();

        expect(container!.textContent).toContain(BORA_OAUTH_ERROR_MAP.access_denied);
        expect(container!.textContent).toContain('User denied access');
        expect(container!.textContent).toContain('กลับไปหน้าเข้าสู่ระบบ');
        expect(fetchMock).not.toHaveBeenCalled();

        const backLink = container!.querySelector('a[href="/auth"]');
        expect(backLink).not.toBeNull();
    });

    // Loading state — "the farmer just came back from the ThaID app, no
    // blank flash": before the POST settles the page shows a spinner, not
    // an empty screen.
    it('shows a loading state while the callback POST is in flight', async () => {
        mockSearchParams = new URLSearchParams({ code: 'auth-code', state: 'state-value' });
        installFetch(() => new Promise(() => undefined));

        mount();

        expect(container!.querySelector('[role="status"]')).not.toBeNull();
        expect(container!.textContent).toContain('กำลังเข้าสู่ระบบ');
    });

    // (b) happy path — POST via the direct backend origin with
    // credentials:'include', routes by role.
    it('POSTs {code,state} to the direct backend origin, hydrates the session cache, then routes a HEALTH user to /health/home', async () => {
        mockSearchParams = new URLSearchParams({ code: 'auth-code', state: 'state-value' });
        const fetchMock = installFetch(async () => ({
            ok: true,
            json: async () => ({ success: true, data: { user: { id: 'u1', role: 'HEALTH' } } }),
        }));

        mount();
        await flush();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('http://localhost:8000/api/auth/idp/thaid/callback');
        expect(init.method).toBe('POST');
        expect(init.credentials).toBe('include');
        expect(JSON.parse(init.body as string)).toEqual({ code: 'auth-code', state: 'state-value' });

        // Fix round 1: AuthService.saveSession must be called with the
        // response's user (health/dashboard/client-view.tsx:102-103 gates
        // synchronously on AuthService.getUser() before any network call —
        // without this, a non-MFA success bounced straight back to login).
        expect(mockSaveSession).toHaveBeenCalledWith({ user: { id: 'u1', role: 'HEALTH' } });
        expect(mockReplace).toHaveBeenCalledWith('/health/home');
        // ...and it must happen BEFORE the navigation, not merely at some point.
        expect(mockSaveSession.mock.invocationCallOrder[0])
            .toBeLessThan(mockReplace.mock.invocationCallOrder[0]!);
    });

    it('routes a PROVIDER-side role (ADMIN) to /provider/dashboard — same split the password login FE uses — and hydrates the cache first', async () => {
        mockSearchParams = new URLSearchParams({ code: 'auth-code', state: 'state-value' });
        installFetch(async () => ({
            ok: true,
            json: async () => ({ success: true, data: { user: { id: 'u2', role: 'system_admin_dtam' } } }),
        }));

        mount();
        await flush();

        expect(mockSaveSession).toHaveBeenCalledWith({ user: { id: 'u2', role: 'system_admin_dtam' } });
        expect(mockReplace).toHaveBeenCalledWith('/provider/dashboard');
        expect(mockSaveSession.mock.invocationCallOrder[0])
            .toBeLessThan(mockReplace.mock.invocationCallOrder[0]!);
    });

    // (c) mfaRequired — hands off to the MFA flow (R-A's contract, mocked;
    // the IdP path itself only starts emitting this in Task 2).
    it('on mfa_required, renders the MFA hand-off with the session and routes by role on its onSuccess', async () => {
        mockSearchParams = new URLSearchParams({ code: 'auth-code', state: 'state-value' });
        installFetch(async () => ({
            ok: true,
            json: async () => ({
                success: true,
                data: { mfa_required: true, mfa_session: 'mfa-session-token' },
            }),
        }));

        mount();
        await flush();

        const stub = container!.querySelector('[data-testid="mfa-stub"]');
        expect(stub).not.toBeNull();
        expect(stub!.getAttribute('data-mfa-session')).toBe('mfa-session-token');
        // No premature navigation — the MFA step has not been completed yet.
        expect(mockReplace).not.toHaveBeenCalled();

        mockGetUser.mockReturnValue({ role: 'dispatcher' });
        const successBtn = stub!.querySelector('button')!;
        await act(async () => {
            successBtn.click();
        });

        expect(mockReplace).toHaveBeenCalledWith('/provider/dashboard');
    });

    // (d) catalog error — Thai message + back-link.
    it('on a catalog error (AUTH_STATE_INVALID), shows the mapped Thai message and the return-to-login action', async () => {
        mockSearchParams = new URLSearchParams({ code: 'auth-code', state: 'state-value' });
        installFetch(async () => ({
            ok: false,
            json: async () => ({
                success: false,
                code: 'AUTH_STATE_INVALID',
                error: 'OAuth state verification failed',
                message: 'OAuth state verification failed',
            }),
        }));

        mount();
        await flush();

        expect(container!.textContent).toContain(IDP_CALLBACK_ERROR_MAP.AUTH_STATE_INVALID);
        expect(container!.textContent).not.toContain('OAuth state verification failed');
        expect(mockReplace).not.toHaveBeenCalled();

        const backLink = container!.querySelector('a[href="/auth"]');
        expect(backLink).not.toBeNull();
        expect(backLink!.textContent).toContain('กลับไปหน้าเข้าสู่ระบบ');
    });

    it('a network failure shows an indeterminate connection message, not a definitive login-failed claim', async () => {
        mockSearchParams = new URLSearchParams({ code: 'auth-code', state: 'state-value' });
        installFetch(async () => {
            throw new Error('network down');
        });

        mount();
        await flush();

        expect(container!.textContent).toContain('ไม่สามารถเชื่อมต่อระบบได้ในขณะนี้');
    });

    // Item 5 (council final-fix round): AUTH_AUTOPROVISION_ROLE_FORBIDDEN is
    // newly reachable via T2's role gate (a national ID that resolves to a
    // privileged/staff account rejects at resolveThaidLogin's
    // assertAutoProvisionableRole) but was missing from IDP_CALLBACK_ERROR_MAP
    // — an unmapped code fell through to the backend's English `error` field.
    it('on AUTH_AUTOPROVISION_ROLE_FORBIDDEN (Item 5), shows the mapped Thai message from the catalog', async () => {
        mockSearchParams = new URLSearchParams({ code: 'auth-code', state: 'state-value' });
        installFetch(async () => ({
            ok: false,
            json: async () => ({
                success: false,
                code: 'AUTH_AUTOPROVISION_ROLE_FORBIDDEN',
                error: 'This national ID belongs to a privileged account — ThaID cannot auto-link or auto-provision it',
                message: 'This national ID belongs to a privileged account — ThaID cannot auto-link or auto-provision it',
                messageTh: 'เลขบัตรประชาชนนี้ผูกกับบัญชีเจ้าหน้าที่ ไม่สามารถเข้าสู่ระบบอัตโนมัติผ่าน ThaID ได้ กรุณาติดต่อผู้ดูแลระบบ',
            }),
        }));

        mount();
        await flush();

        expect(container!.textContent).toContain(IDP_CALLBACK_ERROR_MAP.AUTH_AUTOPROVISION_ROLE_FORBIDDEN);
        expect(container!.textContent).not.toContain('privileged account');
        expect(mockReplace).not.toHaveBeenCalled();
    });

    // Item 5: the resolver previously never read `envelope.messageTh` — a
    // code with NO entry in this page's local map fell through to the
    // backend's English `error`/`message`, even though sendErrorResponse
    // (shared/api-response.js) already ships a Thai `messageTh` on every
    // error envelope. This pins the fallback for a code deliberately absent
    // from IDP_CALLBACK_ERROR_MAP.
    it('an UNMAPPED code with messageTh renders the Thai messageTh, not the English error/message', async () => {
        mockSearchParams = new URLSearchParams({ code: 'auth-code', state: 'state-value' });
        installFetch(async () => ({
            ok: false,
            json: async () => ({
                success: false,
                code: 'SOME_FUTURE_CODE_NOT_YET_IN_THE_MAP',
                error: 'English fallback text',
                message: 'English fallback text',
                messageTh: 'ข้อความภาษาไทยจากแบ็กเอนด์',
            }),
        }));

        mount();
        await flush();

        expect(container!.textContent).toContain('ข้อความภาษาไทยจากแบ็กเอนด์');
        expect(container!.textContent).not.toContain('English fallback text');
    });
});
