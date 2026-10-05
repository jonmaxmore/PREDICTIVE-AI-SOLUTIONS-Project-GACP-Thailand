/**
 * P0-1 — staging must not wear a developer's debug surfaces.
 *
 * `NODE_ENV` has three deployed values in this repo, not two:
 * `development`, `staging` (docker-compose.staging.yml:64 backend,
 * :173 frontend) and `production`. Every gate in server.js written as
 * "is it production?" therefore answers "no" on a public staging host,
 * and the debug surfaces meant for a laptop went live there:
 * stack traces in error bodies, CSP and COEP switched off, Swagger open.
 *
 * WHY THIS TEST READS server.js AS SOURCE
 *
 * The sibling W4-D test (`__tests__/integration/swagger-ui-endpoint.test.js`
 * lines 42-62) mirrors the `enableApiDocs` gate into a local express app
 * because requiring server.js boots Prisma, Redis and the scheduler. A
 * mirror pins the mirror: it stays green while server.js drifts, which is
 * how staging came to serve stack traces with a green suite. So this file
 * takes the approach of `__tests__/unit/server-boot-receipt-assert.test.js`
 * instead — slice the real bytes out of server.js and evaluate them in a
 * `vm` sandbox with an injected `process.env`. If a gate in server.js
 * changes, these assertions change with it.
 *
 * NOT UNDER TEST HERE, DELIBERATELY: the CORS gate at server.js:153 keeps
 * using `isProduction`. `staging.gacpth.com` appears in neither
 * `productionDefaultOrigins` nor `developmentDefaultOrigins` — staging's
 * own origin arrives through `envDrivenOrigins` — so folding staging into
 * the production branch would only delete `localhost:3001` and
 * `localhost:8080`, the ports developers call staging from. The last
 * describe block pins that those two survive.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { sendErrorResponse } = require('../../shared/api-response');

const SERVER_JS_PATH = path.resolve(__dirname, '..', '..', 'server.js');

/** Any Thai character. */
const THAI = /[฀-๿]/u;

function readServerSource() {
    return fs.readFileSync(SERVER_JS_PATH, 'utf8');
}

/**
 * Return the `{ ... }` (or `[ ... ]`) literal that starts at `openIdx`,
 * counting brace depth and stepping over quoted strings so a brace inside
 * a literal cannot unbalance the scan.
 */
function sliceBalanced(src, openIdx) {
    const open = src[openIdx];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let quote = null;
    for (let i = openIdx; i < src.length; i += 1) {
        const ch = src[i];
        if (quote) {
            if (ch === '\\') { i += 1; continue; }
            if (ch === quote) { quote = null; }
            continue;
        }
        if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
        if (ch === open) { depth += 1; continue; }
        if (ch === close) {
            depth -= 1;
            if (depth === 0) { return src.slice(openIdx, i + 1); }
        }
    }
    throw new Error(`server-staging-debug-surfaces.test.js: unbalanced ${open} starting at index ${openIdx}.`);
}

function requireIndexOf(src, needle, hint) {
    const idx = src.indexOf(needle);
    if (idx < 0) {
        throw new Error(
            `server-staging-debug-surfaces.test.js: anchor ${JSON.stringify(needle)} not found in server.js. ${hint}`,
        );
    }
    return idx;
}

/**
 * Every top-level single-line `const X = <expression mentioning NODE_ENV>;`
 * declaration. The environment flags live here — `isProduction` today, plus
 * whatever flag the debug-surface gates are moved onto. Collecting them by
 * shape rather than by name means this test does not have to know the new
 * flag's name, and a flag declared some other way (multi-line, a function,
 * an import) fails loudly below with a ReferenceError rather than silently
 * dropping out of the sandbox.
 */
function extractEnvFlagDeclarations(src) {
    const matches = src.match(/^const\s+\w+\s*=\s*[^;\n]*process\.env\.NODE_ENV[^;\n]*;$/gmu);
    if (!matches || matches.length === 0) {
        throw new Error(
            'server-staging-debug-surfaces.test.js: no top-level NODE_ENV flag declaration found in server.js.',
        );
    }
    return matches.join('\n');
}

/** The options object handed to helmet() at server.js:126-129. */
function extractHelmetOptions(src) {
    const callIdx = requireIndexOf(src, 'app.use(helmet(', 'Has the helmet mount moved or been renamed?');
    const braceIdx = requireIndexOf(src.slice(callIdx), '{', 'helmet() called without an options object?') + callIdx;
    return sliceBalanced(src, braceIdx);
}

