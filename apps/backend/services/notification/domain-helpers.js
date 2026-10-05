/**
 * Domain-specific notification helpers.
 * Extracted from notification-service.js for readability.
 *
 * Each function fetches the relevant application/users and delegates to
 * the core createNotification / createBulkNotifications primitives.
 *
 * @module services/notification/domain-helpers
 */

const prisma = require('../prisma-database').prisma;
const { createLogger } = require('../../shared/logger');
const logger = createLogger('notification-domain');

const { createNotification, createBulkNotifications, NotifyType } = require('../notification-service');
const { CANONICAL_ROLES } = require('../../shared/canonical-rbac');
// Platform-wide staff lookups run outside the requester's tenant (see
// notifyAdminCheckoutPriceDrift). services/tenant-context.js owns the scope.
const { withoutTenantScope } = require('../tenant-context');
const { DEFAULT_TIME_ZONE } = require('../../utils/working-days');

// users.role spellings to fan notifications out to, in BOTH the legacy casing
// and the canonical one. These filters were uppercase-only, so migration
// 20260801000000_canonicalize_user_role would have made them match nothing —
// and an empty recipient list is not an error, so the notifications would just
// stop arriving with nothing in the logs to show it.
const SCHEDULER_NOTIFY_ROLES = Object.freeze([CANONICAL_ROLES.DISPATCHER, CANONICAL_ROLES.SYSTEM_ADMIN_DTAM]);
// 'EXECUTIVE' was kept verbatim through the expand phase because it has no
// canonical mapping. It is a QUARANTINE_VALUE, and 20260801000000 ABORTS when a
// quarantined row exists — it ran clean, so no row holds it. A dead value left
// in an authorization filter is an invitation to copy the pattern.
const SLA_ESCALATION_ROLES = Object.freeze([CANONICAL_ROLES.SYSTEM_ADMIN_DTAM]);

// The platform's own ops tenant, named the two ways this repo already names it:
// Organization.type INTERNAL ("platform's own ops tenant (default org)",
// prisma/schema/tenancy.prisma) and the 'default' slug that audit-logger
// and every seed resolve. scripts/cleanup-test-organizations.js protects it by
// the same pair, belt and braces, because a deployment may carry only one.
const PLATFORM_ORG_WHERE = Object.freeze({
    OR: [{ type: 'INTERNAL' }, { slug: 'default' }],
});

// Who may read a PLATFORM alert — one that carries another party's application
// number and its money figures. PLATFORM_ADMIN is the cross-tenant operator
// role; ADMIN is TENANT-scoped ("Tenant ADMINs are scoped to their own org
// (SEC-PROV-001)", shared/canonical-rbac.js), so an ADMIN qualifies only inside
// the platform's own ops tenant. While these rows carried the APPLICANT's
// organizationId the over-broad set was inert — a foreign tenant's org-scoped
// inbox never returned them; stamping each row with the RECIPIENT's org is what
// would have shown organisation A's figures to organisation B's admin
// (whole-branch review r1).
//
// This is the WHERE itself, not a list of roles beside it (review r2, minor 1):
// the previous PLATFORM_ALERT_ROLES constant was read by nobody but the
// no-recipient log, so it reported a wider set than the query ever asked for,
// and a role added to it changed who got alerted not at all. One spelling —
// findPlatformStaffAcrossTenants runs it, reportAlertReachedNobody reports it.
const PLATFORM_ALERT_RECIPIENT_WHERE = Object.freeze({
    isDeleted: false,
    OR: [
        // The cross-tenant operator, wherever their user row sits.
        { role: CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM },
        // An ADMIN of the platform's own ops tenant, and only of it.
        { role: CANONICAL_ROLES.SYSTEM_ADMIN_DTAM, organization: PLATFORM_ORG_WHERE },
    ],
});

// ── Payment ────────────────────────────────────────────────

