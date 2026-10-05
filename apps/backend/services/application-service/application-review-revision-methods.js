const { writeApplicationStatus } = require('../application-status-writer');
// R2 M7 (D-6) — append-only per-round snapshot of the submitted formData.
const { snapshotCorrectionSubmission } = require('../correction-submission-version-service');
// Bug 6.5 — shared 5-working-day revision-deadline guard (dueAt resolution +
// EXPIRE-on-overdue) so this method and POST /applications/submit agree.
const { assertRevisionNotExpired } = require('./revision-deadline-guard');
const { CANONICAL_ROLES } = require('../../shared/canonical-rbac');
// M2a audit F2 — formData is ONE column with TWO writers. The applicant's half
// of it goes through the ownership rule (shared/form-data-ownership.js:20-23) so
// a request body cannot rewrite what the SERVER recorded — above all
// `serverRequirementSnapshot`, the document law this filing is judged by.
const { mergeClientFormData } = require('../../shared/form-data-ownership');
// F-REVISION-DOOR-NO-QUOTATION fix (task-3, 2026-08-18) — a DRAFT resubmit
// reaching PENDING_DOC_FEE needs the same quotation POST /applications/submit
// issues on its own isInitialSubmit branch. F-G4-64 R3: both doors now go
// through the ONE helper (services/quotation-issuance-on-submit), required at
// the call site, so the await-audit-notify block exists once.
// MAJOR-2 fix (Ruling 7, task-3 fix round 1) — the SAME completeness gate
// POST /applications/submit enforces before writing any transition, reused
// via shared import (not re-implemented) so a DRAFT filed through this door
// cannot skip the wizard-completeness/document checks the front door 422s at.
const { validateSubmissionPayload } = require('../../validation/application-submission-validator');

// Provider staff to notify. Canonical-only since the contract phase: migration
// 20260801000000 ran clean against production (UPDATE 23, zero legacy rows) and
// the writers were switched in #713, so no row holds a legacy spelling.
// 'PROVIDER' rode along through the expand phase and is gone too — it is a
// QUARANTINE_VALUE, and the migration ABORTS when a quarantined row exists.
const PROVIDER_NOTIFY_ROLES = Object.freeze([CANONICAL_ROLES.DOCUMENT_REVIEWER, CANONICAL_ROLES.SYSTEM_ADMIN_DTAM]);

