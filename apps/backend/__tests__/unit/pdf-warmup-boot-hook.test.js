/**
 * server.js boot-hook test — F-PDF-COLD-START-TIMEOUT (2026-08-20).
 *
 * Verifies the boot hook that kicks off pdf-generator.service's Puppeteer
 * warm-up right after the server starts listening, so the first real
 * certificate-download request doesn't pay the ~30s cold browser-launch
 * cost inline (evidence/phase0/FINDINGS.md:177-178 — walk C15: attempt 1 =
 * 503, attempts 2-4 succeeded once the browser was already warm).
 *
 * Test strategy — extract + sandbox (same technique as
 * server-boot-receipt-assert.test.js / R7-C, adapted for this hook)
 *   The hook lives inside `if (require.main === module) { app.listen(
 *   port, host, () => { ... setImmediate(async () => { ... }) ... }) }`.
 *   Requiring server.js from a Jest worker does NOT trigger the listener
 *   (require.main is jest, not server.js), so we can't drive the hook by
 *   `require('../../server')`. Instead we read server.js source via `fs`,
 *   slice out the exact try/catch block delimited by the
 *   `// [F-PDF-COLD-START-TIMEOUT]` marker, wrap it in an async IIFE, and
 *   execute via `vm.runInNewContext` with an injected sandbox of mocked
 *   `require` / `logger`. This exercises the *actual production source
 *   bytes* — if the hook ever drifts (e.g. someone adds an `await` in
 *   front of the fire-and-forget call, turning it blocking), these tests
 *   fail loud.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SERVER_JS_PATH = path.resolve(__dirname, '..', '..', 'server.js');
const MARKER = '// [F-PDF-COLD-START-TIMEOUT] Boot-time Puppeteer warm-up';

/**
 * Slice the [F-PDF-COLD-START-TIMEOUT] boot-hook try/catch out of
 * server.js source (same brace/string/comment/template-literal-aware
 * counting as the R6-B extractor in server-boot-receipt-assert.test.js).
 */
