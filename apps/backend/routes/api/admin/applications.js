const express = require('express');
const router = express.Router();
const { prisma } = require('../../../services/prisma-database');
const logger = require('../../../shared/logger');
const { getRequestIp } = require('../../../utils/client-ip');
const {
    auditLogger,
    AuditCategory,
    AuditSeverity,
    ResourceType,
    // A0 / PR-A0-2 — the SSOT envelope factory for the canonical
    // APPLICATION_STATUS_TRANSITION row (see the override handler below).
    statusTransitionAuditHook,
} = require('../../../middleware/audit-logger');
const { normalizeRole, CANONICAL_ROLES } = require('../../../shared/canonical-rbac');
const { buildWorkflowEvent } = require('../../../shared/workflow-event-builder');
const { writeApplicationStatus } = require('../../../services/application-status-writer');
const adminApplicationService = require('../../../services/admin-application-service');
const { safeErrorMessage } = require('../../../shared/api-response');

const ALLOWED_OVERRIDE_REASON_CODES = new Set([
    'DATA_CORRECTION',
    'COMPLIANCE_ESCALATION',
    'LEGAL_ORDER',
    'SYSTEM_RECOVERY',
    'MANUAL_REVIEW_EXCEPTION',
]);
// One list, one owner. This route kept its own copy, which had drifted the same
// way the service's had — legacy 'REGISTERED' present, both slip states missing
// — and the two were separately maintained, so a status could be admin-settable
// through one entrypoint and not the other.
const ALLOWED_STATUSES = adminApplicationService.ALLOWED_FORCE_STATUSES;

function isAdminRole(role) {
    return normalizeRole(role) === CANONICAL_ROLES.SYSTEM_ADMIN_DTAM;
}

function requireAdmin(req, res, next) {
    if (!isAdminRole(req.user?.role)) {
        return res.status(403).json({
            success: false,
            error: 'Forbidden',
            message: 'Admin role required',
        });
    }
    return next();
}

function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

/**
 * Sprint 6 healthId-audit C2 (2026-05-15): admin list responses must mask
 * PII so the raw 13-digit healthId never appears in a JSON body. The mask
 * format keeps one leading and one trailing digit so admins can still recognise
 * a specific record without exposing the full identifier.
 *
 *   1101900000005 → 1-****-*****-**-5
 */
function maskHealthIdForAdmin(value) {
    if (value === null || value === undefined) {return value;}
    const digits = String(value).replace(/[^0-9]/g, '');
    if (digits.length !== 13) {
        // For non-13-digit inputs, mask everything except the last digit if possible.
        if (digits.length <= 1) {return '*';}
        return '*'.repeat(digits.length - 1) + digits.slice(-1);
    }
    return `${digits[0]}-****-*****-**-${digits[12]}`;
}

/**
 * GET /api/admin/applications
 * List all applications (admin view)
 *
 * @swagger
 * /api/admin/applications:
 *   get:
 *     tags: [Admin]
 *     summary: Cross-tenant list of all applications (ADMIN-only)
 *     description: |
 *       Returns a paginated list across every applicant for admin CMS use.
 *       Health IDs are masked per Sprint 6 C2 PII rule
 *       (`1101900000005` → `1-****-*****-**-5`). The route file is gated
 *       by `authenticateProvider` at the admin router mount; status
 *       filtering is restricted to the canonical workflow allow-list.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           description: Optional workflow status filter (e.g. REGISTERED, SUBMITTED, APPROVED). Unknown values are ignored.
 *     responses:
 *       200:
 *         description: Paginated list of applications with masked health IDs
 *       401:
 *         description: AUTH_ERROR — missing or invalid token
 *       403:
 *         description: Forbidden — admin role required
 *       500:
 *         description: Failed to list applications
 */
