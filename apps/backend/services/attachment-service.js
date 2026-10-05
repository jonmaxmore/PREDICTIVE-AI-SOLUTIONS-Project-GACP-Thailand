/**
 * @module services/attachment-service
 *
 * Wave A Phase 32 / G1 foundation — canonical API for the polymorphic
 * Attachment model.
 *
 * The Attachment table is a single home for every file pointer in the
 * system. Today's reality: ~25 file fields across 15 models, each with
 * its own validation / storage / cleanup. This module owns the centralised
 * version. NO consumer migration in this PR — existing fields keep
 * working in parallel until follow-up PRs port them one at a time.
 *
 * Polymorphism: (resModel, resId, field) on Attachment. Not a Prisma
 * relation — Prisma doesn't support polymorphic FKs. Joins are done
 * here in service code.
 *
 * Usage:
 *
 *   const att = require('./attachment-service');
 *
 *   // Attach a file uploaded by an HEALTH user to their application
 *   await att.attach({
 *     prisma,
 *     resModel: 'Application',
 *     resId:    application.id,
 *     field:    'attachments',
 *     fileName: 'farm-photo.jpg',
 *     fileUrl:  '/storage/applications/abc/farm-photo.jpg',
 *     fileSize: 1024 * 1024,
 *     mimeType: 'image/jpeg',
 *     fileHash: 'sha256-...',
 *     uploadedBy: req.user.id,
 *     organizationId: req.user.organizationId,
 *   });
 *
 *   // List every attachment on an audit checklist
 *   const docs = await att.listForResource({
 *     prisma,
 *     resModel: 'AuditChecklist',
 *     resId: checklistId,
 *   });
 *
 *   // Soft-delete a single attachment
 *   await att.detach({
 *     prisma,
 *     attachmentId: doc.id,
 *     deletedBy: req.user.id,
 *     reason: 'Replaced by newer version',
 *   });
 *
 *   // PDPA "delete every file user X uploaded"
 *   await att.detachAllByUploader({
 *     prisma,
 *     uploadedBy: 'user-X',
 *     deletedBy: 'admin-Y',
 *     reason: 'PDPA-DELETE',
 *   });
 */

'use strict';

/**
 * Insert a new attachment row.
 *
 * @param {object} args
 * @param {object} args.prisma          — prisma client OR tx handle
 * @param {string} args.resModel        — Prisma model name of the parent
 * @param {string} args.resId           — uuid of the parent row
 * @param {string|null} [args.field]    — optional slot on the parent
 * @param {string} args.fileName
 * @param {string} args.fileUrl         — storage URL (local path / S3 key)
 * @param {number} args.fileSize        — bytes
 * @param {string|null} [args.mimeType]
 * @param {string|null} [args.fileHash] — SHA-256 hex (for dedup)
 * @param {string|null} [args.uploadedBy]
 * @param {string} args.organizationId  — tenant id (the Prisma extension
 *                                         injects from context if a tenant
 *                                         scope is bound, but accepting it
 *                                         explicitly keeps this service
 *                                         usable from scripts/tests too)
 * @returns {Promise<object>} the created Attachment row
 */
async function attach(args) {
    if (!args || typeof args !== 'object') {
        throw new TypeError('attach: args required');
    }
    const {
        prisma,
        resModel,
        resId,
        field = null,
        fileName,
        fileUrl,
        fileSize,
        mimeType = null,
        fileHash = null,
        uploadedBy = null,
        organizationId,
    } = args;

    if (!prisma) {
        throw new TypeError('attach: prisma required');
    }
    if (!resModel) {
        throw new TypeError('attach: resModel required');
    }
    if (!resId) {
        throw new TypeError('attach: resId required');
    }
    if (!fileName) {
        throw new TypeError('attach: fileName required');
    }
    if (!fileUrl) {
        throw new TypeError('attach: fileUrl required');
    }
    if (typeof fileSize !== 'number' || fileSize < 0) {
        throw new TypeError('attach: fileSize required (non-negative number)');
    }

    return prisma.attachment.create({
        data: {
            resModel,
            resId,
            field,
            fileName,
            fileUrl,
            fileSize,
            mimeType,
            fileHash,
            uploadedBy,
            organizationId,
        },
    });
}

