const express = require('express');
const router = express.Router();
const { prisma } = require('../../../services/prisma-database');
// L-001: a holiday loader used to be destructured here and its result threaded
// into computeRemainingWorkingDays. It merged an environment variable with a
// system-configuration row (both named in the audit ledger L-001) — neither of
// which this repository ever seeds — so it returned an empty Set on every run in
// any environment built from this tree and `workingDaysRemaining` was weekend-
// only. Not yet verified: the state of the staging DB and env (L-001 F1, operator
// check pending). If that row or that var was set by hand on a deployed system,
// this number WAS holiday-aware there and the change below alters it. Otherwise
// dropping the call leaves the number unchanged and removes the second Thai
// holiday calendar; the canonical one is utils/working-days.js.
// Note what does NOT depend on it: the EXPIRE decision below is `dueDate < now`
// on a deadline that the canonical ICT engine stamped — only the advisory
// `workingDaysRemaining` field in the reminder payload reads this arithmetic.
const {
    countWorkingDays,
} = require('../../../services/working-days-service');
const {
    notifyRevisionDeadlineApproaching,
    // Blocker I (full-system audit 2026-07-07): the EXPIRED branch below flipped
    // the application and notified NOBODY — the farmer lost the งวด-1 fee with
    // no explanation. sendNotification + NotifyType power the applicant notice.
    sendNotification,
    NotifyType,
} = require('../../../services/notification-service');
const { withoutTenantScope } = require('../../../services/tenant-context');
const logger = require('../../../shared/logger');
const crypto = require('crypto'); // C5-05: constant-time cron-secret compare
const { writeApplicationStatus } = require('../../../services/application-status-writer');

