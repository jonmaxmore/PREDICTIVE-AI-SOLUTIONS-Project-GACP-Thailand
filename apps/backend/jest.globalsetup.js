/**
 * Jest globalSetup — the once-per-run database door.
 *
 * WHY THIS RUNS HERE AND NOT IN A TEST
 * ------------------------------------
 * A per-test check is useless: by the time one test is running, other suites have
 * already written rows. The question "may this run touch this database at all?"
 * has to be answered once, before any worker starts, and the only answer that can
 * stop a bad run is aborting the whole thing. globalSetup is the one place jest
 * gives us that is async and runs exactly once, in the parent process, before any
 * test file is loaded. Throwing from here ends the run with nothing executed.
 *
 * WHAT IT DECIDES (the logic lives in test-support/test-database-guard.js, which
 * has a --selftest proving every branch with no database present):
 *
 *   local            → nothing to prove. jest.setup.js's hostname pinning governs
 *                      exactly as before. Nobody has to provision a marker to run
 *                      the suite against a local postgres.
 *   verify-remote    → the run has explicitly asked for a remote database
 *                      (ATTESTED_TEST_DATABASE_URL, or the legacy
 *                      ALLOW_REMOTE_TEST_DATABASE=1 with a remote DATABASE_URL).
 *                      That database must CONTAIN the marker, stamped on itself.
 *                      Missing, malformed, ambiguous, foreign, unreachable, query
 *                      error → the run ABORTS. There is no warning level.
 *
 * WHAT IT PUBLISHES to the workers (they are forked after this returns, so they
 * inherit this environment):
 *
 *   GACP_TEST_DB_KIND               'local' | 'attested-remote' | 'none'
 *   GACP_TEST_DB_REACHABLE          '1' | '0'   (probed, not assumed)
 *   GACP_TEST_DB_TARGET             redacted description, safe to print
 *   GACP_TEST_DB_REASON             one line a human can act on
 *   GACP_TEST_DB_ATTESTATION_TOKEN  set only after a marker verified; bound to
 *                                   the exact url, so a stale value cannot hand
 *                                   the suite a different database
 *
 * Every one of those is DELETED before anything is decided. They are outputs of
 * this file, never inputs: a value inherited from a shell or a .env must not be
 * able to answer a question this file exists to ask.
 */

'use strict';

const guard = require('./test-support/test-database-guard');
const { withDatabase } = require('./test-support/postgres-runner');

const PUBLISHED_VARS = [
    'GACP_TEST_DB_KIND',
    'GACP_TEST_DB_REACHABLE',
    'GACP_TEST_DB_TARGET',
    'GACP_TEST_DB_REASON',
    'GACP_TEST_DB_ATTESTATION_TOKEN',
];

const LOCAL_PROBE_TIMEOUT_MS = 5000;
const REMOTE_VERIFY_TIMEOUT_MS = 15000;

function publish(values) {
    for (const [key, value] of Object.entries(values)) {
        process.env[key] = String(value);
    }
}

