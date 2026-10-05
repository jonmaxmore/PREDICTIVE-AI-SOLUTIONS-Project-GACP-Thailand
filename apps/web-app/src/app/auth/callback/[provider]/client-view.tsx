'use client';

/**
 * IdpCallbackPage — the browser leg of the OAuth callback (Task 1,
 * design notes).
 *
 * BORA (and every other registered IdP) redirects the browser here with
 * either `?code=...&state=...` (success) or `?error=...&error_description=...`
 * (the user denied consent, or BORA itself rejected the request). This page:
 *
 *   1. On `?error=` — renders a Thai error card immediately. Never POSTs;
 *      there is nothing to exchange.
 *   2. Otherwise — POSTs `{code, state}` to the backend callback via
 *      `idpFetch` (R-B: DIRECT to the backend origin, `credentials:
 *      'include'` — see idp-client.ts for why this must not go through the
 *      universal Next proxy). That origin already holds the `idp_state`
 *      cookie the authorize-url step set, and on success sets the session
 *      cookie (`provider_token`) directly — cookies are host-scoped, so it
 *      is visible to this page's own origin too.
 *   3. Routes the outcome:
 *        - success  → `user.role` decides `/health/dashboard` vs
 *          `/provider/dashboard`, via the SAME `isProviderRole` check the
 *          Next middleware (middleware-helpers.ts:decideHealthAccess /
 *          decideProviderRouteAccess) and every password-login page already
 *          key off of — not a new mapping.
 *        - `mfa_required` (R-A, lands in Task 2 — built now against the
 *          password path's EXISTING wire contract: auth-provider.js:200-204
 *          `{mfa_required, mfa_session}`, consumed by
 *          auth-service-api.ts:78-80) → hands off into the SAME
 *          `MfaChallengeForm` the password path uses; no new MFA UI.
 *        - a catalog error (`shared/error-codes.js` — AUTH_STATE_INVALID /
 *          AUTH_IDP_* / AUTH_AUTOPROVISION_DISABLED / AUTH_LINKING_PENDING /
 *          ...) → Thai message + "กลับไปหน้าเข้าสู่ระบบ".
 *
 * Thai copy follows Policy 5 (docs/i18n-policy.md, lib/i18n/error-code-map.ts):
 * a per-component `code → Thai message` map, resolved via the shared
 * `resolveErrorCode` helper — the same idiom ChangeRoleModal
 * uses. `utils/error-translator.ts` is NOT reused here: its own header marks
 * it dead-at-runtime (zero production callers) and it only maps free-text
 * English strings, not the stable `code` identifiers this catalog carries.
 *
 * ThaID's session mint deliberately ships NO token in the response body
 * (auth-idp.js:270-271, "session = httpOnly cookie เท่านั้น") — unlike the
 * password path. That does NOT mean this page can skip `AuthService.
 * saveSession`, though (fix round 1 — an earlier version of this comment
 * claimed it did, and was wrong): every /health/* page — dashboard,
 * billing, certificates/[id], applications, notifications, start,
 * start/readiness, reports, establishments, profile, account/erasure —
 * gates SYNCHRONOUSLY on `AuthService.getUser()` being non-null BEFORE it
 * makes any network call (e.g. health/dashboard/client-view.tsx:102-103).
 * Without hydrating that cache, a non-MFA ThaID success (the majority of
 * logins — no 2FA enrolled) landed on /health/dashboard and was bounced
 * straight back to /auth/health/login. `saveSession` populates that cache
 * UNCONDITIONALLY on `data.user` — the token-storage/cookie-mirroring step
 * is a separate `if (accessToken)` block it simply skips when there is no
 * token, which is correct here since the real session cookie was already
 * set directly by the callback response. So this page calls
 * `AuthService.saveSession({ user })` (no token field) — the SAME
 * mechanism `MfaChallengeForm.onSuccess` uses (mfa-challenge-form.tsx:86-88),
 * minus the token that path has and this one does not.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/primitives/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from '@/components/ui/primitives/card';
import { Spinner } from '@/components/ui/spinner';
import { idpFetch } from '@/lib/api/idp-client';
import { ACCOUNT_INACTIVE_MESSAGE_TH } from '@/lib/api/account-inactive';
import { resolveErrorCode } from '@/lib/i18n/error-code-map';
import { isProviderRole } from '@/lib/constants/canonical-roles';
import { HEALTH_DASHBOARD_ROUTE, PROVIDER_DASHBOARD_ROUTE } from '@/lib/constants/auth-routes';
import { AuthService } from '@/lib/services/auth-service';
import type { AuthUser } from '@/lib/services/auth-service.types';
import MfaChallengeForm from '@/app/auth/_components/mfa-challenge-form';

/**
 * Thai copy for BORA's OWN OAuth error query param — returned when the
 * citizen never reaches our backend at all (e.g. pressed deny on the ThaID
 * consent screen). Keyed on the OAuth2 standard error codes an IdP redirect
 * carries. Exported for the component test.
 */
