/**
 * Audit Routes for Scheduling and Management
 *
 * Batch 11 (audit cluster) — all direct prisma.X.find/update/create calls
 * have been replaced with service-layer methods. The `prisma` import is
 * retained ONLY as a transaction handle for the canonical
 * writeApplicationStatus writer (the same exception called out in
 * applications/applications-car.js).
 *
 * Regulatory framing: audit-result writes feed certificate generation,
 * farm activation, and the immutable audit-log chain (ISO 27799:2016
 * § 7.10). Service-layer indirection keeps the row-level filters
 * (isDeleted: false, withVisibility, tenant scope) at one boundary.
 */
const express = require('express');
const { respondError } = require('../../../shared/api-response');
const router = express.Router();
const { prisma } = require('../../../services/prisma-database');
const authModule = require('../../../middleware/auth-middleware');
const { sendNotification, NotifyType } = require('../../../services/notification-service');
const { buildTransitionUpdate } = require('../../../services/workflow-transition-service');
const farmService = require('../../../services/farm-service');
const applicationService = require('../../../services/application-service');
const logger = require('../../../shared/logger');
const { writeApplicationStatus } = require('../../../services/application-status-writer');
// Blocker H (full-system audit 2026-07-07): the S6 audit-result transition —
// the one write that mints a government certificate — must land in the
// immutable AuditLog hash chain, atomically with the status flip (WF-F8).
const { statusTransitionAuditHook } = require('../../../middleware/audit-logger');
const { withVisibility } = require('../../../shared/application-visibility');
const { ROLE_GROUPS } = require('../../../shared/canonical-rbac');
// Round-2 payment gate, shared with the canonical scheduler handler so the
// two writers of `scheduledDate`/`auditorId` cannot drift apart again.
const {
    SCHEDULE_GATE_SELECT,
    checkSchedulingAllowed,
} = require('../../../shared/phase2-schedule-gate');
// CAR 5-working-day SLA clock — this route previously transitioned to CAR_PENDING
// without seeding the deadline (the 2026-06-11 HIGH, fixed only on the Job Sheet
// handler). Mirror auditor-audit-decision-handler.js so the revision-deadline-checker
// cron can auto-expire CARs raised here too.
const { computeCarDueDate, seedCarRevisionDeadline } = require('../../../services/car-deadline-service');
// Ruling 2: the catalog is the single source for a code's HTTP status and its
// Thai/English wording, so a route that knows the code should not retype them.
const { lookup: lookupErrorCode } = require('../../../shared/error-codes');
const { assertOnsiteEvidenceForPass } = require('../../../services/onsite-evidence-gate');
const { onsiteEvidenceRefusal } = require('../../../services/audit-decision-error-response');
const { findUserByHealthIdSecurely } = require('../../../services/user-lookup-service');
const { DEFAULT_TIME_ZONE, formatLocalTime, localWallClock } = require('../../../utils/working-days');

const authenticateProvider = authModule.authenticateProvider;
const { requireRole } = authModule;

// T-002: per canonical contract §5.2, every /api/audits/* handler must
// be limited to AUDIT_STAFF (admin, document_reviewer, auditor, scheduler).
// `account` users hold a `provider_token` for finance flows but must not
// reach audit reads/writes. Apply at the file level for defense in depth;
// per-route tighter guards (scheduler-only, auditor-only) are added on
// the mutation endpoints below.
router.use(authenticateProvider, requireRole(ROLE_GROUPS.AUDIT_STAFF));

/**
 * @swagger
 * /api/audits:
 *   get:
 *     summary: Get all audits (Unified list) (Provider only)
 *     tags: [Audits]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of audits
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     audits:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                           auditNumber:
 *                             type: string
 *                           status:
 *                             type: string
 *                           plantType:
 *                             type: string
 *                           scheduledDate:
 *                             type: string
 *                             format: date-time
 */
