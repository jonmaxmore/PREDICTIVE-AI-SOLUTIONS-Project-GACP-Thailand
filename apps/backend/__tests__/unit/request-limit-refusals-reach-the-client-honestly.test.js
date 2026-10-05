/**
 * BACK-16 (audit 2026-09-17) and the wave-1 review follow-up: a request that goes
 * past a size or shape limit is the sender's doing, and must be answered as such.
 *
 * Wave 1 gave every multer door a full `limits` object (SECU-02) and cut the JSON
 * and form parsers to 1 MB (BACK-01). Both make refusals happen far more often, and
 * both refusals went to the global error handler in server.js:
 *   - a MulterError has no statusCode, so the handler answered 500
 *     INTERNAL_SERVER_ERROR and logged a stack trace. Only three routes catch
 *     LIMIT_FILE_SIZE themselves; farm photos, the avatar, CAR
 *     documents, post-audit files and image assessment do not;
 *   - body-parser's "request entity too large" carries status 413 but no code, so
 *     the handler answered 413 REQUEST_FAILED with the English words, and logged a
 *     stack trace for every oversize request.
 *
 * This file drives the REAL handler: the global-error-handler block is cut out of
 * server.js (booting server.js opens database and Redis connections — the same
 * reason body-parser-limits.test.js and server-staging-debug-surfaces.test.js read
 * it as source) and mounted behind the REAL body parsers and REAL multer instances.
 * Every refusal below is produced by the library itself from a real request.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const express = require('express');
const request = require('supertest');
const multer = require('multer');

const { sendErrorResponse, classifyPrismaError, safeErrorMessage } = require('../../shared/api-response');
const { mountBodyParsers } = require('../../middleware/body-parsers');
const { multipartLimits } = require('../../shared/multipart-limits');
const { ERROR_CODES } = require('../../shared/error-codes');

const BACKEND = path.resolve(__dirname, '..', '..');
const THAI = /[฀-๿]/u;
const MB = 1024 * 1024;

function makeLogger() {
    return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

/**
 * The global error handler, exactly as server.js writes it: everything from the
 * "// Global Error Handler" comment up to gracefulShutdown, evaluated with the
 * same top-level bindings server.js gives it.
 */
function realGlobalErrorHandler(logger, { exposesDebugSurfaces = false } = {}) {
    const src = fs.readFileSync(path.join(BACKEND, 'server.js'), 'utf8');
    const start = src.indexOf('\n// Global Error Handler\n');
    const end = src.indexOf('\nasync function gracefulShutdown');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const mounted = [];
    const app = { use: (...args) => { mounted.push(args[args.length - 1]); } };
    const serverRequire = (id) => require(id.startsWith('.') ? path.join(BACKEND, id) : id);
    vm.runInNewContext(src.slice(start, end), {
        app,
        require: serverRequire,
        logger,
        sendErrorResponse,
        classifyPrismaError,
        safeErrorMessage,
        exposesDebugSurfaces,
    }, { filename: 'server.js[global-error-handler]' });

    expect(mounted).toHaveLength(1);
    expect(mounted[0].length).toBe(4);
    return mounted[0];
}

/** An app with the production parser stack, two multer doors, and the real handler. */
function buildApp(logger, options) {
    const app = express();
    mountBodyParsers(app);

    // The shape every production door declares (shared/multipart-limits.js),
    // with small numbers so the requests stay small.
    const door = multer({
        storage: multer.memoryStorage(),
        limits: multipartLimits({ fileSize: 1024, files: 1, fields: 3, fieldSize: 256 }),
    });
    app.post('/api/upload', door.single('file'), (req, res) => res.json({ success: true, fields: { ...req.body } }));

    // Only way to reach LIMIT_PART_COUNT: production doors set parts = files + fields,
    // so their field or file limit fires first.
    const partsDoor = multer({ storage: multer.memoryStorage(), limits: { parts: 2, fields: 10, files: 10 } });
    app.post('/api/parts', partsDoor.any(), (_req, res) => res.json({ success: true }));

    app.post('/api/json', (req, res) => res.json({ success: true }));
    app.post('/api/boom', () => { throw new Error('database exploded at /app/services/x.js:12'); });

    app.use(realGlobalErrorHandler(logger, options));
    return app;
}

