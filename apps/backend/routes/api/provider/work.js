/**
 * Routes: /api/provider/work/*
 *
 * BPMN-aligned work queue for provider staff (ADR-016 Phase 1A).
 *
 *   GET  /my                  — items assigned to me + items I'm eligible to claim
 *   GET  /queue               — queue for my candidate group (filterable)
 *   GET  /:id/next-states     — legal workflow transitions for the user (Phase 3)
 *   POST /:id/claim           — claim an open item
 *   POST /:id/unclaim         — release an item back to the queue
 *   POST /:id/done            — mark item DONE; optional advanceStatus advances
 *                              the application's workflow status atomically
 */

'use strict';

const express = require('express');
const {
    prisma,
    authenticateProvider,
    logger,
    normalizeRole,
} = require('./handlers/shared');
const workActivityService = require('../../../services/work-activity-service');
const { respondError } = require('../../../shared/api-response');
const { CANONICAL_ROLES } = require('../../../shared/canonical-rbac');
const userGroupsHelper = require('../../../shared/user-groups');
const workflowTransitionService = require('../../../services/workflow-transition-service');
const { writeApplicationStatus } = require('../../../services/application-status-writer');

const router = express.Router();

// WF-1 (audit follow-up 2026-06-23): the document-review DECISION must NOT be made
// on the generic work-inbox surface. work.js advances status via writeApplicationStatus
// directly — it does NOT run the canonical side-effects (workflow-side-effects.js):
// the SYSTEM auto-chain DOC_APPROVED→PENDING_AUDIT_FEE + Phase-2 invoicing, the
// 5-working-day RevisionDeadline + applicant notice, and the immutable AuditLog. Making
// the decision here STRANDS the application (status flips but the next leg never starts).
// So the work-inbox blocks these two states (422) and the FE funnels the reviewer to the
// canonical /provider/applications/:id review screen, which runs all side-effects.
//
// R2 M3b fix cycle 1 (2026-08-03, evidence/R2-special-reopen/M3b/audit-report.md F1):
// REJECTED joins them for the SAME structural reason, one step more serious. A terminal
// rejection carries two MANDATORY side-effects this surface runs neither of:
//   1. the administrative-order letter (จดหมายคำสั่งทางปกครอง, the official-letter
//      notification kind) minted in the SAME transaction as the status write — D-8 in
//      evidence/R2-special-reopen/decisions-final.md:52 is "ออกจดหมายไม่ได้ = REJECT
//      ไม่สำเร็จ". This file never loads decision-letter-service, so a REJECT taken here
//      ended the case with NO administrative order ever reaching the applicant.
//   2. the immutable hash-chained AuditLog — the writeApplicationStatus call below
//      passes no `onAudit` hook, unlike the canonical surface
//      (handlers/workflow-transitions-handler.js:472).
// The capability is NOT removed: AUDIT_CONFIRMED->REJECTED is the only edge into
// REJECTED in the machine (services/workflow-transition-service.js:65) and it is held by
// the auditor role only (`approver` normalises to `auditor`, shared/canonical-rbac.js) —
// that role reaches the same edge on both letter-minting surfaces:
// handlers/workflow-transitions-handler.js (POST /provider/applications/:id/workflow-
// transitions) and handlers/auditor-audit-decision-handler.js (decision=REJECT).
// Keeping the enforcement points at THREE rather than growing a fourth is the Law 3.6
// (single source of truth) direction.
const WORK_INBOX_BLOCKED_DECISION_STATES = new Set(['DOC_APPROVED', 'REVISION_REQUESTED', 'REJECTED']);

router.use(authenticateProvider);

function getActorRole(req) {
    return normalizeRole(req.user?.canonicalRole || req.user?.role);
}

// Tenant scope for activity mutations (audit 2.6): PLATFORM_ADMIN is the only
// cross-tenant role → exempt (null); everyone else is pinned to their org so a
// by-id claim/unclaim/done can't reach into another tenant's activity. Mirrors
// the GET /:id and /:id/next-states guards above.
function getActorOrgId(req) {
    return getActorRole(req) === CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM
        ? null
        : (req.user?.organizationId || null);
}