/**
 * List attachments for a given resource. Returns only live (non-tombstoned)
 * rows by default — the soft-delete extension auto-injects
 * `isDeleted: false`.
 *
 * @param {object} args
 * @param {object} args.prisma
 * @param {string} args.resModel
 * @param {string} args.resId
 * @param {string|null} [args.field] — when set, narrows to one slot
 * @returns {Promise<object[]>}
 */
async function listForResource(args) {
    if (!args || typeof args !== 'object') {
        throw new TypeError('listForResource: args required');
    }
    const { prisma, resModel, resId, field } = args;

    if (!prisma) {
        throw new TypeError('listForResource: prisma required');
    }
    if (!resModel) {
        throw new TypeError('listForResource: resModel required');
    }
    if (!resId) {
        throw new TypeError('listForResource: resId required');
    }

    const where = field !== undefined && field !== null
        ? { resModel, resId, field }
        : { resModel, resId };

    return prisma.attachment.findMany({
        where,
        orderBy: { createdAt: 'asc' },
    });
}

/**
 * Soft-delete a single attachment.
 *
 * @param {object} args
 * @param {object} args.prisma
 * @param {string} args.attachmentId
 * @param {string|null} [args.deletedBy]
 * @param {string|null} [args.reason]
 * @returns {Promise<object>} the updated row (now with isDeleted=true)
 */
async function detach(args) {
    if (!args || typeof args !== 'object') {
        throw new TypeError('detach: args required');
    }
    const { prisma, attachmentId, deletedBy = null, reason = null } = args;

    if (!prisma) {
        throw new TypeError('detach: prisma required');
    }
    if (!attachmentId) {
        throw new TypeError('detach: attachmentId required');
    }

    return prisma.attachment.update({
        where: { id: attachmentId },
        data: {
            isDeleted: true,
            deletedAt: new Date(),
            deletedBy,
            deleteReason: reason,
        },
    });
}

/**
 * Soft-delete every attachment uploaded by a given user. PDPA-grade
 * delete-by-uploader. Returns the count of rows updated.
 *
 * @param {object} args
 * @param {object} args.prisma
 * @param {string} args.uploadedBy
 * @param {string|null} [args.deletedBy]
 * @param {string|null} [args.reason]
 * @returns {Promise<{ count: number }>}
 */
async function detachAllByUploader(args) {
    if (!args || typeof args !== 'object') {
        throw new TypeError('detachAllByUploader: args required');
    }
    const { prisma, uploadedBy, deletedBy = null, reason = null } = args;

    if (!prisma) {
        throw new TypeError('detachAllByUploader: prisma required');
    }
    if (!uploadedBy) {
        throw new TypeError('detachAllByUploader: uploadedBy required');
    }

    return prisma.attachment.updateMany({
        where: { uploadedBy },
        data: {
            isDeleted: true,
            deletedAt: new Date(),
            deletedBy,
            deleteReason: reason,
        },
    });
}

/**
 * Find a live attachment by its file content hash. Useful for dedup —
 * before uploading a fresh copy, ask whether the same bytes already
 * exist in this tenant.
 *
 * @param {object} args
 * @param {object} args.prisma
 * @param {string} args.fileHash
 * @param {string|null} [args.organizationId]
 * @returns {Promise<object|null>}
 */
async function findByHash(args) {
    if (!args || typeof args !== 'object') {
        throw new TypeError('findByHash: args required');
    }
    const { prisma, fileHash, organizationId = null } = args;

    if (!prisma) {
        throw new TypeError('findByHash: prisma required');
    }
    if (!fileHash) {
        throw new TypeError('findByHash: fileHash required');
    }

    const where = organizationId
        ? { fileHash, organizationId }
        : { fileHash };

    return prisma.attachment.findFirst({ where });
}

module.exports = {
    attach,
    listForResource,
    detach,
    detachAllByUploader,
    findByHash,
};
