#!/usr/bin/env node
/**
 * Test-database attestation guard — the logic half.
 *
 * WHY THIS EXISTS
 * ---------------
 * There is exactly one Supabase dataset behind this platform. The laptop's .env,
 * the preview stack and the operator's own testing all point at it, and it holds
 * real certificates, real applications and real citizens' identity data.
 *
 * On 2026-08-23 the jest suite wrote nine DTAM-REMIT journal entries totalling
 * 45,000 THB into that dataset, because jest inherited the developer's .env
 * (the full account is in jest.setup.js). Money was not even the worst case:
 * pdpa-retention-legal-hold.test.js calls the real runPdpaRetentionSweep(),
 * which wraps itself in withoutTenantScope and NULLs healthId / idCard / taxId
 * plus their hashes across the whole users table (jobs/pdpa-retention-job.js:95,
 * :130). Pointed at the real dataset that is irreversible destruction of
 * citizens' PII, and afterwards nobody can say which rows.
 *
 * The existing guard in jest.setup.js pins the suite to a LOCAL database by
 * hostname. That door stays exactly as it is. It has one blind spot: it cannot
 * tell a remote TEST database from the remote PRODUCTION one, so the only way to
 * use a legitimate remote test database was ALLOW_REMOTE_TEST_DATABASE=1 —
 * all-or-nothing, pointed at whatever the environment happened to hold.
 *
 * THE PRINCIPLE
 * -------------
 * The proof must be a property OF THE DATABASE, not of the URL string. A
 * hostname, a variable name and a file name can all be wrong by accident — a
 * copied .env is exactly how the money incident happened. So a remote database
 * is usable by the suite only if it CONTAINS a marker that the production
 * database does not and never will.
 *
 * WHY A TABLE IN ITS OWN SCHEMA (and not a COMMENT or a custom GUC)
 * ----------------------------------------------------------------
 *   - COMMENT ON DATABASE and ALTER DATABASE ... SET both require ownership of
 *     the database. On a managed Postgres (Supabase) the role the app connects
 *     as usually does not own it, so an honest operator could not stamp their
 *     own test database at all — and a guard nobody can satisfy gets bypassed.
 *   - A table needs only CREATE on the database, is visible to \dn / \dt, and
 *     can carry a payload a human can read and judge: who stamped it, when,
 *     from where, and why.
 *   - It lives in its OWN schema and is deliberately NOT in prisma/schema, so no
 *     migration can ever create it. The only way it reaches a database is an
 *     operator running scripts/stamp-test-database.js against that database.
 *
 * WHY THE MARKER IS BOUND TO THE DATABASE IT WAS STAMPED ON
 * ---------------------------------------------------------
 * A row can be carried into another database by pg_dump/pg_restore. So the row
 * records the database name AND the database's oid at stamp time, and
 * verification re-reads both live and demands an exact match. A marker that
 * arrived by restore describes a different database and is refused — with a
 * message that says so, because that situation means somebody restored a test
 * dump over something else and needs to know.
 *
 * FAIL CLOSED
 * -----------
 * Unreachable, ambiguous, missing, malformed, wrong version, foreign, query
 * error → refuse. There is no warning level and no "continue and hope": the cost
 * of a false accept is unrecoverable, the cost of a false refuse is a red run
 * somebody fixes in a minute.
 *
 * This file holds the DECISIONS and does no I/O, so every branch can be proven
 * with no database present:
 *     node apps/backend/test-support/test-database-guard.js --selftest
 * The wiring that actually talks to Postgres is jest.globalsetup.js and
 * scripts/stamp-test-database.js.
 */

'use strict';

const crypto = require('crypto');

/** Hosts that are this machine. Kept identical to the set jest.setup.js used. */
const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres', 'db', 'host.docker.internal']);

const DEFAULT_LOCAL_TEST_DATABASE_URL = 'postgresql://gacp:gacp@127.0.0.1:5432/gacp_e2e_test?schema=public';

const MARKER = Object.freeze({
    schema: 'gacp_test_attestation',
    table: 'attestation',
    qualified: 'gacp_test_attestation.attestation',
    /** Bump only for an incompatible row shape; verification refuses versions it does not know. */
    version: 1,
});

