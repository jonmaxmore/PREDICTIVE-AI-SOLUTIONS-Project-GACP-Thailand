'use strict';

/**
 * BACK-02 + BACK-X01 (audit 2026-09-17) — สองประตูแก้ไขรุ่นเก็บเกี่ยว วัดจาก router จริง
 * กับ harvest-service จริง มีแค่ฐานข้อมูลที่เป็นของปลอม
 *
 * BACK-02: PUT /api/harvest-batches/:id ส่ง req.body ทั้งก้อนเข้า prisma.harvestBatch.update
 * โดยตัดทิ้งเฉพาะรายชื่อ "ห้าม" ซึ่งไม่มี labResults · เกษตรกรจึงส่ง
 *   { labResults: { updateMany: { where: {}, data: { verificationStatus: 'OFFICER_VERIFIED' } } } }
 * แล้วคำเตือน "เกษตรกรเป็นผู้แนบ ยังไม่ได้ผ่านการตรวจสอบโดยเจ้าหน้าที่" บนหน้าสแกนสาธารณะหายไป
 * หรือ deleteMany ลบประวัติ COA ที่โมเดลบอกว่าต้องไม่หาย หรือ create แนบไฟล์โดยไม่ผ่านด่านไฟล์
 * รวมถึงตั้ง qcPassed / qcBy (ผลตรวจคุณภาพของเจ้าหน้าที่) เองได้
 * ⇒ ต้องเป็นรายชื่อ "อนุญาต" ช่องอื่นทั้งหมดปฏิเสธ 400 และไม่เขียนอะไรเลย
 *
 * BACK-X01: POST /api/harvest-batches/:id/harvest เขียน freshWeight และ harvestDate
 * โดยไม่ดูว่ามีล็อตบรรจุออกไปแล้วหรือยัง — ประตูข้าง ๆ ของกฎ "แช่แข็งน้ำหนักเมื่อบรรจุแล้ว"
 * (FROZEN_ONCE_PACKED) ⇒ ยกเพดานโควตาน้ำหนักแล้วออก QR เพิ่มได้ = เส้นทางฟอกของที่การแช่แข็งปิดไว้
 *
 * เรียก router.handle() ตรง ๆ ไม่เปิด server (ดู password-reset-routes-behaviour.test.js)
 */

const mockBatchFindUnique = jest.fn();
const mockBatchUpdate = jest.fn();
const mockLotCount = jest.fn();
const mockLabWrite = jest.fn();

jest.mock('../../services/prisma-database', () => {
    const prisma = {
        harvestBatch: {
            findUnique: (...a) => mockBatchFindUnique(...a),
            update: (...a) => mockBatchUpdate(...a),
        },
        lot: { count: (...a) => mockLotCount(...a) },
        batchLabResult: {
            create: (...a) => mockLabWrite('create', ...a),
            update: (...a) => mockLabWrite('update', ...a),
            updateMany: (...a) => mockLabWrite('updateMany', ...a),
            deleteMany: (...a) => mockLabWrite('deleteMany', ...a),
        },
        // the batch row lock both doors take (harvest-freeze-holds-the-lot-lock.test.js)
        $queryRaw: async () => [{ id: 'hb-1' }],
    };
    prisma.$transaction = (fn) => fn(prisma);
    return { prisma };
});
jest.mock('../../shared/logger', () => {
    const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...l, createLogger: () => l };
});
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => { req.user = { id: 'farmer-1', role: 'health' }; next(); },
}));
jest.mock('../../services/farm-service', () => ({
    listAccessibleFarmIds: async () => ['farm-1'],
}));
jest.mock('../../services/entity-effective-permissions-service', () => ({
    assertFarmActionPermission: async () => ({ allowed: true }),
}));
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn() },
    AuditCategory: {}, AuditSeverity: {}, ResourceType: {},
}));
// ไม่ได้อยู่ในสิ่งที่ทดสอบ — กันไม่ให้โหลด router แล้วไปแตะดิสก์/ที่เก็บไฟล์
jest.mock('../../services/storage-service', () => ({
    createUploader: () => ({ single: () => (_req, _res, next) => next() }),
}));
jest.mock('../../services/upload-content-guard', () => ({}));
jest.mock('../../services/qrcode/qrcode-service', () => ({}));

