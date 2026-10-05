'use strict';

/**
 * harvest-lock (a) — ช่องของรุ่นที่หน้าสแกนสาธารณะแสดง ต้องถูกแช่แข็งเมื่อมีล็อตแล้ว
 *
 * 9f4b61f5 แช่แข็งน้ำหนักกับวันเก็บเกี่ยว (FROZEN_ONCE_PACKED) เพราะเป็นเพดานโควตาล็อต
 * แต่ qualityGrade ยังแก้ผ่าน PUT /api/harvest-batches/:id ได้หลังออกล็อตแล้ว ทั้งที่
 * /api/trace/:qr แสดงมันให้คนสแกน (trace-service/resolve-generic.js กิ่ง HARVEST_BATCH
 * `qualityGrade` และกิ่ง PLANTING_CYCLE `harvests[].grade`) · ผู้ซื้อที่ถือถุงอยู่จะเห็น
 * "เกรด A" กลายเป็นอย่างอื่นใต้มือ ทั้งที่ของในถุงไม่ได้เปลี่ยน
 *
 * ช่องไหน "ขึ้นหน้าสแกน" ไม่เดา: เทสนี้ป้อนแถวรุ่นสองแถวที่ต่างกันแค่ช่องเดียวให้ประตูสแกน
 * สาธารณะตัวจริงทั้งห้าทาง (resolver ทั่วไปสามกิ่ง + /batch/:id + /lot/:id) ถ้าคำตอบต่างกัน
 * ช่องนั้นคือช่องที่คนสแกนเห็น แล้วตรวจว่าประตู PUT ปฏิเสธมันจริงเมื่อมีล็อตแล้ว ·
 * ถ้าวันหนึ่งหน้าสแกนเริ่มแสดงความชื้นหรือวิธีตาก เทสนี้แดงเองจนกว่าจะถูกแช่แข็งด้วย
 *
 * ข้อยกเว้นเดียวคือ status — สถานะวงจรชีวิตของรุ่น (PACKED → SOLD เกิด *หลัง* บรรจุ
 * เสมอ) ไม่ใช่คำกล่าวอ้างเรื่องตัวผลผลิต แช่แข็งแล้วเกษตรกรปิดการขายไม่ได้
 *
 * ขอบเขตที่ตั้งใจไม่รวม: resolve-plot-cycle.js ไม่ *แสดง* ช่องใดของรุ่น แต่ใช้ notes
 * (PLOT_HARVEST_META) เลือกว่ารุ่นไหนอยู่ใต้แปลง — เรื่องนั้นแยกไว้เป็นคำถามเปิด
 *
 * เรียก router.handle() ตรง ๆ ไม่เปิด server (เหมือน harvest-batch-update-is-an-allowlist)
 */

const mockState = { batch: null, lotCount: 0, writes: [], trace: {} };

jest.mock('../../services/prisma-database', () => {
    const client = {
        harvestBatch: {
            findUnique: async () => (mockState.batch ? { ...mockState.batch } : null),
            findFirst: async () => mockState.trace.batch || null,
            update: async (args) => {
                mockState.writes.push(args);
                return { ...mockState.batch, ...args.data };
            },
        },
        plantingCycle: { findFirst: async () => mockState.trace.cycle || null },
        lot: {
            count: async () => mockState.lotCount,
            findFirst: async () => mockState.trace.lot || null,
        },
        $queryRaw: async () => (mockState.batch ? [{ id: mockState.batch.id }] : []),
    };
    // interactive transaction: the callback gets a client of the same shape
    client.$transaction = async (fn) => fn(client);
    return { prisma: client };
});
jest.mock('../../server', () => ({}));
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
jest.mock('../../services/storage-service', () => ({
    createUploader: () => ({ single: () => (_req, _res, next) => next() }),
}));
jest.mock('../../services/upload-content-guard', () => ({}));
jest.mock('../../services/qrcode/qrcode-service', () => ({
    verifyTraceIntegrity: async () => ({ available: false }),
    recordTraceScan: async () => ({ available: false, valid: null }),
}));
jest.mock('../../services/traceability-service', () => ({
    findPublicBatchByAnyIdentifier: async () => mockState.trace.publicBatch || null,
    findPublicLotByAnyIdentifier: async () => mockState.trace.publicLot || null,
    findFarmLabResultMarkers: async () => [],
}));

const router = require('../../routes/api/cultivation/harvest-batches');
const common = require('../../services/trace-service/common');
const { resolveTraceByGenericQr } = require('../../services/trace-service/resolve-generic');
const { registerBatchAndLotRoutes } = require('../../routes/api/trace/trace-batch-lot-routes');

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

