/**
 * Server-side URL builder for the PUBLIC certificate-verify fetch.
 *
 * C1 (core-system audit 2026-06-30): the verify page previously fetched
 * `${NEXT_PUBLIC_API_URL}/public/verify/<n>`. On staging/prod
 * `NEXT_PUBLIC_API_URL` is the BARE ORIGIN (e.g. https://staging.gacpth.com,
 * no `/api` segment), so the request resolved to
 * `https://staging.gacpth.com/public/verify/<n>` → 404 → `verified:false` →
 * EVERY genuine certificate rendered as INVALID on the most trust-sensitive
 * public surface.
 *
 * The backend route is mounted at `/api/v1/public/verify/:n` (and the unversioned
 * `/api/public/verify/:n`). The verify page is a SERVER component, so a relative
 * `/api/...` proxy path (which works from the browser) cannot be used for the
 * server-side fetch — we resolve the internal backend base instead, exactly like
 * the API proxy (`api/[...path]/route.ts`) does via `INTERNAL_BACKEND_URL`.
 *
 * `base` is injected (not read from env here) so this stays a pure, unit-testable
 * function; the page passes `INTERNAL_BACKEND_URL` from server.config.
 */
/**
 * URL-safe form of a certificate number. New certificates are stored as
 * `TH-GACP 87/2568` (a space and a slash — neither is safe in a path segment);
 * URLs and QR payloads carry `TH-GACP-87-2568`. Legacy `GACP-TH-…` numbers and
 * anything else pass through unchanged. The backend maps every spelling back to
 * the stored value (apps/backend/services/certificate-number-display.js).
 */
export function toCertificateSlug(certNumber: string): string {
    const raw = String(certNumber ?? '');
    const m = raw.trim().toUpperCase().match(/^TH-GACP[\s-]+(\d{1,9})\s*[/-]\s*(\d{4})$/);
    return m ? `TH-GACP-${Number(m[1])}-${m[2]}` : raw;
}

export function buildPublicVerifyUrl(base: string, certNumber: string): string {
    // Normalise: drop any trailing slash on the base, and strip a trailing
    // `/api` or `/api/v1` the env might already carry so we never double up.
    const trimmed = String(base || '')
        .replace(/\/+$/, '')
        .replace(/\/api(\/v1)?$/, '');
    const encoded = encodeURIComponent(toCertificateSlug(certNumber));
    return `${trimmed}/api/v1/public/verify/${encoded}`;
}

/**
 * PUBLIC verify PAGE URL builder (fix-round 1, review 6712f985).
 *
 * Not to be confused with `buildPublicVerifyUrl` above, which builds the
 * INTERNAL BACKEND API fetch URL. This builds the URL a human — or a QR
 * code — should open: the frontend's own `/verify/:certNumber` route. It
 * is the single source both the server-rendered verify page
 * (`app/(public)/verify/[cert-number]/page.tsx`) and the client-side
 * `CertificateService.getCertificateVerifyUrl` (used by the applicant
 * cert-detail page and the certificate-list QR dialog) build from, so a
 * misconfigured environment falls back to the SAME host everywhere instead
 * of three independently-typed literals silently drifting apart.
 */
export const DEFAULT_PUBLIC_HOST = 'https://gacpth.com';

export function buildPublicVerifyPageUrl(base: string, certNumber: string): string {
    const trimmed = String(base || DEFAULT_PUBLIC_HOST).replace(/\/+$/, '');
    const encoded = encodeURIComponent(toCertificateSlug(certNumber));
    return `${trimmed}/verify/${encoded}`;
}

/**
 * Host allowlist for resolving the PUBLIC origin from request headers.
 *
 * S1 hardening (review 6712f985): `x-forwarded-host` is attacker-supplied
 * input (any client can send it). Building a URL from it unvalidated and
 * embedding that URL in a QR code / verify link would let a forged header
 * make this app mint a "legitimate-looking" GACP verify link that actually
 * points at a host the requester chose. `resolvePublicOrigin` below only
 * ever returns an origin whose host matches this allowlist; anything else
 * (missing host, spoofed host, `localhost` in production, ...) falls back
 * to `DEFAULT_PUBLIC_HOST`.
 *
 * Extend the allowlist via `PUBLIC_VERIFY_HOST_ALLOWLIST` (comma-separated
 * bare hosts, e.g. "gacpth.com,staging.gacpth.com") — a PLAIN server-only
 * env var, deliberately NOT `NEXT_PUBLIC_*`: those are inlined at BUILD
 * time and empty at runtime in this app's deployment (see the C1 comment
 * in page.tsx), which is exactly why request headers are used at all; a
 * `NEXT_PUBLIC_*`-gated allowlist would silently never match and always
 * fall back to the default host. The hardcoded defaults below cover the
 * two known real hosts so the allowlist is safe-by-default even if the env
 * var is never set.
 */
const DEFAULT_ALLOWED_HOSTS = ['gacpth.com', 'staging.gacpth.com', 'localhost', '127.0.0.1'];

function allowedPublicHosts(): string[] {
    const fromEnv = String(process.env.PUBLIC_VERIFY_HOST_ALLOWLIST || '')
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean);
    return fromEnv.length > 0 ? fromEnv : DEFAULT_ALLOWED_HOSTS;
}

function hostMatchesAllowlist(host: string, allowlist: string[]): boolean {
    const bareHost = host.toLowerCase().replace(/:\d+$/, '');
    if (allowlist.includes(bareHost)) return true;
    // Allow subdomains of an allowlisted domain (e.g. a future
    // preview-x.gacpth.com) without needing an env update for every one.
    return allowlist.some((allowed) => allowed.includes('.') && bareHost.endsWith(`.${allowed}`));
}

/**
 * Resolve the origin (`scheme://host`) a verify-page QR should encode, from
 * the incoming request's `x-forwarded-host`/`host` + `x-forwarded-proto`.
 * Falls back to `DEFAULT_PUBLIC_HOST` whenever the host is missing or not
 * on the allowlist — never trusts the raw header value into the output.
 */
export function resolvePublicOrigin(
    requestHost: string | null | undefined,
    requestProto: string | null | undefined,
): string {
    const host = String(requestHost || '').trim();
    if (!host || !hostMatchesAllowlist(host, allowedPublicHosts())) {
        return DEFAULT_PUBLIC_HOST;
    }
    const proto = String(requestProto || 'https').trim() || 'https';
    return `${proto}://${host}`.replace(/\/+$/, '');
}
