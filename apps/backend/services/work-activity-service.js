/**
 * @module services/work-activity-service
 *
 * BPMN-aligned work-activity tracking (ADR-016 Phase 1A).
 *
 * Sits alongside `application-status-writer`: when an application moves into
 * a new workflow stage, the writer asks this service to spawn the activities
 * that staff need to complete at that stage. Each activity is one row in
 * `work_activities` with a candidate group (role), assignment fields, state
 * (TODO/CLAIMED/IN_PROGRESS/DONE/CANCELLED) and an SLA target.
 *
 * Key design points:
 *
 *  - Activity completion does NOT auto-advance the application status. The
 *    person who claimed the work clicks "ส่งงาน" → marks activity DONE; then
 *    a separate transition (e.g. ASSIGNED_FOR_REVIEW → DOC_APPROVED) is the
 *    explicit gate. Activity tracking is intentionally decoupled from the
 *    record's status state.
 *
 *  - One open activity per (applicationId, workType, triggeredAtStage). If
 *    the application bounces (REVISION_REQUESTED → ASSIGNED_FOR_REVIEW
 *    again) the existing open activity is reused; we don't spawn a duplicate.
 *
 *  - Candidate group is a single canonical role today (e.g. 'auditor'). When
 *    Phase 3 lands a multi-group user model, this service can be extended to
 *    accept either a role or a group_id without breaking the API.
 */

'use strict';

const { normalizeRole, CANONICAL_ROLES } = require('../shared/canonical-rbac');
const userGroups = require('../shared/user-groups');
const { recordAssignment } = require('./assignment-ledger-service');

// Lazy-loaded to avoid circular imports (notifications import this service
// for the workTypeLabel helper).
let _notifications = null;
function getNotifications() {
    if (!_notifications) {
         
        _notifications = require('./work-activity-notifications');
    }
    return _notifications;
}

