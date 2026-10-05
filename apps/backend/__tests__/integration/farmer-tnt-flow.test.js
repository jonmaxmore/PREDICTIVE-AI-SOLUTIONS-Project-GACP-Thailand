/**
 * สายงานของเกษตรกรฝั่ง T&T — รหัสแปลงถาวร การอัปเดตข้อมูล และผลแล็บ บนฐานข้อมูลจริง
 *
 * มติ operator วางกติกาไว้สี่ข้อ และทั้งสี่ต้องเดินได้จริง ไม่ใช่ถูกต้องแค่ในเอกสาร:
 *
 *   ① รหัสแปลงถาวร      ป้ายที่ตอกไว้ที่เสาต้องอยู่ข้ามฤดู ไม่ใช่พิมพ์ใหม่ทุกรอบปลูก
 *   ② อัปเดตได้ก่อนตัด    ก่อนเก็บเกี่ยว เกษตรกรแก้ข้อมูลรอบปลูกของตัวเองได้
 *   ③ แช่แข็งหลังตัด      หลังเก็บเกี่ยว ข้อมูลที่ขึ้นหน้าสแกนสาธารณะแก้ไม่ได้อีก — ยกเว้น `notes`
 *   ④ ผลแล็บเป็นเอกสาร   แนบไฟล์ COA ที่ *รุ่น* ไม่ใช่พิมพ์ตัวเลขเอง และล็อตสืบทอดจากรุ่น
 *
 * ทำไมต้องเป็นเทสบนฐานจริง: ข้อ ① พึ่ง Prisma extension ที่ทำงานตอน **เขียนลงฐาน** เท่านั้น
 * (services/plot-code-extension.js) — mock ทุกชนิดมองไม่เห็นมัน · และข้อ ③ พึ่งสถานะจริง
 * ของรอบปลูกที่เปลี่ยนไปตามการเก็บเกี่ยว
 */

const crypto = require('crypto');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

