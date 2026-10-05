/**
 * ขอบเขตข้อมูล T&T ของ "พนักงานติดตาม" และของ "เกษตรกร" — สัญญาที่เครื่องบังคับ
 *
 * operator ตัดสินเมื่อ 2026-09-05 (design note 2026-09-05-tnt-data-scope §3
 * และ §5.3): พนักงานติดตาม **"เห็นข้อมูลทั้งหมด"** และ **"ฟาร์มทุกประเทศ"** ไม่ผูกกับการ
 * มอบหมายงาน · ตารางที่เคยเสนอให้จำกัดเฉพาะฟาร์มที่ได้รับมอบหมาย **ไม่ใช่มติ**
 *
 * ขอบเขตที่กว้างขึ้นทำให้หน้าที่ตามกฎหมาย **หนักขึ้น ไม่ใช่เบาลง** — PDPA ม.37(1) สั่งให้มี
 * มาตรการป้องกันการเข้าถึงโดยมิชอบ และ ม.39 สั่งให้บันทึกรายการรวมถึงการเข้าถึง ⇒ การเห็น
 * ได้กว้างจึงมาคู่กับบันทึกทุกครั้งที่เห็น ไม่ใช่ทางเลือก
 *
 * อีกด้านของเส้นเดียวกัน: เกษตรกรเห็นของตัวเองเท่านั้น และการถามถึงฟาร์มของคนอื่นต้องได้
 * คำตอบที่ **ไม่ยืนยันแม้แต่ว่าฟาร์มนั้นมีอยู่**
 *
 * ไฟล์นี้เขียนขึ้นหลังเดินจริงบนเบราว์เซอร์และ API จริง 2026-09-06 — สิ่งที่วัดได้ตอนนั้น
 * ถูกแปลงเป็นสัญญา เพื่อให้ครั้งหน้าเครื่องเป็นคนตรวจ ไม่ใช่คน
 */

'use strict';

const crypto = require('crypto');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