/** The `const enableApiDocs = ...;` gate at server.js:351. */
function extractEnableApiDocsDeclaration(src) {
    const match = src.match(/^const enableApiDocs = [^;\n]*;$/mu);
    if (!match) {
        throw new Error(
            'server-staging-debug-surfaces.test.js: `const enableApiDocs = ...;` not found in server.js.',
        );
    }
    return match[0];
}

/** The payload object the global error handler passes to sendErrorResponse. */
function extractErrorResponsePayload(src) {
    const handlerIdx = requireIndexOf(src, '// Global Error Handler', 'Has the global error handler been renamed?');
    const callIdx = requireIndexOf(
        src.slice(handlerIdx),
        'sendErrorResponse(res, req, {',
        'Does the global error handler still call sendErrorResponse?',
    ) + handlerIdx;
    const braceIdx = src.indexOf('{', callIdx);
    return sliceBalanced(src, braceIdx);
}

/** Origin helpers plus the whole CORS allowlist construction (server.js:80-156). */
function extractCorsAllowlistBlock(src) {
    const helpersStart = requireIndexOf(src, 'const normalizeOriginValue', 'Origin helpers renamed?');
    const helpersEnd = requireIndexOf(src, 'app.set(\'trust proxy\'', 'trust-proxy line moved?');
    const listStart = requireIndexOf(src, 'const productionDefaultOrigins', 'Default-origin lists renamed?');
    const setStart = requireIndexOf(src, 'const allowedOrigins = new Set(', 'allowedOrigins construction moved?');
    const setEnd = requireIndexOf(src.slice(setStart), '\n);', 'allowedOrigins Set not closed as expected?') + setStart;
    return `${src.slice(helpersStart, helpersEnd)}\n${src.slice(listStart, setEnd + 3)}`;
}

/**
 * Evaluate the extracted gates for one NODE_ENV. Returns plain data only,
 * so nothing from the sandbox realm leaks into the assertions.
 *
 * @param {object} opts
 * @param {string} opts.nodeEnv                 value for process.env.NODE_ENV
 * @param {object} [opts.env]                   extra process.env entries
 * @param {number} [opts.statusCode]            status the error handler resolved
 * @param {string} [opts.code]                  error code the handler resolved
 */
function evaluateGates({ nodeEnv, env = {}, statusCode = 500, code = 'INTERNAL_SERVER_ERROR' }) {
    const src = readServerSource();
    const script = [
        extractEnvFlagDeclarations(src),
        extractCorsAllowlistBlock(src),
        extractEnableApiDocsDeclaration(src),
        `const helmetOptions = ${extractHelmetOptions(src)};`,
        // Stand-ins for the locals the error-handler payload closes over.
        'const err = new Error(\'boom\');',
        'err.stack = \'STACK-SENTINEL\';',
        `const statusCode = ${statusCode};`,
        `const code = ${JSON.stringify(code)};`,
        'const message = \'Internal server error\';',
        `const errorPayload = ${extractErrorResponsePayload(src)};`,
        'result.helmetOptions = { ...helmetOptions };',
        'result.enableApiDocs = enableApiDocs;',
        'result.errorPayload = { ...errorPayload, details: errorPayload.details ? { ...errorPayload.details } : errorPayload.details };',
        'result.allowedOrigins = Array.from(allowedOrigins);',
    ].join('\n');

    const result = {};
    vm.runInNewContext(script, {
        process: { env: { NODE_ENV: nodeEnv, ...env } },
        result,
        console,
    }, { filename: 'server.js[debug-surface-gates-extracted]', timeout: 5000 });
    return result;
}

