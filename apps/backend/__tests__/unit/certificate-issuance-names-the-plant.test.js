'use strict';

/**
 * A certificate names the plant it certifies from the plant master, or there is no certificate.
 *
 * F-G4-58 (2026-08-27). All three certificates in the demo register carry cropType 'Herb'
 * inside the SIGNED canonical JSON (certificate-service.js certificateCanonicalJson). The
 * issuance path read app.formData.plantName, a key the wizard never writes (it stores
 * formData.plantId, the FE slug 'cannabis'), and fell back to the literal 'Herb'. The
 * register name of a plant lives in one place, the plant_species master (nameTH), reached
 * through services/plant-species-service.js. A certificate is a government register: a
 * missing fact is a refusal, never a stand-in.
 *
 * Drives the REAL issuance chain through the injectable options.prisma client (pattern:
 * certificate-issuance-carries-farm-coordinates.test.js) — no DB, no module mock of the
 * data layer. The plant master is the injected client's plantSpecies delegate.
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

const REFUSAL_CODE = 'CERTIFICATE_PLANT_UNKNOWN';
const RETIRED_LITERAL = 'Herb';

const person = { id: 'u1', firstName: 'สมชาย', lastName: 'ใจดี' };

// The plant master as prisma.plantSpecies.findUnique({ where: { code } }) answers it
// (prisma/seed-plants.js: CAN → กัญชา). Every row carries the schema's two status
// flags (prisma/schema/trace.prisma: isActive default true, isDeleted default false).
const PLANT_MASTER = Object.freeze({
    CAN: { id: 'ps-can', code: 'CAN', nameTH: 'กัญชา', nameEN: 'Cannabis', isActive: true, isDeleted: false },
});

/** An application whose wizard answers are complete except for what `formDataExtra` says. */
function app(formDataExtra = {}) {
    return {
        id: 'app-1', status: 'AUDIT_PASSED', auditResult: 'PASS',
        organizationId: 'org-1', entityId: null, submitterId: null,
        applicant: person, entity: null,
        formData: {
            onsiteAuditId: 'audit-1',
            // F-G4-52: issuance refuses a farm with no location, so the wizard's
            // answer is stated here; the plant stays the subject.
            farmData: {
                farmName: 'ไร่ทดสอบ', totalAreaSize: '1600', totalAreaUnit: 'Sqm',
                address: '99 หมู่ 4 ถนนสุเทพ', province: 'เชียงใหม่', district: 'เมืองเชียงใหม่',
                subdistrict: 'สุเทพ', postalCode: '50200',
            },
            ...formDataExtra,
        },
    };
}

/** A client with no farm on record and the plant master above. */
function fakeClient(application) {
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
            findFirst: jest.fn(async () => null),
            create: jest.fn(async ({ data }) => ({ id: 'farm-new', entity: null, ...data })),
            update: jest.fn(async ({ data }) => ({ id: 'farm-new', entity: null, ...data })),
        },
        plantSpecies: {
            findUnique: jest.fn(async ({ where }) => PLANT_MASTER[where.code] || null),
        },
    };
}

/** Every string written through any farm/certificate write on this client. */
function everyWrittenString(client) {
    const calls = [
        ...client.farm.create.mock.calls,
        ...client.farm.update.mock.calls,
        ...client.certificate.create.mock.calls,
    ];
    return calls.flatMap(([arg]) => Object.values(arg.data)).filter((value) => typeof value === 'string');
}

function expectNoWriteAtAll(client) {
    expect(client.farm.create).not.toHaveBeenCalled();
    expect(client.farm.update).not.toHaveBeenCalled();
    expect(client.certificate.create).not.toHaveBeenCalled();
}

beforeEach(() => {
    // Plots are not the subject; keep the run to the farm and certificate writes.
    certService.ensurePlotsForFarm = jest.fn(async () => {});
});

const issue = (client) => certService.generateCertificate('app-1', 'auditor-1', { prisma: client, skipInitialAssets: true });

describe('the certificate names the plant from the master', () => {
    it('stamps cropType with the master nameTH for the wizard slug cannabis', async () => {
        const client = fakeClient(app({ plantId: 'cannabis' }));

        await issue(client);

        expect(client.plantSpecies.findUnique).toHaveBeenCalledWith({ where: { code: 'CAN' } });
        const cert = client.certificate.create.mock.calls[0][0].data;
        expect(cert.cropType).toBe('กัญชา');
        expect(everyWrittenString(client)).not.toContain(RETIRED_LITERAL);
    });

    it('accepts the master code itself as the plant reference', async () => {
        const client = fakeClient(app({ plantId: 'CAN' }));

        await issue(client);

        const cert = client.certificate.create.mock.calls[0][0].data;
        expect(cert.cropType).toBe('กัญชา');
        expect(everyWrittenString(client)).not.toContain(RETIRED_LITERAL);
    });

    it('refuses a plant the master does not know, before any write, naming the reference', async () => {
        const client = fakeClient(app({ plantId: 'durian' }));

        await expect(issue(client)).rejects.toMatchObject({
            code: REFUSAL_CODE,
            statusCode: 422,
            message: expect.stringContaining('durian'),
        });

        expect(client.plantSpecies.findUnique).toHaveBeenCalledTimes(1);
        expectNoWriteAtAll(client);
    });

    it('refuses an application that names no plant at all, before any write', async () => {
        const client = fakeClient(app({}));

        await expect(issue(client)).rejects.toMatchObject({
            code: REFUSAL_CODE,
            statusCode: 422,
        });

        expectNoWriteAtAll(client);
    });

    it('refuses a plant an admin has deactivated, before any write, naming the reference', async () => {
        // routes/api/admin/plants.js PATCH sets isActive:false on a live master row. The
        // wizard answer was given while the plant was live; the mint comes later.
        const client = fakeClient(app({ plantId: 'cannabis' }));
        client.plantSpecies.findUnique = jest.fn(async () => ({ ...PLANT_MASTER.CAN, isActive: false }));

        await expect(issue(client)).rejects.toMatchObject({
            code: REFUSAL_CODE,
            statusCode: 422,
            message: expect.stringContaining('cannabis'),
        });

        expect(client.plantSpecies.findUnique).toHaveBeenCalledWith({ where: { code: 'CAN' } });
        expectNoWriteAtAll(client);
    });

    it('refuses a soft-deleted plant, before any write', async () => {
        const client = fakeClient(app({ plantId: 'CAN' }));
        client.plantSpecies.findUnique = jest.fn(async () => ({ ...PLANT_MASTER.CAN, isDeleted: true }));

        await expect(issue(client)).rejects.toMatchObject({ code: REFUSAL_CODE, statusCode: 422 });

        expectNoWriteAtAll(client);
    });

    it('never writes the retired literal for a plant the master knows by code but not by name', async () => {
        // A master row with blank names is not a name; the register refuses rather
        // than print 'Herb' or an empty string.
        const client = fakeClient(app({ plantId: 'cannabis' }));
        client.plantSpecies.findUnique = jest.fn(async () => ({ id: 'ps-blank', code: 'CAN', nameTH: '  ', nameEN: null }));

        await expect(issue(client)).rejects.toMatchObject({ code: REFUSAL_CODE, statusCode: 422 });

        expectNoWriteAtAll(client);
    });
});
