const prisma = require('./prisma-database').prisma;
const prefsService = require('./notification-preferences-service');
const { createLogger } = require('../shared/logger');
const { getTenantContext } = require('./tenant-context');
const { NOTIFICATION_KIND } = require('../shared/notification-kind');
const { DEFAULT_TIME_ZONE } = require('../utils/working-days');
const logger = createLogger('notification-service');
const NotifyType = {
    // General
    INFO: 'info',
    SUCCESS: 'success',
    WARNING: 'warning',
    ERROR: 'error',
    // Quote/Invoice workflow
    QUOTE_RECEIVED: 'QUOTE_RECEIVED',
    INVOICE_RECEIVED: 'INVOICE_RECEIVED',
    PAYMENT_REMINDER: 'PAYMENT_REMINDER',
    PAYMENT_COMPLETED: 'PAYMENT_COMPLETED',
    // Application workflow
    APPLICATION_SUBMITTED: 'APPLICATION_SUBMITTED',
    APPLICATION_APPROVED: 'APPLICATION_APPROVED',
    APPLICATION_REJECTED: 'APPLICATION_REJECTED',
    /**
     * Canonical revision-needed notification key. Use this everywhere going
     * forward — it matches the canonical workflow status `REVISION_REQUESTED`
     * (see services/workflow-transition-service.js §1.1).
     */
    REVISION_REQUESTED: 'REVISION_REQUESTED',
    /**
     * @deprecated Use NotifyType.REVISION_REQUESTED. Kept as a backward-compat
     * alias so existing notifications already persisted with type
     * 'REVISION_REQUIRED' continue to resolve a template, and callers that
     * have not migrated yet do not break. New code MUST use REVISION_REQUESTED.
     * Targeted for removal once the 90-day deprecation window elapses
     * (planned: 2026-08-01) and no notifications with type 'REVISION_REQUIRED'
     * remain in the DB.
     */
    REVISION_REQUIRED: 'REVISION_REQUIRED',
    AUDIT_SCHEDULED: 'AUDIT_SCHEDULED',
    // Team workflow
    TEAM_REVIEW_COMPLETE: 'TEAM_REVIEW_COMPLETE',
    SLA_BREACH: 'SLA_BREACH',
    // Scheduler workflow
    NEW_APPLICATION_ASSIGNED: 'NEW_APPLICATION_ASSIGNED',
    PAYMENT_COMPLETED_SCHEDULER: 'PAYMENT_COMPLETED_SCHEDULER',
    RESUBMISSION_RECEIVED: 'RESUBMISSION_RECEIVED',
    WORK_ASSIGNED_TO_REVIEWER: 'WORK_ASSIGNED_TO_REVIEWER',
    // CAR and Re-assignment workflow
    CAR_SUBMITTED: 'CAR_SUBMITTED',
    AUDIT_ASSIGNED: 'AUDIT_ASSIGNED',
    AUDIT_REASSIGNED: 'AUDIT_REASSIGNED',
    AUDITOR_CHANGED: 'AUDITOR_CHANGED',
    // Payment workflow
    PAYMENT_PHASE1_SUCCESS: 'PAYMENT_PHASE1_SUCCESS',
    PAYMENT_PHASE2_SUCCESS: 'PAYMENT_PHASE2_SUCCESS',
    PAYMENT_FAILED: 'PAYMENT_FAILED',
    // F-G4-64 — an application reached SUBMITTED with no price of record.
    QUOTATION_ISSUE_FAILED: 'QUOTATION_ISSUE_FAILED',
    // F-G4-64 R2 — the amount a checkout would charge disagrees with the
    // figures the applicant accepted, so the payment was refused. The applicant
    // is told "เจ้าหน้าที่ได้รับแจ้งแล้ว" and can do nothing else; this type is
    // what makes that sentence true.
    CHECKOUT_PRICE_DRIFT: 'CHECKOUT_PRICE_DRIFT',
    // Document workflow
    DOCUMENT_APPROVED: 'DOCUMENT_APPROVED',
    ASSIGNED_REVIEWER: 'ASSIGNED_REVIEWER',
    ASSIGNED_AUDITOR: 'ASSIGNED_AUDITOR',
    NEW_SUBMISSION: 'NEW_SUBMISSION',
    READY_FOR_AUDIT: 'READY_FOR_AUDIT',
    REVISION_DEADLINE_APPROACHING: 'REVISION_DEADLINE_APPROACHING',
    // ADR-016 Phase 1B — work-activity SLA alerts (BPMN-aligned)
    WORK_ACTIVITY_ASSIGNED: 'WORK_ACTIVITY_ASSIGNED',
    WORK_ACTIVITY_WARNING: 'WORK_ACTIVITY_WARNING',
    WORK_ACTIVITY_BREACH: 'WORK_ACTIVITY_BREACH',
    // Blocker I (full-system audit 2026-07-07) — enum-miss class: these keys
    // were referenced by live callers but NEVER existed here, so sendNotification
    // received `undefined`, resolved no template, and the recipient got the
    // generic "การแจ้งเตือนใหม่" (or, for the farmer's auto-cancel notice, was
    // effectively never told WHY the application died and the fee is forfeit).
    // Callers: revision-deadline-checker.js (APPLICATION_EXPIRED applicant +
    // REVISION_DEADLINE_EXPIRED staff), routes/api/system/cron.js EXPIRED branch,
    // applications-car.js (CAR_REVIEWING sticky-return), jobs/scheduler.js
    // (CERTIFICATE_EXPIRING), notification/domain-helpers.js (DEADLINE_REMINDER),
    // application-review-revision-methods.js (NEW_APPLICATION resubmission).
    APPLICATION_EXPIRED: 'APPLICATION_EXPIRED',
    REVISION_DEADLINE_EXPIRED: 'REVISION_DEADLINE_EXPIRED',
    CAR_REVIEWING: 'CAR_REVIEWING',
    CERTIFICATE_EXPIRING: 'CERTIFICATE_EXPIRING',
    DEADLINE_REMINDER: 'DEADLINE_REMINDER',
    NEW_APPLICATION: 'NEW_APPLICATION',
    // Waiver-reopen flow (owner ruling 2026-07-08) — once-only DTAM-approved
    // reopen of EXPIRED applications reusing the settled payment.
    WAIVER_REOPEN_REQUESTED: 'WAIVER_REOPEN_REQUESTED',
    WAIVER_REOPEN_APPROVED: 'WAIVER_REOPEN_APPROVED',
    WAIVER_REOPEN_DENIED: 'WAIVER_REOPEN_DENIED',
    // Decision-SLA escalation (jobs/waiver-sla-escalation-job.js): a PENDING
    // waiver request sat undecided past 5 working days.
    WAIVER_REOPEN_SLA_OVERDUE: 'WAIVER_REOPEN_SLA_OVERDUE',
};
const NotifyTemplates = {
    [NotifyType.QUOTE_RECEIVED]: (data) => ({
        title: 'ได้รับใบเสนอราคา',
        message: `คุณได้รับใบเสนอราคาเลขที่ ${data.quoteNumber || '-'} จำนวน ${(data.amount || 0).toLocaleString()} บาท`,
    }),
    [NotifyType.INVOICE_RECEIVED]: (data) => ({
        title: 'ได้รับใบวางบิล',
        message: `ใบวางบิลเลขที่ ${data.invoiceNumber || '-'} พร้อมชำระเงินแล้ว`,
    }),
    [NotifyType.APPLICATION_SUBMITTED]: (data) => ({
        title: '✅ ส่งคำขอสำเร็จ',
        message: `คำขอเลขที่ ${data.applicationNumber || '-'} ถูกส่งเข้าระบบแล้ว`,
    }),
    [NotifyType.APPLICATION_APPROVED]: (data) => ({
        title: '✅ คำขอได้รับการอนุมัติ',
        message: `คำขอเลขที่ ${data.applicationNumber || '-'} ได้รับการอนุมัติเรียบร้อย`,
    }),
    [NotifyType.APPLICATION_REJECTED]: (data) => ({
        title: '❌ คำขอไม่ผ่านการพิจารณา',
        message: `คำขอเลขที่ ${data.applicationNumber || '-'} ไม่ผ่านการพิจารณา`,
    }),
    // provider-UAT-round2 2026-07-09 (LOW): AUDIT_REASSIGNED (old auditor) +
    // AUDITOR_CHANGED (applicant) were emitted with no template → recipients got
    // the generic "การแจ้งเตือนใหม่". Data: {applicationNumber, reason} /
    // {applicationNumber, newAuditorName}.
    [NotifyType.AUDIT_REASSIGNED]: (data) => ({
        title: '🔄 งานตรวจประเมินถูกมอบหมายใหม่',
        message: `งานตรวจประเมินคำขอเลขที่ ${data.applicationNumber || '-'} ถูกมอบหมายให้ผู้ตรวจประเมินท่านอื่น${data.reason ? ` (เหตุผล: ${data.reason})` : ''}`,
    }),
    [NotifyType.AUDITOR_CHANGED]: (data) => ({
        title: '🔄 เปลี่ยนผู้ตรวจประเมิน',
        message: `คำขอเลขที่ ${data.applicationNumber || '-'} เปลี่ยนผู้ตรวจประเมินเป็น ${data.newAuditorName || '-'}`,
    }),
    // Canonical REVISION_REQUESTED template. The legacy REVISION_REQUIRED
    // key is exposed as an alias below so callers using NotifyType.REVISION_REQUIRED
    // resolve the same Thai template and never silently fall through to a
    // generic title.
    [NotifyType.REVISION_REQUESTED]: (data) => ({
        title: '⚠️ ต้องแก้ไขเอกสาร',
        message: `คำขอเลขที่ ${data.applicationNumber || '-'} ต้องแก้ไข: ${data.reason || 'ดูรายละเอียดในระบบ'}`,
    }),
    [NotifyType.REVISION_REQUIRED]: (data) => ({
        title: '⚠️ ต้องแก้ไขเอกสาร',
        message: `คำขอเลขที่ ${data.applicationNumber || '-'} ต้องแก้ไข: ${data.reason || 'ดูรายละเอียดในระบบ'}`,
    }),
    [NotifyType.PAYMENT_REMINDER]: (data) => ({
        title: '💳 แจ้งเตือนการชำระเงิน',
        message: `กรุณาชำระเงินใบวางบิลเลขที่ ${data.invoiceNumber || '-'}`,
    }),
    [NotifyType.AUDIT_SCHEDULED]: (data) => ({
        title: '📅 นัดหมายการตรวจประเมิน',
        message: `นัดหมายวันที่ ${data.scheduledDate} เวลา ${data.scheduledTime} น.`,
    }),
    [NotifyType.NEW_APPLICATION_ASSIGNED]: (data) => ({
        title: '📋 คำขอใหม่รอจ่ายงาน',
        message: `คำขอใหม่เลขที่ ${data.applicationNumber || '-'} พร้อมให้จ่ายงาน`,
    }),
    [NotifyType.WORK_ASSIGNED_TO_REVIEWER]: (data) => ({
        title: '📝 ได้รับมอบหมายงานใหม่',
        message: `คุณได้รับมอบหมายตรวจสอบคำขอเลขที่ ${data.applicationNumber || '-'}`,
    }),
    [NotifyType.AUDIT_ASSIGNED]: (data) => ({
        title: '👤 ได้รับมอบหมายงานตรวจประเมิน',
        message: `คุณได้รับมอบหมายตรวจคำขอเลขที่ ${data.applicationNumber || '-'}`,
    }),
    // ADR-016 Phase 1B — work activity SLA alerts
    [NotifyType.WORK_ACTIVITY_ASSIGNED]: (data) => ({
        title: '📋 ได้รับมอบหมายงานใหม่',
        message: `${data.workTypeLabel || data.workType || 'งาน'} ของคำขอ ${data.applicationNumber || '-'}${
            data.dueInHours ? ` (กำหนดส่งใน ${data.dueInHours} ชม.)` : ''
        }`,
    }),
    [NotifyType.WORK_ACTIVITY_WARNING]: (data) => ({
        title: '⏰ งานใกล้ครบกำหนด SLA',
        message: `${data.workTypeLabel || data.workType || 'งาน'} ของคำขอ ${data.applicationNumber || '-'} เหลือเวลา ${data.hoursUntilDue || 0} ชม. ก่อนเลยกำหนด`,
    }),
    [NotifyType.WORK_ACTIVITY_BREACH]: (data) => ({
        title: '🚨 งานเลย SLA แล้ว',
        message: `${data.workTypeLabel || data.workType || 'งาน'} ของคำขอ ${data.applicationNumber || '-'} เลยกำหนดมา ${data.hoursOverdue || 0} ชม. กรุณาดำเนินการด่วน`,
    }),
    // Blocker I — templates for the previously-undefined keys (Thai, ม.ปลาย).
    // APPLICATION_EXPIRED is the farmer-facing auto-cancel notice: it MUST state
    // the reason AND the consequence (must re-apply + pay the document-review
    // fee งวดที่ 1 again) — the harshest outcome in the whole workflow.
    [NotifyType.APPLICATION_EXPIRED]: (data) => ({
        title: '⛔ คำขอถูกยกเลิกอัตโนมัติ',
        message: `คำขอเลขที่ ${data.applicationNumber || '-'} ถูกยกเลิกอัตโนมัติ เนื่องจาก${data.reason || 'ไม่ดำเนินการแก้ไขภายในกำหนด'} ` +
            'หากต้องการขอการรับรองต่อ ต้องยื่นคำขอใหม่และชำระค่าธรรมเนียมตรวจเอกสาร (งวดที่ 1) อีกครั้ง ' +
            // Waiver-reopen leniency channel — advertising copy only (R2 D-7):
            // neutral pointer to the case-by-case exception path, no waiver
            // logic and no fee terms stated here.
            'หากมีเหตุจำเป็น สามารถติดต่อเจ้าหน้าที่ผู้ตรวจของคุณเพื่อสอบถามแนวทางขอเปิดเคสอนุโลมได้ (พิจารณาเป็นรายกรณี อนุมัติโดยฝ่ายบัญชี)',
    }),
    [NotifyType.REVISION_DEADLINE_EXPIRED]: (data) => ({
        title: '⛔ คำขอเกินกำหนดแก้ไข ถูกยกเลิกแล้ว',
        message: `คำขอเลขที่ ${data.applicationNumber || data.applicationId || '-'} เกินกำหนดแก้ไข 5 วันทำการ และถูกยกเลิกอัตโนมัติแล้ว`,
    }),
    [NotifyType.CAR_REVIEWING]: (data) => ({
        title: '📄 มีงานแก้ไข (CAR) ส่งกลับมา',
        message: `คำขอเลขที่ ${data.applicationNumber || '-'} ส่งเอกสารแก้ไข CAR กลับเข้าระบบแล้ว กรุณาตรวจสอบ`,
    }),
    [NotifyType.CERTIFICATE_EXPIRING]: (data) => ({
        title: '⏳ ใบรับรองใกล้หมดอายุ',
        message: `ใบรับรองเลขที่ ${data.certificateNumber || '-'} จะหมดอายุ${data.expiryDate ? `วันที่ ${data.expiryDate}` : 'เร็ว ๆ นี้'}` +
            `${Number.isFinite(data.daysUntilExpiry) ? ` (อีก ${data.daysUntilExpiry} วัน)` : ''} กรุณาเตรียมยื่นต่ออายุ`,
    }),
    [NotifyType.DEADLINE_REMINDER]: (data) => ({
        title: '⏰ แจ้งเตือนใกล้ครบกำหนด',
        message: `คำขอเลขที่ ${data.applicationNumber || '-'} ใกล้ครบกำหนดแก้ไข กรุณาดำเนินการให้เสร็จสิ้นก่อนถูกยกเลิกอัตโนมัติ`,
    }),
    [NotifyType.NEW_APPLICATION]: (data) => ({
        title: '📥 มีเอกสารส่งกลับเข้าระบบ',
        message: data.message || `มีเอกสารแก้ไขใหม่จากคำขอเลขที่ ${data.applicationNumber || '-'} กรุณาตรวจสอบ`,
    }),
    [NotifyType.WAIVER_REOPEN_REQUESTED]: (data) => ({
        title: '📨 คำขอเปิดเคสอนุโลมรออนุมัติ',
        message: `คำขอเลขที่ ${data.applicationNumber || '-'} มีคำขอเปิดเคสอนุโลม (ใช้ค่าธรรมเนียมเดิม) รอการอนุมัติจากฝ่ายบัญชี`,
    }),
    [NotifyType.WAIVER_REOPEN_APPROVED]: (data) => ({
        title: '✅ เคสอนุโลมได้รับการอนุมัติ',
        message: `คำขอเลขที่ ${data.applicationNumber || '-'} ถูกเปิดใหม่โดยใช้ค่าธรรมเนียมเดิม ` +
            `กรุณาส่งงานแก้ไขภายในกำหนดใหม่${data.dueAt ? ` (${new Date(data.dueAt).toLocaleDateString('th-TH', { timeZone: DEFAULT_TIME_ZONE })})` : ''} หากพ้นกำหนดอีกครั้งจะไม่สามารถขออนุโลมซ้ำได้`,
    }),
    [NotifyType.WAIVER_REOPEN_DENIED]: (data) => ({
        title: '❌ คำขอเปิดเคสอนุโลมไม่ได้รับการอนุมัติ',
        message: `คำขอเปิดเคสอนุโลมไม่ผ่านการพิจารณาจากฝ่ายบัญชี${data.note ? ` เหตุผล: ${data.note}` : ''}`,
    }),
    [NotifyType.WAIVER_REOPEN_SLA_OVERDUE]: (data) => ({
        title: '⏰ คำขอเคสอนุโลมค้างพิจารณาเกินกำหนด',
        message: `คำขอเปิดเคสอนุโลมของใบสมัคร ${data.applicationNumber || '-'} ` +
            `รอการพิจารณาเกิน 5 วันทำการแล้ว กรุณาอนุมัติหรือปฏิเสธโดยเร็ว`,
    }),
};