const SUPPORTED_MARKER_VERSIONS = Object.freeze([1]);

/**
 * Tables whose contents prove a database is NOT a scratch database. Used by the
 * stamping script to refuse a database that holds real work. People and money
 * only — seed/config tables legitimately have rows in a freshly provisioned
 * environment, and including them would make the check impossible to satisfy,
 * which is how a safety check turns into a formality nobody can pass.
 */
const REAL_DATA_TABLES = Object.freeze([
    'users',
    'applications',
    'certificates',
    'journal_entries',
    'payment_transactions',
    'invoices',
]);

/** Refusal codes. Every one of them ABORTS the run; they differ only in advice. */
const REFUSAL = Object.freeze({
    UNREACHABLE: 'UNREACHABLE',
    MARKER_MISSING: 'MARKER_MISSING',
    MARKER_AMBIGUOUS: 'MARKER_AMBIGUOUS',
    MARKER_MALFORMED: 'MARKER_MALFORMED',
    MARKER_VERSION: 'MARKER_VERSION',
    MARKER_FOREIGN: 'MARKER_FOREIGN',
});

// ── redaction (Law L2) ────────────────────────────────────────────────────────
//
// Connection strings turn up inside OTHER tools' error messages: prisma P1001
// prints the URL it tried, psql prints the DSN. Everything this guard prints or
// throws goes through redactText() first, and every URL shown to a human goes
// through redactDatabaseUrl(). Pinned by selftest cases R1-R4 and S.

function redactText(text) {
    return String(text)
        .replace(/\b(postgres(?:ql)?:\/\/[^\s:/@]*):[^\s@]*@/gi, '$1:***@')
        .replace(/([?&](?:password|pgpassword|pwd)=)[^&\s]*/gi, '$1***');
}

/**
 * Human-facing form of a connection URL: host, port and database name — the
 * three things a reader needs to identify the target — and nothing else. The
 * username is dropped as well as the password: on Supabase the username carries
 * the project reference.
 */
function redactDatabaseUrl(url) {
    if (!url) {
        return '<unset>';
    }
    try {
        const parsed = new URL(url);
        const port = parsed.port ? `:${parsed.port}` : '';
        return `${parsed.protocol}//<redacted>@${parsed.hostname}${port}${parsed.pathname}`;
    } catch {
        return '<unparseable database url — redacted>';
    }
}

// ── classification ────────────────────────────────────────────────────────────

function hostOf(url) {
    if (!url) {
        return null;
    }
    try {
        return new URL(url).hostname;
    } catch {
        return null; // unparseable is not provably local, so it counts as remote
    }
}

function isLocalDatabaseHost(host) {
    return Boolean(host) && LOCAL_DB_HOSTS.has(host);
}

function isLocalDatabaseUrl(url) {
    return isLocalDatabaseHost(hostOf(url));
}

/** The local target jest.setup.js pins to. One definition, two readers. */
function localTestDatabaseUrl(env) {
    const configured = env && typeof env.TEST_DATABASE_URL === 'string' ? env.TEST_DATABASE_URL.trim() : '';
    return configured || DEFAULT_LOCAL_TEST_DATABASE_URL;
}

function trimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * What is this run allowed to talk to, before any database is contacted?
 *
 * mode 'local'         — nothing to prove; jest.setup.js's hostname pinning
 *                        governs, exactly as it did before this file existed.
 * mode 'verify-remote' — the run has explicitly ASKED for a remote database. It
 *                        must now prove itself or the whole run aborts.
 *
 * A remote DATABASE_URL that nobody asked for is NOT 'verify-remote': that is
 * the inherited-.env case, and the right answer there is the old one — pin to
 * local and never open a socket to it.
 *
 * @returns {{mode: 'local'|'verify-remote', url: string, source: string, redacted: string}}
 */
