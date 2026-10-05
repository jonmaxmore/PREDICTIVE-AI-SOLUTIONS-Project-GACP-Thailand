/**
 * Access-log redaction for URL-borne credentials (W1-2, 2026-08-21).
 *
 * WHY THIS FILE EXISTS — the honest finding that forced it:
 * `server.js` logs every request with `morgan('combined')`, whose `:url` token
 * prints the full request target INCLUDING the query string, and
 * `shared/logger.js` is a bare winston logger with no scrubbing transport. A
 * repo-wide search on 2026-08-21 found no `log_redactor` / redaction layer of
 * any kind for request logs (the only `redact*` helpers are
 * `server.js#redactDatabaseUrl` for the boot banner and PII masking inside
 * `utils/field-encryption.js`). So before this module, ANY credential in a query
 * string would have been written verbatim to the access log.
 *
 * Signed `/uploads` URLs put a signature in the query string (the only place a
 * browser `<img>` can carry one), so the redaction had to exist first. It also
 * covers S3/MinIO presigned params, which the same mount can hand out when
 * STORAGE_PROVIDER=minio.
 *
 * Design notes:
 *   - Redact the VALUE, keep the KEY. `sig=REDACTED` still tells an operator a
 *     signed request happened; `sig` stripped entirely would hide it.
 *   - Non-sensitive params stay readable — an access log with no query string is
 *     an access log nobody can debug with.
 *   - Never throws. A logger that can crash the request path is a bigger
 *     availability bug than a noisy log line.
 */
'use strict';

/**
 * Query params whose VALUE is a credential. Matched case-insensitively.
 * `exp` / `sub` / `X-Amz-Expires` are deliberately NOT here — they are
 * non-secret metadata and are what makes a redacted log still useful.
 */
const SENSITIVE_QUERY_KEYS = Object.freeze([
    'sig',
    'signature',
    'token',
    'access_token',
    'refresh_token',
    'id_token',
    'api_key',
    'apikey',
    'secret',
    'password',
    'x-amz-signature',
    'x-amz-credential',
    'x-amz-security-token',
]);

const SENSITIVE_LOOKUP = new Set(SENSITIVE_QUERY_KEYS.map((k) => k.toLowerCase()));

const REDACTED = 'REDACTED';

/**
 * Return `url` with every sensitive query-param value replaced by `REDACTED`.
 * A target with no query string is returned byte-identical.
 *
 * @param {unknown} url raw request target (`req.originalUrl` / `req.url`)
 * @returns {string}
 */
function redactUrlForLog(url) {
    const raw = typeof url === 'string' ? url : '';
    if (!raw) {
        return '';
    }
    const queryStart = raw.indexOf('?');
    if (queryStart === -1) {
        return raw;
    }

    const pathPart = raw.slice(0, queryStart);
    const queryPart = raw.slice(queryStart + 1);
    if (!queryPart) {
        return raw;
    }

    try {
        // Split manually rather than via URLSearchParams so the original
        // encoding of untouched params survives the round-trip verbatim (a log
        // line that silently re-encodes is a log line that misleads).
        const rebuilt = queryPart
            .split('&')
            .map((pair) => {
                if (!pair) {
                    return pair;
                }
                const eq = pair.indexOf('=');
                const rawKey = eq === -1 ? pair : pair.slice(0, eq);
                let decodedKey = rawKey;
                try {
                    decodedKey = decodeURIComponent(rawKey);
                } catch {
                    // Malformed percent-encoding — fall back to the raw key.
                }
                if (!SENSITIVE_LOOKUP.has(decodedKey.toLowerCase())) {
                    return pair;
                }
                return `${rawKey}=${REDACTED}`;
            })
            .join('&');

        return `${pathPart}?${rebuilt}`;
    } catch {
        // Fail SAFE for a logger: if anything at all goes wrong parsing, drop the
        // whole query string rather than risk printing a credential.
        return `${pathPart}?${REDACTED}`;
    }
}

module.exports = { redactUrlForLog, SENSITIVE_QUERY_KEYS: SENSITIVE_LOOKUP, REDACTED };
