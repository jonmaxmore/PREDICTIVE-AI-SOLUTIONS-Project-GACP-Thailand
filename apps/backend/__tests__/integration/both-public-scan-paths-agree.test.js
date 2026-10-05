/**
 * หน้าสแกนสาธารณะมีสองเส้นทาง และทั้งสองต้องตอบเรื่องเดียวกัน
 *
 * เจอด้วยการกดผ่านเบราว์เซอร์จริง 2026-09-06 — ไม่ใช่จากการอ่านโค้ด: หน้า `/trace/lot/<qr>`
 * ที่ผู้ซื้อเปิดจริง เรียก `GET /api/trace/lot/:id` (routes/api/trace/trace-batch-lot-routes.js)
 * ซึ่งเป็น **คนละประตู** กับ `GET /api/trace/:qr` (services/trace-service/resolve-generic.js)
 * ที่งาน T12/T13 ไปแก้
 *
 * ผลคือ: มติ operator "ที่อยู่และ COA เมื่อสแกนต้องเห็นทั้งหมด" เป็นจริงบนประตูหนึ่ง และ
 * ไม่เป็นจริงบนประตูที่คนใช้จริง · ผู้ซื้อคนเดียวกัน สแกนของชิ้นเดียวกัน ได้คำตอบต่างกัน
 * ขึ้นกับว่า QR พาเขาไปทางไหน — ซึ่งเป็นความไม่สอดคล้องที่แย่กว่าการไม่เปิดข้อมูลเลย
 *
 * เทสนี้ปักว่าทั้งสองเส้นตอบเหมือนกันในสิ่งที่มติสั่ง และเหมือนกันในสิ่งที่ต้องไม่หลุด
 */

// `services/trace-service/common` เปิดด้วย `require('../../server').prisma || ...` ซึ่งลากทั้ง
// express app เข้ามาและทำให้เกิดวงกลม (resolve-generic destructure common ที่ยังโหลดไม่จบ →
// logger เป็น undefined) · ปิดประตูนั้นด้วย object ว่าง แล้ว `||` จะตกไปที่ prisma ตัวจริง
// — ยังเป็นฐานข้อมูลจริง ไม่ใช่ mock
jest.mock('../../server', () => ({}));

const crypto = require('crypto');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');
const common = require('../../services/trace-service/common');
const { registerBatchAndLotRoutes } = require('../../routes/api/trace/trace-batch-lot-routes');

/**
 * ประตูจริงทั้งสองบาน ต่อกับ service จริง ไม่มี mock — คิวรีที่ถูกแล้วยังตีพิมพ์ผิดได้
 * ถ้า projection ของ route ไม่ได้เอามาใช้ ดังนั้นเทสระดับ service อย่างเดียวไม่พอ
 */
