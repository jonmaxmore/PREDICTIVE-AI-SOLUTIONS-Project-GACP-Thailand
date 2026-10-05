/**
 * M1 F7 tripwire (2026-08-15): the holder dual-write in generateCertificate is
 * load-bearing — this file goes red if any strand is pulled out:
 *   • certificate.create data must carry holderDisplayName / holderType /
 *     submittedByUserId while userId / applicantName stay the frozen person
 *   • application.findUnique must ride entity along (plan D1 priority 1)
 *   • every farm lookup/create/update inside resolveFarmForCertificate must
 *     ride entity along (D1 priority 2 — "พลาดทางเดียว = เพี้ยนเฉพาะบางใบ")
 * Drives the REAL issuance chain through the injectable options.prisma client —
 * no DB, no module mock of the data layer.
 */

// RULING 2 (2026-08-22, certificate-service.js:1089-1135): PKI signing is no
// longer best-effort — signWithLocalKey, getPublicKeyForNamespace, a self-verify
// round-trip AND (2026-08-25) a trust check on the key about to be pinned are all
// mandatory or generateCertificate refuses fail-closed
// (CERT_SIGNING_UNAVAILABLE) before ever reaching holder wiring. This file is
// about holder-column wiring, not signing, so the fixture supplies a satisfying
// stub for all four (signing itself is covered by
// certificate-signing-fail-closed.test.js and
// certificate-issuance-requires-trusted-key.test.js).
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

const person = { id: 'u1', firstName: 'สมชาย', lastName: 'ใจดี' };

function farmRow(entity) {
    return {
        id: 'farm-1', farmName: 'ฟาร์มบ้านนา', organizationId: 'org-1',
        cultivationArea: 1600, totalArea: 1600, areaUnit: 'sqm',
        address: 'บ้านนา', province: 'เชียงใหม่', district: 'สันทราย',
        subDistrict: 'แม่แฝก', postalCode: '50210',
        entityId: entity ? 'e1' : null, entity: entity ?? null,
    };
}

function fakeClient(app, { farmFound, farmEntity }) {
    const farm = farmRow(farmEntity);
    return {
        // certificate number draws its running number from the ReceiptSequence series
        receiptSequence: { upsert: jest.fn(async () => ({ counter: 1 })) },
        certificate: {
            findFirst: jest.fn(async () => null),   // no existing cert (dedupe clear)
            findUnique: jest.fn(async () => null),  // no cert-number collision
            create: jest.fn(async ({ data }) => ({ id: 'cert-1', ...data })),
        },
        application: { findUnique: jest.fn(async () => app) },
        // cert-integrity gate (onsite-evidence-gate.js, Phase A2 2026-08-16):
        // generateCertificate now refuses fail-closed unless it can VERIFY a
        // live onsite audit with enough photos/checklist items. This file is
        // about holder-column wiring, not evidence capture, so the fixture
        // supplies a sufficient record — sourced from audit-onsite-service's
        // own constants so this stays in lockstep with the real thresholds.
        auditChecklist: {
            findFirst: jest.fn(async () => ({ id: 'audit-1' })),
        },
        farmAuditPhoto: farmAuditPhotoStub(DEFAULT_MIN_PHOTOS),
        farmAuditChecklistItem: {
            count: jest.fn(async () => CHECKLIST_TEMPLATE_2026.length),
        },
        farm: {
            findFirst: jest.fn(async () => (farmFound ? farm : null)),
            create: jest.fn(async ({ data }) => ({ ...farm, ...data, entity: farmEntity ?? null })),
            update: jest.fn(async ({ data }) => ({ ...farm, ...data, entity: farmEntity ?? null })),
        },
        // F-G4-58: issuance names the plant from the master (plant-species-service),
        // read through this client, and refuses before any write when it is unknown.
        plantSpecies: {
            findUnique: jest.fn(async ({ where }) => ({
                CAN: { id: 'ps-can', code: 'CAN', nameTH: 'กัญชา', nameEN: 'Cannabis' },
                TUR: { id: 'ps-tur', code: 'TUR', nameTH: 'ขมิ้นชัน', nameEN: 'Turmeric' },
            })[where.code] || null),
        },
    };
}

beforeEach(() => {
    // Plots are irrelevant to holder wiring; per-file module registry makes
    // this override invisible to every other test file.
    certService.ensurePlotsForFarm = jest.fn(async () => {});
});

