/**
 * [Sprint6] PDPA Retention Sweep (H6)
 *
 * Sprint 6 healthId-audit Phase D-H6: a daily cron sweeps users whose `retainUntil`
 * is in the past and anonymises them (PDPA Section 37).
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const mockFindMany = jest.fn();
const mockUpdate = jest.fn();
// Task 10 (document pre-check): the sweep also clears the page text a pre-check
// read off the person's papers. Default: nothing to clear.
const mockPrecheckUpdateMany = jest.fn(async () => ({ count: 0 }));
const mockPrecheckFlagUpdateMany = jest.fn(async () => ({ count: 0 }));
const mockPrecheckFindMany = jest.fn(async () => []);
const mockPrecheckFlagCreate = jest.fn(async () => ({}));
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: {
            findMany: (...args) => mockFindMany(...args),
            update: (...args) => mockUpdate(...args),
        },
        documentPrecheck: {
            updateMany: (...args) => mockPrecheckUpdateMany(...args),
            findMany: (...args) => mockPrecheckFindMany(...args),
        },
        documentPrecheckFlag: {
            updateMany: (...args) => mockPrecheckFlagUpdateMany(...args),
            create: (...args) => mockPrecheckFlagCreate(...args),
        },
    },
}));

const { runPdpaRetentionSweep } = require('../../jobs/pdpa-retention-job');
const logger = require('../../shared/logger');

const NOW = new Date('2026-05-15T12:00:00.000Z');
const PAST = new Date('2020-01-01T00:00:00.000Z');
const FUTURE = new Date('2030-01-01T00:00:00.000Z');

describe('[Sprint6] PDPA Retention Sweep', () => {
    beforeEach(() => {
        // `mockReset()` drains the `mockResolvedValueOnce` queue. `clearAllMocks()`
        // alone leaks the queue across tests in this suite and causes spurious
        // "Cannot read property '0' of undefined" / "Expected 2, received 0" failures.
        mockFindMany.mockReset();
        mockUpdate.mockReset();
        jest.useFakeTimers();
        jest.setSystemTime(NOW);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('anonymises users whose retainUntil is past, leaving future users alone', async () => {
        const expiredUser = {
            id: 'user-expired-1',
            healthId: '1100100100011',
            providerId: null,
            retainUntil: PAST,
        };
        const _futureUser = {
            id: 'user-future-1',
            healthId: '1186494077533',
            providerId: null,
            retainUntil: FUTURE,
        };

        // The job filters at the DB layer (`retainUntil: { lte: now }`) so only the expired
        // user is returned. The future user is not in the result set — proving the WHERE clause
        // works as designed.
        mockFindMany.mockResolvedValueOnce([expiredUser]).mockResolvedValueOnce([]);
        mockUpdate.mockResolvedValue(undefined);

        const stats = await runPdpaRetentionSweep();

        expect(stats.scanned).toBe(1);
        expect(stats.anonymized).toBe(1);
        expect(stats.errors).toBe(0);

        // findMany was called with a WHERE clause restricting to retainUntil ≤ now.
        const findManyArgs = mockFindMany.mock.calls[0][0];
        expect(findManyArgs.where.retainUntil).toEqual({ lte: NOW });

        // Update was called once, only for the expired user.
        expect(mockUpdate).toHaveBeenCalledTimes(1);
        expect(mockUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'user-expired-1' } }),
        );
        // futureUser was never updated.
        expect(mockUpdate).not.toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'user-future-1' } }),
        );
    });

    it('anonymisation nulls ALL identity + PII fields and sets password to PDPA_ANONYMIZED', async () => {
        mockFindMany.mockResolvedValueOnce([
            { id: 'u1', healthId: '1100100100011', providerId: null, retainUntil: PAST },
        ]).mockResolvedValueOnce([]);
        mockUpdate.mockResolvedValue(undefined);

        await runPdpaRetentionSweep();

        const updateArgs = mockUpdate.mock.calls[0][0];
        const data = updateArgs.data;

        // Every identity field nulled.
        for (const field of [
            'healthId', 'providerId', 'idCard', 'taxId', 'communityRegistrationNo',
            'healthIdHash', 'providerIdHash', 'idCardHash', 'taxIdHash', 'communityRegistrationNoHash',
            'firstName', 'lastName', 'email', 'phoneNumber',
            'address', 'province', 'district', 'subdistrict', 'zipCode',
            'companyName', 'representativeName', 'representativePosition', 'communityName',
            // Closing-review NEW-1 fix: canonical schema names are twoFactor*
            'twoFactorSecret', 'twoFactorBackupCodes',
        ]) {
            expect(data[field]).toBeNull();
        }
        expect(data.password).toBe('PDPA_ANONYMIZED');
        expect(data.isAnonymized).toBe(true);
        expect(data.anonymizedAt).toBeInstanceOf(Date);
    });

    it('never retries without isAnonymized/anonymizedAt — a marker failure is recorded, not routed around', async () => {
        // R-HOTFIX-PDPA step 2: the marker columns now EXIST
        // (prisma/schema/auth.prisma, migration 20260803130000_add_user_anonymization_markers),
        // so an update that fails while mentioning them is a real failure — not a
        // schema-shape mismatch to be worked around. The marker-less retry this
        // replaces was the same class of bug as the read-side fallback deleted in
        // step 1: it completed the IRREVERSIBLE null-out (identity columns AND their
        // hashes) while leaving the row unmarked, so the row came back as a candidate
        // on every subsequent nightly run and no audit trail recorded that it had
        // been anonymized. Destroying the data and losing the record of having done
        // so is strictly worse than failing loudly.
        mockFindMany
            .mockResolvedValueOnce([{ id: 'u1', healthId: '1100100100011', providerId: null, retainUntil: PAST }])
            .mockResolvedValueOnce([]);
        mockUpdate.mockRejectedValueOnce(new Error('Unknown arg `isAnonymized` in data'));

        const stats = await runPdpaRetentionSweep();

        // Exactly one attempt — no second, marker-stripped write.
        expect(mockUpdate).toHaveBeenCalledTimes(1);
        // The row is NOT counted as anonymized, because it was not anonymized.
        expect(stats.anonymized).toBe(0);
        expect(stats.errors).toBe(1);
        expect(logger.error).toHaveBeenCalledWith(
            '[pdpa-retention] Failed to anonymize user',
            expect.objectContaining({ userId: 'u1' }),
        );
    });

    it('error in a single user update is recorded but does not halt the sweep', async () => {
        mockFindMany
            .mockResolvedValueOnce([
                { id: 'u1', healthId: 'X', providerId: null, retainUntil: PAST },
                { id: 'u2', healthId: 'Y', providerId: null, retainUntil: PAST },
            ])
            .mockResolvedValueOnce([]);
        // user 1's update throws a generic (non-schema) error → outer catch records it.
        // user 2's update succeeds.
        // Note: only ONE mockResolvedValueOnce for the success — the `.catch` retry
        // path in the job is gated on the error message containing "isAnonymized" /
        // "anonymizedAt"; a "disk full" error rethrows to the outer catch and does
        // NOT consume a second mock call.
        mockUpdate
            .mockRejectedValueOnce(new Error('disk full'))   // user 1 fails
            .mockResolvedValueOnce(undefined);                // user 2 succeeds

        const stats = await runPdpaRetentionSweep();
        expect(stats.scanned).toBe(2);
        expect(stats.errors).toBe(1);     // exactly 1 failure
        expect(stats.anonymized).toBe(1); // exactly 1 success — the sweep DID continue past the failure

        // Operator decision 2026-08-03: not aborting the batch is only acceptable if
        // the dropped row is impossible to miss. A count alone is not enough — the
        // run must name the row AND report at ERROR level, or "1 error" becomes an
        // info-level number nobody reads (the exact failure mode this work item exists
        // to close). Pin both halves.
        expect(stats.failedUserIds).toEqual(['u1']);
        const errorCalls = logger.error.mock.calls.map(([msg]) => String(msg));
        expect(errorCalls.some((m) => m.includes('Failed to anonymize user'))).toBe(true);
        expect(errorCalls.some((m) => m.includes('Sweep complete WITH FAILURES'))).toBe(true);
        // ...and the summary must NOT be downgraded to info when rows were dropped.
        const infoCalls = logger.info.mock.calls.map(([msg]) => String(msg));
        expect(infoCalls.some((m) => m.includes('Sweep complete'))).toBe(false);
    });

    it('exits the loop cleanly when findMany returns empty batch', async () => {
        mockFindMany.mockResolvedValueOnce([]);

        const stats = await runPdpaRetentionSweep();
        expect(stats.scanned).toBe(0);
        expect(stats.anonymized).toBe(0);
        expect(mockUpdate).not.toHaveBeenCalled();
    });
});

/**
 * [R-HOTFIX-PDPA] Legal hold must survive the retention sweep.
 *
 * The user-initiated erasure path already refuses to delete a row under legal
 * hold (services/pdpa-service.js:291, services/pdpa-erasure-service.js:260,533 →
 * PDPA_LEGAL_HOLD). The cron path did not: it selected purely on
 * `retainUntil <= now` and then nulled BOTH the identity columns AND their hash
 * columns, which is irreversible and destroys the very evidence a hold exists to
 * preserve.
 *
 * Scope note: this job touches `prisma.user` only — there is no sweep for the
 * other models that carry a `legalHold` column (application / auth / billing x2 /
 * certification / tenancy), so there is nothing to fix there in this job.
 */
