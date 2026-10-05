/**
 * Sentry on the backend, measured at the wire.
 *
 * A real Express app (fixtures/sentry/express-error-app.js) is wired to the
 * real @sentry/node SDK through config/sentry.js and run as a child process.
 * Its DSN points at a local HTTP sink in this test, so what the sink receives
 * is byte-for-byte what Sentry's ingest would receive. Nothing here mocks the
 * scrubber or the SDK: if a national ID reaches the sink, it would have reached
 * Sentry.
 *
 * Three claims:
 *   1. An Express 500 whose body, header, query string and message all carry a
 *      fake national ID, an email and a JWT arrives with none of them, and with
 *      its error type and stack intact.
 *   2. An unhandled promise rejection is reported, scrubbed, and the process
 *      still exits non-zero (Node's own default is kept).
 *   3. With no SENTRY_DSN the SDK is never loaded and the process opens zero
 *      outbound connections, even while serving the same failing request.
 */

'use strict';

const {
    startSink, startApp, call, waitFor, itemsIn, eventsIn,
} = require('../fixtures/sentry/wire');

const NATIONAL_ID = '1-2345-67890-12-3';
const NATIONAL_ID_DIGITS = '1234567890123';
const EMAIL = 'test@example.com';
const JWT = [
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    'eyJzdWIiOiJ1c2VyLTEiLCJyb2xlIjoiaGVhbHRoIn0',
    'c2lnbmF0dXJlLW5vdC1yZWFs',
].join('.');
const GIT_SHA = '37799f12a1b2c3d4e5f60718293a4b5c6d7e8f90';
const PROJECT_ID = '42';

jest.setTimeout(30000);

function expectNothingPersonal(raw) {
    expect(raw).not.toContain(NATIONAL_ID);
    expect(raw).not.toContain(NATIONAL_ID_DIGITS);
    expect(raw).not.toContain(EMAIL);
    expect(raw).not.toContain(JWT);
    expect(raw).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
}

describe('backend Sentry — an Express 500 at the wire', () => {
    let sink;
    let app;

    beforeAll(async () => {
        sink = await startSink();
        app = await startApp({
            SENTRY_DSN: `http://publickey@127.0.0.1:${sink.port}/${PROJECT_ID}`,
            SENTRY_ENVIRONMENT: 'test-sink',
            // Every request traced, so the transaction path is measured on every run.
            SENTRY_TRACES_SAMPLE_RATE: '1',
            GIT_SHA,
        });
    });

    afterAll(async () => {
        if (app) {
            app.child.kill();
            await app.exited;
        }
        if (sink) {await sink.close();}
    });

    it('sends the error, scrubbed, with type and stack kept', async () => {
        const res = await call(
            app.port,
            'POST',
            `/api/applications/${NATIONAL_ID_DIGITS}/lookup?nationalId=${NATIONAL_ID_DIGITS}&token=${JWT}`,
            {
                body: { nationalId: NATIONAL_ID, email: EMAIL },
                headers: {
                    authorization: `Bearer ${JWT}`,
                    cookie: `auth_token=${JWT}`,
                    'x-applicant-email': EMAIL,
                    'x-national-id': NATIONAL_ID,
                },
            },
        );
        expect(res.status).toBe(500);

        const arrived = await waitFor(() => eventsIn(sink.requests).length > 0);
        expect(arrived).toBe(true);
        expect(sink.requests[0].url).toMatch(new RegExp(`^/api/${PROJECT_ID}/envelope/`));

        const raw = sink.requests.map((r) => r.text).join('\n');
        expectNothingPersonal(raw);

        const [event] = eventsIn(sink.requests);
        const [exception] = event.exception.values;
        expect(exception.type).toBe('Error');
        expect(exception.value).toContain('[TEST] ไม่พบผู้ยื่น');
        expect(exception.value).toContain('[Filtered]');
        expect(exception.stacktrace.frames.length).toBeGreaterThan(0);
        expect(exception.stacktrace.frames.some((f) => (f.filename || '').endsWith('express-error-app.js'))).toBe(true);
        expect(exception.mechanism.type).toMatch(/express/);
        // Local variables are never captured (includeLocalVariables: false).
        expect(exception.stacktrace.frames.some((f) => f.vars)).toBe(false);

        expect(event.release).toBe(GIT_SHA);
        expect(event.environment).toBe('test-sink');
        expect(event.request.data).toBeUndefined();
        expect(event.request.cookies).toBeUndefined();
        expect(event.request.headers.authorization).toBeUndefined();
        expect(event.request.headers.cookie).toBeUndefined();
        expect(event.request.headers['x-national-id']).toBeUndefined();
        expect(event.user).toBeUndefined();
    });

    it('sends the request trace as a scrubbed transaction event, never as streamed spans', async () => {
        const traced = await waitFor(() => itemsIn(sink.requests, 'transaction').length > 0);
        expect(traced).toBe(true);
        expect(itemsIn(sink.requests, 'span')).toEqual([]);
        const [transaction] = itemsIn(sink.requests, 'transaction');
        expect(transaction.transaction).not.toContain(NATIONAL_ID_DIGITS);
        expect(transaction.spans.length).toBeGreaterThan(0);
        // Headers off the allowlist are not carried as span attributes either.
        const traceData = transaction.contexts.trace.data;
        expect(Object.keys(traceData).filter((k) => k.startsWith('http.request.header.')).sort())
            .toEqual(['http.request.header.content-type', 'http.request.header.host']);
        expectNothingPersonal(JSON.stringify(transaction));
    });

    it('opened connections only to the sink, and loaded the SDK (positive control for the off test)', async () => {
        const report = JSON.parse((await call(app.port, 'GET', '/__report')).text);
        expect(report.sdkLoaded).toBe(true);
        expect(report.connects.length).toBeGreaterThan(0);
        for (const c of report.connects) {
            expect(Number(c.port)).toBe(sink.port);
        }
    });
});

