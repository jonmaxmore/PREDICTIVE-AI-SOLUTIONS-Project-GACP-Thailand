'use strict';

/**
 * A certificate's location is the resolved farm's location, or there is no certificate.
 *
 * F-G4-52 (2026-08-27). All three certificates in the demo register carried province
 * 'Unknown' and district / subDistrict '-', although the wizard had stored เชียงใหม่ /
 * เมืองเชียงใหม่ / สุเทพ in formData.farmData and the Farm row resolved at issuance already
 * held them. generateCertificate read app.formData.locationData.* (a key the wizard fills
 * with nothing but farmId, application-draft-query-methods.js:84) and fell back to a
 * literal; the farm payload did the same with 'Unknown' / '00000'. The public verifier then
 * printed 'Unknown' to anyone who scanned the QR. A certificate is a government register:
 * a fake fact on it is worse than a refusal.
 *
 * Drives the REAL issuance chain through the injectable options.prisma client
 * (pattern: certificate-issuance-carries-farm-coordinates.test.js) — no DB, no module
 * mock of the data layer.
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

const REFUSAL_CODE = 'CERTIFICATE_FARM_LOCATION_MISSING';
const PLACEHOLDERS = ['Unknown', '00000', '-'];

const person = { id: 'u1', firstName: 'สมชาย', lastName: 'ใจดี' };

// Exactly what the wizard stores (farmData.subdistrict is the wizard's spelling).
const wizardLocation = {
    address: '99 หมู่ 4 ถนนสุเทพ',
    province: 'เชียงใหม่',
    district: 'เมืองเชียงใหม่',
    subdistrict: 'สุเทพ',
    postalCode: '50200',
};

function app(farmData, formDataExtra = {}) {
    return {
        id: 'app-1', status: 'AUDIT_PASSED', auditResult: 'PASS',
        organizationId: 'org-1', entityId: null, submitterId: null,
        applicant: person, entity: null,
        formData: {
            onsiteAuditId: 'audit-1',
            // F-G4-58: issuance refuses an application whose plant the master does not
            // know, so the wizard's answer is stated here; the location stays the subject.
            plantId: 'cannabis',
            farmData: { farmName: 'ไร่ทดสอบ', totalAreaSize: '1600', totalAreaUnit: 'Sqm', ...farmData },
            ...formDataExtra,
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

/** Every value written through any farm/certificate write on this client. */
function everyWrittenValue(client) {
    const calls = [
        ...client.farm.create.mock.calls,
        ...client.farm.update.mock.calls,
        ...client.certificate.create.mock.calls,
    ];
    return calls.flatMap(([arg]) => Object.values(arg.data));
}

function expectNoPlaceholderWritten(client) {
    for (const value of everyWrittenValue(client)) {
        if (typeof value === 'string') {
            expect(PLACEHOLDERS).not.toContain(value);
        }
    }
}

beforeEach(() => {
    // Plots are not the subject; keep the run to the farm and certificate writes.
    certService.ensurePlotsForFarm = jest.fn(async () => {});
});

const issue = (client) => certService.generateCertificate('app-1', 'auditor-1', { prisma: client, skipInitialAssets: true });

describe('the create path', () => {
    it('stamps the certificate with the location the farm was just created from', async () => {
        const client = fakeClient(app(wizardLocation), null);

        await issue(client);

        const farmWrite = client.farm.create.mock.calls[0][0].data;
        expect(farmWrite).toEqual(expect.objectContaining({
            address: '99 หมู่ 4 ถนนสุเทพ',
            province: 'เชียงใหม่',
            district: 'เมืองเชียงใหม่',
            subDistrict: 'สุเทพ',
            postalCode: '50200',
        }));

        const cert = client.certificate.create.mock.calls[0][0].data;
        expect(cert).toEqual(expect.objectContaining({
            province: 'เชียงใหม่',
            district: 'เมืองเชียงใหม่',
            subDistrict: 'สุเทพ',
            address: '99 หมู่ 4 ถนนสุเทพ',
        }));
        expectNoPlaceholderWritten(client);
    });

    it('refuses when the wizard gave no province: no farm, no certificate, no literal', async () => {
        const { province: _omitted, ...withoutProvince } = wizardLocation;
        const client = fakeClient(app(withoutProvince), null);

        await expect(issue(client)).rejects.toMatchObject({
            code: REFUSAL_CODE,
            message: expect.stringContaining('จังหวัด'),
        });

        expect(client.farm.create).not.toHaveBeenCalled();
        expect(client.certificate.create).not.toHaveBeenCalled();
    });
});