function shapeActivity(row) {
    return {
        id: row.id,
        applicationId: row.applicationId,
        applicationNumber: row.application?.applicationNumber || null,
        applicationStatus: row.application?.status || null,
        applicantName:
            [row.application?.applicant?.firstName, row.application?.applicant?.lastName]
                .filter(Boolean)
                .join(' ')
                .trim() || null,
        workType: row.workType,
        candidateGroup: row.candidateGroup,
        state: row.state,
        assignedUserId: row.assignedUserId,
        assignedUserName:
            [row.assignedUser?.firstName, row.assignedUser?.lastName]
                .filter(Boolean)
                .join(' ')
                .trim() || null,
        triggeredAtStage: row.triggeredAtStage,
        dueAt: row.dueAt,
        warningAt: row.warningAt,
        claimedAt: row.claimedAt,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        cancelledAt: row.cancelledAt,
        cancelReason: row.cancelReason,
        note: row.note,
        createdAt: row.createdAt,
        isOverdue: row.dueAt ? new Date(row.dueAt) < new Date() && !['DONE', 'CANCELLED'].includes(row.state) : false,
    };
}

router.get('/my', async (req, res) => {
    try {
        const userRole = getActorRole(req);
        if (!userRole) {
            return res.status(403).json({ success: false, error: 'No role on token' });
        }

        const workTypes = req.query.workType
            ? String(req.query.workType).split(',').map((s) => s.trim()).filter(Boolean)
            : null;
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

        const rows = await workActivityService.listMyTodo({
            prisma,
            userId: req.user.id,
            userRole,
            workTypes,
            organizationId: req.user.organizationId, // Phase 3b-D2: unconditional org-scope
            limit,
        });

        return res.json({
            success: true,
            data: rows.map(shapeActivity),
            counts: {
                total: rows.length,
                claimed: rows.filter((r) => r.assignedUserId === req.user.id).length,
                unclaimed: rows.filter((r) => !r.assignedUserId).length,
                overdue: rows.filter(
                    (r) => r.dueAt && new Date(r.dueAt) < new Date(),
                ).length,
            },
        });
    } catch (e) {
        return respondError(res, req, e, { label: '[provider/work] list my', message: 'Failed to load work items' });
    }
});

router.get('/queue', async (req, res) => {
    try {
        const userRole = getActorRole(req);
        if (!userRole) {
            return res.status(403).json({ success: false, error: 'No role on token' });
        }

        // Phase 1C: any user can query a queue for any group they belong
        // to (or admins for any group). Default = first group (which is
        // the legacy User.role for users without explicit memberships).
        const groupParam = String(req.query.group || '').trim().toLowerCase();
        const myGroups = await userGroupsHelper.getUserGroups(prisma, req.user.id);
        const isAdmin = myGroups.includes(CANONICAL_ROLES.SYSTEM_ADMIN_DTAM);
        let targetGroup;
        if (groupParam) {
            if (!isAdmin && !myGroups.includes(groupParam)) {
                return res.status(403).json({
                    success: false,
                    error: `You are not a member of the ${groupParam} group`,
                });
            }
            targetGroup = groupParam;
        } else {
            // Default to the user's primary role hint, falling back to
            // first group if userRole is undefined.
            targetGroup = userRole || myGroups[0];
        }
        if (!targetGroup) {
            return res.json({ success: true, data: [], meta: { group: null, count: 0 } });
        }

        const workTypes = req.query.workType
            ? String(req.query.workType).split(',').map((s) => s.trim()).filter(Boolean)
            : null;
        const states = req.query.state
            ? String(req.query.state).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
            : null;
        const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

        const rows = await workActivityService.listForGroup({
            prisma,
            role: targetGroup,
            workTypes,
            states,
            organizationId: req.user.organizationId, // Phase 3b-D2: unconditional org-scope
            limit,
        });

        return res.json({
            success: true,
            data: rows.map(shapeActivity),
            meta: { group: targetGroup, count: rows.length },
        });
    } catch (e) {
        return respondError(res, req, e, { label: '[provider/work] queue', message: 'Failed to load work queue' });
    }
});

