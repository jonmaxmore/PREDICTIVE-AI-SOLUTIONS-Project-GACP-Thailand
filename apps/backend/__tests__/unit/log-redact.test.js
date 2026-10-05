/**
 * W1-2 — access-log redaction for signed-URL credentials.
 *
 * `server.js` logs every request through `morgan('combined')`, whose `:url`
 * token prints the FULL request target including the query string, and
 * `shared/logger.js` is a plain winston logger with no redaction layer (checked
 * 2026-08-21: the repo has no log_redactor / scrubbing transport). A signed-URL
 * signature therefore had nowhere safe to live until this token override exists.
 *
 * Short-lived or not, a bearer credential must not be written to an access log.
 */
'use strict';

const { redactUrlForLog, SENSITIVE_QUERY_KEYS } = require('../../shared/log-redact');

describe('redactUrlForLog', () => {
    test('leaves a plain path untouched', () => {
        expect(redactUrlForLog('/api/health')).toBe('/api/health');
        expect(redactUrlForLog('/uploads/a.png')).toBe('/uploads/a.png');
    });

    test('keeps harmless query params readable', () => {
        expect(redactUrlForLog('/api/x?page=2&limit=20')).toBe('/api/x?page=2&limit=20');
    });

    test('redacts the local signed-URL signature but keeps the shape debuggable', () => {
        const out = redactUrlForLog('/uploads/a.png?exp=1787283122&sub=abc123&sig=S3CR3T-SIGNATURE-VALUE');
        expect(out).not.toContain('S3CR3T-SIGNATURE-VALUE');
        expect(out).toContain('sig=REDACTED');
        expect(out).toContain('exp=1787283122');
    });

    test('redacts a MinIO / S3 presigned signature too', () => {
        const out = redactUrlForLog(
            '/gacp-uploads/slips/x.pdf?X-Amz-Signature=deadbeef&X-Amz-Credential=AKIA%2Fkey&X-Amz-Expires=300',
        );
        expect(out).not.toContain('deadbeef');
        expect(out).not.toContain('AKIA');
        expect(out).toContain('X-Amz-Expires=300');
    });

    test('redacts bearer-ish params regardless of case', () => {
        expect(redactUrlForLog('/x?TOKEN=abc')).toContain('TOKEN=REDACTED');
        expect(redactUrlForLog('/x?access_token=abc')).toContain('access_token=REDACTED');
    });

    test('never throws on a malformed target', () => {
        expect(() => redactUrlForLog('%%%?sig=x')).not.toThrow();
        expect(redactUrlForLog(undefined)).toBe('');
        expect(redactUrlForLog(null)).toBe('');
    });

    test('the sensitive key list covers the signature params this repo mints', () => {
        const keys = [...SENSITIVE_QUERY_KEYS].map((k) => k.toLowerCase());
        expect(keys).toEqual(expect.arrayContaining(['sig', 'x-amz-signature', 'token']));
    });
});

describe('server.js wires the redaction into morgan', () => {
    test('the :url token is overridden before the morgan middleware is mounted', () => {
        const source = require('fs').readFileSync(
            require('path').join(__dirname, '..', '..', 'server.js'),
            'utf8',
        );
        const tokenAt = source.indexOf("morgan.token('url'");
        const useAt = source.indexOf("app.use(morgan('combined'");
        expect(tokenAt).toBeGreaterThan(-1);
        expect(useAt).toBeGreaterThan(-1);
        expect(tokenAt).toBeLessThan(useAt);
        expect(source).toContain('redactUrlForLog');
    });
});