export const BORA_OAUTH_ERROR_MAP: Record<string, string> = {
    access_denied: 'คุณยกเลิกการยืนยันตัวตนที่ ThaID กรุณาลองเข้าสู่ระบบใหม่อีกครั้ง',
    invalid_request: 'คำขอเข้าสู่ระบบไม่ถูกต้อง กรุณาเริ่มเข้าสู่ระบบใหม่อีกครั้ง',
    unauthorized_client: 'ระบบยังไม่ได้รับอนุญาตให้เชื่อมต่อ ThaID กรุณาติดต่อผู้ดูแลระบบ',
    unsupported_response_type: 'ระบบส่งคำขอเข้าสู่ระบบผิดรูปแบบ กรุณาติดต่อผู้ดูแลระบบ',
    invalid_scope: 'ระบบขอสิทธิ์เข้าถึงข้อมูลผิดรูปแบบ กรุณาติดต่อผู้ดูแลระบบ',
    server_error: 'ระบบยืนยันตัวตน ThaID ขัดข้อง กรุณาลองใหม่ภายหลัง',
    temporarily_unavailable: 'ระบบยืนยันตัวตน ThaID ไม่พร้อมให้บริการชั่วคราว กรุณาลองใหม่ภายหลัง',
};

/**
 * Thai copy for the callback POST's own catalog errors
 * (`apps/backend/shared/error-codes.js`). The backend already returns a
 * matching `messageTh`; this FE-owned map is the PRIMARY source (Policy 5 —
 * keeps register/wording consistent with the rest of the app), and
 * `resolveErrorCode` falls back to the backend's own `error`/`message` for
 * any code not yet listed here. Exported for the component test.
 */
