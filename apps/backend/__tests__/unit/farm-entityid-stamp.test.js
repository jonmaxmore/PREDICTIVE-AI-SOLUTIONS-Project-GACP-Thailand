// Farm-worker Wave A, Chunk 2 (2026-07-02) — Farm.entityId runtime write path.
//
// Before this chunk, Farm.entityId was only ever populated by the run-once
// backfill script: farm-service.createFarm and the wizard-submit
// tx.farm.create stamped ownerId only. Because the tenant-prisma-extension
// ANDs `entityId: <active entity>` into every Farm read when an entity
// context is bound (which bindScopes does on every authenticated request),
// a runtime-created farm (entityId=null) silently disappears from list reads.
//
// Contract pinned here:
//   - createFarm stamps entityId from the active-entity ALS context
//   - an explicit options.entityId (threaded from req.activeEntity by the
//     route, mirroring the applications.js precedent) wins over ALS
//   - no context and no option → entityId: null (null-safe — NEVER a lookup
//     that could throw; scripts/seeds keep working)
//   - executeWizardSubmission's tx.farm.create stamps entityId the same way

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
const { runWithEntityContext } = require('../../services/entity-context');
const { createApplicationSubmissionMethods } = require('../../services/application-service/application-submission-methods');

const FARM_DATA = {
    farmName: 'ฟาร์มทดสอบ',
    address: '42 หมู่ 3',
    province: 'เชียงใหม่',
    district: 'แม่ริม',
    subDistrict: 'ริมใต้',
};

describe('Wave A chunk 2 — createFarm stamps Farm.entityId', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        prisma.farm.create.mockResolvedValue({ id: 'farm-1' });
    });

    it('stamps entityId from the active-entity ALS context', async () => {
        await runWithEntityContext({ entityId: 'ent-ctx-1', role: 'OWNER' }, () =>
            farmService.createFarm('user-1', FARM_DATA, null),
        );
        expect(prisma.farm.create).toHaveBeenCalledTimes(1);
        expect(prisma.farm.create.mock.calls[0][0].data.entityId).toBe('ent-ctx-1');
        expect(prisma.farm.create.mock.calls[0][0].data.ownerId).toBe('user-1');
    });

    it('prefers an explicit options.entityId (route-threaded req.activeEntity) over ALS', async () => {
        await runWithEntityContext({ entityId: 'ent-ctx-1', role: 'OWNER' }, () =>
            farmService.createFarm('user-1', FARM_DATA, null, { entityId: 'ent-explicit-2' }),
        );
        expect(prisma.farm.create.mock.calls[0][0].data.entityId).toBe('ent-explicit-2');
    });

    it('is null-safe without any entity context (scripts/seeds) — entityId: null, no throw', async () => {
        await expect(farmService.createFarm('user-1', FARM_DATA, null)).resolves.toEqual({ id: 'farm-1' });
        expect(prisma.farm.create.mock.calls[0][0].data.entityId).toBeNull();
    });
});

describe('Wave A chunk 2 — executeWizardSubmission tx.farm.create stamps Farm.entityId', () => {
    function buildHarness() {
        const tx = {
            user: { update: jest.fn().mockResolvedValue({}) },
            farm: { create: jest.fn().mockResolvedValue({ id: 'farm-tx-1' }) },
            plot: { create: jest.fn().mockResolvedValue({}) },
            application: { create: jest.fn().mockResolvedValue({ id: 'app-1' }) },
            applicationDraft: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        };
        const mockPrisma = { $transaction: jest.fn((fn) => fn(tx)) };
        const feeService = {
            calculateApplicationFees: jest.fn().mockReturnValue({
                phase1: { total: 5535 },
                phase2: { total: 27675 },
                scopeCount: 1,
            }),
        };
        const methods = createApplicationSubmissionMethods({
            prisma: mockPrisma,
            feeService,
            logger: { info: () => {}, error: () => {} },
        });
        return { tx, methods };
    }

    const PAYLOAD = {
        applicantData: null,
        farmData: {
            farmName: 'ฟาร์ม wizard',
            address: '42 หมู่ 3',
            province: 'เชียงใหม่',
            district: 'แม่ริม',
            subdistrict: 'ริมใต้',
            postalCode: '50180',
        },
        plots: [],
        documents: [],
        locationType: 'OUTDOOR',
        cultivationMethods: ['OUTDOOR'],
    };

    it('stamps entityId from the active-entity ALS context inside the tx', async () => {
        const { tx, methods } = buildHarness();
        await runWithEntityContext({ entityId: 'ent-wizard-1', role: 'OWNER' }, () =>
            methods.executeWizardSubmission('user-1', 'health-token-1', PAYLOAD),
        );
        expect(tx.farm.create).toHaveBeenCalledTimes(1);
        expect(tx.farm.create.mock.calls[0][0].data.entityId).toBe('ent-wizard-1');
    });

    it('is null-safe without an entity context — entityId: null', async () => {
        const { tx, methods } = buildHarness();
        await methods.executeWizardSubmission('user-1', 'health-token-1', PAYLOAD);
        expect(tx.farm.create.mock.calls[0][0].data.entityId).toBeNull();
    });

    // Wave A fix S3 (adversarial-verify 2026-07-02): the application row
    // created in the same tx stamps entityId from the same ALS context the
    // farm stamp uses (flag-dead path today — consistency so a later enable
    // does not birth entityId=null applications).
    it('S3: tx.application.create stamps entityId from the same ALS context', async () => {
        const { tx, methods } = buildHarness();
        await runWithEntityContext({ entityId: 'ent-wizard-1', role: 'OWNER' }, () =>
            methods.executeWizardSubmission('user-1', 'health-token-1', PAYLOAD),
        );
        expect(tx.application.create).toHaveBeenCalledTimes(1);
        expect(tx.application.create.mock.calls[0][0].data.entityId).toBe('ent-wizard-1');
    });

    it('S3: tx.application.create is null-safe without an entity context', async () => {
        const { tx, methods } = buildHarness();
        await methods.executeWizardSubmission('user-1', 'health-token-1', PAYLOAD);
        expect(tx.application.create.mock.calls[0][0].data.entityId).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────
// Wave A fix M3 (adversarial-verify 2026-07-02) — the THIRD runtime
// farm-create path: certificate auto-issue (resolveFarmForCertificate)
// births the farm that cultivation flows then operate on. It runs under
// the AUDITOR's provider context, so the ALS entity context is useless
// there — the entity dimension must come from the APPLICATION row
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
