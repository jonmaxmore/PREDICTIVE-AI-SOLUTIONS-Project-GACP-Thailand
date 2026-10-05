const fs = require('fs/promises');
const crypto = require('crypto');
const { prisma } = require('../services/prisma-database');
const attachmentService = require('../services/attachment-service');

async function resolveHealthContext(req) {
    const userId = String(req.user?.id || '').trim();
    if (!userId) {
        return null;
    }

    const tokenHealthId = String(req.user?.healthId || '').trim();
    if (tokenHealthId) {
        return { userId, healthId: tokenHealthId };
    }

    const healthUser = await prisma.user.findFirst({
        where: { id: userId, isDeleted: false },
        select: { healthId: true },
    });

    const healthId = String(healthUser?.healthId || '').trim();
    if (!healthId) {
        return null;
    }

    return { userId, healthId };
}

async function getOrCreateActiveDraft(userId, preferredDraftId) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) {
        return null;
    }

    if (preferredDraftId) {
        const draftById = await prisma.applicationDraft.findFirst({
            where: {
                id: String(preferredDraftId),
                userId: normalizedUserId,
                status: 'DRAFT',
            },
        });
        if (draftById) {
            return draftById;
        }
    }

    const existingDraft = await prisma.applicationDraft.findUnique({
        where: {
            userId_status: { userId: normalizedUserId, status: 'DRAFT' },
        },
    });

    if (existingDraft) {
        return existingDraft;
    }

    return prisma.applicationDraft.create({
        data: {
            userId: normalizedUserId,
            plantId: 'cannabis',
            serviceType: 'new_application',
            currentStep: 1,
            formData: {},
            status: 'DRAFT',
        },
    });
}

function getDraftDocuments(draft) {
    const formData = draft?.formData && typeof draft.formData === 'object' ? draft.formData : {};
    const uploadedDocuments = Array.isArray(formData.uploadedDocuments) ? formData.uploadedDocuments : [];
    return uploadedDocuments.filter((doc) => doc && doc.status !== 'DELETED');
}

async function hashUploadedFile(absolutePath) {
    const fileBuffer = await fs.readFile(absolutePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

async function mergeApplicationAttachments(applicationId, healthId, draftDoc) {
    if (!applicationId) {
        return;
    }

    const app = await prisma.application.findFirst({
        where: {
            id: String(applicationId),
            healthId: String(healthId),
            isDeleted: false,
        },
        select: { id: true, attachments: true, organizationId: true },
    });

    if (!app) {
        return;
    }

    const existingAttachments = Array.isArray(app.attachments) ? app.attachments : [];
    // Capture the prior entry for this slot so we can soft-detach the
    // matching Attachment row below (Wave A Phase 36 dual-write).
    const supersededEntry = existingAttachments.find((item) => {
        const itemSlot = String(item?.slotId || item?.type || '').trim();
        return itemSlot === draftDoc.slotId;
    });

    const nextAttachments = existingAttachments.filter((item) => {
        const itemSlot = String(item?.slotId || item?.type || '').trim();
        return itemSlot !== draftDoc.slotId;
    });

    nextAttachments.push({
        id: draftDoc.documentId,
        type: draftDoc.slotId,
        slotId: draftDoc.slotId,
        name: draftDoc.fileName,
        url: draftDoc.fileUrl,
        fileUrl: draftDoc.fileUrl,
        uploaded: true,
        mimeType: draftDoc.mimeType,
        size: draftDoc.size,
        checksum: draftDoc.sha256,
        stepKey: draftDoc.stepKey,
        uploadedAt: draftDoc.uploadedAt,
    });

    await prisma.application.update({
        where: { id: app.id },
        data: {
            attachments: nextAttachments,
        },
    });

    // Wave A Phase 36 (G1 consumer #4) — dual-write the slot's attachment
    // to the polymorphic Attachment table. The slotId distinguishes which
    // form-field this file belongs to (HEALTH apps have slots per required
    // doc — farm-deed, training-cert, ...). Replacing an upload supersedes
    // the prior Attachment row via soft-detach.
    //
    // Best-effort: failures here log a warning. The HEALTH JSON column
    // remains the source of truth for now; readers haven't migrated.
    try {
        if (supersededEntry) {
            const oldAtts = await attachmentService.listForResource({
                prisma,
                resModel: 'Application',
                resId: app.id,
                field: `attachments.${draftDoc.slotId}`,
            });
            for (const att of oldAtts) {
                await attachmentService.detach({
                    prisma,
                    attachmentId: att.id,
                    deletedBy: null,
                    reason: `Superseded by re-upload of slot ${draftDoc.slotId}`,
                });
            }
        }
        await attachmentService.attach({
            prisma,
            resModel: 'Application',
            resId: app.id,
            // Use a slot-qualified field so multiple attachments can coexist
            // on one Application — one per slot. listForResource(field=...)
            // narrows correctly.
            field: `attachments.${draftDoc.slotId}`,
            fileName: draftDoc.fileName || 'unknown',
            fileUrl: draftDoc.fileUrl,
            fileSize: Number(draftDoc.size) || 0,
            mimeType: draftDoc.mimeType || null,
            fileHash: draftDoc.sha256 || null,
            // uploadedBy is null because mergeApplicationAttachments takes
            // healthId not user.id; PDPA-grade enrichment can come later
            // via a backfill once readers depend on the column.
            uploadedBy: null,
            organizationId: app.organizationId,
        });
    } catch (attErr) {
        // Non-fatal — JSON column is still the source of truth.
        console.warn(`[wizard] dual-write Attachment failed (non-fatal): ${attErr?.message || attErr}`);
    }
}

module.exports = {
    resolveHealthContext,
    getOrCreateActiveDraft,
    getDraftDocuments,
    hashUploadedFile,
    mergeApplicationAttachments,
};
