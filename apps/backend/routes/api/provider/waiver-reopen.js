'use strict';

/**
 * Waiver-reopen endpoints (owner ruling 2026-07-08).
 *
 * POST /provider/waiver-reopen/applications/:id/requests  — assigned inspector
 *      opens a reopen request on an EXPIRED application (contact evidence
 *      mandatory; timing = department discretion, no system window).
 * GET  /provider/waiver-reopen/requests                    — finance pending queue (both finance roles).
 * POST /provider/waiver-reopen/requests/:id/approve        — finance officer (either role)
 *      approves (atomic reopen: EXPIRED → origin state, settled fees reused).
 * POST /provider/waiver-reopen/requests/:id/deny           — finance officer (either role) denies.
 *
 * All role/SoD gates live in services/waiver-reopen-service.js (BE
 * authoritative); this file only authenticates + maps errors. Full analysis:
 * docs/handoffs/waiver-reopen-decision-2026-07-08.md.
 */

const express = require('express');
const router = express.Router();
const { authenticateProvider } = require('../../../middleware/auth-middleware');
const { respondError } = require('../../../shared/api-response');
const logger = require('../../../shared/logger');
const waiverService = require('../../../services/waiver-reopen-service');
const { sendNotification, NotifyType } = require('../../../services/notification-service');
const { prisma } = require('../../../services/prisma-database');
const { normalizeRole, CANONICAL_ROLES } = require('../../../shared/canonical-rbac');
const { withoutTenantScope } = require('../../../services/tenant-context');
const { listWaiverApproverIds } = require('../../../services/waiver-approvers');

router.use(authenticateProvider);

function sendServiceError(res, req, error) {
    const status = error.statusCode || error.status;
    if (status && status < 500) {
        return res.status(status).json({
            success: false,
            code: error.code || 'WAIVER_ERROR',
            error: error.message,
        });
    }
    return respondError(res, req, error);
}

/** Resolve the applicant's User.id from the application FK token (canonicalId). */
async function resolveApplicantUserId(application) {
    if (!application?.healthId) { return null; }
    const user = await withoutTenantScope(() => prisma.user.findFirst({
        where: { canonicalId: application.healthId, isDeleted: false },
        select: { id: true },
    }));
    return user?.id || null;
}

/**
 * Notify the waiver approvers — both finance roles (operator 2026-09-27 (B)) —
 * of a new pending request (best-effort).
 */
async function notifyWaiverApprovers(request, application) {
    try {
        // MUST-4: org-scoped recipients via the shared single-source helper
        // (services/waiver-approvers — also used by the SLA escalation job).
        const accountantIds = await listWaiverApproverIds(application.organizationId);
        for (const acctId of accountantIds) {
            await sendNotification(acctId, NotifyType.WAIVER_REOPEN_REQUESTED, {
                applicationNumber: application.applicationNumber,
                requestId: request.id,
                reasonCode: request.reasonCode,
            });
        }
    } catch (notifyErr) {
        logger.warn(`[waiver] approver notification failed (non-fatal): ${notifyErr?.message}`);
    }
}

// Inspector opens a request.
router.post('/applications/:id/requests', async (req, res) => {
    try {
        // MUST-1: reasonCode is NOT caller-supplied — the petition lane is
        // LENIENCY-only (WRONGFUL_EXPIRY rows are created exclusively by the
        // ops batch lane with a mandatory bugRef). The service enforces the
        // same rule; dropping the body field here is belt-and-braces.
        const { request, application } = await waiverService.createReopenRequest({
            applicationId: String(req.params.id || '').trim(),
            user: req.user,
            reason: req.body?.reason,
        });
        await notifyWaiverApprovers(request, application);
        return res.status(201).json({ success: true, data: { requestId: request.id, status: request.status } });
    } catch (error) {
        return sendServiceError(res, req, error);
    }
});

// DTAM pending queue — approver roles only (MUST-5, mirrors #533/#545
// finance read-SoD: the request rows carry free-text contact evidence).
router.get('/requests', async (req, res) => {
    try {
        const role = normalizeRole(req.user?.canonicalRole || req.user?.role);
        if (role !== CANONICAL_ROLES.FINANCE_OFFICER_DTAM && role !== CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM) {
            return res.status(403).json({
                success: false,
                code: 'WAIVER_APPROVER_ROLE',
                error: 'เฉพาะเจ้าหน้าที่การเงินเท่านั้นที่ดูคิวคำขออนุโลมได้',
            });
        }
        // Fail-closed (carpet-bomb S3): the service now throws NO_ORGANIZATION
        // when the org is unresolvable — never returns the cross-org queue.
        const requests = await waiverService.listPendingReopenRequests({
            organizationId: req.user?.organizationId,
        });
        return res.json({ success: true, data: requests });
    } catch (error) {
        return sendServiceError(res, req, error);
    }
});

// Finance approve (either finance role) → atomic reopen.
router.post('/requests/:id/approve', async (req, res) => {
    try {
        const { request, application, origin, dueAt } = await waiverService.approveReopenRequest({
            requestId: String(req.params.id || '').trim(),
            user: req.user,
            note: req.body?.note,
        });

        // Farmer + requester notifications (best-effort — the reopen committed).
        try {
            const applicantUserId = await resolveApplicantUserId(application);
            if (applicantUserId) {
                await sendNotification(applicantUserId, NotifyType.WAIVER_REOPEN_APPROVED, {
                    applicationNumber: application.applicationNumber,
                    dueAt: dueAt.toISOString(),
                    origin,
                });
            }
            await sendNotification(request.requestedBy, NotifyType.WAIVER_REOPEN_APPROVED, {
                applicationNumber: application.applicationNumber,
                dueAt: dueAt.toISOString(),
                origin,
            });
        } catch (notifyErr) {
            logger.warn(`[waiver] approval notification failed (non-fatal): ${notifyErr?.message}`);
        }

        return res.json({
            success: true,
            data: {
                requestId: request.id,
                applicationNumber: application.applicationNumber,
                reopenedTo: origin,
                dueAt: dueAt.toISOString(),
            },
        });
    } catch (error) {
        return sendServiceError(res, req, error);
    }
});

// Finance deny (either finance role).
router.post('/requests/:id/deny', async (req, res) => {
    try {
        const { request } = await waiverService.denyReopenRequest({
            requestId: String(req.params.id || '').trim(),
            user: req.user,
            note: req.body?.note,
        });
        try {
            await sendNotification(request.requestedBy, NotifyType.WAIVER_REOPEN_DENIED, {
                requestId: request.id,
                note: request.decisionNote,
            });
        } catch (notifyErr) {
            logger.warn(`[waiver] deny notification failed (non-fatal): ${notifyErr?.message}`);
        }
        return res.json({ success: true, data: { requestId: request.id, status: request.status } });
    } catch (error) {
        return sendServiceError(res, req, error);
    }
});

module.exports = router;
