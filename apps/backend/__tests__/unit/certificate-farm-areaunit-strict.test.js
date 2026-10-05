/**
 * certificate-service.generateCertificate — farm CREATE at mint reads
 * farmData.totalAreaUnit strictly (farm-areaunit-default fix, Task 3).
 *
 * Spec: design note 2026-08-20-farm-areaunit-default-design
 * (work item 3). Before this fix, :561 read
 * `farmData.totalAreaUnit || productionData.areaUnit || AREA_UNIT` — a
 * unit-less farmData silently minted as Sqm with no trace, the same ×1,600
 * rai/sqm ambiguity class the plot path (submittedAreaSqm at :176) already
 * refuses to guess at. T1 healed the 19 legacy unit-less rows live; T2 made
 * both submit doors require the unit going forward; this closes the
 * generator itself: the unit argument is now `farmData.totalAreaUnit` alone
 * (no fallback chain), so an unhealed unit-less farmData throws through the
 * SAME mechanism the plot path uses (submittedAreaSqm -> storedAreaToSqm).
 * Reached via the application-status-writer auto-issue hook, that thrown
 * Error (no .code of its own) gets wrapped as CERT_AUTO_GEN_FAILED with a
 * rolled-back tx (application-status-writer.js:1153-1158) — the exact same
 * wrapping the plot-side strict reader already relies on, unmodified here.
 * This file drives generateCertificate directly (idiom:
 * certificate-service-evidence-gate.test.js), so the assertion is on the
 * raw thrown error message; the CERT_AUTO_GEN_FAILED wrapping itself is
 * proven separately (application-status-writer-audit-tx-semantics.test.js)
 * and is not re-implemented or re-proven here.
 *
 * productionData.areaUnit finding (spec's decision boundary): grepped
 * dead — no live writer anywhere in the tree. Neither frontend
 * `ProductionData` interface (domain-types.ts:267,
 * print-page-types.ts:82) declares an `areaUnit` field, and no backend
 * write path (the since-deleted application-submission-methods.js et al.) ever sets
 * `formData.productionData.areaUnit`. Before this fix the only two
 * references left in the codebase were the read itself
 * (certificate-service.js:561) and a test fixture
 * (certificate-farm-resolution.test.js:180) that manufactured the field
 * purely to feed that read — not a real alternative carrier, so it is
 * dropped alongside the unconditional `|| AREA_UNIT` guess, not kept as a
 * legitimate fallback between two real values.
 *
 * Fix round 1 (reviewer finding, reproduced): the strict read used to run
 * UNCONDITIONALLY, before the create/reuse branch even exists and before
 * the reuse path's own blank-guard decides whether the computed value is
 * ever written. A REUSE of an existing farm whose OWN totalArea is already
 * good was rejecting issuance over an unrelated, unread submission's
 * ambiguous unit — an availability regression beyond the spec's "farm
 * CREATE at mint" scope. Fixed: the strict read is now lazy
 * (`computeBaseArea` in certificate-service.js), evaluated only at the two
 * sites that actually WRITE the result — the create branch, and a reuse
 * whose farm.totalArea is itself blank. The two `reuse path` tests below
 * pin that: (a) valid-farm + unit-less submission now SUCCEEDS (the
 * reviewer's repro — RED on the pre-fix commit), (b) blank-farm +
 * unit-less submission still THROWS (the would-write path stays strict).
 */

'use strict';

jest.mock('../../services/prisma-database', () => ({ prisma: {} }));
jest.mock('../../services/cache-service', () => ({
    invalidateAnalyticsCache: jest.fn().mockResolvedValue(undefined),
}));

// The signing key is STUBBED here, and that is a correctness requirement, not tidiness.
// Without this mock the real signature service runs against the repo's own
// apps/backend/keys directory — and until 2026-08-26 an undecryptable key there was
// silently regenerated, so a plain `npx jest` rewrote the certifying authority's key and
// retroactively invalidated every certificate signed with the old one. That is exactly
// how GACP-TH-2569-CAE820 lost its key (measured: keys/*.pem rewritten 06:08, six minutes
// into a test run). A unit test about area units must never touch the key box.
const TRUSTED_FINGERPRINT = 'sha256:trusted-in-this-test';
jest.mock('../../services/crypto/signature-service', () => ({
    getSignatureService: () => ({
        signWithLocalKey: async () => 'fake-signature',
        getPublicKeyForNamespace: async () => 'fake-public-key-pem',
        verifyWithLocalKey: async () => true,
        getTrustedPublicKeyFingerprints: async () => new Set([TRUSTED_FINGERPRINT]),
    }),
    fingerprintPublicKey: () => TRUSTED_FINGERPRINT,
}));

