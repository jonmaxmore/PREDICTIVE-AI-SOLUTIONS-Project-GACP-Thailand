import { buildPublicVerifyUrl } from '../public-verify-url';

/**
 * C1 — the public cert-verify page must fetch the backend through a base that
 * INCLUDES `/api/v1`, never the bare site origin (which resolved to
 * `/public/verify/<n>` → 404 → every cert INVALID).
 */
describe('buildPublicVerifyUrl (C1)', () => {
    it('appends /api/v1/public/verify to an internal backend base', () => {
        expect(buildPublicVerifyUrl('http://backend:8000', 'GACP-TH-2569-A3F7B2'))
            .toBe('http://backend:8000/api/v1/public/verify/GACP-TH-2569-A3F7B2');
    });

    it('NEVER produces a bare-origin /public/verify path (the bug)', () => {
        const url = buildPublicVerifyUrl('https://staging.gacpth.com', 'GACP-TH-2569-A3F7B2');
        expect(url).toContain('/api/v1/public/verify/');
        // The regression we guard against: origin + /public/verify with no /api/v1.
        expect(url).not.toMatch(/gacpth\.com\/public\/verify/);
    });

    it('strips a trailing slash on the base', () => {
        expect(buildPublicVerifyUrl('http://localhost:8000/', 'X'))
            .toBe('http://localhost:8000/api/v1/public/verify/X');
    });

    it('does not double up when the base already ends in /api or /api/v1', () => {
        expect(buildPublicVerifyUrl('http://localhost:8000/api', 'X'))
            .toBe('http://localhost:8000/api/v1/public/verify/X');
        expect(buildPublicVerifyUrl('http://localhost:8000/api/v1', 'X'))
            .toBe('http://localhost:8000/api/v1/public/verify/X');
    });

    it('URL-encodes the certificate number', () => {
        expect(buildPublicVerifyUrl('http://b:8000', 'a/b c'))
            .toBe('http://b:8000/api/v1/public/verify/a%2Fb%20c');
    });
});
