/**
 * @module services/application-status-writer
 *
 * Phase A6 / PR-WF-1 — canonical writer for `Application.status`.
 *
 * The workflow audit's #1 finding was that ~92 sites in the codebase
 * call `prisma.application.update({ data: { status: ... } })` directly,
 * which means:
 *   - Workflow legality (e.g. is REGISTERED → PAYMENT_1_PAID even legal?)
 *     is enforced by *convention*, not by code.
 *   - Audit log entries depend on each caller remembering to emit them.
 *   - Concurrent writes can race because there's no row-version check.
 *
 * This module is the single canonical writer. New code MUST use it; old
 * code is migrated PR-by-PR. The companion ESLint rule
 * `gacp/no-direct-application-status-write` (advisory) flags any direct
 * status update so the migration backlog is visible in lint output.
 *
 * The writer is intentionally THIN at landing — it just wraps the
 * existing prisma update + emits an audit row. Validation against the
 * workflow state machine is plugged in via `workflow-transition-service`
 * once the migration moves more sites through this writer (the writer's
 * `opts.assertTransition` flag controls strict mode).
 *
 * Usage:
 *
 *   const { writeApplicationStatus } = require('./application-status-writer');
 *
 *   await writeApplicationStatus({
 *     prisma,                 // Prisma client (or transaction handle)
 *     applicationId: 'abc',
 *     fromStatus: 'REGISTERED',
 *     toStatus: 'SUBMITTED',
 *     actorId: 'user-123',
 *     actorRole: 'health',
 *     reason: 'phase1 payment confirmed',
 *     additionalData: {       // optional — extra fields written in same UPDATE
 *       phase1Status: 'PAID',
 *     },
 *     onAudit: async (entry) => { // optional — caller-provided audit emitter
 *       await auditLogger.log({ category: 'APPLICATION', ...entry });
 *     },
 *   });
 *
 * Transactional safety: the caller is expected to pass either the bare
 * `prisma` client OR a `prisma.$transaction(...)` callback's `tx` so the
 * UPDATE + audit-row INSERT happen atomically.
 *
 * A0-AUDIT-EMISSION / PR-A0-1 — audit emission is **on by default**.
 * `onAudit` is TRI-STATE:
 *   - OMITTED (undefined/null) → the writer emits the canonical APPLICATION
 *     transition row itself, through `statusTransitionAuditHook` (the same
 *     envelope the callback-passing callers already use), bound to the same
 *     client the status UPDATE ran on. When the caller handed over a BARE
 *     client the writer opens a short internal transaction so the invariant
 *     "audit row commits with the status write" holds even for callers that
 *     never passed a tx.
 *   - FUNCTION → unchanged pre-PR1 behaviour: the callback owns the row and
 *     the writer emits nothing of its own (no double row, no internal tx).
 *   - `false` → deliberate silence. Reserved for call sites that write their
 *     OWN canonical row in the same transaction (routes/api/admin/
 *     applications.js:312 does its `auditLogger.logWithin` inline) and for dev
 *     scripts that must not pollute the chain. `false` is the ONLY opt-out —
 *     "forgot to pass one" can no longer mean "no audit trail", which was the
 *     A0 finding (16 live status-writing hops with no row at all).
 *
 * Why the writer, not 24 call sites: the same argument the cert hook settled
 * (see the R2-D comment further down — four write paths, only one of them ran
 * cert-gen). A per-caller fix leaves the NEXT caller born with the same hole.
 * The historical "don't couple the writer to audit-logger" rationale no longer
 * applies: this file already lazy-requires `middleware/audit-logger` and calls
 * `auditLogger.logWithin(event, tx)` in the cert rollback path below.
 *
 * Failure policy is UNCHANGED by PR-A0-1: audit emission stays best-effort
 * (swallow + warn). A status write must never become unavailable because the
 * audit log is; PR-A0-3/PR-A0-4 raise the money/cert hops to fail-closed.
 *
 * PR-A0-1b (F1) — "best-effort" is only true if the swallow is REAL. A failed
 * INSERT marks the surrounding Postgres transaction ABORTED (25P02): every
 * later statement raises, and the caller's COMMIT is answered with a silent
 * ROLLBACK. Catching the rejection therefore does not save the business write
 * when the writer is emitting into SOMEBODY ELSE'S transaction — it converts an
 * audit hiccup into a lost status write with no exception anywhere. The default
 * emission into a caller-supplied tx is consequently fenced by a SAVEPOINT and
 * unwound with ROLLBACK TO SAVEPOINT, which is the one statement Postgres
 * accepts on an aborted transaction. Bare-client callers keep the internal-tx
 * unwind + re-apply path (there is no caller tx to protect there).
 */

'use strict';

let _workflowTransitionService = null;
function getWorkflowTransitionService() {
    if (!_workflowTransitionService) {
        // Lazy require to avoid circular import via service-registry.
         
        _workflowTransitionService = require('./workflow-transition-service');
    }
    return _workflowTransitionService;
}

let _workActivityService = null;
function getWorkActivityService() {
    if (!_workActivityService) {

        _workActivityService = require('./work-activity-service');
    }
    return _workActivityService;
}

// Iter R2 / R2-D — certificate-service is required lazily so the writer
// has no compile-time coupling to its (heavy) prisma + crypto dependency
// tree. The hook is only ever invoked on AUDIT_PASSED transitions so the
// vast majority of writer calls never touch this require path at all.
let _certificateService = null;
function getCertificateService() {
    if (!_certificateService) {

        _certificateService = require('./certificate-service');
    }
    return _certificateService;
}

// Iter R3 / R3-D — audit-logger is required lazily for the same reason as
// certificate-service: only the cert-auto-gen rollback branch reaches for
// it, and pulling the middleware tree on every status write would add
// startup cost for no benefit. Per I-003, the rollback emits its audit row
// via `logWithin(event, tx)` so it commits atomically with the status
// revert (when the caller passed a tx handle as `args.prisma`).
// R3 review M-2: also surface the AuditCategory/Severity/ResourceType enum
// exports so the call site can reference them by name (not raw strings),
// matching the canonical pattern in routes/api/admin/applications.js.
let _auditModule = null;
function getAuditModule() {
    if (!_auditModule) {

        _auditModule = require('../middleware/audit-logger');
    }
    return _auditModule;
}

// V1-C / D10 — notification fanout is lazy-required for the same reason
// as certificate-service: the AUDIT_PASSED branch is the ONLY caller, so
// the heavier transport / template / redis dependency tree should not be
// loaded on every status write. Failure to require (e.g. test stubs that
// don't mock the module) is swallowed — the notification is best-effort
// per the same contract enforced inside audit-onsite-service / audit-
// scheduling-service.
// The approver notice is lazy for the same reason (AUDIT_PASSED is its only caller).
let _certificationDecisionNotify = null;
function getCertificationDecisionNotify() {
    if (!_certificationDecisionNotify) {
        _certificationDecisionNotify = require('./certification-decision-notify');
    }
    return _certificationDecisionNotify;
}

let _fanoutService = null;
function getFanoutService() {
    if (_fanoutService) {return _fanoutService;}
    try {

        _fanoutService = require('./notification-fanout-service');
    } catch (_e) {
        _fanoutService = null;
    }
    return _fanoutService;
}

// Stages that mean the application is over — any remaining open activities
// for it should be cancelled so they don't sit in someone's queue forever.
const TERMINAL_STATUSES = new Set([
    'REJECTED',
    'EXPIRED',
    'CANCEL_EXPIRED',
    'CERTIFIED',
]);

/**
 * Extract the assigned reviewer id from an application's formData JSON.
 * The writer-routed assign-reviewer paths (admin batch, legacy
 * /assign-reviewer) persist the chosen reviewer into
 * `formData.PROVIDERAssignment.reviewerId` rather than the scalar
 * Application.reviewerId column, so the work-activity pre-assign reads
 * it from here as a fallback. Pure + defensive — returns null on any
 * shape mismatch so a malformed JSON never blocks the status write.
 */
function resolveAssignedReviewerId(formData) {
    if (!formData || typeof formData !== 'object') {return null;}
    const assignment = formData.PROVIDERAssignment;
    if (!assignment || typeof assignment !== 'object') {return null;}
    return assignment.reviewerId || null;
}