// Detail: /:id MUST come AFTER static-path GETs (/my, /queue) so Express
// doesn't intercept those as `:id = "my"` etc.
router.get('/:id', async (req, res) => {
    try {
        const userRole = getActorRole(req);
        if (!userRole) {
            return res.status(403).json({ success: false, error: 'No role on token' });
        }
        const row = await prisma.workActivity.findUnique({
            where: { id: req.params.id },
            include: {
                application: {
                    select: {
                        id: true,
                        applicationNumber: true,
                        status: true,
                        applicant: {
                            select: { firstName: true, lastName: true, email: true },
                        },
                    },
                },
                assignedUser: { select: { id: true, firstName: true, lastName: true } },
                completer: { select: { id: true, firstName: true, lastName: true } },
            },
        });
        if (!row) {
            return res.status(404).json({ success: false, error: 'Activity not found' });
        }
        // Tenant guard: candidateGroup is a GLOBAL role code (e.g. "SCHEDULER"), so the
        // assignee/group check below is NOT a tenant boundary — without this an org-A
        // actor could read an org-B activity (+ its applicant PII). findUnique is not
        // org-scoped by the tenant extension (findMany/findFirst/count only). Scope to
        // the actor's org; PLATFORM_ADMIN (cross-tenant) is exempt.
        if (userRole !== CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM
            && req.user.organizationId
            && row.organizationId !== req.user.organizationId) {
            return res.status(404).json({ success: false, error: 'Activity not found' });
        }
        // Phase 1C: visibility = admin (via group OR legacy role) OR
        // assignee OR member of the candidate group.
        const isAssignee = row.assignedUserId === req.user.id;
        const inGroup = await userGroupsHelper.userInGroup(
            prisma,
            req.user.id,
            row.candidateGroup,
        );
        if (!isAssignee && !inGroup) {
            return res.status(403).json({ success: false, error: 'Forbidden' });
        }
        // PII minimisation (PHASE-1 role-correctness): the work queue is a SHARED
        // candidate-group inbox, so any group member can open an unclaimed task's
        // detail. The applicant's email is contact data only the person actually
        // working the case needs — gate it to the ASSIGNEE. Triage (name +
        // applicationNumber + status + SLA) stays available to the whole group via
        // shapeActivity(); the list views never carried email. Non-assignees get null
        // (the FE already renders email conditionally).
        return res.json({
            success: true,
            data: {
                ...shapeActivity(row),
                completedByName:
                    [row.completer?.firstName, row.completer?.lastName]
                        .filter(Boolean)
                        .join(' ')
                        .trim() || null,
                applicantEmail: isAssignee ? (row.application?.applicant?.email || null) : null,
            },
        });
    } catch (e) {
        return respondError(res, req, e, { label: '[provider/work] detail', message: 'Failed to load work item' });
    }
});

router.post('/:id/claim', async (req, res) => {
    try {
        const userRole = getActorRole(req);
        const updated = await workActivityService.claim({
            prisma,
            activityId: req.params.id,
            userId: req.user.id,
            userRole,
            organizationId: getActorOrgId(req),
        });
        return res.json({ success: true, data: shapeActivity(updated) });
    } catch (e) {
        logger.warn('[provider/work] claim failed:', e.message);
        return res.status(400).json({ success: false, error: e.message });
    }
});

router.post('/:id/unclaim', async (req, res) => {
    try {
        const userRole = getActorRole(req);
        const updated = await workActivityService.unclaim({
            prisma,
            activityId: req.params.id,
            userId: req.user.id,
            userRole,
            organizationId: getActorOrgId(req),
        });
        return res.json({ success: true, data: shapeActivity(updated) });
    } catch (e) {
        logger.warn('[provider/work] unclaim failed:', e.message);
        return res.status(400).json({ success: false, error: e.message });
    }
});