describe('backend Sentry — query strings and the Referer never leave (a search box sends names)', () => {
    const SEARCHED = 'มานี ทดสอบสอง';
    const REFERRED = 'ชื่อ รีเฟอเรอร์';
    const OUTBOUND = 'สมศรี ทดสอบหก';
    let sink;
    let app;

    beforeAll(async () => {
        sink = await startSink();
        app = await startApp({
            SENTRY_DSN: `http://publickey@127.0.0.1:${sink.port}/${PROJECT_ID}`,
            SENTRY_ENVIRONMENT: 'test-sink',
            SENTRY_TRACES_SAMPLE_RATE: '1',
        });
        const referer = `https://demo.example.test/provider/applications?q=${encodeURIComponent(REFERRED)}`;
        await call(app.port, 'GET', `/api/v2/provider/applications?q=${encodeURIComponent(SEARCHED)}&page=2`, { headers: { referer } });
        await call(app.port, 'GET', `/api/outbound?who=${encodeURIComponent(OUTBOUND)}`, { headers: { referer } });
        await waitFor(() => eventsIn(sink.requests).length >= 2 && itemsIn(sink.requests, 'transaction').length >= 2);
    });

    afterAll(async () => {
        if (app) {
            app.child.kill();
            await app.exited;
        }
        if (sink) {await sink.close();}
    });

    it('no searched, referred or outbound-query name appears anywhere on the wire, encoded or not', () => {
        const raw = sink.requests.map((r) => r.text).join('\n');
        expect(eventsIn(sink.requests).length).toBeGreaterThanOrEqual(2);
        for (const name of [SEARCHED, REFERRED, OUTBOUND]) {
            expect(raw).not.toContain(name);
            expect(raw).not.toContain(encodeURIComponent(name));
            expect(raw).not.toContain(name.split(' ')[0]);
        }
        // No query value of any kind (source-context lines of the fixture may show `?q=${…}` as code).
        expect(raw).not.toMatch(/[?&](q|who|page)=[^$]/);
    });

    it('keeps the path, and the Referer as origin + path', () => {
        const search = eventsIn(sink.requests).find((e) => e.exception.values[0].value === '[TEST] search failed');
        expect(search.request.url).toMatch(/\/api\/v2\/provider\/applications$/);
        expect(search.request.query_string).toBeUndefined();
        expect(search.request.headers.referer).toBe('https://demo.example.test/provider/applications');
    });
});