/**
 * ชื่อที่ต้องขึ้นบนคิวของคนจัดคิว
 *
 * นิติบุคคลถือใบรับรองในชื่อของตัวเอง (คำสั่ง operator 2026-09-07) ชื่อองค์กรจึงมาก่อน
 * ชื่อบุคคล · ถ้าไม่รู้จริง ๆ ให้เป็น null ไม่ใช่สตริง 'N/A' — หน้าจอเขียน `|| '-'` ไว้แล้ว
 * และ null บอกความจริงว่า "ไม่มีข้อมูล" ส่วน 'N/A' อ่านเหมือนเป็นชื่อ
 */
function applicantNameOf(app) {
    const entityName = app?.entity?.displayName;
    if (entityName) { return String(entityName).trim() || null; }
    const person = [app?.applicant?.firstName, app?.applicant?.lastName]
        .filter((part) => typeof part === 'string' && part.trim())
        .join(' ')
        .trim();
    return person || null;
}

/** ชื่อผู้ตรวจที่รับมอบหมาย — null เมื่อยังไม่มอบหมาย */
function auditorNameOf(app) {
    const who = app?.auditor || app?.headAuditor || null;
    const name = [who?.firstName, who?.lastName]
        .filter((part) => typeof part === 'string' && part.trim())
        .join(' ')
        .trim();
    return name || null;
}

/**
 * แถวหนึ่งของคิวตรวจ
 *
 * ชื่อฟิลด์ตรงกับสิ่งที่มันเป็น: `plantId` คือพืช `areaType` คือลักษณะพื้นที่ · เดิม
 * `plantType` ถูกป้อนด้วย `app.areaType` หน้าจอที่พาดหัวคอลัมน์ว่า "พืช" จึงแสดงคำว่า
 * OUTDOOR ให้คนจัดคิวอ่าน · ไม่มีหน้าจอไหนกิน /api/audits อยู่ตอนนี้ การตั้งชื่อให้ถูก
 * จึงไม่ทำให้ใครพัง และเป็นเวลาที่ถูกที่สุดที่จะทำ
 */
function auditQueueRow(app) {
    return {
        id: app.id,
        auditNumber: app.applicationNumber,
        applicationNumber: app.applicationNumber,
        applicantName: applicantNameOf(app),
        plantId: app.plantId || app.formData?.plantId || null,
        areaType: app.areaType || null,
        status: app.status === 'AUDIT_FEE_PAID' ? 'WAITING_SCHEDULE' : app.status,
        scheduledDate: app.scheduledDate || null,
        auditorId: app.auditorId || app.headAuditorId || null,
        auditorName: auditorNameOf(app),
        auditMode: app.formData?.auditMode || 'ONSITE',
    };
}

router.get('/', authenticateProvider, async (req, res) => {
    try {
        const applications = await applicationService.listAuditQueue({
            statusIn: [
                'AUDIT_FEE_PAID', // Waiting schedule
                'AUDIT_CONFIRMED', 'CAR_REVIEWING', // Scheduled / in progress
                'CAR_PENDING', 'AUDIT_PASSED', 'APPROVED', 'CERTIFIED', 'CANCEL_EXPIRED', // History
            ],
            take: 100,
        });

        const data = applications.map(auditQueueRow);

        // ซองเดียวกับรายการอื่นทั้งระบบ: data เป็น array ตรง ๆ พร้อม count
        // เดิมห่อไว้เป็น { audits: [...] } อยู่ประตูเดียว และตอน error ก็ยังส่ง
        // data.audits = [] มาด้วย ทำให้ client ที่อ่านคีย์นั้นเห็นคิวว่างทั้งที่ระบบพัง
        res.json({ success: true, count: data.length, data });
    } catch (error) {
        logger.error('[Audit] list error:', error);
        return respondError(res, req, error);
    }
});

/**
 * @swagger
 * /api/audits/pending-schedule:
 *   get:
 *     summary: Get pending applications for scheduling (Provider only)
 *     tags: [Audits]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of pending applications
 */
