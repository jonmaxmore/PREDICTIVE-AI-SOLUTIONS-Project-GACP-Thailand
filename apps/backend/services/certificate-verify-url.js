/**
 * Single source of truth for the public certificate-verification URL.
 *
 * This is the URL embedded in the certificate QR code and printed on the PDF.
 * It MUST be reachable by a citizen scanning the QR, and it MUST be on the
 * platform's real domain — gacpth.com. Earlier code scattered placeholder
 * hosts under moph.go.th subdomains that the platform never served, so every
 * issued cert's QR pointed nowhere. Both certificate-service.js and the PDF
 * template now resolve the base through here.
 *
 * `CERT_VERIFY_BASE_URL` is the full base and overrides everything. When it is
 * unset, config/public-urls derives the address from the app base and refuses to
 * guess in production — the domain is written down in exactly one file now, and
 * a staging deploy that forgot to configure one fails loudly instead of printing
 * gacpth.com onto certificates it issued.
 *
 * @module services/certificate-verify-url
 */

'use strict';

const { verifyBaseUrl } = require('../config/public-urls');
const { toCertificateSlug } = require('./certificate-number-display');

/**
 * Resolve the verify base URL. Read at call time so tests can set it.
 *
 * The domain used to be written down here as DEFAULT_CERT_VERIFY_BASE_URL, so a
 * production deploy with no CERT_VERIFY_BASE_URL printed gacpth.com onto every
 * certificate — including certificates issued from staging. config/public-urls
 * refuses to guess in production and holds the one development fallback.
 */
function certVerifyBaseUrl() {
    return verifyBaseUrl();
}

/**
 * Build the full public verify URL for a certificate number.
 * @param {string} certificateNumber
 * @returns {string} e.g. https://gacpth.com/verify/TH-GACP-87-2568
 */
function buildCertVerifyUrl(certificateNumber) {
    const base = certVerifyBaseUrl();
    // The stored number holds a space and a slash; a URL path carries the slug.
    return certificateNumber ? `${base}/${toCertificateSlug(certificateNumber)}` : base;
}

module.exports = { certVerifyBaseUrl, buildCertVerifyUrl };
