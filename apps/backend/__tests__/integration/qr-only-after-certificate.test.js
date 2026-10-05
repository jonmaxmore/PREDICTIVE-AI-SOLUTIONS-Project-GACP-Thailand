/**
 * ป้าย QR ของแปลง ออกได้เมื่อแปลงนั้นมีใบรับรองที่ยังมีผล
 *
 * มติ T&T (design note 2026-08-20-planting-tnt-design, สรุปไว้ในความจำ
 * ของโครงการว่า "planting locked until cert, **QR after cert only**") · การบันทึกรอบปลูก
 * ถูกบังคับข้อนี้แล้ว (PLANTING_REQUIRES_CERTIFICATE) แต่การ **ออกป้าย QR** ไม่เคยถูกถาม
 *
 * วัดจริง 2026-09-06: ทำให้ใบรับรองหมดอายุ แล้วยิง
 * `POST /api/planting-cycles/:id/plot-qrs/generate` → **201 พร้อม QR ใหม่ที่ถูกบันทึกไว้จริง**
 * และเมื่อเอา QR นั้นไปสแกน หน้าสาธารณะตอบ 200 ตามปกติ
 *
 * ทำไมสำคัญ: ป้าย QR คือเครื่องหมายของระบบรับรองที่ปักอยู่บนที่ดินจริง คนเดินผ่านสแกนแล้ว
 * เห็นหน้าของระบบ GACP · การยอมให้ออกป้ายใหม่กับที่ดินที่ใบรับรองหมดอายุหรือถูกเพิกถอน
 * คือการที่แพลตฟอร์มออกเครื่องหมายรับรองให้พื้นที่ที่ไม่ได้รับการรับรองอีกต่อไป
 *
 * ป้ายที่ออกไปแล้ว **ไม่ถูกลบ** ด้วยกฎข้อนี้ — เป็นคนละเรื่องกับการออกใบใหม่ และการลบของเก่า
 * ต้องเป็นการตัดสินใจที่มีคนสั่ง ไม่ใช่ผลข้างเคียงของวันหมดอายุ
 */

'use strict';

const crypto = require('crypto');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

