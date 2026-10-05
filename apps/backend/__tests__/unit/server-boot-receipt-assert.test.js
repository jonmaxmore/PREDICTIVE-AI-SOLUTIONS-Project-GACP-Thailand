/**
 * server.js boot-hook test — R7-C (2026-05-17).
 *
 * Verifies the [R6-B] canonical-allocator boot hook that R6-B installed
 * inside `app.listen()` callback at apps/backend/server.js:414-438.
 *
 * Why this matters
 *   R5-B removed the in-memory fallback in receipt-numbering-service.
 *   If the `ReceiptSequence` Prisma migration is NOT applied, every
 *   receipt allocation throws at runtime. The R6-B boot hook is the
 *   defence-in-depth: at server startup it calls
 *   `assertCanonicalAllocator()` and, in production, calls
 *   `process.exit(1)` so the orchestrator surfaces the problem
 *   immediately rather than at the first receipt request hours later.
 *   In non-prod the hook only emits a `logger.warn` so local dev /
 *   CI without the migration can still boot.
 *
 * Test strategy — extract + sandbox
 *   The hook lives inside `if (require.main === module) { app.listen(
 *   port, host, () => { ... setImmediate(async () => { ... }) ... }) }`.
 *   Requiring server.js from a Jest worker does NOT trigger the
 *   listener (require.main is jest, not server.js), so we can't drive
 *   the hook by `require('../../server')`. Instead, we read server.js
 *   source via `fs`, slice out the exact try/catch block delimited by
 *   the `// [R6-B]` marker, wrap it in an async IIFE, and execute via
 *   `vm.runInNewContext` with an injected sandbox of mocked
 *   `require` / `logger` / `process`. This exercises the *actual
 *   production source bytes* — if R6-B's hook ever drifts (e.g.
 *   someone deletes the `process.exit(1)` call), these tests fail
 *   loud.
 *
 * Instincts applied
 *   - I-002 — unused-vars prefixed with `_` (none needed here).
 *   - I-008 — every mock exposes the helper functions the SUT calls
 *     (require returns an object with `assertCanonicalAllocator`;
 *     logger exposes `info`/`warn`/`error`; process exposes
 *     `env`/`exit`).
 *
 * File-boundary discipline (I-004)
 *   This test file is the SOLE writable target for R7-C. server.js
 *   itself is read-only; the receipt-numbering-service is read-only;
 *   no other R7 territories are touched.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SERVER_JS_PATH = path.resolve(__dirname, '..', '..', 'server.js');

/**
 * Slice the [R6-B] boot-hook try/catch out of server.js source. The
 * marker comment is stable since R6-B landed it; if a future edit
 * removes the marker this helper throws and the suite fails — which
 * is the correct outcome (drift detection).
 *
 * Returns the source string starting at `try {` and ending at the
 * matching `}` of the outer `catch (assertErr) { ... }` block, with
 * the indentation preserved (vm.runInNewContext doesn't care).
 */