d('สายงาน T&T ของเกษตรกร: รหัสถาวร อัปเดต แช่แข็ง และผลแล็บ (real Postgres)', () => {
    let prisma;
    let plantingService;
    let plotQrRow;
    let labService;
    const created = { orgs: [], users: [], farms: [], plots: [], cycles: [], batches: [], labs: [] };
    const uid = () => crypto.randomUUID();
    const digits13 = (s) => s.replace(/\D/g, '').padEnd(13, '7').slice(0, 13);

    let ctx = {};

    beforeAll(async () => {
        ({ prisma } = require('../../services/prisma-database'));
        plantingService = require('../../services/planting-service');
        plotQrRow = require('../../services/plot-qr-row');
        labService = require('../../services/batch-lab-result-service');

        const orgId = uid();
        await prisma.organization.create({
            data: { id: orgId, name: `org-${orgId.slice(0, 8)}`, slug: `org-${orgId.slice(0, 8)}`, code: `ORG_${orgId.slice(0, 8).toUpperCase()}` },
        });
        created.orgs.push(orgId);

        const ownerId = uid();
        await prisma.user.create({
            data: {
                id: ownerId, canonicalId: `can-${ownerId}`,
                email: `o-${ownerId.slice(0, 8)}@example.test`, password: 'x',
                firstName: 'เกษตรกร', lastName: 'ทดสอบ', role: 'health', organizationId: orgId,
                authType: 'HEALTH_ID', healthId: digits13(ownerId),
            },
        });
        created.users.push(ownerId);

        const farmId = uid();
        await prisma.farm.create({
            data: {
                id: farmId, ownerId, organizationId: orgId,
                farmName: 'สวนทดสอบสายงาน', farmType: 'CULTIVATION',
                address: '1 หมู่ 1', subDistrict: 'ต', district: 'อ', province: 'จ', postalCode: '50000',
                totalArea: 1000, cultivationArea: 800, cultivationMethod: 'OUTDOOR', status: 'ACTIVE',
            },
        });
        created.farms.push(farmId);

        let plant = await prisma.plantSpecies.findFirst({ where: { code: 'CAN' } });
        if (!plant) {
            plant = await prisma.plantSpecies.create({ data: { id: uid(), code: 'CAN', nameTH: 'กัญชา', nameEN: 'Cannabis' } });
        }

        ctx = { orgId, ownerId, farmId, plantId: plant.id };
    });

    afterAll(async () => {
        for (const id of created.labs) { await prisma.batchLabResult.deleteMany({ where: { id } }); }
        for (const id of created.batches) { await prisma.harvestBatch.deleteMany({ where: { id } }); }
        for (const id of created.cycles) {
            await prisma.plantingCyclePlot.deleteMany({ where: { cycleId: id } });
            await prisma.plantingCycle.deleteMany({ where: { id } });
        }
        for (const id of created.plots) { await prisma.plot.deleteMany({ where: { id } }); }
        for (const id of created.farms) { await prisma.farm.deleteMany({ where: { id } }); }
        for (const id of created.users) { await prisma.user.deleteMany({ where: { id } }); }
        for (const id of created.orgs) { await prisma.organization.deleteMany({ where: { id } }); }
    });

    describe('① รหัสแปลงถาวร', () => {
        let plot;

        test('แปลงเกิดมาพร้อมรหัสถาวรเสมอ — ไม่มีทางสร้างแปลงที่ไม่มีรหัสได้', async () => {
            // เขียนผ่าน client ตัวจริง เพราะ extension ทำงานตอนเขียนเท่านั้น
            plot = await prisma.plot.create({
                data: {
                    id: uid(), farmId: ctx.farmId, name: 'แปลงเหนือ',
                    areaSqm: 400, area: 400, areaUnit: 'sqm', solarSystem: 'OUTDOOR',
                    organizationId: ctx.orgId,
                },
            });
            created.plots.push(plot.id);
            expect(plot.plotCode).toMatch(/^PLOT-[0-9A-Z]{5}-[0-9A-Z]{5}$/);
        });

        test('ประตู QR ส่งรหัสถาวรออกมา และแยกจากผนึกรายฤดูอย่างชัดเจน', () => {
            const row = plotQrRow.buildPlotQrRow({
                assignment: { id: 'cp-1', plot, allocatedAreaSqm: 400, plannedPlantCount: 10 },
                seasonal: { qrCode: 'seasonal-uuid', publicUrl: 'https://x/trace/plot-cycle/seasonal-uuid' },
                cultivationType: 'OUTDOOR',
            });
            expect(row.plotCode).toBe(plot.plotCode);
            expect(row.seasonalQrCode).toBe('seasonal-uuid');
            // สองตัวตนต้องไม่ใช่ค่าเดียวกัน ไม่งั้นป้ายถาวรจะกลายเป็นป้ายรายฤดูโดยไม่มีใครรู้
            expect(row.plotCode).not.toBe(row.seasonalQrCode);
        });

        test('รหัสไม่เปลี่ยนเมื่อแก้ข้อมูลอื่นของแปลง — ป้ายที่ตอกไว้แล้วต้องไม่กลายเป็นขยะ', async () => {
            const after = await prisma.plot.update({
                where: { id: plot.id }, data: { name: 'แปลงเหนือ (แก้ชื่อ)' },
            });
            expect(after.plotCode).toBe(plot.plotCode);
        });
    });

    describe('② อัปเดตก่อนตัด และ ③ แช่แข็งหลังตัด', () => {
        let cycleId;

        beforeAll(async () => {
            const cycle = await prisma.plantingCycle.create({
                data: {
                    id: uid(), farmId: ctx.farmId, plantSpeciesId: ctx.plantId, organizationId: ctx.orgId,
                    cycleName: 'รอบทดสอบ', startDate: new Date('2026-01-01'),
                    status: 'GROWING', cultivationType: 'OUTDOOR',
                    seedSource: 'แหล่งเดิม', varietyName: 'พันธุ์เดิม', notes: 'บันทึกเดิม',
                },
            });
            created.cycles.push(cycle.id);
            cycleId = cycle.id;
        });

        test('ก่อนตัด แก้ข้อมูลที่ขึ้นหน้าสแกนได้', async () => {
            const updated = await plantingService.updateCycle(cycleId, { varietyName: 'พันธุ์ใหม่' }, ctx.ownerId);
            expect(updated.varietyName).toBe('พันธุ์ใหม่');
        });

        test('หลังตัด ข้อมูลที่ขึ้นหน้าสแกนถูกปฏิเสธ พร้อมบอกชื่อช่องเป็นภาษาไทย', async () => {
            await prisma.plantingCycle.update({ where: { id: cycleId }, data: { status: 'HARVESTED' } });
            await expect(
                plantingService.updateCycle(cycleId, { varietyName: 'พยายามแก้หลังตัด' }, ctx.ownerId),
            ).rejects.toMatchObject({ code: 'CYCLE_FROZEN' });

            try {
                await plantingService.updateCycle(cycleId, { seedSource: 'x' }, ctx.ownerId);
            } catch (e) {
                expect(e.messageTh || e.message).toMatch(/[ก-๙]/);
                expect(e.fields).toContain('seedSource');
            }
        });

        test('แต่ `notes` ยังแก้ได้ — มันไม่ได้ขึ้นหน้าสแกน และเป็นบันทึกของเกษตรกรเอง', async () => {
            const updated = await plantingService.updateCycle(cycleId, { notes: 'บันทึกใหม่หลังเก็บเกี่ยว' }, ctx.ownerId);
            expect(updated.notes).toBe('บันทึกใหม่หลังเก็บเกี่ยว');
            // และของที่แช่แข็งไว้ต้องไม่ถูกแก้ไปด้วยโดยบังเอิญ
            expect(updated.varietyName).toBe('พันธุ์ใหม่');
        });
    });

    describe('④ ผลแล็บเป็นเอกสาร ไม่ใช่ตัวเลขที่พิมพ์เอง', () => {
        let batchId;

        beforeAll(async () => {
            const batch = await prisma.harvestBatch.create({
                data: {
                    id: uid(), farmId: ctx.farmId, cycleId: created.cycles[0], organizationId: ctx.orgId,
                    batchNumber: `HB-TNT-${uid().slice(0, 6)}`, harvestDate: new Date('2026-06-01'),
                    freshWeight: 10, dryWeight: 3, plantCode: 'CAN', status: 'HARVESTED',
                },
            });
            created.batches.push(batch.id);
            batchId = batch.id;
        });

        test('ไม่มีไฟล์ = ปฏิเสธ · ไม่มีชื่อแล็บ = ปฏิเสธ — รายงานที่ไม่มีผู้ออกพิสูจน์อะไรไม่ได้', () => {
            const FILE = { originalname: 'coa.pdf', filename: 's.pdf', path: '/tmp/s.pdf', size: 40960, mimetype: 'application/pdf' };
            expect(() => labService.assertLabUploadInput({ file: null, labName: 'ก' }))
                .toThrow(expect.objectContaining({ code: 'LAB_FILE_REQUIRED' }));
            expect(() => labService.assertLabUploadInput({ file: FILE, labName: '   ' }))
                .toThrow(expect.objectContaining({ code: 'LAB_NAME_REQUIRED' }));
        });

        test('แนบ COA เข้ารุ่นได้จริง และแถวที่ได้ไม่มีช่องให้พิมพ์ค่า', async () => {
            const batch = await prisma.harvestBatch.findUnique({ where: { id: batchId } });
            const row = labService.buildLabResultRow({
                batch, file: { originalname: 'coa.pdf', filename: 'stored.pdf', size: 40960, mimetype: 'application/pdf' },
                labName: 'ห้องปฏิบัติการกลาง', reportNumber: 'CL-2569-001',
                uploadedBy: ctx.ownerId, fileUrl: '/uploads/lab-results/stored.pdf',
            });
            const saved = await prisma.batchLabResult.create({ data: row });
            created.labs.push(saved.id);

            expect(saved.harvestBatchId).toBe(batchId);
            expect(saved.verificationStatus).toBe('FARMER_UPLOADED');
            for (const forbidden of ['thcContent', 'cbdContent', 'moistureContent']) {
                expect(saved[forbidden]).toBeUndefined();
            }
        });

        test('ล็อตสืบทอดผลแล็บจากรุ่น — ไม่ต้องอัปโหลดซ้ำทุกถุง', async () => {
            const { lotLabEvidence } = require('../../services/lab-evidence-service');
            const batch = await prisma.harvestBatch.findUnique({
                where: { id: batchId }, include: { labResults: true },
            });
            const evidence = lotLabEvidence({ batch });
            expect(evidence.subject).toBe('LOT');
            expect(evidence.tested).toBe(true);
            expect(evidence.latest.labName).toBe('ห้องปฏิบัติการกลาง');
        });

        test('ประตูล็อตยังปฏิเสธค่าที่พิมพ์เอง — กติกาเดียวกันทั้งสองฝั่ง', () => {
            const { assertNoTypedLabValues } = require('../../services/lot-lab-claim-guard');
            expect(() => assertNoTypedLabValues({ thcContent: '0.2' }))
                .toThrow(expect.objectContaining({ code: 'LAB_VALUES_NOT_TYPED' }));
            expect(() => assertNoTypedLabValues({ packageType: 'BAG' })).not.toThrow();
        });
    });
});
