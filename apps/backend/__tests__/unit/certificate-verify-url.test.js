/**
 * Phase-0 fix — the certificate QR must point at the real public verify host.
 * certificate-service.js previously persisted a "Mock" qrData
 * (https://dtam.moph.go.th/verify/... — wrong subdomain), so every issued
 * cert's QR was unreachable. Both certificate-service and the PDF template now
 * resolve the base through this single source.
 */

const { buildCertVerifyUrl, certVerifyBaseUrl } = require('../../services/certificate-verify-url');

describe('certificate-verify-url — single source of truth for the QR target', () => {
    const ORIGINAL = process.env.CERT_VERIFY_BASE_URL;
    afterEach(() => {
        if (ORIGINAL === undefined) { delete process.env.CERT_VERIFY_BASE_URL; }
        else { process.env.CERT_VERIFY_BASE_URL = ORIGINAL; }
    });

    it('defaults to the real platform domain gacpth.com (not a stale placeholder host)', () => {
        delete process.env.CERT_VERIFY_BASE_URL;
        // Was `expect(DEFAULT_CERT_VERIFY_BASE_URL).toBe('https://gacpth.com/verify')`.
        // That constant put the production domain in this file, so a production
        // deploy with no CERT_VERIFY_BASE_URL printed gacpth.com onto every
        // certificate — including ones issued from staging. config/public-urls
        // holds the single development fallback and refuses to guess in
        // production; what this test protects is the /verify suffix and the shape.
        expect(certVerifyBaseUrl()).toMatch(/\/verify$/);
        expect(buildCertVerifyUrl('GACP-TH-2569-A3F7B2'))
            .toBe('https://gacpth.com/verify/GACP-TH-2569-A3F7B2');
        // The regression we are guarding against — no stale moph.go.th host:
        expect(buildCertVerifyUrl('X')).not.toContain('moph.go.th');
    });

    it('honours CERT_VERIFY_BASE_URL for staging/non-prod overrides', () => {
        process.env.CERT_VERIFY_BASE_URL = 'https://staging.example/v';
        expect(certVerifyBaseUrl()).toBe('https://staging.example/v');
        expect(buildCertVerifyUrl('GACP-TH-2569-A3F7B2'))
            .toBe('https://staging.example/v/GACP-TH-2569-A3F7B2');
    });

    it('returns the bare base when no certificate number is given', () => {
        delete process.env.CERT_VERIFY_BASE_URL;
        expect(buildCertVerifyUrl()).toBe('https://gacpth.com/verify');
    });
});
