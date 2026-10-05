'use strict';

/**
 * Waiver decision-SLA escalation (stress-test mandate, owner directive
 * 2026-07-08): the leniency safety valve is theoretical unless someone is
 * chased when a request sits undecided. A PENDING waiver-reopen request older
 * than 5 WORKING days (utils/working-days — the SAME Thai-holiday-aware
 * engine that runs the farmer's deadline, deliberately symmetric: the
 * platform holds itself to the clock it holds farmers to) escalates on every
 * daily run until decided:
 *   * the waiver approvers — both finance roles (operator 2026-09-27 (B)) —
 *     are re-pinged, and
 *   * the requesting inspector gets visibility that the case is stuck —
 *     the de-facto appeal/chase channel.
 *
 * Idempotence = cadence: registered daily in jobs/scheduler.js, so "re-alert
 * once per day until decided" is by design (pressure, not spam). Notification
 * failures are non-fatal per recipient.
 */

const { prisma } = require('../services/prisma-database');
const { withoutTenantScope } = require('../services/tenant-context');
const { listWaiverApproverIds } = require('../services/waiver-approvers');
const { sendNotification, NotifyType } = require('../services/notification-service');
const { addWorkingDays } = require('../utils/working-days');
const { createLogger } = require('../shared/logger');

const logger = createLogger('waiver-sla-escalation');

const SLA_DAYS = 5;

async function runWaiverSlaEscalation({ now = new Date() } = {}) {
    const pending = await withoutTenantScope(() => prisma.waiverReopenRequest.findMany({
        where: { status: 'PENDING' },
        include: { application: { select: { applicationNumber: true } } },
        orderBy: { createdAt: 'asc' },
    }));

    const summary = { checked: pending.length, stale: 0, notified: 0 };

    for (const request of pending) {
        const decisionDue = addWorkingDays(new Date(request.createdAt), SLA_DAYS);
        if (decisionDue.getTime() >= now.getTime()) { continue; }
        summary.stale += 1;

        const accountantIds = await listWaiverApproverIds(request.organizationId);

        const recipients = new Set(accountantIds);
        if (request.requestedBy) { recipients.add(request.requestedBy); }

        for (const userId of recipients) {
            // sendNotification NEVER throws — it catches internally and
            // returns null on failure (real contract). Count only persisted
            // notifications; the try/catch stays as a belt for future
            // contract drift.
            try {
                const sent = await sendNotification(userId, NotifyType.WAIVER_REOPEN_SLA_OVERDUE, {
                    applicationNumber: request.application?.applicationNumber,
                    requestId: request.id,
                    reasonCode: request.reasonCode,
                    requestedAt: new Date(request.createdAt).toISOString(),
                    decisionDue: decisionDue.toISOString(),
                });
                if (sent) {
                    summary.notified += 1;
                } else {
                    logger.warn(`[waiver-sla] notify ${userId} was not persisted (non-fatal)`);
                }
            } catch (notifyErr) {
                logger.warn(`[waiver-sla] notify ${userId} failed (non-fatal): ${notifyErr?.message}`);
            }
        }
        logger.info(`[waiver-sla] request ${request.id} (${request.application?.applicationNumber}) pending past SLA — escalated to ${recipients.size} recipients`);
    }

    return summary;
}

module.exports = { runWaiverSlaEscalation, SLA_DAYS };
