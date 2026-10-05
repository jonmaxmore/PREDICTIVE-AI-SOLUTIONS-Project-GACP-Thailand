import { logger } from '@/lib/logger';
/**
 * API Client - Centralized HTTP Client with Auth Interceptor
 * 
 * This client fixes "Broken Chain" by automatically attaching
 * Authorization headers to all requests.
 * 
 * Usage:
 *   import { apiClient } from '@/lib/api/api-client';
 *   
 *   // GET request:
 *   const data = await apiClient.get<any>('/api/users/me');
 *   
 *   // POST request:
 *   const result = await apiClient.post<any>('/api/applications', { name: 'test' });
 */

import { AuthService } from '../services/auth-service';
import {
    ENTITY_PERMISSION_DENIED_CODE,
    ENTITY_PERMISSION_DENIED_FALLBACK_TH,
    entityPermissionDenialMessage,
    isEntityPermissionDenialBody,
} from './entity-permission-denial';
import {
    ACCOUNT_INACTIVE_CODE,
    accountInactiveMessage,
    isAccountInactiveBody,
} from './account-inactive';

// Response types
export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
    /**
     * Raw backend error identifier captured BEFORE `toUserFriendlyError`
     * rewriting. Use this to branch on machine-readable codes (e.g.
     * 'PENDING_INVOICES_IN_PERIOD', 'ALREADY_CLOSED') without relying on
     * the human-friendly Thai message in `.error`.
     *
     * Additive — undefined on success and on non-error envelopes.
     * See Iter R1 review H-3 / R5-C for rationale.
     */
    code?: string;
    /**
     * Sibling fields from the backend error envelope that are not
     * `success`/`data`/`error`/`message`/`code`. Lets UIs surface
     * structured metadata such as `openInvoices`, `warnings`,
     * `periodCloseId`, `originalCloser` without backend changes.
     *
     * Additive — undefined on success and when the backend returns
     * no extra metadata.
     */
    meta?: Record<string, unknown>;
    /**
     * HTTP status code of the response (set on error responses). Lets callers
     * branch on HTTP semantics — e.g. the login flow distinguishes
     * a 401 credential rejection (do NOT retry legacy) from a 404/5xx infra
     * failure (fall back to the legacy login path). Additive — undefined on
     * success and on network/timeout errors (no HTTP response).
     */
    status?: number;
    /**
     * The backend envelope's own `code` field, verbatim (e.g. 'APPLICATION_NOT_EDITABLE').
     *
     * `code` above is harvested as `data.error || data.code`, and many routes put a message
     * in `error` (respondError keeps the route's own message there), so on those routes
     * `code` holds the message and the machine code is lost. Round 5b (staging-walk-0930):
     * the wizard's detach on 409 APPLICATION_NOT_EDITABLE / 404 APPLICATION_NOT_FOUND never
     * fired against the real envelope for exactly this reason. Additive: `code` and
     * `error` keep their meaning for every existing caller.
     */
    errorCode?: string;
    /**
     * Set only when there is no usable reply at all (autosave-lost-reply, staging walk
     * 2026-10-02):
     *   NETWORK          — the request never got an answer (dropped connection, DNS, CORS);
     *   TIMEOUT          — no answer within the timeout;
     *   UNREADABLE_REPLY — a 2xx arrived but its body could not be read or was not JSON.
     *                      The server ANSWERED OK, so whatever the request did has most
     *                      likely happened; the reply was lost on the way back.
     * A caller that can safely repeat its request (the draft autosave) treats all three as
     * "try again", never as a server refusal. Additive: `error`, `code`, `status` and
     * `errorCode` keep exactly their previous values, and undefined everywhere else.
     */
    transportFailure?: 'NETWORK' | 'TIMEOUT' | 'UNREADABLE_REPLY';
}

/**
 * Keys reserved by the envelope itself — every OTHER top-level field
 * the backend ships in a non-2xx body is harvested into `.meta` so
 * callers can read structured metadata without backend changes.
 *
 * Module-level constant (not per-request alloc) — used by the
 * envelope-meta harvester in `request()`.
 */
