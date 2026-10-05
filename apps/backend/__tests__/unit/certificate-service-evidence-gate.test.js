/**
 * certificate-service.generateCertificate — onsite evidence gate
 * (cert-integrity fix, Phase A2, 2026-08-16).
 *
 * Phase A closed the hole in ONE path (audit-onsite-service.submitDecision).
 * Adversarial review found THREE more paths that reach generateCertificate
 * with no evidence check at all:
 *   - routes/api/audit/audits.js POST /:id/result
 *   - routes/api/provider/handlers/auditor-audit-decision-handler.js
 *   - routes/api/provider/auditor.js final-approvals (direct call, bypasses
 *     the application-status-writer hook entirely)
 * generateCertificate is the ONE place every one of those funnels through
 * to actually mint a Certificate row, so the gate belongs here — see
 * the change log for the verified-Critical writeup and services/
 * onsite-evidence-gate.js for the shared fail-closed helper this calls.
 *
 * This file exercises generateCertificate directly (not through the
 * application-status-writer auto-issue hook — that rollback contract is
 * covered separately in application-status-writer-cert-hook.test.js) with
 * `skipInitialAssets: true` so the mock surface stays scoped to the
 * evidence gate itself rather than re-verifying the unrelated
 * PlantingCycle/Batch/QR bootstrap path.
 */

'use strict';

jest.mock('../../services/prisma-database', () => ({ prisma: {} }));
jest.mock('../../services/cache-service', () => ({
    invalidateAnalyticsCache: jest.fn().mockResolvedValue(undefined),
}));
// Task 3 (pin decided auditId through decision->mint): wrap the REAL gate in
// a jest.fn (spy-through-to-real) rather than a blanket success stub — the
// 4 fail-closed cases below rely on the REAL assertOnsiteEvidenceSufficient
// throwing per the prisma-level fixtures (withPhotoModel/withChecklistModel/
// photoCount/itemCount/auditRow), so a blanket mock would silently break
// them. Wrapping the real implementation keeps every existing case
// behavior-identical while making the gate spyable for the new forwarding
// test (Step 5 of the task-3 brief).
jest.mock('../../services/onsite-evidence-gate', () => {
    const actual = jest.requireActual('../../services/onsite-evidence-gate');
    return {
        ...actual,
        assertOnsiteEvidenceSufficient: jest.fn(actual.assertOnsiteEvidenceSufficient),
    };
});
// The signing key is STUBBED here, and that is a correctness requirement, not tidiness.
// Without this mock the real signature service runs against the repo's own
// apps/backend/keys directory — and until 2026-08-26 an undecryptable key there was
// silently regenerated, so a plain `npx jest` rewrote the certifying authority's key and
// retroactively invalidated every certificate signed with the old one. That is exactly
// how GACP-TH-2569-CAE820 lost its key (measured: keys/*.pem rewritten 06:08, six minutes
// into a test run). A unit test about the evidence gate must never touch the key box.
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
const gate = require('../../services/onsite-evidence-gate');
// Real module (not mocked) — read the SAME constants the gate enforces so
// this test's fixtures can never silently drift from the production values.
const { CHECKLIST_TEMPLATE_2026, DEFAULT_MIN_PHOTOS } = require('../../services/audit-onsite-service');
const { farmAuditPhotoStub } = require('../../test-support/farm-audit-photo-stub');

// F-G4-52: a farm cannot be created without its location, and the resolver
// refuses (CERTIFICATE_FARM_LOCATION_MISSING) before farm.create when any of
// the five is blank. The mint paths below run through that create branch, so
// the fixture states where the farm is.
const LOCATED_FARM_DATA = {
    // ชื่อฟาร์มก็เป็นข้อเท็จจริงที่ใบรับรองต้องระบุเหมือนที่ตั้ง (2026-09-07) — คำขอที่ไม่บอกชื่อ
    // ถูกปฏิเสธ ไม่ใช่ถูกตั้งชื่อให้ว่า 'Certified Farm' อีกต่อไป
    farmName: 'ฟาร์มของผู้ยื่น',
    address: '1 หมู่ 1', province: 'เชียงใหม่', district: 'สันทราย', subdistrict: 'แม่แฝก', postalCode: '50210',
};

function makeApp(overrides = {}) {
    return {
        id: 'app-1',
        organizationId: 'org-1',
        entityId: null,
        submitterId: null,
        applicationNumber: 'GACP-2026-001',
        status: 'AUDIT_PASSED',
        auditResult: null,
        // PR-1.3 JSON-path proof of a passing audit (required to clear the
        // hasPassRecord gate, upstream of the evidence gate under test).
        // plantId: F-G4-58 refuses an application whose plant the master does not know.
        formData: { auditResult: 'PASS', auditedAt: new Date().toISOString(), plantId: 'cannabis', farmData: LOCATED_FARM_DATA },
        applicant: { id: 'user-1', firstName: 'สมชาย', lastName: 'ใจดี' },
        entity: null,
        ...overrides,
    };
}

/**
 * Minimal prisma mock covering exactly the calls generateCertificate makes
 * BEFORE and AT the evidence gate, plus (for the sufficient-evidence test)
 * the calls needed to actually reach `certificate.create`. No farmId/farmName
 * on the app, and the located farmData's address lookup (farm.findFirst ->
 * null) misses, so resolveFarmForCertificate reaches `farm.create`.
 */
