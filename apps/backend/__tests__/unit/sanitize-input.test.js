/**
 * The request boundary OBSERVES; it no longer rewrites.
 *
 * This suite used to assert the opposite — "strips <script> opening tags",
 * "strips SQL comments" — and passed while the middleware quietly ate ordinary
 * Thai text. It could not see that, because every assertion was a NEGATIVE
 * (`not.toMatch(/<script/)`), and deleting a farm name satisfies a negative just
 * as well as defending against an attack does. The measurements are in
 * input-survives-the-round-trip.test.js.
 *
 * Operator ruling 2026-09-08: "ปล่อยผ่านแล้ว escape ตอนแสดงผล" — store what was
 * sent, escape where it is shown. So the contract this file guards changed:
 *
 *   before   value in -> value with matched patterns deleted, silently
 *   after    value in -> the same value out, and a detection recorded
 *
 * The defence did not disappear; it moved to where it can be correct without
 * guessing. Those boundaries have their own tests, and this file would be a lie
 * without them:
 *   - services/pdf/katorlor1-template-service.js  escapeHtml, guarded by
 *     input-survives-the-round-trip.test.js
 *   - Prisma parameterises every query, which is what actually answers the SQL
 *     patterns below — deleting "/*" from a string never did.
 *
 * What is still asserted here, and is worth asserting: an attack string is
 * DETECTED. Losing that would cost real observability on a government registry.
 */

const { sanitizeValue, sanitizeInput } = require('../../middleware/sanitize-input');

/** Run one value through and report what the middleware saw. */
function inspect(value) {
    const detections = [];
    const out = sanitizeValue(value, '', detections);
    return { out, detections };
}

describe('an attack string is recorded, not edited', () => {
    const CASES = [
        ['<script> opening tag', '<script>alert("xss")</script>Hello', 'XSS'],
        ['javascript: URI', 'javascript:alert(1)', 'XSS'],
        ['event handler', '<img onerror=alert(1) src=x>', 'XSS'],
        ['data:text/html URI', 'data:text/html,<h1>xss</h1>', 'XSS'],
        ['DROP TABLE', "Robert'; DROP TABLE users; --", 'SQL_INJECTION'],
        ['UNION SELECT', '1 UNION SELECT * FROM users', 'SQL_INJECTION'],
        ['SQL comment', "admin'/* comment */", 'SQL_INJECTION'],
    ];

    it.each(CASES)('%s is detected', (_name, input, type) => {
        const { detections } = inspect(input);
        expect(detections.map((d) => d.type)).toContain(type);
    });

    it.each(CASES)('%s reaches storage byte-identical', (_name, input) => {
        expect(inspect(input).out).toBe(input);
    });

    it('names the path it saw the value at, so a log line is actionable', () => {
        const { detections } = inspect({ profile: { bio: '<script>x</script>' } });
        expect(detections[0].path).toBe('profile.bio');
    });
});

describe('ordinary values pass through', () => {
    it('leaves normal strings alone', () => {
        expect(sanitizeValue('John Doe')).toBe('John Doe');
        expect(sanitizeValue('user@example.com')).toBe('user@example.com');
        expect(sanitizeValue('สวัสดีครับ')).toBe('สวัสดีครับ');
    });

    it('leaves non-strings alone', () => {
        expect(sanitizeValue(42)).toBe(42);
        expect(sanitizeValue(3.14)).toBe(3.14);
        expect(sanitizeValue(true)).toBe(true);
        expect(sanitizeValue(false)).toBe(false);
        expect(sanitizeValue(null)).toBe(null);
        expect(sanitizeValue(undefined)).toBe(undefined);
    });

    it('walks nested objects and arrays without changing them', () => {
        const input = {
            name: 'John',
            bio: '<script>alert("xss")</script>',
            profile: { website: 'javascript:void(0)' },
            tags: ['safe', '<script>bad</script>', 'also safe'],
        };
        const detections = [];
        expect(sanitizeValue(input, '', detections)).toEqual(input);
        expect(detections.length).toBeGreaterThan(0);
    });
});

describe('sanitizeInput middleware', () => {
    const mockNext = jest.fn();

    beforeEach(() => { mockNext.mockClear(); });

    /** The shape server.js hands the middleware. */
    function reqWith(parts) {
        return {
            body: {}, query: {}, params: {},
            ip: '127.0.0.1', method: 'POST', originalUrl: '/api/test',
            get: jest.fn(), connection: {},
            ...parts,
        };
    }

    it('leaves req.body as sent and still calls next', () => {
        const req = reqWith({ body: { name: '<script>xss</script>' } });
        sanitizeInput(req, {}, mockNext);
        expect(req.body.name).toBe('<script>xss</script>');
        expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('leaves req.query as sent', () => {
        const req = reqWith({ method: 'GET', query: { search: "'; DROP TABLE users; --" } });
        sanitizeInput(req, {}, mockNext);
        expect(req.query.search).toBe("'; DROP TABLE users; --");
        expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('leaves req.params as sent', () => {
        const req = reqWith({ method: 'GET', params: { farmId: '<script>xss</script>real-id' } });
        sanitizeInput(req, {}, mockNext);
        expect(req.params.farmId).toBe('<script>xss</script>real-id');
        expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('passes a clean UUID param through', () => {
        const uuid = '123e4567-e89b-12d3-a456-426614174000';
        const req = reqWith({ method: 'GET', params: { applicationId: uuid } });
        sanitizeInput(req, {}, mockNext);
        expect(req.params.applicationId).toBe(uuid);
        expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('calls next for clean input', () => {
        const req = reqWith({ method: 'GET', body: { name: 'John Doe' }, query: { page: '1' } });
        sanitizeInput(req, {}, mockNext);
        expect(req.body.name).toBe('John Doe');
        expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('does not throw when a request carries no params (server.js mounts it globally)', () => {
        const req = { body: { a: 'x' }, query: {}, ip: '::1', method: 'POST', originalUrl: '/api/x', get: jest.fn(), connection: {} };
        expect(() => sanitizeInput(req, {}, mockNext)).not.toThrow();
        expect(mockNext).toHaveBeenCalledTimes(1);
    });
});
