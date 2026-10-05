'use strict';

/**
 * A0-AUDIT-EMISSION / PR-A0-2 audit round 1, finding F1 (CRITICAL).
 *
 * THE BUG (present from the moment PR-A0-2 started handing the writer a caller
 * transaction at `applications.js:670` and `application-bundles.js:368`):
 *
 * The writer's work-activity block (`application-status-writer.js:1151-1196`)
 * runs AFTER the status UPDATE, on whatever client the caller supplied, wrapped
 * in a bare `try { … } catch { console.warn }`. That swallow is correct for a
 * BARE client — autocommit, nothing to poison. Inside SOMEBODY ELSE'S
 * transaction it is a trap:
 *
 *   1. `stageActivityConfig.findMany` / `workActivity.findMany` / the
 *      `workActivity` INSERT raises (a P2002 on the partial unique index
 *      `work_activities_open_unique`, an RLS `WITH CHECK` rejection, a lock
 *      timeout — all in-product);
 *   2. Postgres marks the CALLER'S transaction ABORTED (25P02);
 *   3. the writer swallows, logs a warning and RETURNS NORMALLY;
 *   4. the route's `$transaction` callback finishes without throwing, so Prisma
 *      issues COMMIT, and Postgres answers an aborted transaction's COMMIT with
 *      a silent ROLLBACK;
 *   5. the route replies 200 while the status write, both canonical audit rows
 *      and every sibling write have vanished.
 *
 * This is the SAME class PR-A0-1b closed for the audit emission (F1 there), on a
 * different emission — and PR-A0-2 is what made it reachable, because before it
 * the submit hops handed the writer a bare client.
 *
 * WHY A STATEFUL FAKE. A jest.fn `$transaction` that merely invokes its callback
 * has no abort semantics: the swallow looks harmless to it, which is precisely
 * why the PR-A0-2 round-1 suites could not see this. The fake below is the same
 * model `application-status-writer-audit-tx-semantics.test.js` introduced for
 * PR-A0-1b — statements mutate pending state, a failed statement poisons the tx,
 * only `ROLLBACK TO SAVEPOINT` recovers it, and COMMIT on a poisoned tx discards
 * silently without throwing — extended with the `workActivity` /
 * `stageActivityConfig` / `slaPolicy` namespaces this block touches.
 *
 * NOT CLAIMED: this is a model, not Postgres. Clause (2) of INVARIANT A0 stays
 * integration-only (design-decision.md §4:147-155). What is pinned here is that
 * the writer issues the statement sequence that survives a real 25P02, and that
 * "best-effort" means "the business write still commits" rather than "no
 * exception reached the caller".
 */

const path = require('path');

jest.mock('../../services/workflow-transition-service', () => ({
    canTransition: () => true,
    normalizeWorkflowStateInput: (v) => String(v || '').toUpperCase() || null,
}));

jest.mock('../../services/certificate-service', () => ({
    findCertificateForApplication: jest.fn(async () => null),
    generateCertificate: jest.fn(async () => ({ id: 'cert-x', certificateNumber: 'GACP-X' })),
}));

jest.mock('../../services/notification-fanout-service', () => ({
    send: jest.fn(async () => undefined),
}));

