/**
 * Revision Deadline API Routes
 * For 5-day revision deadline tracking
 * Uses Prisma RevisionDeadline model (Phase 7)
 * 
 * GET /api/revision-deadline/:applicationId - Get revision deadline status
 * POST /api/revision-deadline/:applicationId - Create revision deadline
 * PUT /api/revision-deadline/:applicationId/submit - Submit revision
 * PUT /api/revision-deadline/:applicationId/extend - Request extension
 */

const express = require('express');
const { respondError } = require('../../../shared/api-response');
const router = express.Router();
const { prisma } = require('../../../services/prisma-database');
const authModule = require('../../../middleware/auth-middleware');
const { authenticateAny } = require('../../../middleware/auth-middleware');
const { providerOnly } = require('../../../middleware/role-middleware');
const { addWorkingDays, getDeadlineStatus } = require('../../../utils/working-days');
const logger = require('../../../shared/logger');
// Closing-review NEW-3 (2026-05-15): the /submit handler is documented as the
// HEALTH_USER's submission endpoint, but was previously gated by
// `authenticateProvider` — so health users (the actual submitters) were getting
// 403. Switch to `authenticateAny` + per-application ownership check.
// BUG-FIX (carpet 2026-06-05): `resolveHealthIdentity` is a METHOD that uses
// `this.normalizeIdentityValue`. Destructuring it here dropped the `this`
// binding, so every health-user call threw "this.normalizeIdentityValue is not
// a function" → 500 on GET /:applicationId. Import the bound service object and
// call it like the canonical sites in applications.js (object + correct args).
const applicationService = require('../../../services/application-service');
const { getHealthScopeOptions } = require('../helpers/applications-helpers');
const { normalizeRole, CANONICAL_ROLES } = require('../../../shared/canonical-rbac');
// X2-FIX-D M-20 (DR-EXT-1) — per-application owner gate for revision
// deadline writes. The role-only `providerOnly` check admitted any
// DOC_REVIEWER / AUDITOR / etc. to extend deadlines on applications
// they weren't assigned to.
const { assertCallerIsAssignedToApplication } = require('../../../shared/application-owner-gate');
// M1 (2026-08-15) — this is the third submit door (plan D4). The provider
// bypass below stays (an officer is not a member of the farm's entity, and the
// real delegation path is M2) but it stops being invisible: every use writes an
// actorType PROVIDER audit row naming the entity acted for (plan D13).
const { assertSubmitAllowed, SubmitGuardError } = require('../../../services/application-submit-guard');
// M2a (2026-08-15) — this door carries a correction back in, so it is a
// RESUBMIT: judged by the requirement set stamped at first submit (spec §3).
const {
    assertRequiredDocumentsPresent,
    isSubmitGateRefusal,
    respondSubmitGateRefusal,
    MODE_RESUBMIT,
} = require('../../../services/application-document-requirements');
const { auditLogger, AuditCategory, AuditSeverity, ResourceType } = require('../../../middleware/audit-logger');
// Spec 2026-09-30 §3.1: the health branch scopes its reads by holder (called inside
// the handler, after authentication and the active-entity middleware).
const { holderScope, r1HolderOrLegacyWhenScoped } = require('../../../services/holder-access');
function isProviderRole(role) {
    const canonical = normalizeRole(role);
    return canonical && canonical !== CANONICAL_ROLES.HEALTH;
}

