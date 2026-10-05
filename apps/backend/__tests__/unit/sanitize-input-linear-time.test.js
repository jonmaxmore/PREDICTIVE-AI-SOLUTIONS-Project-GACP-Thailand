/**
 * BACK-01 (audit 2026-09-17, critical): the input-inspection middleware must not
 * be a way to stop the server.
 *
 * middleware/sanitize-input.js is mounted on every path in server.js, before the
 * rate limiter and before authentication. It used to run `/on\w+\s*=/`,
 * `/<script\b[^>]*>/` and `/\/\*[\s\S]*?\*\//` over every string of the body,
 * query and params with no length cap. Each of those re-scans to the end of the
 * string from every place a match could start, so the cost grows with the
 * SQUARE of the length. Measured by the audit on the real middleware:
 * 25 KB -> 334 ms, 50 KB -> 1370 ms, 100 KB -> 5382 ms, and express.json allowed
 * 10 MB. One anonymous POST froze the event loop — every user, every webhook,
 * every in-process cron — for minutes.
 *
 * What this file pins:
 *   1. a ~200 KB adversarial string goes through the middleware in well under
 *      the budget (it took ~20 s before);
 *   2. strings longer than MAX_INSPECTED_LENGTH are not scanned at all, and the
 *      log still says one arrived;
 *   3. at the cap, every adversarial shape the audit and its verifiers named is
 *      inspected in linear time, a whole body of them at once;
 *   4. the rewritten detectors flag exactly what the old regexes flagged, so no
 *      protective behaviour was traded away for speed (checked against the old
 *      patterns themselves on short strings, where they are harmless).
 *
 * Budgets are wall-clock and deliberately loose (tens of times what the linear
 * code needs on this 4-CPU box) so a busy machine does not make them flaky; the
 * quadratic code misses every one of them by seconds.
 */

'use strict';

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l), logger: l };
});

const logger = require('../../shared/logger');
const {
    sanitizeInput,
    sanitizeValue,
    MAX_INSPECTED_LENGTH,
} = require('../../middleware/sanitize-input');

/** The size a string can be and still be inspected. Falls back so the file loads on old code. */
const AT_CAP = typeof MAX_INSPECTED_LENGTH === 'number' ? MAX_INSPECTED_LENGTH : 32 * 1024;

function reqWith(parts) {
    return {
        body: {}, query: {}, params: {},
        ip: '203.0.113.9', method: 'POST', originalUrl: '/api/auth/health/register',
        get: jest.fn(), headers: {}, connection: {},
        ...parts,
    };
}

function timeMs(fn) {
    const start = process.hrtime.bigint();
    fn();
    return Number(process.hrtime.bigint() - start) / 1e6;
}

/** A string of exactly `length` characters made by repeating `unit` after `prefix`. */
function build(prefix, unit, length) {
    const body = unit.repeat(Math.ceil((length - prefix.length) / unit.length));
    return (prefix + body).slice(0, length);
}

beforeEach(() => {
    logger.warn.mockClear();
});

describe('BACK-01 — one anonymous request cannot stall the event loop', () => {
    it('a ~200 KB "onon…" string passes through the middleware in under 200 ms', () => {
        const note = 'on'.repeat(100_000);
        const req = reqWith({ body: { note } });
        const next = jest.fn();

        const elapsed = timeMs(() => sanitizeInput(req, {}, next));

        expect(elapsed).toBeLessThan(200);
        expect(next).toHaveBeenCalledTimes(1);
        expect(req.body.note).toBe(note);
    });

    it('the same string in the query string and a path param is just as cheap', () => {
        const hostile = '<script '.repeat(25_000);
        const req = reqWith({ method: 'GET', query: { q: hostile }, params: { farmId: hostile } });
        const next = jest.fn();

        const elapsed = timeMs(() => sanitizeInput(req, {}, next));

        expect(elapsed).toBeLessThan(200);
        expect(next).toHaveBeenCalledTimes(1);
    });
});