module.exports = async () => {
    for (const key of PUBLISHED_VARS) {
        delete process.env[key];
    }

    const decision = guard.decideDatabaseAccess(process.env);

    if (decision.mode === 'local') {
        // R3: a local database needs no marker. The probe is best effort and never
        // aborts — a missing local postgres has always meant "integration tests go
        // red on connection refused", and that stays true. It is recorded so that
        // test-support/test-database.js can answer honestly instead of every suite
        // re-inventing `Boolean(process.env.DATABASE_URL)`, which is true even when
        // the value points at a database that does not exist.
        let reachable = false;
        let reason = '';
        try {
            await withDatabase(decision.url, io => io.query('SELECT 1'), { timeoutMs: LOCAL_PROBE_TIMEOUT_MS });
            reachable = true;
            reason = `local test database is reachable (${decision.redacted})`;
        } catch (error) {
            reason = `local test database is NOT reachable: ${guard.redactText((error && error.message) || error)}`;
        }

        publish({
            GACP_TEST_DB_KIND: 'local',
            GACP_TEST_DB_REACHABLE: reachable ? '1' : '0',
            GACP_TEST_DB_TARGET: decision.redacted,
            GACP_TEST_DB_REASON: reason,
        });

        if (!reachable) {
            // Said out loud, every run. A suite skipping itself in silence because
            // no database answered is the green tick that means nothing.
            console.warn(`[jest-globalsetup] ${reason}`);
            console.warn('[jest-globalsetup] Suites that need a database will report it; unit tests are unaffected.');
        }
        return;
    }

    // ── verify-remote ────────────────────────────────────────────────────────
    console.warn(`[jest-globalsetup] A REMOTE database was requested by ${decision.source}: ${decision.redacted}`);
    console.warn('[jest-globalsetup] Checking that it proves it is a test database before any test runs.');

    let verdict;
    try {
        verdict = await guard.verifyTestDatabaseMarker({
            runQuery: sql => withDatabase(decision.url, io => io.query(sql), { timeoutMs: REMOTE_VERIFY_TIMEOUT_MS }),
        });
    } catch (error) {
        // verifyTestDatabaseMarker catches query failures itself; reaching here means
        // the machinery around it broke (no generated prisma client, for instance).
        // Fail closed: an unanswered question is a refusal.
        verdict = {
            ok: false,
            code: guard.REFUSAL.UNREACHABLE,
            detail: `the attestation check could not be performed: ${guard.redactText((error && error.message) || error)}`,
        };
    }

    if (!verdict.ok) {
        publish({
            GACP_TEST_DB_KIND: 'none',
            GACP_TEST_DB_REACHABLE: '0',
            GACP_TEST_DB_TARGET: decision.redacted,
            GACP_TEST_DB_REASON: `${verdict.code}: ${verdict.detail}`,
        });
        console.error(guard.formatRefusal({
            code: verdict.code,
            detail: verdict.detail,
            redacted: decision.redacted,
            source: decision.source,
        }));
        // Aborts the WHOLE run, before a single test file is loaded.
        throw new Error(`test database attestation failed (${verdict.code}) — no test was run. See the message above.`);
    }

    // Pinned in the parent so the workers inherit it, and so @prisma/client cannot
    // later load a different url out of .env: dotenv does not overwrite a variable
    // that is already set. This is the same lesson jest.setup.js:86-95 records.
    process.env.DATABASE_URL = decision.url;
    publish({
        GACP_TEST_DB_KIND: 'attested-remote',
        GACP_TEST_DB_REACHABLE: '1',
        GACP_TEST_DB_TARGET: decision.redacted,
        GACP_TEST_DB_REASON: `marker v${verdict.marker.version} stamped ${verdict.marker.stampedAt} by ${verdict.marker.stampedByRole}`,
        GACP_TEST_DB_ATTESTATION_TOKEN: guard.attestationToken(decision.url),
    });

    console.warn('[jest-globalsetup] ────────────────────────────────────────────────────────────');
    console.warn(`[jest-globalsetup] Attested test database: ${decision.redacted}`);
    console.warn(`[jest-globalsetup]   database  : ${verdict.marker.databaseName} (oid ${verdict.marker.databaseOid})`);
    console.warn(`[jest-globalsetup]   stamped   : ${verdict.marker.stampedAt} by ${verdict.marker.stampedByRole} from ${verdict.marker.stampedFrom}`);
    console.warn(`[jest-globalsetup]   note      : ${verdict.marker.note}`);
    console.warn('[jest-globalsetup] This run WILL WRITE to that database, including money rows and');
    console.warn('[jest-globalsetup] the PDPA retention sweep, which nulls identity columns.');
    console.warn('[jest-globalsetup] ────────────────────────────────────────────────────────────');
};
