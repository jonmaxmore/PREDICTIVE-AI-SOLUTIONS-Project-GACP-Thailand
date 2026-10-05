/**
 * ACCOUNT_INACTIVE — the backend's answer for an account that may not hold a
 * session: suspended by an administrator, or deleted.
 *
 * Since wave 1 (SECU-03) every door gives this answer, always about the
 * caller's own account:
 *   - authenticate* middleware  403 { error:'Forbidden', message:'<th> / <en>', code }
 *   - POST /auth/health/refresh  403, with messageTh
 *   - GET  /auth/provider/me     401, with messageTh
 *   - both password login doors  403, with messageTh
 *   - ThaID callback             403, with messageTh (idp-client, not api-client)
 *
 * api-client ends the session on it, the way a refused refresh does, and sends
 * the user to their portal's login page with `?reason=account_inactive`
 * (AuthService.endInactiveAccountSession). The login page shows
 * ACCOUNT_INACTIVE_MESSAGE_TH for that reason. It never shows text taken from
 * the URL.
 *
 * Leaving the page is the delicate part. The officer's provider_token is an
 * httpOnly cookie, so only POST /api/session/clear-cookie can remove it, and a
 * full page load started before that request answers aborts it. The cookie then
 * rides along, and middleware.ts sends a cookied officer from the login page
 * back to the dashboard, without the reason. So the client:
 *   1. sets the sign-out marker cookie below. On https its name carries the
 *      `__Host-` prefix, so the browser requires Secure, Path=/ and no Domain:
 *      a page on a sibling subdomain (staging., preview.) cannot plant it for
 *      this host, and neither can anyone rewriting plain-http traffic,
 *   2. waits, for a bounded time, for clear-cookie to answer, then navigates.
 * middleware.ts lets a login-page request that carries both the marker and the
 * reason through, and clears the session cookies itself. The login page shows
 * the notice only when the marker is there, then removes it. A link from
 * elsewhere with `?reason=account_inactive` therefore neither signs anyone out
 * nor tells them their account is suspended.
 *
 * There is no account recovery (operator, 2026-09-17), so the message does not
 * promise one. It says what happened and who to contact.
 */
import { resolveLoginRouteForPath } from '../constants/auth-routes';

export const ACCOUNT_INACTIVE_CODE = 'ACCOUNT_INACTIVE';

/** `?reason=` value the login pages recognise. */
export const SIGNED_OUT_REASON_PARAM = 'reason';
export const ACCOUNT_INACTIVE_REASON = 'account_inactive';

/**
 * Same sentence as the backend catalogue row (apps/backend/shared/error-codes.js
 * ACCOUNT_INACTIVE.messageTh). Used when a response carries no Thai of its own,
 * and on the login page after a sign-out.
 */
export const ACCOUNT_INACTIVE_MESSAGE_TH =
    'บัญชีของคุณถูกระงับการใช้งาน หากมีข้อสงสัย กรุณาติดต่อเจ้าหน้าที่กรมการแพทย์แผนไทยและการแพทย์ทางเลือก';
export const ACCOUNT_INACTIVE_MESSAGE_EN =
    'Your account has been suspended. If you have any questions, please contact DTAM staff.';

const THAI = /[฀-๿]/;

/** True for a raw backend body whose code is ACCOUNT_INACTIVE. */
export function isAccountInactiveBody(body: unknown): boolean {
    return Boolean(body)
        && typeof body === 'object'
        && (body as Record<string, unknown>).code === ACCOUNT_INACTIVE_CODE;
}

/** The backend's own Thai sentence (`messageTh`) when it sent one, otherwise ours. */
export function accountInactiveMessage(body: unknown): string {
    const messageTh = body && typeof body === 'object'
        ? (body as Record<string, unknown>).messageTh
        : undefined;
    if (typeof messageTh === 'string' && THAI.test(messageTh)) {
        return messageTh.trim();
    }
    return ACCOUNT_INACTIVE_MESSAGE_TH;
}

/** The login page of the portal `pathname` belongs to, with the sign-out reason. */
export function accountInactiveLoginUrl(pathname: string): string {
    return `${resolveLoginRouteForPath(pathname)}?${SIGNED_OUT_REASON_PARAM}=${ACCOUNT_INACTIVE_REASON}`;
}

/** Base name of the cookie our own pages set just before leaving for the login page. */
const SIGNED_OUT_MARKER_BASE = 'signed_out_reason';
/** Long enough for a slow page load. The login page removes it sooner. */
const SIGNED_OUT_MARKER_MAX_AGE_SECONDS = 120;

/**
 * The marker's name. On https it is `__Host-signed_out_reason`: the prefix makes
 * the browser refuse the cookie unless it is Secure, has Path=/ and no Domain,
 * so only a page served by this exact host can set it. Browsers refuse Secure
 * cookies on plain http, so local development keeps the bare name — and the
 * middleware accepts the bare name only on plain http (see middleware.ts).
 */
