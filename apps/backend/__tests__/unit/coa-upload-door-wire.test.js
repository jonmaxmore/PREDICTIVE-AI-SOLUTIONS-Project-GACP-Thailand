/**
 * The COA door on the wire — ownership, refusals, and what it stores.
 *
 * Driven through express so the middleware order is exercised, not just the pure
 * helpers: a caller who owns nothing must be refused BEFORE anything is written,
 * and a refused file must leave no row behind pointing at bytes nobody vouched for.
 */
'use strict';

const mockBatchFindUnique = jest.fn();
const mockLabCreate = jest.fn(async ({ data }) => ({ id: 'lab-1', ...data }));
const mockLabFindMany = jest.fn(async () => []);
const mockListFarmIds = jest.fn(async () => ['farm-1']);
const mockInspect = jest.fn(async () => ({ ok: true }));
const mockDiscard = jest.fn(async () => {});
const mockAssertFarmAction = jest.fn(async () => undefined);

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        harvestBatch: { findUnique: (...a) => mockBatchFindUnique(...a) },
        batchLabResult: { create: (...a) => mockLabCreate(...a), findMany: (...a) => mockLabFindMany(...a) },
    },
}));
jest.mock('../../services/farm-service', () => ({ listAccessibleFarmIds: (...a) => mockListFarmIds(...a) }));
jest.mock('../../services/upload-content-guard', () => ({
    inspectStoredUpload: (...a) => mockInspect(...a),
    discardRejectedUpload: (...a) => mockDiscard(...a),
}));
jest.mock('../../services/entity-effective-permissions-service', () => ({
    assertFarmActionPermission: (...a) => mockAssertFarmAction(...a),
}));
jest.mock('../../services/harvest-service', () => ({}));
jest.mock('../../services/qrcode/qrcode-service', () => ({}));
jest.mock('../../shared/logger', () => {
    const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...l, createLogger: () => l };
});
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => { req.user = global.__TEST_USER__; next(); },
}));
// The file arrives already stored by multer; stub the uploader so no disk is touched.
jest.mock('../../services/storage-service', () => ({
    createUploader: () => ({
        single: () => (req, _res, next) => {
            if (global.__TEST_UPLOAD_ERROR__) { next(global.__TEST_UPLOAD_ERROR__); return; }
            req.file = global.__TEST_FILE__ || undefined;
            req.body = { ...(global.__TEST_BODY__ || {}) };
            next();
        },
    }),
}));

const express = require('express');
const request = require('supertest');

function app() {
    const a = express();
    a.use(express.json());
    a.use('/harvest-batches', require('../../routes/api/cultivation/harvest-batches'));
    return a;
}

const BATCH = { id: 'hb-1', farmId: 'farm-1', organizationId: 'org-1', isDeleted: false };
const FILE = { originalname: 'coa.pdf', filename: 'stored.pdf', path: '/tmp/stored.pdf', size: 40960, mimetype: 'application/pdf' };

beforeEach(() => {
    jest.clearAllMocks();
    global.__TEST_USER__ = { id: 'user-1', role: 'health' };
    global.__TEST_FILE__ = FILE;
    global.__TEST_BODY__ = { labName: 'ห้องปฏิบัติการกลาง' };
    global.__TEST_UPLOAD_ERROR__ = null;
    mockBatchFindUnique.mockResolvedValue(BATCH);
    mockListFarmIds.mockResolvedValue(['farm-1']);
    mockInspect.mockResolvedValue({ ok: true });
    mockAssertFarmAction.mockResolvedValue(undefined);
});