function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function toValidDate(value) {
    if (!value) {
        return null;
    }
    const parsed = value instanceof Date ? new Date(value) : new Date(String(value));
    return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function parseAutoCancelDueDate(application) {
    const formData = asObject(application?.formData);
    const status = String(application?.status || '').toUpperCase();

    if (status === 'REVISION_REQUESTED') {
        return toValidDate(
            formData.revisionDueAt
            || formData.revision_due_at
            || application?.revisionDeadline?.revisionDue
            || null,
        );
    }

    if (status === 'CAR_PENDING') {
        return toValidDate(formData.carDueAt || formData.car_due_at || null);
    }

    return null;
}

function resolveReminderBucket(hoursRemaining) {
    if (!Number.isFinite(hoursRemaining) || hoursRemaining <= 0) {
        return null;
    }
    if (hoursRemaining <= 24) {
        return 24;
    }
    if (hoursRemaining <= 48) {
        return 48;
    }
    return null;
}

function resolveReminderField(status, bucket) {
    const normalizedStatus = String(status || '').toUpperCase();
    if (normalizedStatus === 'REVISION_REQUESTED') {
        return bucket === 24 ? 'revisionReminder24hSentAt' : 'revisionReminder48hSentAt';
    }
    if (normalizedStatus === 'CAR_PENDING') {
        return bucket === 24 ? 'carReminder24hSentAt' : 'carReminder48hSentAt';
    }
    return null;
}

function resolveDeadlineType(status) {
    return String(status || '').toUpperCase() === 'CAR_PENDING' ? 'CAR' : 'REVISION';
}

function computeRemainingWorkingDays(now, dueDate, holidays) {
    if (!(dueDate instanceof Date) || !Number.isFinite(dueDate.getTime())) {
        return 0;
    }
    if (dueDate <= now) {
        return 0;
    }
    return Math.max(0, countWorkingDays(now, dueDate, holidays) - 1);
}

function verifyCronSecret(req) {
    const configuredSecret = String(process.env.CRON_SECRET || '').trim();
    if (!configuredSecret) {
        // SECURITY: reject when CRON_SECRET is not configured
        logger.error('[Cron] CRON_SECRET environment variable is not set. Rejecting request.');
        return false;
    }
    // PENTEST R3-01 — header-only. A ?secret= query fallback lands the CRON_SECRET
    // verbatim in nginx/Cloudflare access logs, proxy logs, and Referer headers,
    // where anyone with log read access recovers it and can drive the SYSTEM
    // auto-cancel/expire transitions. Headers are not written to access logs by
    // default. The in-process node-cron jobs do not use this route.
    const provided = String(req.headers['x-cron-secret'] || '').trim();
    // C5-05 (audit 2026-06-10): constant-time compare — `===` short-circuits on the
    // first differing byte, leaking the secret length/prefix via timing. timingSafeEqual
    // needs equal-length buffers, so gate on length first (length is not itself secret).
    if (!provided) { return false; }
    const a = Buffer.from(provided);
    const b = Buffer.from(configuredSecret);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.get('/auto-cancel', async (req, res) => {
    try {
        if (!verifyCronSecret(req)) {
            return res.status(401).json({
                success: false,
                error: 'CRON_SECRET_INVALID',
            });
        }

        const dryRun = String(req.query.dryRun || 'false').trim().toLowerCase() === 'true';
        const now = new Date();
        // Empty by construction — the removed loader never produced anything
        // else here (see the note on the import). Kept as a named binding so
        // computeRemainingWorkingDays is called with exactly the argument it
        // received before L-001.
        const holidays = new Set();
        const applications = await prisma.application.findMany({
            where: {
                isDeleted: false,
                status: { in: ['REVISION_REQUESTED', 'CAR_PENDING'] },
            },
            include: {
                revisionDeadline: true,
            },
            orderBy: { updatedAt: 'asc' },
        });

        const expired = applications.filter((application) => {
            const dueDate = parseAutoCancelDueDate(application);
            return dueDate && dueDate < now;
        });
        const reminders = applications
            .map((application) => {
                const dueDate = parseAutoCancelDueDate(application);
                if (!dueDate || dueDate <= now) {
                    return null;
                }
                const remainingMs = dueDate.getTime() - now.getTime();
                const hoursRemaining = Math.max(0, Math.ceil(remainingMs / (60 * 60 * 1000)));
                const bucket = resolveReminderBucket(hoursRemaining);
                if (!bucket) {
                    return null;
                }
                const formData = asObject(application.formData);
                const reminderField = resolveReminderField(application.status, bucket);
                if (!reminderField || formData[reminderField]) {
                    return null;
                }
                return {
                    applicationId: application.id,
                    applicationNumber: application.applicationNumber,
                    status: application.status,
                    deadlineType: resolveDeadlineType(application.status),
                    dueAt: dueDate.toISOString(),
                    reminderBucketHours: bucket,
                    hoursRemaining,
                    workingDaysRemaining: computeRemainingWorkingDays(now, dueDate, holidays),
                    reminderField,
                    formData,
                };
            })
            .filter(Boolean);

        if (dryRun || (expired.length === 0 && reminders.length === 0)) {
            return res.json({
                success: true,
                data: {
                    dryRun,
                    checked: applications.length,
                    expired: expired.map((application) => ({
                        id: application.id,
                        applicationNumber: application.applicationNumber,
                        status: application.status,
                    })),
                    reminders: reminders.map((item) => ({
                        applicationId: item.applicationId,
                        applicationNumber: item.applicationNumber,
                        status: item.status,
                        deadlineType: item.deadlineType,
                        dueAt: item.dueAt,
                        reminderBucketHours: item.reminderBucketHours,
                        hoursRemaining: item.hoursRemaining,
                        workingDaysRemaining: item.workingDaysRemaining,
                    })),
                    remindersSentCount: 0,
                    cancelledCount: 0,
                },
            });
        }

        const remindersSent = [];
        for (const reminder of reminders) {
            const nowIso = new Date().toISOString();
            const delivered = await notifyRevisionDeadlineApproaching(
                reminder.applicationId,
                reminder.reminderBucketHours,
                {
                    unit: 'hours',
                    deadlineType: reminder.deadlineType,
                },
            );

            // Blocker I / top-5 #4: stamp the reminder as sent ONLY when the
            // helper confirms delivery (returns the created notification).
            // Stamping on failure lost the reminder forever — the next run saw
            // the stamp and never retried, so the farmer approached auto-cancel
            // with no warning. Unstamped ⇒ retried on the next cron run.
            if (!delivered) {
                logger.warn(
                    `[Cron] deadline reminder NOT delivered for ${reminder.applicationNumber} ` +
                    `(bucket ${reminder.reminderBucketHours}h) — leaving unstamped for retry`,
                );
                continue;
            }

            await prisma.application.update({
                where: { id: reminder.applicationId },
                data: {
                    formData: {
                        ...asObject(reminder.formData),
                        [reminder.reminderField]: nowIso,
                    },
                },
            });

            remindersSent.push({
                applicationId: reminder.applicationId,
                applicationNumber: reminder.applicationNumber,
                status: reminder.status,
                deadlineType: reminder.deadlineType,
                reminderBucketHours: reminder.reminderBucketHours,
                dueAt: reminder.dueAt,
                sentAt: nowIso,
            });
        }

        let cancelledCount = 0;
        const cancelled = [];
        for (const application of expired) {
            const nowIso = new Date().toISOString();
            const workflowHistory = asArray(application.workflowHistory);
            const formData = asObject(application.formData);
            const reason = String(application.status || '').toUpperCase() === 'CAR_PENDING'
                ? 'CAR_OVERDUE'
                : 'REVISION_OVERDUE';

            await prisma.$transaction(async (tx) => {
                await writeApplicationStatus({
                    prisma: tx,
                    applicationId: application.id,
                    fromStatus: application.status,
                    toStatus: 'EXPIRED',
                    actorId: 'cron',
                    actorRole: 'system',
                    reason: `AUTO_EXPIRED:${reason}`,
                    additionalData: {
                        formData: {
                            ...formData,
                            workflowState: 'EXPIRED',
                            workflowStateUpdatedAt: nowIso,
                            cancelReason: reason,
                            canceledExpiredAt: nowIso,
                        },
                        workflowHistory: [
                            ...workflowHistory,
                            {
                                timestamp: nowIso,
                                action: 'AUTO_EXPIRED',
                                fromStatus: application.status,
                                toStatus: 'EXPIRED',
                                reason,
                                actorRole: 'system',
                            },
                        ],
                    },
                });

                await tx.revisionDeadline.updateMany({
                    where: {
                        applicationId: application.id,
                        status: { in: ['PENDING', 'EXTENDED'] },
                    },
                    data: {
                        status: 'FAILED',
                        updatedBy: 'system',
                    },
                });
            });

            cancelledCount += 1;
            cancelled.push({
                id: application.id,
                applicationNumber: application.applicationNumber,
                fromStatus: application.status,
                toStatus: 'EXPIRED',
            });

            // Blocker I (full-system audit 2026-07-07): this branch previously
            // expired the application and notified NOBODY — the farmer, who has
            // paid งวดที่ 1 (5,535 บาท), discovered the cancellation only by
            // polling the dashboard. Tell them what happened + the consequence
            // (must re-apply and pay again). Best-effort: a notification hiccup
            // must not undo the expiry (mirrors revision-deadline-checker.js).
            try {
                if (application.healthId) {
                    // Application.healthId is the FK token pointing at
                    // User.canonicalId (detokenize STAGE A) — resolve to User.id
                    // because notification.userId FK requires it. User IS in
                    // TENANT_SCOPED_MODELS (tenant-prisma-extension.js), so make
                    // the cross-tenant read explicit with withoutTenantScope —
                    // this route is unauthenticated-cron (no tenant context) but
                    // the explicit escape keeps the lookup correct if this block
                    // is ever copied into an authenticated route where ENT-01
                    // read-scope would silently filter it (mirrors
                    // jobs/revision-deadline-checker.js).
                    const applicantUser = await withoutTenantScope(() => prisma.user.findFirst({
                        where: { canonicalId: application.healthId, isDeleted: false },
                        select: { id: true },
                    }));
                    if (applicantUser?.id) {
                        await sendNotification(applicantUser.id, NotifyType.APPLICATION_EXPIRED, {
                            applicationNumber: application.applicationNumber,
                            reason: reason === 'CAR_OVERDUE'
                                ? 'ไม่ส่งงานแก้ไข (CAR) ภายใน 5 วันทำการ'
                                : 'ไม่ส่งเอกสารแก้ไขภายใน 5 วันทำการ',
                            expiredAt: nowIso,
                        });
                    } else {
                        logger.warn(`[Cron] applicant User not found for ${application.applicationNumber}; skipping expiry notification`);
                    }
                }
            } catch (notifyErr) {
                logger.error(`[Cron] expiry notification failed for ${application.applicationNumber} (non-fatal): ${notifyErr?.message}`);
            }
        }

        return res.json({
            success: true,
            data: {
                dryRun: false,
                checked: applications.length,
                remindersSentCount: remindersSent.length,
                remindersSent,
                cancelledCount,
                cancelled,
            },
        });
    } catch (error) {
        logger.error('[Cron Auto Cancel] Error:', error);
        // Do not echo raw error.message — the real cause is logged above.
        return res.status(500).json({
            success: false,
            error: 'Failed to process auto-cancel',
        });
    }
});

module.exports = router;
