/**
 * "Is there a usable test database?" — the one question a test file should ask.
 *
 * Suites have been answering it with `Boolean(process.env.DATABASE_URL)`. That is
 * not the same question. The variable is always set by the time a test runs —
 * jest.setup.js pins it to a local url precisely so that @prisma/client cannot
 * load a live one out of .env — so the check is true even when nothing is
 * listening, and it was true on 2026-08-23 when the value was the production
 * Supabase dataset. It says "a string exists", and every suite that trusted it
 * either failed on connect or wrote to production.
 *
 * This module reports what the run-level guard actually decided and verified:
 *   - jest.globalsetup.js probed the local database, or verified a remote one's
 *     attestation marker, before any worker started;
 *   - it published the result into the environment, which the workers inherit.
 *
 * CONTRACT (stable — other suites depend on it)
 *   module : apps/backend/test-support/test-database.js
 *   require('../../test-support/test-database')  // adjust depth to the suite
 *
 *   getTestDatabase() → frozen {
 *     usable      : boolean  — true only when a database was verified reachable
 *                              AND this run is allowed to write to it
 *     kind        : 'local' | 'attested-remote' | 'none'
 *     url         : string | null — the connection url to use. NEVER log it;
 *                                   log `redactedUrl` instead.
 *     redactedUrl : string  — safe to print: host, port, database name
 *     reason      : string  — one line saying why, for a skip message or a throw
 *   }
 *   hasTestDatabase() → boolean, shorthand for getTestDatabase().usable
 *   describeIfTestDatabase(name, fn) → describe(...) or describe.skip(...)
 *   requireTestDatabase() → the same object, or throws with `reason`, for a suite
 *                           that must go red rather than skip.
 *
 * BOTH ARE SYNCHRONOUS, DO NO I/O, AND MAY BE CALLED AT MODULE SCOPE. That is the
 * point: `const d = hasTestDatabase() ? describe : describe.skip;` has to work on
 * the first line of a test file. By then jest.setup.js has already run (jest loads
 * setupFilesAfterEach before the test module), so DATABASE_URL is final.
 *
 * FAIL CLOSED: if jest.globalsetup.js did not run — a different jest config, a
 * bare `jest` invocation — nothing is published, kind is 'none' and usable is
 * false. A suite then skips or throws instead of connecting to whatever the
 * environment happened to hold.
 */

'use strict';

const { redactDatabaseUrl } = require('./test-database-guard');

const VALID_KINDS = new Set(['local', 'attested-remote']);

function reasonFor(kind, reachable, published) {
    if (published) {
        return published;
    }
    if (!VALID_KINDS.has(kind)) {
        return 'no test database: jest.globalsetup.js did not run, so nothing has been verified. '
            + 'Run the suite through jest.config.cjs (pnpm --filter gacp-backend test).';
    }
    return reachable ? `${kind} test database is available` : `${kind} test database is not reachable`;
}

function getTestDatabase() {
    const kind = process.env.GACP_TEST_DB_KIND || 'none';
    const reachable = process.env.GACP_TEST_DB_REACHABLE === '1';
    const usable = VALID_KINDS.has(kind) && reachable;
    const url = usable ? process.env.DATABASE_URL || null : null;

    return Object.freeze({
        usable,
        kind: VALID_KINDS.has(kind) ? kind : 'none',
        url,
        redactedUrl: process.env.GACP_TEST_DB_TARGET || redactDatabaseUrl(url),
        reason: reasonFor(kind, reachable, process.env.GACP_TEST_DB_REASON),
    });
}

function hasTestDatabase() {
    return getTestDatabase().usable;
}

/**
 * For a suite that must not pass quietly when there is no database: the run goes
 * red with the reason instead of reporting a green tick for nothing.
 */
function requireTestDatabase() {
    const database = getTestDatabase();
    if (!database.usable) {
        throw new Error(`this suite needs a test database — ${database.reason}`);
    }
    return database;
}

/**
 * describe(...) when a database is available, describe.skip(...) otherwise, with
 * the reason in the suite name so a skipped run says WHY on the terminal rather
 * than just showing a smaller number.
 */
function describeIfTestDatabase(name, fn) {
    const database = getTestDatabase();
    if (database.usable) {
        return describe(name, fn);
    }
    return describe.skip(`${name} [skipped: ${database.reason}]`, fn);
}

module.exports = {
    getTestDatabase,
    hasTestDatabase,
    requireTestDatabase,
    describeIfTestDatabase,
};