// Used as a sentinel for "no policy found" — we still create the row, just
// without dueAt. Otherwise an admin removing an SLA row would block writes.
function addHours(date, hours) {
    if (hours === null || hours === undefined) {
        return null;
    }
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

/**
 * Spawn activities for a newly-entered workflow stage.
 *
 * Idempotent: if an open activity already exists for the same
 * (applicationId, workType, triggeredAtStage) tuple, no row is created.
 *
 * @param {object} args
 * @param {object} args.prisma           — Prisma client OR tx handle
 * @param {string} args.applicationId
 * @param {string} args.toStatus         — workflow stage just entered
 * @param {string} args.organizationId   — for tenant tagging on the new row
 * @param {string} [args.reviewerId]     — when set, the DOC_REVIEW activity for
 *   the document_reviewer candidate group is created PRE-ASSIGNED to this user
 *   (state CLAIMED, assignedUserId=reviewerId) instead of TODO/null. This is the
 *   reviewer already chosen by the SCHEDULER (Application.reviewerId), so they
 *   skip the redundant "claim" step. All OTHER activities (auditor / account /
 *   scheduler) keep the pull model — TODO with no assignee. Ignored unless an
 *   activity's candidateGroup === 'document_reviewer' (or workType DOC_REVIEW).
 * @returns {Promise<Array>} created activity rows (empty if no configs match)
 */
async function createForStage(args) {
    const { prisma, applicationId, toStatus, organizationId, reviewerId = null } = args || {};
    if (!prisma) {throw new TypeError('createForStage: prisma required');}
    if (!applicationId) {throw new TypeError('createForStage: applicationId required');}
    if (!toStatus) {throw new TypeError('createForStage: toStatus required');}
    if (!organizationId) {throw new TypeError('createForStage: organizationId required');}

    const configs = await prisma.stageActivityConfig.findMany({
        where: { workflowStage: toStatus, isActive: true },
        orderBy: { displayOrder: 'asc' },
    });

    if (configs.length === 0) {
        return [];
    }

    const now = new Date();
    const created = [];

    // Both per-config lookups are batched — this runs on EVERY workflow
    // transition, and each was one query per config row.
    //
    // Idempotency guard — skip configs whose open row already exists for this
    // (application, workType, stage). Matches the partial unique index on the
    // table but checked here too so we can return cleanly instead of catching
    // a P2002. ONE probe over all workTypes replaces one findFirst per config.
    const workTypes = configs.map((c) => c.workType);
    const openRows = await prisma.workActivity.findMany({
        where: {
            applicationId,
            workType: { in: workTypes },
            triggeredAtStage: toStatus,
            state: { in: ['TODO', 'CLAIMED', 'IN_PROGRESS'] },
        },
        select: { workType: true },
    });
    const openWorkTypes = new Set(openRows.map((r) => r.workType));

    const policies = await prisma.slaPolicy.findMany({
        where: { workType: { in: workTypes } },
    });
    const policyByWorkType = new Map(policies.map((p) => [p.workType, p]));

    for (const config of configs) {
        if (openWorkTypes.has(config.workType)) {
            continue;
        }

        const policy = policyByWorkType.get(config.workType) || null;
        const dueAt = policy ? addHours(now, policy.targetHours) : null;
        const warningAt = policy ? addHours(now, policy.warningHours) : null;

        // Pre-assign the document-review activity to the reviewer the SCHEDULER
        // already chose (Application.reviewerId). The reviewer was assigned the
        // application itself, so making them ALSO claim the work-activity from
        // the TODO pool is redundant — create it CLAIMED + assigned directly.
        // Every other activity (auditor / account / scheduler) stays on the pull
        // model (TODO, no assignee). Gate on candidateGroup OR workType so a
        // future config that renames one but not the other still pre-assigns.
        const isDocReview = config.candidateGroup === 'document_reviewer'
            || config.workType === 'DOC_REVIEW';
        const preAssign = Boolean(reviewerId) && isDocReview;

        const row = await prisma.workActivity.create({
            data: {
                applicationId,
                workType: config.workType,
                candidateGroup: config.candidateGroup,
                state: preAssign ? 'CLAIMED' : 'TODO',
                assignedUserId: preAssign ? reviewerId : null,
                claimedAt: preAssign ? now : null,
                triggeredAtStage: toStatus,
                dueAt,
                warningAt,
                organizationId,
            },
        });
        created.push(row);

        // Work-distribution ledger (best-effort, never throws): a pre-assign is
        // a SCHEDULER-driven assignment, not a self-claim — mirror the claim()
        // ledger row but with source=SCHEDULER and no central assigner id (the
        // SCHEDULER acted via the assign-reviewer transition, not this service).
        if (preAssign) {
            await recordAssignment({
                prisma,
                entityType: 'WORK_ACTIVITY',
                entityId: row.id,
                action: 'ASSIGN',
                assigneeUserId: reviewerId,
                assignedByUserId: null,
                role: config.candidateGroup,
                source: 'SCHEDULER',
                organizationId,
            });
        }
    }

    return created;
}

/**
 * Ad-hoc (non-stage-config) work item — hardening batch 2026-07-09.
 *
 * Some work is triggered by an EVENT, not a status transition (first case: a
 * waiver reopen petition — the app stays EXPIRED, so createForStage never
 * fires, and seeding a stage_activity_config for EXPIRED would wrongly spawn
 * an item on EVERY expiry). This helper keeps all WorkActivity writes in this
 * module: same idempotency guard as createForStage (one open row per
 * (applicationId, workType, stage) — mirrors the partial unique), pull-model
 * TODO row, caller supplies the dueAt (event-specific SLA).
 * Returns the created row, or null when an open row already exists.
 */
async function createAdHocActivity(args) {
    const {
        prisma, applicationId, workType, candidateGroup,
        triggeredAtStage, organizationId, dueAt = null, note = null,
    } = args || {};
    if (!prisma) {throw new TypeError('createAdHocActivity: prisma required');}
    if (!applicationId) {throw new TypeError('createAdHocActivity: applicationId required');}
    if (!workType) {throw new TypeError('createAdHocActivity: workType required');}
    if (!candidateGroup) {throw new TypeError('createAdHocActivity: candidateGroup required');}
    if (!triggeredAtStage) {throw new TypeError('createAdHocActivity: triggeredAtStage required');}
    if (!organizationId) {throw new TypeError('createAdHocActivity: organizationId required');}

    const existing = await prisma.workActivity.findFirst({
        where: {
            applicationId,
            workType,
            triggeredAtStage,
            state: { in: ['TODO', 'CLAIMED', 'IN_PROGRESS'] },
        },
        select: { id: true },
    });
    if (existing) { return null; }

    return prisma.workActivity.create({
        data: {
            applicationId,
            workType,
            candidateGroup,
            state: 'TODO',
            assignedUserId: null,
            triggeredAtStage,
            dueAt,
            organizationId,
            note,
        },
    });
}

/**
 * Close every open row of one (applicationId, workType[, stage]) — the decide
 * half of an ad-hoc item. updateMany matching 0 rows is a safe no-op (covers
 * items created before this feature + the batch lane which never spawns one).
 */
async function completeAdHocActivity(args) {
    const { prisma, applicationId, workType, triggeredAtStage, completedBy, note = null } = args || {};
    if (!prisma) {throw new TypeError('completeAdHocActivity: prisma required');}
    if (!applicationId || !workType) {throw new TypeError('completeAdHocActivity: applicationId + workType required');}
    return prisma.workActivity.updateMany({
        where: {
            applicationId,
            workType,
            ...(triggeredAtStage ? { triggeredAtStage } : {}),
            state: { in: ['TODO', 'CLAIMED', 'IN_PROGRESS'] },
        },
        data: {
            state: 'DONE',
            completedAt: new Date(),
            completedBy: completedBy || null,
            ...(note ? { note } : {}),
        },
    });
}

/**
 * Claim an open activity. The user must hold the candidate role (or be
 * admin). State transitions TODO → CLAIMED.
 *
 * Throws if the activity is already claimed by someone else, or the user's
 * role doesn't match the candidate group.
 */
async function claim(args) {
    const { prisma, activityId, userId, userRole, organizationId } = args || {};
    if (!activityId || !userId) {
        throw new TypeError('claim: activityId + userId required');
    }

    const activity = await prisma.workActivity.findUnique({ where: { id: activityId } });
    if (!activity) {
        throw new Error(`Activity ${activityId} not found`);
    }
    // Tenant guard (audit 2.6): findUnique-by-id is NOT org-scoped by the
    // tenant extension, so a caller in tenant A could claim/mutate tenant B's
    // activity. When the caller carries an organizationId (route passes null
    // for PLATFORM_ADMIN, the cross-tenant role), reject a cross-tenant row as
    // not-found (anti-enumeration). Fail-open when no org is supplied
    // (system/legacy/test callers) to preserve existing behaviour.
    if (organizationId && activity.organizationId && activity.organizationId !== organizationId) {
        throw new Error(`Activity ${activityId} not found`);
    }
    if (activity.state !== 'TODO') {
        throw new Error(`Activity is already ${activity.state}; cannot claim`);
    }

    // Phase 1C: check group membership via M2M (with User.role fallback
    // for users who haven't been added to memberships yet). userInGroup
    // returns true for admins automatically, so the explicit isAdmin
    // shortcut from Phase 1A is no longer needed.
    const allowed = await userGroups.userInGroup(prisma, userId, activity.candidateGroup);
    if (!allowed) {
        const roleHint = normalizeRole(userRole) || 'unknown';
        throw new Error(
            `Role ${roleHint} cannot claim ${activity.candidateGroup} work`,
        );
    }

    const updated = await prisma.workActivity.update({
        where: { id: activityId },
        data: {
            state: 'CLAIMED',
            assignedUserId: userId,
            claimedAt: new Date(),
        },
    });

    // Work-distribution ledger (best-effort): a self-claim from the candidate-
    // group pool — assignedBy=null (no central assigner), source=SELF_CLAIM.
    await recordAssignment({
        prisma,
        entityType: 'WORK_ACTIVITY',
        entityId: activity.id,
        action: 'CLAIM',
        assigneeUserId: userId,
        assignedByUserId: null,
        role: activity.candidateGroup,
        source: 'SELF_CLAIM',
        organizationId: activity.organizationId,
    });

    // Best-effort assignment notification — fire-and-forget so a notif
    // failure doesn't break the claim. The notification dispatcher is
    // already best-effort internally; we just don't await its result.
    Promise.resolve()
        .then(() => getNotifications().notifyAssigned(updated))
        .catch(() => {
            /* swallowed — notif service logs its own warns */
        });

    return updated;
}

/**
 * Release a claimed activity back to the queue. State transitions
 * CLAIMED|IN_PROGRESS → TODO.
 */
async function unclaim(args) {
    const { prisma, activityId, userId, userRole: _userRole, organizationId } = args || {};
    if (!activityId || !userId) {
        throw new TypeError('unclaim: activityId + userId required');
    }

    const activity = await prisma.workActivity.findUnique({ where: { id: activityId } });
    if (!activity) {
        throw new Error(`Activity ${activityId} not found`);
    }
    // Tenant guard (audit 2.6) — see claim(): reject cross-tenant rows as not-found.
    if (organizationId && activity.organizationId && activity.organizationId !== organizationId) {
        throw new Error(`Activity ${activityId} not found`);
    }
    if (!['CLAIMED', 'IN_PROGRESS'].includes(activity.state)) {
        throw new Error(`Activity is ${activity.state}; cannot unclaim`);
    }

    // Phase 1C: admin via group membership (User.role fallback inside).
    const isAdmin = await userGroups.userInGroup(prisma, userId, CANONICAL_ROLES.SYSTEM_ADMIN_DTAM);
    if (!isAdmin && activity.assignedUserId !== userId) {
        throw new Error('Only the assignee or an admin can unclaim');
    }

    const released = await prisma.workActivity.update({
        where: { id: activityId },
        data: {
            state: 'TODO',
            assignedUserId: null,
            claimedAt: null,
            startedAt: null,
        },
    });

    // Ledger (best-effort): record who released work that was assigned to whom.
    await recordAssignment({
        prisma,
        entityType: 'WORK_ACTIVITY',
        entityId: activity.id,
        action: 'UNCLAIM',
        assigneeUserId: activity.assignedUserId || userId,
        assignedByUserId: userId,
        role: activity.candidateGroup,
        source: 'SELF_CLAIM',
        organizationId: activity.organizationId,
    });

    return released;
}

/**
 * Mark an activity DONE. The application status is NOT advanced — that's
 * a separate workflow-transition call. This keeps activity-completion and
 * stage-advance as independent gates (BPMN-style).
 */
async function markDone(args) {
    const { prisma, activityId, userId, userRole: _userRole, note, organizationId } = args || {};
    if (!activityId || !userId) {
        throw new TypeError('markDone: activityId + userId required');
    }

    const activity = await prisma.workActivity.findUnique({ where: { id: activityId } });
    if (!activity) {
        throw new Error(`Activity ${activityId} not found`);
    }
    // Tenant guard (audit 2.6) — see claim(): reject cross-tenant rows as not-found.
    if (organizationId && activity.organizationId && activity.organizationId !== organizationId) {
        throw new Error(`Activity ${activityId} not found`);
    }
    if (['DONE', 'CANCELLED'].includes(activity.state)) {
        throw new Error(`Activity is already ${activity.state}`);
    }

    const isAdmin = await userGroups.userInGroup(prisma, userId, CANONICAL_ROLES.SYSTEM_ADMIN_DTAM);
    if (!isAdmin && activity.assignedUserId && activity.assignedUserId !== userId) {
        throw new Error('Only the assignee or an admin can mark this done');
    }

    const now = new Date();
    const done = await prisma.workActivity.update({
        where: { id: activityId },
        data: {
            state: 'DONE',
            completedAt: now,
            completedBy: userId,
            // Track who actually did it, even if no one had explicitly claimed
            // (admin override or single-step "claim+done" from the UI).
            assignedUserId: activity.assignedUserId || userId,
            claimedAt: activity.claimedAt || now,
            startedAt: activity.startedAt || now,
            note: note || activity.note,
        },
    });

    // Ledger (best-effort): work completed by this user.
    await recordAssignment({
        prisma,
        entityType: 'WORK_ACTIVITY',
        entityId: activity.id,
        action: 'COMPLETE',
        assigneeUserId: userId,
        assignedByUserId: null,
        role: activity.candidateGroup,
        source: 'SELF_CLAIM',
        organizationId: activity.organizationId,
    });

    return done;
}

/**
 * Cancel an activity. Used when the application is rejected or withdrawn,
 * or when the work is no longer relevant (e.g. phase moved backward).
 */
async function cancel(args) {
    const { prisma, activityId, reason } = args || {};
    if (!activityId) {throw new TypeError('cancel: activityId required');}

    const activity = await prisma.workActivity.findUnique({ where: { id: activityId } });
    if (!activity) {
        throw new Error(`Activity ${activityId} not found`);
    }
    if (['DONE', 'CANCELLED'].includes(activity.state)) {
        // Idempotent: cancelling an already-terminal row is a no-op.
        return activity;
    }

    const cancelled = await prisma.workActivity.update({
        where: { id: activityId },
        data: {
            state: 'CANCELLED',
            cancelledAt: new Date(),
            cancelReason: reason || null,
        },
    });

    // Ledger (best-effort): only meaningful if the work was assigned to someone
    // (system-initiated; recordAssignment skips when assigneeUserId is absent).
    if (activity.assignedUserId) {
        await recordAssignment({
            prisma,
            entityType: 'WORK_ACTIVITY',
            entityId: activity.id,
            action: 'CANCEL',
            assigneeUserId: activity.assignedUserId,
            assignedByUserId: null,
            role: activity.candidateGroup,
            source: 'SYSTEM',
            reason: reason || null,
            organizationId: activity.organizationId,
        });
    }

    return cancelled;
}

/**
 * Cancel any open activities for an application that aren't relevant after
 * the new status. Used by the application-status-writer when an application
 * gets rejected, expired, or moved backward (so the old open activity for
 * the previous stage doesn't sit forever as an "overdue" item).
 */
async function cancelOpenForStage(args) {
    const { prisma, applicationId, triggeredAtStage, reason } = args || {};
    if (!prisma || !applicationId || !triggeredAtStage) {
        throw new TypeError('cancelOpenForStage: prisma, applicationId, triggeredAtStage required');
    }

    return prisma.workActivity.updateMany({
        where: {
            applicationId,
            triggeredAtStage,
            state: { in: ['TODO', 'CLAIMED', 'IN_PROGRESS'] },
        },
        data: {
            state: 'CANCELLED',
            cancelledAt: new Date(),
            cancelReason: reason || 'Stage left without completion',
        },
    });
}

/**
 * List the work items relevant to a given user — both unassigned items
 * they're eligible to claim, and items already assigned to them.
 *
 * @param {object} args
 * @param {object} args.prisma
 * @param {string} args.userId
 * @param {string} args.userRole
 * @param {string[]} [args.workTypes]   — filter (defaults to all)
 * @param {number} [args.limit]
 */
async function listMyTodo(args) {
    const { prisma, userId, userRole, workTypes, organizationId, limit = 50 } = args || {};
    if (!userId) {throw new TypeError('listMyTodo: userId required');}

    // Phase 1C: resolve every group the user belongs to, not just the
    // primary role. A user with both DOCUMENT_REVIEWER + AUDITOR groups
    // sees claimable rows for both candidateGroup values.
    let groups = await userGroups.getUserGroups(prisma, userId);
    if (groups.length === 0) {
        // Defensive fallback if memberships table is empty AND User.role
        // resolution failed — try the explicit userRole hint.
        const hint = normalizeRole(userRole);
        if (hint) {groups = [hint];}
    }
    if (groups.length === 0) {
        return [];
    }

    // Admin sees everything claimable regardless of candidateGroup.
    const isAdmin = groups.includes(CANONICAL_ROLES.SYSTEM_ADMIN_DTAM);

    const where = {
        state: { in: ['TODO', 'CLAIMED', 'IN_PROGRESS'] },
        OR: [
            { assignedUserId: userId },
            isAdmin
                ? { state: 'TODO', assignedUserId: null }
                : { state: 'TODO', candidateGroup: { in: groups }, assignedUserId: null },
        ],
    };
    // ADR-014 Phase 3b-D1: scope the inbox to the caller's org UNCONDITIONALLY
    // (not via the TENANT_READ_ORG_SCOPE flag). candidateGroup is a GLOBAL role
    // code, so without this an org-A actor would see org-B's TODO pool once a 2nd
    // tenant exists. Defensive: only applied when an org is supplied, so the SLA
    // cron / context-less callers are unaffected. Behaviour-identical where the
    // read-scope flag is already ON (the extension injects the same org).
    if (organizationId) {
        where.organizationId = organizationId;
    }
    if (Array.isArray(workTypes) && workTypes.length > 0) {
        where.workType = { in: workTypes };
    }

    return prisma.workActivity.findMany({
        where,
        take: limit,
        orderBy: [
            { dueAt: { sort: 'asc', nulls: 'last' } },
            { createdAt: 'asc' },
        ],
        include: {
            application: {
                select: {
                    id: true,
                    applicationNumber: true,
                    status: true,
                    applicant: { select: { firstName: true, lastName: true, email: true } },
                },
            },
        },
    });
}

/**
 * Queue view — list activities visible to a candidate group. Filterable by
 * workType + state. Used by the "งานในคิว" tab and by managers.
 */
async function listForGroup(args) {
    const { prisma, role, workTypes, states, organizationId, limit = 100 } = args || {};
    const canonicalRole = normalizeRole(role);
    if (!canonicalRole) {
        return [];
    }

    const where = { candidateGroup: canonicalRole };
    // ADR-014 Phase 3b-D1: unconditionally scope the group queue to the caller's
    // org (candidateGroup is a global role code → cross-tenant without this). See
    // listMyTodo. Defensive: applied only when org supplied; cron unaffected.
    if (organizationId) {
        where.organizationId = organizationId;
    }
    if (Array.isArray(workTypes) && workTypes.length > 0) {
        where.workType = { in: workTypes };
    }
    if (Array.isArray(states) && states.length > 0) {
        where.state = { in: states };
    } else {
        where.state = { in: ['TODO', 'CLAIMED', 'IN_PROGRESS'] };
    }

    return prisma.workActivity.findMany({
        where,
        take: limit,
        orderBy: [
            { dueAt: { sort: 'asc', nulls: 'last' } },
            { createdAt: 'asc' },
        ],
        include: {
            application: {
                select: {
                    id: true,
                    applicationNumber: true,
                    status: true,
                    applicant: { select: { firstName: true, lastName: true, email: true } },
                },
            },
            assignedUser: { select: { id: true, firstName: true, lastName: true } },
        },
    });
}

/**
 * SLA cron entry — list rows whose dueAt has passed and which are still
 * open. Used by work-activity-sla-monitor (added in a follow-up PR).
 */
async function listOverdue(args) {
    const { prisma, asOf = new Date(), limit = 500 } = args || {};
    return prisma.workActivity.findMany({
        where: {
            state: { in: ['TODO', 'CLAIMED', 'IN_PROGRESS'] },
            dueAt: { lte: asOf },
        },
        take: limit,
        orderBy: { dueAt: 'asc' },
        include: {
            application: { select: { id: true, applicationNumber: true } },
            assignedUser: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
    });
}

/**
 * Count OPEN work activities for a candidate group that are overdue
 * (dueAt <= asOf) or breached (breachedAt != null).
 *
 * Read-only SLA visibility (Wave-3 P1-H). Used by the scheduler dashboard
 * to surface an "overdue/breached" tile for the scheduler's own work queue.
 * Complements the SLA cron `listOverdue` (which is cross-tenant and
 * notification-driven) — this one is per-group + org-scoped for a UI count.
 *
 * Org-scoped exactly like listForGroup: candidateGroup is a GLOBAL role code,
 * so without organizationId the count would span tenants. Applied only when
 * organizationId is supplied (defensive; a null-org caller counts globally,
 * matching the existing group-query semantics).
 *
 * @param {object} args
 * @param {object} args.prisma
 * @param {string} args.role              — candidate group role (e.g. 'scheduler')
 * @param {Date}   [args.asOf]            — "now" (default new Date())
 * @param {string} [args.organizationId]  — tenant scope
 * @returns {Promise<number>} count of open overdue/breached activities
 */
async function countOverdueForGroup(args) {
    const { prisma, role, asOf = new Date(), organizationId } = args || {};
    const canonicalRole = normalizeRole(role);
    if (!canonicalRole) {
        return 0;
    }

    const where = {
        candidateGroup: canonicalRole,
        state: { in: ['TODO', 'CLAIMED', 'IN_PROGRESS'] },
        // Overdue (dueAt has passed) OR breached (SLA monitor stamped breachedAt).
        OR: [
            { dueAt: { lte: asOf } },
            { breachedAt: { not: null } },
        ],
    };
    if (organizationId) {
        where.organizationId = organizationId;
    }

    return prisma.workActivity.count({ where });
}

module.exports = {
    createForStage,
    createAdHocActivity,
    completeAdHocActivity,
    claim,
    unclaim,
    markDone,
    cancel,
    cancelOpenForStage,
    listMyTodo,
    listForGroup,
    listOverdue,
    countOverdueForGroup,
};
