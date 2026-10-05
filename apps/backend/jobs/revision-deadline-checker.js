/**
 * Revision Deadline Auto-Cancel Job
 * 
 * ตรวจสอบ revision deadline ที่หมดอายุ (5 วันทำการ)
 * และเปลี่ยนสถานะเป็น EXPIRED/CANCEL_EXPIRED อัตโนมัติ
 * 
 * ทำงานผ่าน node-cron ทุก 1 ชั่วโมง (ใน scheduler.js)
 * 
 * @module jobs/revision-deadline-checker
 */

const { prisma } = require('../services/prisma-database');
const { sendNotification, NotifyType } = require('../services/notification-service');
const { runWithTenantContext, withoutTenantScope } = require('../services/tenant-context');
const logger = require('../shared/logger');
const { getDeadlineStatus } = require('../utils/working-days');
const { APPLICATION_STATUSES } = require('../shared/workflow-state-machine');
const { writeApplicationStatus } = require('../services/application-status-writer');
// AppAudit AH2 (2026-05-15): the EXPIRED transition is routed through the
// canonical `buildTransitionUpdate` helper so the workflow guards (role
// permissions, mandatory-comment checks, terminal-status semantics) are
// applied to cron-driven transitions identically to user-driven ones. Without
// the canonical helper a cron job could silently violate transition rules that
// the HTTP path enforces.
const { buildTransitionUpdate } = require('../services/workflow-transition-service');
const { CANONICAL_ROLES } = require('../shared/canonical-rbac');
const { auditLogger, AuditCategory, ResourceType } = require('../middleware/audit-logger');

// R2 M4: the only terminal close-reason this cron may stamp (unified vocab — see
// prisma migration 20260805090000_add_application_closed_reason + the
// closed-reason-reserved-slots guard). Every other vocab value is reserved for a
// separate backlog writer and MUST stay unwired here.
const M4_CLOSED_REASON = 'CORRECTION_DEADLINE_EXPIRED';

/**
 * ตรวจสอบและ auto-cancel revision deadlines ที่หมดอายุ
 * 
 * Flow:
 * 1. ดึง deadlines ที่ status = 'PENDING' หรือ 'EXTENDED'
 * 2. ตรวจสอบว่าหมดเขตแล้วหรือไม่ (ใช้ working days)
 * 3. เปลี่ยนสถานะ deadline เป็น 'EXPIRED'
 * 4. เปลี่ยนสถานะ application เป็น 'EXPIRED' (CANCEL_EXPIRED)
 * 5. ส่ง notification แจ้ง Applicant + provider
 * 
 * @returns {{ processed: number, expired: number, errors: number }}
 */