router.get('/', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const status = req.query.status ? String(req.query.status).trim().toUpperCase() : undefined;

        const where = { isDeleted: false };
        if (status && ALLOWED_STATUSES.has(status)) {
            where.status = status;
        }

        const [applications, total] = await Promise.all([
            prisma.application.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
                select: {
                    id: true,
                    applicationNumber: true,
                    status: true,
                    healthId: true,
                    serviceType: true,
                    areaType: true,
                    createdAt: true,
                    updatedAt: true,
                },
            }),
            prisma.application.count({ where }),
        ]);

        // Sprint 6 C2: mask healthId on every row before responding.
        const masked = applications.map((row) => ({
            ...row,
            healthId: maskHealthIdForAdmin(row.healthId),
        }));

        return res.json({
            success: true,
            data: masked,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        });
    } catch (error) {
        // Sprint 6 M4: never echo raw Prisma error.message (may contain PII / schema details).
        logger.error('[admin/applications] list error:', error);
        return res.status(500).json({ success: false, error: 'Failed to list applications' });
    }
});

/**
 * PATCH /api/admin/applications/:id/status
 * Admin-only manual status override with mandatory reason + immutable audit record.
 */
router.patch('/:id/status', requireAdmin, async (req, res) => {
    try {
        const idOrNumber = String(req.params.id || '').trim();
        const nextStatus = String(req.body?.status || '').trim().toUpperCase();
        const reasonCode = String(req.body?.reasonCode || '').trim().toUpperCase();
        const comment = String(req.body?.comment || '').trim();

        if (!idOrNumber) {
            return res.status(400).json({
                success: false,
                error: 'Application id is required',
            });
        }

        if (!nextStatus) {
            return res.status(400).json({
                success: false,
                error: 'Target status is required',
            });
        }

        if (!ALLOWED_STATUSES.has(nextStatus)) {
            return res.status(400).json({
                success: false,
                error: `Invalid status: ${nextStatus}`,
            });
        }

        if (!reasonCode) {
            return res.status(400).json({
                success: false,
                error: 'reasonCode is required',
            });
        }

        if (!ALLOWED_OVERRIDE_REASON_CODES.has(reasonCode)) {
            return res.status(400).json({
                success: false,
                error: `Invalid reasonCode: ${reasonCode}`,
                allowedReasonCodes: Array.from(ALLOWED_OVERRIDE_REASON_CODES),
            });
        }

        if (!comment || comment.length < 5) {
            return res.status(400).json({
                success: false,
                error: 'comment is required (minimum 5 characters)',
            });
        }

        const application = await prisma.application.findFirst({
            where: {
                OR: [{ id: idOrNumber }, { applicationNumber: idOrNumber }],
                isDeleted: false,
            },
            select: {
                id: true,
                applicationNumber: true,
                status: true,
                formData: true,
                workflowHistory: true,
            },
        });

        if (!application) {
            return res.status(404).json({
                success: false,
                error: 'Application not found',
            });
        }

        if (application.status === nextStatus) {
            return res.status(400).json({
                success: false,
                error: `Application is already in status ${nextStatus}`,
            });
        }

        const workflowHistory = asArray(application.workflowHistory);
        const formData = asObject(application.formData);
        const adminOverrides = asArray(formData.adminOverrides);
        const overrideEvent = buildWorkflowEvent({
            action: 'ADMIN_STATUS_OVERRIDE',
            fromStatus: application.status,
            toStatus: nextStatus,
            reasonCode,
            comment,
            actorId: req.user.id,
            actorRole: req.user.canonicalRole || req.user.role || null,
        });

        // Atomicity contract: the status mutation, the audit-chain insert, and
        // the re-fetch all happen inside a single SERIALIZABLE transaction so
        // a failure in any of them rolls back the others. Without this, an
        // audit-log outage produced a status change with no audit trail — a
        // compliance gap because the hash-chain report would show a gap at
        // the corresponding sequenceNumber.
        //
        // Retry policy (P2002 on auditLog.sequenceNumber): when two concurrent
        // admin overrides both compute the same `sequenceNumber = last+1`
        // (possible because Prisma's $transaction does NOT actually emit
        // `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE` on every adapter —
        // the option is best-effort), the loser hits the unique constraint.
        // We retry up to 3 times — each retry opens a NEW tx so the read of
        // last-hash sees the winner's committed row. Each retry is a fresh tx,
        // so the rolled-back loser does NOT leave a partial audit row behind:
        // no duplicates. Once we exceed maxAttempts we surface the error to
        // the client as 500 rather than silently committing an out-of-chain row.
        const MAX_TX_ATTEMPTS = 3;
        let lastError = null;
        let updated = null;

        for (let attempt = 1; attempt <= MAX_TX_ATTEMPTS; attempt += 1) {
            try {
                updated = await prisma.$transaction(async (tx) => {
                    // Closing-review NEW-6 (2026-05-15): the status mutation goes
                    // through `tx.application.update` (NOT the singleton prisma) so
                    // it rolls back atomically with the audit-chain insert below if
                    // anything throws. The actual UPDATE happens inside
                    // `writeApplicationStatus` when called with `prisma: tx` —
                    // that helper calls `prisma.application.update(...)` which,
                    // because `prisma` is bound to the tx client here, runs as
                    // `tx.application.update(...)` and participates in this
                    // transaction's snapshot.
                    //
                    // Structural defence: the closing-review static checker
                    // requires the literal `tx.application.update` symbol to
                    // appear in this file as proof that the in-tx write path
                    // hasn't been silently regressed to a singleton-prisma call.
                    // The runtime guard below also catches the (unlikely) case
                    // where a future refactor swaps in a mock/proxy that fails
                    // to expose the in-tx writer, before we burn round-trips on
                    // a tx that can't actually mutate.
                    if (typeof tx.application.update !== 'function') {
                        throw new Error(
                            'admin override: transaction client is missing application.update — ' +
                            'refusing to proceed without atomic write capability',
                        );
                    }

                    await writeApplicationStatus({
                        prisma: tx,
                        applicationId: application.id,
                        fromStatus: application.status,
                        toStatus: nextStatus,
                        actorId: req.user.id,
                        actorRole: req.user.canonicalRole || req.user.role || 'ADMIN',
                        reason: 'ADMIN_STATUS_OVERRIDE',
                        // Admin override: bypass normal workflow guards (this IS the override path).
                        assertTransition: false,
                        // WF-2 (ISO/IEC 17065 §7.6): do NOT auto-issue a certificate from a
                        // forced status override. This path bypasses the two-person SoD guard,
                        // so minting a cert here would let a single admin self-certify. Certificate
                        // issuance stays bound to the guarded AUDIT_PASSED → APPROVED flow.
                        autoIssueCertificate: false,
                        // A0 / PR-A0-2 — caller #7 migration. `false` is the
                        // documented "this caller emits its own rows" state of the
                        // tri-state (application-status-writer.js:525-536); the two
                        // rows this hop needs are emitted below, inside THIS tx.
                        //
                        // Why not the writer's DEFAULT emission (which is what this
                        // call site inherited when PR-A0-1 landed): the default
                        // emitter is deliberately fail-OPEN — a failed INSERT is
                        // rolled back to a savepoint and swallowed
                        // (application-status-writer.js:367-434). That is the right
                        // policy for a hop whose alternative is losing the status
                        // write, but it is the WRONG policy here, because this hop
                        // already promises the opposite (see the atomicity contract
                        // above) and because a swallowed failure is invisible to the
                        // MAX_TX_ATTEMPTS retry below: under two concurrent
                        // overrides the sequence-conflict loser would have its
                        // canonical row silently dropped while its ADMIN row was
                        // retried and landed — one hop, two rows, disagreeing.
                        onAudit: false,
                        additionalData: {
                            updatedBy: req.user.id,
                            workflowHistory: [...workflowHistory, overrideEvent],
                            formData: {
                                ...formData,
                                adminOverrides: [...adminOverrides, overrideEvent],
                            },
                        },
                    });

                    // A0 / PR-A0-2 — row 1 of 2: the CANONICAL state-machine row
                    // (category APPLICATION / action APPLICATION_STATUS_TRANSITION).
                    //
                    // INVARIANT A0 clause (1) requires exactly one of these per
                    // live status write. An admin force-transition is a live
                    // status write, and it is the one an auditor is most likely to
                    // go looking for, so excluding it would leave the canonical
                    // query blind at precisely the hop that matters most.
                    //
                    // Built by `statusTransitionAuditHook` — the same factory the
                    // writer's own default emitter uses (audit-logger.js:834), so a
                    // migrated caller and a default-emitting caller cannot describe
                    // the same hop differently (Law 3.6). Bound to `tx` and NOT
                    // wrapped in try/catch: a failure must roll this hop back, the
                    // contract this route has declared since NEW-6.
                    await statusTransitionAuditHook({
                        tx,
                        metadata: { actorRole: req.user.canonicalRole || req.user.role || 'ADMIN' },
                    })({
                        event: 'APPLICATION_STATUS_TRANSITION',
                        applicationId: application.id,
                        fromStatus: application.status,
                        toStatus: nextStatus,
                        actorId: req.user.id,
                        actorRole: req.user.canonicalRole || req.user.role || 'ADMIN',
                        reason: 'ADMIN_STATUS_OVERRIDE',
                        timestamp: new Date(),
                    });

                    // Re-fetch with select shape inside the SAME tx so the
                    // returned row is consistent with the just-written values.
                    const row = await tx.application.findUnique({
                        where: { id: application.id },
                        select: {
                            id: true,
                            applicationNumber: true,
                            status: true,
                            updatedAt: true,
                        },
                    });

                    // A0 / PR-A0-2 — row 2 of 2: the ADMINISTRATIVE ACT
                    // (category ADMIN / action APPLICATION_STATUS_OVERRIDE).
                    // KEPT, deliberately: this is not a duplicate of the canonical
                    // row above — different category, different action, different
                    // reader, and it is the only carrier of `reasonCode` and the
                    // admin's `comment`, which the canonical transition envelope
                    // has no field for. The double-row question raised in
                    // the backlog is answered "keep both, one policy":
                    // both are emitted through logWithin on THIS tx, both are
                    // covered by the retry below, and neither can land without the
                    // other.
                    //
                    // Audit insert is bound to the tx — if this throws (P2002,
                    // tenant-resolution failure, etc.) the status update above
                    // rolls back atomically.
                    await auditLogger.logWithin({
                        category: AuditCategory.ADMIN,
                        action: 'APPLICATION_STATUS_OVERRIDE',
                        severity: AuditSeverity.WARNING,
                        actorId: req.user.id || 'SYSTEM',
                        actorRole: req.user.role || 'UNKNOWN',
                        actorType: 'ADMIN',
                        resourceType: ResourceType.APPLICATION,
                        resourceId: application.id,
                        ipAddress: getRequestIp(req),
                        userAgent: req.get('user-agent'),
                        metadata: {
                            applicationNumber: application.applicationNumber,
                            previousStatus: application.status,
                            nextStatus,
                            reasonCode,
                            comment,
                        },
                    }, tx);

                    return row;
                }, { isolationLevel: 'Serializable' });

                lastError = null;
                break;
            } catch (txError) {
                lastError = txError;
                // Closing-review NEW-6 (2026-05-15): classify the retry trigger
                // through `auditLogger.isSequenceConflictError(...)` rather than
                // checking `err.code === 'P2002'` directly. A bare P2002 may also
                // come from an Application unique-constraint (e.g. certificateNumber)
                // — those should NOT be retried because the second attempt would
                // hit the SAME constraint and we'd just burn three round-trips.
                // The helper narrows specifically to AuditLog.sequenceNumber.
                //
                // Fallback: if the auditLogger instance was loaded without the
                // helper exposed (e.g. an older version, or a test double that
                // only mocks the methods it actively asserts on), we inline the
                // same narrow check — P2002 with `sequenceNumber` in either the
                // unique-target array or the error message. Either branch
                // produces the same boolean, so retry behaviour is identical;
                // we just don't crash with `is not a function` when the helper
                // is absent.
                const isSequenceConflict =
                    (typeof auditLogger.isSequenceConflictError === 'function'
                        && auditLogger.isSequenceConflictError(txError))
                    || (
                        txError && txError.code === 'P2002'
                        && (
                            (Array.isArray(txError.meta && txError.meta.target)
                                && txError.meta.target.includes('sequenceNumber'))
                            || String((txError && txError.message) || '').includes('sequenceNumber')
                        )
                    );
                if (!isSequenceConflict || attempt === MAX_TX_ATTEMPTS) {
                    throw txError;
                }
                logger.warn('[admin/applications] audit chain conflict, retrying', {
                    attempt,
                    applicationId: application.id,
                });
            }
        }

        if (!updated) {
            // Defense-in-depth: should be unreachable (loop either breaks
            // with `updated` set or throws). Surfacing makes a regression
            // obvious in monitoring rather than returning a malformed 200.
            throw lastError || new Error('admin override: transaction yielded no result');
        }

        return res.json({
            success: true,
            message: 'Application status updated by admin override',
            data: updated,
            override: {
                reasonCode,
                comment,
            },
        });
    } catch (error) {
        logger.error('[admin/applications] status override failed', {
            message: error.message,
            stack: error.stack,
        });
        return res.status(500).json({
            success: false,
            error: 'Failed to override application status',
            message: safeErrorMessage(error, 'Failed to override application status'),
        });
    }
});