async function notifyPaymentSuccess(applicationId, phase) {
    try {
        const application = await prisma.application.findUnique({
            where: { id: applicationId },
            include: { applicant: true },
        });
        if (!application) {return;}
        const isPhase1 = phase === 'PHASE_1';
        await createNotification({
            userId: application.applicant?.id,
            type: isPhase1 ? NotifyType.PAYMENT_PHASE1_SUCCESS : NotifyType.PAYMENT_PHASE2_SUCCESS,
            title: isPhase1 ? '✅ ชำระเงินสำเร็จ' : '✅ ชำระเงินเฟส 2 สำเร็จ',
            message: isPhase1
                ? `คำขอ ${application.applicationNumber} เข้าสู่ระบบแล้ว`
                : `คำขอ ${application.applicationNumber} พร้อมสำหรับการตรวจประเมิน`,
            data: { applicationId, applicationNumber: application.applicationNumber, phase },
            priority: 'HIGH',
            actionUrl: `/health/applications/${applicationId}`,
        });
    } catch (error) {
        logger.error('[NotificationService] Payment success error:', error);
    }
}

async function notifyPaymentFailed(applicationId, phase, reason) {
    try {
        const application = await prisma.application.findUnique({
            where: { id: applicationId },
            include: { applicant: true },
        });
        if (!application) {return;}
        await createNotification({
            userId: application.applicant?.id,
            type: NotifyType.PAYMENT_FAILED,
            title: '❌ การชำระเงินไม่สำเร็จ',
            message: reason || 'เกิดข้อผิดพลาดในการชำระเงิน',
            data: { applicationId, applicationNumber: application.applicationNumber, phase, reason },
            priority: 'URGENT',
            actionUrl: `/health/applications/preview?id=${applicationId}`,
        });
    } catch (error) {
        logger.error('[NotificationService] Payment failed error:', error);
    }
}

// ── Scheduler ──────────────────────────────────────────────

async function notifySchedulerNewSubmission(applicationId) {
    try {
        const application = await prisma.application.findUnique({
            where: { id: applicationId },
            include: { applicant: true },
        });
        if (!application) {return;}
        const schedulers = await prisma.user.findMany({
            where: { role: { in: [...SCHEDULER_NOTIFY_ROLES] }, isDeleted: false },
        });
        await createBulkNotifications({
            userIds: schedulers.map(s => s.id),
            type: NotifyType.NEW_SUBMISSION,
            title: '📋 คำขอใหม่เข้าระบบ',
            message: `คำขอ ${application.applicationNumber} รอการจ่ายงาน`,
            data: { applicationId, applicationNumber: application.applicationNumber },
            priority: 'NORMAL',
        });
    } catch (error) {
        logger.error('[NotificationService] Scheduler notification error:', error);
    }
}

async function notifySchedulerReadyForAudit(applicationId) {
    try {
        const application = await prisma.application.findUnique({
            where: { id: applicationId },
        });
        if (!application) {return;}
        const schedulers = await prisma.user.findMany({
            where: { role: { in: [...SCHEDULER_NOTIFY_ROLES] }, isDeleted: false },
        });
        await createBulkNotifications({
            userIds: schedulers.map(s => s.id),
            type: NotifyType.READY_FOR_AUDIT,
            title: '🔍 พร้อมนัดตรวจฟาร์ม',
            message: `คำขอ ${application.applicationNumber} ชำระเงินครบแล้ว`,
            data: { applicationId, applicationNumber: application.applicationNumber },
            priority: 'HIGH',
        });
    } catch (error) {
        logger.error('[NotificationService] Ready for audit error:', error);
    }
}

// ── Assignment ─────────────────────────────────────────────

