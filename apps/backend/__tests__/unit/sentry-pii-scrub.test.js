/**
 * Error-report PII scrubber — packages/error-reporting/src/scrub.js.
 *
 * Sentry was re-added 2026-10-02 by operator decision, with personal-data
 * scrubbing as the first-class requirement (PDPA). The backend and the web app
 * share ONE scrubber; this suite pins its behaviour on payloads shaped like the
 * ones this platform actually produces — Thai text with national IDs, tax IDs,
 * phone numbers and emails inside it, Stripe ids, bearer tokens, a database URL
 * with its password.
 *
 * Fake credentials are assembled at runtime (`join('_')`) so the repository's
 * secret scanners never see a key-shaped literal in this file.
 */

'use strict';

const {
    FILTERED,
    scrubString,
    scrubEvent,
    scrubBreadcrumb,
    scrubEnvelope,
    scrubbingTransport,
    scrubUrl,
    sentryScrubOptions,
} = require('@gacp/error-reporting/scrub');

// ── fixtures ────────────────────────────────────────────────────────────────
const NATIONAL_ID_DASHED = '1-2345-67890-12-3';
const NATIONAL_ID_SPACED = '3 3214 87175 27 4';
const NATIONAL_ID_PLAIN = '3321487175274';
const TAX_ID = '0105568045932';
const EMAIL = 'somchai.jaidee@example.co.th';
const MOBILE_DASHED = '081-234-5678';
const MOBILE_PLAIN = '0891234567';
const MOBILE_INTL = '+66 81 234 5678';
const LANDLINE = '02-123-4567';
const JWT = [
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    'eyJzdWIiOiJ1c2VyLTEiLCJyb2xlIjoiaGVhbHRoIn0',
    'c2lnbmF0dXJlLW5vdC1yZWFs',
].join('.');
const STRIPE_PI = ['pi', '3PqXyZ2eZvKYlo2C1aBcDeFg'].join('_');
const STRIPE_PI_SECRET = `${STRIPE_PI}_secret_${'AbCdEf123456'}`;
const STRIPE_CS = ['cs', 'test', 'a1B2c3D4e5F6g7H8i9J0'].join('_');
const STRIPE_SK = ['sk', 'test', '51HxYzAbCdEfGh12345678'].join('_');
const STRIPE_WHSEC = ['whsec', 'AbCdEfGh1234567890IjKl'].join('_');
const BEARER = 'Bearer abc.def-ghi_jkl~mno+pqr/stu=';
const PG_URL = 'postgresql://gacp_app:S3cr3t-P4ss@db.internal:5432/gacp?schema=public';
const USER_UUID = '6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b';

const ALL_SECRETS = [
    '1-2345-67890-12-3', '3 3214 87175 27 4', NATIONAL_ID_PLAIN, TAX_ID, EMAIL,
    MOBILE_DASHED, MOBILE_PLAIN, '81 234 5678', LANDLINE, JWT, STRIPE_PI, 'AbCdEf123456',
    STRIPE_CS, STRIPE_SK, STRIPE_WHSEC, 'abc.def-ghi_jkl', 'S3cr3t-P4ss',
];

function expectNoSecret(serialised) {
    for (const secret of ALL_SECRETS) {
        expect(serialised).not.toContain(secret);
    }
}