export const IDP_CALLBACK_ERROR_MAP: Record<string, string> = {
    AUTH_STATE_INVALID: 'การตรวจสอบความปลอดภัยของการเข้าสู่ระบบไม่ผ่าน กรุณาเริ่มเข้าสู่ระบบใหม่อีกครั้ง',
    AUTH_STATE_SECRET_MISSING: 'ระบบยังไม่พร้อมให้เข้าสู่ระบบด้วยช่องทางนี้ กรุณาลองใหม่ภายหลังหรือติดต่อผู้ดูแลระบบ',
    AUTH_PROVIDER_DISABLED: 'ช่องทางเข้าสู่ระบบนี้ยังไม่เปิดให้บริการ กรุณาเข้าสู่ระบบด้วยช่องทางอื่น',
    AUTH_IDP_ACCESS_DENIED: 'คุณยกเลิกการยืนยันตัวตนที่ ThaID กรุณาลองเข้าสู่ระบบใหม่อีกครั้ง',
    AUTH_IDP_CODE_EXPIRED: 'รหัสยืนยันจาก ThaID หมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
    AUTH_IDP_CODE_INVALID: 'รหัสยืนยันจาก ThaID ไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
    AUTH_IDP_CLIENT_AUTH_FAILED: 'ระบบยืนยันตัวตนปฏิเสธการเชื่อมต่อของระบบ กรุณาติดต่อผู้ดูแลระบบ',
    AUTH_IDP_TOKEN_INVALID: 'โทเคนจาก ThaID ไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
    AUTH_IDP_EXCHANGE_FAILED: 'การแลกเปลี่ยนข้อมูลกับ ThaID ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
    AUTH_IDP_UNAVAILABLE: 'ไม่สามารถเชื่อมต่อระบบยืนยันตัวตนได้ในขณะนี้ กรุณาลองใหม่ภายหลัง',
    AUTH_IDP_PROFILE_INCOMPLETE: 'ข้อมูลจากระบบยืนยันตัวตนไม่ครบถ้วน กรุณาติดต่อผู้ดูแลระบบ',
    AUTH_LINKING_PENDING: 'ยืนยันตัวตนกับ ThaID สำเร็จ แต่ยังไม่เปิดให้เชื่อมบัญชีด้วยวิธีนี้ กรุณาเข้าสู่ระบบด้วยช่องทางเดิมไปก่อน',
    AUTH_AUTOPROVISION_DISABLED: 'ระบบยังไม่เปิดให้สร้างบัญชีอัตโนมัติผ่าน ThaID กรุณาลงทะเบียนก่อนเข้าสู่ระบบ',
    // Item 5 (council final-fix round): reachable via T2's role gate —
    // resolveThaidLogin's existing-link/national-ID/auto-provision branches
    // all call assertAutoProvisionableRole, which throws this code when a
    // national ID resolves to a privileged/staff account. Thai copy mirrors
    // the catalog's own messageTh (shared/error-codes.js AUTH_AUTOPROVISION_ROLE_FORBIDDEN).
    AUTH_AUTOPROVISION_ROLE_FORBIDDEN: 'เลขบัตรประชาชนนี้ผูกกับบัญชีเจ้าหน้าที่ ไม่สามารถเข้าสู่ระบบอัตโนมัติผ่าน ThaID ได้ กรุณาติดต่อผู้ดูแลระบบ',
    // Item 4's kill-switch code (an admin-deactivated identity_links row) —
    // Thai copy mirrors the catalog's messageTh (AUTH_LINKING_INACTIVE).
    AUTH_LINKING_INACTIVE: 'การเชื่อมบัญชีนี้กับระบบยืนยันตัวตนถูกปิดใช้งาน กรุณาเข้าสู่ระบบด้วยช่องทางเดิม หรือติดต่อผู้ดูแลระบบ',
    ACCOUNT_INACTIVE: ACCOUNT_INACTIVE_MESSAGE_TH,
};

const GENERIC_LOGIN_FAILED_TH = 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
const GENERIC_CONNECTION_FAILED_TH = 'ไม่สามารถเชื่อมต่อระบบได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง';

/** The callback POST's response envelope — the fields this page reads. */
interface CallbackEnvelope {
    success?: boolean;
    code?: string;
    error?: string;
    message?: string;
    // Item 5: shared/api-response.js sendErrorResponse ships this on every
    // error envelope — resolveErrorCode prefers it over `error`/`message`
    // when the local IDP_CALLBACK_ERROR_MAP has no entry for `code`.
    messageTh?: string;
    data?: {
        // The full user shape (id/firstName/lastName/role — auth-idp.js
        // resolveThaidSession's success response) so it can be handed
        // straight to `AuthService.saveSession({ user })` unchanged.
        user?: AuthUser;
        // Password-path wire shape (auth-provider.js:200-204), snake_case —
        // the IdP path will emit the SAME shape once Task 2 lands (R-A).
        mfa_required?: boolean;
        mfa_session?: string;
    };
}

/**
 * Same health-vs-provider split the Next middleware and every
 * password-login page already use (middleware-helpers.ts, role-utils.ts) —
 * not a new mapping.
 */
function destinationForRole(role: string | null | undefined): string {
    return isProviderRole(role) ? PROVIDER_DASHBOARD_ROUTE : HEALTH_DASHBOARD_ROUTE;
}

type ViewState =
    | { kind: 'loading' }
    | { kind: 'error'; message: string; detail?: string }
    | { kind: 'mfa'; mfaSession: string };