describe('the reuse path', () => {
    const farmOnRecord = {
        id: 'farm-1', ownerId: 'u1', organizationId: 'org-1', entityId: null,
        farmName: 'ไร่ทดสอบ',
        address: '12 หมู่ 3 บ้านนา', province: 'ลำพูน', district: 'เมืองลำพูน',
        subDistrict: 'ในเมือง', postalCode: '51000',
        totalArea: 1600, cultivationArea: 1600, areaUnit: 'sqm',
    };

    it('stamps the certificate with the existing farm row, not with the application or locationData', async () => {
        // The application answers with a different province; a stray locationData too. The
        // farm row already knows where it is, and the certificate certifies that farm.
        const client = fakeClient(
            app(wizardLocation, { locationData: { farmId: 'farm-1', province: 'กรุงเทพมหานคร' } }),
            farmOnRecord,
        );

        await issue(client);

        expect(client.farm.create).not.toHaveBeenCalled();
        const cert = client.certificate.create.mock.calls[0][0].data;
        expect(cert).toEqual(expect.objectContaining({
            province: 'ลำพูน',
            district: 'เมืองลำพูน',
            subDistrict: 'ในเมือง',
            address: '12 หมู่ 3 บ้านนา',
        }));
        expectNoPlaceholderWritten(client);
    });

    it('refuses a legacy row whose province and district are known but whose subdistrict is blank and the application has no subdistrict', async () => {
        // Certificate.subDistrict is NOT NULL (certification.prisma:43) and part of the
        // signed canonical JSON (certificateCanonicalJson). A row that knows its province
        // and district but not its subdistrict, met by an application that answers
        // province and district but no subdistrict, is still an unlocated farm: refuse
        // naming ตำบล, and write nothing on the way out.
        const { subdistrict: _omitted, ...withoutSubdistrict } = wizardLocation;
        const client = fakeClient(
            app(withoutSubdistrict),
            { ...farmOnRecord, subDistrict: '' },
        );

        await expect(issue(client)).rejects.toMatchObject({
            code: REFUSAL_CODE,
            message: expect.stringContaining('ตำบล'),
        });

        expect(client.farm.update).not.toHaveBeenCalled();
        expect(client.certificate.create).not.toHaveBeenCalled();
        expectNoPlaceholderWritten(client);
    });

    it('refuses a legacy farm row whose location stays blank after the application fills what it can', async () => {
        // The application states a province and nothing else; the row on record has neither
        // province nor district. Fill-only-blank supplies the province, the district is still
        // nobody's answer, and issuance refuses rather than certify an unlocated farm — and
        // nothing is written on the way out.
        const client = fakeClient(
            app({ province: 'เชียงใหม่' }),
            { ...farmOnRecord, province: '', district: '', subDistrict: '', postalCode: '' },
        );

        await expect(issue(client)).rejects.toMatchObject({
            code: REFUSAL_CODE,
            message: expect.stringContaining('อำเภอ'),
        });

        expect(client.farm.update).not.toHaveBeenCalled();
        expect(client.certificate.create).not.toHaveBeenCalled();
        expectNoPlaceholderWritten(client);
    });

    // Exactly what the pre-fix create path stamped on every farm born without those
    // answers (HEAD certificate-service.js farmPayload: 'Unknown' x4, postalCode '00000').
    // Such a row is neither blank nor a fact; it is a retired stand-in.
    const legacyStandInFarm = {
        ...farmOnRecord,
        address: 'Unknown', province: 'Unknown', district: 'Unknown',
        subDistrict: 'Unknown', postalCode: '00000',
    };

    it('fills over a legacy row stamped Unknown / 00000 with the application answers and certifies the real place', async () => {
        const client = fakeClient(app(wizardLocation), legacyStandInFarm);

        await issue(client);

        expect(client.farm.create).not.toHaveBeenCalled();
        const farmWrite = client.farm.update.mock.calls[0][0].data;
        expect(farmWrite).toEqual(expect.objectContaining({
            address: '99 หมู่ 4 ถนนสุเทพ',
            province: 'เชียงใหม่',
            district: 'เมืองเชียงใหม่',
            subDistrict: 'สุเทพ',
            postalCode: '50200',
        }));

        const cert = client.certificate.create.mock.calls[0][0].data;
        expect(cert).toEqual(expect.objectContaining({
            province: 'เชียงใหม่',
            district: 'เมืองเชียงใหม่',
            subDistrict: 'สุเทพ',
            address: '99 หมู่ 4 ถนนสุเทพ',
        }));
        expectNoPlaceholderWritten(client);
    });

    it('refuses a legacy row whose province is the literal Unknown when the application has no answer either', async () => {
        const client = fakeClient(app({}), { ...farmOnRecord, province: 'Unknown' });

        await expect(issue(client)).rejects.toMatchObject({
            code: REFUSAL_CODE,
            message: expect.stringContaining('จังหวัด'),
        });

        expect(client.farm.update).not.toHaveBeenCalled();
        expect(client.certificate.create).not.toHaveBeenCalled();
        expectNoPlaceholderWritten(client);
    });
});