function extractBootHookSource() {
    const src = fs.readFileSync(SERVER_JS_PATH, 'utf8');
    const markerIdx = src.indexOf(MARKER);
    if (markerIdx < 0) {
        throw new Error(
            `pdf-warmup-boot-hook.test.js: marker comment "${MARKER}" not found in server.js`
            + ' — has the boot hook been removed or moved? Update this test extraction logic.',
        );
    }
    const tryIdx = src.indexOf('try {', markerIdx);
    if (tryIdx < 0) {
        throw new Error('pdf-warmup-boot-hook.test.js: no `try {` found after the marker.');
    }
    let depth = 0;
    let inTemplate = false;
    let inLineComment = false;
    let inBlockComment = false;
    let inString = null;
    let end = -1;
    for (let i = tryIdx; i < src.length; i += 1) {
        const ch = src[i];
        const next = src[i + 1];

        if (inLineComment) {
            if (ch === '\n') { inLineComment = false; }
            continue;
        }
        if (inBlockComment) {
            if (ch === '*' && next === '/') { inBlockComment = false; i += 1; }
            continue;
        }
        if (inString) {
            if (ch === '\\') { i += 1; continue; }
            if (ch === inString) { inString = null; }
            continue;
        }
        if (inTemplate) {
            if (ch === '\\') { i += 1; continue; }
            if (ch === '`') { inTemplate = false; continue; }
            if (ch === '$' && next === '{') { depth += 1; i += 1; }
            else if (ch === '}' && depth > 0) { depth -= 1; }
            continue;
        }

        if (ch === '/' && next === '/') { inLineComment = true; i += 1; continue; }
        if (ch === '/' && next === '*') { inBlockComment = true; i += 1; continue; }
        if (ch === '\'' || ch === '"') { inString = ch; continue; }
        if (ch === '`') { inTemplate = true; continue; }

        if (ch === '{') {
            depth += 1;
        } else if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
                let j = i + 1;
                while (j < src.length && /\s/u.test(src[j])) { j += 1; }
                if (src.slice(j, j + 5) === 'catch') {
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
    }
    if (end < 0) {
        throw new Error('pdf-warmup-boot-hook.test.js: failed to slice the boot-hook try/catch block.');
    }
    return src.slice(tryIdx, end);
}

/**
 * Build a fresh sandbox + run the boot hook. The hook fires
 * pdf-generator.service.warmUp() WITHOUT awaiting it (non-blocking by
 * design), so after the wrapped IIFE settles we flush the microtask queue
 * a couple of ticks before asserting on the chained .then()/.catch()
 * side effects (the logger calls).
 */
async function runBootHook({ warmUpImpl, requireThrows } = {}) {
    const warmUp = jest.fn(warmUpImpl || (async () => {}));
    const logger = {
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    };
    const sandbox = {
        require: jest.fn((modulePath) => {
            if (requireThrows) { throw requireThrows; }
            if (modulePath === './services/pdf/pdf-generator.service') {
                return { warmUp };
            }
            throw new Error(
                `pdf-warmup-boot-hook.test.js: unexpected require('${modulePath}') from the boot hook.`,
            );
        }),
        logger,
        console,
        Promise,
        Error,
        String,
    };

    const bootSource = extractBootHookSource();
    const wrapped = `(async () => { ${bootSource} })();`;
    const result = vm.runInNewContext(wrapped, sandbox, {
        filename: 'server.js[pdf-warmup-boot-hook-extracted]',
        timeout: 5000,
    });
    await result;
    // Flush the microtask queue so the fire-and-forget .then()/.catch()
    // chain (registered but not awaited by the hook itself) settles.
    await new Promise((resolve) => { setImmediate(resolve); });
    await new Promise((resolve) => { setImmediate(resolve); });

    return { warmUp, logger };
}

describe('[F-PDF-COLD-START-TIMEOUT] server.js boot hook — PDF warm-up', () => {
    test('extractBootHookSource returns a non-empty block that calls warmUp() without awaiting it', () => {
        const block = extractBootHookSource();
        expect(block).toMatch(/^try\s*\{/u);
        expect(block).toMatch(/pdf-generator\.service'\)\.warmUp\(\)/u);
        // Non-blocking contract: no `await` directly in front of the warmUp() call.
        expect(block).not.toMatch(/await\s+require\([^)]*pdf-generator\.service[^)]*\)\.warmUp\(\)/u);
    });

    test('boot-init invokes pdf-generator.service.warmUp() exactly once', async () => {
        const { warmUp } = await runBootHook({ warmUpImpl: async () => {} });
        expect(warmUp).toHaveBeenCalledTimes(1);
    });

    test('warmUp() resolving logs the [boot] completion line', async () => {
        const { logger } = await runBootHook({ warmUpImpl: async () => {} });
        expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/\[boot\].*PDF warm-up complete/u));
    });

    test('fail-soft: warmUp() rejects → boot hook does not throw, one [boot] warn logged', async () => {
        const boom = new Error('spawn /usr/bin/chromium ENOENT — no Chromium on this deploy target');
        const { warmUp, logger } = await runBootHook({ warmUpImpl: async () => { throw boom; } });

        expect(warmUp).toHaveBeenCalledTimes(1);
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/\[boot\] PDF warm-up failed \(fail-soft\)/u));
        expect(logger.warn.mock.calls[0][0]).toMatch(/ENOENT/u);
    });

    test('fail-soft: require() itself throws synchronously (module load failure) → outer catch logs, no crash', async () => {
        const boom = new Error('Cannot find module ./services/pdf/pdf-generator.service');
        const { logger } = await runBootHook({ requireThrows: boom });

        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/\[boot\] PDF warm-up failed to start/u));
        expect(logger.warn.mock.calls[0][0]).toMatch(/Cannot find module/u);
    });
});
