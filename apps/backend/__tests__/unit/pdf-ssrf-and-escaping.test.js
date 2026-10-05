/**
 * SEC-001 — PDF HTML-injection / SSRF hardening (unit level).
 *
 *  (a) isPdfResourceAllowed — the sub-resource allowlist that the Puppeteer
 *      request interceptor enforces. Pure URL predicate, exhaustively tested.
 *  (b) moved out — see the note at the foot of this file.
 *
 * This block does not launch Chromium; the end-to-end "the request is actually
 * blocked by a real browser" proof lives in the integration test.
 */

const pdfGenerator = require('../../services/pdf/pdf-generator.service');

describe('SEC-001 (a) — isPdfResourceAllowed sub-resource allowlist', () => {
    const allow = [
        ['inline data: image (the embedded logo)', 'data:image/png;base64,iVBORw0KGgo='],
        ['inline data: font (the embedded Sarabun faces)', 'data:font/woff2;base64,d09GMgABAAAAAA=='],
        ['the about:blank base document', 'about:blank'],
    ];
    const deny = [
        ['cloud metadata endpoint (SSRF)', 'http://169.254.169.254/latest/meta-data/'],
        ['metadata over https', 'https://169.254.169.254/latest/meta-data/'],
        ['internal service by name', 'http://minio:9000/secret-bucket'],
        ['localhost', 'http://127.0.0.1:6379/'],
        ['local file disclosure', 'file:///etc/passwd'],
        ['arbitrary external host', 'https://evil.example.com/collect'],
        // Data sovereignty (2026-07-25): the remote font CDN used to be the one
        // allowlisted host. Sarabun is now vendored locally and injected as a
        // data: URI, so the allowlist is data: + about:blank and every remote
        // font URL — including the previously-permitted ones — is blocked.
        ['the formerly-allowed font stylesheet host', 'https://fonts.googleapis.com/css2?family=Sarabun:wght@400'], // third-party-allow: asserts this host is rejected
        ['the formerly-allowed font file host', 'https://fonts.gstatic.com/s/sarabun/v15/x.woff2'], // third-party-allow: asserts this host is rejected
        ['http downgrade of the old font host', 'http://fonts.googleapis.com/css2'], // third-party-allow: asserts this host is rejected
        ['look-alike font host', 'https://fonts.googleapis.com.evil.example.com/x'], // third-party-allow: asserts this host is rejected
        ['ftp', 'ftp://example.com/x'],
        ['empty string', ''],
        ['non-string', null],
        ['garbage', 'not a url'],
    ];

    it.each(allow)('allows %s', (_label, url) => {
        expect(pdfGenerator.isPdfResourceAllowed(url)).toBe(true);
    });

    it.each(deny)('blocks %s', (_label, url) => {
        expect(pdfGenerator.isPdfResourceAllowed(url)).toBe(false);
    });
});

/**
 * Block (b) — "the application-summary section builders escape applicant-supplied
 * values" — moved to katorlor1-template.test.js on 2026-09-05.
 *
 * Its subject was services/pdf/application-template-service.js, the summary PDF
 * the platform invented for itself. The /applications/:id/pdf door now renders
 * the ministry's own แบบกัญชา กทล.๑ instead, that service lost its last caller,
 * and it is deleted. A security property proved against code nothing runs is not
 * a security property, so the assertions follow the behaviour to the live
 * renderer rather than keeping a dead module alive to be tested.
 */