router.get('/pending-schedule', authenticateProvider, async (req, res) => {
    try {
        const applications = await applicationService.listPendingScheduleAudits({ take: 50 });
        const data = applications.map(auditQueueRow);
        res.json({ success: true, count: data.length, data });
    } catch (error) {
        // เดิมตอบ { success: true, data: [] } — ฐานข้อมูลล่มแล้วคนจัดคิวอ่านหน้าจอได้ว่า
        // "ไม่มีคิวรอ" แล้วก็ไม่ทำอะไร · ไม่มีอะไรบนหน้าจอบอกว่าคำตอบนั้นไม่ใช่ความจริง
        // และ success:true ทำให้ทั้ง retry ทั้ง alert ไม่ทำงาน
        // คิวที่ว่างเพราะระบบพัง กับคิวที่ว่างจริง ต้องแยกจากกันได้
        logger.error('[Audit] getPendingSchedule error:', error);
        return respondError(res, req, error);
    }
});

// Get scheduled audits
router.get('/scheduled', authenticateProvider, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const audits = await applicationService.listScheduledAudits({ startDate, endDate, take: 100 });
        const data = audits.map(auditQueueRow);
        res.json({ success: true, count: data.length, data });
    } catch (error) {
        // เหตุผลเดียวกับ /pending-schedule: ปฏิทินที่ว่างเพราะ query พัง ไม่ใช่ปฏิทินว่าง
        logger.error('[Audit] getScheduled error:', error);
        return respondError(res, req, error);
    }
});

/**
 * @swagger
 * /api/audits/{id}:
 *   get:
 *     summary: Get Audit Detail (Provider only)
 *     tags: [Audits]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Audit ID or Application ID
 *     responses:
 *       200:
 *         description: Audit details
 *       404:
 *         description: Audit not found
 */
router.get('/:id', authenticateProvider, async (req, res) => {
    try {
        const { id } = req.params;
        // PR-1.6: tenant-scope this lookup. Before this commit, any
        // authenticated provider could fetch any audit by guessing the
        // application id (IDOR). Filtering by req.user.organizationId
        // narrows the visible set to the caller's tenant.
        //
        // Wave A Phase 24 (G4 cont): inside the tenant, also gate by
        // the application visibility filter. An auditor in tenant X
        // hitting /audits/:id for an application not assigned to them
        // now gets 404, matching the same-tenant behaviour of
        // /api/provider/applications/:id from Phase 19.
        const orgId = req.user?.organizationId || req.tenantContext?.organizationId || null;
        const tenantWhere = orgId ? { id, organizationId: orgId } : { id };
        const application = await applicationService.findAuditDetail({
            where: withVisibility(tenantWhere, req.user),
        });

        if (!application) {
            return res.status(404).json({ success: false, error: 'Audit not found' });
        }

        // Map to AuditDetail interface
        const auditDetail = {
            id: application.id,
            auditNumber: application.applicationNumber,
            applicationNumber: application.applicationNumber,
            applicantName: applicantNameOf(application),
            plantType: application.formData?.plantId || application.areaType || '-',
            auditMode: application.formData?.auditMode || 'ONSITE',
            status: application.status,
            scheduledDate: application.scheduledDate,
            scheduledTime: application.scheduledDate ? formatLocalTime(new Date(application.scheduledDate)) : '', // Bangkok HH:mm
            responses: application.formData?.auditChecklist || [], // Use existing checklist if any
            // Mock Template Code if not present
            templateCode: 'GAP-001',
        };

        res.json({ success: true, data: auditDetail });
    } catch (error) {
        logger.error('[Audit] getDetail error:', error);
        return respondError(res, req, error);
    }
});

/**
 * @swagger
 * /api/audits/schedule:
 *   post:
 *     summary: Schedule an audit (Provider only)
 *     tags: [Audits]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [applicationId, scheduledDate]
 *             properties:
 *               applicationId:
 *                 type: string
 *               scheduledDate:
 *                 type: string
 *                 format: date
 *               scheduledTime:
 *                 type: string
 *                 example: "09:00"
 *               auditMode:
 *                 type: string
 *                 enum: ['ONSITE', 'ONLINE']
 *               auditorId:
 *                 type: string
 *               meetingUrl:
 *                 type: string
 *     responses:
 *       200:
 *         description: Scheduled successfully
 */
