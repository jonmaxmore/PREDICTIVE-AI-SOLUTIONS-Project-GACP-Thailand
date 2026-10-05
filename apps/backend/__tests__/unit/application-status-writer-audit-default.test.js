/**
 * A0-AUDIT-EMISSION / PR-A0-1 — `onAudit` tri-state contract of
 * `writeApplicationStatus` (audit-by-default writer).
 *
 * Scope of THIS file (design-decision.md §4 "Unit (mock ได้) เฉพาะสัญญา writer
 * ล้วนๆ ใน PR-1"):
 *   (a) `onAudit` OMITTED  → the writer emits the canonical APPLICATION
 *       transition row itself, bound to the SAME client the status UPDATE ran
 *       on. When the caller handed over a BARE client the writer opens its own
 *       short internal transaction so "audit row in the same tx as the status
 *       write" holds even for callers that never passed a tx.
 *   (b) `onAudit` FUNCTION → byte-for-byte the pre-PR1 behaviour: the callback
 *       fires exactly once and the writer emits NOTHING of its own (no double
 *       row), and it does NOT open an internal transaction.
 *   (c) `onAudit: false`   → deliberate silence: no callback, no default row.
 *
 * Explicitly NOT provable here (design-decision.md §4): atomicity itself.
 * A mock has no transaction semantics, so "the row rolls back with the status
 * UPDATE" is asserted ONLY by the Postgres integration test
 * `__tests__/integration/status-writer-audit-default-invariant.test.js`.
 * What this file pins is the *binding* (which client the emission is handed)
 * and the *shape* of the envelope, not the commit behaviour.
 */

'use strict';

const path = require('path');

// ---------------------------------------------------------------------------
// Lazy-required collaborators of the writer, stubbed at the module boundary.
// ---------------------------------------------------------------------------

const mockWfState = {
    canTransition: () => true,
    normalizeWorkflowStateInput: (v) => String(v || '').toUpperCase() || null,
};
jest.mock('../../services/workflow-transition-service', () => ({
    canTransition: (...args) => mockWfState.canTransition(...args),
    normalizeWorkflowStateInput: (...args) => mockWfState.normalizeWorkflowStateInput(...args),
}));

jest.mock('../../services/certificate-service', () => ({
    findCertificateForApplication: jest.fn(async () => null),
    generateCertificate: jest.fn(async () => ({ id: 'cert-x', certificateNumber: 'GACP-X' })),
}));

// `statusTransitionAuditHook` (middleware/audit-logger.js:834-850) is the SSOT
// for the APPLICATION transition envelope — it is what the 6 callers that
// already pass `onAudit` use. The default emission MUST go through it rather
// than rebuilding a second envelope in the writer (Law 3.6), so the mock
// records both halves: the factory arguments (tx binding + extra metadata) and
// the entry the returned callback is invoked with.
const mockAuditState = {
    logWithin: jest.fn(async () => ({ id: 'audit-row' })),
    log: jest.fn(async () => ({ id: 'audit-row' })),
    hookFactory: jest.fn(),
    hookCallback: jest.fn(async () => ({ id: 'audit-row' })),
};
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: {
        logWithin: (...args) => mockAuditState.logWithin(...args),
        log: (...args) => mockAuditState.log(...args),
    },
    AuditCategory: { APPLICATION: 'APPLICATION' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
    ResourceType: { APPLICATION: 'APPLICATION' },
    statusTransitionAuditHook: (...args) => {
        mockAuditState.hookFactory(...args);
        return (...entry) => mockAuditState.hookCallback(...entry);
    },
}));

const writerPath = path.resolve(__dirname, '../../services/application-status-writer.js');

function loadWriter() {
    jest.resetModules();
    return require(writerPath);
}

const APP_ID = 'app-a0-1';

/**
 * A prisma-shaped stub that CAN carry audit rows (has the `auditLog`
 * namespace) — i.e. what a real client / real tx handle looks like.
 */