describe('POST /harvest-batches/:id/lab-results', () => {
    test('the owner can attach a COA', async () => {
        const res = await request(app()).post('/harvest-batches/hb-1/lab-results').expect(201);
        expect(res.body.success).toBe(true);
        expect(mockLabCreate).toHaveBeenCalled();
        expect(mockLabCreate.mock.calls[0][0].data).toMatchObject({
            harvestBatchId: 'hb-1', organizationId: 'org-1', verificationStatus: 'FARMER_UPLOADED',
        });
    });

    test("someone else's batch is 403 and writes NOTHING", async () => {
        mockListFarmIds.mockResolvedValue(['farm-other']);
        await request(app()).post('/harvest-batches/hb-1/lab-results').expect(403);
        expect(mockLabCreate).not.toHaveBeenCalled();
    });

    // A VIEWER passes listAccessibleFarmIds (it counts every ACTIVE member), so the
    // farm list alone let a VIEWER attach a public COA (201). Attaching is a write:
    // the same HARVEST_RECORD gate as the sibling write doors of this router.
    test('a member without HARVEST_RECORD (VIEWER) is 403 ENTITY_PERMISSION_DENIED, no row, no bytes', async () => {
        mockAssertFarmAction.mockRejectedValue(Object.assign(new Error('denied'), {
            code: 'ENTITY_PERMISSION_DENIED', permission: 'HARVEST_RECORD',
        }));
        const res = await request(app()).post('/harvest-batches/hb-1/lab-results').expect(403);
        expect(res.body).toMatchObject({ success: false, code: 'ENTITY_PERMISSION_DENIED', permission: 'HARVEST_RECORD' });
        expect(mockAssertFarmAction).toHaveBeenCalledWith(expect.objectContaining({ farmId: 'farm-1', userId: 'user-1', permission: 'HARVEST_RECORD' }));
        expect(mockLabCreate).not.toHaveBeenCalled();
        expect(mockDiscard).toHaveBeenCalledWith(FILE);
    });

    test('a missing batch is 404, not a row against a ghost', async () => {
        mockBatchFindUnique.mockResolvedValue(null);
        await request(app()).post('/harvest-batches/hb-1/lab-results').expect(404);
        expect(mockLabCreate).not.toHaveBeenCalled();
    });

    // ─── the bytes, not just the row ──────────────────────────────────────────
    //
    // multer has already written the file to disk by the time this handler runs,
    // and `lab-results/` is one of the few upload folders served to anyone with
    // the URL (middleware/uploads-access.js: not root/slip/draft/car/audit ⇒
    // `sensitive: false`). Every refusal BELOW these two already discards. These
    // two did not, so a refused upload stayed on a public mount referenced by no
    // row — which also puts it out of reach of the PDPA retention sweep, because
    // that sweep walks rows.
    //
    // "writes NOTHING" above means no database row. It has to mean no file too.
    test("someone else's batch leaves no bytes behind either", async () => {
        mockListFarmIds.mockResolvedValue(['farm-other']);
        await request(app()).post('/harvest-batches/hb-1/lab-results').expect(403);
        expect(mockDiscard).toHaveBeenCalledWith(FILE);
    });

    test('a missing batch leaves no bytes behind either', async () => {
        mockBatchFindUnique.mockResolvedValue(null);
        await request(app()).post('/harvest-batches/hb-1/lab-results').expect(404);
        expect(mockDiscard).toHaveBeenCalledWith(FILE);
    });

    test('a caller with no identity leaves no bytes behind either', async () => {
        global.__TEST_USER__ = {};
        await request(app()).post('/harvest-batches/hb-1/lab-results').expect(401);
        expect(mockLabCreate).not.toHaveBeenCalled();
        expect(mockDiscard).toHaveBeenCalledWith(FILE);
    });

    test('a file multer aborted for size is 413 FILE_TOO_LARGE in Thai, and nothing is written', async () => {
        const { MulterError } = jest.requireActual('multer');
        global.__TEST_UPLOAD_ERROR__ = new MulterError('LIMIT_FILE_SIZE', 'file');

        const res = await request(app()).post('/harvest-batches/hb-1/lab-results');

        expect(res.status).toBe(413);
        expect(res.body.code).toBe('FILE_TOO_LARGE');
        expect(res.body.error).toContain('20 MB');
        expect(res.body.error).toContain('คุณสามารถ');
        expect(mockLabCreate).not.toHaveBeenCalled();
    });

    test('no lab name is refused in Thai and the stored bytes are discarded', async () => {
        global.__TEST_BODY__ = { labName: '  ' };
        const res = await request(app()).post('/harvest-batches/hb-1/lab-results').expect(400);
        expect(res.body.code).toBe('LAB_NAME_REQUIRED');
        expect(res.body.messageTh).toMatch(/[ก-๙]/);
        // A refused upload must leave nothing behind for a later read to find.
        expect(mockDiscard).toHaveBeenCalled();
        expect(mockLabCreate).not.toHaveBeenCalled();
    });

    test('a file the content guard refuses is discarded, and no row is written', async () => {
        mockInspect.mockResolvedValue({ ok: false, code: 'FILE_EMPTY', message: 'ไฟล์ว่าง' });
        await request(app()).post('/harvest-batches/hb-1/lab-results').expect(400);
        expect(mockDiscard).toHaveBeenCalled();
        expect(mockLabCreate).not.toHaveBeenCalled();
    });

    test('the row never carries a caller-supplied tenant', async () => {
        global.__TEST_BODY__ = { labName: 'ก', organizationId: 'org-someone-else' };
        await request(app()).post('/harvest-batches/hb-1/lab-results').expect(201);
        expect(mockLabCreate.mock.calls[0][0].data.organizationId).toBe('org-1');
    });
});

describe('GET /harvest-batches/:id/lab-results', () => {
    test('lists the batch\'s reports, newest first', async () => {
        await request(app()).get('/harvest-batches/hb-1/lab-results').expect(200);
        expect(mockLabFindMany.mock.calls[0][0]).toMatchObject({
            where: { harvestBatchId: 'hb-1', isDeleted: false },
            orderBy: { uploadedAt: 'desc' },
        });
    });

    test("another farmer's batch is 403", async () => {
        mockListFarmIds.mockResolvedValue(['farm-other']);
        await request(app()).get('/harvest-batches/hb-1/lab-results').expect(403);
        expect(mockLabFindMany).not.toHaveBeenCalled();
    });
});
