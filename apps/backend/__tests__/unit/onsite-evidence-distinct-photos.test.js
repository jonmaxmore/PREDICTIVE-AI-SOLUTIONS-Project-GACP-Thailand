/**
 * Evidence integrity — one photograph uploaded N times is not N photographs
 * (2026-08-26).
 *
 * FarmAuditPhoto stores a SHA-256 over the raw bytes as a tamper-detection
 * hash, but nothing compared it and there is no unique constraint on
 * (auditId, fileHash) — while onsite-evidence-gate counted ROWS. So the
 * "minimum N photos" that the zero-evidence-cert fix rests on could be
 * satisfied by uploading a single image N times, and the row set looked
 * perfectly normal afterwards.
 *
 * Two halves, both required:
 *   1. the GATE counts DISTINCT fileHash — it decides issuance, and it is the
 *      only half that can speak to rows written before this fix;
 *   2. the WRITE (uploadPhoto) refuses bytes already recorded on that audit,
 *      so the auditor is told at the moment of the double-tap instead of
 *      collecting rows that can never count.
 */

'use strict';

// Same isolation the sibling onsite suites use: audit-onsite-service pulls in
// the status writer / CAR deadline / audit-logger chain at module load, none of
// which this file exercises.
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../../services/car-deadline-service', () => ({
    computeCarDueDate: jest.fn(() => new Date('2026-09-01T00:00:00.000Z')),
    seedCarRevisionDeadline: jest.fn(async () => ({})),
}));
jest.mock('../../middleware/audit-logger', () => ({
    statusTransitionAuditHook: () => (async () => {}),
}));
jest.mock('../../shared/logger', () => {
    const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return Object.assign(l, { createLogger: () => l, default: l });
});

const onsite = require('../../services/audit-onsite-service');
const { assertOnsiteEvidenceSufficient } = require('../../services/onsite-evidence-gate');

const MIN_PHOTOS = onsite.DEFAULT_MIN_PHOTOS;
const ITEM_COUNT = onsite.CHECKLIST_TEMPLATE_2026.length;
const AUDITOR = 'auditor-A';
const ORG = 'org-1';

const AUDIT_A = { id: 'audit-A', applicationId: 'app-A', auditorId: AUDITOR, organizationId: ORG, status: 'IN_PROGRESS', isDeleted: false };
const AUDIT_B = { id: 'audit-B', applicationId: 'app-B', auditorId: AUDITOR, organizationId: ORG, status: 'IN_PROGRESS', isDeleted: false };

/**
 * In-memory FarmAuditPhoto store shaped like the delegate methods both halves
 * call: findMany (the gate), findFirst with the insensitive-equals filter (the
 * duplicate check), create, count.
 */
function makePrisma({ audits = [AUDIT_A], photos = [] } = {}) {
    const rows = photos.map((p, i) => ({ id: p.id || `seed-${i + 1}`, ...p }));
    let seq = rows.length;
    const prisma = {
        auditChecklist: {
            findFirst: jest.fn(async ({ where }) => {
                const hit = audits.find((a) => a.id === where.id) || null;
                if (!hit) { return null; }
                if (where.isDeleted === false && hit.isDeleted) { return null; }
                return hit;
            }),
        },
        farmAuditPhoto: {
            findMany: jest.fn(async ({ where }) => rows
                .filter((r) => r.auditId === where.auditId)
                .map((r) => ({ fileHash: r.fileHash }))),
            findFirst: jest.fn(async ({ where }) => {
                const wanted = (where.fileHash && typeof where.fileHash === 'object')
                    ? where.fileHash.equals
                    : where.fileHash;
                const insensitive = where.fileHash?.mode === 'insensitive';
                const norm = (v) => (insensitive ? String(v).toLowerCase() : String(v));
                const hit = rows.find((r) => r.auditId === where.auditId && norm(r.fileHash) === norm(wanted));
                return hit ? { id: hit.id } : null;
            }),
            count: jest.fn(async ({ where }) => rows.filter((r) => r.auditId === where.auditId).length),
            create: jest.fn(async ({ data }) => {
                seq += 1;
                const row = { id: `photo-${seq}`, ...data };
                rows.push(row);
                return row;
            }),
            update: jest.fn(async () => ({})),
        },
        farmAuditChecklistItem: {
            count: jest.fn(async () => ITEM_COUNT),
            findFirst: jest.fn(async () => null),
        },
    };
    return { prisma, rows };
}

