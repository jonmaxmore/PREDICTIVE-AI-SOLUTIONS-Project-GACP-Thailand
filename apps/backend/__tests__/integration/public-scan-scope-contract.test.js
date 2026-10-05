/**
 * ขอบเขตข้อมูลเปิด — สัญญาที่เครื่องบังคับ ไม่ใช่ย่อหน้าในเอกสาร
 *
 * operator ถามตรง ๆ ว่า "ส่วนไหนเป็นข้อมูลเปิดที่ทุกคนมาสแกนได้โดยไม่ต้องล็อกอิน และให้ดู
 * ขอบเขตได้เท่าไหร่" · คำตอบมีอยู่ในเอกสารออกแบบและในเทสหน่วยหลายไฟล์ แต่กระจายอยู่ และ
 * **เทสหน่วยทุกไฟล์ป้อน object ที่ประกอบไว้แล้วให้ resolver** — ซึ่งเป็นเหตุผลที่ช่องว่าง
 * ของ `select` หลุดมาได้ถึงสามครั้งในชุดงานนี้ (T8 · T12 · N6)
 *
 * ไฟล์นี้ตอบคำถามนั้นครั้งเดียวจบ บน **ฐานข้อมูลจริง**: สร้างฟาร์ม รอบปลูก รุ่นเก็บเกี่ยว
 * ล็อต และผลแล็บของจริง แล้วสแกนแบบ **ไม่ล็อกอิน** ผ่าน resolver ตัวเดียวกับที่หน้าเว็บใช้
 * · สิ่งที่ต้องเห็นต้องเห็นจริง สิ่งที่ต้องไม่เห็นต้องไม่โผล่ที่ไหนใน payload เลย
 *
 * ตารางนี้คือมติ operator 2026-09-05 ("ให้อัปโหลด COA และพวกชื่อฟาร์ม และที่อยู่ติดต่อได้
 * เมื่อสแกนต้องเห็นทั้งหมด") บวกข้อยกเว้นที่ถามแยกและตอบว่าไม่เปิด (พิกัด GPS)
 */

const crypto = require('crypto');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