// Same faithful-enough audit-logger stand-in as the PR-A0-1b tx-semantics file:
// it performs the two statements the real `logWithin` performs against the
// client it is handed, because what those statements do to the surrounding
// transaction is the whole subject.
jest.mock('../../middleware/audit-logger', () => {
    const mod = {
        auditLogger: {
            logWithin: async (event, tx) => {
                if (!tx || !tx.auditLog || typeof tx.auditLog.create !== 'function') {
                    throw new Error('[audit-logger-fake] logWithin requires a client with auditLog.create');
                }
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(1, 2)`;
                // Test double FOR audit-logger itself — this line IS the
                // `logWithin` internals being modelled (audit-logger.js:625).
                // eslint-disable-next-line gacp/no-direct-audit-or-notification-write
                return tx.auditLog.create({
                    data: {
                        action: event.action,
                        resourceId: event.resourceId,
                        metadata: event.metadata,
                    },
                });
            },
            log: async () => ({ id: 'audit-out-of-band' }),
        },
        AuditCategory: { APPLICATION: 'APPLICATION' },
        AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
        ResourceType: { APPLICATION: 'APPLICATION' },
        statusTransitionAuditHook: ({ tx, metadata = {} } = {}) => (entry) => mod.auditLogger.logWithin({
            category: 'APPLICATION',
            action: entry?.event || 'APPLICATION_STATUS_TRANSITION',
            resourceType: 'APPLICATION',
            resourceId: entry?.applicationId,
            metadata: {
                fromStatus: entry?.fromStatus ?? null,
                toStatus: entry?.toStatus ?? null,
                ...metadata,
            },
        }, tx),
    };
    return mod;
});

const writerPath = path.resolve(__dirname, '../../services/application-status-writer.js');
function loadWriter() {
    jest.resetModules();
    return require(writerPath);
}

const APP_ID = 'app-a0-pr2-f1';
const TRANSITION = 'APPLICATION_STATUS_TRANSITION';

// ---------------------------------------------------------------------------
// Stateful fake Postgres (PR-A0-1b model + the work-activity namespaces)
// ---------------------------------------------------------------------------

function renderSql(strings, values) {
    if (typeof strings === 'string') {return strings.trim();}
    if (Array.isArray(strings)) {
        return strings.map((s, i) => s + (i < values.length ? String(values[i]) : '')).join('').trim();
    }
    return String(strings).trim();
}

const SAVEPOINT_SQL = /^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\s+([A-Za-z_][A-Za-z0-9_]*)$/i;

function abortedTxError() {
    const e = new Error('current transaction is aborted, commands ignored until end of transaction block');
    e.code = '25P02';
    return e;
}

function applyUpdate(row, where, data) {
    if (where && where.version !== undefined && where.version !== row.version) {
        const e = new Error('record required but not found');
        e.code = 'P2025';
        throw e;
    }
    for (const [k, v] of Object.entries(data || {})) {
        if (v && typeof v === 'object' && typeof v.increment === 'number') {
            row[k] = (row[k] || 0) + v.increment;
        } else {
            row[k] = v;
        }
    }
    return { ...row };
}

function makeFakeDb(seed = {}) {
    const db = {
        committed: {
            id: APP_ID,
            status: 'DRAFT',
            version: 1,
            organizationId: 'org-1',
            healthId: 'canon-1',
            ...seed,
        },
        auditRows: [],
        activityRows: [],
        statements: [],
        /** when set, the NEXT stageActivityConfig.findMany throws it */
        failWorkActivityWith: null,
        /**
         * when set, the NEXT workActivity.create throws it. Separate knob from
         * `failWorkActivityWith` because R1 needs the failure to happen on a
         * statement whose caller SWALLOWS it, deeper inside the fenced region.
         */
        failWorkActivityInsertWith: null,
    };
    db.transitionRows = () => db.auditRows.filter((r) => r.action === TRANSITION);

    function beginTx() {
        const state = {
            poisoned: false,
            row: { ...db.committed },
            audit: [],
            activities: [],
            savepoints: [],
        };
        const guard = () => { if (state.poisoned) {throw abortedTxError();} };

        const tx = {
            // No `$transaction` — a Prisma interactive-tx handle has none, and
            // that absence is the writer's discriminator.
            application: {
                update: async ({ where, data }) => {
                    guard();
                    db.statements.push('tx:UPDATE application');
                    return applyUpdate(state.row, where, data);
                },
                findUnique: async () => { guard(); return { ...state.row }; },
            },
            auditLog: {
                create: async ({ data }) => {
                    guard();
                    db.statements.push('tx:INSERT auditLog');
                    const row = { id: `audit-${state.audit.length + 1}`, ...data };
                    state.audit.push(row);
                    return row;
                },
            },
            // ── the namespaces the work-activity block touches ──────────────
            stageActivityConfig: {
                findMany: async () => {
                    guard();
                    if (db.failWorkActivityWith) {
                        // A failed statement aborts the WHOLE transaction.
                        state.poisoned = true;
                        db.statements.push('tx:SELECT stageActivityConfig -> ERROR (tx now aborted)');
                        throw db.failWorkActivityWith;
                    }
                    db.statements.push('tx:SELECT stageActivityConfig');
                    return [{ workType: 'DOC_REVIEW', displayOrder: 1, isActive: true }];
                },
            },
            workActivity: {
                create: async ({ data }) => {
                    guard();
                    if (db.failWorkActivityInsertWith) {
                        state.poisoned = true;
                        db.statements.push('tx:INSERT workActivity -> ERROR (tx now aborted)');
                        throw db.failWorkActivityInsertWith;
                    }
                    db.statements.push('tx:INSERT workActivity');
                    const row = { id: `wa-${state.activities.length + 1}`, ...data };
                    state.activities.push(row);
                    return row;
                },
                createMany: async () => { guard(); db.statements.push('tx:INSERT workActivity (many)'); return { count: 1 }; },
                findMany: async () => { guard(); db.statements.push('tx:SELECT workActivity'); return []; },
                updateMany: async () => { guard(); db.statements.push('tx:UPDATE workActivity'); return { count: 0 }; },
            },
            slaPolicy: {
                findMany: async () => { guard(); db.statements.push('tx:SELECT slaPolicy'); return []; },
            },
            $executeRaw: async (strings, ...values) => {
                const sql = renderSql(strings, values);
                const m = SAVEPOINT_SQL.exec(sql);
                const kind = m ? m[1].toUpperCase() : null;
                if (state.poisoned && kind !== 'ROLLBACK TO SAVEPOINT') {
                    db.statements.push(`tx:${sql} -> 25P02`);
                    throw abortedTxError();
                }
                db.statements.push(`tx:${sql}`);
                if (kind === 'SAVEPOINT') {
                    state.savepoints.push({
                        name: m[2],
                        row: { ...state.row },
                        audit: [...state.audit],
                        activities: [...state.activities],
                    });
                    return 1;
                }
                if (kind === 'ROLLBACK TO SAVEPOINT' || kind === 'RELEASE SAVEPOINT') {
                    let idx = -1;
                    for (let i = state.savepoints.length - 1; i >= 0; i -= 1) {
                        if (state.savepoints[i].name === m[2]) { idx = i; break; }
                    }
                    if (idx === -1) {
                        const e = new Error(`no such savepoint: ${m[2]}`);
                        e.code = '3B001';
                        throw e;
                    }
                    if (kind === 'RELEASE SAVEPOINT') {
                        state.savepoints.splice(idx, 1);
                        return 1;
                    }
                    state.row = { ...state.savepoints[idx].row };
                    state.audit = [...state.savepoints[idx].audit];
                    state.activities = [...state.savepoints[idx].activities];
                    state.savepoints.length = idx + 1;
                    state.poisoned = false; // the recovery Postgres allows
                    return 1;
                }
                return 1;
            },
        };

        return {
            tx,
            commit: () => {
                if (state.poisoned) {
                    db.statements.push('COMMIT -> silently ROLLBACK (tx was aborted)');
                    return;
                }
                db.statements.push('COMMIT');
                db.committed = { ...state.row };
                db.auditRows.push(...state.audit);
                db.activityRows.push(...state.activities);
            },
            rollback: () => { db.statements.push('ROLLBACK'); },
        };
    }

    // Bare-client surface (autocommit per statement) — the standalone shape
    // whose behaviour the F1 fix must NOT change.
    db.client = {
        application: {
            update: async ({ where, data }) => {
                db.statements.push('autocommit:UPDATE application');
                const next = applyUpdate({ ...db.committed }, where, data);
                db.committed = { ...next };
                return next;
            },
            findUnique: async () => ({ ...db.committed }),
        },
        auditLog: {
            create: async ({ data }) => {
                db.statements.push('autocommit:INSERT auditLog');
                const row = { id: `audit-${db.auditRows.length + 1}`, ...data };
                db.auditRows.push(row);
                return row;
            },
        },
        stageActivityConfig: {
            findMany: async () => {
                if (db.failWorkActivityWith) {
                    db.statements.push('autocommit:SELECT stageActivityConfig -> ERROR');
                    throw db.failWorkActivityWith;
                }
                db.statements.push('autocommit:SELECT stageActivityConfig');
                return [{ workType: 'DOC_REVIEW', displayOrder: 1, isActive: true }];
            },
        },
        workActivity: {
            create: async ({ data }) => {
                db.statements.push('autocommit:INSERT workActivity');
                const row = { id: `wa-${db.activityRows.length + 1}`, ...data };
                db.activityRows.push(row);
                return row;
            },
            createMany: async () => { db.statements.push('autocommit:INSERT workActivity (many)'); return { count: 1 }; },
            findMany: async () => { db.statements.push('autocommit:SELECT workActivity'); return []; },
            updateMany: async () => { db.statements.push('autocommit:UPDATE workActivity'); return { count: 0 }; },
        },
        slaPolicy: {
            findMany: async () => { db.statements.push('autocommit:SELECT slaPolicy'); return []; },
        },
        $executeRaw: async (strings, ...values) => {
            const sql = renderSql(strings, values);
            db.statements.push(`autocommit:${sql}`);
            if (SAVEPOINT_SQL.test(sql)) {
                const e = new Error('SAVEPOINT can only be used in transaction blocks');
                e.code = '25P01';
                throw e;
            }
            return 1;
        },
        $transaction: async (fn) => {
            const { tx, commit, rollback } = beginTx();
            db.statements.push('BEGIN');
            let out;
            try {
                out = await fn(tx);
            } catch (e) {
                rollback();
                throw e;
            }
            commit();
            return out;
        },
    };

    return db;
}

function submitHopArgs(client, extra = {}) {
    return {
        prisma: client,
        applicationId: APP_ID,
        fromStatus: 'DRAFT',
        toStatus: 'SUBMITTED',
        actorId: 'user-1',
        actorRole: 'health',
        reason: 'APPLICATION_SUBMITTED',
        autoIssueCertificate: false,
        ...extra,
    };
}

// A P2002 on the partial unique index the work-activity table really carries.
function workActivityConflict() {
    return Object.assign(
        new Error('Unique constraint failed on the fields: (`work_activities_open_unique`)'),
        { code: 'P2002', meta: { target: ['work_activities_open_unique'] } },
    );
}

describe('PR-A0-2 F1 — a failing work-activity emission must not cost the CALLER its transaction', () => {
    let warnSpy;
    let errorSpy;

    beforeEach(() => {
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
        errorSpy.mockRestore();
    });

    test('[harness] the fake reproduces the abort: a failed statement kills the tx and COMMIT discards silently', async () => {
        const db = makeFakeDb();
        db.failWorkActivityWith = workActivityConflict();

        await db.client.$transaction(async (tx) => {
            // Fixture: the FAKE database's abort semantics are the subject here,
            // no production status write is happening.
            // eslint-disable-next-line gacp/no-direct-application-status-write
            await tx.application.update({ where: { id: APP_ID }, data: { status: 'SUBMITTED' } });
            await expect(tx.stageActivityConfig.findMany()).rejects.toMatchObject({ code: 'P2002' });
            await expect(tx.application.findUnique()).rejects.toMatchObject({ code: '25P02' });
        });

        expect(db.committed.status).toBe('DRAFT');
        expect(db.statements).toContain('COMMIT -> silently ROLLBACK (tx was aborted)');
    });

    test('the caller tx survives a failing work-activity emission and the status write COMMITS', async () => {
        const db = makeFakeDb();
        db.failWorkActivityWith = workActivityConflict();
        const { writeApplicationStatus } = loadWriter();

        await db.client.$transaction(async (tx) => {
            await writeApplicationStatus(submitHopArgs(tx));
        });

        // The whole point: the business write is still there.
        expect(db.committed.status).toBe('SUBMITTED');
        expect(db.statements).toContain('COMMIT');
        expect(db.statements).not.toContain('COMMIT -> silently ROLLBACK (tx was aborted)');
        // …and the canonical audit row committed with it.
        expect(db.transitionRows()).toHaveLength(1);
        // …while the work activity itself is the only casualty.
        expect(db.activityRows).toHaveLength(0);
    });

    test('the failing work-activity emission is unwound to a SAVEPOINT (not merely swallowed)', async () => {
        const db = makeFakeDb();
        db.failWorkActivityWith = workActivityConflict();
        const { writeApplicationStatus } = loadWriter();

        await db.client.$transaction(async (tx) => {
            await writeApplicationStatus(submitHopArgs(tx));
        });

        const opened = db.statements.filter((s) => /^tx:SAVEPOINT a0_work_activity$/.test(s));
        const unwound = db.statements.filter((s) => /^tx:ROLLBACK TO SAVEPOINT a0_work_activity$/.test(s));
        expect(opened).toHaveLength(1);
        expect(unwound).toHaveLength(1);
        // the savepoint spellings must agree on both ends
        expect(opened[0].replace('SAVEPOINT ', '')).toContain('a0_work_activity');
    });

    test('a caller tx whose work-activity emission SUCCEEDS keeps the activity and leaves no orphan savepoint', async () => {
        const db = makeFakeDb();
        const { writeApplicationStatus } = loadWriter();

        await db.client.$transaction(async (tx) => {
            await writeApplicationStatus(submitHopArgs(tx));
        });

        expect(db.committed.status).toBe('SUBMITTED');
        expect(db.activityRows.length).toBeGreaterThan(0);
        expect(db.statements).toContain('tx:RELEASE SAVEPOINT a0_work_activity');
        expect(db.statements).toContain('COMMIT');
    });

    test('BOTH submit hops survive: hop 2 still commits after hop 1 tripped the work-activity failure', async () => {
        // The exact shape applications.js:670 now runs — two writer calls in ONE
        // caller tx. Before the fence, hop 1's failure poisoned the tx and hop 2
        // could not even issue its UPDATE.
        const db = makeFakeDb();
        db.failWorkActivityWith = workActivityConflict();
        const { writeApplicationStatus } = loadWriter();

        await db.client.$transaction(async (tx) => {
            await writeApplicationStatus(submitHopArgs(tx));
            await writeApplicationStatus(submitHopArgs(tx, {
                fromStatus: 'SUBMITTED',
                toStatus: 'PENDING_DOC_FEE',
                actorRole: 'system',
            }));
        });

        expect(db.committed.status).toBe('PENDING_DOC_FEE');
        expect(db.transitionRows()).toHaveLength(2);
        expect(db.statements).toContain('COMMIT');
    });

    // ── standalone (bare client) behaviour must be BYTE-FOR-BYTE unchanged ───

    test('[pin] bare client + failing work-activity: no savepoint is attempted, the write still lands', async () => {
        const db = makeFakeDb();
        db.failWorkActivityWith = workActivityConflict();
        const { writeApplicationStatus } = loadWriter();

        await writeApplicationStatus(submitHopArgs(db.client));

        expect(db.committed.status).toBe('SUBMITTED');
        // SAVEPOINT outside a transaction block is an error in Postgres; the
        // fence must not reach for one on a bare client.
        expect(db.statements.some((s) => /SAVEPOINT a0_work_activity/.test(s))).toBe(false);
        expect(db.activityRows).toHaveLength(0);
    });

    // ── R1 (audit round 2, HIGH, PRE-EXISTING) ──────────────────────────────
    //
    // The fence catches what PROPAGATES OUT of `run`. It cannot catch a failure
    // that a collaborator swallows INSIDE the region: the statement has already
    // aborted the transaction, `run` returns normally, and the fence's own
    // `RELEASE SAVEPOINT` is then the statement that hits 25P02.
    //
    // Reachable today through `recordAssignment`
    // (services/assignment-ledger-service.js:83-87 — "Never break the assignment
    // on a ledger failure", `logger.error(...); return null`), which
    // `work-activity-service` calls from inside `createForStage`. The mock below
    // is that swallow, nothing more.
    //
    // THIS CASE PINS TODAY'S BEHAVIOUR, IT DOES NOT FIX IT. The hop is still
    // lost: the caller's COMMIT is still answered with a silent ROLLBACK. What
    // the fix in this commit adds is that the loss is no longer SILENT — the
    // release-catch stops calling it "cosmetic" and emits a grep-able
    // `[fence-release-failed]` marker. The real repair is to lift the swallow
    // out of the fenced region, which is a change to
    // assignment-ledger-service.js (out of this PR's scope, filed in
    // the backlog). When that lands, this case is the RED that is already
    // waiting: flip the two `committed`/`COMMIT` expectations.
    test('[pin] R1 — a swallow NESTED inside the region poisons the tx anyway; RELEASE fails and says so', async () => {
        const db = makeFakeDb();
        db.failWorkActivityInsertWith = Object.assign(
            new Error('Unique constraint failed (assignment ledger insert)'),
            { code: 'P2002' },
        );

        // The nested swallow, modelled on assignment-ledger-service.js:83-87.
        jest.doMock('../../services/work-activity-service', () => ({
            createForStage: async ({ prisma: client }) => {
                try {
                    await client.workActivity.create({ data: { workType: 'DOC_REVIEW' } });
                } catch (_ledgerError) {
                    // "Never break the assignment on a ledger failure" — and in
                    // doing so, never let the fence hear about it either.
                }
                return [];
            },
        }));
        const { writeApplicationStatus } = loadWriter();

        await db.client.$transaction(async (tx) => {
            await writeApplicationStatus(submitHopArgs(tx));
        });

        // 1. The fence opened, and its RELEASE was rejected by the poisoned tx.
        expect(db.statements).toContain('tx:SAVEPOINT a0_work_activity');
        expect(db.statements).toContain('tx:RELEASE SAVEPOINT a0_work_activity -> 25P02');
        // 2. No unwind happened — the fence never saw an error to unwind.
        expect(db.statements).not.toContain('tx:ROLLBACK TO SAVEPOINT a0_work_activity');
        // 3. CURRENT BEHAVIOUR, pinned: the hop is silently lost.
        expect(db.committed.status).toBe('DRAFT');
        expect(db.statements).toContain('COMMIT -> silently ROLLBACK (tx was aborted)');
        // 4. THE FIX IN THIS COMMIT: the loss is announced with a grep-able
        //    marker instead of being logged as "non-fatal".
        const warned = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
        expect(warned).toContain('[fence-release-failed]');
        expect(warned).toContain('a0_work_activity');
    });

    test('[pin] bare client, happy path: the activity is created, still no savepoint', async () => {
        const db = makeFakeDb();
        const { writeApplicationStatus } = loadWriter();

        await writeApplicationStatus(submitHopArgs(db.client));

        expect(db.committed.status).toBe('SUBMITTED');
        expect(db.activityRows.length).toBeGreaterThan(0);
        expect(db.statements.some((s) => /SAVEPOINT a0_work_activity/.test(s))).toBe(false);
    });
});