const ENVELOPE_RESERVED_KEYS = new Set(['success', 'data', 'error', 'message', 'code']);

function extractEnvelopeMeta(data: Record<string, unknown> | null): Record<string, unknown> | undefined {
    if (!data || typeof data !== 'object') return undefined;
    const meta: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
        if (ENVELOPE_RESERVED_KEYS.has(k)) continue;
        meta[k] = v;
    }
    return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * Password login, registration and identifier checks. A refusal from these is
 * about the credentials just typed, not about the session in this browser.
 */
function isCredentialEndpoint(url: string): boolean {
    return url.includes('/auth/') && (
        url.includes('/login') || url.includes('/register') || url.includes('/check-identifier')
    );
}

/** The JSON body of an error response, or null. Never throws. */
async function readJsonBody(response: Response): Promise<Record<string, unknown> | null> {
    try {
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) return null;
        return await response.json();
    } catch {
        return null;
    }
}

// Request options
interface RequestOptions extends Omit<RequestInit, 'body'> {
    body?: unknown;
    // When true, this request deliberately carries no credential. It therefore
    // implies suppressAuthRedirect — see the default below.
    skipAuth?: boolean;
    timeout?: number;
    // When true, a 401 on this request does NOT clear the session or redirect
    // to login — the error is returned to the caller instead. Use for optional /
    // cross-portal enrichment calls (e.g. a HEALTH page reading a provider-only
    // endpoint): a 401 there means "not authorized for THIS resource", not that
    // the user's session expired, so it must not log the whole session out.
    //
    // Defaults to `skipAuth`: a request that sent no token cannot have had a
    // session expire on it. Pass `false` explicitly to opt back in.
    suppressAuthRedirect?: boolean;
}

class ApiClient {
    private baseUrl: string;
    private defaultTimeout: number;

