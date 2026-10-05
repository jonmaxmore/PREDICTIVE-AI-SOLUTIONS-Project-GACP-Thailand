'use strict';

/**
 * Issuance carries the farm's coordinates onto the Farm row — as a pair, or not at all.
 *
 * F-G4-33 (2026-08-27). The G4 walk's farmer gave a position in the wizard
 * (farmData.gpsLat 18.796143 / gpsLng 98.953608, still in the application's formData) and
 * the Farm row minted at issuance had latitude NULL, longitude NULL. resolveFarmForCertificate
 * built its payload from farmData for the name and address and simply never looked at the
 * coordinates. A certified farm with no location cannot have a single photograph bound to
 * it — the per-photo distance the provenance layer records came back FARM_LOCATION_UNKNOWN
 * for all five evidence photographs of a farm that had, in fact, told us where it was.
 *
 * Drives the REAL issuance chain through the injectable options.prisma client
 * (pattern: certificate-issuance-holder-wiring.test.js) — no DB, no module mock of the
 * data layer.
 */

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

function app(farmData) {
    return {
        id: 'app-1', status: 'AUDIT_PASSED', auditResult: 'PASS',
        organizationId: 'org-1', entityId: null, submitterId: null,
        applicant: person, entity: null,
        formData: {
            onsiteAuditId: 'audit-1',
            // F-G4-58: issuance refuses an application whose plant the master does not
            // know, so the wizard's answer is stated here; the coordinates stay the subject.
            plantId: 'cannabis',
            farmData: {
                farmName: 'ไร่ทดสอบ',
                // F-G4-52: issuance refuses a farm with no location, so the wizard's
                // answer is stated here; the coordinates stay the subject.
                address: 'บ้านนา', province: 'เชียงใหม่', district: 'สันทราย',
                subdistrict: 'แม่แฝก', postalCode: '50210',
                ...farmData,
            },
        },
    };
}

/** A client whose farm.findFirst answers with `existingFarm` (or nothing). */
function fakeClient(application, existingFarm) {
    return {
        // certificate number draws its running number from the ReceiptSequence series
        receiptSequence: { upsert: jest.fn(async () => ({ counter: 1 })) },
        certificate: {
            findFirst: jest.fn(async () => null),
            findUnique: jest.fn(async () => null),
            create: jest.fn(async ({ data }) => ({ id: 'cert-1', ...data })),
        },
        application: { findUnique: jest.fn(async () => application) },
        auditChecklist: { findFirst: jest.fn(async () => ({ id: 'audit-1' })) },
        farmAuditPhoto: farmAuditPhotoStub(DEFAULT_MIN_PHOTOS),
        farmAuditChecklistItem: { count: jest.fn(async () => CHECKLIST_TEMPLATE_2026.length) },
        farm: {
            findFirst: jest.fn(async () => (existingFarm ? { entity: null, ...existingFarm } : null)),
            create: jest.fn(async ({ data }) => ({ id: 'farm-new', entity: null, ...data })),
            update: jest.fn(async ({ data }) => ({ ...existingFarm, ...data, entity: null })),
        },
        // F-G4-58: issuance names the plant from the master (plant-species-service),
        // read through this client, and refuses before any write when it is unknown.
        plantSpecies: {
            findUnique: jest.fn(async ({ where }) => (where.code === 'CAN'
                ? { id: 'ps-can', code: 'CAN', nameTH: 'กัญชา', nameEN: 'Cannabis' }
                : null)),
        },
    };
}

beforeEach(() => {
    // Plots are not the subject; keep the run to the farm write.
    certService.ensurePlotsForFarm = jest.fn(async () => {});
});

const issue = (client) => certService.generateCertificate('app-1', 'auditor-1', { prisma: client, skipInitialAssets: true });

describe('the create path', () => {
    it('writes the wizard coordinates onto the new farm', async () => {
        const client = fakeClient(app({ gpsLat: '18.796143', gpsLng: '98.953608' }), null);

        await issue(client);

        const { data } = client.farm.create.mock.calls[0][0];
        expect(data.latitude).toBe(18.796143);
        expect(data.longitude).toBe(98.953608);
    });

    it('writes NULL — not 0 — when the wizard gave none', async () => {
        const client = fakeClient(app({}), null);

        await issue(client);

        const { data } = client.farm.create.mock.calls[0][0];
        expect(data.latitude).toBeNull();
        expect(data.longitude).toBeNull();
    });

    it('writes NULL for both when only one half was given', async () => {
        const client = fakeClient(app({ gpsLat: '18.796143' }), null);

        await issue(client);

        const { data } = client.farm.create.mock.calls[0][0];
        expect(data.latitude).toBeNull();
        expect(data.longitude).toBeNull();
    });
});

describe('the reuse path — fill-only-blank, as a pair', () => {
    const located = {
        id: 'farm-1', ownerId: 'u1', organizationId: 'org-1', entityId: null,
        farmName: 'ไร่ทดสอบ', address: 'บ้านนา', province: 'เชียงใหม่', district: 'สันทราย',
        subDistrict: 'แม่แฝก', postalCode: '50210',
        totalArea: 200, cultivationArea: 200, areaUnit: 'sqm',
    };

    it('fills an unlocated farm from the application', async () => {
        const client = fakeClient(
            app({ gpsLat: '18.796143', gpsLng: '98.953608' }),
            { ...located, latitude: null, longitude: null },
        );

        await issue(client);

        const { data } = client.farm.update.mock.calls[0][0];
        expect(data.latitude).toBe(18.796143);
        expect(data.longitude).toBe(98.953608);
    });

    it('never overwrites a farm that already knows where it is', async () => {
        const client = fakeClient(
            app({ gpsLat: '1.0', gpsLng: '2.0' }),
            { ...located, latitude: 18.796143, longitude: 98.953608 },
        );

        await issue(client);

        const { data } = client.farm.update.mock.calls[0][0];
        expect(data).not.toHaveProperty('latitude');
        expect(data).not.toHaveProperty('longitude');
    });

    it('leaves a half-located farm alone rather than completing it with a guess', async () => {
        // One half on the row is already an inconsistency; issuance must not paper over it
        // by writing the other half from a different source.
        const client = fakeClient(
            app({ gpsLat: '18.796143', gpsLng: '98.953608' }),
            { ...located, latitude: 18.796143, longitude: null },
        );

        await issue(client);

        const { data } = client.farm.update.mock.calls[0][0];
        expect(data).not.toHaveProperty('latitude');
        expect(data).not.toHaveProperty('longitude');
    });
});