function decideDatabaseAccess(env) {
    const requested = trimmed(env.ATTESTED_TEST_DATABASE_URL);
    if (requested) {
        // Pointed at this machine? Then it is an ordinary local test database and
        // R3 applies: no marker required (see the local branch below).
        const mode = isLocalDatabaseUrl(requested) ? 'local' : 'verify-remote';
        return {
            mode,
            url: requested,
            source: 'ATTESTED_TEST_DATABASE_URL',
            redacted: redactDatabaseUrl(requested),
        };
    }

    const current = trimmed(env.DATABASE_URL);
    if (env.ALLOW_REMOTE_TEST_DATABASE === '1' && current && !isLocalDatabaseUrl(current)) {
        // The legacy flag is no longer a door on its own. It says "I mean it"; it
        // never said "and this is a test database", which is the only claim that
        // would have prevented 2026-08-23.
        return {
            mode: 'verify-remote',
            url: current,
            source: 'ALLOW_REMOTE_TEST_DATABASE=1 + DATABASE_URL',
            redacted: redactDatabaseUrl(current),
        };
    }

    const localIsCurrent = Boolean(current) && isLocalDatabaseUrl(current);
    const local = localIsCurrent ? current : localTestDatabaseUrl(env);
    return {
        mode: 'local',
        url: local,
        source: localIsCurrent ? 'DATABASE_URL (local host)' : 'local test database',
        redacted: redactDatabaseUrl(local),
    };
}

// ── the marker ────────────────────────────────────────────────────────────────

/**
 * DDL for the marker. Deliberately outside prisma/schema so that no migration,
 * on any environment, can ever create it. `id integer PRIMARY KEY CHECK (id = 1)`
 * makes "exactly one row" a property the database enforces rather than a
 * convention — two rows would be an ambiguous claim, and verification refuses
 * ambiguity.
 */
function markerDdlSql() {
    return [
        `CREATE SCHEMA IF NOT EXISTS ${MARKER.schema}`,
        `CREATE TABLE IF NOT EXISTS ${MARKER.qualified} (
    id              integer PRIMARY KEY CHECK (id = 1),
    marker_version  integer     NOT NULL,
    database_name   text        NOT NULL,
    database_oid    bigint      NOT NULL,
    stamped_at      timestamptz NOT NULL DEFAULT now(),
    stamped_by_role text        NOT NULL,
    stamped_from    text        NOT NULL,
    note            text        NOT NULL
)`,
    ];
}

/**
 * One round trip: the marker row AND the live identity of the database it was
 * read from, so the two can be compared without trusting anything in between.
 */
function markerVerificationSql() {
    return `SELECT a.marker_version::text AS marker_version,
       a.database_name                 AS database_name,
       a.database_oid::text            AS database_oid,
       a.stamped_at::text              AS stamped_at,
       a.stamped_by_role               AS stamped_by_role,
       a.stamped_from                  AS stamped_from,
       a.note                          AS note,
       current_database()              AS live_database_name,
       (SELECT d.oid::text FROM pg_database d WHERE d.datname = current_database()) AS live_database_oid
  FROM ${MARKER.qualified} a`;
}

function liveIdentitySql() {
    return `SELECT current_database() AS database_name,
       (SELECT d.oid::text FROM pg_database d WHERE d.datname = current_database()) AS database_oid,
       current_user AS role_name`;
}

/** A "relation/schema does not exist" error means MISSING, not BROKEN. */
function looksLikeMissingRelation(error) {
    const text = `${(error && error.code) || ''} ${(error && error.message) || ''}`;
    return /42P01|3F000|does not exist/i.test(text);
}

/**
 * Judge a marker read. Pure: takes the rows (or the error) and returns a verdict.
 * Every path that is not an exact, self-consistent, current-version marker
 * belonging to THIS database is a refusal.
 *
 * @returns {{ok: true, marker: object} | {ok: false, code: string, detail: string}}
 */
