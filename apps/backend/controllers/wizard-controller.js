const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const { prisma } = require('../services/prisma-database');
const _feeService = require('../services/fee-service');
const applicationService = require('../services/application-service');
const storageService = require('../services/storage-service');
const wizardHelpers = require('./wizard-controller-helpers');
const logger = require('../shared/logger');
const { applyClientFormData } = require('../shared/form-data-ownership');

/**
 * Wizard Controller
 * Handles GACP Application Wizard (9 Steps) using Prisma (PostgreSQL)
 */
const wizardController = {
    ...wizardHelpers,

    uploadDraftDocument: async (req, res) => {
        try {
            const context = await wizardController.resolveHealthContext(req);
            if (!context) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            if (!req.file) {
                return res.status(400).json({ success: false, error: 'No file uploaded' });
            }

            const slotId = String(req.body?.slotId || '').trim();
            const stepKey = String(req.body?.stepKey || '').trim();
            const draftId = String(req.body?.draftId || '').trim() || null;
            const applicationId = String(req.body?.applicationId || '').trim() || null;

            if (!slotId || !stepKey) {
                return res.status(400).json({
                    success: false,
                    error: 'slotId and stepKey are required',
                });
            }

            const draft = await wizardController.getOrCreateActiveDraft(context.userId, draftId);
            if (!draft) {
                return res.status(404).json({ success: false, error: 'Draft not found' });
            }

            const documentId = randomUUID();
            // S3: req.file.key + req.file.location  |  Local: req.file.path
            const isS3 = Boolean(req.file.key);
            const s3Key = req.file.key || null;
            const absolutePath = req.file.path || null;
            const fileUrl = isS3
                ? req.file.location || `/s3/${req.file.key}`
                : `/uploads/wizard-drafts/${path.basename(absolutePath)}`;
            const uploadedAt = new Date().toISOString();

            let sha256 = null;
            if (!isS3 && absolutePath) {
                sha256 = await wizardController.hashUploadedFile(absolutePath);
            }

            const draftDoc = {
                documentId,
                slotId,
                stepKey,
                fileUrl,
                filePath: absolutePath,
                s3Key,
                storageProvider: isS3 ? 's3' : 'local',
                fileName: req.file.originalname,
                mimeType: req.file.mimetype,
                size: Number(req.file.size || 0),
                sha256,
                uploadedAt,
                uploadedBy: context.userId,
                status: 'ACTIVE',
            };

            const formData = draft.formData && typeof draft.formData === 'object' ? draft.formData : {};
            const currentDocs = wizardController.getDraftDocuments(draft);
            const nextDocs = currentDocs.filter((doc) => String(doc?.slotId || '').trim() !== slotId);
            nextDocs.push(draftDoc);

            await prisma.applicationDraft.update({
                where: { id: draft.id },
                data: {
                    formData: {
                        ...formData,
                        uploadedDocuments: nextDocs,
                    },
                    lastSavedAt: new Date(),
                },
            });

            await wizardController.mergeApplicationAttachments(applicationId, context.healthId, draftDoc);

            return res.json({
                success: true,
                data: {
                    documentId: draftDoc.documentId,
                    draftId: draft.id,
                    slotId: draftDoc.slotId,
                    stepKey: draftDoc.stepKey,
                    fileUrl: draftDoc.fileUrl,
                    fileName: draftDoc.fileName,
                    mimeType: draftDoc.mimeType,
                    size: draftDoc.size,
                    sha256: draftDoc.sha256,
                    uploadedAt: draftDoc.uploadedAt,
                },
            });
        } catch (error) {
            logger.error('[Wizard Draft Documents Upload] Error:', error);
            return res.status(500).json({ success: false, error: 'Failed to upload draft document' });
        }
    },

    listDraftDocuments: async (req, res) => {
        try {
            const context = await wizardController.resolveHealthContext(req);
            if (!context) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            const draftId = String(req.query?.draftId || '').trim() || null;
            const draft = await wizardController.getOrCreateActiveDraft(context.userId, draftId);
            if (!draft) {
                return res.status(404).json({ success: false, error: 'Draft not found' });
            }

            const documents = wizardController.getDraftDocuments(draft).map((doc) => ({
                documentId: doc.documentId,
                slotId: doc.slotId,
                stepKey: doc.stepKey,
                fileUrl: doc.fileUrl,
                fileName: doc.fileName,
                mimeType: doc.mimeType,
                size: doc.size,
                sha256: doc.sha256,
                uploadedAt: doc.uploadedAt,
            }));

            return res.json({
                success: true,
                data: {
                    draftId: draft.id,
                    documents,
                },
            });
        } catch (error) {
            logger.error('[Wizard Draft Documents List] Error:', error);
            return res.status(500).json({ success: false, error: 'Failed to load draft documents' });
        }
    },

    deleteDraftDocument: async (req, res) => {
        try {
            const context = await wizardController.resolveHealthContext(req);
            if (!context) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            const draftId = String(req.query?.draftId || '').trim() || null;
            const documentId = String(req.params?.documentId || '').trim();
            if (!documentId) {
                return res.status(400).json({ success: false, error: 'documentId is required' });
            }

            const draft = await wizardController.getOrCreateActiveDraft(context.userId, draftId);
            if (!draft) {
                return res.status(404).json({ success: false, error: 'Draft not found' });
            }

            const formData = draft.formData && typeof draft.formData === 'object' ? draft.formData : {};
            const currentDocs = wizardController.getDraftDocuments(draft);
            const targetDoc = currentDocs.find((doc) => String(doc?.documentId || '') === documentId);
            if (!targetDoc) {
                return res.status(404).json({ success: false, error: 'Draft document not found' });
            }

            const nextDocs = currentDocs.filter((doc) => String(doc?.documentId || '') !== documentId);
            await prisma.applicationDraft.update({
                where: { id: draft.id },
                data: {
                    formData: {
                        ...formData,
                        uploadedDocuments: nextDocs,
                    },
                    lastSavedAt: new Date(),
                },
            });

            // Delete file from storage (S3 or local).
            //
            // filePath/s3Key are read back out of the formData record rather
            // than derived here, so they are only as trustworthy as every
            // writer of that record. Confine the local path to the uploads root
            // before unlinking: without this, a poisoned entry made this an
            // arbitrary file delete as the node user, and the .catch below
            // swallowed the evidence. saveDraft no longer accepts a
            // client-authored uploadedDocuments list, so this is the second of
            // two independent controls, not the only one.
            if (targetDoc.s3Key) {
                await storageService.deleteObject(storageService.BUCKETS.uploads, targetDoc.s3Key).catch(() => { });
            } else {
                const safePath = storageService.resolveWithinUploads(targetDoc.filePath);
                if (safePath) {
                    await fs.unlink(safePath).catch(() => { });
                } else if (String(targetDoc.filePath || '').trim()) {
                    logger.warn(
                        `[Wizard Draft Documents Delete] Refusing to unlink a path outside the uploads root `
                        + `(draft=${draft.id}, documentId=${documentId}).`,
                    );
                }
            }

            return res.json({
                success: true,
                data: {
                    draftId: draft.id,
                    documentId,
                },
            });
        } catch (error) {
            logger.error('[Wizard Draft Documents Delete] Error:', error);
            return res.status(500).json({ success: false, error: 'Failed to delete draft document' });
        }
    },


    // Auto-Save Draft (with optimistic concurrency control).
    //
    // Concurrency model: prevents silent data loss when an applicant has
    // the wizard open in two tabs and both auto-save. The client echoes
    // back the `expectedVersion` it loaded; the backend updates only
    // when that version matches what's in the DB, then increments.
    //
    // Three branches:
    //  1. expectedVersion absent (first save / legacy client) — plain
    //     upsert. Backward-compatible during rollout.
    //  2. expectedVersion present + matches — atomic update + increment.
    //  3. expectedVersion present + mismatches — 409 with current state
    //     so the UI can prompt the user to reload.
    saveDraft: async (req, res) => {
        try {
            const userId = req.user.id;
            const { plantId, serviceType, currentStep, formData, expectedVersion } = req.body;

            // This endpoint REPLACES formData with the client's blob, but the
            // blob also holds server-written records — `uploadedDocuments`, whose
            // filePath/s3Key entries drive fs.unlink() and deleteObject() in
            // deleteDraftDocument below. Accepting the client's copy let an
            // applicant author a delete target. Read what the server has and lay
            // the server-owned keys back on top of the client's answers, so the
            // applicant writes their wizard data and nothing else.
            const existingDraft = await prisma.applicationDraft.findUnique({
                where: { userId_status: { userId, status: 'DRAFT' } },
            });
            const safeFormData = applyClientFormData(existingDraft?.formData, formData);

            const updateData = {
                plantId,
                serviceType,
                currentStep,
                formData: safeFormData,
                lastSavedAt: new Date(),
            };

            // Branch 1 — no expectedVersion: legacy / first-save path.
            if (expectedVersion === undefined || expectedVersion === null) {
                const draft = await prisma.applicationDraft.upsert({
                    where: { userId_status: { userId, status: 'DRAFT' } },
                    update: { ...updateData, version: { increment: 1 } },
                    create: {
                        userId,
                        plantId,
                        serviceType,
                        currentStep,
                        formData: safeFormData,
                        status: 'DRAFT',
                        version: 1,
                    },
                });
                return res.json({ success: true, data: draft });
            }

            // Branch 2 — conditional update: only if version matches.
            const result = await prisma.applicationDraft.updateMany({
                where: {
                    userId,
                    status: 'DRAFT',
                    isDeleted: false,
                    version: expectedVersion,
                },
                data: { ...updateData, version: { increment: 1 } },
            });

            if (result.count > 0) {
                const updated = await prisma.applicationDraft.findUnique({
                    where: { userId_status: { userId, status: 'DRAFT' } },
                });
                return res.json({ success: true, data: updated });
            }

            // Branch 3 — version mismatch OR draft no longer exists.
            const current = await prisma.applicationDraft.findUnique({
                where: { userId_status: { userId, status: 'DRAFT' } },
            });
            if (current && !current.isDeleted) {
                // Conflict: another tab updated since this client loaded.
                return res.status(409).json({
                    success: false,
                    error: 'DRAFT_VERSION_CONFLICT',
                    message:
                        'อีกแท็บได้บันทึกร่างไปก่อนหน้านี้แล้ว โปรดโหลดข้อมูลล่าสุดก่อนแก้ไขต่อ',
                    current,
                });
            }

            // No draft exists (was finalized / deleted between load and save).
            // Treat the client's payload as a fresh draft.
            const created = await prisma.applicationDraft.create({
                data: {
                    userId,
                    plantId,
                    serviceType,
                    currentStep,
                    formData: safeFormData,
                    status: 'DRAFT',
                    version: 1,
                },
            });
            return res.json({ success: true, data: created });
        } catch (error) {
            logger.error('[Wizard Save] Error:', error);
            res.status(500).json({ success: false, error: 'Failed to save draft' });
        }
    },

    // Get Active Draft
    getDraft: async (req, res) => {
        try {
            const userId = req.user.id;
            const draft = await prisma.applicationDraft.findUnique({
                where: {
                    userId_status: { userId: userId, status: 'DRAFT' },
                },
            });

            res.json({ success: true, data: draft });

        } catch (_error) {
            res.status(500).json({ success: false, error: 'Failed to retrieve draft' });
        }
    },

    // Prepare Application (Payment phase 1 pending)
    submitApplication: async (req, res) => {
        try {
            const userId = req.user.id;

            // PDPA close-natid-round2 (2026-06-30): resolve the FK *token* the
            // same way the LIVE applications.js POST path does — never write the
            // raw national ID into Application.healthId / Invoice.healthId.
            // Application.healthId is an FK to User.canonicalId, which is a
            // keyed-HMAC TOKEN (not the national ID) once APP_FK_USE_TOKEN is on
            // (STAGE A, LIVE prod). resolveHealthIdentity returns
            // { userId, healthId: fkValue(...) } where `healthId` is the token
            // when the flag is on, the legacy national ID when off — so this is
            // byte-for-byte unchanged with the flag off and correct (no
            // re-poisoned FK) with it on. This legacy wizard alias is mounted
            // ONLY behind ENABLE_PROVIDER_LEGACY_ALIAS (set in NO prod/staging
            // env today); fixing the divergence here keeps a future re-enable
            // from re-introducing a plaintext-national-ID FK.
            const healthScope = String(req.user?.healthId || '').trim()
                ? { healthId: String(req.user.healthId).trim(), strictHealthId: true }
                : { strictHealthId: true };
            let identity;
            try {
                identity = await applicationService.resolveHealthIdentity(userId, healthScope);
            } catch (resolveErr) {
                logger.error('[Wizard Prepare] Failed to resolve health identity', {
                    message: resolveErr.message,
                });
                return res.status(400).json({
                    success: false,
                    error: 'Health identity (healthId) is required',
                });
            }
            // The FK token written into Application.healthId + Invoice.healthId.
            const fkHealthId = identity.healthId;
            if (!fkHealthId) {
                return res.status(400).json({
                    success: false,
                    error: 'Health identity (healthId) is required',
                });
            }

            // Call the newly extracted service logic instead of huge raw DB transactions
            const result = await applicationService.executeWizardSubmission(
                identity.userId || userId,
                fkHealthId,
                req.body || {},
            );

            // เดิมตรงนี้เรียก ensurePhaseInvoices('PHASE_1') เพื่อมินต์ใบแจ้งหนี้คู่
            // รัฐ/บริษัท · การแยกใบถูกยกเลิกตั้งแต่ F-G4-35 (ฟังก์ชันกลายเป็น no-op)
            // และถูกลบทั้งเครื่องเมื่อ 2026-09-11 ตอน operator สั่งเลิกแยกค่าธรรมเนียม
            // ใบแจ้งหนี้จริงมินต์ที่ /api/payments/checkout ใบเดียวต่องวด

            res.json({
                success: true,
                data: result,
                message: 'Application prepared. Phase 1 payment is required before final submission.',
            });

        } catch (error) {
            logger.error('[Wizard Prepare] Error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    prepareApplication: async (req, res) => wizardController.submitApplication(req, res),
};
module.exports = wizardController;