describe('[R-HOTFIX-PDPA] PDPA retention sweep respects legal hold', () => {
    beforeEach(() => {
        mockFindMany.mockReset();
        mockUpdate.mockReset();
        jest.useFakeTimers();
        jest.setSystemTime(NOW);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('filters legalHold rows out at the query layer and selects the column', async () => {
        mockFindMany.mockResolvedValueOnce([]);

        await runPdpaRetentionSweep();

        const args = mockFindMany.mock.calls[0][0];
        expect(args.where.legalHold).toBe(false);
        // The column must be selected so the in-loop guard below has something to read.
        expect(args.select.legalHold).toBe(true);
    });

    it('never anonymises a legal-hold user whose retainUntil is in the past', async () => {
        // Race guard: the hold may be placed between the findMany and the update,
        // so the row we already fetched is re-checked before mutating anything.
        mockFindMany.mockResolvedValueOnce([
            { id: 'user-hold-1', healthId: '1100100100011', providerId: null, retainUntil: PAST, legalHold: true },
            { id: 'user-free-1', healthId: '1186494077533', providerId: null, retainUntil: PAST, legalHold: false },
        ]);
        mockUpdate.mockResolvedValue(undefined);

        const stats = await runPdpaRetentionSweep();

        expect(mockUpdate).not.toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'user-hold-1' } }),
        );
        expect(mockUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'user-free-1' } }),
        );
        expect(mockUpdate).toHaveBeenCalledTimes(1);
        expect(stats.legalHoldSkipped).toBe(1);
        expect(stats.anonymized).toBe(1);
        expect(stats.errors).toBe(0);
    });

    it('fails closed when the isAnonymized column is missing — no unfiltered fallback re-query', async () => {
        mockFindMany.mockRejectedValueOnce(new Error('Unknown arg `isAnonymized` in where'));

        let caught = null;
        await runPdpaRetentionSweep().catch((err) => { caught = err; });

        // The old fallback re-queried on retainUntil alone, dropping BOTH the
        // isAnonymized filter and the legalHold filter. It must not run at all.
        expect(mockFindMany).toHaveBeenCalledTimes(1);
        expect(caught).not.toBeNull();
        expect(String(caught.message)).toContain('isAnonymized');
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('fails closed when the legalHold column is missing — aborts the sweep, anonymises nobody', async () => {
        mockFindMany.mockRejectedValueOnce(new Error('Unknown arg `legalHold` in where'));

        let caught = null;
        await runPdpaRetentionSweep().catch((err) => { caught = err; });

        expect(mockFindMany).toHaveBeenCalledTimes(1);
        expect(caught).not.toBeNull();
        expect(String(caught.message)).toContain('legalHold');
        expect(mockUpdate).not.toHaveBeenCalled();
    });
});

