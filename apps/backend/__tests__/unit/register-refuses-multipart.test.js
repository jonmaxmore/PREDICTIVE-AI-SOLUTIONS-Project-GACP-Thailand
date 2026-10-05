'use strict';

/**
 * SECU-02 (audit 2026-09-17): the public registration door does not take
 * multipart at all.
 *
 * POST /auth/health/register ran `upload.single('idCardImage')` before any
 * authentication or validation, so anyone who could reach it could make multer
 * parse whatever multipart body they liked — and multer 2.2.0 can be crashed by
 * one crafted request (GHSA-wc9g-mqfw-jrwm). Nothing needed that door open:
 *   - the web register page posts JSON (apps/web-app/src/app/(auth)/register/page.tsx
 *     → AuthService.register → apiClient.post);
 *   - the uploaded ID-card image was never linked to the account — the service
 *     drops the key (prisma-auth-service.js _sanitizeInput) and nothing points
 *     at the file (middleware/uploads-access.js resolveRootFileOwner), so every
 *     upload was an orphaned copy of a national ID card on disk (SECU-05);
 *   - a multipart registration could not succeed anyway: the consent flags are
 *     z.boolean() and multipart only carries strings.
 *
 * Driven through the real router with `router.handle()` (no listening socket —
 * see password-reset-routes-behaviour.test.js for why), with the real upload
 * middleware stack underneath: storage-service is stubbed out, so
 * upload-middleware falls back to a real in-memory multer and would genuinely
 * read the body if the route still invoked it.
 */

const { Readable } = require('stream');

const mockRegister = jest.fn();

jest.mock('../../services/prisma-database', () => ({ prisma: { user: {}, $queryRawUnsafe: jest.fn() } }));
jest.mock('../../shared/logger', () => {
    const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...l, createLogger: () => l };
});
jest.mock('../../services/prisma-auth-service', () => ({}));
// No createUploader → upload-middleware builds a real memory-storage multer.
jest.mock('../../services/storage-service', () => ({}));
jest.mock('../../controllers/auth-controller', () => ({
    register: (...args) => mockRegister(...args),
}));
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, res, next) => next(),
    authenticateAny: (req, res, next) => next(),
    authenticateProvider: (req, res, next) => next(),
    isTokenBeforeSessionEpoch: () => false,
}));
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn(), logAuth: jest.fn() },
    AuditCategory: { SECURITY: 'SECURITY' },
}));
jest.mock('../../services/pdpa-service', () => ({}));
jest.mock('../../services/notification-preferences-service', () => ({}));

const authHealthRouter = require('../../routes/api/auth/auth-health');

const REGISTRATION = {
    identifier: '1526113009461',
    healthId: '1526113009461',
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    phoneNumber: '0812345678',
    password: 'NotARealPassword-1',
    accountType: 'INDIVIDUAL',
    acceptedTermsOfService: true,
    acceptedPrivacyPolicy: true,
};

function multipartBody(boundary) {
    const parts = Object.entries(REGISTRATION).map(([name, value]) => (
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
    ));
    parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="idCardImage"; filename="card.png"\r\n`
        + 'Content-Type: image/png\r\n\r\n'
        + '\u0089PNG\r\n\u001a\n-not-really-a-card-\r\n',
    );
    parts.push(`--${boundary}--\r\n`);
    return Buffer.from(parts.join(''), 'latin1');
}

/**
 * Walk one request through the real router. The request is a real readable
 * stream, so anything that tries to parse the body actually consumes it.
 */
function callRegister({ contentType, bytes = Buffer.alloc(0), body }) {
    const req = Readable.from([bytes], { objectMode: false });
    Object.assign(req, {
        method: 'POST',
        url: '/register',
        originalUrl: '/api/auth/health/register',
        baseUrl: '',
        path: '/register',
        headers: { 'content-type': contentType, 'content-length': String(bytes.length) },
        params: {},
        query: {},
        cookies: {},
        get: (name) => req.headers[String(name).toLowerCase()],
        header: (name) => req.headers[String(name).toLowerCase()],
    });
    if (body !== undefined) { req.body = body; }

    return new Promise((resolve, reject) => {
        const res = {
            statusCode: 200,
            headersSent: false,
            locals: {},
            status(code) { this.statusCode = code; return this; },
            set() { return this; },
            setHeader() { return this; },
            getHeader() { return undefined; },
            json(payload) { resolve({ status: this.statusCode, body: payload, req }); return this; },
            send(payload) { resolve({ status: this.statusCode, body: payload, req }); return this; },
            end() { resolve({ status: this.statusCode, body: undefined, req }); return this; },
        };
        authHealthRouter.handle(req, res, (err) => {
            if (err) { reject(err); return; }
            resolve({ status: null, body: undefined, req, unmatched: true });
        });
    });
}

beforeEach(() => {
    mockRegister.mockReset();
    mockRegister.mockImplementation((req, res) => res.status(201).json({ success: true }));
});

describe('SECU-02 — POST /register refuses multipart before anything reads it', () => {
    it.each([
        'multipart/form-data; boundary=gacp-boundary',
        'Multipart/Form-Data; boundary=gacp-boundary',
        'multipart/mixed; boundary=gacp-boundary',
    ])('%s → 415 UNSUPPORTED_MEDIA_TYPE, body untouched, controller not reached', async (contentType) => {
        const res = await callRegister({ contentType, bytes: multipartBody('gacp-boundary') });

        expect(res.status).toBe(415);
        expect(res.body).toMatchObject({ success: false, code: 'UNSUPPORTED_MEDIA_TYPE' });
        expect(typeof res.body.messageTh).toBe('string');
        expect(mockRegister).not.toHaveBeenCalled();
        // Nothing piped, resumed or read the request stream: multer never ran.
        expect(res.req.readableFlowing).toBeNull();
        expect(res.req.readableEnded).toBe(false);
        expect(res.req.file).toBeUndefined();
    });

    it('the route table no longer runs an upload handler on /register', () => {
        const layer = authHealthRouter.stack.find((l) => l.route && l.route.path === '/register' && l.route.methods.post);
        const handlerNames = layer.route.stack.map((l) => l.name);
        expect(handlerNames).not.toContain('multerMiddleware');
        expect(handlerNames).not.toContain('rejectBadUpload');
    });
});

describe('SECU-02 — the JSON registration the web page sends still works', () => {
    it('application/json with a valid body reaches the controller', async () => {
        const res = await callRegister({ contentType: 'application/json', body: { ...REGISTRATION } });

        expect(res.status).toBe(201);
        expect(mockRegister).toHaveBeenCalledTimes(1);
        const [req] = mockRegister.mock.calls[0];
        expect(req.body.firstName).toBe('สมชาย');
        expect(req.file).toBeUndefined();
    });

    it('application/json with a missing consent is still a 400 from the schema', async () => {
        const res = await callRegister({
            contentType: 'application/json',
            body: { ...REGISTRATION, acceptedPrivacyPolicy: false },
        });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(mockRegister).not.toHaveBeenCalled();
    });
});