async function notifyReviewerAssigned(applicationId, reviewerId, assignedBy) {
    try {
        const application = await prisma.application.findUnique({ where: { id: applicationId } });
        if (!application) {return;}
        await createNotification({
            userId: reviewerId,
            type: NotifyType.ASSIGNED_REVIEWER,
            title: '📋 ได้รับมอบหมายตรวจเอกสาร',
            message: `คำขอ ${application.applicationNumber} รอการตรวจสอบ`,
            data: { applicationId, applicationNumber: application.applicationNumber, assignedBy },
            priority: 'HIGH',
            // /provider/review/:id ไม่เคยมี — คิวงานของผู้ตรวจเอกสารอยู่ที่ /provider/reviewer
            actionUrl: '/provider/reviewer',
        });
    } catch (error) {
        logger.error('[NotificationService] Reviewer assigned error:', error);
    }
}

async function notifyAuditorAssigned(applicationId, auditorId, scheduledDate) {
    try {
        const application = await prisma.application.findUnique({ where: { id: applicationId } });
        if (!application) {return;}
        await createNotification({
            userId: auditorId,
            type: NotifyType.ASSIGNED_AUDITOR,
            title: '🔍 ได้รับมอบหมายตรวจพื้นที่',
            message: `คำขอ ${application.applicationNumber} นัดหมายวันที่ ${new Date(scheduledDate).toLocaleDateString('th-TH', { timeZone: DEFAULT_TIME_ZONE })}`,
            data: { applicationId, applicationNumber: application.applicationNumber, scheduledDate },
            priority: 'HIGH',
            // /provider/audit/:id ไม่เคยมี — หน้าจริงคือ /provider/audits/:id
            // ซึ่งอ่าน params.id เป็น applicationId อยู่แล้ว (audits/[id]/page.tsx:57)
            actionUrl: `/provider/audits/${applicationId}`,
        });
    } catch (error) {
        logger.error('[NotificationService] Auditor assigned error:', error);
    }
}

// ── Revision & Audit ───────────────────────────────────────

async function notifyRevisionRequired(applicationId, reason, deadline) {
    try {
        const application = await prisma.application.findUnique({
            where: { id: applicationId },
            include: { applicant: true },
        });
        if (!application) {return;}
        // Farmer-facing copy: Thai with Buddhist-era long-form deadline so
        // rural users see e.g. "16 พฤษภาคม พุทธศักราช 2569" instead of an ISO
        // string. The notification key uses the canonical REVISION_REQUESTED
        // (legacy REVISION_REQUIRED still resolves via NOTIFY_TYPE_ALIASES).
        let deadlineThai = 'ภายในเวลาที่กำหนด';
        if (deadline) {
            try {
                deadlineThai = new Date(deadline).toLocaleDateString('th-TH', {
                    timeZone: DEFAULT_TIME_ZONE,
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    era: 'long',
                });
            } catch (_e) {
                deadlineThai = String(deadline);
            }
        }
        await createNotification({
            userId: application.applicant?.id,
            type: NotifyType.REVISION_REQUESTED,
            title: '⚠️ ใบสมัครของท่านต้องการการแก้ไข',
            message: `ใบสมัครเลขที่ ${application.applicationNumber} ของท่านต้องดำเนินการแก้ไขให้แล้วเสร็จภายในวันที่ ${deadlineThai}`,
            data: { applicationId, applicationNumber: application.applicationNumber, reason, deadline },
            priority: 'URGENT',
            actionUrl: `/health/applications/${applicationId}/revision`,
        });
    } catch (error) {
        logger.error('[NotificationService] Revision required error:', error);
    }
}

async function notifyDocumentApproved(applicationId, paymentUrl) {
    try {
        const application = await prisma.application.findUnique({
            where: { id: applicationId },
            include: { applicant: true },
        });
        if (!application) {return;}
        await createNotification({
            userId: application.applicant?.id,
            type: NotifyType.DOCUMENT_APPROVED,
            title: '✅ เอกสารผ่านการตรวจสอบ',
            message: `คำขอ ${application.applicationNumber} ผ่านการตรวจสอบแล้ว`,
            data: { applicationId, applicationNumber: application.applicationNumber, paymentUrl },
            priority: 'HIGH',
            // 2026-09-07 — เคยถอยไปที่ `/health/applications/:id/payment` ซึ่งเป็นหน้าที่
            // ไม่เคยมีในระบบ และผู้เรียกรายเดียว (document-reviews.js:378) ส่ง paymentUrl
            // เป็น null เสมอ ⇒ ทุกใบพาเกษตรกรที่เพิ่งผ่านตรวจเอกสารไปเจอ 404
            // หน้าจ่ายเงินจริงคือ /health/payments และรับ ?app= เพื่อเลือกคำขอให้เลย
            actionUrl: paymentUrl || `/health/payments?app=${applicationId}`,
        });
    } catch (error) {
        logger.error('[NotificationService] Document approved error:', error);
    }
}

