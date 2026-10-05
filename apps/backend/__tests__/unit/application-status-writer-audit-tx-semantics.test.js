/**
 * A0-AUDIT-EMISSION / PR-A0-1b — transaction semantics of the audit-by-default
 * writer, against a STATEFUL fake Postgres.
 *
 * Why this file exists (adversarial audit of PR-A0-1, findings F1/F2/F3/F5):
 *   F2 — the sibling unit file's "fail-open CALLER tx" case asserted only that
 *        the writer does not throw. A swallowed audit INSERT inside somebody
 *        else's transaction does not throw either: Postgres marks the tx
 *        ABORTED (25P02) and answers the caller's COMMIT with a silent
 *        ROLLBACK. "Did not throw" therefore passes while the business write is
 *        being destroyed — the assertion could not see the bug.
 *   F5 — a `$transaction` stub that merely invokes its callback has no rollback
 *        semantics, so "internal tx unwound then re-applied" and "the UPDATE was
 *        applied twice" look identical to it.
 *
 * The fake below is the smallest model that makes those two distinguishable:
 *   • statements mutate PENDING state; only COMMIT publishes it;
 *   • a failed statement POISONS the tx — every later command raises 25P02 …
 *   • … except ROLLBACK TO SAVEPOINT, which is exactly the escape hatch
 *     Postgres gives and the one F1's fix is required to use;
 *   • COMMIT on a poisoned tx does NOT throw — it silently discards, which is
 *     the failure mode the finding names.
 *
 * Not claimed here: this is still a model, not Postgres. Clause (2)/(4) of
 * INVARIANT A0 (design-decision.md §4) stay integration-only. What this file
 * pins is that the WRITER issues the statement sequence that survives a real
 * 25P02, and that its fail-open promise means "the business write commits",
 * not merely "no exception reached the caller".
 */

'use strict';

const path = require('path');

// ---------------------------------------------------------------------------
// Collaborators stubbed at the module boundary.
// ---------------------------------------------------------------------------

jest.mock('../../services/workflow-transition-service', () => ({
    canTransition: () => true,
    normalizeWorkflowStateInput: (v) => String(v || '').toUpperCase() || null,
}));

const mockCertState = {
    findCertificateForApplication: jest.fn(async () => null),
    generateCertificate: jest.fn(async () => ({ id: 'cert-x', certificateNumber: 'GACP-X' })),
};
jest.mock('../../services/certificate-service', () => ({
    findCertificateForApplication: (...a) => mockCertState.findCertificateForApplication(...a),
    generateCertificate: (...a) => mockCertState.generateCertificate(...a),
}));

// F-CERT-SOD (2026-09-10): the cert hook moved off AUDIT_PASSED onto APPROVED, so the
// hop these cases drive moved with it — what they prove (the hook's tx semantics) is
// unchanged. The AUDIT_PASSED branch lazy-requires the fanout; keep it hermetic (and off
// the real prisma client) — it is not the subject of this file.
jest.mock('../../services/notification-fanout-service', () => ({
    send: jest.fn(async () => undefined),
}));

/**
 * Faithful-enough stand-in for middleware/audit-logger. Unlike the sibling
 * file's inert jest.fn, this one performs the SAME two statements the real
 * `logWithin` performs against the client it is handed (audit-logger.js:606
 * advisory lock → :625 `tx.auditLog.create`), because the whole question here
 * is what those statements do to the surrounding transaction.
 * Not modelled (irrelevant to tx semantics): tenant resolution, hash-chain
 * tail read, sequence numbering.
 */
