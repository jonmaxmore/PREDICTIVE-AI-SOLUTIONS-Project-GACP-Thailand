'use strict';

/**
 * Certificate number: the stored value, its URL slug, and the legacy forms.
 *
 * New certificates (operator ruling 2026-10-05): the stored number IS the
 * printed number, in the real DTAM style `TH-GACP {n}/{ปี พ.ศ.}` — for example
 * `TH-GACP 87/2568`. `n` has no zero padding and restarts at 1 each Buddhist year.
 *
 * A slash and a space cannot ride in a URL path segment (a proxy may decode %2F),
 * so URLs and the QR payload carry the slug `TH-GACP-{n}-{ปี}`. Both spell the
 * same certificate; `toCanonicalCertificateNumber` maps every accepted spelling
 * back to the stored value, and every lookup compares that against the register.
 *
 * Legacy rows keep their numbers (`GACP-TH-{ปี}-{รหัส}`); the old paper printed
 * `GACP-DTAM-{ปี}-{รหัส}` from them, so that projection stays for those rows only.
 *
 * Kept in its own small module (no puppeteer, no prisma) so the lookup layers
 * can import it; certificate-template-service re-exports buildDtamCertNumberDisplay.
 */

const CERT_NUMBER_PREFIX = 'TH-GACP';

/** The stored/printed form for a running number and Buddhist year. */
function formatCertificateNumber(sequence, buddhistYear) {
    return `${CERT_NUMBER_PREFIX} ${Number(sequence)}/${Number(buddhistYear)}`;
}

// "TH-GACP 87/2568" or its slug "TH-GACP-87-2568"; case and spacing are free.
const NEW_FORM = /^TH-GACP[\s-]+(\d{1,9})\s*[/-]\s*(\d{4})$/;

/** Stored value → URL-safe slug. Legacy numbers are already URL-safe and pass through. */
function toCertificateSlug(certificateNumber) {
    if (typeof certificateNumber !== 'string') {return certificateNumber;}
    const m = certificateNumber.trim().toUpperCase().match(NEW_FORM);
    if (!m) {return certificateNumber;}
    return `${CERT_NUMBER_PREFIX}-${Number(m[1])}-${m[2]}`;
}

/**
 * Printed form of a LEGACY row (`GACP-TH-…` → `GACP-DTAM-…`). A new-style number
 * is already the printed form and is returned unchanged.
 */
function buildDtamCertNumberDisplay(certificateNumber) {
    if (typeof certificateNumber !== 'string' || !certificateNumber) {
        return String(certificateNumber || '-');
    }
    const m = certificateNumber.match(/^GACP-TH-(\d{4})-([A-Z0-9]+)$/i);
    if (!m) {return certificateNumber;}
    return `GACP-DTAM-${m[1]}-${m[2].toUpperCase()}`;
}

/**
 * Every accepted spelling → the stored value:
 *   `TH-GACP 87/2568` · `TH-GACP-87-2568` (any case, extra spaces) → `TH-GACP 87/2568`
 *   `GACP-DTAM-{ปี}-{รหัส}` and `GACP-TH-{ปี}-{รหัส}` (any case)   → `GACP-TH-{ปี}-{รหัส}`
 * Anything else is returned unchanged (ids, uuids, other shapes keep reaching
 * their own lookups exactly as before).
 */
function toCanonicalCertificateNumber(input) {
    if (typeof input !== 'string') {return input;}
    const up = input.trim().toUpperCase();
    const fresh = up.match(NEW_FORM);
    if (fresh) {return formatCertificateNumber(fresh[1], fresh[2]);}
    const legacy = up.match(/^GACP-(?:DTAM|TH)-(\d{4})-([A-Z0-9]+)$/);
    if (!legacy) {return input;}
    return `GACP-TH-${legacy[1]}-${legacy[2]}`;
}

module.exports = {
    CERT_NUMBER_PREFIX,
    formatCertificateNumber,
    toCertificateSlug,
    buildDtamCertNumberDisplay,
    toCanonicalCertificateNumber,
};
