/**
 * Unit test: uploads-security-headers middleware
 *
 * Verifies PDPA Section 27 hardening on the /uploads/* mount.
 * Each of the 4 required headers MUST be set with the exact correct value,
 * and next() MUST be invoked so the express.static handler can run.
 */

const uploadsSecurityHeaders = require('../../middleware/uploads-security-headers');

function createMocks() {
    const headers = {};
    const req = { method: 'GET', originalUrl: '/uploads/biometric/abc.jpg' };
    const res = {
        setHeader: jest.fn((name, value) => {
            headers[name] = value;
        }),
    };
    const next = jest.fn();
    return { req, res, next, headers };
}

describe('uploadsSecurityHeaders middleware', () => {
    it('exports a function with a stable name (for testability + audit grep)', () => {
        expect(typeof uploadsSecurityHeaders).toBe('function');
        expect(uploadsSecurityHeaders.name).toBe('uploadsSecurityHeaders');
    });

    it('sets X-Content-Type-Options: nosniff (anti MIME-sniff XSS)', () => {
        const { req, res, next, headers } = createMocks();
        uploadsSecurityHeaders(req, res, next);
        expect(headers['X-Content-Type-Options']).toBe('nosniff');
    });

    it('sets Content-Disposition: attachment (force download, no referrer leak)', () => {
        const { req, res, next, headers } = createMocks();
        uploadsSecurityHeaders(req, res, next);
        expect(headers['Content-Disposition']).toBe('attachment');
    });

    it('sets Cross-Origin-Resource-Policy: same-site (block cross-origin embed)', () => {
        const { req, res, next, headers } = createMocks();
        uploadsSecurityHeaders(req, res, next);
        expect(headers['Cross-Origin-Resource-Policy']).toBe('same-site');
    });

    it('sets Cache-Control: private, no-store, max-age=0 (no shared cache of PII)', () => {
        const { req, res, next, headers } = createMocks();
        uploadsSecurityHeaders(req, res, next);
        expect(headers['Cache-Control']).toBe('private, no-store, max-age=0');
    });

    it('calls next() exactly once so express.static can serve the body', () => {
        const { req, res, next } = createMocks();
        uploadsSecurityHeaders(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
    });

    it('sets all 4 required headers in a single invocation', () => {
        const { req, res, next, headers } = createMocks();
        uploadsSecurityHeaders(req, res, next);
        expect(res.setHeader).toHaveBeenCalledTimes(4);
        expect(Object.keys(headers).sort()).toEqual(
            [
                'Cache-Control',
                'Content-Disposition',
                'Cross-Origin-Resource-Policy',
                'X-Content-Type-Options',
            ].sort(),
        );
    });

    it('is deterministic — repeated calls produce identical header set', () => {
        const a = createMocks();
        const b = createMocks();
        uploadsSecurityHeaders(a.req, a.res, a.next);
        uploadsSecurityHeaders(b.req, b.res, b.next);
        expect(a.headers).toEqual(b.headers);
    });
});
