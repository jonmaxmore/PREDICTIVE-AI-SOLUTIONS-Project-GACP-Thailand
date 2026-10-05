// Farm.entityId on the runtime write paths.
//
// R2 Task 10 (spec 2026-09-30-remove-workspace-mode §3.2 "Farm create (B7/B8)"):
// the farm's holder is named by the caller, never inferred.
//   - createFarm(ownerId, data, file, { entityId }) writes exactly that entityId
//   - without entityId it throws BEFORE any write (there is no context
//     fallback: a silent default is the same defect as the header default;
//     the active-entity ALS itself was removed in R2 Task 12)
//   - the legacy /api/wizard door and its executeWizardSubmission farm write
//     are deleted (spec §3.2 "Wizard-created farm (B6)"); the live submit door
//     stamps draft.entityId (submit-materialises-the-farm-the-certificate-names)

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        farm: { create: jest.fn() },
    },
}));

jest.mock('../../services/cache-service', () => ({
    invalidateAnalyticsCache: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../shared/logger', () => {
    const noop = () => {};
    return {
        debug: noop, info: noop, warn: noop, error: noop,
        createLogger: () => ({ debug: noop, info: noop, warn: noop, error: noop }),
    };
});

const { prisma } = require('../../services/prisma-database');
const farmService = require('../../services/farm-service');

const FARM_DATA = {
    farmName: 'ฟาร์มทดสอบ',
    address: '42 หมู่ 3',
    province: 'เชียงใหม่',
    district: 'แม่ริม',
    subDistrict: 'ริมใต้',
};

describe('R2 Task 10: createFarm writes the holder the caller names', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        prisma.farm.create.mockResolvedValue({ id: 'farm-1' });
    });

    it('stamps options.entityId', async () => {
        await farmService.createFarm('user-1', FARM_DATA, null, { entityId: 'ent-explicit-2' });
        expect(prisma.farm.create).toHaveBeenCalledTimes(1);
        expect(prisma.farm.create.mock.calls[0][0].data.entityId).toBe('ent-explicit-2');
        expect(prisma.farm.create.mock.calls[0][0].data.ownerId).toBe('user-1');
    });

    it('the entityId the caller names is written (no active-entity context exists any more)', async () => {
        await farmService.createFarm('user-1', FARM_DATA, null, { entityId: 'ent-explicit-2' });
        expect(prisma.farm.create.mock.calls[0][0].data.entityId).toBe('ent-explicit-2');
    });

    it('createFarm without entityId throws and writes nothing', async () => {
        await expect(farmService.createFarm('user-1', FARM_DATA, null)).rejects.toThrow(TypeError);
        await expect(farmService.createFarm('user-1', FARM_DATA, null, {})).rejects.toThrow(TypeError);
        await expect(farmService.createFarm('user-1', FARM_DATA, null, { entityId: '   ' })).rejects.toThrow(TypeError);
        expect(prisma.farm.create).not.toHaveBeenCalled();
    });

    it('a body entityId inside data never reaches the row; only options.entityId does', async () => {
        await farmService.createFarm('user-1', { ...FARM_DATA, entityId: 'ent-from-body' }, null, { entityId: 'ent-named' });
        expect(prisma.farm.create.mock.calls[0][0].data.entityId).toBe('ent-named');
    });
});

// ─────────────────────────────────────────────────────────────────────
// Wave A fix M3 (adversarial-verify 2026-07-02) — the THIRD runtime
// farm-create path: certificate auto-issue (resolveFarmForCertificate)
// births the farm that cultivation flows then operate on. It runs under
// the AUDITOR's provider context, so no request context could name the
// holder — the entity dimension must come from the APPLICATION row
// (app.entityId, stamped at draft-create). Create-only: the farm-REUSE
// update branch must never clobber an existing farm's entityId (a null
// app.entityId would evict the farm from every workspace read).
// ─────────────────────────────────────────────────────────────────────
describe('Wave A fix M3 — cert auto-issue farm.create stamps Farm.entityId', () => {
    const certificateService = require('../../services/certificate-service');

    function buildClient() {
        return {
            farm: {
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({ id: 'farm-cert-1' }),
                update: jest.fn().mockResolvedValue({ id: 'farm-cert-1' }),
            },
        };
    }

    const APP = {
        entityId: 'ent-app-1',
        organizationId: 'org-1',
        areaType: 'OUTDOOR',
        applicant: { id: 'owner-1' },
        formData: {
            // ที่ตั้งครบ — การ์ด refuseFarmLocation (bb9c02ff บน main) ปฏิเสธการออกใบ
            // เมื่อขาด จังหวัด/อำเภอ/ตำบล/ไปรษณีย์ · fixture เดิมเกิดก่อนการ์ดจึงแดงทั้งชุด
            farmData: {
                farmName: 'ฟาร์ม cert', address: '42 หมู่ 3',
                province: 'เชียงใหม่', district: 'สันทราย',
                subDistrict: 'หนองหาร', postalCode: '50290',
            },
            locationData: {},
            productionData: {},
        },
    };

    beforeEach(() => jest.clearAllMocks());

    it('farm.create carries entityId from the application row', async () => {
        const client = buildClient();
        await certificateService.resolveFarmForCertificate(APP, 'provider-1', client);
        expect(client.farm.create).toHaveBeenCalledTimes(1);
        const data = client.farm.create.mock.calls[0][0].data;
        expect(data.entityId).toBe('ent-app-1');
        expect(data.organizationId).toBe('org-1');
        expect(data.ownerId).toBe('owner-1');
    });

    it('legacy application without entityId → stamps null (never throws)', async () => {
        const client = buildClient();
        const legacyApp = { ...APP, entityId: undefined };
        await certificateService.resolveFarmForCertificate(legacyApp, 'provider-1', client);
        expect(client.farm.create.mock.calls[0][0].data.entityId).toBeNull();
    });

    it('farm-REUSE update branch does NOT touch entityId (no clobber)', async () => {
        const client = buildClient();
        client.farm.findFirst.mockResolvedValue({
            id: 'farm-exist', farmName: 'ฟาร์มเดิม', entityId: 'ent-existing',
        });
        await certificateService.resolveFarmForCertificate(APP, 'provider-1', client);
        expect(client.farm.create).not.toHaveBeenCalled();
        expect(client.farm.update).toHaveBeenCalledTimes(1);
        expect(client.farm.update.mock.calls[0][0].data).not.toHaveProperty('entityId');
    });
});
