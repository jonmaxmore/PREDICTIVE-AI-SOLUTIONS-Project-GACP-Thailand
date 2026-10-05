/**
 * attachment-service unit tests — Wave A Phase 32 / G1 foundation.
 *
 * No DB — exercises the service contract via stubbed prisma model.
 *  - Required-args validation
 *  - prisma.attachment.create called with correct shape
 *  - listForResource: with and without `field` filter
 *  - detach: sets isDeleted=true with metadata
 *  - detachAllByUploader: PDPA bulk path
 *  - findByHash: with and without organizationId
 */

'use strict';

const path = require('path');

const servicePath = path.resolve(__dirname, '../services/attachment-service.js');

function loadService() {
    jest.resetModules();
    return require(servicePath);
}

function makePrisma() {
    return {
        attachment: {
            create: jest.fn(async ({ data }) => ({ id: 'att-1', ...data })),
            findMany: jest.fn(async () => []),
            findFirst: jest.fn(async () => null),
            update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
            updateMany: jest.fn(async () => ({ count: 0 })),
        },
    };
}

describe('attachment-service: attach', () => {
    test('throws when args missing', async () => {
        const svc = loadService();
        await expect(svc.attach()).rejects.toThrow(/args required/);
    });

    test('throws on missing required fields', async () => {
        const svc = loadService();
        const baseArgs = {
            prisma: makePrisma(),
            resModel: 'Application',
            resId: 'a-1',
            fileName: 'x.pdf',
            fileUrl: '/storage/x.pdf',
            fileSize: 100,
            organizationId: 'org-1',
        };
        await expect(svc.attach({ ...baseArgs, prisma: undefined })).rejects.toThrow(/prisma required/);
        await expect(svc.attach({ ...baseArgs, resModel: undefined })).rejects.toThrow(/resModel required/);
        await expect(svc.attach({ ...baseArgs, resId: undefined })).rejects.toThrow(/resId required/);
        await expect(svc.attach({ ...baseArgs, fileName: undefined })).rejects.toThrow(/fileName required/);
        await expect(svc.attach({ ...baseArgs, fileUrl: undefined })).rejects.toThrow(/fileUrl required/);
        await expect(svc.attach({ ...baseArgs, fileSize: undefined })).rejects.toThrow(/fileSize required/);
        await expect(svc.attach({ ...baseArgs, fileSize: -1 })).rejects.toThrow(/fileSize required/);
    });

    test('creates with all expected fields, defaulting optional ones to null', async () => {
        const svc = loadService();
        const prisma = makePrisma();
        const out = await svc.attach({
            prisma,
            resModel: 'Application',
            resId: 'a-1',
            fileName: 'farm.jpg',
            fileUrl: '/storage/a-1/farm.jpg',
            fileSize: 1024,
            organizationId: 'org-1',
        });
        expect(prisma.attachment.create).toHaveBeenCalledWith({
            data: {
                resModel: 'Application',
                resId: 'a-1',
                field: null,
                fileName: 'farm.jpg',
                fileUrl: '/storage/a-1/farm.jpg',
                fileSize: 1024,
                mimeType: null,
                fileHash: null,
                uploadedBy: null,
                organizationId: 'org-1',
            },
        });
        expect(out.id).toBe('att-1');
    });

    test('passes through optional fields when supplied', async () => {
        const svc = loadService();
        const prisma = makePrisma();
        await svc.attach({
            prisma,
            resModel: 'PaymentSlip',
            resId: 'slip-9',
            field: 'fileUrl',
            fileName: 'slip.png',
            fileUrl: '/storage/slips/9.png',
            fileSize: 2048,
            mimeType: 'image/png',
            fileHash: 'sha256-abc',
            uploadedBy: 'user-X',
            organizationId: 'org-2',
        });
        const args = prisma.attachment.create.mock.calls[0][0];
        expect(args.data.field).toBe('fileUrl');
        expect(args.data.mimeType).toBe('image/png');
        expect(args.data.fileHash).toBe('sha256-abc');
        expect(args.data.uploadedBy).toBe('user-X');
    });
});