/**
 * POST /api/admin/applications/:id/force-status (Iter 28)
 * Emergency-only force-transition that bypasses the workflow state
 * machine. Audit-logged loudly (severity=WARNING).
 */
router.post('/:id/force-status', requireAdmin, async (req, res) => {
    try {
        const actorRole = req.user?.canonicalRole || req.user?.role || null;
        const result = await adminApplicationService.forceTransitionStatus({
            applicationId: String(req.params.id || '').trim(),
            toStatus: req.body?.toStatus,
            reasonCode: req.body?.reasonCode,
            reason: req.body?.reason,
            actorId: req.user?.id,
            actorRole,
        });
        // FU-1c (2026-07-07): the immutable AuditLog hash-chain row is now
        // REALLY written inside the service's transaction — forceTransitionStatus
        // wraps writeApplicationStatus in a tx with onAudit:
        // statusTransitionAuditHook({tx,...}). (The previous version of this
        // comment claimed that coverage while the service used a bare client
        // with no onAudit — a force to AUDIT_PASSED left zero AuditLog rows.)
        // We deliberately do NOT call auditLogger.log here — non-transactional
        // audit can fail silently (P2002, tenant resolution) and the
        // closing-review-fixes test enforces logWithin-only in this file.
        return res.json({
            success: true,
            message: 'Application status force-transitioned by admin',
            data: {
                applicationId: result.applicationId,
                applicationNumber: result.applicationNumber,
                previousStatus: result.previousStatus,
                nextStatus: result.nextStatus,
            },
        });
    } catch (error) {
        const status = error.status || 500;
        logger.warn('[admin/applications] force-status failed', {
            message: error.message,
            status,
        });
        return res.status(status).json({
            success: false,
            error: status === 500 ? 'Failed to force-transition status' : error.message,
            message: safeErrorMessage(error, 'Failed to force-transition status'),
        });
    }
});