/**
 * Vocabulary guard — PR 2b.
 *
 * The ESLint rule made this function the only place `Application.status` is
 * written. It did NOT constrain what gets written: the update was
 * `data: { status: toStatus }` with no validation, so callers kept stamping
 * strings that are not in WORKFLOW_STATES ('PAYMENT_1_PENDING',
 * 'PAYMENT_1_PAID', 'PAYMENT_2_COMPLETED', 'PAYMENT_2_PENDING'). Those rows
 * only read back correctly because STATE_BY_LEGACY_STATUS translates them —
 * which is exactly why that translation table could never be deleted. Current
 * code kept refilling it.
 *
 * Rejects rather than auto-translating. A silent rewrite would leave the
 * caller's bug in place and invisible, and would make the translation table
 * load-bearing again in a new place. The message names the canonical
 * replacement when the SSOT knows one, so the fix is mechanical.
 */
function assertCanonicalStatus(toStatus) {
    const wf = getWorkflowTransitionService();
    const canonical = Array.isArray(wf.WORKFLOW_STATES) ? wf.WORKFLOW_STATES : null;
    if (!canonical) { return; }

    const value = String(toStatus);
    if (canonical.includes(value)) { return; }

    const suggestion = typeof wf.normalizeWorkflowStateInput === 'function'
        ? wf.normalizeWorkflowStateInput(value)
        : null;

    const error = new Error(
        `writeApplicationStatus: "${value}" is not a canonical workflow state.`
        + (suggestion ? ` Write "${suggestion}" instead.` : ' No canonical equivalent is known.')
        + ' Application.status accepts only the states in'
        + ' services/workflow-transition-service.js WORKFLOW_STATES.',
    );
    error.code = 'NON_CANONICAL_STATUS';
    error.attemptedStatus = value;
    error.canonicalStatus = suggestion || null;
    throw error;
}

/**
 * Strict-mode transition guard. Throws if the workflow-transition-service
 * forbids `fromStatus → toStatus` for `actorRole`. Silently permissive when an
 * older transition-service build lacks `canTransition` (the lint rule still
 * surfaces direct writers for migration). Extracted from writeApplicationStatus
 * (refactor 2026-06-05) — pure, no DB/side-effects.
 */
function assertTransitionAllowed(fromStatus, toStatus, actorRole) {
    const wf = getWorkflowTransitionService();
    if (typeof wf.canTransition !== 'function') {return;}
    const allowed = wf.canTransition(fromStatus, toStatus, { actorRole });
    if (!allowed) {
        throw new Error(
            `writeApplicationStatus: illegal transition ${fromStatus} → ${toStatus}`
                + (actorRole ? ` (actorRole=${actorRole})` : ''),
        );
    }
}

// The canonical action name of a status-transition audit row. Single constant so
// the caller-callback envelope and the writer's own default emission can never
// drift into two different action strings (the AuditLog query in every A0
// invariant test filters on exactly this value).
const STATUS_TRANSITION_EVENT = 'APPLICATION_STATUS_TRANSITION';

// Reason code stamped on the compensating row the cert-rollback path emits.
// Single constant so the caller-callback emission and the writer's own default
// emission (PR-A0-1b / F3) cannot drift apart — an operator correlating a
// rolled-back hop greps for exactly one string.
const CERT_ROLLBACK_REASON = 'APPROVED_ROLLBACK_CERT_FAILURE';

// A0 / PR-A0-1 — `onAudit` tri-state (see module docstring).
const AUDIT_EMISSION_CALLBACK = 'callback'; // caller supplied a function
const AUDIT_EMISSION_DEFAULT = 'default';   // writer emits the canonical row
const AUDIT_EMISSION_OFF = 'off';           // explicit, documented silence

/**
 * Resolve the tri-state. `false` is the ONLY opt-out: omitted / null / any
 * other non-function value means "the caller did not bring an emitter", which
 * post-PR-A0-1 means the writer brings one. Making null an opt-out would
 * re-open the exact hole A0 found, because "no emitter" is what 16 live hops
 * were already passing implicitly.
 */
function resolveAuditEmissionMode(onAudit) {
    if (typeof onAudit === 'function') {return AUDIT_EMISSION_CALLBACK;}
    if (onAudit === false) {return AUDIT_EMISSION_OFF;}
    return AUDIT_EMISSION_DEFAULT;
}

/**
 * Can this client carry an audit row at all? A real PrismaClient and a real tx
 * handle both expose `auditLog.create`; the many unit-test stubs that mock only
 * `application` do not. Used to decide whether opening an internal transaction
 * could possibly help — a stub client would otherwise pay a rollback + re-apply
 * round trip on every write for an emission that can never succeed.
 */
function clientCanCarryAuditRows(client) {
    return Boolean(client && client.auditLog && typeof client.auditLog.create === 'function');
}

/**
 * PR-A0-1 default emission. Goes through `statusTransitionAuditHook`
 * (middleware/audit-logger.js) rather than rebuilding the envelope here: that
 * factory is the SSOT the six callback-passing callers already use, so a
 * migrated caller and a default-emitting caller produce the SAME row
 * (category APPLICATION, action APPLICATION_STATUS_TRANSITION, resourceId =
 * applicationId, metadata {fromStatus,toStatus,reason,actorRole}).
 *
 * Throws on failure — every call site decides the swallow policy itself, which
 * is what keeps "fail-open now / fail-closed later (PR-A0-3/4)" a one-line
 * change at the call site rather than a rewrite here.
 */
async function emitDefaultTransitionAudit(client, envelope) {
    const auditMod = getAuditModule();
    if (typeof auditMod.statusTransitionAuditHook !== 'function') {
        throw new TypeError(
            'statusTransitionAuditHook is not exported by middleware/audit-logger — '
            + 'cannot emit the default status-transition audit row',
        );
    }
    const emit = auditMod.statusTransitionAuditHook({
        tx: client,
        // from/to/reason are contributed by the hook itself; actorRole is the
        // writer's addition so the row records WHO moved the application.
        metadata: { actorRole: envelope.actorRole ?? null },
    });
    return emit({
        event: STATUS_TRANSITION_EVENT,
        ...envelope,
        timestamp: new Date(),
    });
}

/**
 * Is this client SOMEBODY ELSE'S open transaction? A Prisma interactive-tx
 * handle exposes the model namespaces but NOT `$transaction`; a bare client
 * does. The writer already keys its internal-transaction decision on exactly
 * this shape (see `useInternalAuditTx` below), so the same discriminator
 * decides whether a failed emission could poison a transaction the writer does
 * not own.
 */
function clientIsTransactionHandle(client) {
    return Boolean(client) && typeof client.$transaction !== 'function';
}

/** Can we speak raw SQL through this client (SAVEPOINT is not a Prisma model op)? */
function clientSupportsSavepoints(client) {
    return Boolean(client) && typeof client.$executeRaw === 'function';
}

/**
 * The savepoint statement triples, one per fenced side-effect.
 *
 * The identifier is written out LITERALLY in all three statements because
 * Prisma's tagged-template `$executeRaw` turns every `${…}` into a BIND
 * PARAMETER, and a bind parameter is not legal where SQL requires an
 * identifier. Keeping the three spellings of each name adjacent is what makes
 * "they agree" checkable by inspection; the unit suites pin it too
 * ("same savepoint on both ends" / the `a0_work_activity` open+unwind pair).
 *
 * Two distinct names, not one shared name: the audit fence and the
 * work-activity fence can be open at different times over the same caller
 * transaction, and re-using one identifier would make an inner unwind silently
 * discard the outer fence's established point.
 */
const FENCE_SAVEPOINTS = {
    audit: {
        label: 'audit',
        name: 'a0_audit_emit',
        open: (c) => c.$executeRaw`SAVEPOINT a0_audit_emit`,
        unwind: (c) => c.$executeRaw`ROLLBACK TO SAVEPOINT a0_audit_emit`,
        release: (c) => c.$executeRaw`RELEASE SAVEPOINT a0_audit_emit`,
    },
    workActivity: {
        label: 'work-activity',
        name: 'a0_work_activity',
        open: (c) => c.$executeRaw`SAVEPOINT a0_work_activity`,
        unwind: (c) => c.$executeRaw`ROLLBACK TO SAVEPOINT a0_work_activity`,
        release: (c) => c.$executeRaw`RELEASE SAVEPOINT a0_work_activity`,
    },
};

