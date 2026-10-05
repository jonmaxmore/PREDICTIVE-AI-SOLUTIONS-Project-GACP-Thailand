/**
 * ใบรับรองหมดอายุ ไม่ใช่เหตุให้เจ้าของมองไม่เห็นบันทึกของตัวเอง
 *
 * วัดจริงเมื่อ 2026-09-06 บนฐานข้อมูลจริง สามสถานะเรียงกัน:
 *
 *   ใบรับรองยังมีผล   เจ้าของเห็น 1 รอบ   พนักงานเห็น 2 รอบ
 *   ใบรับรองหมดอายุ   เจ้าของเห็น 0 รอบ   พนักงานเห็น 2 รอบ  ← รอบเดียวกันนั้นยังอยู่
 *
 * และ QR สาธารณะก็ยังอ่านรอบนั้นได้ (พิสูจน์ไปแล้วในการเดินหน้าสแกน) ⇒ ทุกคนบนโลกยังเห็น
 * บันทึกของเกษตรกรคนนั้น **ยกเว้นตัวเขาเอง** และหน้าจอไม่บอกอะไรเลย ขึ้นแค่ "ยังไม่มีรอบการปลูก"
 *
 * ทำไมถึงสำคัญเป็นพิเศษ: ใบรับรองหมดอายุคือจังหวะที่เกษตรกร **ต้องใช้** ประวัติของตัวเองมากที่สุด
 * — คำขอต่ออายุขอ "รายงานสรุปผลการดำเนินงาน" ของรอบที่ผ่านมา ซึ่งอยู่บนหน้าจอที่เพิ่งว่างเปล่าไป ·
 * และ PDPA ม.30 ให้สิทธิเจ้าของข้อมูลเข้าถึงข้อมูลของตน ไม่ได้ผูกสิทธินั้นไว้กับอายุใบรับรอง
 *
 * กติกาที่ **ไม่เปลี่ยน**: การ *บันทึกรอบใหม่* ยังต้องมีใบรับรองที่ยังมีผล (createCycle เดิม
 * ทุกประการ) · การอ่านประวัติของตัวเองกับการบันทึกของใหม่เป็นคนละการกระทำ
 */

'use strict';

const crypto = require('crypto');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

