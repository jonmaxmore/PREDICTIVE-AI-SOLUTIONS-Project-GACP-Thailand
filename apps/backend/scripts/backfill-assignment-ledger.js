#!/usr/bin/env node
/**
 * Backfill the work-distribution ledger (AssignmentLedgerEntry) from existing
 * historical data, so the ledger is not empty for assignments made before the
 * Phase 1B live emits (PR #491) existed.
 *
 * The ledger ("who assigned which work to which person, when, why") is an
 * append-only operational record introduced in Phase 1A (#489). This script
 * reconstructs past events from three fragmented sources:
 *
 *   Phase 1 — AuditLog (ASSIGN events only):
 *     • action 'REVIEWER_ASSIGNED' (scheduler-assign-reviewer)  → ASSIGN  role document_reviewer
 *       assignee = metadata.reviewerId, assignedBy = actorId
 *     • action 'AUDIT_SCHEDULED' (audit-scheduling assignAuditor) → ASSIGN  role auditor
 *       assignee = metadata.auditorId,  assignedBy = actorId
 *
 *   Phase 2 — Application.formData._reassignmentHistory (REASSIGN events):
 *     • each {from,to,reason,reassignedBy,reassignedAt} (audits-reassign)
 *       → REASSIGN role auditor, assignee = to, previous = from, assignedBy = reassignedBy
 *     We DELIBERATELY do NOT also read the 'application.auditorId.changed'
 *     AuditLog rows (they encode the same reassigns) — using one source per
 *     event avoids double-creating.
 *
 *   Phase 3 — WorkActivity (self-service lifecycle):
 *     • claimedAt + assignedUserId + state != TODO → CLAIM   (source SYSTEM_BACKFILL — we
 *       cannot prove it was a self-claim vs an admin claim from the row alone)
 *     • state DONE + completedAt                   → COMPLETE (assignee = completedBy || assignedUserId)
 *
 * Safety / idempotency:
 *   • --dry-run reports without writing (DEFAULT BEHAVIOUR IS TO WRITE — pass
 *     --dry-run first, always, and verify the totals on staging).
 *   • Query-based dedup: before creating a row we look for an existing row with
 *     the same (entityType, entityId, action, assigneeUserId) whose createdAt is
 *     within ±DEDUP_WINDOW_MS. This makes re-runs safe AND avoids duplicating the
 *     rows the live emits (PR #491) already wrote for post-#491 events. There is
 *     NO unique constraint on the ledger yet (a follow-up may add one); dedup is
 *     therefore best-effort and the window is generous.
 *   • FK-orphan guard: assigneeUserId / assignedByUserId / organizationId are
 *     typed FKs. We pre-resolve each user id against the users table (cached) and
 *     SKIP+log rows whose assignee or org cannot be resolved, rather than letting
 *     create() throw per row.
 *   • createdAt is set to the HISTORICAL timestamp so the ledger reflects when the
 *     assignment actually happened (the table is append-only / never updated).
 *
 * Tenancy: this is a headless cross-org script. It writes through the plain
 * prisma client (no tenant-context extension injection), so organizationId is
 * set EXPLICITLY from each source row.
 *
 * Usage on the droplet (inside the backend container), staging FIRST:
 *   node apps/backend/scripts/backfill-assignment-ledger.js --dry-run
 *   node apps/backend/scripts/backfill-assignment-ledger.js
 *
 * Output: per-operation JSON log lines + a final totals object.
 * Exit codes: 0 success (even with per-row skips/errors), 1 fatal (DB unavailable).
 */

'use strict';

const path = require('path');

const DEDUP_WINDOW_MS = 5000;

function parseArgs(argv) {
    return { dryRun: argv.includes('--dry-run') };
}

async function loadPrisma(injected) {
    if (injected) {
        return injected;
    }
    const mod = require(path.resolve(__dirname, '../services/prisma-database'));
    const prisma = mod && mod.prisma ? mod.prisma : null;
    if (!prisma) {
        throw new Error('prisma client unavailable');
    }
    return prisma;
}