function judgeMarkerRows(rows, error) {
    if (error) {
        return looksLikeMissingRelation(error)
            ? {
                ok: false,
                code: REFUSAL.MARKER_MISSING,
                detail: `${MARKER.qualified} does not exist on that database (${redactText((error && error.message) || error)})`,
            }
            : {
                ok: false,
                code: REFUSAL.UNREACHABLE,
                detail: redactText((error && error.message) || String(error)),
            };
    }

    if (!Array.isArray(rows) || rows.length === 0) {
        return {
            ok: false,
            code: REFUSAL.MARKER_MISSING,
            detail: Array.isArray(rows)
                ? `${MARKER.qualified} exists but holds no row. An empty marker table claims nothing.`
                : 'the marker query did not return rows at all, so nothing was proven.',
        };
    }
    if (rows.length > 1) {
        return {
            ok: false,
            code: REFUSAL.MARKER_AMBIGUOUS,
            detail: `${MARKER.qualified} holds ${rows.length} rows. A database that makes two claims about itself proves neither.`,
        };
    }

    const row = rows[0];
    const required = [
        'marker_version',
        'database_name',
        'database_oid',
        'stamped_at',
        'stamped_by_role',
        'live_database_name',
        'live_database_oid',
    ];
    const missing = required.filter(field => row[field] === null || row[field] === undefined || String(row[field]).trim() === '');
    if (missing.length > 0) {
        return {
            ok: false,
            code: REFUSAL.MARKER_MALFORMED,
            detail: `the marker row is missing: ${missing.join(', ')}`,
        };
    }

    const version = Number(row.marker_version);
    if (!Number.isInteger(version) || !SUPPORTED_MARKER_VERSIONS.includes(version)) {
        return {
            ok: false,
            code: REFUSAL.MARKER_VERSION,
            detail: `marker_version ${String(row.marker_version)} is not one this guard understands (${SUPPORTED_MARKER_VERSIONS.join(', ')})`,
        };
    }

    // The binding check. A marker that describes a different database arrived by
    // restore, not by an operator's decision about THIS database.
    if (String(row.database_name) !== String(row.live_database_name)) {
        return {
            ok: false,
            code: REFUSAL.MARKER_FOREIGN,
            detail: `the marker was stamped on database "${String(row.database_name)}" but this database is "${String(row.live_database_name)}" — it was copied here, most likely by a restore.`,
        };
    }
    if (String(row.database_oid) !== String(row.live_database_oid)) {
        return {
            ok: false,
            code: REFUSAL.MARKER_FOREIGN,
            detail: `the marker names this database but carries oid ${String(row.database_oid)} while this database is oid ${String(row.live_database_oid)} — same name, different database. It was copied here, most likely by a restore.`,
        };
    }

    return {
        ok: true,
        marker: Object.freeze({
            version,
            databaseName: String(row.database_name),
            databaseOid: String(row.database_oid),
            stampedAt: String(row.stamped_at),
            stampedByRole: String(row.stamped_by_role),
            stampedFrom: row.stamped_from ? String(row.stamped_from) : 'unknown',
            note: row.note ? String(row.note) : '',
        }),
    };
}

/**
 * Read and judge the marker. I/O is INJECTED (`runQuery`) so this whole path is
 * provable with no database present — see --selftest.
 *
 * @param {{runQuery: (sql: string) => Promise<Array<object>>}} io
 */
async function verifyTestDatabaseMarker({ runQuery }) {
    let rows = null;
    let error = null;
    try {
        rows = await runQuery(markerVerificationSql());
    } catch (e) {
        error = e;
    }
    return judgeMarkerRows(rows, error);
}

// ── the refusal message (R5) ──────────────────────────────────────────────────

/**
 * What the reader sees when the run aborts. It has to answer three questions
 * without them opening a single file: what is missing, how do I create it on a
 * database I own, and what must I absolutely not do.
 */
