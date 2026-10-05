/**
 * F-G4-22 tripwire (2026-08-26) — issuing a certificate must write NO
 * cultivation rows.
 *
 * generateCertificate used to call createInitialAssets, which seeded a
 * PlantingCycle called "Featured Cycle 1/<year>" (English name, no plot,
 * startDate = the issue date), a HarvestBatch with freshWeight 0, and a public
 * QR code for that batch. During the G4 walk (12:51:22) the cycle showed up in
 * the farmer's own cycle list mixed in with the ones they had actually created.
 * Records of cultivation that never happened do not belong to the act of
 * issuing a certificate.
 *
 * This file drives the REAL issuance chain through the injectable
 * options.prisma client — deliberately WITHOUT skipInitialAssets, i.e. the
 * fullest path any live caller takes (the AUDIT_PASSED auto-issue hook passes
 * no such flag) — and goes red the moment anything re-adds an auto-seed.
 */
'use strict';

// The QR service is module-required, not injected: mock it so the test can
// prove issuance never asks it for a batch QR.
const mockGenerateForRecord = jest.fn(async () => ({ qrCode: 'qr-1', trackingUrl: 'https://trace/x' }));
jest.mock('../../services/qrcode/qrcode-service', () => ({ generateForRecord: mockGenerateForRecord }));

// RULING 2 (2026-08-22) + the 2026-08-25 trust check: PKI signing is mandatory
// and fail-closed before issuance reaches anything else. This file is about
// auto-seeded rows, not signing, so it supplies a satisfying stub — signing has
// its own suites (certificate-signing-fail-closed, -requires-trusted-key).
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

const certService = require('../../services/certificate-service');
const { DEFAULT_MIN_PHOTOS, CHECKLIST_TEMPLATE_2026 } = require('../../services/audit-onsite-service');
const { farmAuditPhotoStub } = require('../../test-support/farm-audit-photo-stub');

const APP = {
    id: 'app-1', status: 'AUDIT_PASSED', auditResult: 'PASS',
    organizationId: 'org-1', entityId: null, submitterId: 'u1',
    applicant: { id: 'u1', firstName: 'สมชาย', lastName: 'ใจดี' },
    entity: null,
    // F-G4-58: issuance names the plant from the master, read as the wizard slug in
    // formData.plantId; an application that states none is refused before any write.
    formData: { farmId: 'farm-1', plantId: 'turmeric' },
};

const FARM = {
    id: 'farm-1', farmName: 'ฟาร์มบ้านนา', organizationId: 'org-1',
    cultivationArea: 1600, totalArea: 1600, areaUnit: 'sqm',
    address: 'บ้านนา', province: 'เชียงใหม่', district: 'สันทราย',
    subDistrict: 'แม่แฝก', postalCode: '50210',
    entityId: null, entity: null,
};

function fakeClient() {
    return {
        // certificate number draws its running number from the ReceiptSequence series
        receiptSequence: { upsert: jest.fn(async () => ({ counter: 1 })) },
        certificate: {
            findFirst: jest.fn(async () => null),   // dedupe clear
            findUnique: jest.fn(async () => null),  // no cert-number collision
            create: jest.fn(async ({ data }) => ({ id: 'cert-1', ...data })),
        },
        application: { findUnique: jest.fn(async () => APP) },
        // Sufficient onsite evidence, sourced from the real thresholds so this
        // stays in lockstep with audit-onsite-service.
        auditChecklist: { findFirst: jest.fn(async () => ({ id: 'audit-1' })) },
        farmAuditPhoto: farmAuditPhotoStub(DEFAULT_MIN_PHOTOS),
        farmAuditChecklistItem: { count: jest.fn(async () => CHECKLIST_TEMPLATE_2026.length) },
        farm: {
            findFirst: jest.fn(async () => FARM),
            create: jest.fn(async ({ data }) => ({ ...FARM, ...data })),
            update: jest.fn(async ({ data }) => ({ ...FARM, ...data })),
        },
        // The delegates the retired bootstrap used. Present so a re-added
        // auto-seed would RUN (and be caught by the assertions) instead of
        // dying on an undefined delegate and being swallowed as best-effort.
        plantSpecies: {
            findFirst: jest.fn(async () => ({ id: 'species-1', nameTH: 'ขมิ้นชัน', code: 'TUR' })),
            // F-G4-58: the lookup issuance itself makes (plant-species-service) for the
            // slug above; findFirst stays the retired seed's tripwire and must stay untouched.
            findUnique: jest.fn(async ({ where }) => (where.code === 'TUR'
                ? { id: 'species-1', code: 'TUR', nameTH: 'ขมิ้นชัน', nameEN: 'Turmeric' }
                : null)),
        },
        plantingCycle: { create: jest.fn(async ({ data }) => ({ id: 'cycle-1', ...data })) },
        harvestBatch: {
            create: jest.fn(async ({ data }) => ({ id: 'batch-1', ...data })),
            update: jest.fn(async () => ({ id: 'batch-1' })),
        },
        $queryRaw: jest.fn(async () => [{ seq: 1 }]),
    };
}

beforeEach(() => {
    mockGenerateForRecord.mockClear();
    // Plots belong to the farm the certificate is issued for, not to this
    // test's subject; the per-file module registry keeps the override local.
    certService.ensurePlotsForFarm = jest.fn(async () => {});
});

describe('F-G4-22 — certificate issuance seeds no cultivation records', () => {
    it('issues the certificate and writes no PlantingCycle, no HarvestBatch, no batch QR', async () => {
        const client = fakeClient();

        const cert = await certService.generateCertificate('app-1', 'auditor-1', { prisma: client });

        // The certificate path still works end to end.
        expect(client.certificate.create).toHaveBeenCalledTimes(1);
        expect(cert.certificateNumber).toMatch(/^TH-GACP \d+\/\d{4}$/);

        // ...and nothing was invented alongside it.
        expect(client.plantingCycle.create).not.toHaveBeenCalled();
        expect(client.harvestBatch.create).not.toHaveBeenCalled();
        expect(client.harvestBatch.update).not.toHaveBeenCalled();
        expect(mockGenerateForRecord).not.toHaveBeenCalled();
        // Not even the species lookup the seed opened with.
        expect(client.plantSpecies.findFirst).not.toHaveBeenCalled();
    });

    it('exposes no createInitialAssets entry point for a caller to reach around the fix', () => {
        expect(certService.createInitialAssets).toBeUndefined();
    });
});