// Phase 3: legal workflow transitions for the user from the activity's
// application's current status. Used by the smart action panel on the
// activity detail page so the user can pick "ปิดงาน + เลื่อนไป X" with
// only valid options shown.
router.get('/:id/next-states', async (req, res) => {
    try {
        const userRole = getActorRole(req);
        if (!userRole) {
            return res.status(403).json({ success: false, error: 'No role on token' });
        }
        const activity = await prisma.workActivity.findUnique({
            where: { id: req.params.id },
            select: {
                id: true,
                applicationId: true,
                organizationId: true,
                application: { select: { id: true, status: true, formData: true } },
            },
        });
        if (!activity || !activity.application) {
            return res.status(404).json({ success: false, error: 'Activity not found' });
        }
        // Tenant guard (see GET /:id): org-scope the by-id lookup so a cross-org actor
        // can't read another tenant's activity (application status/formData). findUnique
        // isn't org-scoped by the tenant extension. PLATFORM_ADMIN (cross-tenant) exempt.
        if (userRole !== CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM
            && req.user.organizationId
            && activity.organizationId !== req.user.organizationId) {
            return res.status(404).json({ success: false, error: 'Activity not found' });
        }
        const currentState = workflowTransitionService.resolveStateFromApplication(activity.application);
        const allowed = workflowTransitionService.ALLOWED_TRANSITIONS[currentState];
        const targets = allowed ? Array.from(allowed) : [];

        // The user's roles include both their primary role and any
        // M2M memberships — check transition perms for each so a
        // multi-group user (auditor + document_reviewer) sees the
        // union of legal moves.
        const userGroups = await userGroupsHelper.getUserGroups(prisma, req.user.id);
        const isAdmin = userGroups.includes(CANONICAL_ROLES.SYSTEM_ADMIN_DTAM);

        const options = targets
            .filter((to) => {
                // WF-1 + R2 M3b: never offer a decision that carries mandatory
                // side-effects (document decision, terminal rejection) on the
                // work-inbox — it must go through the canonical review screen.
                if (WORK_INBOX_BLOCKED_DECISION_STATES.has(to)) {return false;}
                if (isAdmin) {return true;}
                return userGroups.some((role) =>
                    workflowTransitionService.canRoleTransition(role, currentState, to),
                );
            })
            .map((to) => ({
                toState: to,
                requiresComment: workflowTransitionService.REQUIRES_COMMENT_TARGETS.has(to),
            }));

        return res.json({
            success: true,
            data: {
                currentStatus: currentState,
                options,
            },
        });
    } catch (e) {
        return respondError(res, req, e, { label: '[provider/work] next-states', message: 'Failed to load next states' });
    }
});