router.post('/schedule', requireRole(ROLE_GROUPS.SCHEDULERS), async (req, res) => {
    try {
        const { applicationId, scheduledDate, scheduledTime, auditorId, auditMode, meetingUrl } = req.body;

        if (!applicationId || !scheduledDate) {
            return res.status(400).json({
                success: false,
                error: 'applicationId and scheduledDate are required',
            });
        }

        // Combine date and time — a Bangkok wall-clock time on a Bangkok day
        // (on a UTC process `new Date("…T09:00:00")` was 16:00 in Bangkok).
        const scheduledDateTime = localWallClock(scheduledDate, scheduledTime || '09:00');

        // Find application by UUID or applicationNumber (handle both formats)
        const application = await applicationService.findByIdOrApplicationNumber(applicationId);

        if (!application) {
            return res.status(404).json({
                success: false,
                error: 'Application not found',
            });
        }

        // [SECURITY] Conflict of Interest (COI) Check
        // Ensure the assigned auditor is NOT the same person as the applicant/Applicant
        if (auditorId && application.healthId && auditorId === application.healthId) {
            return res.status(400).json({
                success: false,
                error: 'Conflict of Interest: Auditor cannot be the same person as the applicant',
            });
        }

        const ApplicantUser = application.healthId
            ? await findUserByHealthIdSecurely(application.healthId, {
                select: { id: true },
                client: prisma,
            })
            : null;

        // Use workflow transition service for canonical state change
        const transition = buildTransitionUpdate({
            application,
            toState: 'AUDIT_CONFIRMED',
            actorId: req.user?.id || 'system',
            actorRole: req.user?.role || 'scheduler',
        });

        const updated = await applicationService.updateApplicationColumns(application.id, {
            ...transition.updateData,
            scheduledDate: scheduledDateTime,
            auditorId: auditorId || null,
            formData: {
                // transition.updateData.formData is already
                // {...application.formData, workflowState, workflowStateUpdatedAt},
                // so it is a SUPERSET of the row's existing formData. Re-spreading
                // the original on top of it (as this did) contributed nothing
                // except reverting the two fields the transition exists to set —
                // leaving the `status` column on AUDIT_CONFIRMED while
                // formData.workflowState stayed on the previous state.
                // resolveStateFromApplication reads formData.workflowState first,
                // so the stale half was the one the state machine believed, and
                // POST /schedule could be replayed forever because the
                // "already in this state" guard never saw the new state.
                ...transition.updateData.formData,
                auditMode: auditMode || 'ONSITE',
                meetingUrl: meetingUrl || undefined,
                auditLocation: req.body.location || undefined,
            },
        });



        // [NEW] Send Notification to Applicant
        if (ApplicantUser?.id) {
            const dateStr = scheduledDateTime.toLocaleDateString('th-TH', { dateStyle: 'medium', timeZone: DEFAULT_TIME_ZONE });
            await sendNotification(ApplicantUser.id, NotifyType.AUDIT_SCHEDULED, {
                applicationNumber: application.applicationNumber,
                auditMode: auditMode || 'ONSITE',
                scheduledDate: dateStr,
                scheduledTime: scheduledTime || '09:00',
            });
        }

        res.json({
            success: true,
            message: 'Audit scheduled successfully',
            data: updated,
        });
    } catch (error) {
        logger.error('[Audit] schedule error:', error);
        return respondError(res, req, error);
    }
});