describe('scrubString — the patterns', () => {
    it.each([
        ['national ID with dashes', `เลขบัตร ${NATIONAL_ID_DASHED} ไม่ถูกต้อง`, NATIONAL_ID_DASHED],
        ['national ID with spaces', `เลขบัตร ${NATIONAL_ID_SPACED}`, NATIONAL_ID_SPACED],
        ['national ID, 13 plain digits', `idCard=${NATIONAL_ID_PLAIN}`, NATIONAL_ID_PLAIN],
        ['national ID glued to Thai text', `เลขประจำตัวประชาชน${NATIONAL_ID_PLAIN}ซ้ำ`, NATIONAL_ID_PLAIN],
        ['tax ID (same 13-digit shape)', `ผู้เสียภาษี ${TAX_ID}`, TAX_ID],
        ['email', `ติดต่อ ${EMAIL} แล้ว`, EMAIL],
        ['Thai mobile with dashes', `โทร ${MOBILE_DASHED}`, MOBILE_DASHED],
        ['Thai mobile, plain digits', `phone:${MOBILE_PLAIN}`, MOBILE_PLAIN],
        ['Thai mobile, +66 form', `โทร ${MOBILE_INTL}`, '81 234 5678'],
        ['Bangkok landline', `สำนักงาน ${LANDLINE}`, LANDLINE],
        ['JWT', `token ${JWT} expired`, JWT],
        ['Stripe PaymentIntent id', `intent ${STRIPE_PI} failed`, STRIPE_PI],
        ['Stripe client secret', `secret=${STRIPE_PI_SECRET}`, 'AbCdEf123456'],
        ['Stripe Checkout Session id', `session ${STRIPE_CS}`, STRIPE_CS],
        ['Stripe secret key', `key ${STRIPE_SK}`, STRIPE_SK],
        ['Stripe webhook secret', `whsec ${STRIPE_WHSEC}`, STRIPE_WHSEC],
        ['bearer token', `Authorization: ${BEARER}`, 'abc.def-ghi_jkl'],
        ['postgres URL password', `connect ${PG_URL} refused`, 'S3cr3t-P4ss'],
    ])('removes %s', (_label, input, secret) => {
        const out = scrubString(input);
        expect(out).not.toContain(secret);
        expect(out).toContain(FILTERED);
    });

    it('keeps the Thai prose around a scrubbed ID readable', () => {
        const out = scrubString(`ไม่พบผู้ยื่นคำขอ เลขบัตร ${NATIONAL_ID_DASHED} ในระบบ`);
        expect(out).toBe(`ไม่พบผู้ยื่นคำขอ เลขบัตร ${FILTERED} ในระบบ`);
    });

    it('keeps the postgres user and host, drops only the password', () => {
        const out = scrubString(PG_URL);
        expect(out).toContain('postgresql://gacp_app:');
        expect(out).toContain('@db.internal:5432/gacp');
        expect(out).not.toContain('S3cr3t-P4ss');
    });

    it('scrubs a message that mixes every kind at once', () => {
        const message = `ทดสอบ ${NATIONAL_ID_DASHED} ${EMAIL} โทร ${MOBILE_DASHED} ${BEARER} ${STRIPE_PI} ${PG_URL}`;
        const out = scrubString(message);
        expectNoSecret(out);
        expect(out.startsWith('ทดสอบ ')).toBe(true);
    });

    it('leaves ordinary operational text alone', () => {
        const text = 'GET /api/applications 500 in 132ms — PrismaClientKnownRequestError P2025';
        expect(scrubString(text)).toBe(text);
    });

    it('does not mangle a UUID', () => {
        expect(scrubString(`user ${USER_UUID}`)).toBe(`user ${USER_UUID}`);
    });

    it('passes non-strings through untouched', () => {
        expect(scrubString(42)).toBe(42);
        expect(scrubString(null)).toBe(null);
        expect(scrubString(undefined)).toBe(undefined);
    });
});