function jsonOfSize(size) {
    const overhead = '{"note":""}'.length;
    return JSON.stringify({ note: 'x'.repeat(size - overhead) });
}

/** A multipart body written by hand, for field names supertest will not produce. */
function rawMultipart(fields, boundary = 'gacp-limit-test') {
    const parts = fields.map(([name, value]) => (
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
    ));
    parts.push(`--${boundary}--\r\n`);
    return { body: parts.join(''), contentType: `multipart/form-data; boundary=${boundary}` };
}

const tinyPng = (bytes) => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(bytes, 1)]);

/**
 * Each case: the refusal the library raises, the request that makes it raise it,
 * and the answer the client must get.
 */
const CASES = [
    {
        cause: 'LIMIT_FILE_SIZE', status: 413, code: 'FILE_TOO_LARGE', label: '',
        send: (app) => request(app).post('/api/upload').attach('file', tinyPng(4096), { filename: 'scan.png', contentType: 'image/png' }),
    },
    {
        cause: 'LIMIT_FILE_COUNT', status: 413, code: 'TOO_MANY_FILES', label: '',
        send: (app) => request(app).post('/api/upload')
            .attach('file', tinyPng(10), { filename: 'a.png', contentType: 'image/png' })
            .attach('file', tinyPng(10), { filename: 'b.png', contentType: 'image/png' }),
    },
    {
        cause: 'LIMIT_FIELD_KEY', status: 413, code: 'FORM_LIMIT_EXCEEDED', label: '',
        send: (app) => request(app).post('/api/upload').field('n'.repeat(101), 'x'),
    },
    {
        cause: 'LIMIT_FIELD_VALUE', status: 413, code: 'FORM_LIMIT_EXCEEDED', label: '',
        send: (app) => request(app).post('/api/upload').field('notes', 'ก'.repeat(200)),
    },
    {
        cause: 'LIMIT_FIELD_COUNT', status: 413, code: 'FORM_LIMIT_EXCEEDED', label: '',
        send: (app) => request(app).post('/api/upload').field('a', '1').field('b', '2').field('c', '3').field('d', '4'),
    },
    {
        cause: 'LIMIT_PART_COUNT', status: 413, code: 'FORM_LIMIT_EXCEEDED', label: '',
        send: (app) => request(app).post('/api/parts').field('a', '1').field('b', '2').field('c', '3'),
    },
    {
        cause: 'LIMIT_FIELD_NESTING', status: 400, code: 'MALFORMED_FORM_DATA', label: '',
        send: (app) => {
            const { body, contentType } = rawMultipart([['a[4294967294]', 'x'], ['a[]', 'x']]);
            return request(app).post('/api/upload').set('Content-Type', contentType).send(body);
        },
    },
    {
        cause: 'LIMIT_UNEXPECTED_FILE', status: 400, code: 'UNEXPECTED_FILE_FIELD', label: '',
        send: (app) => request(app).post('/api/upload').attach('photo', tinyPng(10), { filename: 'a.png', contentType: 'image/png' }),
    },
    {
        cause: 'entity.too.large', status: 413, code: 'REQUEST_BODY_TOO_LARGE', label: '',
        send: (app) => request(app).post('/api/json').set('Content-Type', 'application/json').send(jsonOfSize(1.5 * MB)),
    },
    {
        cause: 'entity.too.large', status: 413, code: 'REQUEST_BODY_TOO_LARGE', label: ' (urlencoded)',
        send: (app) => request(app).post('/api/json').type('form').send(`state=${'a'.repeat(1.5 * MB)}`),
    },
    {
        cause: 'parameters.too.many', status: 413, code: 'REQUEST_BODY_TOO_LARGE', label: '',
        send: (app) => request(app).post('/api/json').type('form')
            .send(Array.from({ length: 1001 }, (_, i) => `p${i}=1`).join('&')),
    },
];