const certificateService = require('../../services/certificate-service');
const { CHECKLIST_TEMPLATE_2026, DEFAULT_MIN_PHOTOS } = require('../../services/audit-onsite-service');
const { farmAuditPhotoStub } = require('../../test-support/farm-audit-photo-stub');
const { AREA_UNIT } = require('../../shared/area-utils');

function makeApp(formDataOverrides = {}) {
    return {
        id: 'app-1',
        organizationId: 'org-1',
        entityId: null,
        submitterId: null,
        applicationNumber: 'GACP-2026-001',
        status: 'AUDIT_PASSED',
        auditResult: null,
        applicant: { id: 'user-1', firstName: 'สมชาย', lastName: 'ใจดี' },
        entity: null,
        formData: {
            auditResult: 'PASS',
            auditedAt: new Date().toISOString(),
            // F-G4-58: issuance refuses an application whose plant the master does not
            // know, so the wizard's answer is stated here; the area unit stays the subject.
            plantId: 'cannabis',
            ...formDataOverrides,
        },
    };
}

/**
 * Clears every door before the farm resolver: no existing cert, no
 * cert-number collision, evidence gate satisfied (real audit row + enough
 * photos/checklist items), no farm lookup hit (findFirst -> null) so the
 * resolver always reaches farm.create — the exact CREATE call :561 feeds.
 */
function makePrisma(app) {
    return {
        // certificate number draws its running number from the ReceiptSequence series
        receiptSequence: { upsert: jest.fn(async () => ({ counter: 1 })) },
        certificate: {
            findFirst: jest.fn(async () => null),
            findUnique: jest.fn(async () => null),
            create: jest.fn(async ({ data }) => ({ id: 'cert-new', ...data })),
        },
        application: { findUnique: jest.fn(async () => app) },
        farm: {
            findFirst: jest.fn(async () => null),
            create: jest.fn(async ({ data }) => ({ id: 'farm-new', entity: null, ...data })),
        },
        plot: { count: jest.fn(async () => 1) }, // short-circuits ensurePlotsForFarm
        auditChecklist: { findFirst: jest.fn(async () => ({ id: 'audit-1', applicationId: 'app-1' })) },
        farmAuditPhoto: farmAuditPhotoStub(DEFAULT_MIN_PHOTOS),
        farmAuditChecklistItem: { count: jest.fn(async () => CHECKLIST_TEMPLATE_2026.length) },
        // F-G4-58: issuance names the plant from the master (plant-species-service),
        // read through this client, and refuses before any write when it is unknown.
        plantSpecies: {
            findUnique: jest.fn(async ({ where }) => (where.code === 'CAN'
                ? { id: 'ps-can', code: 'CAN', nameTH: 'กัญชา', nameEN: 'Cannabis' }
                : null)),
        },
    };
}

/**
 * Same base as makePrisma, but farm.findFirst answers with a REAL existing
 * farm (matched loosely on whichever `where` keys the resolver's own lookup
 * sends — id/farmName/ownerId/entityId) so resolveFarmForCertificate takes
 * the REUSE branch instead of CREATE, and farm.update is spyable.
 */
function makePrismaWithFarm(app, existingFarm) {
    const prisma = makePrisma(app);
    prisma.farm.findFirst = jest.fn(async ({ where }) => {
        if (where.id && where.id !== existingFarm.id) { return null; }
        if (where.farmName && where.farmName !== existingFarm.farmName) { return null; }
        if (where.ownerId && where.ownerId !== existingFarm.ownerId) { return null; }
        if (where.entityId && where.entityId !== existingFarm.entityId) { return null; }
        return existingFarm;
    });
    prisma.farm.update = jest.fn(async ({ data }) => ({ ...existingFarm, ...data, entity: null }));
    return prisma;
}