d('เจ้าของยังเห็นรอบปลูกของตัวเองเมื่อใบรับรองหมดอายุ (real Postgres)', () => {
    let prisma;
    let plantingService;
    const created = { orgs: [], users: [], farms: [], certs: [], cycles: [], plants: [], apps: [] };
    const uid = () => crypto.randomUUID();
    const digits13 = (s) => s.replace(/\D/g, '').padEnd(13, '4').slice(0, 13);

    let ownerId;
    let cycleId;
    let certId;

    beforeAll(async () => {
        ({ prisma } = require('../../services/prisma-database'));
        plantingService = require('../../services/planting-service');

        const orgId = uid();
        await prisma.organization.create({
            data: { id: orgId, name: `o-${orgId.slice(0, 8)}`, slug: `o-${orgId.slice(0, 8)}`, code: `O_${orgId.slice(0, 8).toUpperCase()}` },
        });
        created.orgs.push(orgId);

        ownerId = uid();
        await prisma.user.create({
            data: {
                id: ownerId, canonicalId: `can-${ownerId}`, email: `own-${ownerId.slice(0, 8)}@keep.test`,
                password: 'x', firstName: 'เจ้าของ', lastName: 'บันทึก', role: 'health',
                organizationId: orgId, authType: 'HEALTH_ID', healthId: digits13(ownerId),
            },
        });
        created.users.push(ownerId);

        const farmId = uid();
        await prisma.farm.create({
            data: {
                id: farmId, ownerId, organizationId: orgId, farmName: `สวนเก็บประวัติ ${uid().slice(0, 6)}`,
                farmType: 'CULTIVATION', address: '1 หมู่ 1', subDistrict: 'ต', district: 'อ',
                province: 'จ', postalCode: '50000', totalArea: 10, cultivationArea: 8,
                cultivationMethod: 'OUTDOOR', status: 'ACTIVE',
            },
        });
        created.farms.push(farmId);

        let plant = await prisma.plantSpecies.findFirst({ where: { code: 'CAN' } });
        if (!plant) {
            plant = await prisma.plantSpecies.create({ data: { id: uid(), code: 'CAN', nameTH: 'กัญชา', nameEN: 'Cannabis' } });
            created.plants.push(plant.id);
        }

        const ownerRow = await prisma.user.findUnique({ where: { id: ownerId }, select: { canonicalId: true } });
        const app = await prisma.application.create({
            data: {
                id: uid(), organizationId: orgId,
                // Application ผูกกับผู้ยื่นผ่าน healthId → users.canonicalId (ไม่ใช่ users.healthId)
                healthId: ownerRow.canonicalId,
                applicationNumber: `APP-KEEP-${uid().slice(0, 8)}`, status: 'CERTIFIED',
                areaType: 'OUTDOOR', serviceType: 'new_application', formData: {},
            },
        });
        created.apps.push(app.id);

        certId = uid();
        await prisma.certificate.create({
            data: {
                id: certId, organizationId: orgId, farmId, applicationId: app.id,
                userId: ownerId,
                verificationCode: `VC-${uid().slice(0, 8)}`, qrData: 'x',
                farmName: 'สวนเก็บประวัติ', applicantName: 'เจ้าของ บันทึก',
                cropType: 'cannabis', farmSize: 10,
                province: 'จ', district: 'อ', subDistrict: 'ต',
                standardId: 'THAI_GACP', standardName: 'GACP', issuedBy: 'DTAM',
                certificateNumber: `GACP-KEEP-${uid().slice(0, 6)}`, status: 'active',
                issuedDate: new Date('2026-01-01'),
                expiryDate: new Date(Date.now() + 365 * 24 * 3600 * 1000),
            },
        });
        created.certs.push(certId);

        const cycle = await prisma.plantingCycle.create({
            data: {
                id: uid(), farmId, plantSpeciesId: plant.id, organizationId: orgId,
                certificateId: certId, cycleName: `รอบที่ต้องไม่หาย ${uid().slice(0, 6)}`,
                startDate: new Date('2026-02-01'), status: 'HARVESTED', cultivationType: 'OUTDOOR',
            },
        });
        cycleId = cycle.id;
        created.cycles.push(cycleId);
    });

    afterAll(async () => {
        for (const id of created.cycles) { await prisma.plantingCycle.deleteMany({ where: { id } }); }
        for (const id of created.certs) { await prisma.certificate.deleteMany({ where: { id } }); }
        for (const id of created.apps) { await prisma.application.deleteMany({ where: { id } }); }
        for (const id of created.farms) { await prisma.farm.deleteMany({ where: { id } }); }
        for (const id of created.users) { await prisma.user.deleteMany({ where: { id } }); }
        for (const id of created.plants) { await prisma.plantSpecies.deleteMany({ where: { id } }); }
        for (const id of created.orgs) { await prisma.organization.deleteMany({ where: { id } }); }
    });

    test('ใบรับรองยังมีผล — เจ้าของเห็นรอบของตัวเอง', async () => {
        const cycles = await plantingService.listByOwner(ownerId);
        expect(cycles.map((c) => String(c.id))).toContain(cycleId);
    });

    test('ใบรับรองหมดอายุ — เจ้าของยังเห็นรอบของตัวเองอยู่', async () => {
        await prisma.certificate.update({
            where: { id: certId },
            data: { expiryDate: new Date('2026-01-02') },
        });
        const cycles = await plantingService.listByOwner(ownerId);
        // ก่อน 2026-09-06 ข้อนี้คืนรายการว่าง: บันทึกของเกษตรกรหายไปจากจอของเขาเอง
        // ขณะที่พนักงานและ QR สาธารณะยังอ่านมันได้
        expect(cycles.map((c) => String(c.id))).toContain(cycleId);
    });

    test('ใบรับรองถูกเพิกถอน — ก็ยังเห็น เพราะประวัติไม่ได้หายไปกับใบรับรอง', async () => {
        await prisma.certificate.update({ where: { id: certId }, data: { status: 'REVOKED' } });
        const cycles = await plantingService.listByOwner(ownerId);
        expect(cycles.map((c) => String(c.id))).toContain(cycleId);
    });

    test('รอบของฟาร์มคนอื่นยังไม่โผล่มา — เปิดให้เห็นของตัวเอง ไม่ใช่เปิดให้เห็นของทุกคน', async () => {
        const stranger = uid();
        const cycles = await plantingService.listByOwner(stranger);
        expect(cycles.map((c) => String(c.id))).not.toContain(cycleId);
    });
});