async function notifyAuditScheduled(applicationId, scheduledDate, auditorName) {
    try {
        const application = await prisma.application.findUnique({
            where: { id: applicationId },
            include: { applicant: true },
        });
        if (!application) {return;}
        await createNotification({
            userId: application.applicant?.id,
            type: NotifyType.AUDIT_SCHEDULED,
            title: '📅 นัดหมายตรวจพื้นที่',
            message: `เจ้าหน้าที่จะเข้าตรวจวันที่ ${new Date(scheduledDate).toLocaleDateString('th-TH', { timeZone: DEFAULT_TIME_ZONE })} โดย ${auditorName}`,
            data: { applicationId, applicationNumber: application.applicationNumber, scheduledDate, auditorName },
            priority: 'HIGH',
            actionUrl: `/health/applications/${applicationId}`,
        });
    } catch (error) {
        logger.error('[NotificationService] Audit scheduled error:', error);
    }
}

/**
 * Deadline-approaching reminder to the applicant.
 *
 * Blocker I / top-5 #4 (full-system audit 2026-07-07):
 * (a) unit-aware copy — routes/api/system/cron.js passes reminderBucketHours
 *     (24/48) with { unit: 'hours' }; the old 2-param signature silently
 *     DROPPED that third argument and rendered "ในอีก 24 วัน" for a 24-HOUR
 *     deadline. `opts.unit === 'hours'` now renders ชั่วโมง.
 * (b) success signal — the old helper swallowed its own errors and returned
 *     undefined, so the cron stamped reminderField "sent" even when nothing
 *     was delivered (reminder lost forever). Now returns the created
 *     notification on success and null on any failure, so the caller stamps
 *     ONLY on success and the next cron run retries.
 *
 * @param {string} applicationId
 * @param {number} remaining — days by default; hours when opts.unit==='hours'
 * @param {{ unit?: 'days'|'hours', deadlineType?: string }} [opts]
 * @returns {Promise<object|null>} the created notification, or null on failure
 */
async function notifyRevisionDeadlineApproaching(applicationId, remaining, opts = {}) {
    try {
        const application = await prisma.application.findUnique({
            where: { id: applicationId },
            include: { applicant: true },
        });
        if (!application) {return null;}
        const isHours = opts.unit === 'hours';
        const deadlineText = isHours
            ? `${remaining} ชั่วโมง`
            : (remaining === 1 ? '1 วัน' : `${remaining} วัน`);
        const notification = await createNotification({
            userId: application.applicant?.id,
            type: NotifyType.DEADLINE_REMINDER,
            title: '⏰ แจ้งเตือนใกล้ครบกำหนด',
            message: `คำขอของคุณใกล้ครบกำหนดแก้ไขในอีก ${deadlineText} กรุณาดำเนินการให้เสร็จสิ้น`,
            data: {
                applicationId,
                applicationNumber: application.applicationNumber,
                remaining,
                unit: isHours ? 'hours' : 'days',
                ...(opts.deadlineType ? { deadlineType: opts.deadlineType } : {}),
            },
            priority: 'HIGH',
            actionUrl: `/health/applications/${applicationId}`,
        });
        return notification || null;
    } catch (error) {
        logger.error('[NotificationService] Revision deadline approaching error:', error);
        return null;
    }
}