describe('attachment-service: listForResource', () => {
    test('throws on missing args', async () => {
        const svc = loadService();
        const baseArgs = { prisma: makePrisma(), resModel: 'Application', resId: 'a-1' };
        await expect(svc.listForResource({ ...baseArgs, prisma: undefined })).rejects.toThrow();
        await expect(svc.listForResource({ ...baseArgs, resModel: undefined })).rejects.toThrow();
        await expect(svc.listForResource({ ...baseArgs, resId: undefined })).rejects.toThrow();
    });

    test('queries by (resModel, resId) when no field given', async () => {
        const svc = loadService();
        const prisma = makePrisma();
        await svc.listForResource({ prisma, resModel: 'Application', resId: 'a-1' });
        expect(prisma.attachment.findMany).toHaveBeenCalledWith({
            where: { resModel: 'Application', resId: 'a-1' },
            orderBy: { createdAt: 'asc' },
        });
    });

    test('narrows by field when provided', async () => {
        const svc = loadService();
        const prisma = makePrisma();
        await svc.listForResource({
            prisma,
            resModel: 'Application',
            resId: 'a-1',
            field: 'attachments',
        });
        expect(prisma.attachment.findMany).toHaveBeenCalledWith({
            where: { resModel: 'Application', resId: 'a-1', field: 'attachments' },
            orderBy: { createdAt: 'asc' },
        });
    });
});

describe('attachment-service: detach', () => {
    test('soft-deletes with metadata', async () => {
        const svc = loadService();
        const prisma = makePrisma();
        await svc.detach({
            prisma,
            attachmentId: 'att-1',
            deletedBy: 'user-Y',
            reason: 'replaced',
        });
        const call = prisma.attachment.update.mock.calls[0][0];
        expect(call.where).toEqual({ id: 'att-1' });
        expect(call.data.isDeleted).toBe(true);
        expect(call.data.deletedBy).toBe('user-Y');
        expect(call.data.deleteReason).toBe('replaced');
        expect(call.data.deletedAt).toBeInstanceOf(Date);
    });

    test('throws on missing attachmentId', async () => {
        const svc = loadService();
        await expect(svc.detach({ prisma: makePrisma() })).rejects.toThrow(/attachmentId required/);
    });
});

describe('attachment-service: detachAllByUploader (PDPA)', () => {
    test('updateMany targets uploadedBy with soft-delete fields', async () => {
        const svc = loadService();
        const prisma = makePrisma();
        await svc.detachAllByUploader({
            prisma,
            uploadedBy: 'user-X',
            deletedBy: 'admin',
            reason: 'PDPA-DELETE',
        });
        const call = prisma.attachment.updateMany.mock.calls[0][0];
        expect(call.where).toEqual({ uploadedBy: 'user-X' });
        expect(call.data.isDeleted).toBe(true);
        expect(call.data.deletedBy).toBe('admin');
        expect(call.data.deleteReason).toBe('PDPA-DELETE');
    });

    test('throws on missing uploadedBy', async () => {
        const svc = loadService();
        await expect(svc.detachAllByUploader({ prisma: makePrisma() })).rejects.toThrow(/uploadedBy required/);
    });
});

describe('attachment-service: findByHash (dedup)', () => {
    test('queries by fileHash alone when no org given', async () => {
        const svc = loadService();
        const prisma = makePrisma();
        await svc.findByHash({ prisma, fileHash: 'sha256-abc' });
        expect(prisma.attachment.findFirst).toHaveBeenCalledWith({
            where: { fileHash: 'sha256-abc' },
        });
    });

    test('narrows by organizationId when supplied', async () => {
        const svc = loadService();
        const prisma = makePrisma();
        await svc.findByHash({ prisma, fileHash: 'sha256-abc', organizationId: 'org-1' });
        expect(prisma.attachment.findFirst).toHaveBeenCalledWith({
            where: { fileHash: 'sha256-abc', organizationId: 'org-1' },
        });
    });

    test('throws on missing fileHash', async () => {
        const svc = loadService();
        await expect(svc.findByHash({ prisma: makePrisma() })).rejects.toThrow(/fileHash required/);
    });
});