/**
 * [R-HOTFIX-PDPA] Operator policy, 2026-08-03: a held row is skipped FOREVER.
 *
 * The hold is not a deferral and not a grace period. `legalHold = true` means the
 * sweep passes the row over no matter how long ago `retainUntil` elapsed, and the
 * ONLY thing that makes it eligible again is a human clearing the flag. These
 * tests exist so nobody later "optimises" the guard into an extended retainUntil
 * or a skip-until-date, which would silently reintroduce automatic destruction.
 */
describe('[R-HOTFIX-PDPA] legal hold is permanent, not a deferral', () => {
    // Decades past retainUntil — far beyond any plausible retention window.
    const LONG_PAST = new Date('1990-01-01T00:00:00.000Z');

    beforeEach(() => {
        mockFindMany.mockReset();
        mockUpdate.mockReset();
        jest.useFakeTimers();
        jest.setSystemTime(NOW);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('skips a held row whose retainUntil elapsed 36 years ago', async () => {
        mockFindMany.mockResolvedValueOnce([
            { id: 'user-ancient-hold', healthId: '1100100100011', providerId: null, retainUntil: LONG_PAST, legalHold: true },
        ]);
        mockUpdate.mockResolvedValue(undefined);

        const stats = await runPdpaRetentionSweep();

        expect(mockUpdate).not.toHaveBeenCalled();
        expect(stats.anonymized).toBe(0);
        expect(stats.legalHoldSkipped).toBe(1);
    });

    it('the query excludes held rows unconditionally, not by shifting the date window', async () => {
        mockFindMany.mockResolvedValueOnce([]);

        await runPdpaRetentionSweep();

        const { where } = mockFindMany.mock.calls[0][0];
        // `legalHold: false` sits alongside the date predicate, ANDed with it — so
        // no retainUntil value can ever bring a held row back into the candidate set.
        expect(where.legalHold).toBe(false);
        expect(where.retainUntil).toEqual({ lte: NOW });
    });

    it('never writes retainUntil or legalHold — the sweep cannot defer or clear a hold', async () => {
        mockFindMany.mockResolvedValueOnce([
            { id: 'u-sweepable', healthId: '1186494077533', providerId: null, retainUntil: PAST, legalHold: false },
        ]);
        mockUpdate.mockResolvedValue(undefined);

        await runPdpaRetentionSweep();

        const { data } = mockUpdate.mock.calls[0][0];
        // Nothing in the anonymisation payload touches either column: the sweep has
        // no mechanism to extend a retention window or to release a hold.
        expect(data).not.toHaveProperty('retainUntil');
        expect(data).not.toHaveProperty('legalHold');
    });
});

/**
 * [R-HOTFIX-PDPA step 2] Every column the sweep names must actually exist.
 *
 * The mocked Prisma client above accepts a field of ANY name — that is what let
 * `isAnonymized` / `anonymizedAt` be referenced by this job for months while being
 * declared in no `prisma/schema/*.prisma` file and created by no migration. The
 * unit suite was fully green the whole time; the failure only appeared once
 * `__tests__/integration/pdpa-retention-legal-hold.test.js` reached a real
 * Postgres and the sweep threw.
 *
 * These tests close that gap WITHOUT a database: they run the real job against the
 * mock, harvest the column names it actually asked for, and check each one against
 * the Prisma schema and the migration SQL. Both sides are parsed, never restated,
 * so the schema stays the single source of truth (the project rules 3.6) and a future
 * column invented in the job — or declared in the schema but never migrated —
 * fails here instead of at 02:30 in production.
 */
describe('[R-HOTFIX-PDPA] the sweep names only columns that really exist', () => {
    const SCHEMA_FILE = path.resolve(__dirname, '../../prisma/schema/auth.prisma');
    const MIGRATIONS_DIR = path.resolve(__dirname, '../../prisma/migrations');

    /**
     * Parse `model User { ... }` out of auth.prisma.
     *
     * @returns {Map<string, { type: string, optional: boolean }>} declared fields
     */
    function userModelFields() {
        const fields = new Map();
        let inside = false;
        for (const raw of fs.readFileSync(SCHEMA_FILE, 'utf8').split('\n')) {
            const line = raw.trim();
            if (!inside) {
                if (/^model\s+User\s*\{/.test(line)) {inside = true;}
                continue;
            }
            if (line === '}') {break;}
            if (!line || line.startsWith('//') || line.startsWith('@@')) {continue;}
            const match = line.match(/^(\w+)\s+(\w+)(\?)?/);
            if (!match) {continue;}
            fields.set(match[1], { type: match[2], optional: match[3] === '?' });
        }
        return fields;
    }

    /** Every migration.sql concatenated — the DDL that a real database has run. */
    function allMigrationSql() {
        let sql = '';
        for (const entry of fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true })) {
            if (!entry.isDirectory()) {continue;}
            const file = path.join(MIGRATIONS_DIR, entry.name, 'migration.sql');
            if (fs.existsSync(file)) {sql += '\n' + fs.readFileSync(file, 'utf8');}
        }
        return sql;
    }

    /**
     * Flatten a Prisma `where` into column -> [predicate values], descending into
     * the boolean combinators so a column hidden inside an `OR` is checked too —
     * which is exactly where `isAnonymized` was hiding.
     *
     * @param {object} node
     * @param {Map<string, unknown[]>} out
     * @returns {Map<string, unknown[]>}
     */
    function collectFilterKeys(node, out = new Map()) {
        for (const [key, value] of Object.entries(node || {})) {
            if (key === 'OR' || key === 'AND' || key === 'NOT') {
                for (const branch of Array.isArray(value) ? value : [value]) {
                    collectFilterKeys(branch, out);
                }
                continue;
            }
            if (!out.has(key)) {out.set(key, []);}
            out.get(key).push(value);
        }
        return out;
    }

    let whereArg;
    let selectArg;
    let dataArg;

    beforeAll(async () => {
        mockFindMany.mockReset();
        mockUpdate.mockReset();
        mockFindMany
            .mockResolvedValueOnce([
                { id: 'u1', healthId: '1100100100011', providerId: null, retainUntil: PAST, legalHold: false },
            ])
            .mockResolvedValueOnce([]);
        mockUpdate.mockResolvedValue(undefined);

        await runPdpaRetentionSweep();

        whereArg = mockFindMany.mock.calls[0][0].where;
        selectArg = mockFindMany.mock.calls[0][0].select;
        dataArg = mockUpdate.mock.calls[0][0].data;
    });

    it('every column in the WHERE clause is declared on model User', () => {
        const declared = userModelFields();
        const undeclared = [...collectFilterKeys(whereArg).keys()].filter((c) => !declared.has(c));
        expect(undeclared).toEqual([]);
    });

    it('every column in the SELECT clause is declared on model User', () => {
        const declared = userModelFields();
        const undeclared = Object.keys(selectArg).filter((c) => !declared.has(c));
        expect(undeclared).toEqual([]);
    });

    it('every column the anonymization payload writes is declared on model User', () => {
        const declared = userModelFields();
        const undeclared = Object.keys(dataArg).filter((c) => !declared.has(c));
        expect(undeclared).toEqual([]);
    });

    it('passes no null predicate to a column the schema declares NOT NULL', () => {
        // Prisma does not treat `null` as "tolerate legacy rows". On a required
        // scalar it is a validation error — "Expected BoolFilter or Boolean,
        // provided null" — raised before the query reaches Postgres. Because this
        // sweep is deliberately fail-closed (no read-side fallback), one such
        // predicate does not degrade the filter: it aborts the entire run, every
        // night, and nothing is ever anonymized. A NOT NULL DEFAULT column has no
        // NULL rows to tolerate in the first place.
        const declared = userModelFields();
        const offenders = [];
        for (const [column, values] of collectFilterKeys(whereArg)) {
            const field = declared.get(column);
            if (!field || field.optional) {continue;}
            if (values.some((value) => value === null)) {offenders.push(column);}
        }
        expect(offenders).toEqual([]);
    });

    it('every column the sweep touches is materialised by a migration, not only declared', () => {
        // A column that exists only in schema.prisma is a column production does
        // not have: this repo deploys with `prisma migrate deploy`, never
        // `db push`. Schema-only drift and no-schema-at-all fail identically at
        // runtime, so both are caught here.
        const sql = allMigrationSql();
        const touched = new Set([
            ...collectFilterKeys(whereArg).keys(),
            ...Object.keys(selectArg),
            ...Object.keys(dataArg),
        ]);
        const missing = [...touched].filter((column) => !sql.includes(`"${column}"`));
        expect(missing).toEqual([]);
    });
});

describe('[Task 10] the same sweep clears pre-check page text', () => {
    beforeEach(() => {
        mockFindMany.mockReset();
        mockUpdate.mockReset();
        mockPrecheckUpdateMany.mockReset();
        mockPrecheckFlagUpdateMany.mockReset();
        mockPrecheckFindMany.mockReset();
        mockPrecheckFindMany.mockResolvedValue([]);
        mockPrecheckFlagCreate.mockReset();
    });

    const expired = { id: 'u-expired', healthId: '1100100100011', providerId: null, retainUntil: PAST, legalHold: false };

    it('clears extractedText and every evidenceSnippet of the user\'s applications before anonymizing the user', async () => {
        const order = [];
        mockFindMany.mockResolvedValueOnce([expired]).mockResolvedValueOnce([]);
        mockPrecheckFlagUpdateMany.mockImplementation(async () => { order.push('flags'); return { count: 4 }; });
        mockPrecheckUpdateMany.mockImplementation(async () => { order.push('prechecks'); return { count: 2 }; });
        mockUpdate.mockImplementation(async () => { order.push('user'); });

        const stats = await runPdpaRetentionSweep();

        expect(order).toEqual(['flags', 'prechecks', 'user']);
        const precheckArgs = mockPrecheckUpdateMany.mock.calls[0][0];
        expect(precheckArgs.data).toEqual({ extractedText: null });
        expect(precheckArgs.where).toEqual({
            application: { applicant: { id: 'u-expired' }, legalHold: false },
            extractedText: { not: null },
        });
        const flagArgs = mockPrecheckFlagUpdateMany.mock.calls[0][0];
        expect(flagArgs.data).toEqual({ evidenceSnippet: null });
        expect(flagArgs.where).toEqual({
            precheck: { application: { applicant: { id: 'u-expired' }, legalHold: false } },
            evidenceSnippet: { not: null },
        });
        expect(stats.anonymized).toBe(1);
        expect(stats.precheckTextsCleared).toBe(2);
    });

    it('a failed clear leaves the user un-anonymized for the next run — never anonymized with the text still there', async () => {
        mockFindMany.mockResolvedValueOnce([expired]).mockResolvedValueOnce([]);
        mockPrecheckFlagUpdateMany.mockResolvedValue({ count: 0 });
        mockPrecheckUpdateMany.mockRejectedValue(new Error('connection reset'));

        const stats = await runPdpaRetentionSweep();

        expect(mockUpdate).not.toHaveBeenCalled();
        expect(stats.anonymized).toBe(0);
        expect(stats.errors).toBe(1);
        expect(stats.failedUserIds).toEqual(['u-expired']);
    });

    // Final review I3: a job still queued would write the text back after the
    // clear. A still-PENDING row becomes FAILED with the failure flag first.
    it('a pre-check still PENDING is failed (with the failure flag) before the text is cleared', async () => {
        const order = [];
        mockFindMany.mockResolvedValueOnce([expired]).mockResolvedValueOnce([]);
        mockPrecheckFindMany.mockResolvedValue([{ id: 'pc-pending', organizationId: 'org-1' }]);
        mockPrecheckUpdateMany.mockImplementation(async (args) => {
            order.push(args.data.status ? `status:${args.data.status}` : 'prechecks');
            return { count: 1 };
        });
        mockPrecheckFlagCreate.mockImplementation(async () => { order.push('failure-flag'); return {}; });
        mockPrecheckFlagUpdateMany.mockImplementation(async () => { order.push('flags'); return { count: 0 }; });
        mockUpdate.mockImplementation(async () => { order.push('user'); });

        await runPdpaRetentionSweep();

        expect(order).toEqual(['status:FAILED', 'failure-flag', 'flags', 'prechecks', 'user']);
        expect(mockPrecheckFindMany.mock.calls[0][0].where).toEqual({
            application: { applicant: { id: 'u-expired' }, legalHold: false },
            status: 'PENDING',
        });
        expect(mockPrecheckUpdateMany.mock.calls[0][0].where).toEqual({
            application: { applicant: { id: 'u-expired' }, legalHold: false },
            id: 'pc-pending',
            status: 'PENDING',
        });
        expect(mockPrecheckFlagCreate).toHaveBeenCalledWith({
            data: {
                check: 'READABILITY',
                result: 'UNREADABLE',
                reasonTH: 'ตรวจอัตโนมัติไม่สำเร็จ เจ้าหน้าที่จะตรวจเอง',
                confidence: 0,
                precheckId: 'pc-pending',
                organizationId: 'org-1',
            },
        });
    });

    it('a user under legal hold: no pre-check text is touched', async () => {
        mockFindMany.mockResolvedValueOnce([{ ...expired, legalHold: true }]).mockResolvedValueOnce([]);

        await runPdpaRetentionSweep();

        expect(mockPrecheckUpdateMany).not.toHaveBeenCalled();
        expect(mockPrecheckFlagUpdateMany).not.toHaveBeenCalled();
        expect(mockPrecheckFindMany).not.toHaveBeenCalled();
        expect(mockPrecheckFlagCreate).not.toHaveBeenCalled();
    });
});