describe('certificate-service.generateCertificate — farm CREATE reads farmData.totalAreaUnit strictly (Task 3)', () => {
    test('RED pin: unit-less farmData at mint now THROWS instead of silently minting Sqm', async () => {
        const app = makeApp({
            // totalAreaUnit intentionally absent — the pre-T1 legacy shape.
            farmData: { farmName: 'ฟาร์มไม่มีหน่วย', totalAreaSize: '5' },
        });
        const prisma = makePrisma(app);

        await expect(
            certificateService.generateCertificate('app-1', 'auditor-1', { prisma, skipInitialAssets: true }),
        ).rejects.toThrow(/farmData\.totalAreaSize.*area has no unit/);

        expect(prisma.farm.create).not.toHaveBeenCalled();
        expect(prisma.certificate.create).not.toHaveBeenCalled();
    });

    test('happy path: Sqm farmData mints with the number unchanged', async () => {
        const app = makeApp({
            farmData: {
                farmName: 'ฟาร์มตร.ม.', totalAreaSize: '1600', totalAreaUnit: 'Sqm',
                // F-G4-52: a farm cannot be created without its location.
                address: '1 หมู่ 1', province: 'เชียงใหม่', district: 'สันทราย', subdistrict: 'แม่แฝก', postalCode: '50210',
            },
        });
        const prisma = makePrisma(app);

        await certificateService.generateCertificate('app-1', 'auditor-1', { prisma, skipInitialAssets: true });

        const { data } = prisma.farm.create.mock.calls[0][0];
        expect(data.totalArea).toBe(1600);
        expect(data.cultivationArea).toBe(1600);
    });

    test('happy path: Rai farmData converts at the real LEGACY_UNIT_TO_SQM ratio — 5 Rai -> 8000 sqm', async () => {
        const app = makeApp({
            farmData: {
                farmName: 'ฟาร์มไร่', totalAreaSize: '5', totalAreaUnit: 'Rai',
                // F-G4-52: a farm cannot be created without its location.
                address: '1 หมู่ 1', province: 'เชียงใหม่', district: 'สันทราย', subdistrict: 'แม่แฝก', postalCode: '50210',
            },
        });
        const prisma = makePrisma(app);

        await certificateService.generateCertificate('app-1', 'auditor-1', { prisma, skipInitialAssets: true });

        const { data } = prisma.farm.create.mock.calls[0][0];
        expect(data.totalArea).toBe(8000);
        expect(data.cultivationArea).toBe(8000);
    });

    test('reuse path: existing farm with valid totalArea + unit-less submission farmData -> issuance SUCCEEDS (reviewer repro)', async () => {
        const existingFarm = {
            id: 'farm-existing-1', ownerId: 'user-1', entityId: null, organizationId: 'org-1', isDeleted: false,
            farmName: 'ฟาร์มเดิม', address: 'ที่อยู่เดิม', province: 'เชียงใหม่', district: 'สันทราย',
            subDistrict: 'แม่แฝก', postalCode: '50210', farmType: 'CULTIVATION', status: 'ACTIVE',
            totalArea: 4000, cultivationArea: 4000, areaUnit: AREA_UNIT,
        };
        const app = makeApp({
            farmId: existingFarm.id,
            // unit-less — ambiguous IF read, but the reused farm's own good
            // data must never pay for it.
            farmData: { totalAreaSize: '5' },
        });
        const prisma = makePrismaWithFarm(app, existingFarm);

        const cert = await certificateService.generateCertificate('app-1', 'auditor-1', { prisma, skipInitialAssets: true });

        expect(cert).toBeDefined();
        expect(prisma.farm.update).toHaveBeenCalledTimes(1);
        const { data } = prisma.farm.update.mock.calls[0][0];
        expect(data).not.toHaveProperty('totalArea');
        expect(data).not.toHaveProperty('cultivationArea');
        expect(data).not.toHaveProperty('areaUnit');
    });

    test('reuse path: existing farm with BLANK totalArea + unit-less submission -> THROWS (would-write path stays strict)', async () => {
        const existingFarm = {
            id: 'farm-existing-2', ownerId: 'user-1', entityId: null, organizationId: 'org-1', isDeleted: false,
            farmName: 'ฟาร์มพื้นที่ว่าง', address: 'ที่อยู่เดิม', province: 'เชียงใหม่', district: 'สันทราย',
            subDistrict: 'แม่แฝก', postalCode: '50210', farmType: 'CULTIVATION', status: 'ACTIVE',
            totalArea: null, cultivationArea: null, areaUnit: AREA_UNIT,
        };
        const app = makeApp({
            farmId: existingFarm.id,
            farmData: { totalAreaSize: '5' }, // unit-less
        });
        const prisma = makePrismaWithFarm(app, existingFarm);

        await expect(
            certificateService.generateCertificate('app-1', 'auditor-1', { prisma, skipInitialAssets: true }),
        ).rejects.toThrow(/farmData\.totalAreaSize.*area has no unit/);

        expect(prisma.farm.update).not.toHaveBeenCalled();
    });
});