describe('BACK-01 — strings over the cap are not scanned, and the log says so', () => {
    it('the cap is a real number, big enough for ordinary long text and far below the body limit', () => {
        expect(typeof MAX_INSPECTED_LENGTH).toBe('number');
        // The longest free text the API legitimately takes is a herb-knowledge
        // entry (services/herb-knowledge-service.js MAX_CONTENT_LEN = 20000).
        expect(MAX_INSPECTED_LENGTH).toBeGreaterThanOrEqual(20_000);
        expect(MAX_INSPECTED_LENGTH).toBeLessThanOrEqual(64 * 1024);
    });

    it('a string one character over the cap is passed through unscanned and recorded as such', () => {
        const value = build('<script>alert(1)</script>', 'x', MAX_INSPECTED_LENGTH + 1);
        const detections = [];

        const out = sanitizeValue({ bio: value }, 'body', detections);

        expect(out.bio).toBe(value);
        expect(detections).toEqual([
            { path: 'body.bio', pattern: null, type: 'OVERSIZE_NOT_INSPECTED', length: MAX_INSPECTED_LENGTH + 1 },
        ]);
    });

    it('a string exactly at the cap is still inspected', () => {
        const value = build('<script>alert(1)</script>', 'x', MAX_INSPECTED_LENGTH);
        const detections = [];

        sanitizeValue({ bio: value }, 'body', detections);

        expect(detections.map((d) => d.type)).toEqual(['XSS']);
    });

    it('the middleware logs the oversize string with its path and length, and still calls next', () => {
        const value = 'a'.repeat(MAX_INSPECTED_LENGTH + 10);
        const req = reqWith({ body: { notes: [value] } });
        const next = jest.fn();

        sanitizeInput(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        const [, meta] = logger.warn.mock.calls[0];
        expect(meta.detections).toEqual([
            { path: 'body.notes[0]', pattern: null, type: 'OVERSIZE_NOT_INSPECTED', length: MAX_INSPECTED_LENGTH + 10 },
        ]);
    });
});

describe('BACK-01 — at the cap, every adversarial shape is linear', () => {
    // Each shape defeats one of the old patterns; the verifiers measured the
    // first three growing quadratically. `javascript: ` in front gives every
    // string one detection that proves it really was scanned.
    const SHAPES = [
        ['on\\w+\\s*= on "onon…"', 'on'],
        ['on\\w+\\s*= on "_on_on…"', '_on'],
        ['<script\\b[^>]*> on "<script <script …"', '<script '],
        ['/*…*/ on "/*x/*x…"', '/*x'],
        ['javascript\\s*: on long whitespace runs', 'javascript          '],
        ['UNION\\s+SELECT on long whitespace runs', 'UNION                    '],
        ['on\\w+\\s*= on "a=a=a=…"', 'a='],
    ];

    it.each(SHAPES)('%s — a ~512 KB body of cap-sized strings inspects in under 250 ms', (_name, unit) => {
        const one = build('javascript: ', unit, AT_CAP);
        const body = { items: Array.from({ length: 16 }, () => one) };
        const detections = [];

        const elapsed = timeMs(() => sanitizeValue(body, 'body', detections));

        expect(elapsed).toBeLessThan(250);
        // Every string was scanned (none skipped as oversize) and found the marker.
        expect(detections.filter((d) => d.type === 'OVERSIZE_NOT_INSPECTED')).toEqual([]);
        const markerHits = detections.filter((d) => d.pattern === 'javascript\\s*:');
        expect(markerHits).toHaveLength(16);
    });
});

describe('BACK-01 — the linear detectors flag exactly what the old patterns flagged', () => {
    // The patterns as they stood before BACK-01, verbatim. They are safe to run
    // here because every string below is short.
    const REFERENCE = [
        [/<script\b[^>]*>/i, 'XSS'],
        [/javascript\s*:/i, 'XSS'],
        [/on\w+\s*=/i, 'XSS'],
        [/data\s*:\s*text\/html/i, 'XSS'],
        [/vbscript\s*:/i, 'XSS'],
        [/expression\s*\(/i, 'XSS'],
        [/;\s*(DROP|ALTER|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET)\s/i, 'SQL_INJECTION'],
        [/UNION\s+(ALL\s+)?SELECT/i, 'SQL_INJECTION'],
        [/\/\*[\s\S]*?\*\//, 'SQL_INJECTION'],
        [/--\s/, 'SQL_INJECTION'],
    ];

    function expected(value) {
        return REFERENCE
            .filter(([re]) => re.test(value))
            .map(([re, type]) => ({ path: 'v', pattern: re.source, type }));
    }

    function actual(value) {
        const detections = [];
        sanitizeValue(value, 'v', detections);
        return detections;
    }

    const HAND_PICKED = [
        '<script>alert(1)</script>', '<SCRIPT src=x>', '<script', '<scripts>', '<script\n>', 'x<script y',
        'javascript:alert(1)', 'JavaScript :x', 'javascript\t\n:', 'javascrip:',
        '<img onerror=alert(1)>', 'onsite=ตรวจแล้ว', 'online=yes', 'one=1', 'on=1', 'button=1', 'buttons=1',
        'xonx =', 'ON_X\t=', 'onn', 'สวน onclick = x', 'oné=1', '_on_=', 'o n=1', 'on1 \n =',
        'data:text/html,<h1>', 'DATA : TEXT/HTML', 'data:text/plain',
        'vbscript:msgbox', 'expression(alert(1))', 'expression (x)',
        "Robert'; DROP TABLE users; --", ';DROP ', '; delete  from x', '; UPDATE users SET x', ';UPDATE u  SET\t',
        '; update a set', '; UPDATE  SET ', 'x; TRUNCATE t', '1 UNION SELECT', 'union all select', 'UNIONSELECT',
        "admin'/* comment */", '/*/', '/**/', 'a */ b /* c', 'ปุ๋ยสูตร 15-15-15 /* ใช้ตามฉลาก */',
        'สวนสมใจ -- แปลงที่ 1', 'ค่า pH 6.5--7.0', '--\n', '', 'John Doe',
    ];

    it.each(HAND_PICKED)('%j', (value) => {
        expect(actual(value)).toEqual(expected(value));
    });

    it('agrees on 20,000 generated strings built from the patterns\' own pieces', () => {
        // Deterministic PRNG (mulberry32) so a failure reproduces.
        let seed = 0x5eed1234;
        const rand = () => {
            seed = (seed + 0x6D2B79F5) | 0;
            let t = seed;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const pieces = [
            '<script', '>', 'javascript', 'onclick', 'on', 'ON', '=', ' ', '\t', '\n', ':', '(', ';', '/*', '*/', '*', '/',
            '-', '--', 'DROP', 'ALTER', 'TRUNCATE', 'DELETE', 'FROM', 'UPDATE', 'SET', 'UNION', 'ALL', 'SELECT',
            'data', 'text/html', 'vbscript', 'expression', 'a', 'x', '_', '1', 'ก', 'é',
        ];
        const mismatches = [];
        for (let i = 0; i < 20_000; i += 1) {
            let value = '';
            const count = Math.floor(rand() * 12);
            for (let j = 0; j < count; j += 1) {
                value += pieces[Math.floor(rand() * pieces.length)];
            }
            const want = expected(value);
            const got = actual(value);
            if (JSON.stringify(want) !== JSON.stringify(got)) {
                mismatches.push({ value, want, got });
            }
        }
        expect(mismatches.slice(0, 5)).toEqual([]);
    });
});