function buildHandlers() {
    const handlers = {};
    const router = {
        get(routePath, fn) {
            if (routePath === '/batch/:batchId') { handlers.batch = fn; }
            if (routePath === '/lot/:lotId') { handlers.lot = fn; }
        },
    };
    registerBatchAndLotRoutes(router, {
        qrcodeService: { recordTraceScan: async () => ({ available: false, valid: null }) },
        logger: { warn() {}, info() {}, error() {} },
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
}

function mockRes() {
    const res = { statusCode: 200, body: undefined };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.get = () => undefined;
    return res;
}

d('สองเส้นทางสแกนต้องตอบตรงกัน (real Postgres)', () => {
    let prisma;
    let resolveTraceByGenericQr;
    let traceabilityService;
    const created = { orgs: [], users: [], farms: [], cycles: [], batches: [], lots: [], labs: [] };
    const uid = () => crypto.randomUUID();
    const digits13 = (s) => s.replace(/\D/g, '').padEnd(13, '7').slice(0, 13);

    const FARM = {
        name: 'สวนสองเส้นทาง',
        address: '77/7 ซอยตรวจสอบ',
        subDistrict: 'ตำบลตรวจสอบ',
        district: 'อำเภอตรวจสอบ',
        province: 'จังหวัดตรวจสอบ',
        postalCode: '50999',
    };
    const SECRET = { lat: 18.111111, lng: 98.222222, owner: 'ชื่อเจ้าของที่ไม่ควรโผล่' };

    let qrCode;
    let batchNumber;
    let genericBody;
    let lotRouteBody;
    let lotDoor;    // สิ่งที่ประตู /api/trace/lot/:id ตอบกลับจริง
    let batchDoor;  // สิ่งที่ประตู /api/trace/batch/:id ตอบกลับจริง

    beforeAll(async () => {
        ({ prisma } = require('../../services/prisma-database'));
        ({ resolveTraceByGenericQr } = require('../../services/trace-service/resolve-generic'));
        traceabilityService = require('../../services/traceability-service');

        const orgId = uid();
        await prisma.organization.create({
            data: { id: orgId, name: `o-${orgId.slice(0, 8)}`, slug: `o-${orgId.slice(0, 8)}`, code: `O_${orgId.slice(0, 8).toUpperCase()}` },
        });
        created.orgs.push(orgId);

        const ownerId = uid();
        await prisma.user.create({
            data: {
                id: ownerId, canonicalId: `can-${ownerId}`, email: `u-${ownerId.slice(0, 8)}@e.test`,
                password: 'x', firstName: SECRET.owner, lastName: 'นามสกุล', role: 'health',
                organizationId: orgId, authType: 'HEALTH_ID', healthId: digits13(ownerId),
            },
        });
        created.users.push(ownerId);

        const farmId = uid();
        await prisma.farm.create({
            data: {
                id: farmId, ownerId, organizationId: orgId, farmName: FARM.name, farmType: 'CULTIVATION',
                address: FARM.address, subDistrict: FARM.subDistrict, district: FARM.district,
                province: FARM.province, postalCode: FARM.postalCode,
                latitude: SECRET.lat, longitude: SECRET.lng,
                totalArea: 100, cultivationArea: 80, cultivationMethod: 'OUTDOOR', status: 'ACTIVE',
            },
        });
        created.farms.push(farmId);

        let plant = await prisma.plantSpecies.findFirst({ where: { code: 'CAN' } });
        if (!plant) { plant = await prisma.plantSpecies.create({ data: { id: uid(), code: 'CAN', nameTH: 'กัญชา', nameEN: 'Cannabis' } }); }

        const cycle = await prisma.plantingCycle.create({
            data: {
                id: uid(), farmId, plantSpeciesId: plant.id, organizationId: orgId,
                cycleName: 'รอบสองเส้นทาง', startDate: new Date('2026-01-01'),
                status: 'HARVESTED', cultivationType: 'OUTDOOR',
            },
        });
        created.cycles.push(cycle.id);

        batchNumber = `HB-2P-${uid().slice(0, 6)}`;
        const batch = await prisma.harvestBatch.create({
            data: {
                id: uid(), farmId, cycleId: cycle.id, organizationId: orgId,
                batchNumber, harvestDate: new Date('2026-06-01'),
                freshWeight: 9, dryWeight: 3, plantCode: 'CAN', status: 'HARVESTED',
            },
        });
        created.batches.push(batch.id);

        const lab = await prisma.batchLabResult.create({
            data: {
                id: uid(), harvestBatchId: batch.id, organizationId: orgId,
                fileUrl: '/uploads/lab-results/two-paths.pdf', fileName: 'coa.pdf',
                labName: 'ห้องปฏิบัติการกลาง', reportNumber: 'CL-2P-001',
                uploadedBy: ownerId, verificationStatus: 'FARMER_UPLOADED',
            },
        });
        created.labs.push(lab.id);

        qrCode = uid();
        const lot = await prisma.lot.create({
            data: {
                id: uid(), batchId: batch.id, organizationId: orgId, lotNumber: `LOT-2P-${uid().slice(0, 5)}`,
                packageType: 'BAG', quantity: 1, unitWeight: 1, totalWeight: 1, qrCode, status: 'PACKAGED',
            },
        });
        created.lots.push(lot.id);

        const generic = await resolveTraceByGenericQr(qrCode, { requestIp: '127.0.0.1', userAgent: 'jest' });
        genericBody = generic.body;

        // เส้นที่หน้าเว็บของผู้ซื้อเรียกจริง — อ่านผ่าน service เดียวกับที่ route ใช้
        lotRouteBody = await traceabilityService.findPublicLotByAnyIdentifier(qrCode);

        // แล้วกดประตูจริงทั้งสองบาน ด้วย handler ตัวเดียวกับที่ express ผูกไว้
        const handlers = buildHandlers();
        const lotRes = mockRes();
        await handlers.lot({ params: { lotId: qrCode }, get: () => undefined, originalUrl: `/api/trace/lot/${qrCode}` }, lotRes);
        lotDoor = lotRes;
        const batchRes = mockRes();
        await handlers.batch({ params: { batchId: batchNumber }, get: () => undefined, originalUrl: `/api/trace/batch/${batchNumber}` }, batchRes);
        batchDoor = batchRes;
    });

    afterAll(async () => {
        for (const id of created.labs) { await prisma.batchLabResult.deleteMany({ where: { id } }); }
        for (const id of created.lots) { await prisma.lot.deleteMany({ where: { id } }); }
        for (const id of created.batches) { await prisma.harvestBatch.deleteMany({ where: { id } }); }
        for (const id of created.cycles) { await prisma.plantingCycle.deleteMany({ where: { id } }); }
        for (const id of created.farms) { await prisma.farm.deleteMany({ where: { id } }); }
        for (const id of created.users) { await prisma.user.deleteMany({ where: { id } }); }
        for (const id of created.orgs) { await prisma.organization.deleteMany({ where: { id } }); }
    });

    test('เส้นทางทั่วไปเปิดที่อยู่ตามมติ (ของเดิมที่ทำไว้แล้ว)', () => {
        expect(genericBody.data.farm.address).toBe(FARM.address);
    });

    test('เส้นทางที่หน้าเว็บของผู้ซื้อใช้ ต้องโหลดที่อยู่มาด้วย ไม่ใช่แค่ชื่อกับจังหวัด', () => {
        // ถ้าคิวรีไม่ได้ขอคอลัมน์นี้มา หน้าเว็บก็ไม่มีทางแสดงได้ ไม่ว่าจะแก้ JSX อย่างไร
        expect(lotRouteBody.batch.farm.address).toBe(FARM.address);
        expect(lotRouteBody.batch.farm.subDistrict).toBe(FARM.subDistrict);
        expect(lotRouteBody.batch.farm.postalCode).toBe(FARM.postalCode);
    });

    test('เส้นทางเดียวกันต้องพกผลแล็บของรุ่นมาด้วย — ล็อตสืบทอดจากรุ่น', () => {
        const labs = lotRouteBody.batch.labResults;
        expect(Array.isArray(labs)).toBe(true);
        expect(labs.map((l) => l.reportNumber)).toContain('CL-2P-001');
    });

    test('ประตูล็อตตีพิมพ์ที่อยู่และ COA ออกไปจริง ไม่ใช่แค่โหลดมาแล้ววางทิ้ง', () => {
        expect(lotDoor.statusCode).toBe(200);
        const data = lotDoor.body.data;
        expect(data.farm.address).toBe(FARM.address);
        expect(data.farm.subDistrict).toBe(FARM.subDistrict);
        expect(data.farm.postalCode).toBe(FARM.postalCode);
        // สองคำกล่าวอ้างแยกกัน: ถุงใบนี้ กับ ฟาร์มนี้
        expect(data.labTest.lot.subject).toBe('LOT');
        expect(data.labTest.lot.tested).toBe(true);
        expect(data.labTest.lot.latest.fileUrl).toBe('/uploads/lab-results/two-paths.pdf');
        expect(data.labTest.lot.latest.labName).toBe('ห้องปฏิบัติการกลาง');
        expect(data.labTest.farm).toEqual({ subject: 'FARM', reportCount: 1 });
    });

    test('ประตูรุ่นก็ตอบเรื่องเดียวกัน และบอกว่ากำลังพูดถึงรุ่น ไม่ใช่ถุง', () => {
        expect(batchDoor.statusCode).toBe(200);
        const data = batchDoor.body.data;
        expect(data.farm.address).toBe(FARM.address);
        expect(data.labTest.batch.subject).toBe('BATCH');
        expect(data.labTest.batch.latest.reportNumber).toBe('CL-2P-001');
    });

    test('และทั้งสองเส้นยังไม่ดึงพิกัดหรือชื่อเจ้าของออกมา', () => {
        const both = JSON.stringify(genericBody) + JSON.stringify(lotRouteBody)
            + JSON.stringify(lotDoor.body) + JSON.stringify(batchDoor.body);
        expect(both).not.toContain(String(SECRET.lat));
        expect(both).not.toContain(String(SECRET.lng));
        expect(both).not.toContain(SECRET.owner);
    });
});