/**
 * Legacy → canonical NotifyType aliases. Resolved at template lookup time so
 * persisted DB rows / SMS templates keyed by the legacy string continue to
 * render the canonical Thai farmer-facing copy.
 *
 * Removal target: 2026-08-01 (same window as the deprecated enum keys).
 */
const NOTIFY_TYPE_ALIASES = Object.freeze({
    REVISION_REQUIRED: 'REVISION_REQUESTED',
});

/**
 * Resolve a possibly-legacy notification type string to its canonical form.
 * Returns the input unchanged if no alias is registered.
 *
 * @param {string} type Raw notification type (legacy or canonical).
 * @returns {string} Canonical type.
 */
function resolveNotifyType(type) {
    if (type == null) {return type;}
    return NOTIFY_TYPE_ALIASES[type] || type;
}
// Core Functions
function toNotificationPriority(priority) {
    if (typeof priority === 'number' && Number.isFinite(priority)) {
        return Math.max(0, Math.min(3, Math.round(priority)));
    }
    const normalized = String(priority || '').trim().toUpperCase();
    switch (normalized) {
    case 'URGENT':
        return 3;
    case 'HIGH':
        return 2;
    case 'MEDIUM':
        return 1;
    case 'LOW':
    case 'NORMAL':
    default:
        return 0;
    }
}
/**
 * Create a notification in the database.
 *
 * Notification.organizationId is NOT NULL in schema. Two ways the value
 * gets set:
 *
 *   1. The tenant-prisma-extension auto-injects from `getTenantContext()`
 *      when called inside an authenticated request scope (most paths).
 *   2. When called from a cron / system path with no tenant context bound
 *      (e.g., `/api/cron/auto-cancel` calling `notifyRevisionDeadlineApproaching`),
 *      the extension is a no-op and the create() previously failed silently
 *      with "Argument `organization` is missing" — the .catch returned
 *      null, so revision-deadline reminders disappeared. Same root cause
 *      as PRs #199, #200, and #201.
 *
 * The fix: when no tenant context is bound, look up the recipient User's
 * organizationId once and pass it explicitly to the create. This belongs
 * to the user's tenant by definition (a notification IS the user's
 * mailbox), so the User row is the authoritative source.
 */