async function notifySlaBreach(applicationId, daysStuck, applicationNumber) {
    try {
        const admins = await prisma.user.findMany({
            where: { role: { in: [...SLA_ESCALATION_ROLES] }, isDeleted: false },
        });
        if (admins.length > 0) {
            await createBulkNotifications({
                userIds: admins.map(a => a.id),
                type: NotifyType.SLA_BREACH,
                title: '🚨 ระบบแจ้งเตือน SLA เกินกำหนด (5 วัน)',
                message: `คำขอ ${applicationNumber || applicationId} ล่าช้ามาแล้ว ${daysStuck} วัน`,
                data: { applicationId, applicationNumber, daysStuck },
                priority: 'URGENT',
            });
        }
    } catch (error) {
        logger.error('[NotificationService] SLA breach error:', error);
    }
}

/**
 * The recipients of a PLATFORM-wide staff alert, resolved across tenants.
 *
 * Both alerts below are raised inside an APPLICANT's request, which binds that
 * applicant's organization (middleware/tenant-context-middleware.js). `User` is
 * tenant-scoped and org read-scoping is default-ON, so a plain findMany returns
 * only staff who happen to sit in the applicant's own organization — i.e.
 * usually nobody — and the caller's `length > 0` guard then falls through
 * silently. The escape hatch is exactly what it is documented for.
 *
 * Across tenants is not the same as to everybody: the recipients are PLATFORM
 * staff (PLATFORM_ALERT_RECIPIENT_WHERE above). A tenant ADMIN of
 * another organization is not one, and these alerts carry the applicant's
 * application number and money figures.
 *
 * @returns {Promise<Array<{id: string}>>}
 */
function findPlatformStaffAcrossTenants() {
    return withoutTenantScope(() => prisma.user.findMany({
        where: PLATFORM_ALERT_RECIPIENT_WHERE,
    }));
}

/**
 * Write a staff alert so that each row is stamped with the RECIPIENT's own
 * organizationId.
 *
 * The write runs in the same escape hatch as the lookup: with no context bound,
 * createBulkNotifications takes its per-recipient `userOrgMap` branch, which is
 * what makes the row visible in the recipient's own org-scoped inbox. Left
 * inside the applicant's context, the extension stamped the APPLICANT's
 * organizationId onto a row whose userId is an admin in another organization,
 * and nobody could read it (whole-branch review C3/S5/S9).
 *
 * @param {{admins: Array<{id: string}>, type: string, title: string,
 *          message: string, data: object}} args
 * @returns {Promise<void>}
 */
function sendToPlatformStaff({ admins, type, title, message, data }) {
    return withoutTenantScope(() => createBulkNotifications({
        userIds: admins.map((a) => a.id),
        type,
        title,
        message,
        data,
        priority: 'URGENT',
    }));
}

/**
 * An alert that reached nobody, said out loud AND written down.
 *
 * ERROR, not info: the applicant's screen says "เจ้าหน้าที่ได้รับแจ้งแล้ว" on
 * both of these paths, so zero recipients is the same outcome as not sending
 * it. A console line disappears with the process; the audit row is what makes
 * the day an alert went nowhere findable afterwards.
 *
 * Best-effort in both directions: an audit sink that is down must not turn a
 * best-effort notification helper into a throw.
 *
 * @param {{alert: string, applicationId: string, applicationNumber: string|null,
 *          details?: object}} args
 * @returns {Promise<void>}
 */