// Every field PUT /:id accepts (harvest-service FARMER_EDITABLE_BATCH_FIELDS), each
// with two different plain values: [what the batch holds, what an edit sends].
const EDITABLE = {
    harvestDate: [new Date('2026-08-01T00:00:00.000Z'), '2026-08-09T00:00:00.000Z'],
    freshWeight: [100, 140],
    dryWeight: [40, 55],
    lossWeight: [2, 6],
    moistureContent: [11, 9],
    qualityGrade: ['A', 'B'],
    isDried: [true, false],
    dryingMethod: ['SUN_DRY', 'OVEN'],
    dryingTemp: [45, 60],
    dryingDuration: [72, 24],
    status: ['PACKED', 'SOLD'],
    notes: ['ตากครบแล้ว', 'แก้บันทึก'],
};
const QUOTA_FIELDS = ['freshWeight', 'dryWeight', 'lossWeight', 'harvestDate'];
// Lifecycle, not a claim about the produce — PACKED → SOLD happens after packing.
const LIFECYCLE_FIELDS = ['status'];

const FARM = { id: 'farm-1', farmName: 'สวนทดสอบ', farmType: 'OUTDOOR', district: 'อ', province: 'จ', status: 'ACTIVE' };
const PLANT = { code: 'CAN', nameTH: 'กัญชา', nameEN: 'Cannabis', scientificName: 'Cannabis sativa' };

function batchColumns(override = {}) {
    const row = {
        id: 'hb-1', batchNumber: 'BATCH-2569-000001', qrCode: 'QR-HB-1', farmId: 'farm-1',
        organizationId: 'org-1', cycleId: null, plantCode: 'CAN', isDeleted: false,
        plotName: 'แปลงเหนือ', plotArea: 400, areaUnit: 'sqm', cultivationType: 'OUTDOOR',
        seedSource: null, plantingDate: null, trackingUrl: null,
    };
    for (const [field, [held]] of Object.entries(EDITABLE)) { row[field] = held; }
    return { ...row, ...override };
}

const LOT = {
    id: 'lot-1', lotNumber: 'LOT-1-A', batchId: 'hb-1', qrCode: 'QR-LOT-1', packageType: 'BAG',
    quantity: 10, unitWeight: 1, totalWeight: 10, status: 'PACKAGED', packagedAt: null,
    expiryDate: null, trackingUrl: null,
};

function stripVolatile(value) {
    if (Array.isArray(value)) { return value.map(stripVolatile); }
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value)
            .filter(([k]) => k !== 'scannedAt')
            .map(([k, v]) => [k, stripVolatile(v)]));
    }
    return value;
}

const dedicated = (() => {
    const handlers = {};
    registerBatchAndLotRoutes({
        get(path, fn) {
            if (path === '/batch/:batchId') { handlers.batch = fn; }
            if (path === '/lot/:lotId') { handlers.lot = fn; }
        },
    }, {
        qrcodeService: { recordTraceScan: async () => ({ available: false, valid: null }) },
        logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
        getRequestIp: () => '127.0.0.1',
        buildIntegrityPayload: common.buildIntegrityPayload,
        logPublicTraceAccess: async () => undefined,
        TRACE_NOT_FOUND_MESSAGE: common.TRACE_NOT_FOUND_MESSAGE,
        formatThaiDate: common.formatThaiDate,
        SAFETY_DISCLAIMER: common.SAFETY_DISCLAIMER,
        FDA_REFERRAL: common.FDA_REFERRAL,
        evaluateCertGate: common.evaluateCertGate,
    });
    return handlers;
})();

async function callDedicated(name, params) {
    let status = 200;
    let body;
    const res = { status(c) { status = c; return res; }, json(b) { body = b; return res; } };
    const req = { params, originalUrl: `/api/trace/${name}`, get: () => undefined, headers: {} };
    await dedicated[name](req, res);
    return { status, body };
}

// What an anonymous scanner receives on each public door, given one batch row.
async function everyPublicAnswer(batch) {
    const answers = {};
    const ctx = { requestIp: '127.0.0.1', userAgent: 'jest' };

    mockState.trace = {
        cycle: {
            id: 'cyc-1', uuid: 'cyc-1', farmId: 'farm-1', farm: FARM, plantSpecies: PLANT,
            certificate: null, status: 'HARVESTED', cultivationType: 'OUTDOOR',
            cycleName: 'รอบ 1', cycleNumber: 1, startDate: null, batches: [batch],
        },
    };
    answers.genericCycle = await resolveTraceByGenericQr('cyc-1', ctx);

    mockState.trace = { batch: { ...batch, farm: FARM, plant: PLANT, cycle: null, lots: [] } };
    answers.genericBatch = await resolveTraceByGenericQr('QR-HB-1', ctx);

    const lotBatch = { ...batch, farm: FARM, plant: PLANT, cycle: null, labResults: [] };
    mockState.trace = { lot: { ...LOT, batch: lotBatch } };
    answers.genericLot = await resolveTraceByGenericQr('QR-LOT-1', ctx);

    mockState.trace = { publicBatch: { ...batch, farm: FARM, labResults: [], cycle: null, lots: [LOT] } };
    answers.batchRoute = await callDedicated('batch', { batchId: 'hb-1' });

    mockState.trace = { publicLot: { ...LOT, batch: lotBatch } };
    answers.lotRoute = await callDedicated('lot', { lotId: 'lot-1' });

    mockState.trace = {};
    return Object.fromEntries(Object.entries(answers).map(
        ([door, a]) => [door, { status: a.status, body: stripVolatile(JSON.parse(JSON.stringify(a.body))) }],
    ));
}