jest.mock('../../middleware/audit-logger', () => {
    const mod = {
        auditLogger: {
            logWithin: async (event, tx) => {
                if (!tx || typeof tx !== 'object' || !tx.auditLog || typeof tx.auditLog.create !== 'function') {
                    throw new Error('[audit-logger-fake] logWithin requires a client with auditLog.create');
                }
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(1, 2)`;
                // Test double FOR audit-logger itself — this line IS the
                // `logWithin` internals being modelled (audit-logger.js:625),
                // not a call site that should be routed through audit-logger.
                // eslint-disable-next-line gacp/no-direct-audit-or-notification-write
                return tx.auditLog.create({
                    data: {
                        category: event.category,
                        action: event.action,
                        severity: event.severity,
                        actorId: event.actorId,
                        actorRole: event.actorRole,
                        resourceType: event.resourceType,
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
        // Mirrors audit-logger.js:834-850 exactly.
        statusTransitionAuditHook: ({ tx, metadata = {} } = {}) => (entry) => mod.auditLogger.logWithin({
            category: 'APPLICATION',
            action: entry?.event || 'APPLICATION_STATUS_TRANSITION',
            severity: 'INFO',
            actorId: entry?.actorId || 'SYSTEM',
            actorRole: entry?.actorRole || 'UNKNOWN',
            resourceType: 'APPLICATION',
            resourceId: entry?.applicationId,
            metadata: {
                fromStatus: entry?.fromStatus ?? null,
                toStatus: entry?.toStatus ?? null,
                reason: entry?.reason ?? null,
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

const APP_ID = 'app-a0-1b';
const TRANSITION = 'APPLICATION_STATUS_TRANSITION';

// ---------------------------------------------------------------------------
// Stateful fake Postgres.
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
        const e = new Error('An operation failed because it depends on one or more records that were required but not found.');
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

/**
 * @param {object} seed initial committed row
 * @returns a bare-client-shaped handle plus inspection state.
 */
function makeFakeDb(seed = {}) {
    const db = {
        committed: {
            id: APP_ID,
            status: 'SUBMITTED',
            version: 1,
            organizationId: 'org-1',
            healthId: 'canon-1',
            ...seed,
        },
        auditRows: [],
        statements: [],
        /** when set, the NEXT auditLog.create throws it (and aborts any tx) */
        failAuditInsertWith: null,
    };

    db.transitionRows = () => db.auditRows.filter((r) => r.action === TRANSITION);
    db.transitions = () => db.transitionRows().map((r) => [r.metadata.fromStatus, r.metadata.toStatus]);

    function beginTx() {
        const state = {
            poisoned: false,
            row: { ...db.committed },
            audit: [],
            savepoints: [],
        };
        const guard = () => { if (state.poisoned) {throw abortedTxError();} };

        const tx = {
            // NOTE: deliberately no `$transaction` — a Prisma interactive-tx
            // handle has none, and that absence is the writer's discriminator.
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
                    if (db.failAuditInsertWith) {
                        // Postgres aborts the WHOLE transaction on a failed
                        // statement; only ROLLBACK TO SAVEPOINT can recover it.
                        state.poisoned = true;
                        db.statements.push('tx:INSERT auditLog -> ERROR (tx now aborted)');
                        throw db.failAuditInsertWith;
                    }
                    db.statements.push('tx:INSERT auditLog');
                    const row = { id: `audit-${state.audit.length + 1}`, ...data };
                    state.audit.push(row);
                    return row;
                },
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
                    state.savepoints.push({ name: m[2], row: { ...state.row }, audit: [...state.audit] });
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
                    state.savepoints.length = idx + 1; // the savepoint stays established
                    state.poisoned = false;            // ← the recovery Postgres allows
                    return 1;
                }
                return 1;
            },
        };

        return {
            tx,
            commit: () => {
                if (state.poisoned) {
                    // Postgres answers COMMIT with ROLLBACK on an aborted tx —
                    // no error reaches the caller, the work is simply gone.
                    db.statements.push('COMMIT -> silently ROLLBACK (tx was aborted)');
                    return;
                }
                db.statements.push('COMMIT');
                db.committed = { ...state.row };
                db.auditRows.push(...state.audit);
            },
            rollback: () => { db.statements.push('ROLLBACK'); },
        };
    }

    // Bare-client surface (autocommit per statement).
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
                if (db.failAuditInsertWith) {
                    db.statements.push('autocommit:INSERT auditLog -> ERROR');
                    throw db.failAuditInsertWith;
                }
                db.statements.push('autocommit:INSERT auditLog');
                const row = { id: `audit-${db.auditRows.length + 1}`, ...data };
                db.auditRows.push(row);
                return row;
            },
        },
        $executeRaw: async (strings, ...values) => {
            const sql = renderSql(strings, values);
            db.statements.push(`autocommit:${sql}`);
            if (SAVEPOINT_SQL.test(sql)) {
                // Real Postgres refuses savepoints outside a transaction block.
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

function baseArgs(prisma, extra = {}) {
    return {
        prisma,
        applicationId: APP_ID,
        fromStatus: 'SUBMITTED',
        toStatus: 'PENDING_DOC_FEE',
        actorId: 'user-1',
        actorRole: 'health',
        reason: 'phase1 submit',
        ...extra,
    };
}

describe('application-status-writer — tx semantics on a stateful fake Postgres (PR-A0-1b)', () => {
    let warnSpy;
    let errorSpy;

    beforeEach(() => {
        mockCertState.findCertificateForApplication = jest.fn(async () => null);
        mockCertState.generateCertificate = jest.fn(async () => ({ id: 'cert-x', certificateNumber: 'GACP-X' }));
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
        errorSpy.mockRestore();
    });

    // ------------------------------------------------------ harness fidelity

    test('[harness] a failed INSERT aborts the tx and COMMIT silently rolls it back', async () => {
        const db = makeFakeDb();
        db.failAuditInsertWith = Object.assign(new Error('P2002 sequenceNumber'), { code: 'P2002' });

        await db.client.$transaction(async (tx) => {
            // Fixture: these statements exercise the FAKE database's abort
            // semantics — no production status write is happening here.
            // eslint-disable-next-line gacp/no-direct-application-status-write
            await tx.application.update({ where: { id: APP_ID }, data: { status: 'PENDING_DOC_FEE' } });
            // eslint-disable-next-line gacp/no-direct-audit-or-notification-write
            await expect(tx.auditLog.create({ data: { action: TRANSITION } })).rejects.toThrow('P2002');
            // every later command in the same tx now fails …
            // eslint-disable-next-line gacp/no-direct-application-status-write
            await expect(tx.application.update({ where: { id: APP_ID }, data: { status: 'X' } }))
                .rejects.toMatchObject({ code: '25P02' });
        });

        // … and the COMMIT threw nothing while destroying the business write.
        expect(db.committed.status).toBe('SUBMITTED');
        expect(db.statements).toContain('COMMIT -> silently ROLLBACK (tx was aborted)');
    });

    test('[harness] ROLLBACK TO SAVEPOINT clears the abort and keeps pre-savepoint work', async () => {
        const db = makeFakeDb();
        db.failAuditInsertWith = new Error('P2002 sequenceNumber');

        await db.client.$transaction(async (tx) => {
            // Fixture: same as above — the fake database is the subject.
            // eslint-disable-next-line gacp/no-direct-application-status-write
            await tx.application.update({ where: { id: APP_ID }, data: { status: 'PENDING_DOC_FEE' } });
            await tx.$executeRaw`SAVEPOINT probe_sp`;
            // eslint-disable-next-line gacp/no-direct-audit-or-notification-write
            await expect(tx.auditLog.create({ data: { action: TRANSITION } })).rejects.toThrow('P2002');
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT probe_sp`;
            // usable again
            await tx.application.update({ where: { id: APP_ID }, data: { version: { increment: 1 } } });
        });

        expect(db.committed.status).toBe('PENDING_DOC_FEE');
        expect(db.auditRows).toHaveLength(0);
        expect(db.statements).toContain('COMMIT');
    });

    // ------------------------------------------------------------------- F1

    test('[F1] audit INSERT failure inside a CALLER tx must not cost the business write', async () => {
        const { writeApplicationStatus } = loadWriter();
        const db = makeFakeDb();
        db.failAuditInsertWith = Object.assign(new Error('P2002 sequenceNumber'), { code: 'P2002' });

        await db.client.$transaction(async (tx) => {
            await writeApplicationStatus(baseArgs(tx));
        });

        // fail-OPEN means the status write COMMITS without an audit row —
        // not "the writer returned quietly while the tx died".
        expect(db.committed.status).toBe('PENDING_DOC_FEE');
        expect(db.committed.version).toBe(2);
        expect(db.transitionRows()).toHaveLength(0);
        expect(db.statements).toContain('COMMIT');
        expect(db.statements).not.toContain('COMMIT -> silently ROLLBACK (tx was aborted)');
        expect(warnSpy).toHaveBeenCalled();
    });

    test('[F1] the caller can keep working in its tx after a failed emission (mint-cert style hop)', async () => {
        const { writeApplicationStatus } = loadWriter();
        const db = makeFakeDb();
        db.failAuditInsertWith = new Error('audit backend down');

        // Shape of auditor-audit-decision-handler.js:252 — the writer call is
        // one statement among several inside the caller's transaction.
        await db.client.$transaction(async (tx) => {
            await tx.application.update({ where: { id: APP_ID }, data: { reviewerId: 'before-writer' } });
            await writeApplicationStatus(baseArgs(tx, { fromStatus: 'AUDIT_PASSED', toStatus: 'APPROVED', autoIssueCertificate: false }));
            await tx.application.update({ where: { id: APP_ID }, data: { updatedBy: 'after-writer' } });
        });

        expect(db.committed).toMatchObject({
            status: 'APPROVED',
            reviewerId: 'before-writer',
            updatedBy: 'after-writer',
        });
    });

    test('[F1] a caller tx that is NOT poisoned still gets its row, committed with the status write', async () => {
        const { writeApplicationStatus } = loadWriter();
        const db = makeFakeDb();

        await db.client.$transaction(async (tx) => {
            await writeApplicationStatus(baseArgs(tx));
        });

        expect(db.committed.status).toBe('PENDING_DOC_FEE');
        expect(db.transitions()).toEqual([['SUBMITTED', 'PENDING_DOC_FEE']]);
        const order = db.statements.filter((s) => ['BEGIN', 'tx:UPDATE application', 'tx:INSERT auditLog', 'COMMIT'].includes(s));
        expect(order).toEqual(['BEGIN', 'tx:UPDATE application', 'tx:INSERT auditLog', 'COMMIT']);
    });

    test('[F1] the caller tx is never left holding an orphan savepoint on success', async () => {
        const { writeApplicationStatus } = loadWriter();
        const db = makeFakeDb();

        await db.client.$transaction(async (tx) => {
            await writeApplicationStatus(baseArgs(tx));
        });

        const sp = db.statements.filter((s) => /SAVEPOINT/.test(s));
        // Either no savepoint at all, or one that was released — never an
        // unbalanced SAVEPOINT left open for the caller to trip over.
        const opened = sp.filter((s) => /^tx:SAVEPOINT /.test(s)).length;
        const closed = sp.filter((s) => /^tx:(RELEASE|ROLLBACK TO) SAVEPOINT /.test(s)).length;
        expect(closed).toBe(opened);
    });

    // ------------------------------------------------------------------- F5

    // ── the backlog — the CALLER-OWNED emitter had no fence ──────────
    //
    // The default emitter has been fenced since F1. `onAudit` — the callback a
    // caller supplies so the audit row joins ITS transaction — was not. Its
    // try/catch swallows the JavaScript error, which reads like safety and is
    // not: when the callback's INSERT fails inside the caller's tx, Postgres has
    // already marked that tx ABORTED (25P02). Catching the exception does not
    // un-abort it. Every later statement raises, and the caller's COMMIT is
    // answered with a silent ROLLBACK — the business write is destroyed while
    // the writer reports success.
    //
    // Same class as F1, same fix: the emission runs behind a SAVEPOINT.
    test('[B81] a failing caller-owned onAudit must not cost the business write', async () => {
        const { writeApplicationStatus } = loadWriter();
        const db = makeFakeDb();

        // The INSERT must really fail, or the tx is never poisoned and this case
        // passes for the wrong reason — the exact F2 trap this file was written
        // about ("did not throw" is not "the business write survived").
        db.failAuditInsertWith = Object.assign(new Error('P2002 sequenceNumber'), { code: 'P2002' });

        await db.client.$transaction(async (tx) => {
            await writeApplicationStatus(baseArgs(tx, {
                // The shape a caller supplies: the row joins the caller's tx, so
                // its failure poisons that tx rather than some private one.
                onAudit: async (payload) => {
                    await tx.auditLog.create({ data: { action: payload.event } });
                },
            }));
        });

        expect(db.committed.status).toBe('PENDING_DOC_FEE');
        expect(db.committed.version).toBe(2);
        expect(db.statements).toContain('COMMIT');
        expect(db.statements).not.toContain('COMMIT -> silently ROLLBACK (tx was aborted)');
    });

    test('[B81] the caller can keep working in its tx after its own onAudit failed', async () => {
        const { writeApplicationStatus } = loadWriter();
        const db = makeFakeDb();
        db.failAuditInsertWith = new Error('audit backend down');

        await db.client.$transaction(async (tx) => {
            await writeApplicationStatus(baseArgs(tx, {
                onAudit: async (payload) => {
                    await tx.auditLog.create({ data: { action: payload.event } });
                },
            }));
            // If the emission poisoned the tx this statement raises 25P02.
            await tx.application.update({ where: { id: APP_ID }, data: { updatedBy: 'after-writer' } });
        });

        expect(db.committed).toMatchObject({ status: 'PENDING_DOC_FEE', updatedBy: 'after-writer' });
    });

    test('[B81] a successful onAudit leaves no orphan savepoint behind', async () => {
        const { writeApplicationStatus } = loadWriter();
        const db = makeFakeDb();

        await db.client.$transaction(async (tx) => {
            await writeApplicationStatus(baseArgs(tx, {
                onAudit: async (payload) => { await tx.auditLog.create({ data: { action: payload.event } }); },
            }));
        });

        const opened = db.statements.filter((s) => /^tx:SAVEPOINT /.test(s)).length;
        const closed = db.statements.filter((s) => /^tx:(RELEASE|ROLLBACK TO) SAVEPOINT /.test(s)).length;
        expect(opened).toBe(closed);
    });

    test('[F5] bare client + failing emission: the internal tx is unwound and the UPDATE re-applied EXACTLY once', async () => {
        const { writeApplicationStatus } = loadWriter();
        const db = makeFakeDb();
        db.failAuditInsertWith = new Error('P2002 sequenceNumber');

        const updated = await writeApplicationStatus(baseArgs(db.client));

        expect(updated).toMatchObject({ id: APP_ID, status: 'PENDING_DOC_FEE' });
        expect(db.committed.status).toBe('PENDING_DOC_FEE');
        // version 1 → 2. THREE would mean the rolled-back tx UPDATE also stuck
        // (i.e. "applied twice"), which the old $transaction stub could not see.
        expect(db.committed.version).toBe(2);
        expect(db.auditRows).toHaveLength(0);
        expect(db.statements.filter((s) => s === 'tx:UPDATE application')).toHaveLength(1);
        expect(db.statements.filter((s) => s === 'autocommit:UPDATE application')).toHaveLength(1);
        // The internal tx is ABORTED on purpose (the writer throws out of its
        // own callback) — it must never be allowed to reach a COMMIT while
        // poisoned, which is where a silent rollback would hide.
        expect(db.statements).toContain('ROLLBACK');
        expect(db.statements).not.toContain('COMMIT');
        expect(db.statements).not.toContain('COMMIT -> silently ROLLBACK (tx was aborted)');
    });

    test('[F5] bare client happy path: UPDATE and audit row land in the SAME commit, version +1', async () => {
        const { writeApplicationStatus } = loadWriter();
        const db = makeFakeDb();

        await writeApplicationStatus(baseArgs(db.client));

        expect(db.committed).toMatchObject({ status: 'PENDING_DOC_FEE', version: 2 });
        expect(db.transitions()).toEqual([['SUBMITTED', 'PENDING_DOC_FEE']]);
        expect(db.statements.filter((s) => s === 'autocommit:UPDATE application')).toHaveLength(0);
        const order = db.statements.filter((s) => ['BEGIN', 'tx:UPDATE application', 'tx:INSERT auditLog', 'COMMIT'].includes(s));
        expect(order).toEqual(['BEGIN', 'tx:UPDATE application', 'tx:INSERT auditLog', 'COMMIT']);
    });

    // ------------------------------------------------------------------- F3

    test('[F3] cert-hook failure in DEFAULT mode emits the compensating reversal row', async () => {
        const { writeApplicationStatus } = loadWriter();
        const db = makeFakeDb();
        mockCertState.generateCertificate = jest.fn(async () => { throw new Error('cert mint exploded'); });

        await expect(
            writeApplicationStatus(baseArgs(db.client, { fromStatus: 'AUDIT_PASSED', toStatus: 'APPROVED' })),
        ).rejects.toMatchObject({ code: 'CERT_AUTO_GEN_FAILED' });

        // The status was reverted, so the forward row must not be left standing
        // alone: without the reversal row the trail claims a hop that never was.
        expect(db.committed.status).toBe('AUDIT_PASSED');
        expect(db.transitions()).toEqual([
            ['AUDIT_PASSED', 'APPROVED'],
            ['APPROVED', 'AUDIT_PASSED'],
        ]);
        expect(db.transitionRows()[1].metadata.reason).toBe('APPROVED_ROLLBACK_CERT_FAILURE');
        // the pre-existing defence-in-depth row is unchanged by this fix
        expect(db.auditRows.filter((r) => r.action === 'CERT_AUTO_GEN_ROLLBACK')).toHaveLength(1);
    });

    test('[F3] cert-hook failure inside a CALLER tx: reversal row emitted, caller tx still committable', async () => {
        const { writeApplicationStatus } = loadWriter();
        const db = makeFakeDb();
        mockCertState.generateCertificate = jest.fn(async () => { throw new Error('cert mint exploded'); });

        // The caller catches the wrapped cert error and commits its own repair
        // work — the tx must still be alive for that to be possible.
        await db.client.$transaction(async (tx) => {
            await expect(
                writeApplicationStatus(baseArgs(tx, { fromStatus: 'AUDIT_PASSED', toStatus: 'APPROVED' })),
            ).rejects.toMatchObject({ code: 'CERT_AUTO_GEN_FAILED' });
            await tx.application.update({ where: { id: APP_ID }, data: { updatedBy: 'caller-repair' } });
        });

        expect(db.committed).toMatchObject({ status: 'AUDIT_PASSED', updatedBy: 'caller-repair' });
        expect(db.transitions()).toEqual([
            ['AUDIT_PASSED', 'APPROVED'],
            ['APPROVED', 'AUDIT_PASSED'],
        ]);
    });

    // ── the backlog — the ROLLBACK path's onAudit had no fence ───────
    //
    // This one is worse than B81. It runs inside `catch (certError)`, immediately
    // after the UPDATE that reverts the application to its previous status. If the
    // caller-owned audit INSERT poisons the transaction there, that revert is
    // discarded along with it — the certificate was not minted AND the application
    // is left sitting at AUDIT_PASSED, a state its own history says it never
    // legitimately reached. A compensating write that can be silently undone by its
    // own audit row is not a compensation.
    test('[B79] a failing rollback onAudit must not discard the status revert', async () => {
        const { writeApplicationStatus } = loadWriter();
        const db = makeFakeDb();
        mockCertState.generateCertificate = jest.fn(async () => { throw new Error('cert mint exploded'); });
        db.failAuditInsertWith = Object.assign(new Error('P2002 sequenceNumber'), { code: 'P2002' });

        await db.client.$transaction(async (tx) => {
            await expect(
                writeApplicationStatus(baseArgs(tx, {
                    fromStatus: 'AUDIT_PASSED',
                    toStatus: 'APPROVED',
                    onAudit: async (payload) => {
                        await tx.auditLog.create({ data: { action: payload.event } });
                    },
                })),
            ).rejects.toMatchObject({ code: 'CERT_AUTO_GEN_FAILED' });
        });

        // The revert must have survived: the application is back where it started,
        // not stranded at the status the failed mint was for.
        expect(db.committed.status).toBe('AUDIT_PASSED');
        expect(db.statements).not.toContain('COMMIT -> silently ROLLBACK (tx was aborted)');
    });

    test('[B79] the caller can still repair after its rollback onAudit failed', async () => {
        const { writeApplicationStatus } = loadWriter();
        const db = makeFakeDb();
        mockCertState.generateCertificate = jest.fn(async () => { throw new Error('cert mint exploded'); });
        db.failAuditInsertWith = new Error('audit backend down');

        await db.client.$transaction(async (tx) => {
            await expect(
                writeApplicationStatus(baseArgs(tx, {
                    fromStatus: 'AUDIT_PASSED',
                    toStatus: 'APPROVED',
                    onAudit: async (payload) => {
                        await tx.auditLog.create({ data: { action: payload.event } });
                    },
                })),
            ).rejects.toMatchObject({ code: 'CERT_AUTO_GEN_FAILED' });
            await tx.application.update({ where: { id: APP_ID }, data: { updatedBy: 'caller-repair' } });
        });

        expect(db.committed).toMatchObject({ status: 'AUDIT_PASSED', updatedBy: 'caller-repair' });
    });

    // ------------------------------------------------- F-B + audit cycle 2/3

    test('[F-B] bare client: the cert revert and its compensating row commit in ONE internal tx', async () => {
        const { writeApplicationStatus } = loadWriter();
        const db = makeFakeDb();
        mockCertState.generateCertificate = jest.fn(async () => { throw new Error('cert mint exploded'); });

        await expect(
            writeApplicationStatus(baseArgs(db.client, { fromStatus: 'AUDIT_PASSED', toStatus: 'APPROVED' })),
        ).rejects.toMatchObject({ code: 'CERT_AUTO_GEN_FAILED' });

        // Every audit statement — advisory lock included — must sit INSIDE a
        // transaction. The lock in `logWithin` (audit-logger.js:606) is an
        // xact lock: taken in autocommit it is released at the end of that one
        // statement, so the read-tail → assign-sequence → INSERT critical
        // section it exists to serialise (audit-logger.js:593-606) is not
        // serialised at all, and the row is not atomic with the write it
        // describes. Exact stream, three groups: forward write, revert +
        // reversal row, CERT_AUTO_GEN_ROLLBACK marker.
        expect(db.statements).toEqual([
            'BEGIN',
            'tx:UPDATE application',
            'tx:SELECT pg_advisory_xact_lock(1, 2)',
            'tx:INSERT auditLog',
            'COMMIT',
            'BEGIN',
            'tx:UPDATE application',
            'tx:SELECT pg_advisory_xact_lock(1, 2)',
            'tx:INSERT auditLog',
            'COMMIT',
            'BEGIN',
            'tx:SELECT pg_advisory_xact_lock(1, 2)',
            'tx:INSERT auditLog',
            'COMMIT',
        ]);
        expect(db.committed).toMatchObject({ status: 'AUDIT_PASSED', version: 3 });
        expect(db.transitions()).toEqual([
            ['AUDIT_PASSED', 'APPROVED'],
            ['APPROVED', 'AUDIT_PASSED'],
        ]);
    });

    test('[cycle2-3] the CERT_AUTO_GEN_ROLLBACK marker must not poison the caller tx either', async () => {
        const { writeApplicationStatus } = loadWriter();
        const db = makeFakeDb();
        db.failAuditInsertWith = new Error('audit backend down');
        mockCertState.generateCertificate = jest.fn(async () => { throw new Error('cert mint exploded'); });

        await db.client.$transaction(async (tx) => {
            await expect(
                writeApplicationStatus(baseArgs(tx, { fromStatus: 'AUDIT_PASSED', toStatus: 'APPROVED' })),
            ).rejects.toMatchObject({ code: 'CERT_AUTO_GEN_FAILED' });
            // Same class as F1, third emission: the defence-in-depth marker is
            // ALSO an INSERT in a transaction the writer does not own.
            await tx.application.update({ where: { id: APP_ID }, data: { updatedBy: 'caller-repair' } });
        });

        expect(db.committed).toMatchObject({ status: 'AUDIT_PASSED', updatedBy: 'caller-repair' });
        expect(db.auditRows).toHaveLength(0);
        expect(db.statements).toContain('COMMIT');
        expect(db.statements).not.toContain('COMMIT -> silently ROLLBACK (tx was aborted)');
    });

    test('[F3] cert-hook failure with onAudit:false stays silent (tri-state preserved)', async () => {
        const { writeApplicationStatus } = loadWriter();
        const db = makeFakeDb();
        mockCertState.generateCertificate = jest.fn(async () => { throw new Error('cert mint exploded'); });

        await expect(
            writeApplicationStatus(baseArgs(db.client, { fromStatus: 'AUDIT_PASSED', toStatus: 'APPROVED', onAudit: false })),
        ).rejects.toMatchObject({ code: 'CERT_AUTO_GEN_FAILED' });

        expect(db.transitionRows()).toHaveLength(0);
        expect(db.committed.status).toBe('AUDIT_PASSED');
    });

    test('[F3] cert-hook failure with an onAudit callback emits via the callback only (no double row)', async () => {
        const { writeApplicationStatus } = loadWriter();
        const db = makeFakeDb();
        mockCertState.generateCertificate = jest.fn(async () => { throw new Error('cert mint exploded'); });
        const onAudit = jest.fn(async () => undefined);

        await expect(
            writeApplicationStatus(baseArgs(db.client, { fromStatus: 'AUDIT_PASSED', toStatus: 'APPROVED', onAudit })),
        ).rejects.toMatchObject({ code: 'CERT_AUTO_GEN_FAILED' });

        expect(onAudit.mock.calls.map(([e]) => [e.event, e.fromStatus, e.toStatus])).toEqual([
            [TRANSITION, 'AUDIT_PASSED', 'APPROVED'],
            [TRANSITION, 'APPROVED', 'AUDIT_PASSED'],
        ]);
        expect(db.transitionRows()).toHaveLength(0);
    });
});
