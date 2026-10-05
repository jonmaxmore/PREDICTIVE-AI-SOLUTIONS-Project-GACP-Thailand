/**
 * Y1-FIX-D — Reusable Thai-friendly error-code resolver.
 *
 * Implements Policy 5 from `docs/i18n-policy.md` (every backend error
 * carries an English machine identifier; the UI maps to a Thai user
 * message via a per-component constant). The pattern was first
 * introduced by X4-FIX-C in `slip-review-modal.tsx::SLIP_REVIEW_ERROR_MAP`
 * + `resolveSlipReviewError`; this helper is the shared primitive so the
 * ADMIN modals (ChangeRoleModal, UserDisableModal, ForceStatusModal;
 * ForceMfaResetModal was removed 2026-09-26) can adopt the same pattern
 * without duplicating ~6 lines each.
 *
 * Design contract:
 *
 * - The map is a plain `Record<string, string>` keyed on the backend's
 *   stable English `err.code` identifier. The corresponding value is the
 *   Thai message rendered in the toast or `<Alert>`.
 * - `resolveErrorCode` consumes a backend envelope shape
 *   (`{ success, error?, code?, message? }`) and falls through in this
 *   order: (1) Thai message from the map, (2) the envelope's `error` /
 *   `message` field, (3) a caller-supplied fallback.
 * - Null / undefined envelopes return the fallback unchanged so the
 *   helper is safe to call inside a `catch` block before checking
 *   the response shape.
 * - The helper is dependency-free (no React, no toast adapter) so it
 *   can be unit-tested with the pure-helper pattern that Y1-AUDIT §10
 *   gate verification §1 + dictionary parity test rely on.
 */

export interface ErrorCodeEnvelope {
    /** Backend error code identifier (English, stable). */
    code?: string;
    /** Human-readable backend message (typically English). */
    error?: string;
    /**
     * Some envelopes use `message` instead of `error` (RFC 7807
     * Problem Details adapter, audit-log subsystem). We accept both.
     */
    message?: string;
    /**
     * Item 5 (council final-fix round): `shared/api-response.js`
     * `sendErrorResponse` ships a `messageTh` field on EVERY error envelope
     * (resolved from the caller's own `messageTh` or the catalog's default —
     * see `apps/backend/shared/api-response.js:107-125`). Before this field
     * existed here, a code with no entry in the caller's local `errorMap`
     * fell through to `envelope.error`/`envelope.message` — English — even
     * though the backend had already sent a perfectly good Thai string.
     */
    messageTh?: string;
}

/**
 * Resolve a backend error envelope into a Thai-friendly message using
 * a per-component error-code map.
 *
 * Fallback order: (1) the caller's own per-component Thai copy for a known
 * `code` — kept first so a component can deliberately word a code
 * differently from the catalog's generic default; (2) the backend's own
 * `messageTh`, when the envelope carries one (Item 5 — prefer Thai over
 * English whenever the backend already sent Thai); (3) the backend's English
 * `error`/`message`; (4) the caller-supplied fallback.
 *
 * @param envelope - Backend response (or null when the caller is
 *   inside a network-failure `catch` block).
 * @param errorMap - Per-component map of code → Thai message.
 * @param fallback - Caller-supplied default when no other source
 *   yields a string. Should itself be Thai (per Policy 5 / Policy 1+2).
 */
export function resolveErrorCode(
    envelope: ErrorCodeEnvelope | null | undefined,
    errorMap: Readonly<Record<string, string>>,
    fallback: string,
): string {
    if (!envelope) return fallback;
    const code = envelope.code;
    if (code && errorMap[code]) return errorMap[code];
    return envelope.messageTh || envelope.error || envelope.message || fallback;
}

/**
 * Type guard for narrowing — handy when consumers want to know if a
 * particular code is in the map before branching their UI on it. Use
 * sparingly; prefer `resolveErrorCode` which returns the Thai message
 * directly.
 */
export function hasMappedErrorCode(
    code: string | null | undefined,
    errorMap: Readonly<Record<string, string>>,
): code is string {
    return typeof code === 'string' && code.length > 0 && Object.prototype.hasOwnProperty.call(errorMap, code);
}