function makeAuditCapableClient(label) {
    const client = {
        __label: label,
        application: {
            update: jest.fn(async ({ where, data }) => ({
                id: where.id,
                status: data.status,
                organizationId: 'org-1',
            })),
            findUnique: jest.fn(async () => ({ status: 'SUBMITTED', formData: {} })),
        },
        auditLog: { create: jest.fn(async () => ({ id: 'audit-row' })) },
        // PR-A0-1b / F1: the raw channel the writer needs to fence its default
        // emission with a SAVEPOINT when it is emitting into somebody else's
        // transaction. A real PrismaClient and a real tx handle both expose it.
        $executeRaw: jest.fn(async () => 1),
    };
    return client;
}

/** Flatten the SQL text of every `$executeRaw` tagged-template call. */
function rawSql(executeRawMock) {
    return executeRawMock.mock.calls.map(([strings, ...values]) => (
        Array.isArray(strings)
            ? strings.map((s, i) => s + (i < values.length ? String(values[i]) : '')).join('').trim()
            : String(strings).trim()
    ));
}

/** `SAVEPOINT foo` / `ROLLBACK TO SAVEPOINT foo` → `foo` (null when not a savepoint stmt). */
function savepointName(sql) {
    const m = /^(?:SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(sql);
    return m ? m[1] : null;
}

/** Bare client = has `$transaction` (a Prisma tx handle does not). */
function makeBareClient(txStub) {
    const client = makeAuditCapableClient('bare');
    client.$transaction = jest.fn(async (fn) => fn(txStub));
    return client;
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

describe('application-status-writer — onAudit tri-state / audit-by-default (PR-A0-1)', () => {
    let warnSpy;

    beforeEach(() => {
        mockWfState.canTransition = () => true;
        mockAuditState.logWithin = jest.fn(async () => ({ id: 'audit-row' }));
        mockAuditState.log = jest.fn(async () => ({ id: 'audit-row' }));
        mockAuditState.hookFactory = jest.fn();
        mockAuditState.hookCallback = jest.fn(async () => ({ id: 'audit-row' }));
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    // ---------------------------------------------------------------- (a)

    test('(a) onAudit omitted + bare client → opens an internal tx and emits ONE canonical row bound to that tx', async () => {
        const { writeApplicationStatus } = loadWriter();
        const tx = makeAuditCapableClient('tx');
        const prisma = makeBareClient(tx);

        const updated = await writeApplicationStatus(baseArgs(prisma));

        // status UPDATE ran inside the writer's own transaction …
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(tx.application.update).toHaveBeenCalledTimes(1);
        expect(prisma.application.update).not.toHaveBeenCalled();
        expect(updated).toMatchObject({ id: APP_ID, status: 'PENDING_DOC_FEE' });

        // … and the audit emission was bound to the SAME tx handle.
        expect(mockAuditState.hookFactory).toHaveBeenCalledTimes(1);
        expect(mockAuditState.hookFactory.mock.calls[0][0].tx).toBe(tx);
        expect(mockAuditState.hookCallback).toHaveBeenCalledTimes(1);
    });

    test('(a) envelope: canonical event + transition fields + actorRole in metadata', async () => {
        const { writeApplicationStatus } = loadWriter();
        const tx = makeAuditCapableClient('tx');
        const prisma = makeBareClient(tx);

        await writeApplicationStatus(baseArgs(prisma));

        const entry = mockAuditState.hookCallback.mock.calls[0][0];
        expect(entry).toMatchObject({
            event: 'APPLICATION_STATUS_TRANSITION',
            applicationId: APP_ID,
            fromStatus: 'SUBMITTED',
            toStatus: 'PENDING_DOC_FEE',
            actorId: 'user-1',
            actorRole: 'health',
            reason: 'phase1 submit',
        });
        expect(entry.timestamp).toBeInstanceOf(Date);

        // metadata per design-decision.md §2: {fromStatus,toStatus,reason,actorRole}.
        // from/to/reason are contributed by the SSOT hook itself; actorRole is the
        // writer's extra merge.
        expect(mockAuditState.hookFactory.mock.calls[0][0].metadata)
            .toMatchObject({ actorRole: 'health' });

        // SSOT: the writer must NOT hand-roll a second logWithin envelope for the
        // transition row (that is exactly the drift design §2 rejected).
        expect(mockAuditState.logWithin).not.toHaveBeenCalled();
    });

    test('(a) onAudit omitted + caller-supplied tx handle → emits into the CALLER tx, no nested tx', async () => {
        const { writeApplicationStatus } = loadWriter();
        const callerTx = makeAuditCapableClient('caller-tx'); // no $transaction

        await writeApplicationStatus(baseArgs(callerTx));

        expect(callerTx.application.update).toHaveBeenCalledTimes(1);
        expect(mockAuditState.hookFactory).toHaveBeenCalledTimes(1);
        expect(mockAuditState.hookFactory.mock.calls[0][0].tx).toBe(callerTx);
        expect(mockAuditState.hookCallback).toHaveBeenCalledTimes(1);
    });

    test('(a) client without an auditLog namespace → no internal tx, exactly one UPDATE (legacy stub shape preserved)', async () => {
        const { writeApplicationStatus } = loadWriter();
        const tx = makeAuditCapableClient('tx');
        const prisma = makeBareClient(tx);
        delete prisma.auditLog; // e.g. a unit-test stub that only mocks `application`

        await expect(writeApplicationStatus(baseArgs(prisma))).resolves.toMatchObject({ id: APP_ID });

        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.application.update).toHaveBeenCalledTimes(1);
        expect(tx.application.update).not.toHaveBeenCalled();
    });

    // ---------------------------------------------------------------- (b)

    test('(b) onAudit function → callback fires once, writer emits nothing itself, no internal tx', async () => {
        const { writeApplicationStatus } = loadWriter();
        const tx = makeAuditCapableClient('tx');
        const prisma = makeBareClient(tx);
        const onAudit = jest.fn(async () => undefined);

        await writeApplicationStatus(baseArgs(prisma, { onAudit }));

        expect(onAudit).toHaveBeenCalledTimes(1);
        expect(onAudit.mock.calls[0][0]).toMatchObject({
            event: 'APPLICATION_STATUS_TRANSITION',
            applicationId: APP_ID,
            fromStatus: 'SUBMITTED',
            toStatus: 'PENDING_DOC_FEE',
        });
        // no default emission on top of the caller's callback (no double row) …
        expect(mockAuditState.hookFactory).not.toHaveBeenCalled();
        // … and no behaviour change for the UPDATE path.
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.application.update).toHaveBeenCalledTimes(1);
    });

    test('(b) onAudit function that throws is still swallowed (fail-open unchanged)', async () => {
        const { writeApplicationStatus } = loadWriter();
        const tx = makeAuditCapableClient('tx');
        const prisma = makeBareClient(tx);
        const onAudit = jest.fn(async () => { throw new Error('audit backend down'); });

        await expect(writeApplicationStatus(baseArgs(prisma, { onAudit })))
            .resolves.toMatchObject({ id: APP_ID, status: 'PENDING_DOC_FEE' });
        expect(prisma.application.update).toHaveBeenCalledTimes(1);
    });

    // ---------------------------------------------------------------- (c)

    test('(c) onAudit false → deliberate silence: no callback, no default row, no internal tx', async () => {
        const { writeApplicationStatus } = loadWriter();
        const tx = makeAuditCapableClient('tx');
        const prisma = makeBareClient(tx);

        await writeApplicationStatus(baseArgs(prisma, { onAudit: false }));

        expect(mockAuditState.hookFactory).not.toHaveBeenCalled();
        expect(mockAuditState.logWithin).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.application.update).toHaveBeenCalledTimes(1);
    });

    // ------------------------------------------------------- fail-open policy

    test('fail-open: a failing default emission inside the internal tx still lands the status write', async () => {
        const { writeApplicationStatus } = loadWriter();
        const tx = makeAuditCapableClient('tx');
        const prisma = makeBareClient(tx);
        mockAuditState.hookCallback = jest.fn(async () => { throw new Error('P2002 sequence conflict'); });

        const updated = await writeApplicationStatus(baseArgs(prisma));

        // The internal tx is rolled back (its UPDATE is void), so the writer
        // re-applies the status write on the bare client: availability of the
        // status write must NOT depend on availability of the audit log
        // (application-status-writer.js — "audit failure must NOT block status writes").
        expect(tx.application.update).toHaveBeenCalledTimes(1);
        expect(prisma.application.update).toHaveBeenCalledTimes(1);
        expect(updated).toMatchObject({ id: APP_ID, status: 'PENDING_DOC_FEE' });
        expect(warnSpy).toHaveBeenCalled();
    });

    test('fail-open: a failing default emission inside a CALLER tx is UNWOUND to a savepoint (not merely swallowed)', async () => {
        const { writeApplicationStatus } = loadWriter();
        const callerTx = makeAuditCapableClient('caller-tx');
        mockAuditState.hookCallback = jest.fn(async () => { throw new Error('audit backend down'); });

        await expect(writeApplicationStatus(baseArgs(callerTx)))
            .resolves.toMatchObject({ id: APP_ID, status: 'PENDING_DOC_FEE' });
        expect(callerTx.application.update).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalled();

        // PR-A0-1b / F1 — "did not throw" is NOT the property under test and
        // never was: a failed INSERT leaves the CALLER's transaction ABORTED
        // (25P02), so swallowing it turns the caller's COMMIT into a silent
        // ROLLBACK — fail-closed by accident, which is the opposite of the
        // documented policy. The emission must therefore be fenced by a
        // savepoint the writer rolls back to.
        const sql = rawSql(callerTx.$executeRaw);
        expect(savepointName(sql[0])).toEqual(expect.any(String));
        expect(sql[0]).toMatch(/^SAVEPOINT /i);
        expect(sql[sql.length - 1]).toMatch(/^ROLLBACK TO SAVEPOINT /i);
        // same savepoint on both ends — a mismatched name is a 3B001, i.e. an
        // unrecoverable tx dressed up as a recovery.
        expect(savepointName(sql[sql.length - 1])).toBe(savepointName(sql[0]));
    });

    test('fail-open: a SUCCESSFUL default emission in a CALLER tx releases its savepoint (no orphan)', async () => {
        const { writeApplicationStatus } = loadWriter();
        const callerTx = makeAuditCapableClient('caller-tx');

        await writeApplicationStatus(baseArgs(callerTx));

        const sql = rawSql(callerTx.$executeRaw);
        const opened = sql.filter((s) => /^SAVEPOINT /i.test(s));
        const closed = sql.filter((s) => /^(RELEASE|ROLLBACK TO) SAVEPOINT /i.test(s));
        expect(closed).toHaveLength(opened.length);
        expect(sql.some((s) => /^ROLLBACK TO SAVEPOINT /i.test(s))).toBe(false);
        expect(mockAuditState.hookCallback).toHaveBeenCalledTimes(1);
    });

    // ------------------------------------------------- errors still surface

    test('a real UPDATE failure inside the internal tx is re-thrown, not swallowed as an audit hiccup', async () => {
        const { writeApplicationStatus } = loadWriter();
        const tx = makeAuditCapableClient('tx');
        tx.application.update = jest.fn(async () => {
            const err = new Error('row vanished');
            err.code = 'P2025';
            throw err;
        });
        const prisma = makeBareClient(tx);

        await expect(writeApplicationStatus(baseArgs(prisma, { expectedVersion: 3 })))
            .rejects.toMatchObject({ code: 'CONCURRENCY_CONFLICT' });
        // no fail-open retry for a business error — exactly one attempt
        expect(prisma.application.update).not.toHaveBeenCalled();
    });
});