/**
 * Grep-able marker for "the fenced region aborted the transaction WITHOUT
 * telling the fence". One string, so an operator correlating a lost hop has
 * exactly one thing to search for (see the release path below, and R1 in
 * the backlog).
 */
const FENCE_RELEASE_FAILED_MARKER = '[fence-release-failed]';

/**
 * PR-A0-1b (F1), generalised by PR-A0-2 audit round 1 (F1) — run a BEST-EFFORT
 * side-effect WITHOUT ever costing the caller its transaction, and without ever
 * throwing. Returns whether the side-effect completed. `run(client)` receives
 * the client it must go through.
 *
 * The problem this exists to solve, stated once: "best-effort" implemented as a
 * bare `try/catch` is correct ONLY in autocommit. Inside somebody else's
 * transaction a failed statement makes Postgres mark the whole transaction
 * ABORTED (25P02); every later command in it fails, and COMMIT is answered with
 * a silent ROLLBACK — no exception anywhere. A swallow therefore converts a
 * cosmetic side-effect failure into the silent destruction of the caller's
 * business write, and the caller still replies 200.
 *
 * Three client shapes, three answers:
 *
 * 1. SOMEBODY ELSE'S transaction → fence it:
 *        SAVEPOINT → run → RELEASE          (success)
 *        SAVEPOINT → run → ROLLBACK TO      (failure: tx is usable again)
 *    `ROLLBACK TO SAVEPOINT` is the only statement Postgres accepts on an
 *    aborted transaction, so this is what makes the swallow an actual fail-OPEN
 *    instead of an accidental fail-closed.
 *
 * 2. A BARE client, when `wrapBareClientInTx` is set → wrap in a short internal
 *    transaction (PR-A0-1b cycle 2 / F-B). Used by the audit emission because
 *    `logWithin` takes a per-org **xact** advisory lock
 *    (middleware/audit-logger.js:606) to serialise read-tail → assign-sequence →
 *    INSERT (:593-606); in autocommit that lock is released at the end of its
 *    own statement, i.e. before the tail read it is supposed to protect. The
 *    work-activity block does NOT ask for this — it had no internal transaction
 *    before and gaining one would be a behaviour change on the standalone path.
 *
 * 3. Anything else (bare client without the wrap, stubs that cannot carry the
 *    rows) → plain call; there is no transaction to poison, and SAVEPOINT
 *    outside a transaction block is an error in Postgres anyway.
 *
 * @param {object}   client
 * @param {(c:object)=>Promise<unknown>} run
 * @param {object}   opts
 * @param {string}   opts.context               — human label for the warnings
 * @param {'audit'|'workActivity'} opts.savepoint
 * @param {boolean}  opts.clientIsCapable       — can this client run `run` at all
 * @param {boolean} [opts.wrapBareClientInTx]   — see shape 2
 */
async function runFencedBestEffort(client, run, opts) {
    const { context, savepoint, clientIsCapable, wrapBareClientInTx = false } = opts;
    const sp = FENCE_SAVEPOINTS[savepoint];

    const insideCallerTx = clientIsTransactionHandle(client)
        && clientIsCapable
        && clientSupportsSavepoints(client);

    if (!insideCallerTx) {
        const ownTransaction = wrapBareClientInTx
            && !clientIsTransactionHandle(client)
            && clientIsCapable;
        try {
            if (ownTransaction) {
                await client.$transaction(async (tx) => run(tx));
            } else {
                await run(client);
            }
            return true;
        } catch (sideEffectError) {
            console.warn(
                `[application-status-writer] ${sp.label} emission failed (${context}, non-fatal): `
                + `${sideEffectError?.message || sideEffectError}`,
            );
            return false;
        }
    }

    try {
        await sp.open(client);
    } catch (savepointError) {
        // No fence available ⇒ do not gamble with a transaction we do not own.
        // A missing side-effect is recoverable (and loud); a silently
        // rolled-back business write is neither.
        console.warn(
            `[application-status-writer] could not open the ${sp.label} savepoint (${context}); skipping the `
            + `${sp.label} write rather than risking the caller's transaction: `
            + `${savepointError?.message || savepointError}`,
        );
        return false;
    }

    try {
        await run(client);
    } catch (sideEffectError) {
        try {
            await sp.unwind(client);
        } catch (unwindError) {
            console.error(
                `[application-status-writer] CRITICAL — ${sp.label} emission failed (${context}) and the savepoint `
                + 'unwind ALSO failed; the caller\'s transaction is aborted and its COMMIT will roll back: '
                + `${unwindError?.message || unwindError}`,
            );
            return false;
        }
        console.warn(
            `[application-status-writer] ${sp.label} emission failed (${context}, non-fatal); unwound to `
            + `the ${sp.label} savepoint so the status write survives: `
            + `${sideEffectError?.message || sideEffectError}`,
        );
        return false;
    }

    try {
        await sp.release(client);
    } catch (releaseError) {
        // NOT cosmetic (audit round 2, R1). Reaching here means `run` returned
        // NORMALLY and yet `RELEASE SAVEPOINT` was rejected — and the only thing
        // that rejects a RELEASE is a transaction Postgres has already marked
        // ABORTED (25P02). So the region DID fail, and something inside it
        // swallowed the failure before the fence could see it. The fence is
        // powerless at that point: it caught nothing, so it unwound nothing, and
        // the caller's COMMIT will be answered with a silent ROLLBACK.
        //
        // The known instance is `recordAssignment`
        // (services/assignment-ledger-service.js:83-87), which logs and returns
        // null on its own failure and is reached from `createForStage` inside
        // this region. The real repair is to lift that swallow OUT of the fenced
        // region so the error propagates to the fence — a change to a file
        // outside PR-A0-2's scope, filed in the backlog.
        //
        // Until then the loss is at least LOUD and greppable: one marker, the
        // savepoint that could not be released, and the context.
        console.warn(
            `[application-status-writer] ${FENCE_RELEASE_FAILED_MARKER} RELEASE SAVEPOINT ${sp.name} `
            + `was REJECTED (${context}) — the ${sp.label} region aborted the caller's transaction and `
            + 'swallowed the error internally, so the fence never saw it. The caller\'s COMMIT will be a '
            + `silent ROLLBACK and this hop is LOST: ${releaseError?.message || releaseError}`,
        );
    }
    return true;
}

/**
 * Audit-emission specialisation of the fence. Kept as a named function because
 * it is the shape three call sites use (default transition row, the cert
 * rollback's compensating row, the CERT_AUTO_GEN_ROLLBACK marker) and because
 * its bare-client behaviour (internal transaction) differs from the
 * work-activity fence's.
 */
async function emitAuditFailOpen(client, emit, context) {
    return runFencedBestEffort(client, emit, {
        context,
        savepoint: 'audit',
        clientIsCapable: clientCanCarryAuditRows(client),
        wrapBareClientInTx: true,
    });
}

/** The canonical transition row, run through the fail-open fence above. */
async function emitDefaultTransitionAuditFailOpen(client, envelope, context) {
    return emitAuditFailOpen(client, (target) => emitDefaultTransitionAudit(target, envelope), context);
}

/**
 * PR-A0-1b cycle 2 (F-B) — apply a status write and its default audit row in
 * ONE short internal transaction on a bare client, with the fail-open unwind:
 * when only the audit emission fails the transaction is unwound and the write
 * is re-applied on the bare client WITHOUT a row (degraded, never lost). Any
 * other error is a real one and is re-thrown untouched.
 *
 * Shared by the forward status write and the cert-rollback revert so the two
 * cannot drift into different transaction semantics for the same guarantee.
 */
async function applyWithDefaultAuditInInternalTx(client, applyWrite, envelope, context) {
    // `auditFailure` doubles as the discriminator on the way out: it is set
    // ONLY after the write already succeeded and ONLY by the emission, so any
    // other error escaping the transaction is a real one and re-thrown.
    let auditFailure = null;
    try {
        return await client.$transaction(async (tx) => {
            const row = await applyWrite(tx);
            try {
                await emitDefaultTransitionAudit(tx, envelope);
            } catch (auditError) {
                auditFailure = auditError;
                throw new Error(
                    '[application-status-writer] unwinding internal audit transaction',
                );
            }
            return row;
        });
    } catch (txError) {
        if (auditFailure === null) {throw txError;}
        console.warn(
            '[application-status-writer] default audit emission failed inside the writer\'s '
            + `internal transaction (${context}); re-applying the write WITHOUT an audit row `
            + `(non-fatal, fail-open): ${auditFailure?.message || auditFailure}`,
        );
        return applyWrite(client);
    }
}