router.post('/:id/done', async (req, res) => {
    try {
        const userRole = getActorRole(req);
        const note = req.body?.note ? String(req.body.note).slice(0, 1000) : null;
        const advanceStatus = req.body?.advanceStatus || null;

        // No advance requested — keep the original simple path.
        if (!advanceStatus) {
            const updated = await workActivityService.markDone({
                prisma,
                activityId: req.params.id,
                userId: req.user.id,
                userRole,
                note,
                organizationId: getActorOrgId(req),
            });
            return res.json({ success: true, data: { activity: shapeActivity(updated) } });
        }

        // Phase 3: combined markDone + workflow-transition. Atomic — if
        // the transition fails (illegal target, role perms, missing
        // mandatory comment) the markDone is rolled back too.
        const toState = String(advanceStatus.toState || '').trim().toUpperCase();
        const reasonCode = advanceStatus.reasonCode || null;
        const comment = advanceStatus.comment || null;
        if (!toState) {
            return res.status(400).json({
                success: false,
                error: 'advanceStatus.toState required',
            });
        }
        // WF-1 + R2 M3b: a decision with mandatory side-effects (document review
        // DOC_APPROVED / REVISION_REQUESTED, terminal REJECTED) must go through the
        // canonical /provider/applications/:id/workflow-transitions handler, which runs
        // them (auto-chain to PENDING_AUDIT_FEE + Phase-2 invoicing, the 5-working-day
        // RevisionDeadline + applicant notice, the terminal administrative-order letter,
        // the immutable AuditLog). This surface writes status directly (none of those),
        // so refuse the decision here — the FE already funnels the actor to the detail
        // screen. See WORK_INBOX_BLOCKED_DECISION_STATES above for the full reasoning.
        if (WORK_INBOX_BLOCKED_DECISION_STATES.has(toState)) {
            return res.status(422).json({
                success: false,
                code: 'USE_CANONICAL_REVIEW',
                error: 'การตัดสินผลคำขอ (อนุมัติเอกสาร / ขอแก้ไข / ไม่รับรอง) ต้องทำผ่านหน้ารายละเอียดคำขอ เพื่อให้ระบบดำเนินการขั้นถัดไปครบถ้วน ทั้งการแจ้งผลและการออกหนังสือแจ้งคำสั่ง',
            });
        }
        // Pre-flight: surface an obvious 400 instead of waiting for the
        // tx to fail mid-flight.
        const userGroups = await userGroupsHelper.getUserGroups(prisma, req.user.id);
        if (workflowTransitionService.REQUIRES_COMMENT_TARGETS.has(toState) && !comment?.trim()) {
            return res.status(400).json({
                success: false,
                error: `Transition to ${toState} requires a comment`,
            });
        }

        try {
            const result = await prisma.$transaction(async (tx) => {
                const activity = await workActivityService.markDone({
                    prisma: tx,
                    activityId: req.params.id,
                    userId: req.user.id,
                    userRole,
                    note,
                    organizationId: getActorOrgId(req),
                });

                // Resolve current state from the activity's application,
                // then validate the transition for any of the user's groups.
                const application = await tx.application.findUnique({
                    where: { id: activity.applicationId },
                    select: { id: true, status: true, formData: true, healthId: true },
                });
                if (!application) {throw new Error('Application not found');}
                const currentState = workflowTransitionService.resolveStateFromApplication(application);
                const isAdmin = userGroups.includes(CANONICAL_ROLES.SYSTEM_ADMIN_DTAM);
                const allowed =
                    isAdmin ||
                    userGroups.some((role) =>
                        workflowTransitionService.canRoleTransition(role, currentState, toState),
                    );
                if (!allowed) {
                    throw new Error(`Role(s) ${userGroups.join('+')} cannot transition ${currentState} → ${toState}`);
                }
                if (!workflowTransitionService.canTransition(currentState, toState)) {
                    throw new Error(`Invalid transition ${currentState} → ${toState}`);
                }
                // NB: the document-review decision states (DOC_APPROVED /
                // REVISION_REQUESTED) are rejected in the pre-flight above (422
                // USE_CANONICAL_REVIEW), so the reviewer-ownership (REV-11) gate that
                // used to live here is unreachable — the canonical handler
                // (workflow-transitions-handler.js) is the sole enforcement point for it.

                const formData = (application.formData && typeof application.formData === 'object') ? application.formData : {};
                // The status column and the canonical state are one vocabulary
                // since PR 2c; LEGACY_STATUS_BY_STATE was an identity map.
                const nextLegacyStatus = toState;
                const transitionEvent = {
                    action: 'WORKFLOW_TRANSITION',
                    fromState: currentState,
                    toState,
                    actorId: req.user.id,
                    actorRole: normalizeRole(userRole) || null,
                    reasonCode,
                    comment: comment || null,
                    metadata: { source: 'work-activity-done', activityId: activity.id },
                    timestamp: new Date().toISOString(),
                };
                const workflowHistory = Array.isArray(application.workflowHistory)
                    ? application.workflowHistory
                    : [];
                const updatedApp = await writeApplicationStatus({
                    prisma: tx,
                    applicationId: application.id,
                    fromStatus: application.status,
                    toStatus: nextLegacyStatus,
                    actorId: req.user.id,
                    actorRole: normalizeRole(userRole) || null,
                    reason: reasonCode || comment || null,
                    additionalData: {
                        formData: {
                            ...formData,
                            workflowState: toState,
                            workflowStateUpdatedAt: transitionEvent.timestamp,
                        },
                        workflowHistory: [...workflowHistory, transitionEvent],
                    },
                    assertTransition: false, // already validated above
                });
                return { activity, application: updatedApp };
            });
            return res.json({
                success: true,
                data: {
                    activity: shapeActivity(result.activity),
                    application: {
                        id: result.application.id,
                        status: result.application.status,
                    },
                },
            });
        } catch (txErr) {
            logger.warn('[provider/work] done+advance failed:', txErr.message);
            // Transition-guard faults (illegal edge, role perms, missing mandatory
            // comment) are client/state conditions → 422 INVALID_TRANSITION, matching
            // the sibling handlers (auditor.js, workflow-transitions-handler). Reserve
            // 400 for genuine bad input (e.g. application not found mid-tx).
            const isTransitionGuard = /cannot transition|Invalid transition|already in workflow state|requires a comment/i.test(txErr.message || '');
            return res.status(isTransitionGuard ? 422 : 400).json({
                success: false,
                error: txErr.message,
                code: isTransitionGuard ? 'INVALID_TRANSITION' : undefined,
            });
        }
    } catch (e) {
        logger.warn('[provider/work] markDone failed:', e.message);
        return res.status(400).json({ success: false, error: e.message });
    }
});

module.exports = router;
