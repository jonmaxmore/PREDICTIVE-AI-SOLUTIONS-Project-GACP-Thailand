'use strict';

/**
 * Planting-activity attachments (operator ruling C4, 2026-09-30 "ทำทางแยก").
 *
 * A file a farmer attaches while logging a care activity belongs to the planting
 * cycle, not to an application. It used to ride on /applications/draft-documents,
 * which found or created an Application draft to hang the file on. The record is
 * now an `Attachment` row (attachment-service, the canonical polymorphic file
 * store) on resModel 'PlantingCycle', resId = the cycle id.
 *
 * `field` holds the capability the upload was authorised under (ACTIVITY_<TYPE>),
 * so the delete door re-checks that same capability on the farm.
 *
 * Reads here touch PlantingCycle and Attachment only; neither is a holder-bearing
 * model, and the farm itself is reached through the existing farm gates
 * (ensureCycleReachable + assertFarmActionPermission) before anything here runs.
 */

const { prisma } = require('../prisma-database');
const attachmentService = require('../attachment-service');
const { sha256OfFile } = require('../application-document-sync');

const PLANTING_ATTACHMENT_RES_MODEL = 'PlantingCycle';

/**
 * The tenant the cycle's rows live in; the attachment row joins it.
 * @param {string} cycleId
 * @returns {Promise<string|null>}
 */
async function cycleOrganizationId(cycleId) {
    const row = await prisma.plantingCycle.findUnique({
        where: { id: String(cycleId) },
        select: { organizationId: true },
    });
    return row?.organizationId || null;
}

/**
 * Record one stored upload as an attachment of the cycle.
 * @param {object} args
 * @param {string} args.cycleId
 * @param {string} args.permission the capability the upload was authorised under
 * @param {string} args.fileName decoded original name
 * @param {string} args.fileUrl served `/uploads/...` URL
 * @param {number} args.fileSize bytes
 * @param {string|null} args.mimeType
 * @param {string} args.absolutePath where the bytes are, for the content hash
 * @param {string} args.uploadedBy user id
 * @param {string} args.organizationId
 * @returns {Promise<object>} the Attachment row
 */
async function recordCycleAttachment({
    cycleId, permission, fileName, fileUrl, fileSize, mimeType, absolutePath, uploadedBy, organizationId,
}) {
    return attachmentService.attach({
        prisma,
        resModel: PLANTING_ATTACHMENT_RES_MODEL,
        resId: String(cycleId),
        field: permission,
        fileName,
        fileUrl,
        fileSize: Number(fileSize) || 0,
        mimeType: mimeType || null,
        fileHash: sha256OfFile(absolutePath),
        uploadedBy,
        organizationId,
    });
}

/**
 * The live attachment `attachmentId` on THIS cycle, or null.
 * @param {string} cycleId
 * @param {string} attachmentId
 * @returns {Promise<{ id: string, field: string|null, fileUrl: string, uploadedBy: string|null }|null>}
 */
async function findLiveCycleAttachment(cycleId, attachmentId) {
    if (!cycleId || !attachmentId) { return null; }
    return prisma.attachment.findFirst({
        where: {
            id: String(attachmentId),
            resModel: PLANTING_ATTACHMENT_RES_MODEL,
            resId: String(cycleId),
            isDeleted: false,
        },
        select: { id: true, field: true, fileUrl: true, uploadedBy: true },
    });
}

/**
 * Is `userId` the OWNER of the cycle's farm? A company farm: an ACTIVE OWNER
 * membership of the holding entity (not deleted). A personal farm (no entity):
 * the farm's ownerId. The farm is read nested under the cycle, through the
 * relation, after ensureCycleReachable has already proved the caller reaches it.
 * @param {string} cycleId
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function isCycleFarmOwner(cycleId, userId) {
    const uid = String(userId || '').trim();
    if (!cycleId || !uid) { return false; }
    const cycle = await prisma.plantingCycle.findUnique({
        where: { id: String(cycleId) },
        select: { farm: { select: { ownerId: true, entityId: true } } },
    });
    const farm = cycle?.farm;
    if (!farm) { return false; }
    if (!farm.entityId) { return farm.ownerId === uid; }
    const membership = await prisma.entityMembership.findUnique({
        where: { userId_entityId: { userId: uid, entityId: farm.entityId } },
        select: { role: true, status: true, entity: { select: { isDeleted: true } } },
    });
    return membership?.role === 'OWNER' && membership?.status === 'ACTIVE' && membership?.entity?.isDeleted !== true;
}

/**
 * Does a saved activity of this cycle carry the attachment?
 * @param {string} cycleId
 * @param {string} attachmentId
 * @returns {Promise<boolean>}
 */
async function isAttachmentCarriedByActivity(cycleId, attachmentId) {
    const count = await prisma.cultivationLog.count({
        where: { cycleId: String(cycleId), attachmentIds: { array_contains: [String(attachmentId)] } },
    });
    return count > 0;
}

/**
 * The live attachments of THIS cycle among `attachmentIds` (an activity save
 * references only these).
 * @param {string} cycleId
 * @param {string[]} attachmentIds
 * @returns {Promise<Array<{ id: string, field: string|null }>>}
 */
async function findLiveCycleAttachments(cycleId, attachmentIds) {
    if (!cycleId || !Array.isArray(attachmentIds) || attachmentIds.length === 0) { return []; }
    return prisma.attachment.findMany({
        where: {
            id: { in: attachmentIds.map(String) },
            resModel: PLANTING_ATTACHMENT_RES_MODEL,
            resId: String(cycleId),
            isDeleted: false,
        },
        select: { id: true, field: true },
    });
}

/**
 * Soft-delete one attachment (the row stays as the record of who removed it).
 * @param {string} attachmentId
 * @param {string} deletedBy user id
 * @returns {Promise<object>}
 */
async function removeCycleAttachment(attachmentId, deletedBy) {
    return attachmentService.detach({
        prisma,
        attachmentId,
        deletedBy,
        reason: 'PLANTING_ATTACHMENT_REMOVED_BY_USER',
    });
}

module.exports = {
    PLANTING_ATTACHMENT_RES_MODEL,
    cycleOrganizationId,
    recordCycleAttachment,
    findLiveCycleAttachment,
    findLiveCycleAttachments,
    isCycleFarmOwner,
    isAttachmentCarriedByActivity,
    removeCycleAttachment,
};