function formatRefusal({ code, detail, redacted, source }) {
    // Redacted HERE as well as at the source. `detail` is usually a driver's own
    // error text, and a caller that builds one by hand — the stamping script, a
    // future probe — would otherwise put a connection string on the terminal.
    // Selftest case R1 was written first and failed on exactly that: the message
    // is the last thing before printing, so the last redaction belongs here.
    const safeDetail = redactText(detail);
    const safeTarget = redactText(redacted);
    const safeSource = redactText(source);
    return [
        '',
        '  ┌──────────────────────────────────────────────────────────────────────────┐',
        '  │  TEST RUN ABORTED — the target database did not prove it is a test DB    │',
        '  └──────────────────────────────────────────────────────────────────────────┘',
        '',
        `  target   : ${safeTarget}`,
        `  asked by : ${safeSource}`,
        `  refused  : ${code}`,
        `  because  : ${safeDetail}`,
        '',
        '  A remote database may be used by this suite only if it CONTAINS the marker',
        `  ${MARKER.qualified} (version ${MARKER.version}), stamped on that same`,
        '  database. A hostname or a variable name can be wrong by accident; a row',
        '  inside the database cannot be copied there by accident.',
        '',
        '  ON A DATABASE YOU OWN AND JUST CREATED FOR TESTING:',
        '',
        '    DATABASE_URL=<url of the empty database you just created> \\',
        '      node apps/backend/scripts/stamp-test-database.js --database <its name>',
        '',
        '    then re-run the suite with:',
        '      ATTESTED_TEST_DATABASE_URL=<that same url> pnpm --filter gacp-backend test',
        '',
        '  DO NOT RUN THE STAMPING SCRIPT AGAINST THE REAL DATABASE.',
        '  There is one Supabase dataset behind this platform and it holds real',
        '  certificates and real citizens\' identity data. This suite WRITES: on',
        '  2026-08-23 it posted nine real DTAM-REMIT journal entries (45,000 THB),',
        '  and pdpa-retention-legal-hold.test.js runs the real retention sweep, which',
        '  NULLs healthId / idCard / taxId across the whole users table. That is not',
        '  reversible, and afterwards nobody can say which rows were destroyed.',
        '  The stamping script refuses any database that still has rows in users,',
        '  applications or certificates — do not go looking for a way around it.',
        '',
        '  To run against a local postgres instead, leave ATTESTED_TEST_DATABASE_URL',
        '  unset: the suite pins itself to a database on this machine, as always.',
        '',
    ].join('\n');
}

// ── attestation token (parent → workers) ──────────────────────────────────────
//
// jest.globalsetup.js runs in the parent process; jest.setup.js runs in every
// worker. The workers have to know that THIS url was verified moments ago, and
// the only channel between them is the environment.
//
// The token is bound to the url, so a value left lying around in a shell or in a
// .env cannot authorise a DIFFERENT database — that is the failure mode that
// matters here, since a copied .env is how the original incident happened. It is
// not a secret and is not meant to stop someone determined to defeat the guard;
// jest.globalsetup.js deletes any inherited token before it verifies anything,
// so a stale one from an earlier run cannot survive into this one.

function attestationToken(url) {
    return crypto.createHash('sha256').update(`gacp-test-db-attestation-v${MARKER.version}|${url}`).digest('hex');
}