function createApplicationReviewRevisionMethods({
    prisma,
    sendNotification,
    NotifyType,
    logger,
}) {
    return {

        /**
         * Submit a revision for an application.
         * Extracted from PUT /:id/revision handler.
         *
         * @param {string} applicationId - ID or applicationNumber
         * @param {{ formData?: object, notes?: string }} revisionData CLIENT data —
         *        it arrives from the request body and is treated as such.
         * @param {{ userId: string, healthId: string, actorIdentity: string, actorRole?: string }} actor
         * @param {{ serverFormDataPatch?: object }} [options] SERVER data the calling
         *        door concluded for itself — e.g. the requirement snapshot a
         *        first-submit door stamps (M2a). It is a separate parameter, not a
         *        field of `revisionData`, precisely because `revisionData` is the
         *        applicant's bag: a future refactor that spread `req.body` into it
         *        still could not reach this.
         * @returns {Promise<{ status: number, body: object }>}
         */
        async submitRevision(applicationId, revisionData, actor, options = {}) {
            const { formData, notes } = revisionData;
            const { serverFormDataPatch = {}, holderScope = null } = options || {};
            const { userId: actorUserId, healthId: actorHealthId, actorIdentity, actorRole } = actor;

            const byIdOrNumber = { OR: [{ id: applicationId }, { applicationNumber: applicationId }] };
            // Spec 2026-09-30 §3.1/§3.3 (R2 Task 12): the filing is read within the
            // caller's holder scope; the door's submit guard already decided that the
            // caller may act for its holder, so who filed it does not matter. Without
            // a scope (no health door) the old filer where stays.
            const app = await prisma.application.findFirst({
                where: holderScope
                    ? { ...byIdOrNumber, ...require('../holder-access').holderReadWhere(holderScope, 'Application') }
                    : { ...byIdOrNumber, healthId: actorHealthId },
            });

            if (!app) {
                return { status: 404, body: { success: false, error: 'Application not found or access denied' } };
            }

            // PR 2c: the two legacy spellings are gone — REVISION_REQUESTED is
            // the only value the column can hold for this stage.
            const revisableStatuses = ['REVISION_REQUESTED', 'DRAFT'];
            if (!revisableStatuses.includes(app.status)) {
                return {
                    status: 400,
                    body: { success: false, error: `Cannot submit revision for application with status: ${app.status}` },
                };
            }

            const currentFormData = (typeof app.formData === 'object' && app.formData) ? app.formData : {};
            const currentWorkflowHistory = Array.isArray(app.workflowHistory) ? app.workflowHistory : [];
            const now = new Date();

            // Bug 6.5: the 5-working-day revision-deadline check (dueAt resolution
            // + EXPIRE-on-overdue side-effects) now lives in ONE shared helper so
            // the primary /applications/submit RESUBMIT path enforces the exact
            // same window this method does. On overdue the app is EXPIRED here and
            // the resubmit is rejected with the same 400 as before.
            const { expired } = await assertRevisionNotExpired(app, {
                prisma,
                actorUserId,
                actorRole,
                actorIdentity,
            });
            if (expired) {
                return { status: 400, body: { success: false, error: 'Revision deadline exceeded. Application expired.' } };
            }

            // Revision resubmit must re-enter document review. Canonical map
            // (workflow-transition-service ALLOWED_TRANSITIONS) is
            // REVISION_REQUESTED ↔ ASSIGNED_FOR_REVIEW; only a fresh DRAFT submit
            // advances toward SUBMITTED/PENDING_DOC_FEE. DRAFT path target
            // corrected below (F-REVISION-DOOR-NO-QUOTATION).
            //
            // F-REVISION-DOOR-NO-QUOTATION fix (task-3, 2026-08-18): a DRAFT
            // resubmitted through THIS door used to stop at bare SUBMITTED —
            // off-canonical (SUBMITTED is the SSOT's SYSTEM-owned TRANSIENT hop:
            // ALLOWED_TRANSITIONS.SUBMITTED = {PENDING_DOC_FEE},
            // workflow-transition-service.js:49; ROLE_TRANSITIONS.system carries
            // 'SUBMITTED->PENDING_DOC_FEE' labelled "submit hop-2 auto-advance",
            // :172) — and with ZERO quotations, because issuance is gated on
            // POST /applications/submit's OWN isInitialSubmit flag
            // (applications.js:982), which this door never sets. Originally (audit
            // 2.9) this branch wrote SUBMITTED for a REVISION_REQUESTED resubmit
            // too, stranding it pre-review; that part of the fix (routing
            // REVISION_REQUESTED to ASSIGNED_FOR_REVIEW) is unchanged below. The
            // DRAFT leg now targets the SAME resting state /submit's DRAFT path
            // produces — PENDING_DOC_FEE — via the same two legal SSOT edges,
            // instead of the shortcut WF-F5 already named a defect once in that
            // other door (applications.js:762-773).
            const isDraftSubmit = String(app.status || '').toUpperCase() === 'DRAFT';
            const resubmitToStatus = isDraftSubmit ? 'PENDING_DOC_FEE' : 'ASSIGNED_FOR_REVIEW';

            // Merge form data and add revision metadata.
            // H1 (audit 2.9 follow-up): writeApplicationStatus below carries a
            // `formData` key in additionalData, which BYPASSES the writer's
            // auto-sync of formData.workflowState (application-status-writer.js
            // guards the sync with `!('formData' in additionalData)`). The
            // reviewer's requestRevision left formData.workflowState =
            // 'REVISION_REQUESTED'; if we don't overwrite it here, the row ends up
            // with status=ASSIGNED_FOR_REVIEW but formData.workflowState=
            // REVISION_REQUESTED. resolveStateFromApplication() PREFERS
            // formData.workflowState, so the reviewer's next ASSIGNED_FOR_REVIEW
            // → DOC_APPROVED transition would 422 INVALID_TRANSITION — dead-ending
            // the workflow one step later than the original 2.9 bug. Stamp it
            // explicitly, mirroring the assign handler
            // (provider/handlers/applications.js).
            //
            // F2 (audit M2a): the client half of that merge goes through
            // applyClientFormData. `...currentFormData` stays first so a partial
            // resubmit still keeps the applicant answers it did not resend (the
            // helper alone is a full REPLACEMENT), and the helper then lays the
            // STORED server-owned values back on top — so a body carrying
            // `serverRequirementSnapshot: { slotIds: [] }` changes nothing.
            // serverFormDataPatch is the door's own conclusion and outranks the
            // client; the lifecycle keys below outrank both.
            const updatedFormData = {
                ...mergeClientFormData(currentFormData, formData),
                ...serverFormDataPatch,
                workflowState: resubmitToStatus,
                workflowStateUpdatedAt: now.toISOString(),
                _revisionHistory: [
                    ...(currentFormData._revisionHistory || []),
                    {
                        submittedAt: new Date().toISOString(),
                        notes: notes || 'Revision submitted',
                        previousStatus: app.status,
                    },
                ],
                _lastReviewComment: null,
            };

            // MAJOR-2 fix (Ruling 7, task-3 fix round 1, 2026-08-18): a DRAFT
            // filing through THIS door must clear the SAME completeness gate
            // the front door (POST /applications/submit) 422s at
            // (applications.js hasLegacyMasterStepPayload branch) — otherwise
            // an incomplete filing could reach PENDING_DOC_FEE and mint
            // price-of-record quotations (quotation-service.js;
            // getFrozenPhaseFees reads them with no status filter, and
            // payment honors the frozen amount over a recompute) through a
            // door the front door would have refused. Reuses the front
            // door's own validator functions via the shared
            // validateSubmissionPayload (do NOT re-implement the
            // legacy-vs-canonical decision here — dup-source ratchet).
            // Validates `updatedFormData` — the fully-merged view about to be
            // written — not the stale pre-request `currentFormData`, since
            // THIS request is exactly where the applicant's fix arrives.
            //
            // F-PLOT-AREAUNIT-DEADEND fix (Task 1, 2026-08-19, operator
            // decision: both doors): this used to run ONLY on the DRAFT leg.
            // A REVISION_REQUESTED resubmit — the specimen's actual path
            // (f866374a…, evidence/phase0/FINDINGS.md:127-131) — could
            // replace `plots` wholesale via applyClientFormData with no
            // completeness check at all, sailing to ASSIGNED_FOR_REVIEW and
            // dying later at cert generation. The M2a document-requirement
            // stamp (still judged at the route layer,
            // application-workflow-handlers.js) is a DIFFERENT question
            // (which files are required) from this one (is the formData
            // itself well-formed) — both now run on every resubmit leg.
            const validation = validateSubmissionPayload({
                currentFormData: updatedFormData,
                payload: formData,
                application: app,
            });
            if (!validation.isValid) {
                return {
                    status: 422,
                    body: {
                        success: false,
                        error: 'APPLICATION_INCOMPLETE',
                        message: 'กรุณากรอกข้อมูลให้ครบถ้วนก่อนส่งคำขอ',
                        errorsByStep: validation.errorsByStep,
                        ...(validation.missingFields ? { missingFields: validation.missingFields } : {}),
                    },
                };
            }

            // R2 M7 (D-6): the correction resubmit OVERWRITES Application.formData
            // (EXPAND — the column still holds the latest working copy). In the
            // SAME transaction ALSO append an immutable CorrectionSubmissionVersion
            // so this round's submitted formData survives the overwrite (keyed off
            // the M3 round ledger). A DRAFT (non-correction) submit maps to no
            // round stage, so the snapshot is a no-op there.
            await prisma.$transaction(async (tx) => {
                if (isDraftSubmit) {
                    // FIRST statement: a RENEWAL/REPLACEMENT claim (the stored, server-owned
                    // link) takes the renewal door's per-certificate lock and refuses when
                    // another filing of that certificate is in flight (409).
                    await require('../application-submit-guard').lockAndAssertNoSuccessionInFlight(tx, {
                        application: app, userId: actorUserId, holderScope,
                        auditContext: { actorType: 'USER', actorRole: actorRole || null, route: 'PUT /applications/:id/revision' },
                    });
                }
                if (isDraftSubmit) {
                    // Hop 1 — DRAFT → SUBMITTED (the applicant's act, via this
                    // door). Mirrors POST /applications/submit's hop 1
                    // (applications.js:846-875).
                    const hop1Event = {
                        timestamp: now.toISOString(),
                        action: 'Applicant_REVISION_SUBMITTED',
                        fromStatus: app.status,
                        toStatus: 'SUBMITTED',
                        actorId: actorIdentity || actorUserId,
                        actorRole: actorRole || null,
                    };
                    await writeApplicationStatus({
                        prisma: tx,
                        applicationId: app.id,
                        fromStatus: app.status,
                        toStatus: 'SUBMITTED',
                        // Scalar applications.updatedBy → User UUID, not actorIdentity
                        // (raw providerId || healthId plaintext). JSON history keeps identity.
                        actorId: actorUserId,
                        actorRole: actorRole || null,
                        reason: 'Applicant_REVISION_SUBMITTED',
                        additionalData: {
                            formData: { ...updatedFormData, workflowState: 'SUBMITTED' },
                            workflowHistory: [...currentWorkflowHistory, hop1Event],
                        },
                    });

                    // Hop 2 — SUBMITTED → PENDING_DOC_FEE. SYSTEM-owned
                    // auto-advance (ROLE_TRANSITIONS.system "submit hop-2
                    // auto-advance", workflow-transition-service.js:172) — the
                    // same edge, same actor role, POST /applications/submit
                    // performs for a fresh DRAFT (applications.js:884-911).
                    await writeApplicationStatus({
                        prisma: tx,
                        applicationId: app.id,
                        fromStatus: 'SUBMITTED',
                        toStatus: 'PENDING_DOC_FEE',
                        actorId: actorUserId,
                        actorRole: 'system',
                        reason: 'APPLICATION_SUBMITTED → DOC_FEE_PAYMENT_REQUIRED',
                        additionalData: {
                            formData: updatedFormData, // workflowState already PENDING_DOC_FEE
                            workflowHistory: [
                                ...currentWorkflowHistory,
                                hop1Event,
                                {
                                    timestamp: now.toISOString(),
                                    action: 'DOC_FEE_PAYMENT_REQUIRED',
                                    fromStatus: 'SUBMITTED',
                                    toStatus: 'PENDING_DOC_FEE',
                                    actorId: actorIdentity || actorUserId,
                                    actorRole: 'system',
                                },
                            ],
                        },
                    });
                } else {
                    await writeApplicationStatus({
                        prisma: tx,
                        applicationId: app.id,
                        fromStatus: app.status,
                        toStatus: resubmitToStatus,
                        // Scalar applications.updatedBy → User UUID, not actorIdentity
                        // (raw providerId || healthId plaintext). JSON history keeps identity.
                        actorId: actorUserId,
                        actorRole: actorRole || null,
                        reason: 'Applicant_REVISION_SUBMITTED',
                        additionalData: {
                            formData: updatedFormData,
                            workflowHistory: [
                                ...currentWorkflowHistory,
                                {
                                    timestamp: now.toISOString(),
                                    action: 'Applicant_REVISION_SUBMITTED',
                                    fromStatus: app.status,
                                    toStatus: resubmitToStatus,
                                    actorId: actorIdentity || actorUserId,
                                    actorRole: actorRole || null,
                                },
                            ],
                        },
                    });
                }
                await snapshotCorrectionSubmission({
                    prisma: tx,
                    applicationId: app.id,
                    fromStatus: app.status,
                    formDataSnapshot: updatedFormData,
                });
            });
            const updated = await prisma.application.findUnique({
                where: {
                    id: app.id,
                    ...require('../holder-access').holderReadWhereIfScoped(holderScope, 'Application'),
                },
            });

            // Tier 18 / B18-A parity (F-REVISION-DOOR-NO-QUOTATION fix):
            // idempotent on (applicationId, issuerType) — the same call the
            // front door makes, through the same helper. REVISION_REQUESTED /
            // CAR_PENDING resubmits skip this — quotations are issued exactly
            // once per application lifecycle.
            //
            // F-G4-64 R3: awaited and reported, not fire-and-forget. The
            // resubmitted status is NOT rolled back; the caller is told whether
            // this application has a price of record yet.
            //
            // A REVISION_REQUESTED / CAR_PENDING leg issues NOTHING and says
            // so, rather than answering { issued: true } — which a consumer
            // reads as "this application has a price of record", and which is
            // false for the very applicant this change exists for (initial
            // issuance failed, then a revision resubmit). `issued: null` means
            // "not known from this response"; the GET door answers it.
            let quotationOutcome = { issued: null, reason: 'NOT_AN_ISSUANCE_LEG' };
            if (isDraftSubmit) {
                const { issueQuotationOnSubmit } = require('../quotation-issuance-on-submit');
                quotationOutcome = await issueQuotationOnSubmit({
                    application: updated,
                    actorId: actorUserId,
                    actorRole,
                });
            }

            await prisma.revisionDeadline.updateMany({
                where: { applicationId: app.id, status: { in: ['PENDING', 'EXTENDED'] } },
                data: {
                    status: 'SUBMITTED',
                    submittedAt: now,
                    // submittedBy/updatedBy are scalar String columns → User UUID,
                    // NOT actorIdentity (raw providerId || healthId plaintext).
                    submittedBy: actorUserId,
                    updatedBy: actorUserId,
                },
            });

            // Notify provider
            try {
                const PROVIDERUsers = await prisma.user.findMany({
                    where: { role: { in: [...PROVIDER_NOTIFY_ROLES] } },
                    select: { id: true },
                    take: 5,
                });
                for (const provider of PROVIDERUsers) {
                    await sendNotification(provider.id, NotifyType.NEW_APPLICATION, {
                        applicationNumber: app.applicationNumber,
                        message: `มีเอกสารแก้ไขใหม่จากคำขอ ${app.applicationNumber}`,
                    });
                }
            } catch (notifyErr) {
                logger.warn('[SubmitRevision] Failed to notify provider:', notifyErr.message);
            }

            logger.info('[SubmitRevision] Submitted successfully', {
                id: app.id,
                appNumber: app.applicationNumber,
                previousStatus: app.status,
            });

            // Item 5 (final-review round, 2026-08-18): the DRAFT leg lands the
            // application at PENDING_DOC_FEE, exactly the state the front door's
            // own DRAFT resubmit produces (RESUBMIT_TARGET.DRAFT,
            // routes/api/applications/applications.js:709) — so this door owes
            // the applicant the SAME nextRequiredAction + Thai copy the front
            // door gives, instead of a bare "will be reviewed again" that omits
            // the payment step entirely. The REVISION_REQUESTED leg's message
            // is unchanged — no payment is due there.
            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        id: updated.id,
                        applicationNumber: updated.applicationNumber,
                        status: updated.status,
                    },
                    // Same field the front door returns: whether this filing has
                    // a price of record yet (F-G4-64 R3).
                    quotation: quotationOutcome,
                    ...(isDraftSubmit
                        ? {
                            nextRequiredAction: 'PAY_PHASE_1',
                            message: `คำขอเลขที่ ${updated.applicationNumber} ถูกส่งเข้าระบบแล้ว กรุณาชำระงวดที่ 1 ค่าบริการตรวจสอบเอกสาร`,
                        }
                        : {
                            message: 'Revision submitted successfully. Your application will be reviewed again.',
                        }),
                },
            };
        },
    };
}

module.exports = { createApplicationReviewRevisionMethods };