    constructor(baseUrl = '', timeout = 30000) {
        this.baseUrl = baseUrl;
        this.defaultTimeout = timeout;
    }
    private toUserFriendlyError(error: string | undefined, statusCode?: number): string {
        const raw = String(error || '').trim();
        const normalized = raw.toLowerCase();

        if (!raw) {
            return statusCode
                ? `ไม่สามารถดำเนินการได้ (HTTP ${statusCode})`
                : 'ไม่สามารถดำเนินการได้';
        }

        // ── Auth-related errors → Thai ─────────────────────────────────
        if (normalized.includes('invalid credentials') || normalized.includes('invalid password')) {
            return 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง';
        }
        if (normalized.includes('account not found') || normalized.includes('user not found')) {
            return 'ไม่พบบัญชีผู้ใช้ กรุณาตรวจสอบเลขบัตรประชาชน';
        }
        if (normalized.includes('account locked') || normalized.includes('account disabled')) {
            return 'บัญชีถูกระงับชั่วคราว กรุณาติดต่อเจ้าหน้าที่';
        }
        if (normalized.includes('too many') || normalized.includes('rate limit')) {
            return 'คุณลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่';
        }
        if (normalized.includes('session expired') || normalized.includes('token expired')) {
            return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง';
        }
        if (normalized.includes('login failed')) {
            return 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง';
        }
        // 403 / authorization → Thai (backend returns a bare 'Forbidden' that used
        // to leak through verbatim under a Thai heading — the most common 403 shape).
        if (statusCode === 403 || normalized === 'forbidden' || normalized.includes('access denied')) {
            return 'คุณไม่มีสิทธิ์ดำเนินการนี้ กรุณาเข้าสู่ระบบใหม่หรือติดต่อเจ้าหน้าที่';
        }

        // ── Payment-related errors → Thai ──────────────────────────────
        if (
            normalized.includes('invoice already paid')
            || normalized.includes('phase 1 already paid')
            || normalized.includes('phase 2 already paid')
        ) {
            return 'รายการนี้ชำระเงินแล้ว';
        }

        if (normalized.includes('receipt already issued')) {
            return 'ใบเสร็จรับเงินออกแล้ว';
        }

        // ── System errors → Thai ───────────────────────────────────────
        // W1-COPY: only the backend's explicit "still booting" signal may
        // claim the system is starting. A generic 'service unavailable'
        // (e.g. the Next proxy's 503 BACKEND_UNREACHABLE envelope when the
        // backend is down) is NOT a startup — telling farmers "ระบบกำลัง
        // เริ่มต้น" was a half-truth implying waiting alone will fix it.
        if (normalized.includes('database connection is initializing')) {
            return 'ระบบกำลังเริ่มต้น กรุณารอสักครู่แล้วลองใหม่';
        }
        if (normalized.includes('service unavailable')) {
            return 'ยังเชื่อมต่อระบบไม่ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง';
        }

        if (normalized.includes('invalid webhook signature')) {
            return 'การตรวจสอบการชำระเงินล้มเหลว กรุณาลองอีกครั้ง';
        }

        if (normalized.includes('unable to connect') || normalized.includes('network error') || normalized.includes('fetch failed')) {
            return 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต';
        }

        // Final safety: detect stack traces, file paths, or internal errors
        // and replace with generic message to prevent leaking developer details
        const looksLikeInternalError =
            /at\s+\w+\s*\(/i.test(raw) ||         // stack trace: "at Function ("
            /\.(js|ts|mjs):\d+/i.test(raw) ||      // file:line patterns
            /node_modules\//i.test(raw) ||          // node_modules paths
            /\/app\//i.test(raw) ||                 // Docker app paths
            /Error:\s/i.test(raw) ||                // "Error: something" patterns
            raw.length > 300;                       // suspiciously long messages

        if (looksLikeInternalError) {
            return statusCode
                ? `เกิดข้อผิดพลาดภายในระบบ (HTTP ${statusCode})`
                : 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองอีกครั้ง';
        }

        return raw;
    }


    /**
     * The account behind this session is suspended or deleted (ACCOUNT_INACTIVE),
     * so no call made with it will succeed again. AuthService ends the session
     * the way a refused refresh does and, once the server-side cookies are gone,
     * sends the user to their portal's login page, which says why. The caller
     * gets its answer now; the page load follows.
     *
     * This also runs for suppressAuthRedirect calls. The backend reads the
     * portal's cookie before the Bearer header, so on a cross-portal call a stale
     * cookie of ANOTHER, suspended account in this browser could answer this code
     * and end a valid session. It needs two accounts in one browser, and the
     * sign-out clears every session cookie, so it cannot repeat.
     */
    private endInactiveAccountSession<T>(body: Record<string, unknown> | null, status: number): ApiResponse<T> {
        logger.warn('[ApiClient] Account is inactive - ending session');
        void AuthService.endInactiveAccountSession();

        return {
            success: false,
            error: accountInactiveMessage(body),
            status,
            code: ACCOUNT_INACTIVE_CODE,
        };
    }

    private getCsrfToken(): string | null {
        if (typeof document === 'undefined') return null;
        const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
        const csrfValue = match?.[1];
        if (csrfValue) return decodeURIComponent(csrfValue);
        // Double-submit CSRF: the backend (csrf-middleware) only checks that the
        // `csrf_token` cookie === the `x-csrf-token` header — the value itself is
        // not secret; the protection is that a cross-site attacker can neither
        // read nor set this same-origin, non-HttpOnly cookie. The cookie is only
        // seeded on some flows, so if it's missing we MINT one here (the
        // documented "client mints a random csrf_token" pattern) — otherwise
        // every mutation in an un-seeded session 403s with CSRF_MISMATCH
        // (e.g. the provider form-fields edit, 2026-06-25).
        try {
            const minted = (typeof globalThis.crypto?.randomUUID === 'function')
                ? globalThis.crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            document.cookie = `csrf_token=${minted}; path=/; SameSite=Lax`;
            return minted;
        } catch {
            return null;
        }
    }

    /**
     * Make HTTP request with automatic auth header injection
     */
    private async request<T>(
        endpoint: string,
        options: RequestOptions = {}
    ): Promise<ApiResponse<T>> {
        // A request that deliberately sends no credential will 401 whenever the door
        // needs one, and that 401 means "this door needs a key" — never "your key
        // expired". Defaulting the redirect suppression to skipAuth closes the class at
        // the source: measured 2026-09-07, a signed-in farmer who pressed a button on the
        // PUBLIC /verify page was logged out of the platform, because the portal's
        // skipAuth calls hit partner-key-gated routes and the 401 fell into the
        // session-expired branch below. Fixing it per-call-site would leave the next
        // caller who forgets to write both flags with the same bug.
        const { skipAuth = false, suppressAuthRedirect = skipAuth, timeout = this.defaultTimeout, body, ...init } = options;
        const method = (init.method || 'GET').toUpperCase();

        // Build headers
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(init.headers as Record<string, string>),
        };

        if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
            const csrfToken = this.getCsrfToken();
            if (csrfToken) {
                headers['x-csrf-token'] = csrfToken;
            }
        }