export function signedOutMarkerCookieName(secure: boolean): string {
    return secure ? `__Host-${SIGNED_OUT_MARKER_BASE}` : SIGNED_OUT_MARKER_BASE;
}

type ParamsLike = { get(name: string): string | null } | null | undefined;

function pageIsSecure(): boolean {
    return typeof window !== 'undefined' && window.location.protocol === 'https:';
}

function markerAttributes(maxAgeSeconds: number): string {
    const secure = pageIsSecure() ? '; secure' : '';
    return `path=/; max-age=${maxAgeSeconds}; samesite=lax${secure}`;
}

function readMarker(): string | null {
    if (typeof document === 'undefined') return null;
    const wanted = signedOutMarkerCookieName(pageIsSecure());
    for (const part of document.cookie.split(';')) {
        const [name, ...value] = part.trim().split('=');
        if (name === wanted) return decodeCookieValue(value.join('='));
    }
    return null;
}

/** middleware.ts reads cookie values percent-decoded (Next's cookie parser); read them the same way here. */
function decodeCookieValue(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

/**
 * The marker's value is `account_inactive.<id>`, the id naming the sign-out
 * that set it, so a tab can tell its own marker from one another tab set for a
 * different user. No other value counts: no released page ever set the marker
 * without an id.
 */
const MARKER_VALUE = new RegExp(`^${ACCOUNT_INACTIVE_REASON}\\.([0-9a-f]{16})$`);

/** The id of the sign-out that set the marker, or null when the value is not a marker. */
function markerId(value: string | null | undefined): string | null {
    const match = typeof value === 'string' ? MARKER_VALUE.exec(value) : null;
    return match?.[1] ?? null;
}

/**
 * The id only has to differ from the ids other tabs pick; it guards nothing
 * (the `__Host-` name does). So a browser without a working
 * crypto.getRandomValues falls back to Math.random rather than failing the
 * sign-out.
 */
function newSignOutId(): string {
    const bytes = new Uint8Array(8);
    try {
        crypto.getRandomValues(bytes);
    } catch {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// sessionStorage belongs to one tab and survives that tab's own navigations,
// unlike the cookie, which every tab of the site shares. It holds the id of the
// marker this tab set. A tab whose user chose to stay keeps it, and it then
// matches no marker another tab sets later.
const MARKER_SET_IN_THIS_TAB_KEY = 'gacp.signedOutMarkerSetInThisTab';

function rememberMarkerSetHere(id: string): void {
    try {
        sessionStorage.setItem(MARKER_SET_IN_THIS_TAB_KEY, id);
    } catch {
        // storage unavailable (private mode, blocked): the marker then simply expires
    }
}

/** The id of the marker this tab set, if any; forgets it either way. */
function takeMarkerSetHere(): string | null {
    try {
        const id = sessionStorage.getItem(MARKER_SET_IN_THIS_TAB_KEY);
        sessionStorage.removeItem(MARKER_SET_IN_THIS_TAB_KEY);
        return id;
    } catch {
        return null;
    }
}

function removeMarker(): void {
    document.cookie = `${signedOutMarkerCookieName(pageIsSecure())}=; ${markerAttributes(0)}`;
}

/** Record, for the next page load, that this client signed out an inactive account. */
export function markAccountInactiveSignOut(): void {
    if (typeof document === 'undefined') return;
    const id = newSignOutId();
    const name = signedOutMarkerCookieName(pageIsSecure());
    document.cookie = `${name}=${ACCOUNT_INACTIVE_REASON}.${id}; ${markerAttributes(SIGNED_OUT_MARKER_MAX_AGE_SECONDS)}`;
    rememberMarkerSetHere(id);
}

/**
 * For the login page: whether this client has just signed the user out because
 * the account is inactive (the reason is in the URL and our marker is set).
 * Removes the marker when the answer is true, so the notice is shown once.
 *
 * A login page without the reason removes the marker only when it is the one
 * THIS tab set: that tab's own navigation was replaced (e.g. by
 * `?expired=true`), so nobody will come for the marker and it must not linger
 * for the next visitor. A marker set by another tab is left for that tab's
 * landing — when an account is suspended, a second tab sees the session vanish
 * and opens a plain login page before the first tab reaches the page that says
 * why.
 */
export function consumeAccountInactiveSignOut(params: ParamsLike): boolean {
    const id = markerId(readMarker());
    const idSetHere = takeMarkerSetHere();
    if (params?.get(SIGNED_OUT_REASON_PARAM) === ACCOUNT_INACTIVE_REASON && id !== null) {
        removeMarker();
        return true;
    }
    if (id !== null && id === idSetHere) removeMarker();
    return false;
}

/**
 * For middleware.ts: whether a request is the page load that follows an
 * inactive-account sign-out (the reason is in the URL and the marker is set).
 */
export function isAccountInactiveSignOutRequest(params: ParamsLike, markerValue: string | undefined): boolean {
    return params?.get(SIGNED_OUT_REASON_PARAM) === ACCOUNT_INACTIVE_REASON
        && markerId(markerValue) !== null;
}
