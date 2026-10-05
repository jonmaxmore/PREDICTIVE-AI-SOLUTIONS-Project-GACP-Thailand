/**
 * CAR (Corrective Action Request) Routes
 * Handles CAR document uploads from Applicants
 */

const express = require('express');
const { safeErrorMessage, respondError } = require('../../../shared/api-response');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { multipartLimits } = require('../../../shared/multipart-limits');
// รากของโฟลเดอร์อัปโหลด ประกาศไว้ที่เดียวใน storage-service.js — ห้ามนับ '../' เองอีก
const { BASE_UPLOAD_DIR } = require('../../../services/storage-service');
const { authenticateHealth } = require('../../../middleware/auth-middleware');
// The Prisma client is still imported, but only as the transaction handle we
// pass into writeApplicationStatus (which requires it by contract). All direct
// model access (application.findFirst, user.findMany) was moved into the
// services below so this route no longer queries the database itself.
// See docs/tech-debt/prisma-bypass-routes.md.
const { prisma } = require('../../../services/prisma-database');
const { sendNotification, NotifyType } = require('../../../services/notification-service');
const { normalizeRole, CANONICAL_ROLES } = require('../../../shared/canonical-rbac');
const { buildWorkflowEvent } = require('../../../shared/workflow-event-builder');
const workflowTransitionService = require('../../../services/workflow-transition-service');
const { writeApplicationStatus } = require('../../../services/application-status-writer');
// R2 M7 (D-6) — append-only per-round snapshot of the submitted formData. The
// CAR resubmit is a FIELD_AUDIT correction submission (CAR_PENDING → CAR_REVIEWING).
const { snapshotCorrectionSubmission } = require('../../../services/correction-submission-version-service');
const applicationService = require('../../../services/application-service');
const { holderScope } = require('../../../services/holder-access');
const { discardRejectedUpload } = require('../../../services/upload-content-guard');
const { listActiveProviders } = require('../../../services/provider-user-service');
const logger = require('../../../shared/logger');
// M1 (2026-08-15) — the fourth submit door (plan D4). Ownership ("is this my
// application") is not the same question as authority ("may I act for the
// entity that holds it"), so the guard runs here too.
const { assertSubmitAllowed, SubmitGuardError } = require('../../../services/application-submit-guard');
// M2a (2026-08-15) — a CAR submission is a RESUBMIT: it is judged by the
// requirement set stamped on the application at its first submit, never by a
// rule the ministry filed in the meantime (spec §3 / M-9).
const {
    assertRequiredDocumentsPresent,
    isSubmitGateRefusal,
    respondSubmitGateRefusal,
    MODE_RESUBMIT,
} = require('../../../services/application-document-requirements');
const { auditLogger, AuditCategory, AuditSeverity, ResourceType } = require('../../../middleware/audit-logger');

