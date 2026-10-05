/**
 * idpFetch — direct-to-backend-origin transport for the three IdP OAuth
 * calls (`GET /providers`, `POST /:provider/authorize-url`,
 * `POST /:provider/callback`).
 *
 * R-B (council ruling, design notes
 * readiness-design.md §R-B): these calls must NOT go through the universal
 * Next proxy (`app/api/[...path]/route.ts`) — that proxy drops cookies in
 * both directions, which kills the `idp_state` CSRF cookie the
 * authorize-url step sets and the callback step needs back. Going straight
 * to the backend origin works because cookies are host-scoped, not
 * origin-scoped: the browser ignores the port when deciding whether to
 * attach/accept a cookie, so `idp_state` (and `provider_token` on success)
 * set by a response from `http://localhost:8000` is sent on — and visible
 * to — a later request to `http://localhost:3000` too. `credentials:
 * 'include'` is what makes the browser send/store cookies on this
 * cross-origin (different-port) fetch at all; without it every leg of the
 * flow is cookie-blind.
 *
 * Deliberately thin: no auth header injection, no retry, no response
 * parsing. Every caller (login-chooser's provider buttons, the callback
 * page) already owns its own response handling and error copy — this
 * helper's only job is "right origin, cookies included" so a sandbox → prod
 * ThaID registration is a `NEXT_PUBLIC_BACKEND_ORIGIN` env change, not a
 * code change.
 */

/** Only ever right when the browser itself is on localhost — see idpBackendOrigin. */
const DEFAULT_BACKEND_ORIGIN = 'http://localhost:8000';

/**
 * The backend origin the three IdP calls target, resolved fresh per call.
 *
 * Order: the env var (explicit configuration always wins — a deployment whose backend
 * lives on another host must be able to say so) → the page's OWN origin when the browser
 * is on a real host → localhost, which is only reachable when the browser IS on localhost.
 *
 * The middle rung was added 2026-09-06, after the localhost fallback shipped to the open
 * demo and took the ministry login path down for every visitor. `NEXT_PUBLIC_*` is inlined
 * by Next at BUILD time, so an image built without the variable carries `localhost:8000`
 * in the bundle and NO amount of container environment fixes it — every phone that opened
 * demo.gacpth.com called its own localhost, the fetch failed, and login-chooser did the
 * right fail-closed thing: it badged ThaID and Health ID ตรวจสถานะไม่ได้ and refused to
 * hand anyone to a door it could not verify. Correct behaviour, impossible cause.
 *
 * Same-origin is the right rung because the platform serves the API on the page's own
 * host: nginx routes `location /api/auth/` straight to the backend container, so this is
 * NOT the Next `[...path]` proxy that ruling R-B forbids (that proxy drops the idp_state
 * CSRF cookie), and the cookie stays host-scoped exactly as R-B requires.
 */
export function idpBackendOrigin(): string {
    const configured = process.env.NEXT_PUBLIC_BACKEND_ORIGIN;
    if (configured) return configured;
    if (typeof window !== 'undefined' && !isLocalhost(window.location.hostname)) {
        return window.location.origin;
    }
    return DEFAULT_BACKEND_ORIGIN;
}

function isLocalhost(hostname: string): boolean {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * Item 6 (council final-fix round), reworded 2026-09-06 when the failure it predicted
 * actually happened on the open demo.
 *
 * The origin now falls back to the page's own host rather than localhost, so an image
 * built without the variable WORKS. This stays loud anyway: the two halves of the app
 * still disagree when it is unset — `middleware.ts:35` defaults to `https://gacpth.com`,
 * this file to the current origin — and an implicit answer is not a configuration. On a
 * deployment whose backend is on another host, the fallback is silently wrong, and that
 * is the case this message exists to catch before a citizen does.
 *
 * Diagnostic only, never throws. Fires at most once per page load, and only when both
 * (a) the variable is genuinely unset and (b) the browser is not itself on localhost.
 */
let misconfigWarned = false;
function warnIfBackendOriginMisconfigured(): void {
    if (misconfigWarned) return;
    if (process.env.NEXT_PUBLIC_BACKEND_ORIGIN) return;
    if (typeof window === 'undefined') return;
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return;
    misconfigWarned = true;
    // eslint-disable-next-line no-console -- intentional loud diagnostic, not app logging
    console.error(
        '[idp-client] NEXT_PUBLIC_BACKEND_ORIGIN is not set — using this page\'s own ' +
        `origin (${window.location.origin}) for ThaID/Health ID/Provider ID sign-in. ` +
        'That is correct only while the backend is served on the same host; set the ' +
        'variable at BUILD time (Next inlines NEXT_PUBLIC_* into the bundle) if it is not. ' +
        'ตัวแปรสภาพแวดล้อม NEXT_PUBLIC_BACKEND_ORIGIN ไม่ได้ถูกตั้งค่า ' +
        'ระบบจะใช้โดเมนของหน้านี้เองในการเรียก backend ซึ่งถูกต้องเฉพาะเมื่อ backend ' +
        'อยู่โดเมนเดียวกัน กรุณาตั้งค่าตัวแปรนี้ตอน build ถ้าไม่ใช่',
    );
}

/**
 * fetch(`${idpBackendOrigin()}${path}`, { ...init, credentials: 'include' }).
 * `credentials` is always forced to `'include'` — that is the entire point
 * of this helper — every other `init` field passes through unchanged.
 */
export function idpFetch(path: string, init: RequestInit = {}): Promise<Response> {
    warnIfBackendOriginMisconfigured();
    return fetch(`${idpBackendOrigin()}${path}`, {
        ...init,
        credentials: 'include',
    });
}