async function reportAlertReachedNobody({ alert, applicationId, applicationNumber, details = {} }) {
    logger.error(`[NotificationService] ${alert} alert has NO recipient — nobody was told`, {
        applicationId, applicationNumber: applicationNumber || null,
        // The predicate the lookup ran, not a second spelling of it: whoever
        // picks this line up has to know that only the ops tenant's admins were
        // ever eligible (review r2, minor 1).
        recipientWhere: PLATFORM_ALERT_RECIPIENT_WHERE, ...details,
    });
    try {
        // Lazy require: the audit chain is not on any successful path here.
        const { auditLogger, AuditCategory, AuditSeverity, ResourceType } =
            require('../../middleware/audit-logger');
        await auditLogger.log({
            category: AuditCategory.SYSTEM,
            action: 'ADMIN_ALERT_NO_RECIPIENT',
            severity: AuditSeverity.ERROR,
            actorId: 'SYSTEM',
            // NOT NULL in prisma/schema/audit.prisma, and the writer supplies no
            // default: a row without it is dropped inside log()'s own catch.
            actorRole: 'SYSTEM',
            actorType: 'SYSTEM',
            resourceType: ResourceType.APPLICATION,
            resourceId: applicationId,
            metadata: { alert, applicationNumber: applicationNumber || null, ...details },
        });
    } catch (auditErr) {
        logger.error('[NotificationService] could not record ADMIN_ALERT_NO_RECIPIENT',
            auditErr?.message || String(auditErr));
    }
}

/**
 * Will the system itself issue this application's missing quotation on the
 * applicant's next visit to the payments list?
 *
 * Only inside the mint window: `ensureQuotationForIssuedApplication` returns
 * without minting unless the status is in SELF_HEAL_STATUSES = {SUBMITTED,
 * PENDING_DOC_FEE} (services/quotation-issuance-on-submit.js), the window in
 * which nothing has been paid yet. One of the three doors that raise the alert
 * below is a RENEWAL, whose application is created at RENEWAL_ENTRY_STATE
 * 'PENDING_AUDIT_FEE' (services/renewal-service.js) — outside it. Telling staff
 * on that door that the system re-issues by itself names an act the product
 * never performs, which is the rule this alert was rewritten to obey (F-G4-64
 * R2), and there is no staff issuance door either (ledger F-G4-71).
 *
 * A status that cannot be read answers NO: an alert may under-promise, it may
 * not promise on a fact it does not have.
 *
 * @param {string} applicationId
 * @returns {Promise<boolean>}
 */
async function willSystemReissueOnNextVisit(applicationId) {
    try {
        // Lazy require: quotation-issuance-on-submit requires THIS module to
        // raise the alert, so a top-level require would close the cycle.
        const { SELF_HEAL_STATUSES } = require('../quotation-issuance-on-submit');
        // Across tenants, like the recipient lookup: the renewal door runs
        // inside the applicant's own context, and a narrowed read that answered
        // nothing would silently downgrade to "no promise" for the wrong reason.
        const application = await withoutTenantScope(() => prisma.application.findUnique({
            where: { id: applicationId },
            select: { status: true },
        }));
        return SELF_HEAL_STATUSES.has(String(application?.status || '').toUpperCase());
    } catch (error) {
        logger.error('[NotificationService] could not read the status behind a quotation alert; promising nothing:',
            error?.message || String(error));
        return false;
    }
}

/**
 * Tell the admin queue that an application was submitted with no quotation.
 * F-G4-64 R3: with the acceptance gate fail-closed, this applicant cannot pay
 * until somebody acts, so this is an operational alert, not a log line.
 *
 * Best-effort, like every other helper in this file: a notification sink that
 * is down must not cost an applicant their submission.
 *
 * @param {{applicationId: string, applicationNumber: string|null, reason: string}} args
 * @returns {Promise<void>}
 */