// Update audit schedule
router.patch('/:id/schedule', requireRole(ROLE_GROUPS.SCHEDULERS), async (req, res) => {
    try {
        const { id } = req.params;
        const { scheduledDate, scheduledTime, auditorId } = req.body;

        // PR-1.6: confirm the application is in the caller's tenant before
        // mutating it. A blind prisma.application.update({ where: { id } })
        // would let any provider rewrite any tenant's audit schedule.
        //
        // The projection is SCHEDULE_GATE_SELECT, not `{ id: true }`: this
        // handler writes the same two columns as the canonical scheduler
        // handler (`scheduledDate`, `auditorId`) and so owes the same round-2
        // payment gate, which needs status/phase2Status/formData to decide.
        const orgId = req.user?.organizationId || req.tenantContext?.organizationId || null;
        const target = await applicationService.findFirstWithWhere({
            where: orgId ? { id, organizationId: orgId } : { id },
            select: SCHEDULE_GATE_SELECT,
        });
        if (!target) {
            return res.status(404).json({ success: false, error: 'Audit not found' });
        }

        // Queueing a field visit before accounting has approved the round-2
        // slip is the one thing this endpoint must never do. Setting
        // `auditorId` alone is enough to matter: it makes that auditor satisfy
        // requireApplicationOwner (shared/application-owner-gate.js:73-76),
        // which opens checklist creation and the on-site GPS check-in for an
        // application whose field-inspection fee was never settled.
        const gate = await checkSchedulingAllowed(target);
        if (!gate.allowed) {
            return res.status(400).json({ success: false, error: gate.error });
        }

        const updateData = { updatedBy: req.user?.id };

        if (scheduledDate) {
            const scheduledDateTime = localWallClock(scheduledDate, scheduledTime || '09:00'); // Bangkok
            updateData.scheduledDate = scheduledDateTime;
        }
        if (auditorId) { updateData.auditorId = auditorId; }

        const updated = await applicationService.updateApplicationColumns(id, updateData);

        res.json({ success: true, data: updated });
    } catch (error) {
        logger.error('[Audit] updateSchedule error:', error);
        return respondError(res, req, error);
    }
});

/**
 * @swagger
 * /api/audits/{id}/result:
 *   post:
 *     summary: Submit audit result (Pass/Fail) (Provider only)
 *     tags: [Audits]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [result]
 *             properties:
 *               result:
 *                 type: string
 *                 enum: ['PASS', 'FAIL']
 *               notes:
 *                 type: string
 *               checklist:
 *                 type: array
 *     responses:
 *       200:
 *         description: Result submitted
 */