// M1 — one audit row per revision submit, recording WHO acted and for WHICH
// entity. For a provider this is the D13 bypass record (actorType PROVIDER);
// for an applicant it is the AC3 "in whose name" record. Written through the
// standalone `auditLogger.log()` (own transaction + own advisory lock —
// audit-logger.js:479,505-506), never inside somebody else's transaction, and
// best-effort by design (log() swallows its own errors, :526-541).
async function logRevisionSubmitAccepted({ req, applicationId, entityId, actorId, actorType }) {
    try {
        await auditLogger.log({
            category: AuditCategory.APPLICATION,
            action: 'APPLICATION_REVISION_SUBMIT_ACCEPTED',
            severity: AuditSeverity.INFO,
            actorId: actorId || 'UNKNOWN',
            actorType,
            actorRole: req.user?.canonicalRole || req.user?.role || 'UNKNOWN',
            resourceType: ResourceType.APPLICATION,
            resourceId: applicationId,
            ipAddress: req.ip || null,
            userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
            organizationId: req.user?.organizationId || null,
            result: 'SUCCESS',
            metadata: {
                onBehalfOfEntityId: entityId || null,
                activeEntityId: req.activeEntity?.entityId || null,
                permission: 'SUBMIT_APPLICATION',
                applicationId,
                // The bypass is a fact about the row, not a footnote: an
                // officer submitted for a farm they are not a member of.
                providerBypass: actorType === 'PROVIDER',
                route: `${req.method} ${req.baseUrl || ''}${req.path || ''}`,
            },
        });
    } catch (auditErr) {
        logger.warn(`[RevisionDeadline Submit] accepted-audit write failed (non-fatal): ${auditErr?.message}`);
    }
}

/**
 * GET /api/revision-deadline/:applicationId
 * Get current revision deadline status
 *
 * AppAudit AH9 (2026-05-15): previously this endpoint was unauthenticated —
 * anyone with an application UUID could read deadline urgency, revisionCount,
 * and revisionDue. Now requires `authenticateAny` and a per-application
 * ownership check for health users (providers/admins bypass for review needs).
 */