async function notifyAdminQuotationIssueFailed({ applicationId, applicationNumber, reason }) {
    try {
        const admins = await findPlatformStaffAcrossTenants();
        if (admins.length === 0) {
            await reportAlertReachedNobody({
                alert: 'QUOTATION_ISSUE_FAILED',
                applicationId,
                applicationNumber,
                details: { reason: reason || null },
            });
            return;
        }
        // What the product really does next, for THIS application. Inside the
        // mint window the applicant's own GET on the payments list re-issues,
        // once, under control (ensureQuotationForIssuedApplication); outside it
        // nothing re-issues at all, and the retired wording promised every
        // reader the first case. The wording staff cannot act on either way is
        // "issue it yourself": there is no quotation route under
        // routes/api/admin, /provider or /platform-admin and no screen for one.
        const systemWillReissue = await willSystemReissueOnNextVisit(applicationId);
        const nextStep = systemWillReissue
            ? 'ระบบจะออกใบให้อัตโนมัติเมื่อผู้ยื่นคำขอเปิดหน้ารายการชำระเงินครั้งต่อไป'
            : 'คำขออยู่นอกช่วงที่ระบบออกใบเสนอราคาให้อัตโนมัติได้ ผู้ยื่นคำขอจะชำระเงินไม่ได้จนกว่าจะมีใบเสนอราคาของคำขอนี้';
        await sendToPlatformStaff({
            admins,
            type: NotifyType.QUOTATION_ISSUE_FAILED,
            title: 'ออกใบเสนอราคาไม่สำเร็จ',
            message: `คำขอ ${applicationNumber || applicationId} ยังไม่มีใบเสนอราคา ผู้ยื่นคำขอจึงชำระเงินไม่ได้ `
                + `กรุณาตรวจสอบสถานะคำขอและตารางค่าธรรมเนียมที่ใช้กับคำขอนี้ ${nextStep}`,
            data: { applicationId, applicationNumber, reason, systemWillReissue },
        });
    } catch (error) {
        logger.error('[NotificationService] quotation issue-failed alert error:', error);
    }
}

/**
 * Is an URGENT price-drift alert for this (application, milestone) still sitting
 * unread in the admin queue? A lookup that throws answers `false`, because a
 * duplicate alert is a nuisance and silence on a money path is not.
 *
 * @param {{applicationId: string, milestone?: string}} args
 * @returns {Promise<boolean>}
 */
async function isCheckoutPriceDriftAlertPending({ applicationId, milestone }) {
    try {
        // Across tenants, because that is where the rows are. sendToPlatformStaff
        // writes inside withoutTenantScope, so createBulkNotifications takes its
        // per-recipient branch and every alert row carries the RECIPIENT's
        // organizationId (notification-service.js) — never the applicant's, on
        // either path. This helper runs inside the applicant's checkout request,
        // and Notification is tenant-scoped, so a plain read here would be
        // narrowed to the applicant's organization (applyReadScopes in
        // tenant-prisma-extension.js, org read scope default-ON) and could never
        // match the rows it is looking for: the alert would fan out again on
        // every press, which is exactly what this lookup exists to prevent.
        const open = await withoutTenantScope(() => prisma.notification.findFirst({
            where: {
                type: NotifyType.CHECKOUT_PRICE_DRIFT,
                isRead: false,
                // metadata is the `data` block createBulkNotifications stores
                // verbatim (notification-service.js), so the incident is
                // identified by the same two keys the alert carries.
                AND: [
                    { metadata: { path: ['applicationId'], equals: applicationId } },
                    { metadata: { path: ['milestone'], equals: milestone || null } },
                ],
            },
            select: { id: true },
        }));
        return Boolean(open);
    } catch (error) {
        logger.error('[NotificationService] price-drift dedup lookup failed; alerting anyway:', error);
        return false;
    }
}