router.post('/:id/result', requireRole(ROLE_GROUPS.AUDITORS), async (req, res) => {
    try {
        const { id } = req.params;
        const { result, notes, auditMode, checklist } = req.body; // result: 'PASS' | 'FAIL'

        if (!result) {
            return res.status(400).json({ success: false, error: 'Result is required (PASS/FAIL)' });
        }

        // C2-01 (audit 2026-06-10): a FAIL drives the app to CAR_PENDING, which starts
        // the applicant's 5-working-day corrective-action clock. The canonical workflow
        // REQUIRES a comment on any →CAR_PENDING transition, but this route writes via
        // writeApplicationStatus (edge+role only), bypassing buildTransitionUpdate's
        // REQUIRES_COMMENT gate — so a FAIL could land with no corrective-action text.
        if (result === 'FAIL' && !String(notes || '').trim()) {
            return res.status(400).json({
                success: false,
                error: 'ต้องระบุหมายเหตุ/ข้อที่ต้องแก้ไข (notes) เมื่อผลการตรวจเป็น FAIL (CAR_PENDING)',
                code: 'CAR_COMMENT_REQUIRED',
            });
        }

        const newStatus = result === 'PASS' ? 'AUDIT_PASSED' : 'CAR_PENDING';
        // CAR SLA clock: on →CAR_PENDING compute the 5-working-day (Thai-holiday-aware)
        // due date so it is stamped into formData below + a RevisionDeadline row seeded
        // after the write — without it the auto-expiry cron has nothing to act on.
        const carDueAt = newStatus === 'CAR_PENDING' ? computeCarDueDate(new Date()) : null;

        // PR-1.6: tenant-scope the lookup. Recording an audit result
        // triggers cert generation, farm activation, and notifications —
        // letting one tenant's auditor record results on another tenant's
        // application would corrupt downstream state.
        //
        // Wave A Phase 25 (G4 cont): also gate by application visibility.
        // Inside a tenant, only the assigned auditor (or admin/scheduler)
        // should be able to record an audit result. Without this, any
        // provider in the tenant could trigger cert generation on someone
        // else's audit. The visibility helper falls through to null for
        // non-auditor roles so admin / scheduler are unaffected.
        const orgId = req.user?.organizationId || req.tenantContext?.organizationId || null;
        const tenantWhere = orgId ? { id, organizationId: orgId } : { id };
        const application = await applicationService.findAuditApplication({
            where: withVisibility(tenantWhere, req.user),
            include: {
                // Phase 2 #2.11 — needed by the post-result applicant
                // notification block at the bottom of this handler.
                applicant: { select: { id: true, healthId: true } },
            },
        });
        if (!application) {
            return res.status(404).json({ success: false, error: 'Application not found' });
        }

        const existingFormData = (typeof application.formData === 'object' && application.formData) ? application.formData : {};
        const updatedFormData = {
            ...existingFormData,
            auditResult: result,
            auditNotes: notes,
            auditChecklist: checklist, // Save detailed checklist
            auditedAt: new Date(),
            auditMode: auditMode,
            // Stamp the CAR due date so the auto-cancel cron + the applicant-facing
            // CAR enforcement (applications-car.js) read it (both key spellings, as
            // the Job Sheet handler does).
            ...(carDueAt ? { carDueAt: carDueAt.toISOString(), car_due_at: carDueAt.toISOString() } : {}),
        };

        // Phase 2 #2.5: status flip + cert generation must succeed
        // together or roll back together. Before this commit, the
        // application was flipped to AUDIT_PASSED first; a subsequent
        // cert-generation failure left the app in the "passed" state
        // with no certificate, which is invisible to the operator
        // unless they spot the silent log line. Now: if cert gen fails
        // for an AUDIT_PASSED outcome, we revert the status to
        // AUDIT_CONFIRMED and surface a 500 so the auditor knows to
        // retry. CAR_PENDING (failure) is unaffected — there's no
        // cert to generate on a fail.

        const previousStatus = application.status;
        // BE-T1: run the status flip and (on AUDIT_PASSED) certificate issuance in
        // ONE transaction. The writer's AUDIT_PASSED hook issues the cert through
        // this same tx handle, so a cert-gen failure rolls the status flip back
        // automatically — no window where the application is PASSED with no
        // certificate, and no best-effort compensating revert that could itself fail.
        try {
            await prisma.$transaction(async (tx) => {
                // A PASS rests on the same onsite evidence the certificate will — refuse
                // it here with the reason, not later at the approver's desk. A refusal
                // writes nothing (same tx).
                if (newStatus === 'AUDIT_PASSED') {
                    await assertOnsiteEvidenceForPass({ prisma: tx, application });
                }
                await writeApplicationStatus({
                    prisma: tx,
                    applicationId: id,
                    fromStatus: previousStatus,
                    toStatus: newStatus,
                    actorId: req.user?.id || 'auditor',
                    actorRole: req.user?.canonicalRole || req.user?.role || 'AUDITOR',
                    reason: `AUDIT_RESULT:${newStatus}`,
                    // Validate the workflow edge: reject illegal results such as a
                    // re-PASS on an already-AUDIT_PASSED app (AUDIT_PASSED→AUDIT_PASSED)
                    // or AUDIT_PASSED→CAR_PENDING, which would corrupt a certified record.
                    // canTransition permits the legal AUDIT_CONFIRMED/CAR_REVIEWING→
                    // AUDIT_PASSED|CAR_PENDING edges for the auditor role (verified), so
                    // this does NOT block the real audit flow. Sibling route
                    // /provider/auditor/.../final-approvals already enforces edges.
                    assertTransition: true,
                    // Blocker H (full-system audit 2026-07-07): this route previously
                    // wrote ZERO AuditLog rows — the cert-minting AUDIT_PASSED (and the
                    // CAR-clock-starting CAR_PENDING) transition was attributable only
                    // via mutable Application.updatedBy/formData. Record it in the
                    // immutable hash chain, atomic with the status flip (same tx) —
                    // exact mirror of the onsite twin (audit-onsite-service.js WF-F8).
                    onAudit: statusTransitionAuditHook({
                        tx,
                        metadata: {
                            auditResult: result,
                            auditMode: auditMode ?? null,
                            decidedBy: req.user?.id,
                        },
                    }),
                    additionalData: {
                        updatedBy: req.user?.id,
                        formData: updatedFormData,
                    },
                });
            });
        } catch (writeError) {
            const evidenceRefusal = onsiteEvidenceRefusal(writeError);
            if (evidenceRefusal) {
                return res.status(evidenceRefusal.status).json({
                    ...evidenceRefusal.body,
                    errorTh: evidenceRefusal.body.messageTh,
                });
            }
            // Illegal workflow edge (from assertTransition) → 422, not 500: the
            // application is already past the audit gate (e.g. AUDIT_PASSED/APPROVED/
            // CERTIFIED) so a re-PASS or FAIL would corrupt a certified record.
            if (/illegal transition/i.test(writeError?.message || '')) {
                return res.status(422).json({
                    success: false,
                    code: 'INVALID_TRANSITION',
                    error: `Cannot submit an audit result from the current state (${previousStatus}).`,
                    errorTh: 'ไม่สามารถบันทึกผลการตรวจประเมินจากสถานะปัจจุบันได้ (ไม่ถูกต้องตามขั้นตอน workflow)',
                });
            }
            // Carpet-bomb debug 2026-07-08: honor the writer's own HTTP intent
            // for client-side faults (e.g. the EXPIRED-exit fence throws
            // {statusCode:409, code:'WAIVER_REOPEN_REQUIRED'} BEFORE
            // assertTransition, so it never matches the 422 branch above).
            // Without this it fell through to the 500 below with a misleading
            // "please retry" message and falsely tripped 5xx monitoring.
            if (writeError?.statusCode && writeError.statusCode < 500) {
                // Serve the catalogued messages when the code has a row, exactly
                // as the >=500 branch below does for CERT_SIGNING_UNAVAILABLE.
                // A cert-hook refusal (e.g. CERTIFICATE_FARM_LOCATION_MISSING)
                // arrives wrapped in the writer's English rollback note, and the
                // old fixed Thai line here blamed the application status for
                // it; the catalog states the real reason. The refusal itself
                // rides along as `cause` with a structured missingFields list,
                // which is forwarded so the specific blanks reach the auditor.
                const rejectedCode = writeError.code || 'AUDIT_RESULT_REJECTED';
                const rejectedEntry = lookupErrorCode(rejectedCode);
                const missingFields = writeError.cause?.missingFields;
                return res.status(writeError.statusCode).json({
                    success: false,
                    code: rejectedCode,
                    error: rejectedEntry?.messageEn || writeError.message,
                    errorTh: rejectedEntry?.messageTh
                        || 'ไม่สามารถบันทึกผลการตรวจประเมินจากสถานะปัจจุบันได้',
                    ...(Array.isArray(missingFields) && missingFields.length > 0
                        ? { missingFields }
                        : {}),
                });
            }
            logger.error('[Audit] audit-result transaction failed — status + certificate rolled back atomically', {
                applicationId: id,
                previousStatus,
                toStatus: newStatus,
                error: writeError?.message,
            });
            // Ruling 2: honour a 5xx the writer asked for explicitly (503 for
            // CERT_SIGNING_UNAVAILABLE — a signing outage is "come back later",
            // not "the server is broken"). Anything else stays 500, so this does
            // not reclassify unexpected faults as retryable.
            const declaredStatus = Number(writeError?.statusCode) || 0;
            const status = declaredStatus >= 500 && declaredStatus < 600 ? declaredStatus : 500;
            const code = writeError?.code || 'AUDIT_RESULT_FAILED';
            const catalogued = lookupErrorCode(code);
            return res.status(status).json({
                success: false,
                error: catalogued?.messageEn
                    || 'Audit result could not be saved; no changes were applied. Please retry.',
                errorTh: catalogued?.messageTh
                    || 'ไม่สามารถบันทึกผลการตรวจประเมินได้ ระบบไม่ได้เปลี่ยนแปลงข้อมูลใด ๆ กรุณาลองใหม่',
                code,
            });
        }
        // CAR SLA clock: seed the RevisionDeadline row the hourly revision-deadline-checker
        // cron scans (the status write above succeeded). Best-effort — a deadline-seed
        // failure must not undo a recorded auditor decision, but it is logged because it
        // is the corrective-action window's clock. Mirrors auditor-audit-decision-handler.js.
        if (carDueAt) {
            try {
                await seedCarRevisionDeadline({ applicationId: id, dueAt: carDueAt, actorId: req.user?.id });
            } catch (deadlineErr) {
                logger.error(`[Audit] CAR deadline seed failed for ${id}: ${deadlineErr?.message}`);
            }
        }
        const updated = await applicationService.getById(id);

        // If Approved, we technically should enable the Farm status to ACTIVE here or via a hook.
        // For E2E, we'll handle Farm Status update separately or rely on frontend to trigger it?
        // Actually, let's update Farm status to 'ACTIVE' directly if approved.
        // If AUDIT_PASSED, auto-approve and generate certificate
        if (newStatus === 'AUDIT_PASSED') {
            const appData = updated.formData;

            // 1. Activate Farm
            if (appData && appData.locationData && appData.locationData.farmId) {
                try {
                    const farmId = appData.locationData.farmId;
                    await farmService.updateFarmFromAudit(farmId, {
                        status: 'ACTIVE',
                        verifiedAt: new Date(),
                        verifiedBy: req.user?.id,
                    });
                    logger.info(`[Audit] Auto-activated Farm ${farmId} for Application ${updated.applicationNumber}`);
                } catch (farmError) {
                    logger.error('[Audit] Failed to activate farm:', farmError);
                    // Non-blocking — farm activation can be retried by an admin
                }
            }

            // 2. Certificate — already issued atomically with the AUDIT_PASSED
            //    status flip by the writer's cert hook inside the transaction
            //    above (BE-T1). The old inline generate + best-effort compensating
            //    rollback is gone: the transaction guarantees status ⇔ certificate.
        }

        // Phase 2 #2.11 — applicant notification on audit result.
        // The auditor's pass/fail decision moves the application state; the applicant
        // is told on both branches (PASS by the writer's fanout, FAIL here),
        // fire-and-forget so a notification service hiccup doesn't break the
        // audit-result endpoint.
        try {
            const applicantUserId = application.applicant?.id || application.userId;
            if (applicantUserId) {
                // PASS: no message from here. This used to send APPLICATION_APPROVED
                // ("คำขอได้รับการอนุมัติ") — false: the inspector's PASS is not an
                // approval. The writer's AUDIT_PASSED fanout already tells the applicant,
                // truthfully, that the audit passed and the decision is pending.
                if (newStatus === 'CAR_PENDING') {
                    // Use canonical REVISION_REQUESTED key (legacy
                    // REVISION_REQUIRED still resolves via the alias map).
                    await sendNotification(applicantUserId, NotifyType.REVISION_REQUESTED, {
                        applicationNumber: application.applicationNumber,
                        reason: notes || 'การตรวจประเมินไม่ผ่าน รอดำเนินการแก้ไข',
                    });
                }
            }
        } catch (notifyErr) {
            logger.warn('[Audit] applicant notification failed (non-fatal):', notifyErr?.message);
        }

        res.json({
            success: true,
            message: `Audit submitted: ${result}`,
            data: updated,
        });

    } catch (error) {
        logger.error('[Audit] submitResult error:', error);
        return respondError(res, req, error);
    }
});

module.exports = router;