function asObject(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

function asArray(v) {
    return Array.isArray(v) ? v : [];
}

function toDate(v) {
    if (!v) { return null; }
    const d = v instanceof Date ? v : new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Cached existence check for a User id (FK guard). Returns true/false.
 */
async function userExists(prisma, cache, id) {
    if (!id) { return false; }
    if (cache.has(id)) { return cache.get(id); }
    const found = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    const exists = Boolean(found);
    cache.set(id, exists);
    return exists;
}

/**
 * Cached existence check for an Organization id (FK guard). Mirrors userExists
 * so a non-null-but-stale organizationId (e.g. an app whose org was archived)
 * is skipped+logged rather than throwing a Prisma FK violation into the generic
 * error bucket.
 */
async function orgExists(prisma, cache, id) {
    if (!id) { return false; }
    if (cache.has(id)) { return cache.get(id); }
    const found = await prisma.organization.findUnique({ where: { id }, select: { id: true } });
    const exists = Boolean(found);
    cache.set(id, exists);
    return exists;
}

/**
 * Does a ledger row already exist for this event (live emit or a prior backfill run)?
 */
async function ledgerRowExists(prisma, { entityType, entityId, action, assigneeUserId, createdAt }) {
    const at = toDate(createdAt) || new Date();
    const found = await prisma.assignmentLedgerEntry.findFirst({
        where: {
            entityType,
            entityId,
            action,
            assigneeUserId,
            createdAt: {
                gte: new Date(at.getTime() - DEDUP_WINDOW_MS),
                lte: new Date(at.getTime() + DEDUP_WINDOW_MS),
            },
        },
        select: { id: true },
    });
    return Boolean(found);
}

/**
 * Validate FKs + dedup, then create one ledger row (unless dryRun). Mutates
 * `totals` and emits a log line. Never throws — per-row failures are tallied.
 */
async function emitRow(prisma, { row, dryRun, log, totals, userCache, orgCache, label }) {
    try {
        const { entityType, entityId, action, assigneeUserId, organizationId } = row;

        if (!entityId || !assigneeUserId || !organizationId) {
            totals.skippedIncomplete += 1;
            log({ label, action: 'SKIP_INCOMPLETE', entityId, assigneeUserId, organizationId });
            return;
        }

        // FK guards (assignee + org required; assignedBy optional → null if it can't resolve).
        if (!(await userExists(prisma, userCache, assigneeUserId))) {
            totals.skippedOrphanAssignee += 1;
            log({ label, action: 'SKIP_ORPHAN_ASSIGNEE', entityId, assigneeUserId });
            return;
        }
        // A non-null but stale org id (archived/deleted org) would throw a Prisma
        // FK violation on create() — skip+log instead of polluting totals.errors.
        if (!(await orgExists(prisma, orgCache, organizationId))) {
            totals.skippedOrphanOrg += 1;
            log({ label, action: 'SKIP_ORPHAN_ORG', entityId, organizationId });
            return;
        }
        let assignedByUserId = row.assignedByUserId || null;
        if (assignedByUserId && !(await userExists(prisma, userCache, assignedByUserId))) {
            assignedByUserId = null; // demote unknown assigner to null rather than skip the row
        }

        if (await ledgerRowExists(prisma, { entityType, entityId, action, assigneeUserId, createdAt: row.createdAt })) {
            totals.duplicatesAvoided += 1;
            log({ label, action: 'DUPLICATE_SKIPPED', entityId, ledgerAction: action, assigneeUserId });
            return;
        }

        if (!dryRun) {
            await prisma.assignmentLedgerEntry.create({
                data: {
                    entityType,
                    entityId,
                    action,
                    assigneeUserId,
                    assignedByUserId,
                    role: row.role || null,
                    previousAssigneeUserId: row.previousAssigneeUserId || null,
                    source: row.source || 'SYSTEM_BACKFILL',
                    reason: row.reason || null,
                    organizationId,
                    createdAt: toDate(row.createdAt) || new Date(),
                },
            });
        }
        totals.created += 1;
        log({ label, action: dryRun ? 'WOULD_CREATE' : 'CREATED', entityId, ledgerAction: action, assigneeUserId });
    } catch (err) {
        totals.errors += 1;
        log({ label, action: 'ERROR', message: err.message });
    }
}

// ── Phase 1: AuditLog ASSIGN events ─────────────────────────────────────────
async function backfillFromAuditLog(prisma, ctx) {
    const rows = await prisma.auditLog.findMany({
        where: { action: { in: ['REVIEWER_ASSIGNED', 'AUDIT_SCHEDULED'] } },
        select: { id: true, action: true, actorId: true, resourceId: true, metadata: true, createdAt: true, organizationId: true },
        orderBy: { createdAt: 'asc' },
    });
    ctx.log({ label: 'auditlog', action: 'PHASE_START', candidates: rows.length });

    for (const a of rows) {
        const meta = asObject(a.metadata);
        const isReviewer = a.action === 'REVIEWER_ASSIGNED';
        await emitRow(prisma, {
            label: 'auditlog',
            row: {
                entityType: 'APPLICATION',
                entityId: a.resourceId,
                action: 'ASSIGN',
                assigneeUserId: isReviewer ? meta.reviewerId : meta.auditorId,
                assignedByUserId: a.actorId || null,
                role: isReviewer ? 'document_reviewer' : 'auditor',
                source: 'SCHEDULER',
                reason: `backfill:${a.action}`,
                organizationId: a.organizationId,
                createdAt: a.createdAt,
            },
            ...ctx,
        });
    }
}

// ── Phase 2: Application._reassignmentHistory (auditor REASSIGN) ─────────────
async function backfillFromReassignmentHistory(prisma, ctx) {
    const apps = await prisma.application.findMany({
        where: { isDeleted: false },
        select: { id: true, formData: true, organizationId: true },
    });
    let withHistory = 0;
    for (const app of apps) {
        const hist = asArray(asObject(app.formData)._reassignmentHistory);
        if (hist.length) { withHistory += 1; }
        for (const entry of hist) {
            await emitRow(prisma, {
                label: 'reassign-history',
                row: {
                    entityType: 'APPLICATION',
                    entityId: app.id,
                    action: 'REASSIGN',
                    assigneeUserId: entry.to,
                    assignedByUserId: entry.reassignedBy || null,
                    previousAssigneeUserId: entry.from || null,
                    role: 'auditor',
                    source: 'SCHEDULER',
                    reason: entry.reason || 'backfill:reassign',
                    organizationId: app.organizationId,
                    createdAt: entry.reassignedAt,
                },
                ...ctx,
            });
        }
    }
    ctx.log({ label: 'reassign-history', action: 'PHASE_START', candidates: withHistory });
}

// ── Phase 3: WorkActivity CLAIM / COMPLETE ──────────────────────────────────
async function backfillFromWorkActivity(prisma, ctx) {
    const activities = await prisma.workActivity.findMany({
        where: { assignedUserId: { not: null } },
        select: {
            id: true, assignedUserId: true, claimedAt: true, state: true,
            completedBy: true, completedAt: true, candidateGroup: true, organizationId: true,
        },
    });
    ctx.log({ label: 'work-activity', action: 'PHASE_START', candidates: activities.length });

    for (const wa of activities) {
        if (wa.claimedAt && wa.state !== 'TODO') {
            await emitRow(prisma, {
                label: 'work-activity',
                row: {
                    entityType: 'WORK_ACTIVITY',
                    entityId: wa.id,
                    action: 'CLAIM',
                    assigneeUserId: wa.assignedUserId,
                    assignedByUserId: null,
                    role: wa.candidateGroup,
                    source: 'SYSTEM_BACKFILL',
                    organizationId: wa.organizationId,
                    createdAt: wa.claimedAt,
                },
                ...ctx,
            });
        }
        if (wa.state === 'DONE' && wa.completedAt) {
            await emitRow(prisma, {
                label: 'work-activity',
                row: {
                    entityType: 'WORK_ACTIVITY',
                    entityId: wa.id,
                    action: 'COMPLETE',
                    assigneeUserId: wa.completedBy || wa.assignedUserId,
                    assignedByUserId: null,
                    role: wa.candidateGroup,
                    source: 'SYSTEM_BACKFILL',
                    organizationId: wa.organizationId,
                    createdAt: wa.completedAt,
                },
                ...ctx,
            });
        }
    }
}

async function backfill({ prisma: injectedPrisma, dryRun = false, log = () => {} } = {}) {
    const prisma = await loadPrisma(injectedPrisma);
    const totals = {
        created: 0,
        duplicatesAvoided: 0,
        skippedIncomplete: 0,
        skippedOrphanAssignee: 0,
        skippedOrphanOrg: 0,
        errors: 0,
    };
    const ctx = { dryRun, log, totals, userCache: new Map(), orgCache: new Map() };

    await backfillFromAuditLog(prisma, ctx);
    await backfillFromReassignmentHistory(prisma, ctx);
    await backfillFromWorkActivity(prisma, ctx);

    return { ranAt: new Date().toISOString(), dryRun, totals };
}

async function main() {
    const { dryRun } = parseArgs(process.argv.slice(2));
    try {
        const result = await backfill({
            dryRun,
            log: (entry) => console.log(JSON.stringify(entry)),
        });
        console.log(JSON.stringify(result));
        process.exit(0);
    } catch (err) {
        console.error(`backfill-assignment-ledger: fatal ${err.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    backfill,
    parseArgs,
    emitRow,
    ledgerRowExists,
    userExists,
    DEDUP_WINDOW_MS,
};