export default function IdpCallbackPage() {
    const params = useParams();
    const provider = typeof params?.provider === 'string' ? params.provider : '';
    const searchParams = useSearchParams();
    const router = useRouter();
    const [view, setView] = useState<ViewState>({ kind: 'loading' });

    useEffect(() => {
        // BORA itself rejected the request (or the citizen pressed deny) —
        // nothing to exchange, render the card immediately.
        const boraError = searchParams.get('error');
        if (boraError) {
            const description = searchParams.get('error_description');
            setView({
                kind: 'error',
                message: resolveErrorCode({ code: boraError }, BORA_OAUTH_ERROR_MAP, GENERIC_LOGIN_FAILED_TH),
                // exactOptionalPropertyTypes: only include `detail` when BORA
                // actually sent one — assigning `detail: undefined` explicitly
                // is a type error under this tsconfig (and would render an
                // empty detail block).
                ...(description ? { detail: description } : {}),
            });
            return;
        }

        const code = searchParams.get('code');
        const state = searchParams.get('state');
        if (!code || !state || !provider) {
            setView({ kind: 'error', message: GENERIC_LOGIN_FAILED_TH });
            return;
        }

        let cancelled = false;
        void (async () => {
            try {
                const res = await idpFetch(`/api/auth/idp/${provider}/callback`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code, state }),
                });
                const body = (await res.json().catch(() => null)) as CallbackEnvelope | null;
                if (cancelled) return;

                if (res.ok && body?.success) {
                    const mfaSession = body.data?.mfa_session;
                    if (body.data?.mfa_required && mfaSession) {
                        setView({ kind: 'mfa', mfaSession });
                        return;
                    }
                    // Fix round 1: MUST hydrate AuthService's session cache
                    // BEFORE navigating away. ThaID's success body carries no
                    // token (cookie-only session), but saveSession populates
                    // `getUser()` from `data.user` regardless of whether a
                    // token is present — it only SKIPS the token-storage step
                    // when one is absent. Every /health/* landing page gates
                    // synchronously on `AuthService.getUser()` before it does
                    // anything else, so skipping this bounced every non-MFA
                    // citizen straight back to the login page.
                    const user = body.data?.user;
                    if (user) {
                        await AuthService.saveSession({ user });
                    }
                    router.replace(destinationForRole(user?.role));
                    return;
                }

                setView({
                    kind: 'error',
                    message: resolveErrorCode(body ?? undefined, IDP_CALLBACK_ERROR_MAP, GENERIC_LOGIN_FAILED_TH),
                });
            } catch {
                // Network/timeout — indeterminate, not a proven bad login
                // (thai-ui-copy: never assert a definitive bad state on a
                // fetch failure).
                if (!cancelled) {
                    setView({ kind: 'error', message: GENERIC_CONNECTION_FAILED_TH });
                }
            }
        })();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // The MFA verify flow (MfaChallengeForm) already calls
    // AuthService.saveSession itself once the code is confirmed — by the
    // time onSuccess fires, AuthService.getUser() holds the real role.
    const handleMfaSuccess = () => {
        router.replace(destinationForRole(AuthService.getUser()?.role));
    };

    if (view.kind === 'mfa') {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
                <Card className="w-full max-w-md p-2">
                    <MfaChallengeForm mfaSession={view.mfaSession} onSuccess={handleMfaSuccess} />
                </Card>
            </div>
        );
    }

    if (view.kind === 'error') {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
                <Card className="w-full max-w-md">
                    <CardHeader className="items-center text-center">
                        <span
                            aria-hidden="true"
                            className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"
                        >
                            <AlertTriangle className="h-7 w-7" aria-hidden="true" />
                        </span>
                        <CardTitle>เข้าสู่ระบบไม่สำเร็จ</CardTitle>
                        <CardDescription role="alert">{view.message}</CardDescription>
                    </CardHeader>
                    {view.detail && (
                        <CardContent>
                            <p className="text-xs text-muted-foreground">
                                รายละเอียดจากระบบยืนยันตัวตน: {view.detail}
                            </p>
                        </CardContent>
                    )}
                    <CardFooter className="justify-center">
                        <Button asChild variant="primary">
                            <Link href="/auth">กลับไปหน้าเข้าสู่ระบบ</Link>
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        );
    }

    // Loading — the farmer just came back from the ThaID app, no blank flash.
    return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
            <div className="flex flex-col items-center gap-4 text-center">
                <Spinner size="lg" label="กำลังเข้าสู่ระบบ..." />
                <p className="text-sm text-muted-foreground">กำลังยืนยันตัวตนกับระบบ กรุณารอสักครู่</p>
            </div>
        </div>
    );
}