function photoRow(auditId, fileHash, id) {
    return { id, auditId, fileHash, organizationId: ORG };
}

function attachmentStub() {
    return { attach: jest.fn(async () => ({ id: 'att-1', fileUrl: '/uploads/audits/a/1.jpg' })) };
}

function uploadArgs(overrides = {}) {
    return {
        auditId: AUDIT_A.id,
        fileBuffer: Buffer.from('the drying room'),
        fileName: 'drying-room.jpg',
        gpsLat: 13.7563,
        gpsLng: 100.5018,
        capturedAt: new Date('2026-08-26T03:00:00.000Z'),
        uploadedBy: AUDITOR,
        organizationId: ORG,
        ...overrides,
    };
}

describe('onsite-evidence-gate — the photo minimum counts distinct photographs', () => {
    test(`${MIN_PHOTOS} copies of ONE photograph do not satisfy a minimum of ${MIN_PHOTOS}`, async () => {
        const sameHash = onsite.computePhotoHash(Buffer.from('one photograph'));
        const { prisma } = makePrisma({
            photos: Array.from({ length: MIN_PHOTOS }, (_, i) => photoRow(AUDIT_A.id, sameHash, `dup-${i + 1}`)),
        });

        await expect(assertOnsiteEvidenceSufficient({ prisma, applicationId: AUDIT_A.applicationId, auditId: AUDIT_A.id }))
            .rejects.toMatchObject({ code: 'INSUFFICIENT_PHOTOS' });
    });

    test(`${MIN_PHOTOS} genuinely different photographs DO satisfy the minimum`, async () => {
        const { prisma } = makePrisma({
            photos: Array.from({ length: MIN_PHOTOS }, (_, i) => photoRow(
                AUDIT_A.id,
                onsite.computePhotoHash(Buffer.from(`section ${i}`)),
                `p-${i + 1}`,
            )),
        });

        await expect(assertOnsiteEvidenceSufficient({ prisma, applicationId: AUDIT_A.applicationId, auditId: AUDIT_A.id }))
            .resolves.toEqual({ auditId: AUDIT_A.id, photoCount: MIN_PHOTOS, itemCount: ITEM_COUNT });
    });

    test('a row with an empty or missing fileHash counts as zero, not as one (fail closed)', async () => {
        const photos = Array.from({ length: MIN_PHOTOS - 1 }, (_, i) => photoRow(
            AUDIT_A.id,
            onsite.computePhotoHash(Buffer.from(`section ${i}`)),
            `p-${i + 1}`,
        ));
        photos.push(photoRow(AUDIT_A.id, '   ', 'blank-hash'));
        photos.push(photoRow(AUDIT_A.id, null, 'null-hash'));
        const { prisma } = makePrisma({ photos });

        // MIN_PHOTOS + 1 rows, but only MIN_PHOTOS - 1 identifiable photographs.
        await expect(assertOnsiteEvidenceSufficient({ prisma, applicationId: AUDIT_A.applicationId, auditId: AUDIT_A.id }))
            .rejects.toMatchObject({ code: 'INSUFFICIENT_PHOTOS' });
    });

    test('the same digest recorded in a different letter case counts once', async () => {
        const shared = onsite.computePhotoHash(Buffer.from('one photograph'));
        // MIN_PHOTOS rows, of which two are the same photograph in different
        // case: MIN_PHOTOS - 1 distinct photographs, one short of the minimum.
        const photos = Array.from({ length: MIN_PHOTOS - 2 }, (_, i) => photoRow(
            AUDIT_A.id,
            onsite.computePhotoHash(Buffer.from(`section ${i}`)),
            `p-${i + 1}`,
        ));
        photos.push(photoRow(AUDIT_A.id, shared, 'lower'));
        photos.push(photoRow(AUDIT_A.id, shared.toUpperCase(), 'upper'));
        const { prisma } = makePrisma({ photos });

        await expect(assertOnsiteEvidenceSufficient({ prisma, applicationId: AUDIT_A.applicationId, auditId: AUDIT_A.id }))
            .rejects.toMatchObject({ code: 'INSUFFICIENT_PHOTOS' });
    });

    test('photographs recorded on another audit do not count toward this one', async () => {
        const photos = Array.from({ length: MIN_PHOTOS }, (_, i) => photoRow(
            AUDIT_A.id,
            onsite.computePhotoHash(Buffer.from(`section ${i}`)),
            `a-${i + 1}`,
        ));
        photos.push(photoRow(AUDIT_B.id, onsite.computePhotoHash(Buffer.from('b only')), 'b-1'));
        const { prisma } = makePrisma({ audits: [AUDIT_A, AUDIT_B], photos });

        await expect(assertOnsiteEvidenceSufficient({ prisma, applicationId: AUDIT_A.applicationId, auditId: AUDIT_A.id }))
            .resolves.toMatchObject({ auditId: AUDIT_A.id, photoCount: MIN_PHOTOS });
        await expect(assertOnsiteEvidenceSufficient({ prisma, applicationId: AUDIT_B.applicationId, auditId: AUDIT_B.id }))
            .rejects.toMatchObject({ code: 'INSUFFICIENT_PHOTOS' });
    });
});