function extractBootHookSource() {
    const src = fs.readFileSync(SERVER_JS_PATH, 'utf8');
    const markerIdx = src.indexOf('// [R6-B] Boot-time canonical-allocator verification.');
    if (markerIdx < 0) {
        throw new Error(
            'server-boot-receipt-assert.test.js: marker comment "// [R6-B] Boot-time canonical-allocator verification."'
            + ' not found in server.js — has the boot hook been removed or moved? Update R7-C test extraction logic.',
        );
    }
    // Skip past the marker comment lines to the first `try {` after it.
    const tryIdx = src.indexOf('try {', markerIdx);
    if (tryIdx < 0) {
        throw new Error('server-boot-receipt-assert.test.js: no `try {` found after [R6-B] marker.');
    }
    // Now find the matching closing `}` of the outer try/catch by
    // counting braces. The block contains a nested if/if/else with
    // template literals; brace counting is robust because the
    // template literals close out with backticks before any `{` or
    // `}` inside them would be treated as code (template
    // substitutions use `${...}` which we DO count, but the open
    // `${` always pairs with `}` inside the same template, so the
    // running balance still returns to zero at the outer block's
    // close).
    let depth = 0;
    let inTemplate = false;
    let inLineComment = false;
    let inBlockComment = false;
    let inString = null; // single or double quote char, or null
    let end = -1;
    for (let i = tryIdx; i < src.length; i += 1) {
        const ch = src[i];
        const next = src[i + 1];
        const prev = i > 0 ? src[i - 1] : '';

        // Line comments end at \n.
        if (inLineComment) {
            if (ch === '\n') { inLineComment = false; }
            continue;
        }
        // Block comments end at */.
        if (inBlockComment) {
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                i += 1;
            }
            continue;
        }
        // Strings end at matching quote (respecting escape).
        if (inString) {
            if (ch === '\\') { i += 1; continue; }
            if (ch === inString) { inString = null; }
            continue;
        }
        // Template literals end at backtick. Inside `${...}` braces
        // still need to count, so we DON'T set inTemplate=true for
        // substitution interior — we let depth count both the
        // template's literal braces and the surrounding code's.
        if (inTemplate) {
            if (ch === '\\') { i += 1; continue; }
            if (ch === '`') { inTemplate = false; continue; }
            // Track `${` openings as depth pushes so the matching
            // `}` doesn't accidentally decrement our outer depth.
            if (ch === '$' && next === '{') {
                depth += 1;
                i += 1;
            } else if (ch === '}' && depth > 0) {
                depth -= 1;
            }
            continue;
        }

        // Not in any literal: detect entry into one.
        if (ch === '/' && next === '/') { inLineComment = true; i += 1; continue; }
        if (ch === '/' && next === '*') { inBlockComment = true; i += 1; continue; }
        if (ch === '\'' || ch === '"') { inString = ch; continue; }
        if (ch === '`') { inTemplate = true; continue; }

        if (ch === '{') {
            depth += 1;
        } else if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
                // We just closed the `try { ... }`. Look ahead for a
                // matching `catch (...) { ... }` so we include it in
                // the extracted block.
                let j = i + 1;
                while (j < src.length && /\s/u.test(src[j])) { j += 1; }
                if (src.slice(j, j + 5) === 'catch') {
                    // Resume scanning starting after the `catch` open brace.
                    const catchBraceIdx = src.indexOf('{', j);
                    if (catchBraceIdx < 0) {
                        throw new Error('catch keyword found but no open brace followed.');
                    }
                    depth = 1;
                    i = catchBraceIdx;
                    continue;
                }
                end = i + 1;
                break;
            }
        }
        // Suppress unused-var warning for `prev` (kept for readability of escape handling).
        void prev;
    }
    if (end < 0) {
        throw new Error('server-boot-receipt-assert.test.js: failed to slice the [R6-B] try/catch block.');
    }
    return src.slice(tryIdx, end);
}

/**
 * Build a fresh sandbox + run the boot hook against it. Returns the
 * sandbox so the test can assert on the mock call records.
 *
 * @param {object} opts
 * @param {string} opts.nodeEnv  - value for process.env.NODE_ENV
 * @param {Function} opts.assertImpl - the function the mocked
 *   receipt-numbering-service.assertCanonicalAllocator should run.
 *   May return `{ ok: true }` / `{ ok: false, reason }` directly or
 *   throw. It is wrapped in a jest.fn so call-count assertions work.
 */
async function runBootHook({ nodeEnv, assertImpl }) {
    const assertCanonicalAllocator = jest.fn(assertImpl);
    const logger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    };
    const exitMock = jest.fn();
    const sandbox = {
        // The hook calls `require('./services/receipt-numbering-service')`.
        // The path is the only one used; we return the service stub.
        require: jest.fn((modulePath) => {
            if (modulePath === './services/receipt-numbering-service') {
                return { assertCanonicalAllocator };
            }
            throw new Error(
                `server-boot-receipt-assert.test.js: unexpected require('${modulePath}') from boot hook.`
                + ' If R6-B hook now requires another module, update this mock.',
            );
        }),
        logger,
        process: {
            env: { NODE_ENV: nodeEnv },
            exit: exitMock,
        },
        // Globals the extracted code might lean on. The hook uses none
        // of these directly, but vm sandboxes need them for any
        // runtime support code (template-string error formatting, etc.).
        console,
        Promise,
        Error,
        String,
    };

    const bootSource = extractBootHookSource();
    // Wrap into an async IIFE so the inner `await` is legal at the
    // top level of the script.
    const wrapped = `(async () => { ${bootSource} })();`;
    const result = vm.runInNewContext(wrapped, sandbox, {
        filename: 'server.js[boot-hook-extracted]',
        timeout: 5000,
    });
    await result;

    return { assertCanonicalAllocator, logger, exit: exitMock };
}