async function createNotification({
    userId,
    type,
    title,
    message,
    data = {},
    priority = 'NORMAL',
    actionUrl = null,
}) {
    try {
        if (!userId) {
            return null;
        }
        const metadata = {
            ...(data || {}),
            ...(actionUrl ? { actionUrl } : {}),
        };

        let explicitOrgId = null;
        if (!getTenantContext()) {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { organizationId: true },
            });
            if (!user) {
                logger.warn(`[NotificationService] user ${userId} not found; skipping notification`);
                return null;
            }
            explicitOrgId = user.organizationId;
        }

        const createData = {
            userId,
            type,
            title,
            message,
            metadata,
            priority: toNotificationPriority(priority),
            isRead: false,
        };
        if (explicitOrgId) {
            createData.organizationId = explicitOrgId;
        }

        const notification = await prisma.notification.create({ data: createData });
        return notification;
    } catch (error) {
        logger.error('[NotificationService] Create notification error:', error);
        return null;
    }
}
/**
 * Send notification using template (legacy API)
 */
async function sendNotification(recipientId, type, data = {}, overrides = {}) {
    try {
        if (!recipientId) {
            logger.warn('[NotificationService] No recipient ID provided');
            return null;
        }

        // Phase 7: per-user channel preferences. Single DB read up front
        // so each channel check uses the same snapshot.
        let userPrefs = null;
        try {
            const userRow = await prisma.user.findUnique({
                where: { id: recipientId },
                select: { notificationSettings: true },
            });
            userPrefs = userRow?.notificationSettings || null;
        } catch (e) {
            // Default-allow on read failure — never lose a notification
            // because of a transient DB hiccup.
            logger.warn(`[NotificationService] prefs read failed for ${recipientId}: ${e?.message}`);
        }
        const inAppAllowed = await prefsService.isAllowed({
            settings: userPrefs, type, channel: 'inApp',
        });

        // Resolve legacy → canonical type so deprecated keys (e.g. REVISION_REQUIRED)
        // still hit the Thai template instead of falling through to the generic
        // 'การแจ้งเตือนใหม่' fallback.
        const canonicalType = resolveNotifyType(type);
        const template = NotifyTemplates[canonicalType] || NotifyTemplates[type];
        const templateResult = template ? template(data) : {};

        // In-app channel: skip the row write entirely if opted out.
        // (No row = no bell-icon noise; the audit trail of intent is
        // captured by audit-log entries on the source action, not here.)
        //
        // R2 M1 (operator decision D-9 2026-08-03): official letters NEVER
        // pass through this gate. They are written via createOfficialLetter
        // below, which does not consult preferences — so opting out cannot
        // silence a mandatory letter. This path only ever writes rows of the
        // default kind (shared/notification-kind.js).
        let notification = null;
        if (inAppAllowed) {
            notification = await createNotification({
                userId: recipientId,
                type: type || 'INFO',
                title: overrides.title || templateResult.title || 'การแจ้งเตือนใหม่',
                message: overrides.message || templateResult.message || 'คุณมีการแจ้งเตือนใหม่',
                data: { ...data, timestamp: new Date().toISOString() },
                priority: overrides.priority || 'NORMAL',
                actionUrl: overrides.actionUrl,
            });
        }

        return notification;
    } catch (error) {
        logger.error('[NotificationService] Send notification error:', error);
        return null;
    }
}
/**
 * Create multiple notifications (batch).
 *
 * Same untenanted-create concern as `createNotification` above. When
 * called outside a tenant context (cron paths, e.g. `notifySlaBreach`
 * fanning out to admins), the per-row data block needs an explicit
 * organizationId. Each recipient may belong to a different tenant
 * (cross-tenant admin fanout), so resolve per-userId rather than once.
 */