/**
 * Best-effort audit emission via the caller-supplied callback. NEVER throws —
 * audit-log availability must not block status writes (separate durability via
 * audit-chain-verifier). When `args.prisma` is a tx handle the callback runs in
 * that same transaction, so the audit row is atomic with the status update.
 * Extracted from writeApplicationStatus (refactor 2026-06-05) — behaviour
 * identical (same envelope, same swallow-and-warn).
 */
async function emitBestEffortTransitionAudit(client, onAudit, envelope) {
    if (typeof onAudit !== 'function') {return;}
    // the backlog — this used to be a bare try/catch, which reads like
    // safety and is not. The callback exists so the audit row joins the CALLER's
    // transaction; when its INSERT fails, Postgres has already marked that
    // transaction ABORTED (25P02), and catching the JavaScript error does not
    // un-abort it. Every later statement raises and the caller's COMMIT is
    // answered with a silent ROLLBACK — the status write is destroyed while this
    // function reports success. Exactly the F1 poisoning class, one emitter over.
    //
    // Same fence as the default emitter: SAVEPOINT → run → RELEASE, or
    // ROLLBACK TO SAVEPOINT, which is the one statement Postgres accepts on an
    // aborted transaction. `runFencedBestEffort` still swallows and warns, so
    // fail-open is unchanged; what changes is that the caller's transaction is
    // usable afterwards.
    // NOT emitAuditFailOpen: that one also wraps a BARE client in a transaction so
    // the status UPDATE and the audit row commit together. Here that would buy
    // nothing and cost something. The callback writes through whatever client the
    // caller closed over, not ours, so a transaction opened here could not make the
    // two atomic — it would only add a transaction the writer never used to open,
    // which application-status-writer-audit-default.test.js case (b) pins against.
    //
    // The poisoning this fence exists for can only happen INSIDE a caller's
    // transaction; a bare client has no transaction to poison. So: fence exactly
    // when a savepoint can be issued, and otherwise call straight through.
    return emitCallerAuditFenced(client, onAudit, {
        event: STATUS_TRANSITION_EVENT,
        ...envelope,
        timestamp: new Date(),
    }, 'caller onAudit callback');
}

/**
 * Run a CALLER-OWNED audit emission behind the savepoint fence.
 *
 * Every `onAudit` call in this file goes through here, because every one of them
 * has the same hazard: the callback writes into the caller's transaction, and a
 * failed INSERT there marks the transaction ABORTED (25P02). A try/catch around
 * it swallows the JavaScript error and leaves the transaction dead, so the
 * caller's COMMIT is answered with a silent ROLLBACK.
 *
 * The rollback path (the backlog) is the sharpest case: it emits right
 * after the UPDATE that reverts a failed certificate mint, so an unfenced failure
 * there discards the revert and strands the application at a status its own
 * history says it never legitimately reached. A compensating write that its own
 * audit row can silently undo is not a compensation.
 */
async function emitCallerAuditFenced(client, onAudit, payload, context) {
    if (typeof onAudit !== 'function') {return;}
    return runFencedBestEffort(client, () => onAudit(payload), {
        context,
        savepoint: 'audit',
        clientIsCapable: clientSupportsSavepoints(client),
        // A bare client has no transaction to poison, and the callback writes
        // through the caller's client rather than ours, so opening one here could
        // not make the two atomic — see application-status-writer-audit-default
        // case (b), which pins that the writer opens no transaction of its own.
        wrapBareClientInTx: false,
    });
}

// Statuses that are a decision by the reviewer (papers) or the inspector (visit).
const SOD_DECISION_STATUSES = new Set(['DOC_APPROVED', 'REVISION_REQUESTED', 'AUDIT_PASSED', 'CAR_PENDING']);

/**
 * Write a status transition. Returns the updated application row.
 *
 * @param {object} args
 * @param {object} args.prisma            — prisma client OR tx handle
 * @param {string} args.applicationId
 * @param {string} args.fromStatus        — current status (caller responsibility)
 * @param {string} args.toStatus
 * @param {string} args.actorId
 * @param {string} [args.actorRole]
 * @param {string} [args.reason]
 * @param {Record<string, unknown>} [args.additionalData] — extra columns to update
 * @param {boolean} [args.assertTransition] — when true, throw if the transition
 *                                            is illegal per workflow-transition-service.
 *                                            Default: false (permissive during migration).
 * @param {number} [args.expectedVersion] — WF-F7 optimistic lock. When provided
 *   (an integer = the Application.version the caller read), the update is scoped
 *   to `where:{ id, version: expectedVersion }`; if a concurrent writer already
 *   advanced the row the update matches 0 rows and a `CONCURRENCY_CONFLICT`
 *   error is thrown instead of clobbering. Omit for last-write-wins (the
 *   `version` column still increments on every write either way).
 * @param {((entry: object) => Promise<unknown>)|false} [args.onAudit] — TRI-STATE
 *   (A0 / PR-A0-1):
 *     • omitted → the writer emits the canonical APPLICATION transition row
 *       itself, in the same transaction as the status UPDATE (opening a short
 *       internal transaction when the caller passed a bare client);
 *     • function → caller-owned emitter, receives `{ event, applicationId,
 *       fromStatus, toStatus, actorId, actorRole, reason, timestamp }`, and the
 *       writer emits nothing of its own;
 *     • `false` → deliberate, documented silence (caller writes its own row in
 *       its own tx, or is a dev script that must not touch the chain).
 *   Failure of EITHER emitter is swallowed (logged to console.warn);
 *   audit-log availability MUST NOT block status writes.
 * @param {boolean} [args.autoIssueCertificate] — Iter R2 / R2-D. When the
 *   transition lands on `AUDIT_PASSED`, the writer attempts to idempotently
 *   issue a certificate via certificate-service. Defaults to `true` for
 *   AUDIT_PASSED; pass `false` to opt out (e.g., when the caller is the
 *   audit-route which already runs its own cert-gen block as
 *   belt-and-suspenders, or test paths that want to inspect status
 *   transitions in isolation). The hook is a NO-OP for any other toStatus
 *   regardless of this flag. On generateCertificate failure the writer
 *   rolls the status update back to `fromStatus` and re-throws a wrapped
 *   error so the caller can surface the failure to the auditor.
 * @param {object|null} [args.holderScope] — the health caller's holder scope
 *   (holder-access, spec 2026-09-30 §3.1). When given, the status and formData
 *   pre-reads carry the holder fragment. Staff and system callers omit it.
 * @returns {Promise<object>} the updated application row
 */