describe('backend Sentry — a percent-encoded Thai path segment (re-review P1)', () => {
    const NAME = 'ปิยะ ทดสอบพาธ';
    let sink;
    let app;

    beforeAll(async () => {
        sink = await startSink();
        app = await startApp({
            SENTRY_DSN: `http://publickey@127.0.0.1:${sink.port}/${PROJECT_ID}`,
            SENTRY_ENVIRONMENT: 'test-sink',
            SENTRY_TRACES_SAMPLE_RATE: '1',
        });
        await call(app.port, 'GET', `/api/outbound-path?who=${encodeURIComponent(NAME)}`);
        await call(app.port, 'GET', `/api/nextjs-context?who=${encodeURIComponent(NAME)}`);
        await waitFor(() => eventsIn(sink.requests).length >= 2 && itemsIn(sink.requests, 'transaction').length >= 2);
    });

    afterAll(async () => {
        if (app) {
            app.child.kill();
            await app.exited;
        }
        if (sink) {await sink.close();}
    });

    it('the http.client span description carries no encoded Thai segment', () => {
        const descriptions = itemsIn(sink.requests, 'transaction')
            .flatMap((t) => t.spans || [])
            .filter((sp) => sp.op === 'http.client')
            .map((sp) => sp.description);
        expect(descriptions.length).toBeGreaterThan(0);
        for (const d of descriptions) {
            expect(d).not.toMatch(/%E0%B[89]/i);
        }
        expect(descriptions.some((d) => /\/api\/echo\/\[Filtered\]/.test(d))).toBe(true);
    });

    it('contexts.nextjs.request_path keeps the route, not the name', () => {
        const event = eventsIn(sink.requests).find((e) => e.exception.values[0].value === '[TEST] nextjs context');
        expect(event.contexts.nextjs.request_path).toBe('/health/applications/[Filtered]');
    });

    it('the name appears nowhere on the wire, encoded or not', () => {
        const raw = sink.requests.map((r) => r.text).join('\n');
        expect(raw).not.toContain(NAME);
        expect(raw).not.toContain(encodeURIComponent(NAME));
        expect(raw).not.toContain(encodeURIComponent(NAME).toLowerCase());
    });
});

describe('backend Sentry — an unhandled promise rejection', () => {
    it('is reported scrubbed, and the process still exits non-zero', async () => {
        const sink = await startSink();
        let app;
        try {
            app = await startApp({
                SENTRY_DSN: `http://publickey@127.0.0.1:${sink.port}/${PROJECT_ID}`,
                SENTRY_ENVIRONMENT: 'test-sink',
                SENTRY_TRACES_SAMPLE_RATE: '1',
            });
            const res = await call(app.port, 'POST', '/api/applications/reject', { body: { nationalId: NATIONAL_ID } });
            expect(res.status).toBe(202);
            const code = await Promise.race([app.exited, new Promise((r) => setTimeout(() => r('still-running'), 15000))]);
            expect(code).toBe(1);

            const raw = sink.requests.map((r) => r.text).join('\n');
            expectNothingPersonal(raw);
            const [event] = eventsIn(sink.requests);
            expect(event.exception.values[0].value).toBe('[TEST] rejection [Filtered]');
            expect(event.exception.values[0].mechanism.type).toBe('auto.node.onunhandledrejection');
            expect(event.level).toBe('fatal');
        } finally {
            if (app) {app.child.kill();}
            await sink.close();
        }
    });
});

describe('backend Sentry — off by default', () => {
    it('with no SENTRY_DSN: SDK never loaded, zero outbound connections, the 500 still served', async () => {
        const sink = await startSink();
        let app;
        try {
            app = await startApp({});
            const res = await call(
                app.port,
                'POST',
                `/api/applications/${NATIONAL_ID_DIGITS}/lookup?token=${JWT}`,
                { body: { nationalId: NATIONAL_ID }, headers: { 'x-applicant-email': EMAIL } },
            );
            expect(res.status).toBe(500);
            await new Promise((r) => setTimeout(r, 500));

            const report = JSON.parse((await call(app.port, 'GET', '/__report')).text);
            expect(report.sdkLoaded).toBe(false);
            expect(report.connects).toEqual([]);
            expect(sink.requests).toEqual([]);
        } finally {
            if (app) {
                app.child.kill();
                await app.exited;
            }
            await sink.close();
        }
    });

    it('treats a whitespace-only SENTRY_DSN as unset', async () => {
        let app;
        try {
            app = await startApp({ SENTRY_DSN: '   ' });
            await call(app.port, 'POST', `/api/applications/${NATIONAL_ID_DIGITS}/lookup`, { body: { nationalId: NATIONAL_ID } });
            const report = JSON.parse((await call(app.port, 'GET', '/__report')).text);
            expect(report.sdkLoaded).toBe(false);
            expect(report.connects).toEqual([]);
        } finally {
            if (app) {
                app.child.kill();
                await app.exited;
            }
        }
    });
});