describe('M1 issuance holder wiring (F7 tripwire)', () => {
    it('writes holder columns from the application entity and keeps the frozen person columns', async () => {
        const app = {
            id: 'app-1', status: 'APPROVED', auditResult: 'PASS',
            organizationId: 'org-1', entityId: 'e1', submitterId: 'u2',
            applicant: person,
            entity: { displayName: 'วิสาหกิจชุมชนสมุนไพรบ้านนา', type: 'COMMUNITY_ENTERPRISE' },
            formData: { farmId: 'farm-1', plantId: 'turmeric' },
        };
        const client = fakeClient(app, {
            farmFound: true,
            farmEntity: { displayName: 'นิติบุคคลฟาร์ม', type: 'JURISTIC' },
        });

        await certService.generateCertificate('app-1', 'prov-1', { prisma: client, skipInitialAssets: true });

        expect(client.application.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ include: expect.objectContaining({ entity: true }) }),
        );
        expect(client.farm.findFirst.mock.calls[0][0].include).toEqual(
            expect.objectContaining({ entity: true }),
        );
        expect(client.farm.update).toHaveBeenCalledWith(
            expect.objectContaining({ include: expect.objectContaining({ entity: true }) }),
        );
        expectEveryFarmLookupRodeEntity(client);
        const created = client.certificate.create.mock.calls[0][0].data;
        expect(created).toEqual(expect.objectContaining({
            holderDisplayName: 'วิสาหกิจชุมชนสมุนไพรบ้านนา',   // app entity beats farm entity (D1)
            holderType: 'COMMUNITY_ENTERPRISE',
            submittedByUserId: 'u2',                            // submitter of record, not providerId
            userId: 'u1',                                       // frozen history, untouched
            applicantName: 'สมชาย ใจดี',
        }));
    });

    it('falls back to the farm entity on the create path, and the create rides entity along', async () => {
        const app = {
            id: 'app-2', status: 'AUDIT_PASSED', auditResult: 'PASS',
            organizationId: 'org-1', entityId: null, submitterId: null,
            applicant: person, entity: null,
            formData: {
                plantId: 'cannabis',
                farmName: 'สวนฟ้าทะลายโจร',   // name lookup misses → farm.create path
                // F-G4-52: a farm cannot be created without its location.
                farmData: { farmName: 'ฟาร์มของผู้ยื่น', address: '99 หมู่ 4', province: 'เชียงใหม่', district: 'สันทราย', subdistrict: 'แม่แฝก', postalCode: '50210' },
            },
        };
        const client = fakeClient(app, {
            farmFound: false,
            farmEntity: { displayName: 'นิติบุคคลฟาร์ม', type: 'JURISTIC' },
        });

        await certService.generateCertificate('app-2', 'SYSTEM', { prisma: client, skipInitialAssets: true });

        expect(client.farm.findFirst.mock.calls[0][0].include).toEqual(
            expect.objectContaining({ entity: true }),
        );
        expect(client.farm.create).toHaveBeenCalledWith(
            expect.objectContaining({ include: expect.objectContaining({ entity: true }) }),
        );
        const created = client.certificate.create.mock.calls[0][0].data;
        expect(created).toEqual(expect.objectContaining({
            holderDisplayName: 'นิติบุคคลฟาร์ม',   // D1 priority 2: farm entity
            holderType: 'JURISTIC',
            submittedByUserId: 'u1',               // no submitterId → applicant, never 'SYSTEM'
        }));
        expectEveryFarmLookupRodeEntity(client);
    });

    it('the reuse-by-address lookup rides entity along too (F9 mutant B)', async () => {
        const app = {
            id: 'app-3', status: 'APPROVED', auditResult: 'PASS',
            organizationId: 'org-1', entityId: null, submitterId: null,
            applicant: person, entity: null,
            // No farmId → the id lookup is skipped. The NAME is stated because since
            // 2026-09-07 a farm cannot be born without one (CERTIFICATE_FARM_NAME_MISSING),
            // and this scenario ends in a farm being created — so the name lookup runs too,
            // ahead of the address match. Both are asserted below to ride entity along,
            // which is what this test is actually about.
            formData: {
                plantId: 'cannabis',   // F-G4-58: not a farm identifier; the id lookup stays skipped
                farmName: 'ฟาร์มของผู้ยื่น',
                // The found farm belongs to another entity, so the lookup refuses it and
                // issuance creates a new farm from this — F-G4-52: a farm cannot be
                // created without its full location, so subDistrict/zipCode are stated.
                locationData: { address: '99 หมู่ 4', province: 'เชียงใหม่', district: 'สันทราย', subDistrict: 'แม่แฝก', zipCode: '50210' },
            },
        };
        const client = fakeClient(app, {
            farmFound: true,
            farmEntity: { displayName: 'วิสาหกิจชุมชนแม่แฝก', type: 'COMMUNITY_ENTERPRISE' },
        });

        await certService.generateCertificate('app-3', 'prov-1', { prisma: client, skipInitialAssets: true });

        // name lookup, then address match — two, and no third
        expect(client.farm.findFirst).toHaveBeenCalledTimes(2);
        expectEveryFarmLookupRodeEntity(client);
        const created = client.certificate.create.mock.calls[0][0].data;
        expect(created).toEqual(expect.objectContaining({
            holderDisplayName: 'วิสาหกิจชุมชนแม่แฝก',
            holderType: 'COMMUNITY_ENTERPRISE',
        }));
    });
});

// Every farm access — every findFirst variant, create, update — must ride
// entity along, including calls this file's scenarios route around. A new
// lookup added without include shows up here as soon as any test drives it.
function expectEveryFarmLookupRodeEntity(client) {
    const calls = [
        ...client.farm.findFirst.mock.calls,
        ...client.farm.create.mock.calls,
        ...client.farm.update.mock.calls,
    ];
    expect(calls.length).toBeGreaterThan(0);
    for (const [arg] of calls) {
        expect(arg.include).toEqual(expect.objectContaining({ entity: true }));
    }
}
