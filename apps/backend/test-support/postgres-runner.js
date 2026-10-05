/**
 * The I/O half of the test-database attestation guard: the only place in this
 * mechanism that opens a socket.
 *
 * It is separate from test-database-guard.js on purpose. The guard holds every
 * decision and no I/O, which is what makes `--selftest` able to prove all of them
 * with no database present (Law L6). This file is the small, boring part that
 * cannot be selftested without a server, so it is kept small and boring.
 *
 * Two properties matter here:
 *
 * 1. THE URL IS PINNED BEFORE @prisma/client IS LOADED. Requiring the generated
 *    client makes it read .env off disk and inject DATABASE_URL into
 *    process.env. In a jest globalSetup that value would then be inherited by
 *    every worker — i.e. this file could hand the suite the developer's live
 *    database as a side effect of checking whether it may use it. dotenv does
 *    not overwrite a variable that is already set, so setting it first makes
 *    .env lose. The original value is restored afterwards (deleted if it was
 *    absent), so nothing leaks out of this call.
 *
 * 2. EVERY CALL IS TIME-BOXED. A guard that hangs is a guard that gets bypassed,
 *    and an unanswered connection must resolve as a refusal, never as a wait.
 */

'use strict';

const { redactText } = require('./test-database-guard');

const DEFAULT_TIMEOUT_MS = 15000;

function withTimeout(promise, timeoutMs, label) {
    let timer = null;
    const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
    });
    return Promise.race([promise, timeout]).finally(() => {
        if (timer) {
            clearTimeout(timer);
        }
    });
}

/**
 * Open a client against `url`, hand `fn` a tiny query surface, close it again.
 *
 * @param {string} url
 * @param {(io: {query: (sql: string) => Promise<Array<object>>, execute: (sql: string, ...params: unknown[]) => Promise<number>}) => Promise<T>} fn
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<T>}
 * @template T
 */
async function withDatabase(url, fn, options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    const hadUrl = Object.prototype.hasOwnProperty.call(process.env, 'DATABASE_URL');
    const previousUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url; // see property 1 in the header

    let client = null;
    try {
        const { PrismaClient } = require('@prisma/client');
        client = new PrismaClient({ datasources: { db: { url } } });
        return await withTimeout(
            fn({
                query: sql => client.$queryRawUnsafe(sql),
                execute: (sql, ...params) => client.$executeRawUnsafe(sql, ...params),
            }),
            timeoutMs,
            'database check',
        );
    } catch (error) {
        // Re-thrown with the same code so the guard can still tell "relation does
        // not exist" from "cannot connect", but with the connection string taken
        // out of the message first.
        const wrapped = new Error(redactText((error && error.message) || String(error)));
        wrapped.code = error && error.code;
        throw wrapped;
    } finally {
        if (client) {
            try {
                await client.$disconnect();
            } catch {
                // Nothing left to close, and a failure here must not mask the verdict.
            }
        }
        if (hadUrl) {
            process.env.DATABASE_URL = previousUrl;
        } else {
            delete process.env.DATABASE_URL;
        }
    }
}

module.exports = { withDatabase, withTimeout, DEFAULT_TIMEOUT_MS };