describe('[P0-1] server.js gates — extraction canaries', () => {
    test('every gate this suite depends on is still findable in server.js', () => {
        const src = readServerSource();
        expect(extractEnvFlagDeclarations(src)).toMatch(/process\.env\.NODE_ENV/u);
        expect(extractHelmetOptions(src)).toMatch(/contentSecurityPolicy/u);
        expect(extractHelmetOptions(src)).toMatch(/crossOriginEmbedderPolicy/u);
        expect(extractEnableApiDocsDeclaration(src)).toMatch(/OPENAPI_DOCS_ENABLED/u);
        expect(extractErrorResponsePayload(src)).toMatch(/details:/u);
        expect(extractCorsAllowlistBlock(src)).toMatch(/allowedOrigins = new Set\(/u);
    });
});

describe('[P0-1] NODE_ENV=staging is a public host, not a laptop', () => {
    test('the global error handler does not put a stack trace in the response', () => {
        const { errorPayload } = evaluateGates({ nodeEnv: 'staging' });
        expect(errorPayload.details).toBeNull();
    });

    test('Swagger stays shut unless OPENAPI_DOCS_ENABLED opts in', () => {
        expect(evaluateGates({ nodeEnv: 'staging' }).enableApiDocs).toBe(false);
        expect(
            evaluateGates({ nodeEnv: 'staging', env: { OPENAPI_DOCS_ENABLED: 'true' } }).enableApiDocs,
        ).toBe(true);
    });

    test('CSP and COEP are not switched off', () => {
        const { helmetOptions } = evaluateGates({ nodeEnv: 'staging' });
        expect(helmetOptions.contentSecurityPolicy).not.toBe(false);
        expect(helmetOptions.crossOriginEmbedderPolicy).not.toBe(false);
    });

    test('production keeps the same posture as staging', () => {
        const staging = evaluateGates({ nodeEnv: 'staging' });
        const production = evaluateGates({ nodeEnv: 'production' });
        expect(staging.helmetOptions).toEqual(production.helmetOptions);
        expect(staging.enableApiDocs).toBe(production.enableApiDocs);
        expect(staging.errorPayload.details).toEqual(production.errorPayload.details);
    });
});

describe('[P0-1] negative control — a developer machine keeps its tools', () => {
    test.each(['development', 'test'])('NODE_ENV=%s still attaches the stack trace', (nodeEnv) => {
        const { errorPayload } = evaluateGates({ nodeEnv });
        expect(errorPayload.details).toEqual({ stack: 'STACK-SENTINEL' });
    });

    test.each(['development', 'test'])('NODE_ENV=%s still serves Swagger by default', (nodeEnv) => {
        expect(evaluateGates({ nodeEnv }).enableApiDocs).toBe(true);
    });

    test.each(['development', 'test'])('NODE_ENV=%s still relaxes CSP and COEP for local tooling', (nodeEnv) => {
        const { helmetOptions } = evaluateGates({ nodeEnv });
        expect(helmetOptions.contentSecurityPolicy).toBe(false);
        expect(helmetOptions.crossOriginEmbedderPolicy).toBe(false);
    });
});

describe('[P0-1] negative control — the CORS allowlist is untouched', () => {
    test('staging still admits the localhost ports developers call it from', () => {
        const { allowedOrigins } = evaluateGates({ nodeEnv: 'staging' });
        expect(allowedOrigins).toContain('http://localhost:3001');
        expect(allowedOrigins).toContain('http://localhost:8080');
    });

    test('staging and development resolve the identical allowlist', () => {
        expect(evaluateGates({ nodeEnv: 'staging' }).allowedOrigins)
            .toEqual(evaluateGates({ nodeEnv: 'development' }).allowedOrigins);
    });

    test('production still drops the developer ports', () => {
        const { allowedOrigins } = evaluateGates({ nodeEnv: 'production' });
        expect(allowedOrigins).not.toContain('http://localhost:3001');
        expect(allowedOrigins).not.toContain('http://localhost:8080');
    });

    test('a staging origin supplied through CORS_ORIGIN is still honoured', () => {
        const { allowedOrigins } = evaluateGates({
            nodeEnv: 'staging',
            env: { CORS_ORIGIN: 'https://staging.gacpth.com' },
        });
        expect(allowedOrigins).toContain('https://staging.gacpth.com');
    });
});

describe('[P0-1] messageTh carries Thai', () => {
    /** Minimal express-response double: capture status + JSON body. */
    function captureResponse(payload) {
        let captured = null;
        const res = {
            status(code) { this.statusCode = code; return this; },
            json(body) { captured = body; return this; },
        };
        sendErrorResponse(res, { id: 'req-test', method: 'GET', originalUrl: '/x' }, payload);
        return captured;
    }

    test('a 500 from the global error handler answers in Thai, not English', () => {
        const { errorPayload } = evaluateGates({ nodeEnv: 'staging', statusCode: 500 });
        const body = captureResponse(errorPayload);
        expect(body.messageTh).toMatch(THAI);
    });

    test('a 4xx from the global error handler answers in Thai too', () => {
        const { errorPayload } = evaluateGates({
            nodeEnv: 'staging',
            statusCode: 404,
            code: 'NOT_FOUND',
        });
        const body = captureResponse(errorPayload);
        expect(body.messageTh).toMatch(THAI);
    });
});