function makePrisma({
    app = makeApp(),
    withPhotoModel = true,
    withChecklistModel = true,
    auditRow = { id: 'audit-1', applicationId: 'app-1' },
    photoCount = DEFAULT_MIN_PHOTOS,
    itemCount = CHECKLIST_TEMPLATE_2026.length,
} = {}) {
    const prisma = {
        // certificate number draws its running number from the ReceiptSequence series
        receiptSequence: { upsert: jest.fn(async () => ({ counter: 1 })) },
        certificate: {
            findFirst: jest.fn(async () => null), // no existing cert — dedupe passes through
            findUnique: jest.fn(async () => null), // no certificateNumber collision
            create: jest.fn(async ({ data }) => ({ id: 'cert-new', ...data })),
        },
        application: {
            findUnique: jest.fn(async () => app),
        },
        farm: {
            findFirst: jest.fn(async () => null), // no farm at that address — resolver creates one
            create: jest.fn(async ({ data }) => ({ id: 'farm-1', ...data })),
        },
        plot: {
            // plotCount > 0 short-circuits ensurePlotsForFarm before any plot.create.
            count: jest.fn(async () => 1),
        },
        auditChecklist: {
            findFirst: jest.fn(async () => auditRow),
        },
        // F-G4-58: issuance names the plant from the master (plant-species-service),
        // read through this client, and refuses before any write when it is unknown.
        plantSpecies: {
            findUnique: jest.fn(async ({ where }) => (where.code === 'CAN'
                ? { id: 'ps-can', code: 'CAN', nameTH: 'กัญชา', nameEN: 'Cannabis' }
                : null)),
        },
    };
    if (withPhotoModel) {
        prisma.farmAuditPhoto = farmAuditPhotoStub(photoCount);
    }
    if (withChecklistModel) {
        prisma.farmAuditChecklistItem = { count: jest.fn(async () => itemCount) };
    }
    return prisma;
}

describe('certificate-service.generateCertificate — onsite evidence gate', () => {
    test('refuses to mint when the evidence models are unprovisioned: throws EVIDENCE_CAPTURE_UNAVAILABLE, no Certificate row created', async () => {
        const prisma = makePrisma({ withPhotoModel: false, withChecklistModel: false });

        await expect(
            certificateService.generateCertificate('app-1', 'auditor-1', { prisma, skipInitialAssets: true }),
        ).rejects.toMatchObject({ code: 'EVIDENCE_CAPTURE_UNAVAILABLE' });

        expect(prisma.certificate.create).not.toHaveBeenCalled();
        expect(prisma.farm.create).not.toHaveBeenCalled();
    });

    test('refuses to mint when no onsite audit row exists for the application: throws NO_ONSITE_AUDIT, no Certificate row created', async () => {
        const prisma = makePrisma({ auditRow: null });

        await expect(
            certificateService.generateCertificate('app-1', 'auditor-1', { prisma, skipInitialAssets: true }),
        ).rejects.toMatchObject({ code: 'NO_ONSITE_AUDIT' });

        expect(prisma.certificate.create).not.toHaveBeenCalled();
    });

    test('refuses to mint when photos are below the minimum: throws INSUFFICIENT_PHOTOS, no Certificate row created', async () => {
        const prisma = makePrisma({ photoCount: 1 });

        await expect(
            certificateService.generateCertificate('app-1', 'auditor-1', { prisma, skipInitialAssets: true }),
        ).rejects.toMatchObject({ code: 'INSUFFICIENT_PHOTOS' });

        expect(prisma.certificate.create).not.toHaveBeenCalled();
    });

    test('refuses to mint when the checklist is incomplete: throws INCOMPLETE_CHECKLIST, no Certificate row created', async () => {
        const prisma = makePrisma({ itemCount: 3 });

        await expect(
            certificateService.generateCertificate('app-1', 'auditor-1', { prisma, skipInitialAssets: true }),
        ).rejects.toMatchObject({ code: 'INCOMPLETE_CHECKLIST' });

        expect(prisma.certificate.create).not.toHaveBeenCalled();
    });

    test('mints successfully when evidence is sufficient — the gate does not block the legitimate path', async () => {
        const prisma = makePrisma();

        const cert = await certificateService.generateCertificate('app-1', 'auditor-1', { prisma, skipInitialAssets: true });

        expect(cert).toBeDefined();
        expect(cert.id).toBe('cert-new');
        expect(prisma.certificate.create).toHaveBeenCalledTimes(1);
    });

    // Task 3 (cert-integrity fix, 2026-08-17): pin the decided auditId through
    // decision -> mint. generateCertificate reads app.formData.onsiteAuditId
    // (stamped by audit-onsite-service.submitDecision) and forwards it to the
    // gate as `auditId`, so the mint verifies the SAME AuditChecklist row the
    // auditor actually decided on instead of letting the gate re-resolve.
    test('Task 3: forwards the pinned formData.onsiteAuditId to the gate as auditId', async () => {
        const app = makeApp({
            formData: {
                auditResult: 'PASS',
                auditedAt: new Date().toISOString(),
                onsiteAuditId: 'pinned-1',
                plantId: 'cannabis',
                farmData: LOCATED_FARM_DATA,
            },
        });
        const prisma = makePrisma({ app, auditRow: { id: 'pinned-1', applicationId: 'app-1' } });

        const cert = await certificateService.generateCertificate('app-1', 'auditor-1', { prisma, skipInitialAssets: true });

        expect(cert).toBeDefined();
        expect(gate.assertOnsiteEvidenceSufficient).toHaveBeenCalledWith(
            expect.objectContaining({ applicationId: 'app-1', auditId: 'pinned-1' }),
        );
    });
});