async function createBulkNotifications({ userIds, type, title, message, data = {}, priority = 'NORMAL' }) {
    try {
        if (!Array.isArray(userIds) || userIds.length === 0) {
            return null;
        }

        let userOrgMap = null;
        if (!getTenantContext()) {
            const users = await prisma.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, organizationId: true },
            });
            userOrgMap = new Map(users.map((u) => [u.id, u.organizationId]));
        }

        const rows = userIds
            .map((userId) => {
                const row = {
                    userId,
                    type,
                    title,
                    message,
                    metadata: data,
                    priority: toNotificationPriority(priority),
                    isRead: false,
                };
                if (userOrgMap) {
                    const orgId = userOrgMap.get(userId);
                    if (!orgId) {
                        logger.warn(`[NotificationService] user ${userId} not found; skipping bulk notification row`);
                        return null;
                    }
                    row.organizationId = orgId;
                }
                return row;
            })
            .filter(Boolean);

        if (rows.length === 0) {
            return null;
        }

        const notifications = await prisma.notification.createMany({ data: rows });
        return notifications;
    } catch (error) {
        logger.error('[NotificationService] Bulk notification error:', error);
        return null;
    }
}
/**
 * R2 M1 (operator decision D-9, 2026-08-03 — evidence/R2-special-reopen/
 * decisions-final.md): write an official letter (จดหมายราชการในระบบ) as a
 * permanent Notification row.
 *
 * Contract (M2 "atomic decision+letter", D-8, depends on every clause):
 *
 *   - Writes THROUGH the caller's transaction client `tx` — the letter
 *     commits or rolls back atomically with the caller's decision write.
 *   - Structurally bypasses per-user notification preferences: this path
 *     never consults notification-preferences-service, so an opted-out
 *     recipient still gets the mandatory in-app letter row. Email/SMS stay
 *     with the existing best-effort channels — deliberately NOT triggered
 *     here, because side channels must not fire inside an uncommitted tx.
 *   - NEVER swallows errors: if the row cannot be written, the error
 *     propagates so the caller's transaction fails (D-8: no decision
 *     without its letter). Do not wrap calls in a catch-and-null like the
 *     legacy helpers above.
 *   - `organizationId` is required from the caller: Notification requires a
 *     tenant and Prisma transaction clients bypass the tenant extension, so
 *     nothing can inject it here.
 *
 * @param {object} args
 * @param {object} args.tx Prisma transaction client (required).
 * @param {string} args.userId Recipient user id (required).
 * @param {string} args.title Letter title (required).
 * @param {string} args.message Letter body (required).
 * @param {object} [args.metadata] Structured letter payload (items, due date, ...).
 * @param {string} args.organizationId Recipient's tenant (required).
 * @param {string} [args.type] Notification type key — Notification.type is
 *   NOT NULL with no default; defaults to NotifyType.INFO when the caller
 *   has no more specific key.
 * @param {string|number} [args.priority] Same scale as createNotification.
 * @returns {Promise<object>} The created Notification row.
 */