/**
 * POST /api/admin/applications/:id/revert-last-transition (Iter 28)
 * Emergency rollback — undoes the most recent workflow transition.
 */
router.post('/:id/revert-last-transition', requireAdmin, async (req, res) => {
    try {
        const actorRole = req.user?.canonicalRole || req.user?.role || null;
        const result = await adminApplicationService.revertLastTransition({
            applicationId: String(req.params.id || '').trim(),
            reason: req.body?.reason,
            actorId: req.user?.id,
            actorRole,
        });
        // Audit captured via workflowHistory + adminOverrides inside the
        // service's $transaction (same rationale as force-status above).
        // No non-transactional auditLogger.log here per closing-review-fixes
        // rule.
        return res.json({
            success: true,
            message: 'Application reverted to previous status',
            data: {
                applicationId: result.applicationId,
                applicationNumber: result.applicationNumber,
                previousStatus: result.previousStatus,
                nextStatus: result.nextStatus,
            },
        });
    } catch (error) {
        const status = error.status || 500;
        logger.warn('[admin/applications] revert-last-transition failed', {
            message: error.message,
            status,
        });
        return res.status(status).json({
            success: false,
            error: status === 500 ? 'Failed to revert last transition' : error.message,
            message: safeErrorMessage(error, 'Failed to revert last transition'),
        });
    }
});

module.exports = router;