        // Fallback: Only attach Authorization header if no httpOnly cookie available
        // Primary auth is via httpOnly cookie (credentials: 'include')
        // This fallback is for mobile apps that don't use cookies
        if (!skipAuth) {
            const token = AuthService.getToken();
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
        }

        // Smart Path Handling: Auto-prefix with /api if needed
        let fullEndpoint = endpoint;
        if (!endpoint.startsWith('http')) {
            if (!endpoint.startsWith('/api')) {
                // Prefix with /api for all paths
                fullEndpoint = `/api${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
            }
        }

        // Build full URL
        const url = fullEndpoint.startsWith('http') ? fullEndpoint : `${this.baseUrl}${fullEndpoint}`;

        // Setup abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        // Handle FormData (remove Content-Type to let browser set boundary)
        if (body instanceof FormData) {
            delete headers['Content-Type'];
        }

        try {
            const response = await fetch(url, {
                ...init,
                headers,
                ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
                signal: controller.signal,
                credentials: 'include', // Send httpOnly cookies automatically
            });

            // Fix round 1 (I2, autosave-lost-reply): the timeout is NOT cleared at the
            // headers any more. It keeps running until the body has been read, so a body
            // that stalls after the headers arrived ends as TIMEOUT instead of hanging the
            // caller forever (the wizard's pill sat on "syncing" and the submit gate waited
            // on it). `readBody` races each body read against the same abort signal, because
            // not every Response implementation rejects a pending read on abort.
            const abortedRead = new Promise<never>((_, reject) => {
                const fail = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                if (controller.signal.aborted) { fail(); return; }
                controller.signal.addEventListener('abort', fail, { once: true });
            });
            abortedRead.catch(() => undefined);
            const readBody = <R,>(read: () => Promise<R>): Promise<R> => Promise.race([read(), abortedRead]);

            // Handle 401 Unauthorized
            if (response.status === 401) {
                // Login/register endpoints: 401 means "invalid credentials", not "session expired"
                const isAuthEndpoint = isCredentialEndpoint(url);
                const errorData = await readBody(() => readJsonBody(response)).catch(() => null);
                clearTimeout(timeoutId);

                if (isAuthEndpoint) {
                    const backendMsg = String(
                        errorData?.messageTh || errorData?.message || errorData?.error || '',
                    ).trim();
                    // Preserve the raw backend code BEFORE the friendly-error rewrite
                    // so callers can still branch on machine-readable identifiers.
                    const rawCode = String(
                        errorData?.code || errorData?.error || '',
                    ).trim() || undefined;
                    const meta = extractEnvelopeMeta(errorData);
                    return {
                        success: false,
                        error: this.toUserFriendlyError(backendMsg || 'Invalid credentials', 401),
                        ...(rawCode !== undefined ? { code: rawCode } : {}),
                        ...(meta !== undefined ? { meta } : {}),
                    };
                }

                // GET /auth/provider/me answers a suspended account with 401
                // ACCOUNT_INACTIVE. That is about the account, whatever the
                // resource, so it ends the session even for an optional call.
                if (isAccountInactiveBody(errorData)) {
                    return this.endInactiveAccountSession<T>(errorData, 401);
                }

                // Optional / cross-portal enrichment call: a 401 here means
                // "not authorized for THIS resource", NOT that the session died.
                // Return the error WITHOUT clearing the session or redirecting —
                // otherwise one authz-mismatched sub-request (e.g. a HEALTH user
                // hitting a provider-only endpoint like /finance/credit-notes)
                // would log the whole valid session out and bounce the user to
                // login. (fix/auth-401-no-blanket-logout)
                if (suppressAuthRedirect) {
                    return {
                        success: false,
                        error: String(errorData?.message || errorData?.error || 'Unauthorized for this resource'),
                        ...(errorData?.code ? { code: String(errorData.code) } : {}),
                    };
                }

                // Non-auth endpoints: treat as session expired. AuthService clears
                // the session and, once the server-side cookies are gone, sends the
                // user to their portal's login page (not when already on one).
                logger.warn('[ApiClient] 401 Received - Session expired');
                void AuthService.endExpiredSession();

                return {
                    success: false,
                    error: 'Session expired. Please sign in again',
                };
            }

            // Parse JSON response when possible
            let data: Record<string, unknown> | null = null;
            const contentType = response.headers.get('content-type') || '';

            if (contentType.includes('application/json')) {
                try {
                    data = await readBody(() => response.json());
                } catch {
                    data = null;
                }
            } else {
                // Drain body to avoid unread stream warnings
                try {
                    await readBody(() => response.text());
                } catch {
                    // Ignore body parse errors
                }
            }

            clearTimeout(timeoutId);
            if (controller.signal.aborted) {
                return {
                    success: false,
                    error: 'Request timeout. Please try again',
                    transportFailure: 'TIMEOUT',
                };
            }

            // Handle API error responses
            if (!response.ok) {
                // SECU-03 — the account is suspended or deleted. Checked before the
                // generic 403 rewrite, which would tell the person to sign in again
                // and keep a session nothing can use. A login door's refusal is
                // about the credentials just typed, so it only carries the
                // backend's Thai sentence to the form.
                if (response.status === 403 && isAccountInactiveBody(data)) {
                    if (isCredentialEndpoint(url)) {
                        return {
                            success: false,
                            error: accountInactiveMessage(data),
                            status: 403,
                            code: ACCOUNT_INACTIVE_CODE,
                        };
                    }
                    return this.endInactiveAccountSession<T>(data, 403);
                }
                // Wave-C F2 — workspace per-permission denials (403
                // ENTITY_PERMISSION_DENIED, both `error`- and `message`-
                // carried Thai shapes) ship their own CORRECT copy from the
                // route. Pass it through instead of the blanket 403 rewrite
                // below, which wrongly told permission-denied workers to
                // re-login (their session is fine — they lack a farm
                // permission). `.code` is NORMALIZED here because the raw
                // harvest (data.error || data.code) would capture the Thai
                // message for the `error`-carried shape.
                if (response.status === 403 && isEntityPermissionDenialBody(data)) {
                    const denialMeta = extractEnvelopeMeta(data);
                    return {
                        success: false,
                        error: entityPermissionDenialMessage(data)
                            || ENTITY_PERMISSION_DENIED_FALLBACK_TH,
                        status: 403,
                        code: ENTITY_PERMISSION_DENIED_CODE,
                        ...(denialMeta !== undefined ? { meta: denialMeta } : {}),
                    };
                }
                const backendError = String(data?.error || data?.message || '');
                // Capture the raw backend identifier BEFORE friendly-error
                // rewriting so callers can branch on the machine-readable
                // code (e.g. 'PENDING_INVOICES_IN_PERIOD') instead of the
                // Thai-friendly display string.
                const rawCode = String(data?.error || data?.code || '').trim() || undefined;
                const envelopeCode = typeof data?.code === 'string' && data.code.trim() ? data.code.trim() : undefined;
                const meta = extractEnvelopeMeta(data);
                return {
                    success: false,
                    error: this.toUserFriendlyError(backendError, response.status),
                    status: response.status,
                    ...(rawCode !== undefined ? { code: rawCode } : {}),
                    ...(envelopeCode !== undefined ? { errorCode: envelopeCode } : {}),
                    ...(meta !== undefined ? { meta } : {}),
                };
            }

            if (!data) {
                return {
                    success: false,
                    error: 'Invalid server response',
                    // 204 is an answer with no body by definition, not a lost one.
                    ...(response.status !== 204 ? { transportFailure: 'UNREADABLE_REPLY' as const } : {}),
                };
            }

            // Gap 24 — harvest sibling fields (counts / total / pagination /
            // summary / meta …) that sit ALONGSIDE `data` onto `.meta`,
            // MIRRORING the error branch above. Previously the success strip
            // returned only the unwrapped `data`, silently dropping siblings —
            // a Scheduler/Admin list reading `res.meta.counts` on a 2xx got
            // `undefined` and blanked. `res.data` is UNCHANGED (existing
            // consumers rely on the unwrapped `body.data ?? body`); we only ADD
            // `.meta`. `extractEnvelopeMeta` strips the reserved envelope keys
            // (success/data/error/message/code), so the standard
            // `{success, data, …siblings}` shape yields exactly the siblings,
            // and a sibling-less envelope yields `undefined` (no `.meta`).
            const meta = extractEnvelopeMeta(data);
            return {
                success: true,
                data: ((data as Record<string, unknown>)?.data ?? data) as T,
                ...(meta !== undefined ? { meta } : {}),
            };
        } catch (error: unknown) {
            clearTimeout(timeoutId);

            // Handle abort/timeout
            if (error instanceof Error && error.name === 'AbortError') {
                return {
                    success: false,
                    error: 'Request timeout. Please try again',
                    transportFailure: 'TIMEOUT',
                };
            }

            // Handle network errors
            logger.error('[ApiClient] Request failed:', error);
            return {
                success: false,
                error: 'Unable to connect to server',
                transportFailure: 'NETWORK',
            };
        }
    }

    /**
     * GET request
     */
    async get<T>(endpoint: string, options?: RequestOptions): Promise<ApiResponse<T>> {
        return this.request<T>(endpoint, { ...options, method: 'GET' });
    }

    /**
     * POST request
     */
    async post<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
        return this.request<T>(endpoint, { ...options, method: 'POST', body });
    }

    /**
     * PUT request
     */
    async put<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
        return this.request<T>(endpoint, { ...options, method: 'PUT', body });
    }

    /**
     * PATCH request
     */
    async patch<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
        return this.request<T>(endpoint, { ...options, method: 'PATCH', body });
    }

    /**
     * DELETE request
     */
    async delete<T>(endpoint: string, options?: RequestOptions): Promise<ApiResponse<T>> {
        return this.request<T>(endpoint, { ...options, method: 'DELETE' });
    }

    /**
     * GET Blob request (for file downloads)
     */
    async getBlob(endpoint: string, options?: RequestOptions): Promise<Blob | null> {
        const { skipAuth = false, ...init } = options || {};

        const headers: Record<string, string> = {
            ...(init.headers as Record<string, string>),
        };

        if (!skipAuth) {
            const token = AuthService.getToken();
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
        }


        let fullEndpoint = endpoint;
        if (!endpoint.startsWith('http')) {
            if (!endpoint.startsWith('/api')) {
                fullEndpoint = `/api${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
            }
        }
        const url = fullEndpoint.startsWith('http') ? fullEndpoint : `${this.baseUrl}${fullEndpoint}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers,
                credentials: 'include',
            });

            if (!response.ok) return null;
            return await response.blob();
        } catch {
            return null;
        }
    }

    /**
     * Health check - for backwards compatibility
     */
    async health(): Promise<boolean> {
        try {
            const response = await this.get('/api/health', { skipAuth: true, timeout: 5000 });
            return response.success;
        } catch {
            return false;
        }
    }
}

// Export singleton instance
export const apiClient = new ApiClient();

// Export class for testing or custom instances
export { ApiClient };
export const api = apiClient;