describe.each(CASES)('$cause$label → $status $code', ({ cause, status, code, send }) => {
    let res;
    // Copied out: the jest config clears mock calls before every test.
    let warnCalls;
    let errorCalls;

    beforeAll(async () => {
        const logger = makeLogger();
        res = await send(buildApp(logger));
        warnCalls = logger.warn.mock.calls.slice();
        errorCalls = logger.error.mock.calls.slice();
    });

    it(`answers ${status}, not 500`, () => {
        expect(res.status).toBe(status);
        expect(res.body.success).toBe(false);
    });

    it(`answers with the catalogued code ${code}`, () => {
        expect(res.body.code).toBe(code);
        const row = ERROR_CODES[code];
        expect(row).toBeDefined();
        expect(row.httpStatus).toBe(status);
    });

    it('speaks Thai where the web client reads it, in the catalogue\'s words', () => {
        // api-client shows `error` (then `message`); every other client reads messageTh.
        expect(res.body.messageTh).toBe(ERROR_CODES[code].messageTh);
        expect(res.body.error).toMatch(THAI);
        expect(res.body.message).toMatch(THAI);
    });

    it('carries no stack trace', () => {
        expect(JSON.stringify(res.body)).not.toMatch(/\bat .+\(|node_modules|\.js:\d+/);
    });

    it('is logged once at warn level, naming the cause, without a stack', () => {
        expect(errorCalls).toEqual([]);
        expect(warnCalls).toHaveLength(1);
        const logged = JSON.stringify(warnCalls[0]);
        expect(logged).toContain(cause);
        expect(logged).toContain(code);
        expect(logged).not.toMatch(/\n\s+at |node_modules/);
    });
});

describe('the refusal says what the server will accept, when it knows', () => {
    it('an oversize JSON body reports the byte limit it went past', async () => {
        const res = await request(buildApp(makeLogger()))
            .post('/api/json').set('Content-Type', 'application/json').send(jsonOfSize(1.5 * MB));

        expect(res.status).toBe(413);
        expect(res.body.details).toEqual({ limitBytes: MB });
    });

    it('the log line keeps the query string out (tokens travel there)', async () => {
        const logger = makeLogger();
        await request(buildApp(logger))
            .post('/api/json?token=secret-in-query').set('Content-Type', 'application/json').send(jsonOfSize(1.5 * MB));

        const logged = JSON.stringify(logger.warn.mock.calls);
        expect(logged).toContain('/api/json');
        expect(logged).not.toContain('secret-in-query');
    });
});

describe('every refusal multer can raise is mapped', () => {
    /**
     * Read the codes multer actually raises from its own source, so an upgrade that
     * adds one fails here instead of turning into a 500 on production.
     * STREAM_DESTROYED is in multer's message table but nothing raises it.
     */
    function codesMulterRaises() {
        const dir = path.dirname(require.resolve('multer/package.json'));
        const sources = [path.join(dir, 'index.js'), ...fs.readdirSync(path.join(dir, 'lib'))
            .filter((f) => f.endsWith('.js'))
            .map((f) => path.join(dir, 'lib', f))];
        const codes = new Set();
        for (const file of sources) {
            const text = fs.readFileSync(file, 'utf8');
            for (const m of text.matchAll(/(?:abortWithCode|MulterError)\(\s*'([A-Z_]+)'/g)) { codes.add(m[1]); }
        }
        return [...codes].sort();
    }

    const raised = codesMulterRaises();

    it('finds the codes (guards the scan itself)', () => {
        expect(raised).toEqual(expect.arrayContaining([
            'LIMIT_FILE_SIZE', 'LIMIT_FILE_COUNT', 'LIMIT_FIELD_KEY', 'LIMIT_FIELD_VALUE',
            'LIMIT_FIELD_COUNT', 'LIMIT_PART_COUNT', 'LIMIT_FIELD_NESTING', 'LIMIT_UNEXPECTED_FILE',
        ]));
    });

    it.each(raised)('%s is answered as a client error, not a 500', async (multerCode) => {
        const logger = makeLogger();
        const handler = realGlobalErrorHandler(logger);
        const app = express();
        app.post('/api/x', (_req, _res, next) => next(new multer.MulterError(multerCode, 'file')));
        app.use(handler);

        const res = await request(app).post('/api/x');

        expect([400, 413]).toContain(res.status);
        expect(ERROR_CODES[res.body.code]?.httpStatus).toBe(res.status);
        expect(res.body.messageTh).toMatch(THAI);
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });
});

describe('negative controls — everything else is handled as before', () => {
    it('an unexpected server error is still a 500, logged at error level with its stack', async () => {
        const logger = makeLogger();
        const res = await request(buildApp(logger)).post('/api/boom').send({});

        expect(res.status).toBe(500);
        expect(res.body.code).toBe('INTERNAL_SERVER_ERROR');
        expect(res.body.error).toBe('Internal server error');
        expect(res.body.error).not.toContain('database exploded');
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(String(logger.error.mock.calls[0][0])).toContain('database exploded');
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('an error that states its own status keeps it', async () => {
        const logger = makeLogger();
        const app = express();
        app.get('/api/x', (_req, _res, next) => next(Object.assign(new Error('Nothing here'), { statusCode: 404, code: 'NOT_FOUND' })));
        app.use(realGlobalErrorHandler(logger));

        const res = await request(app).get('/api/x');

        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NOT_FOUND');
    });

    it('a code that merely looks like a multer code is not taken for one', async () => {
        const logger = makeLogger();
        const app = express();
        app.get('/api/x', (_req, _res, next) => next(Object.assign(new Error('quota'), { code: 'LIMIT_QUOTA' })));
        app.use(realGlobalErrorHandler(logger));

        const res = await request(app).get('/api/x');

        expect(res.status).toBe(500);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('uploads and bodies inside the limits still go through', async () => {
        const app = buildApp(makeLogger());

        const upload = await request(app).post('/api/upload')
            .field('slotId', 'LICENCE_PT11')
            .attach('file', tinyPng(100), { filename: 'scan.png', contentType: 'image/png' });
        expect(upload.status).toBe(200);
        expect(upload.body.fields).toEqual({ slotId: 'LICENCE_PT11' });

        const json = await request(app).post('/api/json').send({ ok: true });
        expect(json.status).toBe(200);
    });

    it('a developer machine still gets no stack on a limit refusal (it is not a server fault)', async () => {
        const logger = makeLogger();
        const res = await request(buildApp(logger, { exposesDebugSurfaces: true }))
            .post('/api/upload').attach('file', tinyPng(4096), { filename: 'scan.png', contentType: 'image/png' });

        expect(res.status).toBe(413);
        expect(res.body.details?.stack).toBeUndefined();
    });
});

describe('route-level multer handlers answer the same way', () => {
    /**
     * Three handlers catch LIMIT_FILE_SIZE themselves so their refusal can quote the
     * door's own ceiling. Each is pinned to 413 FILE_TOO_LARGE by its own wire test:
     *   middleware/draft-document-upload.js (the draft-documents door and, since C4
     *     2026-09-30, the planting attachment door) → draft-document-upload-content-guard.test.js
     *   onsite.js        → audit-onsite-photo-content-guard.test.js
     *   harvest-batches  → coa-upload-door-wire.test.js
     * A fourth door that grows its own handler must be added there too.
     */
    it('the doors that catch multer refusals themselves are the three known ones', () => {
        const found = [];
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (['node_modules', '__tests__'].includes(entry.name)) { continue; }
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) { walk(full); continue; }
                if (entry.name.endsWith('.js') && /'LIMIT_[A-Z_]+'/.test(fs.readFileSync(full, 'utf8'))) {
                    found.push(path.relative(BACKEND, full).split(path.sep).join('/'));
                }
            }
        };
        for (const top of ['routes', 'controllers', 'modules', 'middleware']) {
            const dir = path.join(BACKEND, top);
            if (fs.existsSync(dir)) { walk(dir); }
        }
        expect(found.sort()).toEqual([
            'middleware/draft-document-upload.js',
            'routes/api/audit/onsite.js',
            'routes/api/cultivation/harvest-batches.js',
        ]);
    });
});
