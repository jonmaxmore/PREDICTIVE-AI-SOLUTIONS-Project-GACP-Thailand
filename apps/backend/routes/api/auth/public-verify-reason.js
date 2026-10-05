/**
 * Public verifier — the ONE mapping from a certificate's live public state to
 * the reason a verifier is shown (ledger F-G4-57).
 *
 * The public verify endpoint has always answered a free-text English `reason`
 * ('Certificate has expired' | 'Certificate is suspended' | 'Certificate has
 * been revoked'), which is all a Thai citizen with a QR scanner ever got, and
 * nothing at all for a certificate superseded by a renewal. This module keeps
 * those English strings byte-identical for the consumers that already parse
 * them, and adds the MACHINE code next to them so a UI can say it in Thai —
 * one derivation, so the code and the sentence can never drift apart.
 *
 * Pure by design: no Prisma, no logger, no env. It takes the live state the
 * route already computed and the status stored on the row.
 */

'use strict';

/**
 * code → the English sentence published as `data.reason`. Every string here is
 * one the endpoint has always returned and MUST NOT change, except 'RENEWED'
 * (the renewed case used to publish reason: null).
 *
 * NOT_FOUND and CODE_MISMATCH are the two commonest answers a citizen actually
 * gets — a number typed off a document, and a QR whose verification code does
 * not match — and they used to travel as English prose with no code at all, so
 * the page had nothing to translate. Their sentences are unchanged; only the
 * machine code beside them is new.
 */
const PUBLIC_VERIFY_REASONS = Object.freeze({
    EXPIRED: 'Certificate has expired',
    SUSPENDED: 'Certificate is suspended',
    REVOKED: 'Certificate has been revoked',
    RENEWED: 'Certificate has been renewed',
    NOT_FOUND: 'Certificate not found',
    CODE_MISMATCH: 'Invalid verification code',
});

/**
 * The machine codes themselves, keyed by themselves, so a code is always spelled
 * from this vocabulary and never as a loose literal (the error-code catalogue
 * scanner treats a bare `code: 'X'` literal as an error code to be catalogued;
 * these are public verdict codes, not errors).
 */
const PUBLIC_VERIFY_REASON_CODES = Object.freeze(
    Object.fromEntries(Object.keys(PUBLIC_VERIFY_REASONS).map((k) => [k, k])),
);

/**
 * The two lookup failures, already in the shape the wire uses, so the route
 * spreads one value instead of repeating the sentence and the code next to each
 * other. `reason` keeps the exact string those branches have always sent.
 */
const PUBLIC_VERIFY_LOOKUP_FAILURES = Object.freeze({
    NOT_FOUND: Object.freeze({ reason: PUBLIC_VERIFY_REASONS.NOT_FOUND, reasonCode: 'NOT_FOUND' }),
    CODE_MISMATCH: Object.freeze({
        reason: PUBLIC_VERIFY_REASONS.CODE_MISMATCH,
        reasonCode: 'CODE_MISMATCH',
    }),
});

/**
 * The stored Certificate.status values that mean "not usable, and here is why".
 * 'active' is deliberately absent: an active certificate has no reason to
 * report, and an unrecognised status is never invented into a code.
 * ('renewed' is the supersession marker written by renewal-service's
 * supersedeCertificate.)
 */
const REASON_CODE_BY_STORED_STATUS = Object.freeze({
    suspended: 'SUSPENDED',
    revoked: 'REVOKED',
    renewed: 'RENEWED',
});

/** A certificate with nothing to explain. Frozen so no caller can mutate it. */
const NO_REASON = Object.freeze({ code: null, reason: null });

/**
 * The reason code a stored status maps to, or null.
 *
 * The OWN-property check is the whole point: the table is a plain object, so a
 * row whose status happened to read 'constructor' or '__proto__' resolved to an
 * inherited value of Object.prototype and was published as a "code" (a function,
 * or the prototype itself) with an undefined reason beside it. A status is a
 * code only when this table owns the key.
 *
 * @param {string} storedStatus  Certificate.status as stored on the row.
 * @returns {'SUSPENDED'|'REVOKED'|'RENEWED'|null}
 */
function codeForStoredStatus(storedStatus) {
    const key = String(storedStatus || '').toLowerCase();
    return Object.prototype.hasOwnProperty.call(REASON_CODE_BY_STORED_STATUS, key)
        ? REASON_CODE_BY_STORED_STATUS[key]
        : null;
}

/**
 * @param {{ isExpired?: boolean }} liveState  the state from public.js's
 *        liveCertificateState(): expiry is derived from the row's expiryDate.
 * @param {string} storedStatus  Certificate.status as stored on the row.
 * @returns {{ code: string|null, reason: string|null }} code is one of PUBLIC_VERIFY_REASON_CODES (EXPIRED, SUSPENDED, REVOKED, RENEWED) or null
 *
 * Expiry WINS over the stored status — the public status word has always been
 * 'expired' for a past expiryDate whatever the row said, and the code must
 * agree with the word next to it.
 */
function publicReasonFor(liveState, storedStatus) {
    if (liveState && liveState.isExpired) {
        return { code: PUBLIC_VERIFY_REASON_CODES.EXPIRED, reason: PUBLIC_VERIFY_REASONS.EXPIRED };
    }
    const code = codeForStoredStatus(storedStatus);
    if (!code) { return NO_REASON; }
    return { code, reason: PUBLIC_VERIFY_REASONS[code] };
}

/**
 * Is this row the OLD certificate of a renewal? Only the 'renewed'
 * supersession marker means "replaced by a newer document" — a revoked or
 * expired row that happens to carry a stale renewedCertificateId must not
 * advertise a successor. Lives here so the marker string has one home.
 *
 * @param {string} storedStatus  Certificate.status as stored on the row.
 * @returns {boolean}
 */
function isSupersededByRenewal(storedStatus) {
    return codeForStoredStatus(storedStatus) === 'RENEWED';
}

module.exports = {
    publicReasonFor,
    isSupersededByRenewal,
    PUBLIC_VERIFY_REASONS,
    PUBLIC_VERIFY_LOOKUP_FAILURES,
    REASON_CODE_BY_STORED_STATUS,
};