describe('[R7-C] server.js boot hook — assertCanonicalAllocator post prisma.$connect()', () => {
    test('extractBootHookSource returns a non-empty try/catch block', () => {
        // Drift-detection canary: if R6-B's hook is ever removed or
        // the marker comment is renamed, every other test in this
        // suite would throw the same opaque error. This isolated
        // sanity check makes the failure mode obvious.
        const block = extractBootHookSource();
        expect(block).toMatch(/^try\s*\{/u);
        expect(block).toMatch(/catch\s*\(assertErr\)\s*\{/u);
        expect(block).toMatch(/receiptNumberingService\.assertCanonicalAllocator\(\)/u);
        expect(block).toMatch(/process\.exit\(1\)/u);
    });

    test('production + allocator ok → boots fine; process.exit NOT called', async () => {
        const { assertCanonicalAllocator, logger, exit } = await runBootHook({
            nodeEnv: 'production',
            assertImpl: async () => ({ ok: true }),
        });

        expect(assertCanonicalAllocator).toHaveBeenCalledTimes(1);
        expect(exit).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
        // Happy-path log must mention the verification.
        expect(logger.info).toHaveBeenCalledWith('[boot] receipt-sequence allocator verified');
    });

    test('production + allocator fail → process.exit(1) + error logged with reason', async () => {
        const reason = 'prisma.receiptSequence delegate unavailable';
        const { assertCanonicalAllocator, logger, exit } = await runBootHook({
            nodeEnv: 'production',
            assertImpl: async () => ({ ok: false, reason }),
        });

        expect(assertCanonicalAllocator).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(1);
        // The CRITICAL log line must include the reason AND the remediation hint.
        expect(logger.error).toHaveBeenCalledTimes(1);
        const errorMsg = logger.error.mock.calls[0][0];
        expect(errorMsg).toMatch(/\[boot\] CRITICAL/u);
        expect(errorMsg).toMatch(/receipt-sequence migration missing/u);
        expect(errorMsg).toMatch(new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
        expect(errorMsg).toMatch(/prisma migrate deploy/u);
        // NOTE: in the real Node runtime, `process.exit(1)` terminates
        // the process synchronously and the `logger.warn(...non-prod...)`
        // fall-through never runs. In this sandbox `process.exit` is a
        // jest.fn that returns normally, so control flows past the
        // intended termination and the non-prod warn line ALSO fires.
        // We therefore deliberately do NOT assert that warn is silent
        // in prod-fail — the contract that matters is `exit(1)` was
        // called with the CRITICAL error logged, which is asserted
        // above. (If R6-B ever inverts the structure into an
        // if/else, this comment + the warn-call count would need to
        // be revisited.)
    });

    test('development + allocator fail → process.exit NOT called; logger.warn emitted instead', async () => {
        const reason = 'connect ECONNREFUSED 127.0.0.1:5432';
        const { assertCanonicalAllocator, logger, exit } = await runBootHook({
            nodeEnv: 'development',
            assertImpl: async () => ({ ok: false, reason }),
        });

        expect(assertCanonicalAllocator).toHaveBeenCalledTimes(1);
        // CRITICAL: dev must NEVER exit on this hook — local devs without
        // the migration applied still need their server to boot.
        expect(exit).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
        // The non-prod path emits a single `logger.warn`.
        expect(logger.warn).toHaveBeenCalledTimes(1);
        const warnMsg = logger.warn.mock.calls[0][0];
        expect(warnMsg).toMatch(/\[boot\] receipt-sequence allocator unavailable \(non-prod\)/u);
        expect(warnMsg).toMatch(new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    });

    test('development + allocator ok → boots fine (parity with prod-ok)', async () => {
        const { assertCanonicalAllocator, logger, exit } = await runBootHook({
            nodeEnv: 'development',
            assertImpl: async () => ({ ok: true }),
        });

        expect(assertCanonicalAllocator).toHaveBeenCalledTimes(1);
        expect(exit).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.info).toHaveBeenCalledWith('[boot] receipt-sequence allocator verified');
    });

    test('allocator throws synchronously → outer catch swallows it as logger.warn (no process.exit)', async () => {
        // Defence-in-depth: if assertCanonicalAllocator itself throws
        // (e.g. the require() blew up because the service module had
        // a syntax error), the outer try/catch must NOT crash the
        // server boot. Production behaviour here is intentional —
        // a thrown error from the *hook* should never bring down a
        // server that successfully connected to Postgres; only the
        // structured `{ ok: false }` return triggers the prod exit.
        const { assertCanonicalAllocator, logger, exit } = await runBootHook({
            nodeEnv: 'production',
            assertImpl: async () => { throw new Error('boom — module load failure'); },
        });

        expect(assertCanonicalAllocator).toHaveBeenCalledTimes(1);
        expect(exit).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn.mock.calls[0][0]).toMatch(/\[boot\] assertCanonicalAllocator threw: boom/u);
    });
});