let publishedOnScan = [];

beforeAll(async () => {
    const base = await everyPublicAnswer(batchColumns());
    for (const answer of Object.values(base)) { expect(answer.status).toBe(200); }

    for (const [field, [, edited]] of Object.entries(EDITABLE)) {
        const value = field === 'harvestDate' ? new Date(edited) : edited;
        const changed = await everyPublicAnswer(batchColumns({ [field]: value }));
        const doors = Object.keys(base).filter(
            (door) => JSON.stringify(base[door]) !== JSON.stringify(changed[door]),
        );
        if (doors.length > 0) { publishedOnScan.push(field); }
    }
    publishedOnScan = publishedOnScan.sort();
});

beforeEach(() => {
    mockState.batch = batchColumns();
    mockState.lotCount = 0;
    mockState.writes = [];
});

describe('harvest-lock (a) — what the public scan shows stops moving once a lot exists', () => {
    it('the public doors show grade, harvest date, fresh weight and status — not moisture or drying', () => {
        // Measured, not assumed. If a door starts showing another field this list
        // changes on purpose, and the next test decides whether the freeze covers it.
        expect(publishedOnScan).toEqual(['freshWeight', 'harvestDate', 'qualityGrade', 'status']);
    });

    it('every field a scanner can see is refused 409 on PUT /:id after a lot was issued (status aside)', async () => {
        mockState.lotCount = 1;
        const outcome = {};
        for (const field of publishedOnScan.filter((f) => !LIFECYCLE_FIELDS.includes(f))) {
            const res = await callRouter('PUT', '/hb-1', { [field]: EDITABLE[field][1] });
            outcome[field] = [res.status, res.body.code, res.body.fields];
        }
        const expected = Object.fromEntries(Object.keys(outcome).map(
            (f) => [f, [409, 'HARVEST_FROZEN_AFTER_PACKING', [f]]],
        ));
        expect(outcome).toEqual(expected);
        expect(mockState.writes).toEqual([]);
    });

    it('a grade change after packing is refused with the weight-freeze code, in Thai that names the grade', async () => {
        mockState.lotCount = 2;
        const res = await callRouter('PUT', '/hb-1', { qualityGrade: 'B' });

        expect(res.status).toBe(409);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe('HARVEST_FROZEN_AFTER_PACKING');
        expect(res.body.fields).toEqual(['qualityGrade']);
        // the refusal has to be true for this field, not only for weights
        expect(res.body.messageTh).toMatch(/เกรด/);
        expect(mockState.writes).toEqual([]);
    });

    it('a note riding along with a grade change does not sneak through — the whole edit is refused', async () => {
        mockState.lotCount = 1;
        const res = await callRouter('PUT', '/hb-1', { notes: 'แก้บันทึก', qualityGrade: 'C' });

        expect(res.status).toBe(409);
        expect(res.body.fields).toEqual(['qualityGrade']);
        expect(mockState.writes).toEqual([]);
    });

    it('POST /:id/harvest cannot re-grade a packed batch either', async () => {
        mockState.batch = batchColumns({ status: 'PACKED' });
        mockState.lotCount = 1;
        const res = await callRouter('POST', '/hb-1/harvest', { qualityGrade: 'C' });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('HARVEST_FROZEN_AFTER_PACKING');
        expect(res.body.fields).toEqual(expect.arrayContaining(['qualityGrade']));
        expect(mockState.writes).toEqual([]);
    });

    it('before any lot exists the grade is still the farmer\'s to set', async () => {
        const res = await callRouter('PUT', '/hb-1', { qualityGrade: 'B' });

        expect(res.status).toBe(200);
        expect(mockState.writes).toHaveLength(1);
        expect(mockState.writes[0].data).toEqual({ qualityGrade: 'B' });
    });

    it('fields no scanner sees, the lifecycle status and the note still save after packing', async () => {
        mockState.lotCount = 1;
        const stillEditable = Object.keys(EDITABLE).filter(
            (f) => LIFECYCLE_FIELDS.includes(f)
                || (!publishedOnScan.includes(f) && !QUOTA_FIELDS.includes(f)),
        );
        expect(stillEditable).toEqual(expect.arrayContaining(['notes', 'status']));

        const outcome = {};
        for (const field of stillEditable) {
            const res = await callRouter('PUT', '/hb-1', { [field]: EDITABLE[field][1] });
            outcome[field] = res.status;
        }
        expect(outcome).toEqual(Object.fromEntries(stillEditable.map((f) => [f, 200])));
        expect(mockState.writes).toHaveLength(stillEditable.length);
    });
});