// ปลายทางต้องเป็นโฟลเดอร์เดียวกับที่ express.static เสิร์ฟเป็น /uploads เพราะ handler ข้างล่าง
// เก็บที่อยู่ไฟล์ไว้เป็น `/uploads/car/<filename>` · เดิมนับ '../' เอง แล้วนับพลาดไปหนึ่งชั้น
// (routes/public/uploads/car — โฟลเดอร์ที่ไม่มีอยู่จริง ไม่มีใครเสิร์ฟ และไม่มี volume รองรับ)
// ⇒ อัปโหลดทุกครั้งตายด้วย ENOENT · storage-service.js เจอบั๊กเดียวกันนี้เมื่อ 2026-06-25 และ
// แก้ด้วยการประกาศรากไว้ที่เดียว จึงถามรากจากที่นั่นแทนการนับเอง
const CAR_UPLOAD_DIR = path.join(BASE_UPLOAD_DIR, 'car');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // สร้างโฟลเดอร์ถ้ายังไม่มี — โฟลเดอร์ว่างไม่ถูกเก็บใน git และ volume ที่เพิ่ง mount ใหม่ก็ว่าง
    // การอัปโหลดครั้งแรกของเครื่องใหม่ทุกเครื่องจึงเคยล้มเสมอ
    fs.mkdirSync(CAR_UPLOAD_DIR, { recursive: true });
    cb(null, CAR_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${crypto.randomInt(1_000_000_000)}`;
    cb(null, 'CAR-' + uniqueSuffix + path.extname(file.originalname));
  },
});

// AppAudit AM2 (2026-05-15): the previous filter used a regex substring test
// (`/jpeg|jpg|png|pdf/.test(file.mimetype)`) which silently accepted attacker-
// controlled mimetypes like `image/jpeg-exploit; charset=evil` and extensions
// like `.malicious.pdf.exe`. Switch to an exact-match Set on both the mimetype
// and the file extension, so a single byte of deviation is rejected.
const CAR_ALLOWED_MIMETYPES = new Set([
  'image/jpeg',
  'image/png',
  'application/pdf',
]);
const CAR_ALLOWED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.pdf',
]);

// SECU-02: หน้าจอส่งไฟล์ carDocument ได้ถึง 10 ไฟล์ + ฟิลด์ข้อความ notes, applicationId
// notes เป็นข้อความอิสระที่ไม่มีเพดานฝั่งหน้าจอ จึงให้ถึง 128 KB (ภาษาไทยราว 42,000 ตัวอักษร)
const upload = multer({
  storage,
  limits: multipartLimits({ fileSize: 10 * 1024 * 1024, files: 10, fields: 10, fieldSize: 128 * 1024 }),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mimetypeOk = CAR_ALLOWED_MIMETYPES.has(file.mimetype);
    const extOk = CAR_ALLOWED_EXTENSIONS.has(ext);

    if (mimetypeOk && extOk) {
      return cb(null, true);
    }
    return cb(new Error('Only images and PDF files are allowed'));
  },
});

// M1 AC3 — record the accepted act and the entity it was made for. A null
// holder is refused by the submit guard, never healed (spec 2026-09-30 §3.2 + C3: a null holder is never healed to the caller's personal entity; heal-null-holders.js places legacy rows).
// `auditLogger.log()` opens its own transaction and takes its own advisory lock
// (audit-logger.js:479,505-506), so it is called outside every business
// transaction, and it is best-effort by design (log() swallows its own errors,
// :526-541).
async function logCarSubmitAccepted({ req, applicationId, entityId }) {
    try {
        await auditLogger.log({
            category: AuditCategory.APPLICATION,
            action: 'APPLICATION_CAR_SUBMIT_ACCEPTED',
            severity: AuditSeverity.INFO,
            actorId: req.user?.id || 'UNKNOWN',
            actorType: 'USER',
            actorRole: req.user?.canonicalRole || req.user?.role || 'UNKNOWN',
            resourceType: ResourceType.APPLICATION,
            resourceId: applicationId,
            ipAddress: req.ip || null,
            userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
            organizationId: req.user?.organizationId || null,
            result: 'SUCCESS',
            metadata: {
                onBehalfOfEntityId: entityId || null,
                permission: 'SUBMIT_APPLICATION',
                applicationId,
                route: `${req.method} ${req.baseUrl || ''}${req.path || ''}`,
            },
        });
    } catch (auditErr) {
        logger.warn(`[CAR Upload] accepted-audit write failed (non-fatal): ${auditErr?.message}`);
    }
}

/**
 * multer stores the evidence before this door decides anything, so every refusal
 * removes what it stored (confined to the uploads root by discardRejectedUpload);
 * only an accepted resubmit keeps its files.
 * @param {Array<{ path?: string }>|undefined} files
 */
async function discardCarUploads(files) {
  for (const file of Array.isArray(files) ? files : []) {
    await discardRejectedUpload(file);
  }
}

router.post('/:id/car', authenticateHealth, upload.array('carDocument', 10), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded' });
    }

    // The filing is read within the caller's holder scope (spec 2026-09-30
    // §3.1, holderScope/holderReadWhere), with no filer pin. Whether the caller
    // may act for its holder is the submit guard's question, asked right below
    // (a CAR resubmit is a submit, §3.3).
    const application = await applicationService.findOwnedApplicationForApplicant(id, {
        holderScope: await holderScope(req),
    });

    if (!application) {
      await discardCarUploads(files);
      return res.status(404).json({ success: false, error: 'Application not found' });
    }

    // M1 submit gate — asked BEFORE any decision this route makes, including
    // the deadline expiry below: an expiry written by a caller who may not act
    // for this entity is still a write in that entity's name.
    let onBehalfOfEntityId = null;
    try {
      ({ entityId: onBehalfOfEntityId } = await assertSubmitAllowed({
        userId: req.user.id,
        application,
        // The guard re-checks a RENEWAL/REPLACEMENT claim's certificate holder.
        holderScope: await holderScope(req),
        auditContext: {
          actorType: 'USER',
          actorRole: req.user?.canonicalRole || req.user?.role || null,
          ipAddress: req.ip || null,
          userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
          organizationId: req.user?.organizationId || null,
          route: `${req.method} ${req.baseUrl || ''}${req.path || ''}`,
        },
      }));
    } catch (guardErr) {
      if (guardErr instanceof SubmitGuardError) {
        await discardCarUploads(files);
        return respondError(res, req, guardErr, { message: guardErr.message });
      }
      throw guardErr;
    }

    const carDocuments = files.map(file => ({
      filename: file.filename,
      originalName: file.originalname,
      path: `/uploads/car/${file.filename}`,
      size: file.size,
      uploadedAt: new Date().toISOString(),
    }));

    const currentFormData = typeof application.formData === 'object' ? application.formData : {};
    const currentWorkflowHistory = Array.isArray(application.workflowHistory) ? application.workflowHistory : [];
    const currentState = workflowTransitionService.resolveStateFromApplication(application);
    if (currentState !== 'CAR_PENDING') {
      await discardCarUploads(files);
      return res.status(400).json({
        success: false,
        error: `Cannot submit CAR evidence in ${currentState} state`,
      });
    }

    const carDueRaw = currentFormData.carDueAt || currentFormData.car_due_at || currentFormData?.carRequest?.dueAt || null;
    const carDueAt = carDueRaw ? new Date(carDueRaw) : null;
    if (carDueAt && Number.isFinite(carDueAt.getTime()) && new Date() > carDueAt) {
      const ts = new Date().toISOString();

      // The DEADLINE expired this application, not the applicant. Attributing
      // it to req.user recorded the applicant as having cancelled their own
      // fully-paid application, which is both false and the opposite of what
      // the cron records for the identical transition ('cron' / 'system',
      // cron.js). It also created a perverse reading of the compliance trail:
      // an applicant who submitted late looked like they withdrew, while one
      // who submitted nothing was expired by the system. Their late request
      // only DISCOVERED the expiry, so the system is the actor either way.
      //
      // Both writes go in ONE transaction, and the open RevisionDeadline row is
      // failed alongside — again matching the cron, which otherwise leaves a
      // PENDING deadline attached to an EXPIRED application and keeps it in the
      // overdue queues.
      await prisma.$transaction(async (tx) => {
        await writeApplicationStatus({
          prisma: tx,
          applicationId: id,
          fromStatus: application.status,
          toStatus: 'EXPIRED',
          actorId: 'system:car-deadline',
          actorRole: 'system',
          reason: 'CAR_DEADLINE_EXPIRED',
          additionalData: {
            updatedBy: 'system:car-deadline',
            formData: {
              ...currentFormData,
              workflowState: 'EXPIRED',
              workflowStateUpdatedAt: ts,
              canceledExpiredAt: ts,
              cancelReason: 'CAR_OVERDUE',
              // Records that a late submission attempt is what surfaced the
              // expiry, without implying the applicant chose it.
              carOverdueDetectedOnSubmitAt: ts,
            },
            workflowHistory: [
              ...currentWorkflowHistory,
              buildWorkflowEvent({
                action: 'CAR_DEADLINE_EXPIRED',
                fromState: currentState,
                toState: 'EXPIRED',
                actorId: 'system:car-deadline',
                actorRole: 'system',
              }),
            ],
          },
        });

        await tx.revisionDeadline.updateMany({
          where: {
            applicationId: id,
            status: { in: ['PENDING', 'EXTENDED'] },
          },
          data: {
            status: 'FAILED',
            updatedBy: 'system',
          },
        });
      });

      await discardCarUploads(files);
      return res.status(400).json({
        success: false,
        error: 'CAR deadline exceeded. Application has been cancelled.',
      });
    }

    // M2a — the document law, mode 'resubmit'. Placed AFTER the deadline branch
    // above on purpose: an overdue CAR is expired by the system, and a missing
    // document must not preempt that verdict with a 422 that leaves the
    // application sitting in CAR_PENDING past its deadline. Placed before every
    // write of the resubmit itself.
    try {
      await assertRequiredDocumentsPresent({ application, mode: MODE_RESUBMIT, holderScope: await holderScope(req) });
    } catch (docErr) {
      if (isSubmitGateRefusal(docErr)) {
                await discardCarUploads(files);
                return respondSubmitGateRefusal(res, docErr);
            }
      throw docErr;
    }

    // R2 M7 (D-6): the CAR resubmit OVERWRITES Application.formData (EXPAND — the
    // column still holds the latest working copy). In the SAME transaction ALSO
    // append an immutable CorrectionSubmissionVersion so this FIELD_AUDIT round's
    // submitted formData survives the overwrite (keyed off the M3 round ledger).
    const carResubmitFormData = {
      ...currentFormData,
      carDocuments: [
        ...(currentFormData.carDocuments || []),
        ...carDocuments,
      ],
      carNotes: notes,
      carSubmittedAt: new Date().toISOString(),
      workflowState: 'CAR_REVIEWING',
      workflowStateUpdatedAt: new Date().toISOString(),
    };
    await prisma.$transaction(async (tx) => {
      await writeApplicationStatus({
        prisma: tx,
        applicationId: id,
        fromStatus: application.status,
        toStatus: 'CAR_REVIEWING',
        actorId: req.user.id,
        actorRole: req.user.canonicalRole || req.user.role || null,
        reason: 'CAR_EVIDENCE_SUBMITTED',
        additionalData: {
          formData: carResubmitFormData,
          workflowHistory: [
            ...currentWorkflowHistory,
            buildWorkflowEvent({
              action: 'CAR_EVIDENCE_SUBMITTED',
              fromState: currentState,
              toState: 'CAR_REVIEWING',
              actorId: req.user.id,
              actorRole: req.user.canonicalRole || req.user.role || null,
              metadata: { fileCount: carDocuments.length },
            }),
          ],
        },
      });
      await snapshotCorrectionSubmission({
        prisma: tx,
        applicationId: id,
        // currentState passed the CAR_PENDING guard above → FIELD_AUDIT stage.
        fromStatus: currentState,
        formDataSnapshot: carResubmitFormData,
        // CAR document refs live under carDocuments (not draftDocuments).
        attachmentsSnapshot: carResubmitFormData.carDocuments,
      });
    });

    // AC3 — the accepted act, and the entity it was made for.
    await logCarSubmitAccepted({ req, applicationId: id, entityId: onBehalfOfEntityId });

    // Fan-out list of active provider accounts (any role); the auditor filter
    // is applied below via normalizeRole because the role mapping lives in the
    // shared canonical-rbac module.
    const reviewers = await listActiveProviders();

    for (const reviewer of reviewers.filter((provider) => normalizeRole(provider.role) === CANONICAL_ROLES.FIELD_INSPECTOR)) {
      await sendNotification(reviewer.id, NotifyType.CAR_REVIEWING, {
        applicationNumber: application.applicationNumber,
        applicationId: application.id,
      });
    }

    logger.info(`[CAR Upload] Application ${application.applicationNumber} - ${files.length} files uploaded`);

    res.json({
      success: true,
      message: 'CAR documents uploaded successfully',
      data: {
        filesUploaded: files.length,
        status: 'CAR_REVIEWING',
      },
    });
  } catch (error) {
    logger.error('[CAR Upload] Error:', error);
    // Not discarded here: an error after the resubmit wrote may leave rows that
    // name these files.
    res.status(500).json({ success: false, error: safeErrorMessage(error) });
  }
});

module.exports = router;