d('ขอบเขตของหน้าสแกนสาธารณะ (real Postgres, ไม่ล็อกอิน)', () => {
    let prisma;
    let resolveTraceByGenericQr;
    const created = { orgs: [], users: [], farms: [], cycles: [], batches: [], lots: [], labs: [], plants: [] };
    const uid = () => crypto.randomUUID();
    const digits13 = (seed) => seed.replace(/\D/g, '').padEnd(13, '7').slice(0, 13);

    /** ค่าที่ต้อง "ไม่โผล่" — ตั้งให้จำเพาะพอที่จะค้นเจอถ้ามันหลุด */
    const SECRET = {
        lat: 18.7654321,
        lng: 98.1234567,
        ownerFirst: 'ชื่อจริงของเจ้าของ',
        ownerLast: 'นามสกุลที่ไม่ควรโผล่',
        plotName: 'ชื่อแปลงภายใน',
        cycleName: 'ชื่อรอบปลูกภายใน',
    };
    const PUBLIC = {
        farmName: 'สวนสมุนไพรเปิดเผยได้',
        address: '99/1 ซอยเปิดเผยได้',
        subDistrict: 'ตำบลเปิดเผยได้',
        district: 'อำเภอเปิดเผยได้',
        province: 'จังหวัดเปิดเผยได้',
        postalCode: '50210',
        labName: 'ห้องปฏิบัติการกลาง',
        reportNumber: 'CL-2569-SCOPE',
    };

    let scan;   // payload ที่คนสแกนได้รับ
    let body;   // ข้อความทั้งก้อน สำหรับค้นค่าที่ต้องไม่หลุด

    beforeAll(async () => {
        ({ prisma } = require('../../services/prisma-database'));
        ({ resolveTraceByGenericQr } = require('../../services/trace-service/resolve-generic'));

        const orgId = uid();
        await prisma.organization.create({
            data: { id: orgId, name: `org-${orgId.slice(0, 8)}`, slug: `org-${orgId.slice(0, 8)}`, code: `ORG_${orgId.slice(0, 8).toUpperCase()}` },
        });
        created.orgs.push(orgId);

        const ownerId = uid();
        await prisma.user.create({
            data: {
                id: ownerId, canonicalId: `can-${ownerId}`,
                email: `owner-${ownerId.slice(0, 8)}@example.test`, password: 'x',
                firstName: SECRET.ownerFirst, lastName: SECRET.ownerLast,
                role: 'health', organizationId: orgId,
                authType: 'HEALTH_ID', healthId: digits13(ownerId),
            },
        });
        created.users.push(ownerId);

        const farmId = uid();
        await prisma.farm.create({
            data: {
                id: farmId, ownerId, organizationId: orgId,
                farmName: PUBLIC.farmName, farmType: 'CULTIVATION',
                address: PUBLIC.address, subDistrict: PUBLIC.subDistrict,
                district: PUBLIC.district, province: PUBLIC.province, postalCode: PUBLIC.postalCode,
                latitude: SECRET.lat, longitude: SECRET.lng,
                totalArea: 1000, cultivationArea: 800, cultivationMethod: 'OUTDOOR',
                status: 'ACTIVE',
            },
        });
        created.farms.push(farmId);

        let plant = await prisma.plantSpecies.findFirst({ where: { code: 'CAN' } });
        if (!plant) {
            plant = await prisma.plantSpecies.create({
                data: { id: uid(), code: 'CAN', nameTH: 'กัญชา', nameEN: 'Cannabis' },
            });
            created.plants.push(plant.id);
        }

        const cycleId = uid();
        await prisma.plantingCycle.create({
            data: {
                id: cycleId, farmId, plantSpeciesId: plant.id, organizationId: orgId,
                cycleName: SECRET.cycleName, startDate: new Date('2026-01-01'),
                status: 'HARVESTED', cultivationType: 'OUTDOOR',
            },
        });
        created.cycles.push(cycleId);

        const batchId = uid();
        await prisma.harvestBatch.create({
            data: {
                id: batchId, farmId, cycleId, organizationId: orgId,
                batchNumber: `HB-SCOPE-${batchId.slice(0, 6)}`,
                harvestDate: new Date('2026-06-01'), freshWeight: 10, dryWeight: 3,
                plantCode: 'CAN', status: 'HARVESTED',
            },
        });
        created.batches.push(batchId);

        const labId = uid();
        await prisma.batchLabResult.create({
            data: {
                id: labId, harvestBatchId: batchId, organizationId: orgId,
                fileUrl: '/uploads/lab-results/scope.pdf', fileName: 'scope-coa.pdf',
                labName: PUBLIC.labName, reportNumber: PUBLIC.reportNumber,
                uploadedBy: ownerId, verificationStatus: 'FARMER_UPLOADED',
            },
        });
        created.labs.push(labId);

        const lotId = uid();
        const qrCode = uid();
        await prisma.lot.create({
            data: {
                id: lotId, batchId, organizationId: orgId,
                lotNumber: `LOT-SCOPE-${lotId.slice(0, 6)}`,
                packageType: 'BAG', quantity: 1, unitWeight: 1, totalWeight: 1,
                qrCode, status: 'PACKAGED',
            },
        });
        created.lots.push(lotId);

        const out = await resolveTraceByGenericQr(qrCode, { requestIp: '127.0.0.1', userAgent: 'jest' });
        scan = out.body;
        body = JSON.stringify(scan);
    });

    afterAll(async () => {
        for (const id of created.labs) { await prisma.batchLabResult.deleteMany({ where: { id } }); }
        for (const id of created.lots) { await prisma.lot.deleteMany({ where: { id } }); }
        for (const id of created.batches) { await prisma.harvestBatch.deleteMany({ where: { id } }); }
        for (const id of created.cycles) { await prisma.plantingCycle.deleteMany({ where: { id } }); }
        for (const id of created.farms) { await prisma.farm.deleteMany({ where: { id } }); }
        for (const id of created.users) { await prisma.user.deleteMany({ where: { id } }); }
        for (const id of created.plants) { await prisma.plantSpecies.deleteMany({ where: { id } }); }
        for (const id of created.orgs) { await prisma.organization.deleteMany({ where: { id } }); }
    });

    describe('สิ่งที่คนสแกนต้องเห็น (มติ 2026-09-05)', () => {
        test('ชื่อฟาร์ม และที่อยู่เต็ม', () => {
            const farm = scan.data.farm;
            expect(farm.name).toBe(PUBLIC.farmName);
            expect(farm.address).toBe(PUBLIC.address);
            expect(farm.subDistrict).toBe(PUBLIC.subDistrict);
            expect(farm.district).toBe(PUBLIC.district);
            expect(farm.province).toBe(PUBLIC.province);
            expect(farm.postalCode).toBe(PUBLIC.postalCode);
        });

        test('ผลวิเคราะห์ของรุ่น พร้อมไฟล์ และบอกว่าใครเป็นคนอ้าง', () => {
            const lab = scan.data.lot.labTest;
            expect(lab.lot.tested).toBe(true);
            expect(lab.lot.latest.fileUrl).toBe('/uploads/lab-results/scope.pdf');
            expect(lab.lot.latest.labName).toBe(PUBLIC.labName);
            expect(lab.lot.latest.reportNumber).toBe(PUBLIC.reportNumber);
            // ผู้ซื้อต้องรู้ว่ากำลังดูเอกสารที่ใครใส่เข้ามา ไม่ใช่ให้เดา
            expect(lab.lot.latest.verificationStatus).toBe('FARMER_UPLOADED');
        });

        test('คำกล่าวอ้างของล็อตกับของฟาร์มแยกกัน — ไม่ยุบเป็นบรรทัดเดียว', () => {
            expect(scan.data.lot.labTest.lot.subject).toBe('LOT');
            expect(scan.data.lot.labTest.farm.subject).toBe('FARM');
            expect(body).not.toContain('hasLabResults');   // ไม่มีบูลีนรวมให้หยิบไปใช้ผิด
        });
    });

    describe('สิ่งที่ต้องไม่หลุด ไม่ว่าจะสะกดแบบไหน', () => {
        test('พิกัด GPS — ถามแยกและตอบว่าไม่เปิด เพราะแปลงกัญชาเป็นเป้าขโมย', () => {
            expect(body).not.toContain(String(SECRET.lat));
            expect(body).not.toContain(String(SECRET.lng));
            for (const spelling of ['latitude', 'longitude', '"lat"', '"lng"', 'coordinates']) {
                expect(body).not.toContain(spelling);
            }
        });

        test('ชื่อ-นามสกุลเจ้าของ — หน้าสาธารณะพูดถึงฟาร์ม ไม่ใช่ตัวบุคคล', () => {
            expect(body).not.toContain(SECRET.ownerFirst);
            expect(body).not.toContain(SECRET.ownerLast);
        });

        test('id ภายในทุกชนิด — เป็นมือจับสำหรับไล่เดา ไม่ใช่ข้อมูลที่คนสแกนต้องใช้', () => {
            expect(scan.data.farm.id).toBeUndefined();
            for (const id of [...created.farms, ...created.users, ...created.batches, ...created.orgs]) {
                expect(body).not.toContain(id);
            }
        });

        test('ชื่อแปลงและชื่อรอบปลูกภายใน — ความลับทางธุรกิจ ไม่ใช่เรื่อง PDPA', () => {
            expect(body).not.toContain(SECRET.plotName);
            expect(body).not.toContain(SECRET.cycleName);
        });
    });
});