async function createOfficialLetter({
    tx,
    userId,
    title,
    message,
    metadata = {},
    organizationId,
    type = NotifyType.INFO,
    priority = 'NORMAL',
}) {
    if (!tx || typeof tx.notification?.create !== 'function') {
        throw new Error('[NotificationService] createOfficialLetter requires a transaction client (tx) — the letter must be atomic with the caller\'s write');
    }
    if (!userId || !title || !message || !organizationId) {
        throw new Error('[NotificationService] createOfficialLetter requires userId, title, message and organizationId');
    }
    return tx.notification.create({
        data: {
            userId,
            organizationId,
            type,
            title,
            message,
            metadata,
            priority: toNotificationPriority(priority),
            isRead: false,
            kind: NOTIFICATION_KIND.OFFICIAL_LETTER,
        },
    });
}
/**
 * Send batch notifications (legacy API)
 */
async function sendBatchNotifications(notifications) {
    const results = [];
    for (const n of notifications) {
        const result = await sendNotification(n.recipientId, n.type, n.data, n.overrides);
        results.push(result);
    }
    return results;
}
/**
 * Replaces routes/api/provider/handlers/communication.js:105
 * prisma.notification.findMany — read-side admin-broadcast log.
 * Returns the 20 most recent ADMIN_BROADCAST notifications keyed by
 * distinct title so the dashboard doesn't show one row per recipient.
 */
async function listRecentAdminBroadcasts({ take = 20 } = {}) {
    const { prisma } = require('./prisma-database');
    return prisma.notification.findMany({
        where: { type: 'ADMIN_BROADCAST' },
        orderBy: { createdAt: 'desc' },
        take,
        select: {
            id: true,
            title: true,
            message: true,
            isRead: true,
            createdAt: true,
            metadata: true,
        },
        distinct: ['title'],
    });
}

// Populate exports BEFORE requiring domain-helpers — domain-helpers
// destructures `createNotification` etc back out of this module, so if we
// require it before module.exports is set, it gets a stale empty object
// and silently binds those names to undefined. Object.assign after the
// require closes the cycle cleanly.
module.exports = {
    createNotification,
    createBulkNotifications,
    sendNotification,
    sendBatchNotifications,
    createOfficialLetter,
    listRecentAdminBroadcasts,
    NotifyType,
    NotifyTemplates,
    NOTIFY_TYPE_ALIASES,
    resolveNotifyType,
};

const domainHelpers = require('./notification/domain-helpers');
Object.assign(module.exports, domainHelpers);