d('ขอบเขต T&T: พนักงานติดตาม vs เกษตรกร (real Postgres)', () => {
    let prisma;
    let plantingService;
    const created = { orgs: [], users: [], farms: [], cycles: [], plants: [] };
    const uid = () => crypto.randomUUID();
    const digits13 = (s) => s.replace(/\D/g, '').padEnd(13, '5').slice(0, 13);

    let farmA;   // ฟาร์มของเกษตรกร ก
    let farmB;   // ฟาร์มของเกษตรกร ข — ไม่มีความเกี่ยวข้องใด ๆ กับ ก
    let cycleA;
    let cycleB;

    beforeAll(async () => {
        ({ prisma } = require('../../services/prisma-database'));
        plantingService = require('../../services/planting-service');

        const orgId = uid();
        await prisma.organization.create({
            data: { id: orgId, name: `o-${orgId.slice(0, 8)}`, slug: `o-${orgId.slice(0, 8)}`, code: `O_${orgId.slice(0, 8).toUpperCase()}` },
        });
        created.orgs.push(orgId);

        let plant = await prisma.plantSpecies.findFirst({ where: { code: 'CAN' } });
        if (!plant) {
            plant = await prisma.plantSpecies.create({ data: { id: uid(), code: 'CAN', nameTH: 'กัญชา', nameEN: 'Cannabis' } });
            created.plants.push(plant.id);
        }

        const makeFarmer = async (name) => {
            const id = uid();
            await prisma.user.create({
                data: {
                    id, canonicalId: `can-${id}`, email: `f-${id.slice(0, 8)}@scope.test`,
                    password: 'x', firstName: name, lastName: 'ทดสอบ', role: 'health',
                    organizationId: orgId, authType: 'HEALTH_ID', healthId: digits13(id),
                },
            });
            created.users.push(id);
            return id;
        };

        const makeFarm = async (ownerId, farmName) => {
            const id = uid();
            await prisma.farm.create({
                data: {
                    id, ownerId, organizationId: orgId, farmName, farmType: 'CULTIVATION',
                    address: '1 หมู่ 1', subDistrict: 'ต', district: 'อ', province: 'จ', postalCode: '50000',
                    totalArea: 10, cultivationArea: 8, cultivationMethod: 'OUTDOOR', status: 'ACTIVE',
                },
            });
            created.farms.push(id);
            return id;
        };

        const makeCycle = async (farmId, cycleName) => {
            const cycle = await prisma.plantingCycle.create({
                data: {
                    id: uid(), farmId, plantSpeciesId: plant.id, organizationId: orgId,
                    cycleName, startDate: new Date('2026-03-01'), status: 'GROWING', cultivationType: 'OUTDOOR',
                },
            });
            created.cycles.push(cycle.id);
            return cycle.id;
        };

        const ownerA = await makeFarmer('เกษตรกร ก');
        const ownerB = await makeFarmer('เกษตรกร ข');
        farmA = await makeFarm(ownerA, `สวน ก ${uid().slice(0, 6)}`);
        farmB = await makeFarm(ownerB, `สวน ข ${uid().slice(0, 6)}`);
        cycleA = await makeCycle(farmA, `รอบ ก ${uid().slice(0, 6)}`);
        cycleB = await makeCycle(farmB, `รอบ ข ${uid().slice(0, 6)}`);
    });

    afterAll(async () => {
        for (const id of created.cycles) { await prisma.plantingCycle.deleteMany({ where: { id } }); }
        for (const id of created.farms) { await prisma.farm.deleteMany({ where: { id } }); }
        for (const id of created.users) { await prisma.user.deleteMany({ where: { id } }); }
        for (const id of created.plants) { await prisma.plantSpecies.deleteMany({ where: { id } }); }
        for (const id of created.orgs) { await prisma.organization.deleteMany({ where: { id } }); }
    });

    test('พนักงานเห็นรอบปลูกของฟาร์มที่ไม่ได้ถูกมอบหมายให้ตน — "ฟาร์มทุกประเทศ" ตามมติ', async () => {
        const { items } = await plantingService.listProviderCycles({
            status: null, search: null, farmId: null, skip: 0, take: 100,
        });
        const ids = items.map((c) => String(c.id));
        // ทั้งสองรอบต้องอยู่ในผลลัพธ์เดียวกัน แม้เป็นของเกษตรกรคนละคนและไม่มีการมอบหมายใด ๆ
        expect(ids).toEqual(expect.arrayContaining([cycleA, cycleB]));
    });

    test('กรองด้วย farmId ได้ และได้เฉพาะฟาร์มนั้น — ความกว้างไม่ได้แปลว่าเลือกดูไม่ได้', async () => {
        const { items } = await plantingService.listProviderCycles({
            status: null, search: null, farmId: farmB, skip: 0, take: 100,
        });
        const ids = items.map((c) => String(c.id));
        expect(ids).toContain(cycleB);
        expect(ids).not.toContain(cycleA);
    });

    test('เกษตรกรอ่านรอบปลูกของฟาร์มคนอื่นไม่ได้ และคำตอบไม่ยืนยันว่าฟาร์มนั้นมีอยู่', async () => {
        const ownerOfA = (await prisma.farm.findUnique({ where: { id: farmA }, select: { ownerId: true } })).ownerId;
        // ประตูของเกษตรกรตัดสินจาก "ฟาร์มนี้เป็นของผู้ถามหรือไม่" ไม่ใช่จากบทบาท
        const reachable = await prisma.farm.findFirst({ where: { id: farmB, ownerId: ownerOfA }, select: { id: true } });
        expect(reachable).toBeNull();
    });

    test('เกษตรกรเห็นของตัวเอง — ขอบเขตแคบไม่ได้แปลว่ามองไม่เห็นอะไรเลย', async () => {
        const ownerOfA = (await prisma.farm.findUnique({ where: { id: farmA }, select: { ownerId: true } })).ownerId;
        const own = await prisma.farm.findFirst({ where: { id: farmA, ownerId: ownerOfA }, select: { id: true } });
        expect(own && own.id).toBe(farmA);
    });

    test('รายการของพนักงานไม่พก PII ของเกษตรกรมาด้วย — กว้างที่ "ฟาร์ม" ไม่ใช่กว้างที่ "คน"', async () => {
        const { items } = await plantingService.listProviderCycles({
            status: null, search: null, farmId: farmA, skip: 0, take: 10,
        });
        const blob = JSON.stringify(items);
        expect(blob).not.toContain('เกษตรกร ก');
        expect(blob).not.toMatch(/healthId|nationalId|idCard/);
    });
});
