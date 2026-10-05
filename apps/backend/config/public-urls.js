/**
 * The platform's own public addresses — one place, and production may not guess.
 *
 * Operator, 2026-09-05: "เราใช้ hardcode ให้น้อยที่สุดถึงไม่ใช้เลย."
 *
 * ── WHAT THIS REPLACES ────────────────────────────────────────────────────────
 * Six environment names for two ideas, and the production domain typed as a
 * fallback in five different services:
 *
 *   invoice-template-service    APP_PUBLIC_URL || STAGING_PUBLIC_URL || 'https://gacpth.com'
 *   pdpa-erasure-service        APP_URL        || 'https://gacpth.com'
 *   farm-service                PUBLIC_APP_URL || 'https://gacpth.com'
 *   lot-label-template-service  PUBLIC_TRACE_URL || TRACE_BASE_URL || 'https://gacpth.com/trace'  (twice)
 *
 * services/trace-service/common.js already refused to do this, and wrote down
 * why: "production must provide TRACE_BASE_URL explicitly. Falling back to a
 * hardcoded 'https://gacpth.com' silently sends staging-issued QR codes to the
 * production verify domain." The other five had no such guard — so one missing
 * variable on a staging deploy put production URLs on invoices, on printed QR
 * stickers, on farm verification links and in PDPA erasure notices, silently, and
 * a QR sticker is not something you can recall once it is on a box.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────────
 * In production, an address nobody configured is a REFUSAL. Everywhere else it
 * falls back once, from this file, so a developer can run the stack — and that
 * single fallback is the only place the domain is written down.
 *
 * This module is also the only place these variables are read, which is why the
 * env-direct counter can fall as call sites move onto it.
 *
 * @module config/public-urls
 */

'use strict';

/**
 * The names each address answers to, newest first.
 *
 * The older ones are kept deliberately: a deploy that already sets APP_URL must
 * not break because the code was tidied. Exported so a runbook can list what an
 * environment needs without anyone re-reading the source.
 */
const PUBLIC_URL_ENV_KEYS = Object.freeze({
    app: Object.freeze(['APP_PUBLIC_URL', 'STAGING_PUBLIC_URL', 'APP_URL', 'PUBLIC_APP_URL']),
    trace: Object.freeze(['PUBLIC_TRACE_URL', 'TRACE_BASE_URL']),
    // CERT_VERIFY_BASE_URL is the full base; the app names below are the ones
    // verifyBaseUrl() derives from when it is unset.
    verify: Object.freeze(['CERT_VERIFY_BASE_URL', 'APP_PUBLIC_URL', 'APP_URL']),
});

/**
 * The ONE written-down address, used only when nothing is configured AND this is
 * not production. Every other occurrence in the codebase was removed for it.
 */
const DEVELOPMENT_FALLBACK = 'https://gacpth.com';

const isProduction = () => process.env.NODE_ENV === 'production';

/** No trailing slash, ever — callers append their own path. */
const trim = (url) => String(url).trim().replace(/\/+$/, '');

function refuse(code, message) {
    return Object.assign(new Error(message), { code });
}

function assertUrl(value, envName) {
    let parsed;
    try {
        parsed = new URL(value);
    } catch (_e) {
        throw refuse('PUBLIC_URL_INVALID', `${envName} is not a URL: "${value}"`);
    }
    if (!/^https?:$/.test(parsed.protocol)) {
        throw refuse('PUBLIC_URL_INVALID', `${envName} must be http or https: "${value}"`);
    }
    return trim(value);
}

function resolve(kind, { suffix = '' } = {}) {
    const names = PUBLIC_URL_ENV_KEYS[kind];
    for (const name of names) {
        const raw = process.env[name];
        if (raw && String(raw).trim()) {
            return `${assertUrl(String(raw).trim(), name)}${suffix}`;
        }
    }
    if (isProduction()) {
        // Named, so the message is an instruction rather than a complaint.
        throw refuse(
            'PUBLIC_URL_NOT_CONFIGURED',
            `No public ${kind} URL is configured. Set one of: ${names.join(', ')}. `
            + 'Production refuses to fall back to a written-down domain — a staging '
            + 'deploy that guessed would put production addresses on documents and QR codes.',
        );
    }
    return `${DEVELOPMENT_FALLBACK}${suffix}`;
}

/** Where the applicant-facing site lives. */
const appBaseUrl = () => resolve('app');

/** Where a scanned QR code should land. */
const traceBaseUrl = () => resolve('trace', { suffix: '' });

/**
 * Where a certificate is verified — the FULL base, path included.
 *
 * CERT_VERIFY_BASE_URL is historically the complete base ('…/verify', and a
 * staging deploy may point it somewhere else entirely), so it is honoured
 * verbatim. Only when it is unset is the address derived from the app base, and
 * that derivation is the one place '/verify' is written down.
 */
function verifyBaseUrl() {
    const explicit = process.env.CERT_VERIFY_BASE_URL;
    if (explicit && String(explicit).trim()) {
        return assertUrl(String(explicit).trim(), 'CERT_VERIFY_BASE_URL');
    }
    return `${appBaseUrl()}/verify`;
}

module.exports = {
    appBaseUrl,
    traceBaseUrl,
    verifyBaseUrl,
    PUBLIC_URL_ENV_KEYS,
    DEVELOPMENT_FALLBACK,
};