d('ออกป้าย QR ได้เมื่อมีใบรับรองที่ยังมีผล (real Postgres)', () => {
    let prisma;
    let plantingCycleService;
    let runWithTenantContext;
    let orgId;
    const created = { orgs: [], users: [], farms: [], certs: [], cycles: [], plots: [], apps: [], plants: [] };
    const uid = () => crypto.randomUUID();
    const digits13 = (s) => s.replace(/\D/g, '').padEnd(13, '6').slice(0, 13);

    let cycleId;
    let certId;
    let ownEntityIds = [];

    const loadCycle = async () => prisma.plantingCycle.findUnique({
        where: { id: cycleId },
        include: { cyclePlots: { include: { plot: true } }, farm: true },
    });

    beforeAll(async () => {
        ({ prisma } = require('../../services/prisma-database'));
        plantingCycleService = require('../../services/planting-cycle-service');
        ({ runWithTenantContext } = require('../../services/tenant-context'));

        orgId = uid();
        await prisma.organization.create({
            data: { id: orgId, name: `o-${orgId.slice(0, 8)}`, slug: `o-${orgId.slice(0, 8)}`, code: `O_${orgId.slice(0, 8).toUpperCase()}` },
        });
        created.orgs.push(orgId);

        const ownerId = uid();
        await prisma.user.create({
            data: {
                id: ownerId, canonicalId: `can-${ownerId}`, email: `qr-${ownerId.slice(0, 8)}@qr.test`,
                password: 'x', firstName: 'เจ้าของ', lastName: 'ป้าย', role: 'health',
                organizationId: orgId, authType: 'HEALTH_ID', healthId: digits13(ownerId),
            },
        });
        created.users.push(ownerId);

        const farmId = uid();
        await prisma.farm.create({
            data: {
                id: farmId, ownerId, organizationId: orgId, farmName: `สวนป้าย ${uid().slice(0, 6)}`,
                farmType: 'CULTIVATION', address: '1 หมู่ 1', subDistrict: 'ต', district: 'อ',
                province: 'จ', postalCode: '50000', totalArea: 10, cultivationArea: 8,
                cultivationMethod: 'OUTDOOR', status: 'ACTIVE',
            },
        });
        created.farms.push(farmId);

        const plot = await prisma.plot.create({
            data: {
                id: uid(), farmId, organizationId: orgId, name: 'แปลงทดสอบป้าย',
                area: 4, areaUnit: 'SQM', solarSystem: 'OUTDOOR',
            },
        });
        created.plots.push(plot.id);

        let plant = await prisma.plantSpecies.findFirst({ where: { code: 'CAN' } });
        if (!plant) {
            plant = await prisma.plantSpecies.create({ data: { id: uid(), code: 'CAN', nameTH: 'กัญชา', nameEN: 'Cannabis' } });
            created.plants.push(plant.id);
        }

        const ownerRow = await prisma.user.findUnique({ where: { id: ownerId }, select: { canonicalId: true } });
        const app = await prisma.application.create({
            data: {
                id: uid(), organizationId: orgId, healthId: ownerRow.canonicalId,
                applicationNumber: `APP-QR-${uid().slice(0, 8)}`, status: 'CERTIFIED',
                areaType: 'OUTDOOR', serviceType: 'new_application', formData: {},
            },
        });
        created.apps.push(app.id);

        certId = uid();
        await prisma.certificate.create({
            data: {
                id: certId, organizationId: orgId, farmId, applicationId: app.id, userId: ownerId,
                verificationCode: `VC-${uid().slice(0, 8)}`, qrData: 'x',
                farmName: 'สวนป้าย', applicantName: 'เจ้าของ ป้าย', cropType: 'cannabis', farmSize: 10,
                province: 'จ', district: 'อ', subDistrict: 'ต',
                standardId: 'THAI_GACP', standardName: 'GACP', issuedBy: 'DTAM',
                certificateNumber: `GACP-QR-${uid().slice(0, 6)}`, status: 'active',
                issuedDate: new Date('2026-01-01'),
                expiryDate: new Date(Date.now() + 365 * 24 * 3600 * 1000),
            },
        });
        created.certs.push(certId);

        const cycle = await prisma.plantingCycle.create({
            data: {
                id: uid(), farmId, plantSpeciesId: plant.id, organizationId: orgId,
                certificateId: certId, cycleName: `รอบป้าย ${uid().slice(0, 6)}`,
                startDate: new Date('2026-03-01'), status: 'GROWING', cultivationType: 'OUTDOOR',
                cyclePlots: {
                    create: [{
                        id: uid(), plotId: plot.id, organizationId: orgId,
                        allocatedAreaSqm: 4, plannedPlantCount: 10,
                    }],
                },
            },
        });
        cycleId = cycle.id;
        created.cycles.push(cycleId);
        // เก็บ entityId ของ assignment ที่ชุดนี้สร้าง เพื่อลบเฉพาะแถวของตัวเองตอนจบ
        ownEntityIds = (await prisma.plantingCyclePlot.findMany({
            where: { cycleId }, select: { id: true },
        })).map((row) => row.id);
    });

    afterAll(async () => {
        // เฉพาะแถวที่ชุดนี้สร้างเท่านั้น — เคยลบด้วย entityType ล้วน ซึ่งกวาด QR ของทั้งฐาน
        // รวมป้ายที่ walk อื่นกำลังใช้อยู่ · เทสต้องเก็บของของตัวเอง ไม่ใช่ของทุกคน
        if (ownEntityIds.length > 0) {
            await prisma.traceQrSecurity.deleteMany({
                where: { entityType: 'PLANTING_CYCLE_PLOT', entityId: { in: ownEntityIds } },
            });
        }
        for (const id of created.cycles) { await prisma.plantingCyclePlot.deleteMany({ where: { cycleId: id } }); }
        for (const id of created.cycles) { await prisma.plantingCycle.deleteMany({ where: { id } }); }
        for (const id of created.certs) { await prisma.certificate.deleteMany({ where: { id } }); }
        for (const id of created.apps) { await prisma.application.deleteMany({ where: { id } }); }
        for (const id of created.plots) { await prisma.plot.deleteMany({ where: { id } }); }
        for (const id of created.farms) { await prisma.farm.deleteMany({ where: { id } }); }
        for (const id of created.users) { await prisma.user.deleteMany({ where: { id } }); }
        for (const id of created.plants) { await prisma.plantSpecies.deleteMany({ where: { id } }); }
        for (const id of created.orgs) { await prisma.organization.deleteMany({ where: { id } }); }
    });

    test('ใบรับรองยังมีผล — ออกป้ายได้', async () => {
        const result = await runWithTenantContext({ organizationId: orgId }, async () => plantingCycleService.generatePlotCycleQrsForCycle(await loadCycle()));
        expect(result.status).not.toBe('failed');
        expect(result.generated.length).toBeGreaterThan(0);
    });

    test('ใบรับรองหมดอายุ — ออกป้ายใหม่ไม่ได้ และบอกเหตุผลเป็นภาษาที่เกษตรกรอ่านได้', async () => {
        await prisma.traceQrSecurity.deleteMany({
            where: { entityType: 'PLANTING_CYCLE_PLOT', entityId: { in: ownEntityIds } },
        });
        await prisma.certificate.update({ where: { id: certId }, data: { expiryDate: new Date('2026-01-02') } });

        const result = await runWithTenantContext({ organizationId: orgId }, async () => plantingCycleService.generatePlotCycleQrsForCycle(await loadCycle()));
        expect(result.status).toBe('failed');
        expect(result.code).toBe('QR_REQUIRES_ACTIVE_CERTIFICATE');
        expect(String(result.error || '')).toMatch(/ใบรับรอง/);

        const minted = await prisma.traceQrSecurity.count({
            where: { entityType: 'PLANTING_CYCLE_PLOT', entityId: { in: ownEntityIds } },
        });
        expect(minted).toBe(0);
    });

    test('ใบรับรองถูกเพิกถอน — ออกป้ายใหม่ไม่ได้เช่นกัน', async () => {
        await prisma.certificate.update({
            where: { id: certId },
            data: { expiryDate: new Date(Date.now() + 365 * 24 * 3600 * 1000), status: 'REVOKED' },
        });
        const result = await runWithTenantContext({ organizationId: orgId }, async () => plantingCycleService.generatePlotCycleQrsForCycle(await loadCycle()));
        expect(result.status).toBe('failed');
        expect(result.code).toBe('QR_REQUIRES_ACTIVE_CERTIFICATE');
    });

    test('ป้ายที่ออกไปแล้วไม่ถูกลบด้วยกฎข้อนี้ — คนละเรื่องกับการออกใบใหม่', async () => {
        await prisma.certificate.update({ where: { id: certId }, data: { status: 'active' } });
        const ok = await runWithTenantContext({ organizationId: orgId }, async () => plantingCycleService.generatePlotCycleQrsForCycle(await loadCycle()));
        expect(ok.status).not.toBe('failed');
        const before = await prisma.traceQrSecurity.count({
            where: { entityType: 'PLANTING_CYCLE_PLOT', status: 'ACTIVE', entityId: { in: ownEntityIds } },
        });

        await prisma.certificate.update({ where: { id: certId }, data: { status: 'REVOKED' } });
        await runWithTenantContext({ organizationId: orgId }, async () => plantingCycleService.generatePlotCycleQrsForCycle(await loadCycle())).catch(() => null);

        const after = await prisma.traceQrSecurity.count({
            where: { entityType: 'PLANTING_CYCLE_PLOT', status: 'ACTIVE', entityId: { in: ownEntityIds } },
        });
        expect(after).toBe(before);
    });
});