const router = require('../../routes/api/cultivation/harvest-batches');

function callRouter(method, url, body) {
    return new Promise((resolve, reject) => {
        const req = {
            method, url, originalUrl: url, baseUrl: '', path: url,
            body, headers: {}, params: {}, query: {}, cookies: {},
            get: () => undefined, header: () => undefined,
        };
        const res = {
            statusCode: 200,
            headersSent: false,
            locals: {},
            status(code) { this.statusCode = code; return this; },
            set() { return this; },
            setHeader() { return this; },
            getHeader() { return undefined; },
            json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
            send(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
            end() { resolve({ status: this.statusCode, body: undefined }); return this; },
        };
        router.handle(req, res, (err) => reject(err || new Error(`no route for ${method} ${url}`)));
    });
}

const BATCH = {
    id: 'hb-1', farmId: 'farm-1', organizationId: 'org-1', status: 'RECEIVED',
    freshWeight: 100, dryWeight: null, harvestDate: new Date('2026-08-01T00:00:00.000Z'),
    notes: 'เดิม', isDeleted: false,
};

beforeEach(() => {
    jest.clearAllMocks();
    mockBatchFindUnique.mockResolvedValue({ ...BATCH });
    mockBatchUpdate.mockImplementation(async ({ data }) => ({ ...BATCH, ...data }));
    mockLotCount.mockResolvedValue(0);
});

function expectNothingWritten() {
    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(mockLabWrite).not.toHaveBeenCalled();
}

describe('BACK-02 — PUT /:id writes only what a farmer may edit', () => {
    it.each([
        ['forge officer verification', { updateMany: { where: {}, data: { verificationStatus: 'OFFICER_VERIFIED' } } }],
        ['erase COA history', { deleteMany: {} }],
        ['attach a file past the upload guard', { create: { fileUrl: 'https://evil.example/coa.pdf', labName: 'x', organizationId: 'org-1' } }],
        ['re-point another batch\'s COA', { connect: { id: 'lab-of-another-batch' } }],
    ])('a nested labResults write (%s) is refused 400 and nothing is written', async (_label, nested) => {
        const res = await callRouter('PUT', '/hb-1', { notes: 'แก้หมายเหตุ', labResults: nested });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe('HARVEST_BATCH_FIELD_NOT_EDITABLE');
        expect(res.body.fields).toEqual(['labResults']);
        expect(res.body.messageTh).toMatch(/[ก-๙]/);
        expectNothingWritten();
    });

    it.each([
        // ผลตรวจคุณภาพ — ของเจ้าหน้าที่ ไม่ใช่ของเกษตรกร
        'qcPassed', 'qcBy', 'qcNotes',
        // ตัวตน / เจ้าของ / tenant / audit — เดิมถูกตัดทิ้งเงียบ ๆ ตอนนี้ต้องปฏิเสธเสียงดัง
        'id', 'uuid', 'batchNumber', 'qrCode', 'trackingUrl', 'farmId', 'cycleId', 'plantCode',
        'organizationId', 'recordedBy', 'isDeleted', 'createdAt', 'updatedAt',
        // ความสัมพันธ์อื่น
        'farm', 'cycle', 'plant', 'organization', 'lots', 'packagingDetails', 'dryingProcesses',
        // ไม่ใช่คอลัมน์ของรุ่นเลย
        'plantingDate', 'expectedHarvestDate', 'somethingElse',
    ])('non-allowlisted field %s is refused 400 and nothing is written', async (field) => {
        const res = await callRouter('PUT', '/hb-1', { notes: 'แก้หมายเหตุ', [field]: true });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('HARVEST_BATCH_FIELD_NOT_EDITABLE');
        expect(res.body.fields).toEqual([field]);
        expectNothingWritten();
    });

    it('an object value on an editable field (prisma atomic op / nested input) is refused', async () => {
        const res = await callRouter('PUT', '/hb-1', { freshWeight: { increment: 1000 } });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('HARVEST_BATCH_FIELD_NOT_EDITABLE');
        expect(res.body.fields).toEqual(['freshWeight']);
        expectNothingWritten();
    });

    it('status is a closed set — an invented status is refused 400', async () => {
        const res = await callRouter('PUT', '/hb-1', { status: 'CERTIFIED_BY_DTAM' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INVALID_HARVEST_BATCH_STATUS');
        expect(res.body.fields).toEqual(['status']);
        expectNothingWritten();
    });

    it('the farmer-editable fields still save, and only those reach the database', async () => {
        const body = {
            harvestDate: '2026-08-02T00:00:00.000Z',
            freshWeight: 120,
            dryWeight: 48.5,
            lossWeight: 2,
            moistureContent: 11,
            qualityGrade: 'A',
            isDried: true,
            dryingMethod: 'SUN_DRY',
            dryingTemp: 45,
            dryingDuration: 72,
            status: 'DRYING',
            notes: 'ตากต่ออีกสองวัน',
        };
        const res = await callRouter('PUT', '/hb-1', body);

        expect(res.status).toBe(200);
        expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
        const { where, data } = mockBatchUpdate.mock.calls[0][0];
        expect(where).toEqual({ id: 'hb-1' });
        expect(data).toEqual({ ...body, harvestDate: new Date(body.harvestDate) });
    });

    it('the existing freeze still answers 409 on this door once lots exist', async () => {
        mockLotCount.mockResolvedValue(1);
        const res = await callRouter('PUT', '/hb-1', { dryWeight: 500 });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('HARVEST_FROZEN_AFTER_PACKING');
        expectNothingWritten();
    });
});

describe('BACK-X01 — POST /:id/harvest obeys the same freeze once lots exist', () => {
    it('a harvest weight change after a lot was issued is refused 409 and nothing is written', async () => {
        mockLotCount.mockResolvedValue(1);
        const res = await callRouter('POST', '/hb-1/harvest', { actualYield: '900' });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('HARVEST_FROZEN_AFTER_PACKING');
        expect(res.body.fields).toEqual(expect.arrayContaining(['freshWeight']));
        expect(res.body.messageTh).toMatch(/[ก-๙]/);
        expect(mockLotCount).toHaveBeenCalledWith({ where: { batchId: 'hb-1' } });
        expectNothingWritten();
    });

    it('it cannot move the frozen harvest date either — explicitly or by defaulting to now', async () => {
        mockLotCount.mockResolvedValue(2);

        const explicit = await callRouter('POST', '/hb-1/harvest', { harvestDate: '2029-01-01T00:00:00.000Z' });
        expect(explicit.status).toBe(409);
        expect(explicit.body.fields).toEqual(['harvestDate']);

        // a note only, so the defaulted date is the one frozen field this call writes
        // (qualityGrade is frozen too since harvest-lock)
        const defaulted = await callRouter('POST', '/hb-1/harvest', { notes: 'เก็บเกี่ยวแล้ว' });
        expect(defaulted.status).toBe(409);
        expect(defaulted.body.fields).toEqual(['harvestDate']);

        expectNothingWritten();
    });

    it('before any lot exists the door still records the harvest', async () => {
        mockLotCount.mockResolvedValue(0);
        const res = await callRouter('POST', '/hb-1/harvest', {
            actualYield: '12.5', qualityGrade: 'A', harvestDate: '2026-08-03T00:00:00.000Z',
        });

        expect(res.status).toBe(200);
        expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
        const { data } = mockBatchUpdate.mock.calls[0][0];
        expect(data.freshWeight).toBe(12.5);
        expect(data.harvestDate).toEqual(new Date('2026-08-03T00:00:00.000Z'));
        expect(data.status).toBe('HARVESTED');
    });
});