async function checkExpiredDeadlines() {
    logger.info('[Revision Deadline Checker] Starting check...');

    const stats = { processed: 0, expired: 0, errors: 0 };

    try {
        // 1. ดึง revision deadline ที่ยัง active
        // Cross-tenant scan: cron has no tenant scope; per-deadline writes
        // re-enter the deadline's tenant via runWithTenantContext below.
        const activeDeadlines = await withoutTenantScope(() => prisma.revisionDeadline.findMany({
            where: {
                status: { in: ['PENDING', 'EXTENDED'] },
            },
            include: {
                // Application column is `status` (not `state`); legacy
                // code selected `state` here — Prisma rejected the entire
                // findMany on every cron tick, so no auto-cancel of
                // overdue revision deadlines ever happened. Caught by the
                // post-PR-#197 schema-drift sweep alongside sla-monitor.js
                // and sla-processor.js.
                application: {
                    select: {
                        id: true,
                        applicationNumber: true,
                        status: true,
                        healthId: true,
                        organizationId: true,
                        // Bug 2.1 fix: these two JSON columns MUST be selected.
                        // Without them the row's formData/workflowHistory are
                        // undefined, so the EXPIRED write's
                        // `{...app.formData, _autoExpired}` spread collapses to
                        // just `{_autoExpired}` (wiping all applicant/plot data)
                        // and buildTransitionUpdate appends the EXPIRED event to
                        // an EMPTY history (resetting the entire audit trail).
                        // Selecting them lets both merges preserve real data.
                        formData: true,
                        workflowHistory: true,
                        applicant: {
                            select: {
                                firstName: true,
                                lastName: true,
                            },
                        },
                    },
                },
            },
        }));

        logger.info(`[Revision Deadline Checker] Found ${activeDeadlines.length} active deadlines`);
        stats.processed = activeDeadlines.length;

        for (const deadline of activeDeadlines) {
            const orgId = deadline.application?.organizationId;
            if (!orgId) {
                stats.errors++;
                logger.error(
                    `[Revision Deadline Checker] Deadline ${deadline.id} missing organizationId; ` +
                    `cannot establish tenant scope. Skipping.`,
                );
                continue;
            }

            await runWithTenantContext({ organizationId: orgId }, async () => {
                try {
                    const deadlineStatus = getDeadlineStatus(deadline.revisionDue);

                    if (!deadlineStatus.isOverdue) {
                        // ยังไม่หมดเขต — ข้ามไป
                        return;
                    }

                    // 2. ตรวจสอบว่า application ยังอยู่ใน revision state หรือไม่
                    const app = deadline.application;
                    if (!app) {
                        logger.warn(`[Revision Deadline Checker] Deadline ${deadline.id} has no application`);
                        return;
                    }

                    const isRevisionState = [
                        APPLICATION_STATUSES.REVISION_REQUESTED,
                        APPLICATION_STATUSES.CAR_PENDING,
                    ].includes(app.status);

                    if (!isRevisionState) {
                        // Application ไม่อยู่ใน revision state แล้ว (อาจถูกส่งแก้ไขแล้ว)
                        // อัปเดต deadline status เป็น COMPLETED
                        await prisma.revisionDeadline.update({
                            where: { id: deadline.id },
                            data: { status: 'COMPLETED', updatedBy: 'system' },
                        });
                        return;
                    }

                    // 3. ACID Transaction: เปลี่ยนสถานะทั้ง deadline + application พร้อมกัน
                    //
                    // Status write goes through writeApplicationStatus (the
                    // canonical writer per ADR-016 Phase 1A + Phase A6 lint
                    // rule `gacp/no-direct-application-status-write`):
                    //
                    //   - Updates Application.status atomically
                    //   - Spawns WorkActivity rows for the destination stage
                    //   - EXPIRED is in TERMINAL_STATUSES, so any open
                    //     WorkActivity rows for this application
                    //     (CLAIMED/IN_PROGRESS/TODO) are auto-cancelled with
                    //     reason "reached terminal status EXPIRED" — keeps
                    //     queues clean
                    //
                    // The previous implementation wrote `status` directly via
                    // tx.application.update (lint violation on a column-
                    // name-fix in PR #197) AND tried to write to a
                    // `tx.workflowEvent.create()` table that doesn't exist
                    // (silent .catch hid the always-failure). Both removed
                    // here — writeApplicationStatus handles audit + activity
                    // cancellation natively.
                    await prisma.$transaction(async (tx) => {
                        // Update deadline → EXPIRED
                        await tx.revisionDeadline.update({
                            where: { id: deadline.id },
                            data: {
                                status: 'EXPIRED',
                                updatedBy: 'system',
                            },
                        });

                        // AppAudit AH2: route the EXPIRED transition through
                        // `buildTransitionUpdate` so the canonical guards are
                        // exercised. WF-F4: `system` now owns REVISION_REQUESTED
                        // ->EXPIRED and CAR_PENDING->EXPIRED in ROLE_TRANSITIONS,
                        // so the cron transitions as its own actor instead of an
                        // admin force-override (which previously logged routine
                        // deadline expiry as WORKFLOW_FORCE_TRANSITION, masking it
                        // as a manual admin action). The resulting payload then
                        // drives `writeApplicationStatus` for the actual write.
                        const transitionUpdate = buildTransitionUpdate({
                            application: app,
                            toState: 'EXPIRED',
                            actorId: 'cron-revision-deadline-checker',
                            actorRole: 'system',
                            reasonCode: 'REVISION_DEADLINE_EXCEEDED',
                            comment:
                                `Auto-cancelled: revision deadline exceeded (5 working days). ` +
                                `Original due: ${deadline.revisionDue.toISOString()}`,
                        });

                        await writeApplicationStatus({
                            prisma: tx,
                            applicationId: app.id,
                            fromStatus: app.status,
                            toStatus: APPLICATION_STATUSES.EXPIRED,
                            actorId: 'cron-revision-deadline-checker',
                            actorRole: 'system',
                            reason:
                                `Auto-cancelled: revision deadline exceeded (5 working days). ` +
                                `Original due: ${deadline.revisionDue.toISOString()}`,
                            additionalData: {
                                ...(transitionUpdate?.updateData || {}),
                                // R2 M4 change #1: stamp the unified terminal close-reason so
                                // this auto-close is reopen-eligible for mechanism 2. This is
                                // the ONLY closedReason value this cron writes.
                                closedReason: M4_CLOSED_REASON,
                                formData: {
                                    ...(typeof app.formData === 'object' ? app.formData : {}),
                                    _autoExpired: {
                                        expiredAt: new Date().toISOString(),
                                        reason: 'REVISION_DEADLINE_EXCEEDED',
                                        deadlineId: deadline.id,
                                        originalDeadline: deadline.revisionDue.toISOString(),
                                    },
                                },
                            },
                            // R2 M4 change #2: emit exactly ONE canonical (hash-chained) audit
                            // row for the auto-close. writeApplicationStatus fires this only
                            // after the status write succeeds; auditLogger.log computes the
                            // per-tenant hash chain (a real +1 row, not a plain log). Best-
                            // effort — the writer swallows a callback error so a transient
                            // audit hiccup never blocks the deadline close.
                            onAudit: async (entry) => {
                                await auditLogger.log({
                                    category: AuditCategory.APPLICATION,
                                    action: 'APPLICATION_AUTO_EXPIRED',
                                    severity: 'INFO',
                                    actorId: 'cron-revision-deadline-checker',
                                    actorType: 'SYSTEM',
                                    actorRole: 'system',
                                    resourceType: ResourceType.APPLICATION,
                                    resourceId: app.id,
                                    organizationId: orgId,
                                    metadata: {
                                        closedReason: M4_CLOSED_REASON,
                                        reason: 'REVISION_DEADLINE_EXCEEDED',
                                        deadlineId: deadline.id,
                                        fromStatus: entry?.fromStatus ?? app.status,
                                        toStatus: entry?.toStatus ?? APPLICATION_STATUSES.EXPIRED,
                                        originalDeadline: deadline.revisionDue.toISOString(),
                                    },
                                });
                            },
                        });
                    });

                    stats.expired++;

                    logger.info(
                        `[Revision Deadline Checker] Auto-cancelled: ${app.applicationNumber} ` +
                        `(deadline: ${deadline.revisionDue.toISOString()}, status: ${app.status} → EXPIRED)`,
                    );

                    // 4. Send notifications
                    try {
                        // Notify Applicant — hardening-iter4 fix: sendNotification's recipientId
                        // is a User.id (notification.userId FK), NOT the 13-digit healthId.
                        // Passing app.healthId here violated notifications_userId_fkey (caught
                        // + swallowed below) so the applicant was NEVER told their application
                        // auto-expired. Resolve healthId → User.id first. (User is not
                        // tenant-scoped; withoutTenantScope keeps the lookup unfiltered.)
                        if (app.healthId) {
                            const applicantUser = await withoutTenantScope(() => prisma.user.findFirst({
                                // Detokenize STAGE 0 (data-state-agnostic): app.healthId is the
                                // Application.healthId FK value, which points at User.canonicalId
                                // (NOT User.healthId). Query by canonicalId so the auto-expire
                                // notification still resolves after the STAGE-A re-key. Both states.
                                where: { canonicalId: app.healthId, isDeleted: false },
                                select: { id: true },
                            }));
                            if (applicantUser?.id) {
                                await sendNotification(applicantUser.id, NotifyType.APPLICATION_EXPIRED, {
                                    applicationNumber: app.applicationNumber,
                                    reason: 'ไม่ส่งงานแก้ไขภายใน 5 วันทำการ',
                                    expiredAt: new Date().toISOString(),
                                });
                            } else {
                                logger.warn(`[Revision Deadline Checker] applicant User not found for healthId on ${app.applicationNumber}; skipping applicant notification`);
                            }
                        }

                        // Notify the dispatchers/DTAM admins OF THE DEADLINE'S ORG only —
                        // both roles are bound to their own organization (canonical-rbac),
                        // and the message carries this org's application number and
                        // applicant name. This lookup used to sit in withoutTenantScope
                        // with no org filter; it stayed in-org only because the lazy
                        // PrismaPromise ran under this tenant anyway. Since 2026-09-29
                        // withoutTenantScope really drops the tenant, so the org is
                        // stated here instead of inherited.
                        // users.role is canonical (migration 20260801000000):
                        // lowercase, with SUPER_ADMIN already collapsed into
                        // 'admin'. The legacy spellings this filter used to
                        // carry matched ZERO rows post-migration, which turned
                        // the deadline-expired fan-out into a silent no-op.
                        const provider = await prisma.user.findMany({
                            where: {
                                role: { in: [CANONICAL_ROLES.DISPATCHER, CANONICAL_ROLES.SYSTEM_ADMIN_DTAM] },
                                status: 'ACTIVE',
                                accountType: 'PROVIDER',
                                isDeleted: false,
                                organizationId: orgId,
                            },
                            select: { id: true },
                        });

                        for (const providerMember of provider) {
                            await sendNotification(providerMember.id, NotifyType.REVISION_DEADLINE_EXPIRED, {
                                applicationId: app.id,
                                applicationNumber: app.applicationNumber,
                                applicantName: `${app.applicant?.firstName || ''} ${app.applicant?.lastName || ''}`.trim(),
                            });
                        }
                    } catch (notifyError) {
                        logger.warn('[Revision Deadline Checker] Notification failed:', notifyError.message);
                        // Non-fatal — don't count as error
                    }

                } catch (itemError) {
                    stats.errors++;
                    logger.error(`[Revision Deadline Checker] Error processing deadline ${deadline.id}:`, itemError);
                }
            });
        }

        logger.info(
            `[Revision Deadline Checker] Completed: ${stats.processed} checked, ` +
            `${stats.expired} expired, ${stats.errors} errors`,
        );

        return stats;
    } catch (error) {
        logger.error('[Revision Deadline Checker] Fatal error:', error);
        throw error;
    }
}

module.exports = { checkExpiredDeadlines };