describe('uploadPhoto — the same bytes are refused at the door', () => {
    test('a second upload of the same bytes is refused with the Thai message', async () => {
        const { prisma } = makePrisma();
        const attachmentService = attachmentStub();

        const first = await onsite.uploadPhoto(uploadArgs({ prisma, attachmentService }));
        expect(first.photoId).toBeTruthy();

        const err = await onsite.uploadPhoto(uploadArgs({ prisma, attachmentService })).catch((e) => e);
        expect(err).toMatchObject({ code: 'DUPLICATE_PHOTO', statusCode: 409, existingPhotoId: first.photoId });
        expect(err.message).toContain('รูปนี้ถูกอัปโหลดไว้แล้ว');
        expect(err.message).toContain('คุณ');
        expect(err.message).not.toContain('—'); // thai-ui-copy: no em dash

        // Refused BEFORE storage: no second file, no second row.
        expect(attachmentService.attach).toHaveBeenCalledTimes(1);
        expect(prisma.farmAuditPhoto.create).toHaveBeenCalledTimes(1);
    });

    test('the duplicate message survives the route sanitizer instead of becoming a generic English fallback', async () => {
        // routes/api/audit/onsite.js hands err.message to safeErrorMessage(),
        // which drops any message carrying no known-safe English phrase.
        const { safeErrorMessage } = require('../../shared/api-response');
        const { prisma } = makePrisma();
        const attachmentService = attachmentStub();

        await onsite.uploadPhoto(uploadArgs({ prisma, attachmentService }));
        const err = await onsite.uploadPhoto(uploadArgs({ prisma, attachmentService })).catch((e) => e);

        expect(safeErrorMessage(err)).toContain('รูปนี้ถูกอัปโหลดไว้แล้ว');
    });

    test('the same bytes are refused even when offered for a DIFFERENT checklist item', async () => {
        // checklistItemId is a single nullable FK, so one photo row already
        // belongs to at most one item; and a photograph of one place is not
        // evidence of another section. Re-use is a link, not a second upload.
        const { prisma } = makePrisma();
        const attachmentService = attachmentStub();

        await onsite.uploadPhoto(uploadArgs({ prisma, attachmentService, checklistItemCode: '4.1' }));

        await expect(onsite.uploadPhoto(uploadArgs({ prisma, attachmentService, checklistItemCode: '7.1' })))
            .rejects.toMatchObject({ code: 'DUPLICATE_PHOTO' });
        expect(prisma.farmAuditPhoto.create).toHaveBeenCalledTimes(1);
    });

    test('genuinely different bytes are accepted', async () => {
        const { prisma } = makePrisma();
        const attachmentService = attachmentStub();

        const first = await onsite.uploadPhoto(uploadArgs({ prisma, attachmentService }));
        const second = await onsite.uploadPhoto(uploadArgs({
            prisma,
            attachmentService,
            fileBuffer: Buffer.from('the storage room'),
            fileName: 'storage-room.jpg',
        }));

        expect(second.photoId).not.toBe(first.photoId);
        expect(second.fileHash).not.toBe(first.fileHash);
        expect(prisma.farmAuditPhoto.create).toHaveBeenCalledTimes(2);
    });

    test('the same bytes on a DIFFERENT audit are accepted (audits do not interfere)', async () => {
        const { prisma } = makePrisma({ audits: [AUDIT_A, AUDIT_B] });
        const attachmentService = attachmentStub();

        await onsite.uploadPhoto(uploadArgs({ prisma, attachmentService }));
        await expect(onsite.uploadPhoto(uploadArgs({ prisma, attachmentService, auditId: AUDIT_B.id })))
            .resolves.toMatchObject({ photoId: expect.any(String) });
        expect(prisma.farmAuditPhoto.create).toHaveBeenCalledTimes(2);
    });
});