async function writeApplicationStatus(args) {
    if (!args || typeof args !== 'object') {
        throw new TypeError('writeApplicationStatus: args required');
    }
    const {
        prisma,
        applicationId,
        fromStatus,
        toStatus,
        actorId,
        actorRole = null,
        reason = null,
        additionalData = {},
        assertTransition = false,
        // NO default value: the tri-state needs to see "the caller passed
        // nothing" as itself, not as a stand-in `null`.
        onAudit,
        autoIssueCertificate = true,
        expectedVersion = null,
        breakGlassReopen = false,
        // A health door passes its caller's holder scope (spec 2026-09-30 §3.1):
        // the formData pre-read below then carries the holder fragment. That
        // pre-read swallows its own errors, so an unscoped read rejected by the
        // witness would silently drop the workflowState stamp.
        holderScope = null,
    } = args;

    if (!prisma) {throw new TypeError('writeApplicationStatus: prisma required');}
    if (!applicationId) {throw new TypeError('writeApplicationStatus: applicationId required');}
    if (!toStatus) {throw new TypeError('writeApplicationStatus: toStatus required');}

    // Vocabulary before anything else — a value the state machine cannot name
    // must never reach the column, and must not cost a pre-read SELECT either.
    assertCanonicalStatus(toStatus);

    // Waiver-reopen fence (owner ruling 2026-07-08 — "เท่านั้น"): leaving
    // EXPIRED is reserved for the SYSTEM actor executing an approved waiver
    // request (waiver-reopen-service: inspector request → DTAM-side accountant
    // approval). Human/admin escape hatches (force/override/revert) run
    // through this same chokepoint REGARDLESS of assertTransition, so without
    // this fence the SoD flow would be a polite path next to an open back
    // door. `breakGlassReopen: true` is the audited emergency override for
    // when the waiver flow itself is broken — callers must record it in their
    // own audit metadata (reasonCode BREAK_GLASS_REOPEN).
    const _fenceCandidate = String(toStatus).toUpperCase() !== 'EXPIRED'
        && String(actorRole || '').toLowerCase() !== 'system'
        && !breakGlassReopen;
    let _fenceFrom = fromStatus;
    // MUST-3 (adversarial-verify): the fence must not be dodgeable by simply
    // OMITTING fromStatus — callers like sync-controller pass
    // fromStatus: undefined while moving a row that may really be EXPIRED.
    // For fence-candidate writes with a nullish fromStatus, read the row's
    // actual status first (one extra SELECT only on that rare shape).
    if (_fenceCandidate && (_fenceFrom === undefined || _fenceFrom === null)) {
        try {
            // A health caller's read carries its holder fragment (spec 2026-09-30 §3.1).
            const row = holderScope && Array.isArray(holderScope.readIds)
                ? await prisma.application.findFirst({
                    where: { id: applicationId, ...require('./holder-access').holderReadWhere(holderScope, 'Application') },
                    select: { status: true },
                })
                : await prisma.application.findUnique({
                    where: { id: applicationId },
                    select: { status: true },
                });
            _fenceFrom = row?.status ?? null;
        } catch (_e) {
            // Unreadable row → let the UPDATE below surface the real error.
            _fenceFrom = null;
        }
    }
    if (_fenceCandidate && String(_fenceFrom || '').toUpperCase() === 'EXPIRED') {
        const fenceError = new Error(
            'Reopening an EXPIRED application requires the waiver-reopen flow '
            + '(inspector request + DTAM-side accountant approval) or an explicit '
            + 'break-glass override.',
        );
        fenceError.code = 'WAIVER_REOPEN_REQUIRED';
        fenceError.statusCode = 409;
        fenceError.status = 409;
        throw fenceError;
    }

    // Separation of duties at the one place every decision lands (operator ruling
    // 2026-10-05, fix round 1): a person who is both the document reviewer and the field
    // inspector of this application may not write either decision, through ANY door.
    // Deliberately not skippable: no `force`, no admin override flag. To break the rule an
    // admin reassigns one side first. The SYSTEM actor (cron/expiry) is not a person.
    if (SOD_DECISION_STATUSES.has(String(toStatus).toUpperCase())
        && String(actorRole || '').toLowerCase() !== 'system'
        && actorId
        && prisma.application
        && typeof prisma.application.findUnique === 'function') {
        const sides = await prisma.application.findUnique({
            where: { id: applicationId },
            select: { reviewerId: true, auditorId: true },
        });
        if (sides) {
            require('../shared/reviewer-inspector-separation').assertDecisionNotByReviewerAndInspector({
                actorId,
                reviewerId: sides.reviewerId,
                auditorId: sides.auditorId,
            });
        }
    }

    if (assertTransition) {
        assertTransitionAllowed(fromStatus, toStatus, actorRole);
    }

    // H1 — keep formData.workflowState in sync with the status column.
    // resolveStateFromApplication() PREFERS formData.workflowState (intentional:
    // the engine can lead the legacy-status mirror). buildTransitionUpdate keeps
    // both in sync, but this canonical writer historically wrote ONLY the status
    // column — so the Phase-1 slip flow (approveSlip → writeApplicationStatus)
    // advanced status to DOC_FEE_PAID while formData.workflowState stayed frozen
    // at PENDING_DOC_FEE, and the SCHEDULER assign-reviewer step then 409'd. Sync
    // the JSON state here.
    //
    // Bug 3.1 (2026-06-30) — the guard originally SKIPPED the sync entirely
    // whenever `additionalData` carried a `formData` key. But admin force
    // (admin-application-service.forceTransitionStatus), revert
    // (revertLastTransition), and the provider batch-action
    // (routes/api/provider/handlers/admin.js ASSIGN/REQUEST_DOCUMENTS) all pass
    // an explicit `formData` that does NOT include a `workflowState` key — so the
    // status COLUMN advanced while formData.workflowState stayed frozen, and the
    // next reviewer transition (which builds `from` off formData.workflowState)
    // saw the stale state → canTransition=false → 422, app stuck. Fix: MERGE the
    // canonical workflowState onto the caller's supplied formData when it does not
    // already carry one. Only skip stamping when the caller intentionally set
    // formData.workflowState itself (handlers that route through
    // buildTransitionUpdate already do this — their value must win, not be
    // clobbered).
    let formDataPatch;
    try {
        const wf = getWorkflowTransitionService();
        const canonicalNextState = typeof wf.normalizeWorkflowStateInput === 'function'
            ? wf.normalizeWorkflowStateInput(toStatus)
            : null;
        const callerFormData =
            additionalData.formData && typeof additionalData.formData === 'object'
                ? additionalData.formData
                : null;
        // The caller's formData is "already correct" ONLY when its workflowState
        // EQUALS the canonical next state — that is what buildTransitionUpdate's
        // handlers stamp, so those genuinely-correct writes still win un-clobbered.
        // KEY-PRESENCE is NOT sufficient (Bug-3.1 / adversarial-verify CRITICAL):
        // admin force/revert and the provider batch-action SPREAD the persisted
        // row's formData, which carries a STALE workflowState from a prior
        // transition. Keying on presence would (wrongly) treat that stale value as
        // intentional and skip the re-stamp → formData.workflowState freezes while
        // the status column advances → the next reviewer transition builds from the
        // stale state → 422, app stuck. Compare the VALUE so stale spreads get
        // corrected.
        const callerWorkflowStateIsCurrent =
            callerFormData !== null && callerFormData.workflowState === canonicalNextState;

        if (canonicalNextState && !callerWorkflowStateIsCurrent) {
            if (callerFormData) {
                // Caller supplied a formData object with a STALE or absent
                // workflowState — MERGE the canonical stamp onto it (do NOT
                // pre-read; the caller's object is the authoritative base).
                formDataPatch = {
                    ...callerFormData,
                    workflowState: canonicalNextState,
                    workflowStateUpdatedAt: new Date().toISOString(),
                };
            } else if (
                prisma.application
                && typeof prisma.application.findUnique === 'function'
            ) {
                // No caller formData — pre-read the existing JSON and stamp
                // (original H1 behaviour, unchanged).
                const scoped = Boolean(holderScope) && Array.isArray(holderScope.readIds);
                const current = scoped
                    ? await prisma.application.findFirst({
                        where: {
                            id: applicationId,
                            ...require('./holder-access').holderReadWhere(holderScope, 'Application'),
                        },
                        select: { formData: true },
                    })
                    : await prisma.application.findUnique({
                        where: { id: applicationId },
                        select: { formData: true },
                    });
                if (scoped && !current) {
                    // A scoped pre-read that finds nothing must not stamp `{}` over
                    // the row's real formData: leave formDataPatch undefined and
                    // write the status only (Task 4 fix round 1, Important 3).
                    formDataPatch = undefined;
                } else {
                    const existing = (current && current.formData && typeof current.formData === 'object')
                        ? current.formData
                        : {};
                    formDataPatch = {
                        ...existing,
                        workflowState: canonicalNextState,
                        workflowStateUpdatedAt: new Date().toISOString(),
                    };
                }
            }
        }
    } catch (_syncErr) {
        // Defensive: a failed pre-read must not block the status write. Fall
        // back to a status-only update (pre-H1 behaviour) for that call.
        formDataPatch = undefined;
    }

    // WF-F7 — optimistic concurrency. `version` always increments so the
    // column tracks every transition. When the caller passes `expectedVersion`
    // (the version it read the application at), we scope the update to that
    // version: a racing writer that already advanced the row bumps the version,
    // our WHERE matches 0 rows, Prisma throws P2025, and we surface a typed
    // ConcurrencyError instead of silently clobbering the other write
    // (lost-update / double-advance). Callers that don't pass expectedVersion
    // keep the previous last-write-wins behaviour but still get the increment.
    const updateWhere = { id: applicationId };
    if (Number.isInteger(expectedVersion)) {
        updateWhere.version = expectedVersion;
    }

    // The transition envelope is shared by BOTH emitters (writer default and
    // caller callback) so the two can never describe the same hop differently.
    const transitionEnvelope = {
        applicationId,
        fromStatus,
        toStatus,
        actorId,
        actorRole,
        reason,
    };

    const applyStatusUpdate = async (client) => {
        try {
            return await client.application.update({
                where: updateWhere,
                data: {
                    status: toStatus,
                    updatedAt: new Date(),
                    updatedBy: actorId || null,
                    version: { increment: 1 },
                    ...additionalData,
                    // Sync the JSON workflow state (H1 + Bug 3.1). This spreads AFTER
                    // additionalData because `formDataPatch` already MERGES the
                    // caller-supplied formData (from additionalData.formData) with the
                    // canonical workflowState stamp — so it must WIN over the raw
                    // additionalData.formData that would otherwise clobber the stamp
                    // back out. When the caller intentionally set formData.workflowState
                    // themselves, formDataPatch is left undefined above and
                    // additionalData.formData passes through untouched.
                    ...(formDataPatch ? { formData: formDataPatch } : {}),
                },
            });
        } catch (updateError) {
            if (Number.isInteger(expectedVersion) && updateError?.code === 'P2025') {
                const conflict = new Error(
                    `writeApplicationStatus: concurrent modification of application ${applicationId} ` +
                        `(expected version ${expectedVersion}; row was advanced by another writer)`,
                );
                conflict.code = 'CONCURRENCY_CONFLICT';
                conflict.applicationId = applicationId;
                conflict.expectedVersion = expectedVersion;
                throw conflict;
            }
            throw updateError;
        }
    };

    // A0 / PR-A0-1 — audit emission.
    //
    // The `event` field identifies the audit category for downstream routers
    // (audit-logger expects an event-typed envelope when the caller wires
    // `logWithin(event, tx)` from middleware/audit-logger). When `args.prisma`
    // is a transaction handle BOTH emitters run inside that same transaction,
    // so the audit row is atomic with the status update.
    //
    // When the caller passed a BARE client and the writer owns the emission,
    // the writer opens its own short transaction (two statements) so that
    // invariant holds for callers that never passed a tx — the majority of the
    // 16 hops A0 found writing status with no audit row at all. The cert hook,
    // the applicant fanout and the work-activity emission below stay OUTSIDE
    // that internal transaction: their behaviour is deliberately unchanged by
    // this PR.
    //
    // Failure policy is UNCHANGED (fail-open). Note that a failed audit INSERT
    // poisons the surrounding transaction (Postgres 25P02 — see the lock note
    // in middleware/audit-logger.js), so "swallow and carry on inside the tx"
    // would silently turn an audit hiccup into a rolled-back STATUS WRITE, i.e.
    // fail-closed by accident. Two shapes, two answers:
    //   • the writer's OWN internal tx → unwind it and re-apply the status
    //     write on the bare client without an audit row;
    //   • the CALLER's tx → the writer may not unwind what it does not own, so
    //     the emission is fenced by a SAVEPOINT and rolled back to it
    //     (PR-A0-1b / F1 — `emitDefaultTransitionAuditFailOpen` above).
    // Both are degraded (a warn + a missing row) but never a lost status write.
    const auditMode = resolveAuditEmissionMode(onAudit);
    const useInternalAuditTx = auditMode === AUDIT_EMISSION_DEFAULT
        && typeof prisma.$transaction === 'function'
        && clientCanCarryAuditRows(prisma);

    let updated;
    if (useInternalAuditTx) {
        updated = await applyWithDefaultAuditInInternalTx(
            prisma, applyStatusUpdate, transitionEnvelope, 'status transition',
        );
    } else {
        updated = await applyStatusUpdate(prisma);
        if (auditMode === AUDIT_EMISSION_DEFAULT) {
            // Caller-supplied tx handle (or a client that cannot carry audit
            // rows at all — test stubs). Emitting here joins the caller's
            // transaction when there is one, and a failure is unwound to a
            // savepoint so that transaction stays usable and committable.
            await emitDefaultTransitionAuditFailOpen(
                prisma, transitionEnvelope, 'status transition',
            );
        }
    }

    // Caller-owned emitter (unchanged). No-op unless `onAudit` is a function,
    // so exactly ONE of the two emitters ever runs — never both, never a
    // double row.
    await emitBestEffortTransitionAudit(prisma, onAudit, transitionEnvelope);

    // Iter R2 / R2-D — certificate auto-generation hook.
    //
    // Why this lives in the writer (and not exclusively in the audit
    // route's inline block at routes/api/audit/audits.js:505-548): there
    // are FOUR write paths that land on AUDIT_PASSED today —
    //   • routes/api/audit/audits.js (auditor's POST /:id/result)
    //   • services/audit-onsite-service.js (onsite checklist PASS)
    //   • prisma/seed-approve.js (seed scripts)
    //   • controllers/e2e-controller.js (E2E test harness)
    // Only the first one ran cert-gen. R2-D moves the hook into the
    // canonical writer so every AUDIT_PASSED transition produces a
    // certificate exactly once. The audit-route's inline block is
    // retained as belt-and-suspenders because (a) it can detect the
    // already-issued cert via findCertificateForApplication and skip
    // cleanly, and (b) leaving it in place means a regression in the
    // hook does NOT silently break the primary auditor flow.
    //
    // Idempotency: findCertificateForApplication is the dedupe
    // primitive — if a cert already exists for this application the
    // hook is a no-op and returns. Re-calls are safe.
    //
    // Failure semantics: cert-gen is NOT best-effort. A failure rolls
    // the status update back to fromStatus and re-throws a wrapped
    // error. This matches the audit-route's existing inline behaviour
    // (audits.js:514-548) so the auditor receives a 500 and can retry.
    //
    // Ordering: this hook fires AFTER prisma.application.update
    // succeeds AND after onAudit emission of the original transition
    // (so the audit trail records the auditor's intent), but BEFORE
    // work-activity emission (so a rollback skips spawning activities
    // for a stage the application no longer occupies).
    //
    // I-003 compliance: the rollback path emits a second onAudit entry
    // via the caller-supplied callback rather than calling
    // auditLogger.log directly. When the caller passed a transaction
    // handle as `args.prisma`, the rollback update + audit row commit
    // atomically with the original update (rolling everything back
    // when the transaction throws). When the caller passed a bare
    // prisma client, the rollback is a second round-trip — same as
    // the audit-route's existing pattern.
    // ── ใบรับรองเกิดที่การ "อนุมัติ" ไม่ใช่ที่การ "ตรวจผ่าน" (F-CERT-SOD, 2026-09-10) ──
    //
    // เดิมเงื่อนไขนี้เป็น (AUDIT_PASSED || APPROVED) ตามมติ 2026-06-05 ที่ให้ผู้ตรวจหน้างาน
    // คนเดียวออกใบได้เอง · ผลข้างเคียงที่หนักกว่าตัวมติเอง: ใบถูก mint ตั้งแต่จังหวะเขียน
    // AUDIT_PASSED ⇒ **ใบรับรองมีอยู่ก่อนที่ใครจะอนุมัติ** และ APPROVED/CERTIFIED กลายเป็น
    // การประทับตราทีหลังบนคำขอที่ถือใบอยู่แล้ว · การตัดสินให้การรับรองจึงไม่มีความหมาย
    // เพราะสิ่งที่มันควรตัดสินเกิดไปแล้ว
    //
    // operator ทักเองเมื่อ 2026-09-10 (ledger F-CERT-SOD) · ถอด AUDIT_PASSED ออกจาก
    // เงื่อนไข ใบจึงไปเกิดที่ APPROVED ซึ่งเป็นจังหวะที่ ISO/IEC 17065 §7.6 เรียกว่า
    // "การตัดสินให้การรับรอง" และเป็นจังหวะที่ด่านผู้อนุมัติ ≠ ผู้ประเมิน ทำงาน
    // (services/certification-decision-separation.js ผ่าน buildTransitionUpdate)
    //
    // APPROVED เป็น trigger อยู่แล้วเดิม (สำหรับเส้นทาง manual/legacy) และ
    // findCertificateForApplication ยัง dedupe ให้ ⇒ ออกซ้ำไม่ได้เหมือนเดิม
    //
    // Captured here so the applicant fanout below can surface the certificate number
    // the hook just minted (set in both the create and the idempotent-existing branches).
    let issuedCertificateNumber = null;
    if (toStatus === 'APPROVED' && autoIssueCertificate !== false) {
        const certificateService = getCertificateService();
        try {
            // The probe reads the SAME client the issuance below writes with — inside a
            // transaction the singleton would answer from outside it (2026-09-05).
            const existingCert = await certificateService.findCertificateForApplication(applicationId, { prisma });
            if (!existingCert) {
                // C-1 (R2 review): do NOT pass `skipInitialAssets: true` —
                // the previous design assumed the audit-route's inline
                // block would still call createInitialAssets, but the
                // route's findCertificateForApplication probe now short-
                // circuits and skips it. The hook owns the full
                // cert + PlantingCycle + Batch + QR creation.
                const createdCert = await certificateService.generateCertificate(
                    applicationId,
                    actorId,
                    // BE-T1: thread the writer's client through so cert issuance
                    // joins the caller's transaction (when one was passed) and
                    // commits/rolls-back atomically with the status flip.
                    { prisma },
                );
                issuedCertificateNumber = createdCert?.certificateNumber || createdCert?.id || null;
            } else {
                issuedCertificateNumber = existingCert.certificateNumber || existingCert.id || null;
                // H-1 (R2 review): on idempotent skip preserve the audit
                // trail so retries through non-route paths
                // (audit-onsite-service, seed, e2e-controller) still record
                // who tried to re-issue and when. Fenced like every other
                // caller-owned emission — a swallowed failure here would leave
                // the caller's transaction aborted just the same.
                await emitCallerAuditFenced(prisma, onAudit, {
                    event: 'CERT_AUTO_GEN_SKIPPED_EXISTING',
                    applicationId,
                    certificateNumber: existingCert.certificateNumber || existingCert.id,
                    actorId,
                    actorRole,
                    timestamp: new Date(),
                }, 'CERT_AUTO_GEN_SKIPPED_EXISTING onAudit');
            }
        } catch (certError) {
            // Rollback: revert the application status to where it was.
            // We use prisma.application.update directly here (NOT a
            // recursive writeApplicationStatus call) because (a) the
            // recursive call would re-run the cert hook and create an
            // infinite loop, and (b) we want the rollback to be a
            // single column-level revert with no side-effects.
            const applyStatusRevert = async (client) => client.application.update({
                where: { id: applicationId },
                data: {
                    status: fromStatus,
                    updatedAt: new Date(),
                    updatedBy: actorId || null,
                    version: { increment: 1 },
                },
            });
            const reversalEnvelope = {
                applicationId,
                fromStatus: toStatus,
                toStatus: fromStatus,
                actorId,
                actorRole,
                reason: CERT_ROLLBACK_REASON,
            };

            // PR-A0-1b cycle 2 (F-B): on a bare client the revert and its
            // compensating row go through the SAME internal transaction the
            // forward write uses. Emitting the row outside a transaction would
            // take the audit chain's xact advisory lock in autocommit — released
            // before the tail read it is meant to protect — and would leave the
            // revert and the row non-atomic with each other.
            const revertInInternalTx = auditMode === AUDIT_EMISSION_DEFAULT
                && typeof prisma.$transaction === 'function'
                && clientCanCarryAuditRows(prisma);
            // True once the default reversal row is this path's business,
            // whether or not it survived — retrying it below (unfenced, outside
            // the transaction) is exactly what F-B forbids.
            const reversalHandled = revertInInternalTx;
            try {
                if (revertInInternalTx) {
                    await applyWithDefaultAuditInInternalTx(
                        prisma, applyStatusRevert, reversalEnvelope, 'cert-rollback reversal',
                    );
                } else {
                    await applyStatusRevert(prisma);
                }
            } catch (rollbackError) {

                console.error(
                    `[application-status-writer] CRITICAL — rollback after cert-gen failure also failed for ${applicationId}: ${rollbackError?.message || rollbackError}`,
                );
            }

            // I-003: surface the rollback to the caller's audit trail
            // via the SAME onAudit callback the caller supplied. When
            // prisma is a tx handle this row participates in the same
            // transaction, so the rollback update + audit row commit
            // atomically (or both roll back if the tx throws).
            if (typeof onAudit === 'function') {
                // the backlog — fenced. Unfenced, a failure here poisoned
                // the transaction that had just carried the revert UPDATE, so the
                // revert was discarded and the application stayed at the status the
                // failed mint was for.
                await emitCallerAuditFenced(prisma, onAudit, {
                    event: STATUS_TRANSITION_EVENT,
                    applicationId,
                    fromStatus: toStatus,
                    toStatus: fromStatus,
                    actorId,
                    actorRole,
                    reason: CERT_ROLLBACK_REASON,
                    timestamp: new Date(),
                }, 'rollback onAudit');
            } else if (auditMode === AUDIT_EMISSION_DEFAULT && !reversalHandled) {
                // PR-A0-1b (F3): the SAME compensating row for the default
                // mode. The forward transition row was already emitted (and,
                // on the bare-client path, already COMMITTED in the writer's
                // internal tx) before this revert ran — leaving it unpaired
                // would make the trail assert a hop that does not exist on the
                // row. This branch is the CALLER-tx shape (the bare-client
                // shape committed the row with the revert above), so the
                // emission is savepoint-fenced and cannot poison that tx.
                // `onAudit: false` stays silent here as everywhere else.
                await emitDefaultTransitionAuditFailOpen(
                    prisma, reversalEnvelope, 'cert-rollback reversal',
                );
            }

            // R3-D — defence-in-depth audit row for the rolled-back
            // transition. Even when the caller forgot to pass an
            // `onAudit` callback (older write paths: seed-approve,
            // e2e-controller, audit-onsite-service before the R3
            // migration is complete), we still want a discoverable
            // CERT_AUTO_GEN_ROLLBACK record so operators can correlate
            // a failed cert-gen attempt with the cert-service error.
            //
            // I-003 compliance: this emission MUST use `logWithin(event, tx)`
            // — never `log(event)` — so that when `args.prisma` is a tx
            // handle the audit row commits atomically with the status
            // revert above. Passing the bare prisma client (which lacks
            // the `auditLog` namespace on a tx-only stub) would make
            // `logWithin` throw; that throw is caught here so the
            // rollback ALWAYS wins regardless of audit infrastructure
            // health.
            //
            // Best-effort policy: an audit emission failure (broken
            // tenant context, P2002 sequence conflict, missing tx
            // handle) is logged and swallowed so the wrapped cert-gen
            // error is what the caller sees. The rollback update has
            // already executed by this point.
            //
            // PR-A0-1b cycle 2 (item 3): "swallowed" used to mean a bare
            // `logWithin(event, prisma)` in a try/catch — the same defect F1
            // fixed one emission earlier. A failed INSERT here aborts the
            // CALLER's transaction (25P02) and its COMMIT then rolls the whole
            // hop back silently, and on a bare client the chain lock was taken
            // in autocommit (F-B). Routed through the shared fence: savepoint
            // inside a caller tx, short internal transaction on a bare client.
            await emitAuditFailOpen(prisma, (target) => {
                const auditMod = getAuditModule();
                return auditMod.auditLogger.logWithin({
                    category: auditMod.AuditCategory.APPLICATION,
                    action: 'CERT_AUTO_GEN_ROLLBACK',
                    severity: auditMod.AuditSeverity.WARNING,
                    actorId: actorId || 'SYSTEM',
                    actorRole: actorRole || 'UNKNOWN',
                    resourceType: auditMod.ResourceType.APPLICATION,
                    resourceId: applicationId,
                    metadata: {
                        fromStatus: toStatus,
                        toStatus: fromStatus,
                        errorMessage: certError?.message || 'unknown',
                        errorCode: certError?.code || 'UNKNOWN',
                    },
                }, target);
            }, 'CERT_AUTO_GEN_ROLLBACK marker');

            const wrapped = new Error(
                `cert-auto-gen failed; status rolled back: ${certError?.message || certError}`,
            );
            wrapped.code = certError?.code || 'CERT_AUTO_GEN_FAILED';
            // Carry the cert error's HTTP intent too, not just its code. Without
            // this the route falls back to a blanket 500 while the error catalog
            // declares 503 for CERT_SIGNING_UNAVAILABLE — the wire and the
            // catalog disagreeing about the same code is worse than either
            // answer alone, because integrators trust the catalog.
            if (certError?.statusCode) { wrapped.statusCode = certError.statusCode; }
            wrapped.cause = certError;
            throw wrapped;
        }
    }

    // Applicant fanout: the on-site audit PASSED. The certificate is now issued
    // in the cert hook above (same AUDIT_PASSED write), so this notification can
    // carry the real certificateNumber — APPLICANT_AUDIT_PASSED reads as
    // "audit passed, certificate issued".
    if (toStatus === 'AUDIT_PASSED') {
        // V1-C / D10 — applicant fanout for AUDIT_PASSED.
        //
        // Closes the gap where the cert-hook auto-issued a certificate
        // but no in-app / email / SMS notification ever fired, so the
        // applicant had to refresh /health/applications to discover
        // they passed. The new APPLICANT_AUDIT_PASSED template (in
        // notification-fanout-service.TEMPLATES) drives all three
        // channels.
        //
        // BEST-EFFORT contract: a fanout failure MUST NOT roll back
        // the cert hook, MUST NOT roll back the status write, and MUST
        // NOT throw to the caller. The cert is the source of truth;
        // the notification is a courtesy and the bell-icon poll covers
        // the recovery path.
        //
        // User-id resolution: Application.healthId stores the
        // applicant's canonicalId (per
        // services/application-service/application-applicant-query-methods.js
        // lines 243-245); the fanout `send()` expects User.id. We look
        // up `prisma.user.findFirst({ where: { healthId } })` mirroring
        // audit-scheduling-service.js:476-479.
        //
        // Defensive on prisma.user — test stubs commonly only stub
        // prisma.application; we skip silently when the stub lacks
        // user.findFirst rather than failing the production write
        // path because of a missing test mock.
        try {
            const fanout = getFanoutService();
            if (
                fanout
                && typeof fanout.send === 'function'
                && updated.healthId
                && prisma
                && prisma.user
                && typeof prisma.user.findFirst === 'function'
            ) {
                const healthUser = await prisma.user
                    // Detokenize STAGE 0 (RFC breaker 2, data-state-agnostic):
                    // updated.healthId is the Application.healthId FK value, which
                    // points at User.canonicalId — NOT User.healthId. Query by
                    // canonicalId so the AUDIT_PASSED applicant notification still
                    // resolves after the STAGE-A re-key (when the FK holds the
                    // token, not the national ID). Correct in both data states.
                    .findFirst({ where: { canonicalId: updated.healthId }, select: { id: true } })
                    .catch(() => null);
                if (healthUser?.id) {
                    await fanout.send({
                        userId: healthUser.id,
                        type: 'APPLICANT_AUDIT_PASSED',
                        payload: {
                            applicationId,
                            applicationNumber: updated.applicationNumber || applicationId,
                            // The cert hook above issued the certificate on this
                            // same AUDIT_PASSED write, so surface its number.
                            certificateNumber: issuedCertificateNumber,
                        },
                    });
                }
            }
        } catch (fanoutErr) {

            console.warn(
                `[application-status-writer] APPLICANT_AUDIT_PASSED fanout failed (non-fatal): ${fanoutErr?.message || fanoutErr}`,
            );
        }
    }

    // The file now waits for a certificate approver. Tell them (in-app) — see
    // services/certification-decision-notify.js. Same best-effort contract as the
    // applicant fanout above: never rolls back the status write, never throws.
    if (toStatus === 'AUDIT_PASSED') {
        try {
            await getCertificationDecisionNotify().notifyCertificateApproversOfPassedFile({
                applicationId,
                applicationNumber: updated.applicationNumber || null,
                organizationId: updated.organizationId || null,
            });
        } catch (notifyErr) {
            console.warn(
                `[application-status-writer] approver notification failed (non-fatal): ${notifyErr?.message || notifyErr}`,
            );
        }
    }

    // ADR-016 Phase 1A — spawn work activities for the new stage. Same
    // best-effort policy as audit emission: a failure here logs a warning
    // but does NOT roll back the status write. The work-activity table
    // is a tracking aid, not the source of truth for workflow state.
    //
    // PR-A0-2 audit round 1 (F1) — that promise used to be a bare try/catch,
    // which delivered it ONLY on a bare client. Once PR-A0-2 started handing the
    // writer a caller transaction (applications.js:670, application-bundles.js:368),
    // a failure in this block — a P2002 on the partial unique index
    // `work_activities_open_unique`, an RLS `WITH CHECK` rejection, a lock
    // timeout — aborted the CALLER'S transaction (25P02) while the writer
    // returned normally, so the route committed nothing and answered 200. The
    // block now runs behind the same SAVEPOINT fence the audit emission uses
    // (`runFencedBestEffort` above), which turns "swallow" into an actual
    // fail-OPEN inside a transaction we do not own.
    //
    // EXACTLY WHAT THE FENCE COVERS (audit round 2, R1 — the previous wording of
    // this comment claimed more than the construct can deliver): the fence sees
    // only what PROPAGATES OUT of the function it wraps. A collaborator that
    // catches its OWN failure deeper inside the region still aborts the
    // transaction, and the fence never learns of it — `run` returns normally, so
    // nothing is unwound, and the caller's COMMIT is a silent ROLLBACK. That
    // hole is live on this path today: `createForStage` calls `recordAssignment`
    // (services/assignment-ledger-service.js:83-87), which logs and returns null
    // on failure. The release-catch in `runFencedBestEffort` now announces it
    // with the `[fence-release-failed]` marker rather than calling it cosmetic,
    // but announcing is not fixing — the repair is to lift that swallow out of
    // the region (out of PR-A0-2's scope; filed in the backlog, and the RED
    // for it is already written as the R1 case in
    // `__tests__/unit/a0-pr2-work-activity-fence.test.js`).
    //
    // Bare-client behaviour is deliberately unchanged: no savepoint (illegal
    // outside a transaction block) and no internal transaction (this block never
    // had one, and giving it one would change the standalone contract).
    //
    // Callers that want strict atomicity (status + activities in one tx) can
    // still pass a `prisma.$transaction(...)` handle — the activity rows join
    // that transaction exactly as before; only their FAILURE path changed.
    //
    // Defensive: skip silently if the caller's prisma stub doesn't have
    // workActivity (test mocks, legacy clients before the migration).
    const clientCanCarryWorkActivities = Boolean(
        prisma && prisma.workActivity && typeof prisma.workActivity.create === 'function',
    );
    if (clientCanCarryWorkActivities) {
        await runFencedBestEffort(prisma, async (client) => {
            const wa = getWorkActivityService();
            if (TERMINAL_STATUSES.has(toStatus)) {
                // Application is done — cancel any leftover open activities
                // that were spawned by earlier stages and never completed.
                await client.workActivity.updateMany({
                    where: {
                        applicationId,
                        state: { in: ['TODO', 'CLAIMED', 'IN_PROGRESS'] },
                    },
                    data: {
                        state: 'CANCELLED',
                        cancelledAt: new Date(),
                        cancelReason: `Application reached terminal status ${toStatus}`,
                    },
                });
            }
            // Pre-assign the DOC_REVIEW activity to the reviewer the SCHEDULER
            // chose, so the reviewer skips the redundant "claim" step (they were
            // already assigned the application). Only ASSIGNED_FOR_REVIEW carries
            // a meaningful reviewer; for every other stage we pass null so the
            // activity stays on the pull model (TODO/unassigned) as before.
            //
            // Source of the reviewer id: the canonical Application.reviewerId
            // column when set, else formData.PROVIDERAssignment.reviewerId — the
            // writer-routed assign paths (admin batch, legacy /assign-reviewer)
            // currently persist the reviewer into that JSON field rather than the
            // scalar column, so the fallback is what actually fires in practice.
            const reviewerId = toStatus === 'ASSIGNED_FOR_REVIEW'
                ? (updated.reviewerId || resolveAssignedReviewerId(updated.formData))
                : null;
            await wa.createForStage({
                prisma: client,
                applicationId,
                toStatus,
                organizationId: updated.organizationId,
                reviewerId,
            });
        }, {
            context: 'work-activity for stage',
            savepoint: 'workActivity',
            clientIsCapable: clientCanCarryWorkActivities,
            // NOT wrapped in an internal transaction on a bare client — see the
            // note above; this block never had one.
            wrapBareClientInTx: false,
        });
    }

    return updated;
}

module.exports = {
    writeApplicationStatus,
    // Hardening batch 2026-07-09: the payment settle layer needs the same
    // "application is over" set (terminal-case gates in payment-slip-service +
    // payment-service-webhook-flow) — export the single source of truth.
    TERMINAL_STATUSES,
};