/**
 * Tell the admin queue that a checkout was refused because the amount it would
 * charge disagrees with the figures the applicant accepted (F-G4-64 R2).
 *
 * Why a notification and not only an audit row: CHECKOUT_PRICE_DRIFT's
 * applicant-facing copy ends "เจ้าหน้าที่ได้รับแจ้งแล้ว" and offers no other
 * action, so the applicant waits. The audit row alone could not honour that
 * sentence, and an instruction the system cannot honour is worse than no
 * instruction (the same rule the coordinator applied to QUOTATION_NOT_ISSUED).
 * The applicant cannot pay until somebody re-issues or corrects the quotation.
 *
 * Best-effort, like every other helper in this file: a notification sink that
 * is down must never turn a fail-closed 409 into a 500.
 *
 * ONE alert per unread incident. A drifted order refuses on EVERY re-entry and
 * the applicant is given no other action, so they press again; each press used
 * to fan a fresh URGENT row out to every ADMIN, and twenty of them bury the one
 * row a staff member has to act on under nineteen copies of itself. While an
 * unread alert for the same (applicationId, milestone) is still in the queue the
 * message has already been delivered. Once a human reads it, a further refusal
 * is news again and does alert. A dedup lookup that fails alerts anyway: a
 * duplicate is a nuisance, silence on a money path is not.
 *
 * @param {{applicationId: string, applicationNumber: string|null,
 *          quotationNumber: string|null, acceptedPhaseTotal: string|number,
 *          livePhaseTotal: string|number, milestone?: string}} args
 * @returns {Promise<void>}
 */
async function notifyAdminCheckoutPriceDrift({
    applicationId, applicationNumber, quotationNumber, acceptedPhaseTotal, livePhaseTotal, milestone,
}) {
    try {
        if (await isCheckoutPriceDriftAlertPending({ applicationId, milestone })) {
            logger.info('[NotificationService] price-drift alert already unread for this application and milestone; not repeating');
            return;
        }
        // Lookup AND write cross tenants (whole-branch review C3/C10/S5/S9): the
        // recipients of THIS alert are platform ADMINs, not the applicant's
        // colleagues, and the row has to carry the RECIPIENT's organizationId or
        // their own org-scoped inbox never returns it.
        const admins = await findPlatformStaffAcrossTenants();
        if (admins.length === 0) {
            await reportAlertReachedNobody({
                alert: 'CHECKOUT_PRICE_DRIFT',
                applicationId,
                applicationNumber,
                details: { milestone: milestone || null },
            });
            return;
        }
        await sendToPlatformStaff({
            admins,
            type: NotifyType.CHECKOUT_PRICE_DRIFT,
            title: 'ยอดเรียกเก็บไม่ตรงกับใบเสนอราคาที่ยอมรับไว้',
            // No promise of an automatic re-issue on this one: the row exists and
            // is ACCEPTED, and the self-heal only issues where there is no usable
            // row, so "the system will issue a new one" would be false here. What
            // is true is the check, and that the charge is refused until the two
            // figures agree.
            message: `คำขอ ${applicationNumber || applicationId} ยอดที่ระบบจะเรียกเก็บ ${livePhaseTotal} บาท `
                + `ไม่ตรงกับใบเสนอราคา ${quotationNumber || 'ที่ยังไม่มีเลขที่'} ที่ผู้ยื่นคำขอยอมรับไว้ `
                + `${acceptedPhaseTotal} บาท ระบบจึงไม่สร้างรายการชำระเงิน `
                + 'กรุณาตรวจสอบว่าคำขอถูกแก้ไขหลังยอมรับใบเสนอราคาหรือไม่ และตรวจตารางค่าธรรมเนียมที่ใช้กับคำขอนี้ '
                + 'ผู้ยื่นคำขอชำระเงินไม่ได้จนกว่าตัวเลขทั้งสองจะตรงกัน',
            data: {
                applicationId,
                applicationNumber,
                quotationNumber,
                acceptedPhaseTotal: String(acceptedPhaseTotal),
                livePhaseTotal: String(livePhaseTotal),
                milestone: milestone || null,
            },
        });
    } catch (error) {
        logger.error('[NotificationService] checkout price-drift alert error:', error);
    }
}

module.exports = {
    notifyAdminCheckoutPriceDrift,
    notifyAdminQuotationIssueFailed,
    notifyPaymentSuccess,
    notifyPaymentFailed,
    notifySchedulerNewSubmission,
    notifySchedulerReadyForAudit,
    notifyReviewerAssigned,
    notifyAuditorAssigned,
    notifyRevisionRequired,
    notifyDocumentApproved,
    notifyAuditScheduled,
    notifyRevisionDeadlineApproaching,
    notifySlaBreach,
};