/** Does the environment carry a token that authorises exactly this url? */
function isAttestedUrl(env, url) {
    const token = trimmed(env.GACP_TEST_DB_ATTESTATION_TOKEN);
    if (!token || !url) {
        return false;
    }
    const expected = attestationToken(url);
    return token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

// ── "is this database empty of real work?" (used by the stamping script) ──────

/**
 * @param {Array<{table: string, present: boolean, count: number|null}>} counts
 * @returns {{ok: true} | {ok: false, table: string, count: number, unreadable?: boolean}}
 *
 * A table that does not exist yet (unmigrated, brand-new database) is empty of
 * real work — that is the normal case for a database created five seconds ago.
 * A table that exists and has rows STOPS the stamp, and the caller is told which
 * one, because "somewhere" is not an answer an operator can act on.
 *
 * A count that could not be read is NOT treated as zero. Fail closed: if the
 * guard cannot see inside a table, it does not get to certify that the table is
 * empty.
 */
function assertNoRealData(counts) {
    for (const entry of counts) {
        if (!entry.present) {
            continue;
        }
        if (entry.count === null || entry.count === undefined || Number.isNaN(Number(entry.count))) {
            return { ok: false, table: entry.table, count: -1, unreadable: true };
        }
        if (Number(entry.count) > 0) {
            return { ok: false, table: entry.table, count: Number(entry.count) };
        }
    }
    return { ok: true };
}

module.exports = {
    LOCAL_DB_HOSTS,
    DEFAULT_LOCAL_TEST_DATABASE_URL,
    MARKER,
    SUPPORTED_MARKER_VERSIONS,
    REAL_DATA_TABLES,
    REFUSAL,
    redactText,
    redactDatabaseUrl,
    hostOf,
    isLocalDatabaseHost,
    isLocalDatabaseUrl,
    localTestDatabaseUrl,
    decideDatabaseAccess,
    markerDdlSql,
    markerVerificationSql,
    liveIdentitySql,
    judgeMarkerRows,
    verifyTestDatabaseMarker,
    formatRefusal,
    attestationToken,
    isAttestedUrl,
    assertNoRealData,
};

// ── selftest (Law L6) ─────────────────────────────────────────────────────────
//
// Same shape and rigour as scripts/ci/full-gate.sh --selftest: every case is
// labelled, asserts an outcome AND the words the operator needs to see, and the
// run exits non-zero if any case fails. It proves BOTH directions — the refusing
// cases and the accepting case — because a guard that refuses everything is
// "correct" in exactly the way that gets it deleted a week later.
//
// No database is contacted: the query function is injected.

if (require.main === module) {
    if (process.argv[2] !== '--selftest') {
        console.error('usage: node apps/backend/test-support/test-database-guard.js --selftest');
        process.exit(2);
    }

    let bad = 0;
    let cases = 0;
    // A self-describing placeholder, never a realistic-looking password: this file
    // is read by the repo's own secret scanners.
    const PW = 'placeholder-not-a-credential';
    const REMOTE = `postgresql://someuser:${PW}@db.example.supabase.co:5432/postgres`;

    const check = (label, description, condition, extra) => {
        cases += 1;
        if (condition) {
            console.log(`--- selftest ${label}: ok — ${description}`);
        } else {
            bad += 1;
            console.log(`*** selftest ${label} FAILED: ${description}`);
            if (extra !== undefined) {
                console.log(`    got: ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`);
            }
        }
    };

    const goodRow = () => ({
        marker_version: '1',
        database_name: 'gacp_test_scratch',
        database_oid: '81920',
        stamped_at: '2026-08-26 09:00:00+00',
        stamped_by_role: 'gacp_test_owner',
        stamped_from: 'operator-laptop',
        note: 'scratch database for the backend jest suite',
        live_database_name: 'gacp_test_scratch',
        live_database_oid: '81920',
    });

    const run = async () => {
        // ── A. THE ACCEPTING CASE. Without it the guard could pass every other case
        //    by refusing unconditionally, which is not a guard, it is a wall.
        const accepted = await verifyTestDatabaseMarker({ runQuery: async () => [goodRow()] });
        check('A', 'a well-formed marker belonging to this database is ACCEPTED', accepted.ok === true, accepted);
        check('A2', 'the accepted marker carries who stamped it and when',
            accepted.ok === true && accepted.marker.stampedByRole === 'gacp_test_owner' && accepted.marker.stampedAt.startsWith('2026-08-26'),
            accepted.marker);

        // ── B. Unreachable. The 2026-08-23 shape of failure is "the check did not
        //    complete", and the only safe reading of that is refusal.
        const unreachable = await verifyTestDatabaseMarker({
            runQuery: async () => {
                const e = new Error(`Can't reach database server at postgresql://someuser:${PW}@db.example.supabase.co:5432`);
                e.code = 'P1001';
                throw e;
            },
        });
        check('B', 'an unreachable database is REFUSED', unreachable.ok === false && unreachable.code === REFUSAL.UNREACHABLE, unreachable);

        // ── C. Marker missing: the production database's normal state. This is the
        //    case that would have stopped the money incident.
        const missing = await verifyTestDatabaseMarker({
            runQuery: async () => {
                const e = new Error('relation "gacp_test_attestation.attestation" does not exist');
                e.code = 'P2010';
                throw e;
            },
        });
        check('C', 'a database with no marker table is REFUSED as MARKER_MISSING',
            missing.ok === false && missing.code === REFUSAL.MARKER_MISSING, missing);

        // ── D. Table present, no row. "The table exists" is not the claim; the row is.
        const empty = await verifyTestDatabaseMarker({ runQuery: async () => [] });
        check('D', 'an empty marker table is REFUSED', empty.ok === false && empty.code === REFUSAL.MARKER_MISSING, empty);

        // ── E. Two rows. A database making two claims about itself is not evidence.
        const two = await verifyTestDatabaseMarker({ runQuery: async () => [goodRow(), goodRow()] });
        check('E', 'two marker rows are REFUSED as ambiguous', two.ok === false && two.code === REFUSAL.MARKER_AMBIGUOUS, two);

        // ── F. Malformed: a row half-written by hand.
        const malformed = await verifyTestDatabaseMarker({
            runQuery: async () => [{ ...goodRow(), stamped_by_role: '' }],
        });
        check('F', 'a marker row with a blank required field is REFUSED',
            malformed.ok === false && malformed.code === REFUSAL.MARKER_MALFORMED, malformed);

        // ── G. Unknown version: a future shape this code cannot judge.
        const version = await verifyTestDatabaseMarker({ runQuery: async () => [{ ...goodRow(), marker_version: '99' }] });
        check('G', 'an unknown marker_version is REFUSED', version.ok === false && version.code === REFUSAL.MARKER_VERSION, version);

        // ── H. THE COPY CASE — the whole reason the marker is bound to the database.
        //    Somebody restored a test dump into another database; the row travelled
        //    with it and now sits in a database nobody stamped.
        const foreignName = await verifyTestDatabaseMarker({
            runQuery: async () => [{ ...goodRow(), live_database_name: 'postgres', live_database_oid: '16384' }],
        });
        check('H', 'a marker carried into a different database by restore is REFUSED',
            foreignName.ok === false && foreignName.code === REFUSAL.MARKER_FOREIGN, foreignName);

        // ── H2. MUTATION of H: same database NAME, different database. Name alone is
        //    not identity — two clusters can both hold a "gacp_test_scratch". If this
        //    case passes while H fails, the binding is decorative.
        const foreignOid = await verifyTestDatabaseMarker({
            runQuery: async () => [{ ...goodRow(), live_database_oid: '99999' }],
        });
        check('H2', 'a same-named database with a different oid is REFUSED',
            foreignOid.ok === false && foreignOid.code === REFUSAL.MARKER_FOREIGN, foreignOid);

        // ── I. A query that returns something absurd (a driver returning a string, a
        //    half-mocked client). Nothing but a real array of rows is evidence.
        const junk = await verifyTestDatabaseMarker({ runQuery: async () => 'ok' });
        check('I', 'a non-array query result is REFUSED', junk.ok === false, junk);

        // ── J..N. decideDatabaseAccess: which door does a given environment open?
        const dUnset = decideDatabaseAccess({});
        check('J', 'an empty environment stays LOCAL and contacts nothing remote',
            dUnset.mode === 'local' && dUnset.url === DEFAULT_LOCAL_TEST_DATABASE_URL, dUnset);

        const dInherited = decideDatabaseAccess({ DATABASE_URL: REMOTE });
        check('K', 'an inherited remote DATABASE_URL alone does NOT open the remote door (jest.setup.js still pins it local)',
            dInherited.mode === 'local', dInherited);

        const dLegacy = decideDatabaseAccess({ DATABASE_URL: REMOTE, ALLOW_REMOTE_TEST_DATABASE: '1' });
        check('L', 'the legacy ALLOW_REMOTE_TEST_DATABASE flag now leads to verification, not straight through',
            dLegacy.mode === 'verify-remote' && dLegacy.url === REMOTE, dLegacy);

        const dAsked = decideDatabaseAccess({ ATTESTED_TEST_DATABASE_URL: REMOTE });
        check('M', 'asking for a remote database requires verification',
            dAsked.mode === 'verify-remote' && dAsked.source === 'ATTESTED_TEST_DATABASE_URL', dAsked);

        const dLocalAsk = decideDatabaseAccess({ ATTESTED_TEST_DATABASE_URL: 'postgresql://gacp:x@127.0.0.1:5432/gacp_e2e_test' });
        check('N', 'a LOCAL url needs no marker — nobody has to provision anything to run against local postgres (R3)',
            dLocalAsk.mode === 'local', dLocalAsk);

        const dUnparseable = decideDatabaseAccess({ ATTESTED_TEST_DATABASE_URL: 'not a url at all' });
        check('N2', 'an unparseable url is treated as remote, never as local',
            dUnparseable.mode === 'verify-remote', dUnparseable);

        // ── O..P. The parent→worker token.
        const tokenEnv = { GACP_TEST_DB_ATTESTATION_TOKEN: attestationToken(REMOTE) };
        check('O', 'a token issued for a url authorises that url', isAttestedUrl(tokenEnv, REMOTE) === true);
        check('P', 'the token does NOT authorise a different url — a stale value cannot hand the suite another database',
            isAttestedUrl(tokenEnv, 'postgresql://someuser:x@other.example.com:5432/postgres') === false);
        check('P2', 'a hand-set truthy token value is not an attestation',
            isAttestedUrl({ GACP_TEST_DB_ATTESTATION_TOKEN: '1' }, REMOTE) === false);
        check('P3', 'no token at all is not an attestation', isAttestedUrl({}, REMOTE) === false);

        // ── Q. assertNoRealData — the stamping script's real gate.
        check('Q', 'a database with no such tables yet (freshly created) may be stamped',
            assertNoRealData(REAL_DATA_TABLES.map(t => ({ table: t, present: false, count: null }))).ok === true);
        check('Q2', 'an existing but empty schema may be stamped',
            assertNoRealData(REAL_DATA_TABLES.map(t => ({ table: t, present: true, count: 0 }))).ok === true);
        const withUsers = assertNoRealData([
            { table: 'users', present: true, count: 41 },
            { table: 'applications', present: true, count: 0 },
        ]);
        check('Q3', 'rows in users stop the stamp AND the table is named',
            withUsers.ok === false && withUsers.table === 'users' && withUsers.count === 41, withUsers);
        const withCerts = assertNoRealData([
            { table: 'users', present: true, count: 0 },
            { table: 'certificates', present: true, count: 1 },
        ]);
        check('Q4', 'a single certificate stops the stamp', withCerts.ok === false && withCerts.table === 'certificates', withCerts);
        const unreadable = assertNoRealData([{ table: 'users', present: true, count: null }]);
        check('Q5', 'a count that could not be read is NOT read as zero (fail closed)',
            unreadable.ok === false && unreadable.unreadable === true, unreadable);

        // ── R. NO SECRET (Law L2).
        const refusal = formatRefusal({
            code: REFUSAL.MARKER_MISSING,
            detail: `could not reach postgresql://someuser:${PW}@db.example.supabase.co:5432/postgres`,
            redacted: redactDatabaseUrl(REMOTE),
            source: 'ATTESTED_TEST_DATABASE_URL',
        });
        check('R1', 'the refusal message contains no password', !refusal.includes(PW));
        check('R2', 'redaction keeps the host and database name, which is what makes the message useful',
            redactDatabaseUrl(REMOTE).includes('db.example.supabase.co') && redactDatabaseUrl(REMOTE).includes('/postgres')
            && !redactDatabaseUrl(REMOTE).includes(PW), redactDatabaseUrl(REMOTE));
        check('R3', 'redactText strips a password out of another tool\'s error string',
            !redactText(`P1001: postgresql://u:${PW}@h:5432/db`).includes(PW)
            && redactText(`P1001: postgresql://u:${PW}@h:5432/db`).includes('h:5432/db'));
        check('R4', 'redactText strips a password passed as a query parameter',
            !redactText(`postgresql://h/db?password=${PW}&sslmode=require`).includes(PW));
        check('R5', 'the refusal names the marker, the stamping command, and forbids running it on the real database',
            refusal.includes(MARKER.qualified) && refusal.includes('stamp-test-database.js')
            && /DO NOT RUN THE STAMPING SCRIPT AGAINST THE REAL DATABASE/.test(refusal));
        check('R6', 'the refusal explains what this suite does to a database it is pointed at',
            /45,000 THB/.test(refusal) && /idCard/.test(refusal));

        // ── S. The UNREACHABLE refusal detail is lifted straight out of the driver's
        //    error message, which is exactly where connection strings live.
        check('S', 'the detail of an UNREACHABLE refusal is redacted at the source',
            unreachable.ok === false && !unreachable.detail.includes(PW), unreachable.detail);

        console.log('');
        console.log(`selftest: ${cases} cases, ${bad} failed`);
        if (bad > 0) {
            console.log('SELFTEST FAILED');
            process.exit(1);
        }
        console.log('SELFTEST PASS — the refusing cases and the accepting case both proven, no database contacted');
    };

    run().catch(error => {
        console.error(`selftest crashed: ${redactText((error && error.stack) || error)}`);
        process.exit(1);
    });
}
