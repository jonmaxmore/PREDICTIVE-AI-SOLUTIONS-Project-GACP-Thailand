/**
 * Uploads Security Headers Middleware
 *
 * PDPA Compliance + Security Hardening for /uploads/* static files.
 *
 * The /uploads/ mount serves sensitive Personally Identifiable Information (PII):
 *   - Biometric photos (face capture for GACP applicant identity verification)
 *   - GACP audit photos (field auditor evidence — may include applicants/workers)
 *   - GPS-tagged field images (farm plot coordinates → location PII)
 *   - CAR (Corrective Action Request) documents (audit findings, internal)
 *
 * Without these headers the files are a PDPA Section 27 data-leak vector:
 *   - Browsers render PII inline → leaked via document.referrer when user clicks an external link
 *   - Shared HTTP proxies / CDNs cache PII responses → cross-tenant exposure
 *   - <img>/<video>/fetch() from any origin can embed/exfiltrate biometric data
 *   - MIME-sniffing on user-uploaded files can promote a .jpg to text/html → stored XSS
 *
 * The 4 headers below MUST be set BEFORE express.static() serves the file body.
 * Compliance/Security audit can grep this comment block to verify intent.
 *
 * @version 1.0.0
 */

/**
 * Sets PDPA-aligned security headers on every /uploads/* response, then yields
 * to the static file handler via next().
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function uploadsSecurityHeaders(req, res, next) {
    // (1) X-Content-Type-Options: nosniff
    //     Prevents MIME-sniff XSS — a malicious upload labelled image/jpeg cannot be
    //     re-interpreted as text/html by the browser. Critical because applicants upload
    //     arbitrary binary content and we cannot fully trust Content-Type alone.
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // (2) Content-Disposition: attachment
    //     Forces the browser to DOWNLOAD instead of rendering inline. This neutralises
    //     the document.referrer leak (a rendered PII page that links elsewhere would
    //     leak the file URL to third parties) and prevents inline-render XSS surfaces.
    //     NOTE for embedders: a same-site <img src="/uploads/x.jpg"> still works —
    //     Content-Disposition only affects top-level navigation rendering, not
    //     <img>/<video>/<iframe> subresource loads. Verified against WHATWG Fetch spec.
    res.setHeader('Content-Disposition', 'attachment');

    // (3) Cross-Origin-Resource-Policy: same-site
    //     Blocks cross-origin <img>, <script>, fetch() etc. from loading these files.
    //     Combined with CORP, even if an attacker leaks a file URL they cannot
    //     embed it on evil.com to bypass auth-via-cookie or steal pixel data.
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');

    // (4) Cache-Control: private, no-store, max-age=0
    //     Forbids ANY shared cache (CDN, corporate proxy, ISP transparent cache) from
    //     storing the response. PDPA requires controllers to know who has copies of
    //     PII; a cached file at an upstream proxy = data-controller blind spot.
    //     'private' = no shared cache; 'no-store' = no disk cache at all;
    //     'max-age=0' = belt-and-suspenders for legacy HTTP/1.0 caches.
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');

    return next();
}

module.exports = uploadsSecurityHeaders;
module.exports.uploadsSecurityHeaders = uploadsSecurityHeaders;