function serverErrorEvent() {
    return {
        event_id: '0123456789abcdef0123456789abcdef',
        level: 'error',
        platform: 'node',
        release: '37799f12a1b2c3d4e5f60718293a4b5c6d7e8f90',
        environment: 'staging',
        message: `ไม่พบเกษตรกร ${NATIONAL_ID_DASHED}`,
        logentry: { message: `lookup failed for %s`, params: [EMAIL] },
        exception: {
            values: [{
                type: 'ApplicantLookupError',
                value: `ผู้ยื่น ${NATIONAL_ID_PLAIN} อีเมล ${EMAIL} โทร ${MOBILE_DASHED}`,
                stacktrace: {
                    frames: [
                        { filename: '/app/apps/backend/routes/api/applications.js', function: 'lookupApplicant', lineno: 120, in_app: true, vars: { idCard: NATIONAL_ID_PLAIN, note: `เบอร์ ${MOBILE_PLAIN}` } },
                    ],
                },
                mechanism: { type: 'auto.middleware.express', handled: false },
            }],
        },
        request: {
            method: 'POST',
            url: `https://staging.example.test/api/applications/lookup?nationalId=${NATIONAL_ID_PLAIN}&page=2`,
            query_string: `nationalId=${NATIONAL_ID_PLAIN}&page=2`,
            data: { nationalId: NATIONAL_ID_PLAIN, email: EMAIL, firstName: 'สมชาย' },
            cookies: { auth_token: JWT },
            headers: {
                'content-type': 'application/json',
                'user-agent': 'Mozilla/5.0',
                authorization: BEARER,
                cookie: `auth_token=${JWT}`,
                'x-national-id': NATIONAL_ID_DASHED,
                'x-csrf-token': 'csrf-abc-123',
                referer: `https://staging.example.test/health/applications?email=${EMAIL}`,
            },
            env: { REMOTE_ADDR: '203.0.113.7' },
        },
        user: { id: USER_UUID, email: EMAIL, username: 'สมชาย ใจดี', ip_address: '203.0.113.7' },
        tags: { route: '/api/applications/lookup', applicant: EMAIL },
        extra: {
            body: { nationalId: NATIONAL_ID_DASHED },
            nested: { deeper: { phone: MOBILE_INTL, note: `ภาษี ${TAX_ID}` } },
            password: 'hunter2',
        },
        contexts: {
            trace: { trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', span_id: '00f067aa0ba902b7', data: { 'http.query': `?id=${NATIONAL_ID_PLAIN}` } },
            app: { app_start_time: '2026-10-02T10:00:00.000Z' },
            response: { status_code: 500 },
            stripe: { paymentIntent: STRIPE_PI, clientSecret: STRIPE_PI_SECRET },
            db: { url: PG_URL },
        },
        breadcrumbs: [
            { category: 'console', level: 'log', message: `checking ${NATIONAL_ID_DASHED}` },
            { category: 'console', level: 'log', message: 'cron tick ok' },
            { category: 'http', type: 'http', data: { url: `https://api.example.test/v1/payment_intents/${STRIPE_PI}?expand=x`, method: 'GET', status_code: 200, request_body: { card: 'x' }, response_body: { email: EMAIL } } },
            { category: 'fetch', type: 'http', data: { url: `/api/auth/health/login?id=${NATIONAL_ID_PLAIN}`, method: 'POST', status_code: 401, body: `{"password":"x"}` } },
            { category: 'navigation', data: { from: `/health/profile?phone=${MOBILE_PLAIN}`, to: '/health/dashboard' } },
        ],
    };
}

describe('scrubEvent — a server error event', () => {
    const scrubbed = scrubEvent(serverErrorEvent());
    const serialised = JSON.stringify(scrubbed);

    it('carries no national ID, tax ID, email, phone, token, Stripe id or DB password anywhere', () => {
        expectNoSecret(serialised);
        expect(serialised).not.toContain('hunter2');
        expect(serialised).not.toContain('203.0.113.7');
        expect(serialised).not.toContain('สมชาย');
        expect(serialised).not.toContain('csrf-abc-123');
    });

    it('keeps the error type, the stack frames and the mechanism', () => {
        const [exception] = scrubbed.exception.values;
        expect(exception.type).toBe('ApplicantLookupError');
        expect(exception.value).toContain(FILTERED);
        expect(exception.stacktrace.frames[0]).toMatchObject({
            filename: '/app/apps/backend/routes/api/applications.js',
            function: 'lookupApplicant',
            lineno: 120,
        });
        expect(exception.mechanism).toEqual({ type: 'auto.middleware.express', handled: false });
    });

    it('drops the request body, cookies, the authorization header and unlisted headers', () => {
        expect(scrubbed.request.data).toBeUndefined();
        expect(scrubbed.request.cookies).toBeUndefined();
        expect(scrubbed.request.env).toBeUndefined();
        expect(scrubbed.request.headers.authorization).toBeUndefined();
        expect(scrubbed.request.headers.cookie).toBeUndefined();
        expect(scrubbed.request.headers['x-national-id']).toBeUndefined();
        expect(scrubbed.request.headers['content-type']).toBe('application/json');
        expect(scrubbed.request.headers['user-agent']).toBe('Mozilla/5.0');
    });

    it('drops the query string on every route, keeping the path', () => {
        expect(scrubbed.request.query_string).toBeUndefined();
        expect(scrubbed.request.url).toBe('https://staging.example.test/api/applications/lookup');
    });

    it('reduces the Referer to origin + path', () => {
        expect(scrubbed.request.headers.referer).toBe('https://staging.example.test/health/applications');
    });

    it('keeps only the user id, and only when it is a UUID', () => {
        expect(scrubbed.user).toEqual({ id: USER_UUID });
        expect(scrubEvent({ user: { id: '42', email: EMAIL } }).user).toBeUndefined();
        expect(scrubEvent({ user: { email: EMAIL } }).user).toBeUndefined();
    });

    it('keeps trace ids intact so traces still link', () => {
        expect(scrubbed.contexts.trace.trace_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
        expect(scrubbed.contexts.trace.span_id).toBe('00f067aa0ba902b7');
        expect(scrubbed.contexts.response).toEqual({ status_code: 500 });
    });

    it('keeps release, environment and level', () => {
        expect(scrubbed.release).toBe('37799f12a1b2c3d4e5f60718293a4b5c6d7e8f90');
        expect(scrubbed.environment).toBe('staging');
        expect(scrubbed.level).toBe('error');
    });

    it('drops console breadcrumbs that carried a scrubbed pattern, keeps the clean ones', () => {
        const consoleCrumbs = scrubbed.breadcrumbs.filter((b) => b.category === 'console');
        expect(consoleCrumbs).toEqual([{ category: 'console', level: 'log', message: 'cron tick ok' }]);
    });

    it('drops fetch/xhr/http bodies and the query string of auth/payment URLs', () => {
        const http = scrubbed.breadcrumbs.find((b) => b.category === 'http');
        expect(http.data.request_body).toBeUndefined();
        expect(http.data.response_body).toBeUndefined();
        expect(http.data.method).toBe('GET');
        expect(http.data.status_code).toBe(200);
        const login = scrubbed.breadcrumbs.find((b) => b.category === 'fetch');
        expect(login.data.body).toBeUndefined();
        expect(login.data.url).toBe('/api/auth/health/login');
    });
});

describe('scrubEvent — the query string is removed (auth and payment routes included)', () => {
    it('removes query_string and the query part of the URL', () => {
        const out = scrubEvent({
            request: {
                method: 'GET',
                url: 'https://demo.example.test/api/payments/checkout/return?session_id=abc&state=xyz',
                query_string: 'session_id=abc&state=xyz',
            },
        });
        expect(out.request.query_string).toBeUndefined();
        expect(out.request.url).toBe('https://demo.example.test/api/payments/checkout/return');
    });

    it('handles query_string given as key/value pairs too', () => {
        const out = scrubEvent({
            request: { url: '/api/auth/health/login', query_string: [['next', '/x'], ['id', NATIONAL_ID_PLAIN]] },
        });
        expect(out.request.query_string).toBeUndefined();
    });
});

describe('scrubEvent — a transaction event', () => {
    it('scrubs the transaction name, span descriptions and span data', () => {
        const out = scrubEvent({
            type: 'transaction',
            transaction: `GET /api/applicants/${NATIONAL_ID_PLAIN}`,
            spans: [
                { description: `SELECT * FROM users WHERE email = '${EMAIL}'`, op: 'db', data: { 'db.statement': `id=${NATIONAL_ID_DASHED}` } },
                { description: `GET https://api.example.test/v1/payment_intents/${STRIPE_PI}`, op: 'http.client', data: { url: `/api/auth/x?token=${JWT}` } },
            ],
            contexts: { trace: { trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', span_id: '00f067aa0ba902b7' } },
        });
        expectNoSecret(JSON.stringify(out));
        expect(out.transaction).toBe(`GET /api/applicants/${FILTERED}`);
        expect(out.spans[0].op).toBe('db');
        expect(out.contexts.trace.trace_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    });
});

describe('scrubEvent — OpenTelemetry attributes on the trace context', () => {
    const TRACE = { trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', span_id: '00f067aa0ba902b7' };

    it('drops headers off the allowlist, bodies, addresses, and the query of a payment route', () => {
        const out = scrubEvent({
            type: 'transaction',
            contexts: {
                trace: {
                    ...TRACE,
                    data: {
                        'url.full': 'https://demo.example.test/api/payments/checkout?session_id=abc',
                        'url.path': '/api/payments/checkout',
                        'url.query': 'session_id=abc',
                        'http.request.header.content-type': ['application/json'],
                        'http.request.header.x-applicant-name': ['สมชาย ใจดี'],
                        'http.request.header.cookie': [`auth_token=${JWT}`],
                        'http.request.body.data': '{"firstName":"สมชาย"}',
                        'client.address': '203.0.113.7',
                        'http.response.status_code': 500,
                    },
                },
            },
        });
        const { data } = out.contexts.trace;
        expect(data['url.full']).toBe('https://demo.example.test/api/payments/checkout');
        expect(data).not.toHaveProperty('url.query');
        expect(data['http.request.header.content-type']).toEqual(['application/json']);
        expect(data).not.toHaveProperty('http.request.header.x-applicant-name');
        expect(data).not.toHaveProperty('http.request.header.cookie');
        expect(data['http.request.body.data']).toBe(FILTERED);
        expect(data['http.response.status_code']).toBe(500);
        const serialised = JSON.stringify(out);
        expect(serialised).not.toContain('สมชาย');
        expect(serialised).not.toContain('203.0.113.7');
        expect(serialised).not.toContain(JWT);
        expect(out.contexts.trace.trace_id).toBe(TRACE.trace_id);
    });

    it('drops the query on an ordinary route too — a search box sends names (provider ?q=)', () => {
        const out = scrubEvent({
            contexts: {
                trace: {
                    ...TRACE,
                    data: {
                        'url.path': '/api/v2/provider/applications',
                        'url.full': `https://x.test/api/v2/provider/applications?q=${encodeURIComponent('มานี ทดสอบสอง')}&page=2`,
                        'url.query': `q=${encodeURIComponent('มานี ทดสอบสอง')}&page=2`,
                        'http.query': '?q=x',
                        'http.request.header.referer': [`https://x.test/provider/applications?q=${encodeURIComponent('ชื่อ รีเฟอเรอร์')}`],
                    },
                },
            },
        });
        const { data } = out.contexts.trace;
        expect(data).not.toHaveProperty('url.query');
        expect(data).not.toHaveProperty('http.query');
        expect(data['url.full']).toBe('https://x.test/api/v2/provider/applications');
        expect(data['http.request.header.referer']).toEqual(['https://x.test/provider/applications']);
    });
});

// Real Prisma 5.22 messages, captured 2026-10-02 against Postgres 17 (scratch DB).
const PRISMA_VALIDATION = [
    '',
    'Invalid `prisma.user.create()` invocation in',
    '/app/apps/backend/services/profile-service.js:42:22',
    '',
    '  39 async function saveProfile(input) {',
    '→ 42   await prisma.user.create({',
    '        data: {',
    '          firstName: "สมชายทดสอบหนึ่ง",',
    '          lastName: "ใจดีทดสอบ",',
    '          bogusField: 1,',
    '          address: "99 ถนนทดสอบ",',
    '          passport: "AA7654321",',
    '      +   password: String',
    '        }',
    '      })',
    '',
    'Argument `password` is missing.',
].join('\n');
const PRISMA_RAW_CHECK = [
    '',
    'Invalid `prisma.$executeRawUnsafe()` invocation:',
    '',
    '',
    'Raw query failed. Code: `23514`. Message: `ERROR: new row for relation "review_t" violates check constraint "review_t_n_check"',
    'DETAIL: Failing row contains (สมชาย ตรวจสอบ, 12 ถนนตรวจ, -1, e1).`',
].join('\n');
const PRISMA_RAW_UNIQUE = '\nInvalid `prisma.$executeRawUnsafe()` invocation:\n\n\nRaw query failed. Code: `23505`. Message: `Key (full_name)=(สมศรี ซ้ำกัน) already exists.`';

describe('Prisma error messages — the argument tree and row values never leave', () => {
    it('cuts a validation error down to the operation and its summary line', () => {
        const [ex] = scrubEvent({ exception: { values: [{ type: 'PrismaClientValidationError', value: PRISMA_VALIDATION }] } }).exception.values;
        for (const leaked of ['สมชาย', 'ใจดี', '99 ถนน', 'AA7654321', 'profile-service.js']) {
            expect(ex.value).not.toContain(leaked);
        }
        expect(ex.value).toBe('Invalid `user.create()` invocation: Argument `password` is missing.');
        expect(ex.type).toBe('PrismaClientValidationError');
    });

    it('redacts the failing row and the duplicate key value of a raw-query error, keeps the code and constraint', () => {
        const [check] = scrubEvent({ exception: { values: [{ type: 'PrismaClientKnownRequestError', value: PRISMA_RAW_CHECK }] } }).exception.values;
        expect(check.value).not.toContain('สมชาย');
        expect(check.value).not.toContain('12 ถนนตรวจ');
        expect(check.value).toContain('Code: `23514`');
        expect(check.value).toContain('review_t_n_check');
        const [unique] = scrubEvent({ exception: { values: [{ type: 'PrismaClientKnownRequestError', value: PRISMA_RAW_UNIQUE }] } }).exception.values;
        expect(unique.value).not.toContain('สมศรี');
        expect(unique.value).toContain('Key (full_name)=([Filtered])');
    });

    it('does the same wherever the message text travels (logged string, console breadcrumb, extra)', () => {
        expect(scrubString(`Error: ${PRISMA_VALIDATION}`)).not.toContain('สมชาย');
        expect(scrubBreadcrumb({ category: 'console', message: PRISMA_VALIDATION })).toBeNull();
        expect(JSON.stringify(scrubEvent({ extra: { stack: PRISMA_RAW_CHECK } }))).not.toContain('สมชาย');
    });

    it('redacts Postgres DETAIL / Key / Failing row payloads in any string', () => {
        expect(scrubString('duplicate key value violates unique constraint "u_email" DETAIL: Key (email_hmac)=(abc123) already exists.'))
            .toBe('duplicate key value violates unique constraint "u_email" DETAIL: [Filtered]');
        expect(scrubString('Key ("taxId", kind)=(x, y) already exists.')).toBe('Key ("taxId", kind)=([Filtered]) already exists.');
        expect(scrubString('Failing row contains (a, b, c).')).toBe('Failing row contains ([Filtered]).');
    });
});

describe('URLs: no query string survives anywhere, and free-text path segments are cut', () => {
    const NAME = 'มานะ ค้นหาเฟทช์';

    it('strips the query of a URL inside free text (span descriptions, messages)', () => {
        expect(scrubString(`GET https://api.example.test/v1/search?q=${encodeURIComponent(NAME)}&page=1 failed`))
            .toBe('GET https://api.example.test/v1/search failed');
        expect(scrubString(`fetch /api/v2/provider/applications?q=${encodeURIComponent(NAME)} 500`)).toBe('fetch /api/v2/provider/applications 500');
    });

    it('cuts a path segment that carries Thai text or whitespace', () => {
        expect(scrubUrl(`https://x.test/api/nowhere/${encodeURIComponent('นาย ทดสอบเส้นทาง')}/3100901234567`))
            .toBe(`https://x.test/api/nowhere/${FILTERED}/${FILTERED}`);
    });

    it('drops the query of fetch and navigation breadcrumbs on ordinary routes', () => {
        const fetchCrumb = scrubBreadcrumb({ category: 'fetch', type: 'http', data: { url: `/api/v2/provider/applications?q=${encodeURIComponent(NAME)}&status=x`, method: 'GET', status_code: 200 } });
        expect(fetchCrumb.data.url).toBe('/api/v2/provider/applications');
        const nav = scrubBreadcrumb({ category: 'navigation', data: { from: '/health', to: `/health/applications?q=${encodeURIComponent(NAME)}` } });
        expect(nav.data).toEqual({ from: '/health', to: '/health/applications' });
    });
});

describe('the key rule covers this schema\'s personal fields', () => {
    it.each([
        'applicantName', 'personName', 'representativeName', 'intervieweeName', 'holderDisplayName', 'displayName',
        'legalName', 'accountName', 'accountHolder', 'billingName', 'contact', 'contactPhone', 'juristicId',
        'registrationNo', 'communityRegistrationNo', 'pid', 'firstName', 'lastName', 'address', 'passport',
        'nationalId', 'taxId', 'thaiCitizenId', 'name', 'farmerName', 'emailHmac', 'dateOfBirth', 'latitude', 'longitude',
    ])('replaces the value under %s', (key) => {
        const out = scrubEvent({ extra: { [key]: 'ปิยะ ทดสอบสาม' }, contexts: { applicant: { [key]: 'วิไล ทดสอบสี่' } } });
        expect(out.extra[key]).toBe(FILTERED);
        expect(out.contexts.applicant[key]).toBe(FILTERED);
    });

    it('keeps SDK context fields that only look like names (os.name, runtime.name, span names)', () => {
        const out = scrubEvent({
            contexts: {
                os: { name: 'Ubuntu Linux', version: '22.04' },
                runtime: { name: 'node', version: 'v24.21.0' },
                browser: { name: 'Chrome' },
                trace: { trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', data: { 'express.name': 'query', 'sentry.segment.name': 'POST /api/x' } },
            },
        });
        expect(out.contexts.os.name).toBe('Ubuntu Linux');
        expect(out.contexts.runtime.name).toBe('node');
        expect(out.contexts.browser.name).toBe('Chrome');
        expect(out.contexts.trace.data['express.name']).toBe('query');
        expect(out.contexts.trace.data['sentry.segment.name']).toBe('POST /api/x');
    });
});

describe('number shapes the first version missed', () => {
    it.each([
        ['13 digits grouped 4-5-4', 'เลข 1234-56789-0123 นี้'],
        ['13 Thai digits', 'เลข ๑๒๓๔๕๖๗๘๙๐๑๒๓ นี้'],
        ['13 digits with dots', 'เลข 1.2345.67890.12.3 นี้'],
        ['mobile with dots', 'โทร 081.234.5678 นี้'],
        ['landline with brackets', 'โทร (02) 123 4567 นี้'],
        ['mobile with brackets', 'โทร (081) 234-5678 นี้'],
        ['mobile in Thai digits', 'โทร ๐๘๑๒๓๔๕๖๗๘ นี้'],
    ])('removes %s', (_label, text) => {
        const out = scrubString(text);
        expect(out).toMatch(/^\S+ \[Filtered\] นี้$/);
    });
});

describe('free Thai text where a label is expected (reviewer harness, round 1)', () => {
    it('replaces a tag value that carries Thai text — tags are labels, a name has no place there', () => {
        const out = scrubEvent({ tags: { who: 'ทดสอบ ชื่อแท็ก', route: '/api/x', level: 'high' } });
        expect(out.tags).toEqual({ who: FILTERED, route: '/api/x', level: 'high' });
    });

    it('drops a console breadcrumb that carries Thai free text (a name cannot be told from prose)', () => {
        expect(scrubBreadcrumb({ category: 'console', message: '[T8] processing applicant สมใจ คอนโซลสอง', data: { arguments: ['[T8] processing applicant', 'สมใจ คอนโซลสอง'] } })).toBeNull();
        expect(scrubBreadcrumb({ category: 'console', message: 'cron tick ok' })).toEqual({ category: 'console', message: 'cron tick ok' });
    });

    it('removes a 10-digit number written as 020-123-4567', () => {
        expect(scrubString('โทร 020-123-4567 นี้')).toBe(`โทร ${FILTERED} นี้`);
    });
});

describe('scrubEvent — robustness', () => {
    it('survives a circular structure in extra', () => {
        const loop = { name: 'loop' };
        loop.self = loop;
        const out = scrubEvent({ extra: { loop, note: EMAIL } });
        expect(JSON.stringify(out.extra.note)).not.toContain(EMAIL);
    });

    it('fails closed: an event it cannot scrub is dropped, never sent raw', () => {
        const hostile = {};
        Object.defineProperty(hostile, 'message', { get() { throw new Error('boom'); }, enumerable: true });
        expect(scrubEvent(hostile)).toBeNull();
    });

    it('returns null for null', () => {
        expect(scrubEvent(null)).toBeNull();
    });
});

describe('scrubBreadcrumb — the beforeBreadcrumb hook', () => {
    it('drops a console breadcrumb whose arguments carried an ID', () => {
        expect(scrubBreadcrumb({ category: 'console', message: 'x', data: { arguments: [`id ${NATIONAL_ID_PLAIN}`] } })).toBeNull();
    });

    it('keeps a clean console breadcrumb', () => {
        expect(scrubBreadcrumb({ category: 'console', message: 'server started' })).toEqual({ category: 'console', message: 'server started' });
    });

    it('drops the body of an xhr breadcrumb', () => {
        const out = scrubBreadcrumb({ category: 'xhr', data: { url: '/api/applications', method: 'POST', status_code: 201, request_body: { nationalId: NATIONAL_ID_PLAIN }, body: 'x' } });
        expect(out.data).toEqual({ url: '/api/applications', method: 'POST', status_code: 201 });
    });
});

describe('scrubEnvelope — the items that never pass beforeSend', () => {
    const header = { event_id: 'abc', sent_at: '2026-10-02T00:00:00Z', trace: { trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', transaction: `GET /api/applicants/${NATIONAL_ID_PLAIN}`, user_segment: 'vip' } };

    it('removes the IP and a non-UUID distinct id from a session', () => {
        const [, [[, session]]] = scrubEnvelope([header, [[{ type: 'session' }, {
            sid: 'f492edf07f094c4387f04c0138d6c24b', did: EMAIL, status: 'ok',
            attrs: { release: 'abc', environment: 'demo', ip_address: '203.0.113.7', user_agent: 'Mozilla/5.0' },
        }]]]);
        expect(session.did).toBeUndefined();
        expect(session.attrs).toEqual({ release: 'abc', environment: 'demo', user_agent: 'Mozilla/5.0' });
        expect(session.sid).toBe('f492edf07f094c4387f04c0138d6c24b');
    });

    it('keeps a UUID distinct id on a session', () => {
        const [, [[, session]]] = scrubEnvelope([header, [[{ type: 'session' }, { did: USER_UUID, attrs: {} }]]]);
        expect(session.did).toBe(USER_UUID);
    });

    it('scrubs session aggregates', () => {
        const [, [[, agg]]] = scrubEnvelope([header, [[{ type: 'sessions' }, {
            attrs: { ip_address: '203.0.113.7', release: 'abc' }, aggregates: [{ started: 't', exited: 1, did: 'สมชาย' }],
        }]]]);
        expect(JSON.stringify(agg)).not.toContain('203.0.113.7');
        expect(JSON.stringify(agg)).not.toContain('สมชาย');
    });

    it('scrubs streamed span attributes, including a request body', () => {
        const [, [[, container]]] = scrubEnvelope([header, [[{ type: 'span' }, {
            version: 2,
            items: [{
                name: `POST /api/applications/${NATIONAL_ID_PLAIN}/lookup`,
                attributes: {
                    'http.request.body.data': { value: `{"nationalId":"${NATIONAL_ID_DASHED}"}`, type: 'string' },
                    'url.full': { value: `https://x.test/api/auth/health/login?token=${JWT}`, type: 'string' },
                    'user.ip_address': { value: '203.0.113.7', type: 'string' },
                    'http.response.status_code': { value: 500, type: 'integer' },
                },
            }],
        }]]]);
        const serialised = JSON.stringify(container);
        expectNoSecret(serialised);
        expect(serialised).not.toContain('203.0.113.7');
        const [span] = container.items;
        expect(span.attributes['http.response.status_code']).toEqual({ value: 500, type: 'integer' });
        expect(span.attributes['url.full'].value).toBe('https://x.test/api/auth/health/login');
    });

    it('drops attachments, replays, profiles and feedback outright', () => {
        for (const type of ['attachment', 'replay_event', 'replay_recording', 'profile', 'feedback']) {
            expect(scrubEnvelope([header, [[{ type }, { anything: EMAIL }]]])).toBeNull();
        }
    });

    it('scrubs the transaction name in the envelope header and drops user segments', () => {
        const [outHeader] = scrubEnvelope([header, [[{ type: 'client_report' }, { discarded_events: [] }]]]);
        expect(outHeader.trace.transaction).toBe(`GET /api/applicants/${FILTERED}`);
        expect(outHeader.trace.user_segment).toBeUndefined();
        expect(outHeader.trace.trace_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    });

    it('scrubs event items again (idempotent) and returns null for an unreadable envelope', () => {
        const [, [[, event]]] = scrubEnvelope([header, [[{ type: 'event' }, serverErrorEvent()]]]);
        expectNoSecret(JSON.stringify(event));
        expect(scrubEvent(event)).toEqual(event);
        expect(scrubEnvelope(null)).toBeNull();
        expect(scrubEnvelope([header, 'not-items'])).toBeNull();
    });
});

describe('scrubbingTransport — wraps whichever transport the SDK uses', () => {
    function recorder() {
        const sent = [];
        const make = () => ({ send: async (envelope) => { sent.push(envelope); return { statusCode: 200 }; }, flush: async () => true });
        return { sent, make };
    }

    it('hands the inner transport only the scrubbed envelope', async () => {
        const { sent, make } = recorder();
        const transport = scrubbingTransport(make)({});
        await transport.send([{}, [[{ type: 'event' }, { message: `ทดสอบ ${NATIONAL_ID_DASHED}` }]]]);
        expect(sent).toHaveLength(1);
        expect(JSON.stringify(sent)).not.toContain(NATIONAL_ID_DASHED);
        expect(await transport.flush(10)).toBe(true);
    });

    it('sends nothing when every item was dropped', async () => {
        const { sent, make } = recorder();
        const transport = scrubbingTransport(make)({});
        await transport.send([{}, [[{ type: 'attachment' }, 'raw bytes']]]);
        expect(sent).toEqual([]);
    });
});

describe('sentryScrubOptions — what both SDKs are initialised with', () => {
    const options = sentryScrubOptions();

    it('turns default PII off', () => {
        expect(options.sendDefaultPii).toBe(false);
    });

    it('sends traces as transaction events, so beforeSendTransaction sees every span', () => {
        expect(options.traceLifecycle).toBe('static');
    });

    it('lets the SDK collect nothing personal in the first place (v11 dataCollection)', () => {
        expect(options.dataCollection).toEqual({
            userInfo: false,
            cookies: false,
            httpHeaders: {
                request: { allow: expect.arrayContaining(['content-type', 'user-agent']) },
                response: { allow: ['content-type', 'content-length'] },
            },
            httpBodies: [],
            urlQueryParams: false,
            graphQL: { document: false, variables: false },
            genAI: { inputs: false, outputs: false },
            databaseQueryData: false,
            queues: false,
            stackFrameVariables: false,
        });
        const allowed = options.dataCollection.httpHeaders.request.allow;
        for (const header of ['authorization', 'cookie', 'x-csrf-token']) {
            expect(allowed).not.toContain(header);
        }
    });

    it('wires the scrubber into beforeSend, beforeSendTransaction and beforeBreadcrumb', () => {
        expect(JSON.stringify(options.beforeSend(serverErrorEvent()))).not.toContain(NATIONAL_ID_PLAIN);
        expect(options.beforeSendTransaction({ transaction: `GET /x/${EMAIL}` }).transaction).not.toContain(EMAIL);
        expect(options.beforeBreadcrumb({ category: 'console', message: EMAIL })).toBeNull();
    });
});