router.get('/:applicationId', authenticateAny, async (req, res) => {
    try {
        const { applicationId } = req.params;

        // Ownership check for non-provider roles. Provider/admin bypass since
        // they have audit/review permissions across all applications.
        if (!isProviderRole(req.user?.role)) {
            let identity = null;
            try {
                identity = await applicationService.resolveHealthIdentity(
                    req.user.id,
                    getHealthScopeOptions(req.user),
                );
            } catch (_e) {
                identity = null;
            }
            if (!identity) {
                return res.status(403).json({ success: false, error: 'Forbidden' });
            }
            const owned = await prisma.application.findFirst({
                where: {
                    id: applicationId,
                    healthId: identity.healthId,
                    // R1-legacy-pin: removed in Task 12 — the pre-R1 filer pin decides.
                    ...r1HolderOrLegacyWhenScoped(await holderScope(req), 'Application', { healthId: identity.healthId }),
                },
                select: { id: true },
            });
            if (!owned) {
                // Return 404 (not 403) so the response shape doesn't leak whether
                // the application UUID is real — anyone probing a foreign UUID
                // gets the same answer as someone probing a non-existent one.
                return res.status(404).json({
                    success: false,
                    message: 'No revision deadline found for this application',
                    hasDeadline: false,
                });
            }
        }

        const deadline = await prisma.revisionDeadline.findUnique({
            where: { applicationId: applicationId },
        });

        if (!deadline) {
            return res.status(404).json({
                success: false,
                message: 'No revision deadline found for this application',
                hasDeadline: false,
            });
        }

        // Check deadline status using working days (excludes weekends + Thai holidays)
        const deadlineDate = new Date(deadline.revisionDue);
        const deadlineStatus = deadline.status === 'PENDING'
            ? getDeadlineStatus(deadlineDate)
            : { remainingWorkingDays: 0, isOverdue: false, urgency: 'completed', displayText: deadline.status };

        // Also calculate calendar hours for UI countdown
        const now = new Date();
        const remainingMs = Math.max(0, deadlineDate - now);
        const remainingCalendarHours = Math.floor((remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

        return res.json({
            success: true,
            hasDeadline: true,
            data: {
                id: deadline.id,
                applicationId: deadline.applicationId,
                revisionDue: deadline.revisionDue,
                revisionCount: deadline.revisionCount,
                status: deadline.status,
                remaining: {
                    days: deadlineStatus.remainingWorkingDays,
                    hours: remainingCalendarHours,
                    isOverdue: deadlineStatus.isOverdue,
                    urgency: deadlineStatus.urgency,
                    dueIn: deadlineStatus.displayText,
                    isWorkingDays: true,
                },
            },
        });

    } catch (error) {
        logger.error('[RevisionDeadline GET] Error:', error);
        return respondError(res, req, error, { message: 'Failed to get deadline' });
    }
});

/**
 * POST /api/revision-deadline/:applicationId
 * Create new revision deadline (DTAM initiates)
 *
 * X2-FIX-D M-20: per-app owner gate replaces the role-only providerOnly
 * pattern. Loads reviewerId/auditorId so the helper can decide.
 */
router.post('/:applicationId', authModule.authenticateProvider, providerOnly, async (req, res) => {
    try {
        const { applicationId } = req.params;
        const { daysAllowed = 5 } = req.body;

        // Verify application exists
        const application = await prisma.application.findUnique({
            where: { id: applicationId },
            select: {
                id: true,
                applicationNumber: true,
                reviewerId: true,
                auditorId: true,
                formData: true,
            },
        });

        if (!application) {
            return res.status(404).json({
                success: false,
                message: 'Application not found',
            });
        }

        // X2-FIX-D M-20 (DR-EXT-1): ADMIN bypass; otherwise caller must be the
        // assigned reviewer or auditor for this application.
        const ownerCheck = assertCallerIsAssignedToApplication(application, req.user);
        if (!ownerCheck.ok) {
            return res.status(ownerCheck.status).json(ownerCheck.body);
        }

        // Check for existing deadline
        const existing = await prisma.revisionDeadline.findUnique({
            where: { applicationId: applicationId },
        });

        if (existing && existing.status === 'PENDING') {
            return res.status(409).json({
                success: false,
                message: 'Active revision deadline already exists',
                existingDeadline: existing.revisionDue,
            });
        }

        const now = new Date();
        // Use working days (excludes weekends + Thai government holidays)
        const revisionDue = addWorkingDays(now, daysAllowed);

        // If existing deadline, increment count and update
        if (existing) {
            const updated = await prisma.revisionDeadline.update({
                where: { applicationId: applicationId },
                data: {
                    revisionDue: revisionDue,
                    revisionCount: existing.revisionCount + 1,
                    status: 'PENDING',
                    updatedBy: req.user.id,
                },
                select: {
                    id: true,
                    applicationId: true,
                    revisionDue: true,
                    revisionCount: true,
                    status: true,
                },
            });

            return res.status(201).json({
                success: true,
                message: `Revision deadline set: ${daysAllowed} days`,
                data: updated,
            });
        }

        // Create new deadline
        const newDeadline = await prisma.revisionDeadline.create({
            data: {
                applicationId: applicationId,
                revisionDue: revisionDue,
                status: 'PENDING',
                createdBy: req.user.id,
            },
            select: {
                id: true,
                applicationId: true,
                revisionDue: true,
                revisionCount: true,
                status: true,
                createdAt: true,
            },
        });

        return res.status(201).json({
            success: true,
            message: `Revision deadline set: ${daysAllowed} days`,
            data: newDeadline,
        });

    } catch (error) {
        logger.error('[RevisionDeadline POST] Error:', error);
        return respondError(res, req, error, { message: 'Failed to create deadline' });
    }
});

/**
 * PUT /api/revision-deadline/:applicationId/submit
 * Submit revision (HEALTH_USER submits corrections)
 */
router.put('/:applicationId/submit', authenticateAny, async (req, res) => {
    try {
        const { applicationId } = req.params;

        // Closing-review NEW-3: per-application ownership check for health users.
        // Provider/admin roles bypass — they may submit on behalf of citizens during
        // assisted-application workflows.
        const callerIsProvider = isProviderRole(req.user?.role);
        // M1: the entity the act is performed FOR — read on both branches,
        // because the provider bypass has to NAME it even though it skips the
        // membership question (D13).
        let applicationRow = null;
        if (!callerIsProvider) {
            let identity = null;
            try {
                identity = await applicationService.resolveHealthIdentity(
                    req.user.id,
                    getHealthScopeOptions(req.user),
                );
            } catch (_e) {
                identity = null;
            }
            if (!identity) {
                return res.status(403).json({ success: false, error: 'Forbidden' });
            }
            // M2a — `formData` and `status` join the projection: the document
            // check reads the stamp and the evidence out of formData, and a
            // projection that omits them would make every application look
            // stamp-less (i.e. silently grandfather the whole door).
            const owned = await prisma.application.findFirst({
                where: {
                    id: applicationId,
                    healthId: identity.healthId,
                    // R1-legacy-pin: removed in Task 12 — the pre-R1 filer pin decides.
                    ...r1HolderOrLegacyWhenScoped(await holderScope(req), 'Application', { healthId: identity.healthId }),
                },
                select: { id: true, entityId: true, submitterId: true, formData: true, status: true },
            });
            if (!owned) {
                return res.status(404).json({
                    success: false,
                    message: 'No revision deadline found',
                });
            }
            applicationRow = owned;

            // M1 (review M2) — heal a pre-Phase-66 null entityId from the
            // caller's personal entity before the guard turns it into a 400.
            if (!applicationRow.entityId) {
                const personalEntity = await applicationService
                    .findPersonalEntityForHealthIdentity(identity);
                if (personalEntity?.id) {
                    const healed = await applicationService.healDraftEntityColumns(applicationId, {
                        entityId: personalEntity.id,
                        submitterId: applicationRow.submitterId || identity.userId || null,
                    });
                    applicationRow = {
                        ...applicationRow,
                        entityId: healed?.entityId || personalEntity.id,
                    };
                }
            }

            try {
                await assertSubmitAllowed({
                    userId: identity.userId || req.user.id,
                    application: applicationRow,
                    // The guard re-checks a RENEWAL/REPLACEMENT claim's certificate holder.
                    holderScope: await holderScope(req),
                    auditContext: {
                        actorType: 'USER',
                        actorRole: req.user?.canonicalRole || req.user?.role || null,
                        ipAddress: req.ip || null,
                        userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
                        organizationId: req.user?.organizationId || null,
                        activeEntityId: req.activeEntity?.entityId || null,
                        route: `${req.method} ${req.baseUrl || ''}${req.path || ''}`,
                    },
                });
            } catch (guardErr) {
                if (guardErr instanceof SubmitGuardError) {
                    return respondError(res, req, guardErr, { message: guardErr.message });
                }
                throw guardErr;
            }

            // M2a — the document law, for the APPLICANT branch only. Rights
            // first (above), completeness second (here), and both before the
            // deadline row is touched.
            try {
                await assertRequiredDocumentsPresent({ application: applicationRow, mode: MODE_RESUBMIT, holderScope: await holderScope(req) });
            } catch (docErr) {
                if (isSubmitGateRefusal(docErr)) {
                return respondSubmitGateRefusal(res, docErr);
            }
                throw docErr;
            }
        } else {
            // Provider bypass (D13): the membership question is not asked — an
            // officer is not a member of the farm — but the entity acted for is
            // still read, so the audit row below can name it.
            //
            // M2a: the DOCUMENT question is not asked here either, and that is a
            // decision, not an omission. This branch is an officer submitting on
            // a citizen's behalf at the counter; the officer is not the party who
            // holds the farm's papers, and refusing them 422 would strand the
            // citizen with no path at all. The act is still on the record as a
            // PROVIDER row naming the entity (logRevisionSubmitAccepted below),
            // which is what makes the bypass auditable rather than invisible.
            applicationRow = await prisma.application.findFirst({
                where: { id: applicationId },
                select: { id: true, entityId: true },
            });
        }

        const deadline = await prisma.revisionDeadline.findUnique({
            where: { applicationId: applicationId },
        });

        if (!deadline) {
            return res.status(404).json({
                success: false,
                message: 'No revision deadline found',
            });
        }

        if (deadline.status !== 'PENDING') {
            return res.status(400).json({
                success: false,
                message: `Cannot submit - deadline status is ${deadline.status}`,
            });
        }

        const now = new Date();
        const isLate = new Date(deadline.revisionDue) < now;

        // Update deadline status
        const updated = await prisma.revisionDeadline.update({
            where: { applicationId: applicationId },
            data: {
                status: 'SUBMITTED',
                submittedAt: now,
                submittedBy: req.user.id,
                updatedBy: req.user.id,
            },
            select: {
                id: true,
                applicationId: true,
                revisionDue: true,
                submittedAt: true,
                status: true,
            },
        });

        // D13 / AC3 — every accepted revision submit says who acted and for
        // which entity; a provider's is marked as the bypass it is.
        await logRevisionSubmitAccepted({
            req,
            applicationId,
            entityId: applicationRow?.entityId || null,
            actorId: req.user?.id,
            actorType: callerIsProvider ? 'PROVIDER' : 'USER',
        });

        return res.json({
            success: true,
            message: isLate ? 'Revision submitted (late)' : 'Revision submitted on time',
            data: {
                ...updated,
                wasLate: isLate,
            },
        });

    } catch (error) {
        logger.error('[RevisionDeadline Submit] Error:', error);
        return respondError(res, req, error, { message: 'Failed to submit revision' });
    }
});

/**
 * PUT /api/revision-deadline/:applicationId/extend
 * Request deadline extension
 *
 * X2-FIX-D M-20 (DR-EXT-1): provider role + per-application owner gate.
 * `authModule.authenticateProvider` already 401s health users; we then
 * verify the caller is the assigned reviewer/auditor (ADMIN bypass).
 */
router.put('/:applicationId/extend', authModule.authenticateProvider, async (req, res) => {
    try {
        const { applicationId } = req.params;
        const { reason, additionalDays = 3 } = req.body;

        if (!reason) {
            return res.status(400).json({
                success: false,
                message: 'Extension reason is required',
            });
        }

        // Owner gate — load assignment fields, run helper.
        const application = await prisma.application.findUnique({
            where: { id: applicationId },
            select: {
                id: true,
                reviewerId: true,
                auditorId: true,
                formData: true,
            },
        });
        const ownerCheck = assertCallerIsAssignedToApplication(application, req.user);
        if (!ownerCheck.ok) {
            return res.status(ownerCheck.status).json(ownerCheck.body);
        }

        const deadline = await prisma.revisionDeadline.findUnique({
            where: { applicationId: applicationId },
        });

        if (!deadline) {
            return res.status(404).json({
                success: false,
                message: 'No revision deadline found',
            });
        }

        if (deadline.status !== 'PENDING') {
            return res.status(400).json({
                success: false,
                message: `Cannot extend - deadline status is ${deadline.status}`,
            });
        }

        // Max 2 extensions
        if (deadline.extensionDays && deadline.extensionDays > 5) {
            return res.status(400).json({
                success: false,
                message: 'Maximum extension limit reached',
            });
        }

        const currentDeadline = new Date(deadline.revisionDue);
        // Extend using working days (excludes weekends + Thai government holidays)
        const newDeadline = addWorkingDays(currentDeadline, additionalDays);

        // Update deadline
        const updated = await prisma.revisionDeadline.update({
            where: { applicationId: applicationId },
            data: {
                revisionDue: newDeadline,
                extensionDays: (deadline.extensionDays || 0) + additionalDays,
                extensionReason: reason,
                extensionApprovedAt: new Date(),
                extensionApprovedBy: req.user.id,
                status: 'EXTENDED',
                updatedBy: req.user.id,
            },
            select: {
                id: true,
                applicationId: true,
                revisionDue: true,
                extensionDays: true,
                status: true,
                extensionApprovedAt: true,
            },
        });

        // PENTEST C3 — the synchronous expiry guards (revision-deadline-guard.js
        // resolveRevisionDueAt, applications-car.js) and the auto-cancel cron read
        // the deadline from application.formData FIRST, only falling back to this
        // RevisionDeadline row. If we update only the row, an extended applicant is
        // still auto-EXPIRED at the ORIGINAL deadline and forfeits งวด1/งวด2. Restamp
        // the formData twins that actually exist so the enforced deadline moves with
        // the grant (mirrors waiver-reopen-service.js restamp). Only the relevant
        // twin (revision* for DOC, car* for CAR) is present, so we update in place.
        try {
            const fd = (application.formData && typeof application.formData === 'object')
                ? { ...application.formData } : {};
            const newIso = new Date(updated.revisionDue).toISOString();
            let touched = false;
            for (const key of ['revisionDueAt', 'revision_due_at', 'carDueAt', 'car_due_at']) {
                if (fd[key] !== undefined && fd[key] !== null) { fd[key] = newIso; touched = true; }
            }
            // Third twin: the CAR_PENDING transition writes carRequest.dueAt with
            // the same value as carDueAt (workflow-transitions-handler.js), and
            // applications-car.js falls back to it when the flat twins are absent.
            // Leaving it stale means the applicant is shown — and, on that
            // fallback path, enforced against — the pre-extension deadline.
            if (fd.carRequest && typeof fd.carRequest === 'object' && fd.carRequest.dueAt) {
                fd.carRequest = { ...fd.carRequest, dueAt: newIso };
                touched = true;
            }
            if (touched) {
                await prisma.application.update({
                    where: { id: applicationId },
                    data: { formData: fd },
                });
            }
        } catch (twinErr) {
            // Non-fatal: the RevisionDeadline row IS updated (the fallback the guards
            // use when no formData twin exists), so the extension still partially
            // applies. Log so a formData-write failure is visible.
            logger.error('[RevisionDeadline Extend] formData twin restamp failed:', twinErr);
        }

        return res.json({
            success: true,
            message: `Deadline extended by ${additionalDays} days`,
            data: updated,
        });

    } catch (error) {
        logger.error('[RevisionDeadline Extend] Error:', error);
        return respondError(res, req, error, { message: 'Failed to extend deadline' });
    }
});

/**
 * GET /api/revision-deadline/overdue/all
 * Get all overdue/pending revisions (for admin dashboard)
 */
router.get('/overdue/all', authModule.authenticateProvider, providerOnly, async (req, res) => {
    try {
        const deadlines = await prisma.revisionDeadline.findMany({
            where: {
                OR: [
                    { status: 'PENDING' },
                    { status: 'EXTENDED' },
                ],
            },
            include: {
                application: {
                    select: {
                        applicationNumber: true,
                        applicant: {
                            select: {
                                // C2-class: User has no `fullNameTH` column → 500 on
                                // GET /revision-deadline/overdue/all. Use the real
                                // name columns.
                                firstName: true,
                                lastName: true,
                            },
                        },
                    },
                },
            },
            orderBy: {
                revisionDue: 'asc',
            },
        });

        // Calculate status using working days (excludes weekends + Thai government holidays)
        const processed = deadlines.map(d => {
            const status = getDeadlineStatus(d.revisionDue);
            return {
                ...d,
                isOverdue: status.isOverdue,
                daysRemaining: status.remainingWorkingDays,
                urgency: status.urgency,
                displayText: status.displayText,
            };
        });

        return res.json({
            success: true,
            count: processed.length,
            overdueCount: processed.filter(d => d.isOverdue).length,
            data: processed,
        });

    } catch (error) {
        logger.error('[RevisionDeadline Overdue] Error:', error);
        return respondError(res, req, error, { message: 'Failed to get overdue list' });
    }
});

module.exports = router;
